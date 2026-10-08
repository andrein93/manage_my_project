<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Run the migrations.
     */
    public function up(): void
    {
        Schema::create('sync_counters', function (Blueprint $table) {
            $table->string('name', 40)->primary();
            $table->unsignedBigInteger('value')->default(0);
        });

        DB::table('sync_counters')->insert(['name' => 'sync_records', 'value' => 0]);
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::dropIfExists('sync_counters');
    }
};
