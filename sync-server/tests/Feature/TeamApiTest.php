<?php

namespace Tests\Feature;

use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Laravel\Sanctum\Sanctum;
use PHPUnit\Framework\Attributes\DataProvider;
use Tests\TestCase;

class TeamApiTest extends TestCase
{
    use RefreshDatabase;

    /**
     * @return array<string, array{string, string}>
     */
    public static function protectedEndpoints(): array
    {
        return [
            'me' => ['GET', '/api/v1/me'],
            'members' => ['GET', '/api/v1/members'],
            'push' => ['POST', '/api/v1/sync/push'],
            'pull' => ['GET', '/api/v1/sync/pull'],
        ];
    }

    #[DataProvider('protectedEndpoints')]
    public function test_endpoints_require_a_token(string $method, string $uri): void
    {
        $this->call($method, $uri)
            ->assertUnauthorized()
            ->assertExactJson(['message' => 'Unauthenticated.']);
    }

    public function test_an_invalid_token_is_rejected(): void
    {
        $this->withToken('1|not-a-real-token')->getJson('/api/v1/me')->assertUnauthorized();
    }

    public function test_me_returns_the_user_and_server(): void
    {
        config(['app.name' => 'Acme Team']);
        $user = User::factory()->create(['name' => 'Ada Lovelace', 'email' => 'ada@example.com']);
        Sanctum::actingAs($user);

        $this->getJson('/api/v1/me')
            ->assertOk()
            ->assertExactJson([
                'user' => ['id' => $user->id, 'name' => 'Ada Lovelace', 'email' => 'ada@example.com'],
                'server' => ['name' => 'Acme Team', 'version' => '1'],
            ]);
    }

    public function test_members_are_listed_by_name(): void
    {
        $zoe = User::factory()->create(['name' => 'Zoe']);
        $ada = User::factory()->create(['name' => 'Ada']);
        Sanctum::actingAs($zoe);

        $this->getJson('/api/v1/members')
            ->assertOk()
            ->assertExactJson([
                ['id' => $ada->id, 'name' => 'Ada'],
                ['id' => $zoe->id, 'name' => 'Zoe'],
            ]);
    }
}
