<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Http\Resources\TaskFileResource;
use App\Http\Resources\TaskResource;
use App\Models\Activity;
use App\Models\Board;
use App\Models\BoardColumn;
use App\Models\Task;
use App\Models\TaskFile;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Illuminate\Validation\Rule;
use Illuminate\Validation\Rules\Exists;

class TaskController extends Controller
{
    /** A task may only carry a source the board still offers. */
    private function sourceRule(Board $board): Exists
    {
        return Rule::exists('sources', 'name')
            ->where('board_id', $board->id)
            ->where('is_archived', false);
    }

    /** Field rules shared by create and update; only requiredness differs. */
    private function rules(Board $board, bool $creating): array
    {
        return [
            'column_id' => [$creating ? 'required' : 'sometimes', 'integer',
                Rule::exists('board_columns', 'id')->where('board_id', $board->id)],
            'title' => [$creating ? 'required' : 'sometimes', 'string', 'max:255'],
            'source' => ['sometimes', $this->sourceRule($board)],
            'sender' => ['nullable', 'string', 'max:120'],
            'due' => ['nullable', 'date'],
            'priority' => ['sometimes', Rule::in(Task::PRIORITIES)],
            'quote' => ['nullable', 'string', 'max:5000'],
            'attachments' => ['nullable', 'string', 'max:255'],
            'tags' => ['sometimes', 'array', 'max:6'],
            'tags.*' => ['string', 'max:32'],
        ];
    }

    /** Translate the client's field names onto column names. */
    private function payload(array $data): array
    {
        $map = [
            'column_id' => 'board_column_id',
            'title' => 'title',
            'source' => 'source',
            'sender' => 'sender',
            'due' => 'due_date',
            'priority' => 'priority',
            'quote' => 'quote',
            'attachments' => 'attachments_note',
            'tags' => 'tags',
        ];

        $out = [];
        foreach ($map as $in => $col) {
            if (array_key_exists($in, $data)) {
                $value = $data[$in];
                $out[$col] = ($in === 'due' && $value === '') ? null : $value;
            }
        }

        return $out;
    }

    public function store(Request $request, Board $board): JsonResponse
    {
        $data = $request->validate($this->rules($board, true));

        $task = DB::transaction(function () use ($board, $data) {
            $column = BoardColumn::findOrFail($data['column_id']);

            $task = $board->tasks()->create($this->payload($data) + [
                'captured_on' => now()->toDateString(),
                'done_on' => $column->is_done ? now()->toDateString() : null,
                'position' => (int) Task::where('board_column_id', $column->id)->max('position') + 1,
            ]);

            Activity::note($board->id, 'Created in '.$column->name, $task->id);

            return $task;
        });

        return response()->json([
            'data' => new TaskResource($task->load('column', 'files', 'activities')),
        ], 201);
    }

    /** Create several tasks at once, as a confirmed screenshot review does. */
    public function bulk(Request $request, Board $board): JsonResponse
    {
        $data = $request->validate([
            'screenshot_path' => ['nullable', 'string', 'max:255'],
            'source' => ['sometimes', $this->sourceRule($board)],
            'tasks' => ['required', 'array', 'min:1', 'max:20'],
            'tasks.*.column_id' => ['required', 'integer',
                Rule::exists('board_columns', 'id')->where('board_id', $board->id)],
            'tasks.*.title' => ['required', 'string', 'max:255'],
            'tasks.*.sender' => ['nullable', 'string', 'max:120'],
            'tasks.*.due' => ['nullable', 'date'],
            'tasks.*.priority' => ['sometimes', Rule::in(Task::PRIORITIES)],
            'tasks.*.quote' => ['nullable', 'string', 'max:5000'],
            'tasks.*.attachments' => ['nullable', 'string', 'max:255'],
            'tasks.*.tags' => ['sometimes', 'array', 'max:6'],
            'tasks.*.tags.*' => ['string', 'max:32'],
        ]);

        $ids = DB::transaction(function () use ($board, $data) {
            $source = $data['source'] ?? 'Manual';
            $ids = [];

            foreach ($data['tasks'] as $row) {
                $column = BoardColumn::findOrFail($row['column_id']);

                $task = $board->tasks()->create($this->payload($row) + [
                    'source' => $source,
                    'screenshot_path' => $data['screenshot_path'] ?? null,
                    'captured_on' => now()->toDateString(),
                    'done_on' => $column->is_done ? now()->toDateString() : null,
                    'position' => (int) Task::where('board_column_id', $column->id)->max('position') + 1,
                ]);

                $who = trim((string) ($row['sender'] ?? ''));
                $note = 'Captured from '.$source.($who !== '' ? ' ('.$who.')' : '').' — placed in '.$column->name;
                Activity::note($board->id, $note, $task->id);

                $ids[] = $task->id;
            }

            return $ids;
        });

        return response()->json([
            'data' => TaskResource::collection(
                Task::with('column', 'files', 'activities')->whereIn('id', $ids)->get()
            ),
        ], 201);
    }

    public function update(Request $request, Task $task): JsonResponse
    {
        $data = $request->validate($this->rules($task->board, false));

        DB::transaction(function () use ($task, $data) {
            $previousColumn = $task->board_column_id;
            $task->update($this->payload($data));
            $changes = $task->getChanges();

            if (array_key_exists('board_column_id', $changes) && $previousColumn !== $task->board_column_id) {
                $column = $task->column()->first();
                $task->update(['done_on' => $column->is_done ? now()->toDateString() : null]);
                Activity::note($task->board_id, 'Moved to '.$column->name, $task->id);
            }

            $lines = [
                'title' => 'Title edited',
                'priority' => 'Priority changed',
                'due_date' => 'Due date changed',
                'sender' => 'Sender changed',
                'source' => 'Source changed',
                'quote' => 'Notes edited',
                'tags' => 'Tags changed',
            ];

            foreach ($lines as $field => $line) {
                if (array_key_exists($field, $changes)) {
                    Activity::note($task->board_id, $line, $task->id);
                }
            }
        });

        return response()->json([
            'data' => new TaskResource($task->fresh()->load('column', 'files', 'activities')),
        ]);
    }

    /**
     * Move a task to a column at an explicit index, closing the gap it left and
     * opening one where it lands. Both lists end contiguous from 0.
     */
    public function move(Request $request, Task $task): JsonResponse
    {
        $data = $request->validate([
            'column_id' => ['required', 'integer',
                Rule::exists('board_columns', 'id')->where('board_id', $task->board_id)],
            'position' => ['required', 'integer', 'min:0'],
        ]);

        DB::transaction(function () use ($task, $data) {
            $from = $task->board_column_id;
            $to = (int) $data['column_id'];
            $target = (int) $data['position'];

            Task::where('board_column_id', $from)
                ->where('position', '>', $task->position)
                ->whereKeyNot($task->id)
                ->decrement('position');

            Task::where('board_column_id', $to)
                ->where('position', '>=', $target)
                ->whereKeyNot($task->id)
                ->increment('position');

            $column = BoardColumn::findOrFail($to);

            $task->update([
                'board_column_id' => $to,
                'position' => $target,
                'done_on' => $column->is_done ? ($task->done_on?->toDateString() ?? now()->toDateString()) : null,
            ]);

            $this->normalize($from);

            if ($to !== $from) {
                $this->normalize($to);
                Activity::note($task->board_id, 'Moved to '.$column->name, $task->id);
            }
        });

        return response()->json([
            'data' => new TaskResource($task->fresh()->load('column', 'files', 'activities')),
        ]);
    }

    public function destroy(Task $task): JsonResponse
    {
        $columnId = $task->board_column_id;

        DB::transaction(function () use ($task, $columnId) {
            Activity::note($task->board_id, 'Deleted: '.$task->title);

            foreach ($task->files as $file) {
                Storage::disk('public')->delete($file->path);
            }

            $task->delete();
            $this->normalize($columnId);
        });

        return response()->json(status: 204);
    }

    public function attach(Request $request, Task $task): JsonResponse
    {
        $request->validate([
            'files' => ['required', 'array', 'max:10'],
            'files.*' => ['file', 'max:10240'],
        ]);

        $made = collect($request->file('files'))->map(fn ($file) => $task->files()->create([
            'name' => $file->getClientOriginalName(),
            'mime' => $file->getClientMimeType(),
            'size' => $file->getSize(),
            'path' => $file->store('attachments', 'public'),
        ]));

        Activity::note(
            $task->board_id,
            'Attached '.$made->count().' file(s): '.$made->pluck('name')->join(', '),
            $task->id,
        );

        return response()->json(['data' => TaskFileResource::collection($made)], 201);
    }

    public function detach(TaskFile $file): JsonResponse
    {
        Storage::disk('public')->delete($file->path);
        Activity::note($file->task->board_id, 'Removed attachment '.$file->name, $file->task_id);
        $file->delete();

        return response()->json(status: 204);
    }

    /** Rewrite a column's positions to a dense 0..n-1 sequence. */
    private function normalize(int $columnId): void
    {
        $ids = Task::where('board_column_id', $columnId)
            ->orderBy('position')
            ->orderBy('id')
            ->pluck('id');

        foreach ($ids as $i => $id) {
            Task::whereKey($id)->update(['position' => $i]);
        }
    }
}
