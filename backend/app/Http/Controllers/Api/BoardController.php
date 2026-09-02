<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Http\Resources\ActivityResource;
use App\Http\Resources\BoardResource;
use App\Models\Board;
use Illuminate\Http\JsonResponse;

class BoardController extends Controller
{
    public function index(): JsonResponse
    {
        return response()->json([
            'data' => Board::orderBy('name')->get(['id', 'name', 'slug', 'description']),
        ]);
    }

    public function show(Board $board): JsonResponse
    {
        $board->load([
            'columns',
            'sources',
            'tasks' => fn ($q) => $q->orderBy('position')->orderBy('id'),
            'tasks.column',
            'tasks.files',
            'activities' => fn ($q) => $q->latest()->limit(80),
        ]);

        return response()->json(['data' => new BoardResource($board)]);
    }

    public function activity(Board $board): JsonResponse
    {
        return response()->json([
            'data' => ActivityResource::collection($board->activities()->limit(200)->get()),
        ]);
    }
}
