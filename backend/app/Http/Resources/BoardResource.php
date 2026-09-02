<?php

namespace App\Http\Resources;

use App\Models\Task;
use App\Services\ScreenshotReader;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

class BoardResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'name' => $this->name,
            'slug' => $this->slug,
            'description' => $this->description,
            // Archived sources ride along so a task that still carries one
            // stays readable; the picker filters them out.
            'sources' => SourceResource::collection($this->whenLoaded('sources')),
            'priorities' => Task::PRIORITIES,
            // Whether screenshots are read automatically, or captured and typed.
            'scan_enabled' => app(ScreenshotReader::class)->configured(),
            'columns' => $this->whenLoaded('columns', fn () => $this->columns->map(fn ($c) => [
                'id' => $c->id,
                'key' => $c->key,
                'name' => $c->name,
                'position' => $c->position,
                'is_done' => $c->is_done,
            ])),
            'tasks' => TaskResource::collection($this->whenLoaded('tasks')),
            'activity' => ActivityResource::collection($this->whenLoaded('activities')),
        ];
    }
}
