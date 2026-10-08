<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

class PullChangesRequest extends FormRequest
{
    /**
     * Get the validation rules that apply to the request.
     *
     * @return array<string, mixed>
     */
    public function rules(): array
    {
        return [
            'since' => ['sometimes', 'integer', 'min:0'],
            'limit' => ['sometimes', 'integer', 'min:1', 'max:1000'],
        ];
    }

    public function since(): int
    {
        return (int) $this->validated('since', 0);
    }

    public function limit(): int
    {
        return (int) $this->validated('limit', 500);
    }
}
