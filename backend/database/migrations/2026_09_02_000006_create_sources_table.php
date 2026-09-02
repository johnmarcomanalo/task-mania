<?php

use App\Models\Source;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('sources', function (Blueprint $table) {
            $table->id();
            $table->foreignId('board_id')->constrained()->cascadeOnDelete();
            // Matches the width of tasks.source, which holds the name verbatim.
            $table->string('name', 24);
            $table->unsignedInteger('position')->default(0);
            // Archived sources stay readable on old tasks but leave the picker.
            $table->boolean('is_archived')->default(false);
            $table->timestamps();

            $table->unique(['board_id', 'name']);
            $table->index(['board_id', 'position']);
        });

        // Boards that already exist keep the channels they were built with.
        $now = now();
        foreach (DB::table('boards')->pluck('id') as $boardId) {
            DB::table('sources')->insert(array_map(fn ($name, $i) => [
                'board_id' => $boardId,
                'name' => $name,
                'position' => $i,
                'is_archived' => false,
                'created_at' => $now,
                'updated_at' => $now,
            ], Source::DEFAULTS, array_keys(Source::DEFAULTS)));
        }
    }

    public function down(): void
    {
        Schema::dropIfExists('sources');
    }
};
