<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Run the migrations.
     */
    public function up(): void
    {
        Schema::create('sync_records', function (Blueprint $table) {
            $table->id();
            $table->unsignedBigInteger('seq')->unique();
            $table->string('table', 40);
            $table->uuid('record_id');
            $table->json('data');
            $table->string('client_updated_at', 40);
            $table->string('client_deleted_at', 40)->nullable();
            $table->foreignUuid('author_id')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamps();

            $table->unique(['table', 'record_id']);
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::dropIfExists('sync_records');
    }
};
