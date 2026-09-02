<?php

namespace App\Http\Resources;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

class SourceResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'name' => $this->name,
            'position' => $this->position,
            'is_archived' => $this->is_archived,
            // How many tasks still carry this name; drives the delete warning.
            'task_count' => $this->when(isset($this->task_count), fn () => (int) $this->task_count),
        ];
    }
}
