<?php

namespace App\Services;

use App\Models\SyncRecord;
use App\Models\User;
use Illuminate\Database\Eloquent\Collection;
use Illuminate\Support\Facades\DB;

class SyncService
{
    private const COUNTER = 'sync_records';

    /**
     * Store the changes with last-write-wins on the client `updated_at`; ties keep the stored version.
     * Every accepted change gets the next `seq`, so pullers see it after their cursor.
     *
     * @param  list<array{table: string, id: string, data: array<mixed>, updated_at: string, deleted_at: string|null}>  $changes
     * @return array{accepted: list<string>, ignored: list<string>}
     */
    public function push(User $author, array $changes): array
    {
        return DB::transaction(function () use ($author, $changes) {
            $seq = (int) DB::table('sync_counters')->where('name', self::COUNTER)->lockForUpdate()->value('value');
            $stored = $this->storedRecords($changes);
            $result = ['accepted' => [], 'ignored' => []];

            foreach ($changes as $change) {
                $key = $change['table'].':'.$change['id'];
                $record = $stored[$key] ?? new SyncRecord(['table' => $change['table'], 'record_id' => $change['id']]);

                if ($record->exists && $record->client_updated_at >= $change['updated_at']) {
                    $result['ignored'][] = $change['id'];

                    continue;
                }

                $record->fill([
                    'seq' => ++$seq,
                    'data' => $change['data'],
                    'client_updated_at' => $change['updated_at'],
                    'client_deleted_at' => $change['deleted_at'],
                    'author_id' => $author->id,
                ])->save();

                $stored[$key] = $record;
                $result['accepted'][] = $change['id'];
            }

            DB::table('sync_counters')->where('name', self::COUNTER)->update(['value' => $seq]);

            return $result;
        });
    }

    /**
     * Records stored after `$since`, in `seq` order, plus whether more remain beyond `$limit`.
     *
     * @return array{records: Collection<int, SyncRecord>, cursor: int, more: bool}
     */
    public function pull(int $since, int $limit): array
    {
        $records = SyncRecord::query()
            ->where('seq', '>', $since)
            ->orderBy('seq')
            ->limit($limit + 1)
            ->get();

        $more = $records->count() > $limit;
        $records = $records->take($limit);

        return [
            'records' => $records,
            'cursor' => $records->last()->seq ?? $since,
            'more' => $more,
        ];
    }

    /**
     * Existing records touched by the changes, keyed by "table:record_id".
     *
     * @param  list<array{table: string, id: string}>  $changes
     * @return array<string, SyncRecord>
     */
    private function storedRecords(array $changes): array
    {
        $stored = [];

        foreach (collect($changes)->groupBy('table') as $table => $tableChanges) {
            SyncRecord::query()
                ->where('table', $table)
                ->whereIn('record_id', $tableChanges->pluck('id')->unique()->all())
                ->get()
                ->each(function (SyncRecord $record) use (&$stored) {
                    $stored[$record->table.':'.$record->record_id] = $record;
                });
        }

        return $stored;
    }
}
