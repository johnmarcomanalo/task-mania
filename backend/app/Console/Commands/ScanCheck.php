<?php

namespace App\Console\Commands;

use App\Models\Board;
use App\Services\ScreenshotReader;
use Illuminate\Console\Command;
use Throwable;

class ScanCheck extends Command
{
    protected $signature = 'scan:check {image? : A screenshot to read. Omitted, a sample one is generated.}';

    protected $description = 'Check that screenshot reading is configured and working';

    public function handle(ScreenshotReader $reader): int
    {
        $this->newLine();
        $this->line('  <options=bold>Screenshot reading check</>');
        $this->newLine();

        if (! $reader->configured()) {
            $this->line('  Key      <fg=red>missing</>');
            $this->newLine();
            $this->line('  Add one to <options=bold>backend/.env</>, then run this again:');
            $this->line('    <fg=gray>ANTHROPIC_API_KEY=sk-ant-...</>');
            $this->newLine();
            $this->line('  Get a key at <fg=cyan>https://console.anthropic.com/settings/keys</>');
            $this->newLine();

            return self::FAILURE;
        }

        $key = (string) config('services.anthropic.key');
        $this->line('  Key      <fg=green>present</> <fg=gray>('.substr($key, 0, 7).'…'.substr($key, -4).')</>');
        $this->line('  Model    <fg=gray>'.ScreenshotReader::MODEL.'</>');

        $board = Board::with('columns')->first();
        if (! $board) {
            $this->error('  No board found. Run: php artisan migrate --seed');

            return self::FAILURE;
        }

        $path = $this->argument('image') ?? $this->sampleImage();
        if (! is_file($path)) {
            $this->error('  No such image: '.$path);

            return self::FAILURE;
        }

        $this->line('  Image    <fg=gray>'.basename($path).'</>');
        $this->newLine();
        $this->line('  Reading…');

        $started = microtime(true);

        try {
            $result = $reader->read(
                $path,
                mime_content_type($path) ?: 'image/png',
                $board->columns->pluck('key')->all(),
                $board->sources()->active()->pluck('name')->all(),
            );
        } catch (Throwable $e) {
            $this->newLine();
            $this->line('  <fg=red>Failed.</> '.$this->reason($e));
            $this->newLine();
            $this->line('  <fg=gray>'.mb_strimwidth(preg_replace('/\s+/', ' ', $e->getMessage()), 0, 160, '…').'</>');
            $this->newLine();

            return self::FAILURE;
        }

        $seconds = round(microtime(true) - $started, 1);

        $this->newLine();
        $this->line('  <fg=green>Working.</> Read in '.$seconds.'s.');
        $this->newLine();
        $this->line('  Detected source: <options=bold>'.$result['source'].'</>');
        $this->line('  Tasks found:     <options=bold>'.count($result['rows']).'</>');
        $this->newLine();

        foreach ($result['rows'] as $i => $row) {
            $this->line('  <options=bold>'.($i + 1).'. '.$row['title'].'</>');
            $this->line('     <fg=gray>column '.$row['column_key']
                .' · priority '.$row['priority']
                .($row['sender'] ? ' · from '.$row['sender'] : '')
                .($row['due'] ? ' · due '.$row['due'] : '')
                .' · confidence '.$row['confidence'].'</>');
            if ($row['quote']) {
                $this->line('     <fg=gray>"'.mb_strimwidth($row['quote'], 0, 90, '…').'"</>');
            }
            $this->newLine();
        }

        return self::SUCCESS;
    }

    /** Turn SDK exceptions into something the reader can act on. */
    private function reason(Throwable $e): string
    {
        $m = $e->getMessage();

        return match (true) {
            str_contains($m, 'authentication_error') => 'The API key was rejected. Check it was copied whole.',
            str_contains($m, 'permission_error') => 'That key cannot use '.ScreenshotReader::MODEL.'.',
            str_contains($m, 'rate_limit') => 'Rate limited. Try again in a moment.',
            str_contains($m, 'credit') || str_contains($m, 'billing') => 'The account has no credit left.',
            str_contains($m, 'not_found_error') => 'The model name was not recognised by this account.',
            str_contains($m, 'Connection Error'),
            str_contains($m, 'Could not resolve host'),
            str_contains($m, 'timed out') => 'Could not reach api.anthropic.com — check the network or firewall.',
            default => class_basename($e),
        };
    }

    /** Draw a small message screenshot so the check needs no input file. */
    private function sampleImage(): string
    {
        $path = storage_path('app/scan-check-sample.png');

        $im = imagecreatetruecolor(760, 300);
        $bg = imagecolorallocate($im, 240, 242, 246);
        $card = imagecolorallocate($im, 255, 255, 255);
        $ink = imagecolorallocate($im, 25, 28, 36);
        $muted = imagecolorallocate($im, 110, 118, 132);
        $brand = imagecolorallocate($im, 102, 80, 164);
        $white = imagecolorallocate($im, 255, 255, 255);

        imagefill($im, 0, 0, $bg);
        imagefilledrectangle($im, 0, 0, 760, 54, $brand);
        imagestring($im, 5, 20, 20, 'Viber  -  Ms. Rivera', $white);

        imagefilledrectangle($im, 24, 80, 600, 150, $card);
        imagestring($im, 4, 38, 96, 'Hi! Please send the revised quotation', $ink);
        imagestring($im, 4, 38, 118, 'by Friday. Board meeting is Monday.', $ink);
        imagestring($im, 3, 38, 140, '10:24 AM', $muted);

        imagefilledrectangle($im, 24, 170, 620, 250, $card);
        imagestring($im, 4, 38, 186, 'Also confirm the Calamba delivery', $ink);
        imagestring($im, 4, 38, 208, 'schedule today - it is urgent.', $ink);
        imagestring($im, 3, 38, 230, '10:26 AM', $muted);

        imagepng($im, $path);
        imagedestroy($im);

        return $path;
    }
}
