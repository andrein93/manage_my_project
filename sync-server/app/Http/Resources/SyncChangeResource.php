<?php

namespace App\Http\Resources;

use App\Models\SyncRecord;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * @mixin SyncRecord
 */
class SyncChangeResource extends JsonResource
{
    /**
     * Transform the resource into an array.
     *
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        return [
            'table' => $this->table,
            'id' => $this->record_id,
            'data' => $this->data,
            'updated_at' => $this->client_updated_at,
            'deleted_at' => $this->client_deleted_at,
            'author_id' => $this->author_id,
            'seq' => $this->seq,
        ];
    }
}
