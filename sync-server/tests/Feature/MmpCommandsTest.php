<?php

namespace Tests\Feature;

use App\Models\SyncRecord;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Str;
use Laravel\Sanctum\PersonalAccessToken;
use Tests\TestCase;

class MmpCommandsTest extends TestCase
{
    use RefreshDatabase;

    public function test_mmp_user_creates_a_member_with_a_working_token(): void
    {
        config(['app.url' => 'https://sync.example.com']);

        $this->assertSame(0, Artisan::call('mmp:user', ['name' => 'Ada Lovelace', 'email' => 'ada@example.com']));
        $token = $this->tokenFrom(Artisan::output(), 'https://sync.example.com');

        $user = User::query()->where('email', 'ada@example.com')->firstOrFail();
        $this->assertSame('Ada Lovelace', $user->name);
        $this->assertNull($user->password);
        $this->assertSame(['mmp'], $user->tokens()->pluck('name')->all());

        $this->withToken($token)->getJson('/api/v1/me')
            ->assertOk()
            ->assertJsonPath('user.id', $user->id)
            ->assertJsonPath('user.email', 'ada@example.com');
    }

    public function test_mmp_user_refuses_an_existing_email(): void
    {
        User::factory()->create(['email' => 'ada@example.com']);

        $this->artisan('mmp:user', ['name' => 'Ada', 'email' => 'ada@example.com'])->assertFailed();

        $this->assertSame(1, User::count());
    }

    public function test_mmp_user_refuses_an_invalid_email(): void
    {
        $this->artisan('mmp:user', ['name' => 'Ada', 'email' => 'not-an-email'])->assertFailed();

        $this->assertSame(0, User::count());
    }

    public function test_mmp_token_issues_another_working_token(): void
    {
        $user = User::factory()->create(['email' => 'ada@example.com']);
        $user->createToken('mmp');

        $this->assertSame(0, Artisan::call('mmp:token', ['email' => 'ada@example.com']));
        $token = $this->tokenFrom(Artisan::output(), rtrim(config('app.url'), '/'));

        $this->assertSame(2, $user->tokens()->count());
        $this->withToken($token)->getJson('/api/v1/me')->assertOk()->assertJsonPath('user.id', $user->id);
    }

    public function test_mmp_token_fails_for_an_unknown_email(): void
    {
        $this->artisan('mmp:token', ['email' => 'nobody@example.com'])->assertFailed();
    }

    public function test_mmp_revoke_deletes_all_tokens_but_keeps_the_member_and_authorship(): void
    {
        $user = User::factory()->create(['email' => 'ada@example.com']);
        $first = $user->createToken('mmp')->plainTextToken;
        $second = $user->createToken('mmp')->plainTextToken;
        $other = User::factory()->create()->createToken('mmp')->plainTextToken;
        $record = $this->pushRecordWith($first);

        $this->artisan('mmp:revoke', ['email' => 'ada@example.com'])
            ->expectsOutputToContain('Revoked 2 tokens')
            ->assertSuccessful();

        $this->assertSame(0, $user->tokens()->count());
        $this->assertNotNull(User::find($user->id));
        $this->assertSame($user->id, SyncRecord::query()->where('record_id', $record)->value('author_id'));

        $this->assertRejected($first);
        $this->assertRejected($second);
        $this->freshGuards()->withToken($other)->getJson('/api/v1/me')->assertOk();
    }

    public function test_mmp_revoke_remove_also_deletes_the_member_and_clears_authorship(): void
    {
        $user = User::factory()->create(['email' => 'ada@example.com']);
        $token = $user->createToken('mmp')->plainTextToken;
        $record = $this->pushRecordWith($token);

        $this->artisan('mmp:revoke', ['email' => 'ada@example.com', '--remove' => true])
            ->expectsOutputToContain('Revoked 1 token')
            ->expectsOutputToContain('Removed member')
            ->assertSuccessful();

        $this->assertNull(User::find($user->id));
        $this->assertSame(0, PersonalAccessToken::count());
        $this->assertSame(1, SyncRecord::count());
        $this->assertNull(SyncRecord::query()->where('record_id', $record)->value('author_id'));

        $this->assertRejected($token);
    }

    public function test_mmp_revoke_fails_for_an_unknown_email(): void
    {
        $this->artisan('mmp:revoke', ['email' => 'nobody@example.com'])->assertFailed();
    }

    private function pushRecordWith(string $token): string
    {
        $id = (string) Str::uuid();

        $this->freshGuards()->withToken($token)->postJson('/api/v1/sync/push', ['changes' => [[
            'table' => 'clients',
            'id' => $id,
            'data' => ['name' => 'Acme'],
            'updated_at' => '2026-10-08T12:00:00.000Z',
            'deleted_at' => null,
        ]]])->assertOk()->assertJsonPath('accepted', [$id]);

        return $id;
    }

    private function assertRejected(string $token): void
    {
        $this->freshGuards()->withToken($token)->getJson('/api/v1/me')->assertUnauthorized();
    }

    /**
     * The auth guards cache the resolved user for the lifetime of the app instance; forget them so each
     * request authenticates its own token, as it would in production.
     */
    private function freshGuards(): static
    {
        $this->app['auth']->forgetGuards();

        return $this;
    }

    private function tokenFrom(string $output, string $url): string
    {
        $this->assertMatchesRegularExpression('#mmp sync login '.preg_quote($url, '#').' "([^"]+)"#', $output);
        preg_match('#mmp sync login \S+ "([^"]+)"#', $output, $matches);

        return $matches[1];
    }
}
