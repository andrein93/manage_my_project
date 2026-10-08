<?php

namespace App\Console\Commands;

use App\Models\SyncRecord;
use App\Models\User;
use Illuminate\Console\Attributes\Description;
use Illuminate\Console\Attributes\Signature;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;

#[Signature('mmp:revoke {email : Email of an existing member} {--remove : Also delete the member (their records stay, without an author)}')]
#[Description('Revoke all mmp sync API tokens of a team member, optionally removing the member')]
class RevokeMember extends Command
{
    /**
     * Execute the console command.
     */
    public function handle(): int
    {
        $user = User::query()->where('email', $this->argument('email'))->first();

        if ($user === null) {
            $this->components->error('No member with email '.$this->argument('email').'.');

            return self::FAILURE;
        }

        $remove = (bool) $this->option('remove');

        [$tokens, $records] = DB::transaction(function () use ($user, $remove) {
            $tokens = $user->tokens()->delete();
            $records = 0;

            if ($remove) {
                $records = SyncRecord::query()->where('author_id', $user->getKey())->count();
                // The author_id foreign key is nullOnDelete: shared records stay, without an author.
                $user->delete();
            }

            return [$tokens, $records];
        });

        $this->components->info("Revoked {$tokens} ".str('token')->plural($tokens)." of {$user->name} <{$user->email}>.");

        if ($remove) {
            $this->components->info("Removed member {$user->name} <{$user->email}>; {$records} shared "
                .str('record')->plural($records).' kept without an author.');
        } else {
            $this->line('The member is kept, so their authorship of shared records is preserved. Issue a new token with mmp:token.');
        }

        return self::SUCCESS;
    }
}
