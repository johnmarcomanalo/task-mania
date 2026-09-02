<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('tasks', function (Blueprint $table) {
            $table->id();
            $table->foreignId('board_id')->constrained()->cascadeOnDelete();
            $table->foreignId('board_column_id')->constrained()->cascadeOnDelete();

            $table->string('title');
            // Where the task came from: Viber, Email, Teams…
            $table->string('source', 24)->default('Manual');
            $table->string('sender', 120)->nullable();
            $table->date('due_date')->nullable();
            $table->enum('priority', ['high', 'normal', 'low'])->default('normal');
            // Verbatim excerpt of the original message.
            $table->text('quote')->nullable();
            // Free-text note of attachments named in the message.
            $table->string('attachments_note')->nullable();
            $table->json('tags')->nullable();

            // Screenshot this task was read out of, relative to the public disk.
            $table->string('screenshot_path')->nullable();

            $table->date('captured_on')->nullable();
            $table->date('done_on')->nullable();
            $table->unsignedInteger('position')->default(0);
            $table->timestamps();

            $table->index(['board_column_id', 'position']);
            $table->index(['board_id', 'due_date']);
            $table->index(['board_id', 'done_on']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('tasks');
    }
};
