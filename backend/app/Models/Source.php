<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class Source extends Model
{
    /** Channels a board starts with. Manual is the fallback the reader falls back to. */
    public const DEFAULTS = ['Viber', 'Email', 'Messenger', 'WhatsApp', 'Teams', 'SMS', 'Slack', 'Manual'];

    /** Longest name a source may have; tasks.source stores it verbatim. */
    public const MAX_NAME = 24;

    protected $fillable = ['board_id', 'name', 'position', 'is_archived'];

    protected function casts(): array
    {
        return ['is_archived' => 'boolean', 'position' => 'integer'];
    }

    public function board(): BelongsTo
    {
        return $this->belongsTo(Board::class);
    }

    /** Only the sources still offered when capturing a task. */
    public function scopeActive(Builder $query): Builder
    {
        return $query->where('is_archived', false);
    }
}
