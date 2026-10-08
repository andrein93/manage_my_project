<?php

namespace App\Http\Controllers;

use App\Http\Requests\PullChangesRequest;
use App\Http\Requests\PushChangesRequest;
use App\Http\Resources\SyncChangeResource;
use App\Services\SyncService;
use Illuminate\Http\JsonResponse;

class SyncController extends Controller
{
    public function __construct(private readonly SyncService $sync) {}

    public function push(PushChangesRequest $request): JsonResponse
    {
        return response()->json($this->sync->push($request->user(), $request->changes()));
    }

    public function pull(PullChangesRequest $request): JsonResponse
    {
        $page = $this->sync->pull($request->since(), $request->limit());

        return response()->json([
            'changes' => SyncChangeResource::collection($page['records']),
            'cursor' => $page['cursor'],
            'more' => $page['more'],
        ]);
    }
}
