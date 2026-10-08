<?php

namespace App\Providers;

use Illuminate\Cache\RateLimiting\Limit;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\RateLimiter;
use Illuminate\Support\ServiceProvider;

class AppServiceProvider extends ServiceProvider
{
    /**
     * Register any application services.
     */
    public function register(): void
    {
        //
    }

    /**
     * Bootstrap any application services.
     */
    public function boot(): void
    {
        // Clients sync every couple of minutes and page through pushes and pulls in batches, so a burst
        // of a few dozen requests is normal. 240 per minute per member leaves ample headroom while still
        // capping a runaway client or a leaked token. Falls back to the IP when there is no user.
        RateLimiter::for('api', fn (Request $request) => Limit::perMinute(240)
            ->by((string) ($request->user()?->getAuthIdentifier() ?? $request->ip())));
    }
}
