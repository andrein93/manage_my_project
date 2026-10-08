<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Model;

/**
 * One opaque mmp row relayed between team members. The server never interprets `data`.
 */
#[Fillable(['seq', 'table', 'record_id', 'data', 'client_updated_at', 'client_deleted_at', 'author_id'])]
class SyncRecord extends Model
{
    /**
     * Client tables that may be synced through the relay.
     */
    public const TABLES = [
        'clients',
        'categories',
        'projects',
        'tasks',
        'agreements',
        'payments',
        'expenses',
        'time_entries',
        'time_daily',
    ];

    /**
     * Maximum size of one record's JSON-encoded `data`, in bytes.
     */
    public const MAX_DATA_BYTES = 65536;

    /**
     * Get the attributes that should be cast.
     *
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'seq' => 'integer',
            'data' => 'array',
        ];
    }
}
