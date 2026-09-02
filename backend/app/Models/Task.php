<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

class Task extends Model
{
    public const PRIORITIES = ['high', 'normal', 'low'];


    protected $fillable = [
        'board_id', 'board_column_id', 'title', 'source', 'sender', 'due_date',
        'priority', 'quote', 'attachments_note', 'tags', 'screenshot_path',
        'captured_on', 'done_on', 'position',
    ];

    protected function casts(): array
    {
        return [
            'due_date' => 'date:Y-m-d',
            'captured_on' => 'date:Y-m-d',
            'done_on' => 'date:Y-m-d',
            'tags' => 'array',
            'position' => 'integer',
        ];
    }

    public function board(): BelongsTo
    {
        return $this->belongsTo(Board::class);
    }

    public function column(): BelongsTo
    {
        return $this->belongsTo(BoardColumn::class, 'board_column_id');
    }

    public function files(): HasMany
    {
        return $this->hasMany(TaskFile::class);
    }

    public function activities(): HasMany
    {
        return $this->hasMany(Activity::class)->latest();
    }
}
