<?php

namespace Database\Seeders;

use App\Models\Activity;
use App\Models\Board;
use App\Models\Task;
use Illuminate\Database\Seeder;

class DatabaseSeeder extends Seeder
{
    public function run(): void
    {
        if (Board::where('slug', 'task-mania')->exists()) {
            $this->command->info('Starter board already present, skipping.');

            return;
        }

        $board = Board::create([
            'name' => 'Task Mania',
            'slug' => 'task-mania',
            'description' => 'Everything the team is carrying this week.',
        ]);

        $board->seedColumns();
        $board->seedSources();
        $columns = $board->columns()->get()->keyBy('key');

        $day = fn (int $n) => now()->addDays($n)->toDateString();

        $rows = [
            ['doing', 'Send the revised quotation to Ms. Rivera', 'Viber', 'Ms. Rivera', $day(0), 'high', 'Can you send the updated quotation this afternoon? I need it for tomorrow’s approval.', '', ['client'], $day(-1), null],
            ['todo', 'Reconcile the September delivery receipts', 'Email', 'Accounting', $day(2), 'normal', 'Attached is the DR summary. Please confirm discrepancies before month-end closing.', 'DR-Summary-Sept.xlsx', ['finance'], $day(-2), null],
            ['wait', 'Answer the warehouse headcount follow-up', 'Teams', 'HR — Joyce', null, 'normal', 'Waiting on your numbers for the Q4 warehouse plan.', '', ['internal'], $day(-3), null],
            ['inbox', 'Book the site visit to the Calamba plant', 'SMS', '+63 917 ***', $day(5), 'low', '', '', [], $day(-1), null],
            ['review', 'Final check on the vendor accreditation packet', 'Email', 'Procurement', $day(1), 'high', '', '', ['vendor'], $day(-4), null],
            ['done', 'Update the weekly report template', 'Manual', null, null, 'normal', '', '', [], $day(-1), $day(0)],
            ['done', 'Confirm the courier pickup for samples', 'Viber', 'Ops — Rey', null, 'normal', 'Pickup is scheduled for 3PM.', '', [], $day(-2), $day(-1)],
            ['done', 'File the BIR 2307 for the supplier', 'Email', 'Finance', null, 'normal', '', '', ['finance'], $day(-3), $day(-2)],
        ];

        foreach ($rows as [$col, $title, $source, $sender, $due, $prio, $quote, $attach, $tags, $captured, $doneOn]) {
            $column = $columns[$col];

            Task::create([
                'board_id' => $board->id,
                'board_column_id' => $column->id,
                'title' => $title,
                'source' => $source,
                'sender' => $sender,
                'due_date' => $due,
                'priority' => $prio,
                'quote' => $quote ?: null,
                'attachments_note' => $attach ?: null,
                'tags' => $tags,
                'captured_on' => $captured,
                'done_on' => $doneOn,
                'position' => Task::where('board_column_id', $column->id)->count(),
            ]);
        }

        Activity::note($board->id, 'Task captured from Viber (Ms. Rivera) — placed in In Progress.');
        Activity::note($board->id, 'Completed: Update the weekly report template.');

        $this->command->info('Seeded "Task Mania" with '.count($rows).' tasks across '.$columns->count().' columns.');
    }
}
