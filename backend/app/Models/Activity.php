<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class Activity extends Model
{
    protected $fillable = ['board_id', 'task_id', 'text'];

    public function board(): BelongsTo
    {
        return $this->belongsTo(Board::class);
    }

    public function task(): BelongsTo
    {
        return $this->belongsTo(Task::class);
    }

    /** Record one line against a board, optionally tied to a task. */
    public static function note(int $boardId, string $text, ?int $taskId = null): self
    {
        return self::create(['board_id' => $boardId, 'task_id' => $taskId, 'text' => $text]);
    }
}
