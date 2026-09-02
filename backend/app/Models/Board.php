<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Support\Str;

class Board extends Model
{
    protected $fillable = ['name', 'slug', 'description'];

    /** The lanes every new board starts with, in order. */
    public const DEFAULT_COLUMNS = [
        ['key' => 'inbox',  'name' => 'Inbox',       'is_done' => false],
        ['key' => 'todo',   'name' => 'To Do',       'is_done' => false],
        ['key' => 'doing',  'name' => 'In Progress', 'is_done' => false],
        ['key' => 'wait',   'name' => 'Waiting',     'is_done' => false],
        ['key' => 'review', 'name' => 'For Review',  'is_done' => false],
        ['key' => 'done',   'name' => 'Done',        'is_done' => true],
    ];

    protected static function booted(): void
    {
        static::creating(function (Board $board) {
            $board->slug ??= Str::slug($board->name) ?: Str::random(8);
        });
    }

    public function getRouteKeyName(): string
    {
        return 'slug';
    }

    public function columns(): HasMany
    {
        return $this->hasMany(BoardColumn::class)->orderBy('position');
    }

    public function tasks(): HasMany
    {
        return $this->hasMany(Task::class);
    }

    public function activities(): HasMany
    {
        return $this->hasMany(Activity::class)->latest();
    }

    public function sources(): HasMany
    {
        return $this->hasMany(Source::class)->orderBy('position');
    }

    public function seedColumns(): void
    {
        foreach (self::DEFAULT_COLUMNS as $i => $c) {
            $this->columns()->create($c + ['position' => $i]);
        }
    }

    /** The channels a new board can capture from; editable afterwards. */
    public function seedSources(): void
    {
        foreach (Source::DEFAULTS as $i => $name) {
            $this->sources()->create(['name' => $name, 'position' => $i]);
        }
    }
}
