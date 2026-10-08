<?php

namespace Tests\Feature;

use App\Models\SyncRecord;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Str;
use Illuminate\Testing\TestResponse;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class SyncApiTest extends TestCase
{
    use RefreshDatabase;

    private User $user;

    protected function setUp(): void
    {
        parent::setUp();

        $this->user = User::factory()->create();
        Sanctum::actingAs($this->user);
    }

    public function test_pushed_change_is_pulled_with_seq_and_author(): void
    {
        $change = $this->change(['data' => ['name' => 'Acme', 'tags' => ['a', 'b']]]);

        $this->postJson('/api/v1/sync/push', ['changes' => [$change]])
            ->assertOk()
            ->assertExactJson(['accepted' => [$change['id']], 'ignored' => []]);

        $this->getJson('/api/v1/sync/pull')
            ->assertOk()
            ->assertExactJson([
                'changes' => [[
                    'table' => 'clients',
                    'id' => $change['id'],
                    'data' => ['name' => 'Acme', 'tags' => ['a', 'b']],
                    'updated_at' => $change['updated_at'],
                    'deleted_at' => null,
                    'author_id' => $this->user->id,
                    'seq' => 1,
                ]],
                'cursor' => 1,
                'more' => false,
            ]);
    }

    public function test_last_write_wins(): void
    {
        $id = (string) Str::uuid();
        $this->push([$this->change(['id' => $id, 'data' => ['v' => 1], 'updated_at' => '2026-10-08T12:00:00.000Z'])]);
        $cursor = $this->getJson('/api/v1/sync/pull')->json('cursor');

        $other = User::factory()->create();
        Sanctum::actingAs($other);

        $this->postJson('/api/v1/sync/push', ['changes' => [
            $this->change(['id' => $id, 'data' => ['v' => 0], 'updated_at' => '2026-10-08T11:59:59.999Z']),
            $this->change(['id' => $id, 'data' => ['v' => 0], 'updated_at' => '2026-10-08T12:00:00.000Z']),
        ]])->assertOk()->assertExactJson(['accepted' => [], 'ignored' => [$id, $id]]);

        $this->postJson('/api/v1/sync/push', ['changes' => [
            $this->change(['id' => $id, 'data' => ['v' => 2], 'updated_at' => '2026-10-08T12:00:00.001Z']),
        ]])->assertOk()->assertExactJson(['accepted' => [$id], 'ignored' => []]);

        $this->getJson('/api/v1/sync/pull?since='.$cursor)
            ->assertOk()
            ->assertJsonCount(1, 'changes')
            ->assertJsonPath('changes.0.data', ['v' => 2])
            ->assertJsonPath('changes.0.updated_at', '2026-10-08T12:00:00.001Z')
            ->assertJsonPath('changes.0.author_id', $other->id)
            ->assertJsonPath('changes.0.seq', 2)
            ->assertJsonPath('cursor', 2)
            ->assertJsonPath('more', false);

        $this->assertSame(1, SyncRecord::count());
    }

    public function test_same_id_in_different_tables_are_separate_records(): void
    {
        $id = (string) Str::uuid();

        $this->push([$this->change(['id' => $id]), $this->change(['id' => $id, 'table' => 'projects'])])
            ->assertExactJson(['accepted' => [$id, $id], 'ignored' => []]);

        $this->assertSame(2, SyncRecord::count());
    }

    public function test_deleted_at_round_trips(): void
    {
        $change = $this->change(['deleted_at' => '2026-10-08T13:00:00.000Z', 'updated_at' => '2026-10-08T13:00:00.000Z']);
        $this->push([$change]);

        $this->getJson('/api/v1/sync/pull')
            ->assertJsonPath('changes.0.deleted_at', '2026-10-08T13:00:00.000Z');
    }

    public function test_timestamps_are_normalized_to_utc(): void
    {
        $change = $this->change(['updated_at' => '2026-10-08T14:00:00+02:00', 'deleted_at' => '2026-10-08T12:30:00.5Z']);
        $this->push([$change]);

        $this->getJson('/api/v1/sync/pull')
            ->assertJsonPath('changes.0.updated_at', '2026-10-08T12:00:00.000Z')
            ->assertJsonPath('changes.0.deleted_at', '2026-10-08T12:30:00.500Z');
    }

    public function test_pull_paginates_with_limit_and_more(): void
    {
        $ids = collect(range(1, 5))->map(fn () => (string) Str::uuid());
        $this->push($ids->map(fn (string $id) => $this->change(['id' => $id]))->all());

        $first = $this->getJson('/api/v1/sync/pull?limit=2')
            ->assertJsonCount(2, 'changes')
            ->assertJsonPath('changes.*.id', $ids->slice(0, 2)->values()->all())
            ->assertJsonPath('cursor', 2)
            ->assertJsonPath('more', true);

        $this->getJson('/api/v1/sync/pull?limit=2&since='.$first->json('cursor'))
            ->assertJsonPath('changes.*.seq', [3, 4])
            ->assertJsonPath('cursor', 4)
            ->assertJsonPath('more', true);

        $this->getJson('/api/v1/sync/pull?limit=2&since=4')
            ->assertJsonPath('changes.*.seq', [5])
            ->assertJsonPath('cursor', 5)
            ->assertJsonPath('more', false);

        $this->getJson('/api/v1/sync/pull?since=5')
            ->assertExactJson(['changes' => [], 'cursor' => 5, 'more' => false]);
    }

    public function test_pull_validates_its_parameters(): void
    {
        $this->getJson('/api/v1/sync/pull?limit=0')->assertUnprocessable()->assertJsonValidationErrors('limit');
        $this->getJson('/api/v1/sync/pull?limit=1001')->assertUnprocessable()->assertJsonValidationErrors('limit');
        $this->getJson('/api/v1/sync/pull?since=-1')->assertUnprocessable()->assertJsonValidationErrors('since');
    }

    public function test_push_rejects_an_unknown_table(): void
    {
        $this->assertRejected([$this->change(), $this->change(['table' => 'settings'])], 'changes.1.table');
    }

    public function test_push_rejects_an_invalid_uuid(): void
    {
        $this->assertRejected([$this->change(), $this->change(['id' => 'not-a-uuid'])], 'changes.1.id');
    }

    public function test_push_rejects_an_invalid_timestamp(): void
    {
        $this->assertRejected([$this->change(['updated_at' => '2026-10-08 12:00:00'])], 'changes.0.updated_at');
        $this->assertRejected([$this->change(['deleted_at' => 'yesterday'])], 'changes.0.deleted_at');
    }

    public function test_push_rejects_more_than_500_changes(): void
    {
        $changes = collect(range(1, 501))->map(fn () => $this->change())->all();

        $this->assertRejected($changes, 'changes');
    }

    public function test_push_rejects_an_empty_batch(): void
    {
        $this->assertRejected([], 'changes');
    }

    public function test_push_rejects_oversized_data(): void
    {
        $this->assertRejected(
            [$this->change(), $this->change(['data' => ['notes' => str_repeat('x', 65536)]])],
            'changes.1.data',
        );
    }

    public function test_push_accepts_data_up_to_the_limit(): void
    {
        $notes = str_repeat('x', 65536 - strlen('{"notes":""}'));

        $this->push([$this->change(['data' => ['notes' => $notes]])]);

        $this->assertSame(1, SyncRecord::count());
    }

    /**
     * @param  array<string, mixed>  $overrides
     * @return array<string, mixed>
     */
    private function change(array $overrides = []): array
    {
        return [
            'table' => 'clients',
            'id' => (string) Str::uuid(),
            'data' => ['name' => 'Client'],
            'updated_at' => '2026-10-08T12:00:00.000Z',
            'deleted_at' => null,
            ...$overrides,
        ];
    }

    /**
     * @param  list<array<string, mixed>>  $changes
     */
    private function push(array $changes): TestResponse
    {
        return $this->postJson('/api/v1/sync/push', ['changes' => $changes])->assertOk();
    }

    /**
     * @param  list<array<string, mixed>>  $changes
     */
    private function assertRejected(array $changes, string $errorKey): void
    {
        $this->postJson('/api/v1/sync/push', ['changes' => $changes])
            ->assertUnprocessable()
            ->assertJsonValidationErrors($errorKey);

        $this->assertSame(0, SyncRecord::count());
    }
}
