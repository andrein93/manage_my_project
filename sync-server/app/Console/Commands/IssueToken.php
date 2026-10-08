<?php

namespace App\Console\Commands;

use App\Models\User;
use Illuminate\Console\Attributes\Description;
use Illuminate\Console\Attributes\Signature;
use Illuminate\Console\Command;

#[Signature('mmp:token {email : Email of an existing member}')]
#[Description('Issue a new mmp sync API token for a team member')]
class IssueToken extends Command
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

        $token = $user->createToken('mmp')->plainTextToken;
        $url = rtrim((string) config('app.url'), '/');

        $this->components->info("API token for {$user->name} <{$user->email}> (shown only once):");
        $this->line($token);
        $this->newLine();
        $this->line("Connect with: mmp sync login {$url} \"{$token}\"");

        return self::SUCCESS;
    }
}
