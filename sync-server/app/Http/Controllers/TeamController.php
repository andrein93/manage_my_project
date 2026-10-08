<?php

namespace App\Http\Controllers;

use App\Models\User;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class TeamController extends Controller
{
    public function me(Request $request): JsonResponse
    {
        $user = $request->user();

        return response()->json([
            'user' => $user->only(['id', 'name', 'email']),
            'server' => ['name' => config('app.name'), 'version' => '1'],
        ]);
    }

    public function members(): JsonResponse
    {
        return response()->json(User::query()->orderBy('name')->get(['id', 'name']));
    }
}
