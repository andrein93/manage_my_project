<?php

namespace Tests\Feature;

use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Artisan;
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

    private function tokenFrom(string $output, string $url): string
    {
        $this->assertMatchesRegularExpression('#mmp sync login '.preg_quote($url, '#').' "([^"]+)"#', $output);
        preg_match('#mmp sync login \S+ "([^"]+)"#', $output, $matches);

        return $matches[1];
    }
}
