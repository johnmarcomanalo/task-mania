<?php

namespace Tests\Feature;

use App\Models\Board;
use App\Models\Source;
use App\Models\Task;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class SourceTest extends TestCase
{
    use RefreshDatabase;

    private function board(string $name = 'Test Board'): Board
    {
        $board = Board::create(['name' => $name]);
        $board->seedColumns();
        $board->seedSources();

        return $board;
    }

    private function task(Board $board, string $source): Task
    {
        return Task::create([
            'board_id' => $board->id,
            'board_column_id' => $board->columns()->first()->id,
            'title' => 'Follow up with the supplier',
            'source' => $source,
        ]);
    }

    public function test_it_lists_the_sources_a_board_starts_with(): void
    {
        $board = $this->board();

        $this->getJson("/api/boards/{$board->slug}/sources")
            ->assertOk()
            ->assertJsonCount(count(Source::DEFAULTS), 'data')
            ->assertJsonPath('data.0.name', 'Viber')
            ->assertJsonPath('data.0.is_archived', false);
    }

    public function test_it_adds_a_source(): void
    {
        $board = $this->board();

        $this->postJson("/api/boards/{$board->slug}/sources", ['name' => 'Zoom'])
            ->assertCreated()
            ->assertJsonPath('data.name', 'Zoom')
            ->assertJsonPath('data.is_archived', false);

        $this->assertDatabaseHas('sources', ['board_id' => $board->id, 'name' => 'Zoom']);
    }

    public function test_it_rejects_a_name_already_on_the_board(): void
    {
        $board = $this->board();

        $this->postJson("/api/boards/{$board->slug}/sources", ['name' => 'Viber'])
            ->assertStatus(422)
            ->assertJsonValidationErrors('name');
    }

    public function test_it_allows_the_same_name_on_a_different_board(): void
    {
        $this->board();
        $other = $this->board('Second Board');
        Source::where('board_id', $other->id)->where('name', 'Viber')->delete();

        $this->postJson("/api/boards/{$other->slug}/sources", ['name' => 'Viber'])
            ->assertCreated();
    }

    public function test_it_renames_a_source_and_carries_existing_tasks_with_it(): void
    {
        $board = $this->board();
        $task = $this->task($board, 'Viber');
        $source = $board->sources()->where('name', 'Viber')->first();

        $this->patchJson("/api/sources/{$source->id}", ['name' => 'Viber Work'])
            ->assertOk()
            ->assertJsonPath('data.name', 'Viber Work');

        $this->assertSame('Viber Work', $task->fresh()->source);
    }

    public function test_it_leaves_other_boards_tasks_alone_when_renaming(): void
    {
        $board = $this->board();
        $other = $this->board('Second Board');
        $untouched = $this->task($other, 'Viber');
        $source = $board->sources()->where('name', 'Viber')->first();

        $this->patchJson("/api/sources/{$source->id}", ['name' => 'Viber Work'])->assertOk();

        $this->assertSame('Viber', $untouched->fresh()->source);
    }

    public function test_it_deletes_a_source_no_task_uses(): void
    {
        $board = $this->board();
        $source = $board->sources()->where('name', 'Slack')->first();

        $this->deleteJson("/api/sources/{$source->id}")
            ->assertOk()
            ->assertJsonPath('archived', false);

        $this->assertDatabaseMissing('sources', ['id' => $source->id]);
    }

    public function test_it_archives_instead_of_deleting_a_source_tasks_still_use(): void
    {
        $board = $this->board();
        $this->task($board, 'Viber');
        $source = $board->sources()->where('name', 'Viber')->first();

        $this->deleteJson("/api/sources/{$source->id}")
            ->assertOk()
            ->assertJsonPath('archived', true)
            ->assertJsonPath('tasks_using', 1);

        $this->assertTrue($source->fresh()->is_archived);
    }

    public function test_it_can_archive_and_restore_a_source(): void
    {
        $board = $this->board();
        $source = $board->sources()->where('name', 'SMS')->first();

        $this->patchJson("/api/sources/{$source->id}", ['is_archived' => true])
            ->assertOk()
            ->assertJsonPath('data.is_archived', true);

        $this->patchJson("/api/sources/{$source->id}", ['is_archived' => false])
            ->assertOk()
            ->assertJsonPath('data.is_archived', false);
    }

    public function test_it_rejects_a_task_source_the_board_does_not_have(): void
    {
        $board = $this->board();

        $this->postJson("/api/boards/{$board->slug}/tasks", [
            'column_id' => $board->columns()->first()->id,
            'title' => 'Check the delivery',
            'source' => 'Carrier Pigeon',
        ])->assertStatus(422)->assertJsonValidationErrors('source');
    }

    public function test_it_rejects_a_task_source_that_is_archived(): void
    {
        $board = $this->board();
        $board->sources()->where('name', 'Slack')->update(['is_archived' => true]);

        $this->postJson("/api/boards/{$board->slug}/tasks", [
            'column_id' => $board->columns()->first()->id,
            'title' => 'Check the delivery',
            'source' => 'Slack',
        ])->assertStatus(422)->assertJsonValidationErrors('source');
    }

    public function test_the_board_payload_carries_sources_as_objects(): void
    {
        $board = $this->board();
        $board->sources()->where('name', 'Slack')->update(['is_archived' => true]);

        $this->getJson("/api/boards/{$board->slug}")
            ->assertOk()
            ->assertJsonPath('data.sources.0.name', 'Viber')
            ->assertJsonPath('data.sources.0.is_archived', false)
            ->assertJsonPath('data.sources.6.name', 'Slack')
            ->assertJsonPath('data.sources.6.is_archived', true);
    }
}
