<?php

namespace App\Http\Resources;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;
use Illuminate\Support\Facades\Storage;

class TaskResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'column_id' => $this->board_column_id,
            'column_key' => $this->whenLoaded('column', fn () => $this->column->key),
            'title' => $this->title,
            'source' => $this->source,
            'sender' => $this->sender,
            'due' => $this->due_date?->toDateString() ?? '',
            'priority' => $this->priority,
            'quote' => $this->quote ?? '',
            'attachments' => $this->attachments_note ?? '',
            'tags' => $this->tags ?? [],
            'shot' => $this->screenshot_path ? Storage::disk('public')->url($this->screenshot_path) : null,
            'captured' => $this->captured_on?->toDateString(),
            'done_on' => $this->done_on?->toDateString(),
            'position' => $this->position,
            'files' => TaskFileResource::collection($this->whenLoaded('files')),
            'history' => ActivityResource::collection($this->whenLoaded('activities')),
        ];
    }
}
