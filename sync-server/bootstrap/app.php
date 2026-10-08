<?php

use Illuminate\Foundation\Application;
use Illuminate\Foundation\Configuration\Exceptions;
use Illuminate\Foundation\Configuration\Middleware;
use Illuminate\Http\Request;

return Application::configure(basePath: dirname(__DIR__))
    ->withRouting(
        web: __DIR__.'/../routes/web.php',
        api: __DIR__.'/../routes/api.php',
        commands: __DIR__.'/../routes/console.php',
        health: '/up',
    )
    ->withMiddleware(function (Middleware $middleware): void {
        // API-only server: unauthenticated requests get a 401 JSON response, never a login redirect.
        $middleware->redirectGuestsTo(fn () => null);

        // Synced records are opaque client data: store them byte for byte ("" stays "", spaces stay).
        $middleware->convertEmptyStringsToNull(except: [fn (Request $request) => $request->is('api/v1/sync/*')]);
        $middleware->trimStrings(except: [fn (Request $request) => $request->is('api/v1/sync/*')]);
    })
    ->withExceptions(function (Exceptions $exceptions): void {
        $exceptions->shouldRenderJsonWhen(
            fn (Request $request) => $request->is('api/*') || $request->expectsJson(),
        );
    })->create();
