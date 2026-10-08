<?php

namespace App\Http\Requests;

use App\Models\SyncRecord;
use Carbon\CarbonImmutable;
use Closure;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

class PushChangesRequest extends FormRequest
{
    /**
     * ISO-8601 date-time with seconds, optional fraction and an explicit offset (Z or ±hh:mm).
     */
    private const ISO_8601 = '/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?(Z|[+-]\d{2}:\d{2})$/';

    /**
     * Get the validation rules that apply to the request.
     *
     * @return array<string, mixed>
     */
    public function rules(): array
    {
        return [
            'changes' => ['required', 'array', 'min:1', 'max:500'],
            'changes.*' => ['array'],
            'changes.*.table' => ['required', 'string', Rule::in(SyncRecord::TABLES)],
            'changes.*.id' => ['required', 'uuid'],
            'changes.*.data' => ['present', 'bail', 'array', $this->maxJsonSize(...)],
            'changes.*.updated_at' => ['required', 'string', 'regex:'.self::ISO_8601, 'date'],
            'changes.*.deleted_at' => ['nullable', 'string', 'regex:'.self::ISO_8601, 'date'],
        ];
    }

    /**
     * The validated changes, with timestamps normalized to UTC `YYYY-MM-DDTHH:MM:SS.sssZ`
     * so that last-write-wins can compare them as plain strings.
     *
     * @return list<array{table: string, id: string, data: array<mixed>, updated_at: string, deleted_at: string|null}>
     */
    public function changes(): array
    {
        return array_map(fn (array $change) => [
            'table' => $change['table'],
            'id' => $change['id'],
            'data' => $change['data'],
            'updated_at' => $this->normalizeTimestamp($change['updated_at']),
            'deleted_at' => isset($change['deleted_at']) ? $this->normalizeTimestamp($change['deleted_at']) : null,
        ], array_values($this->validated('changes')));
    }

    private function maxJsonSize(string $attribute, mixed $value, Closure $fail): void
    {
        $bytes = strlen((string) json_encode($value, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES));

        if ($bytes > SyncRecord::MAX_DATA_BYTES) {
            $fail('The :attribute field must not exceed '.SyncRecord::MAX_DATA_BYTES.' bytes when JSON-encoded.');
        }
    }

    private function normalizeTimestamp(string $value): string
    {
        return CarbonImmutable::parse($value)->utc()->format('Y-m-d\TH:i:s.v\Z');
    }
}
