<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Http\Resources\SourceResource;
use App\Models\Board;
use App\Models\Source;
use App\Models\Task;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\Rule;

/**
 * The channels a board captures tasks from. Names live on tasks.source
 * verbatim, so a rename has to carry the old tasks with it and a name still
 * in use is archived rather than dropped.
 */
class SourceController extends Controller
{
    public function index(Board $board): AnonymousResourceCollection
    {
        return SourceResource::collection($this->withCounts($board));
    }

    public function store(Request $request, Board $board): JsonResponse
    {
        $data = $request->validate([
            'name' => ['required', 'string', 'max:'.Source::MAX_NAME,
                Rule::unique('sources', 'name')->where('board_id', $board->id)],
        ]);

        $source = $board->sources()->create([
            'name' => $data['name'],
            'position' => (int) $board->sources()->max('position') + 1,
            'is_archived' => false,
        ]);

        return SourceResource::make($source)->response()->setStatusCode(201);
    }

    public function update(Request $request, Source $source): JsonResponse
    {
        $data = $request->validate([
            'name' => ['sometimes', 'string', 'max:'.Source::MAX_NAME,
                Rule::unique('sources', 'name')
                    ->where('board_id', $source->board_id)
                    ->ignore($source->id)],
            'is_archived' => ['sometimes', 'boolean'],
        ]);

        DB::transaction(function () use ($source, $data) {
            // Tasks store the name, not the id, so the rename has to reach them.
            if (isset($data['name']) && $data['name'] !== $source->name) {
                Task::where('board_id', $source->board_id)
                    ->where('source', $source->name)
                    ->update(['source' => $data['name']]);
            }

            $source->update($data);
        });

        return SourceResource::make($source->fresh())->response();
    }

    public function destroy(Source $source): JsonResponse
    {
        $using = $this->taskCount($source);

        // Dropping a name still on a task would leave that task unreadable,
        // so the source is retired from the picker instead.
        if ($using > 0) {
            $source->update(['is_archived' => true]);

            return response()->json(['archived' => true, 'tasks_using' => $using]);
        }

        $source->delete();

        return response()->json(['archived' => false, 'tasks_using' => 0]);
    }

    private function taskCount(Source $source): int
    {
        return Task::where('board_id', $source->board_id)
            ->where('source', $source->name)
            ->count();
    }

    /** Sources with the number of tasks each still holds, for the manager UI. */
    private function withCounts(Board $board)
    {
        $counts = Task::where('board_id', $board->id)
            ->selectRaw('source, count(*) as total')
            ->groupBy('source')
            ->pluck('total', 'source');

        return $board->sources()->get()->each(
            fn (Source $s) => $s->task_count = (int) ($counts[$s->name] ?? 0)
        );
    }
}
