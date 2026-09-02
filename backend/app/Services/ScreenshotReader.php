<?php

namespace App\Services;

use Anthropic\Client;
use App\Models\Task;
use Illuminate\Support\Facades\Log;

/**
 * Reads a screenshot of a message and returns the tasks inside it.
 * Shared by the scan endpoint and the `scan:check` diagnostic.
 */
class ScreenshotReader
{
    public const MODEL = 'claude-opus-5';

    /**
     * The API rejects images past roughly 5 MB. Base64 inflates a file by about
     * a third, so the raw file has to stay under ~3.7 MB; 3.5 leaves headroom.
     */
    private const MAX_UPLOAD_BYTES = 3_500_000;

    /**
     * Anthropic scales any image whose long edge passes this and bills the
     * scaled size, so shrinking below it is what actually saves tokens.
     */
    private const API_EDGE_LIMIT = 1568;

    public function configured(): bool
    {
        return (bool) config('services.anthropic.key');
    }

    /**
     * @param  string[]  $columnKeys
     * @param  string[]  $sources  Channel names the board still offers.
     * @return array{source: string, rows: array<int, array<string, mixed>>}
     */
    public function read(string $imagePath, string $mime, array $columnKeys, array $sources): array
    {
        $original = $imagePath;
        [$imagePath, $mime, $note] = $this->prepare($imagePath, $mime);

        if ($note) {
            Log::info('Screenshot resized before reading', $note);
        }

        try {
            return $this->ask($imagePath, $mime, $columnKeys, $sources);
        } finally {
            // prepare() writes a temp copy; the stored original is never touched.
            if ($imagePath !== $original) {
                @unlink($imagePath);
            }
        }
    }

    /**
     * @param  string[]  $columnKeys
     * @param  string[]  $sources
     * @return array{source: string, rows: array<int, array<string, mixed>>}
     */
    private function ask(string $imagePath, string $mime, array $columnKeys, array $sources): array
    {
        $client = new Client(apiKey: config('services.anthropic.key'));

        $message = $client->messages->create(
            model: self::MODEL,
            maxTokens: 8000,
            messages: [[
                'role' => 'user',
                'content' => [
                    [
                        'type' => 'image',
                        'source' => [
                            'type' => 'base64',
                            'media_type' => $mime,
                            'data' => base64_encode(file_get_contents($imagePath)),
                        ],
                    ],
                    ['type' => 'text', 'text' => $this->prompt($columnKeys)],
                ],
            ]],
            outputConfig: [
                'effort' => 'medium',
                'format' => ['type' => 'json_schema', 'schema' => $this->schema($columnKeys, $sources)],
            ],
        );

        $text = '';
        foreach ($message->content as $block) {
            if ($block->type === 'text') {
                $text .= $block->text;
            }
        }

        $data = json_decode($text, true, flags: JSON_THROW_ON_ERROR);

        return [
            'source' => in_array($data['source'] ?? '', $sources, true)
                ? $data['source']
                : $this->fallbackSource($sources),
            'rows' => collect($data['tasks'] ?? [])->map(fn ($t) => [
                'title' => (string) ($t['title'] ?? ''),
                'sender' => (string) ($t['sender'] ?? ''),
                'due' => $this->date((string) ($t['due'] ?? '')),
                'priority' => in_array($t['priority'] ?? '', Task::PRIORITIES, true) ? $t['priority'] : 'normal',
                'column_key' => in_array($t['column'] ?? '', $columnKeys, true) ? $t['column'] : 'inbox',
                'quote' => (string) ($t['quote'] ?? ''),
                'attachments' => (string) ($t['attachments'] ?? ''),
                'tags' => array_slice(array_values(array_filter((array) ($t['tags'] ?? []))), 0, 3),
                'confidence' => in_array($t['confidence'] ?? '', ['high', 'medium', 'low'], true) ? $t['confidence'] : 'medium',
            ])->values()->all(),
        ];
    }

    /**
     * What a task falls back to when the model names a channel the board does
     * not offer. Manual is the natural home for it; a board that archived even
     * that keeps the first source it has left.
     *
     * @param  string[]  $sources
     */
    private function fallbackSource(array $sources): string
    {
        if (in_array('Manual', $sources, true)) {
            return 'Manual';
        }

        return $sources[0] ?? 'Manual';
    }

    /**
     * Shrink an oversized screenshot before sending it.
     *
     * Two reasons, in order of importance. First, correctness: the API rejects
     * images past roughly 5 MB, and base64 inflates a file by about a third, so
     * a large PNG upload would fail outright. Second, cost: Anthropic scales any
     * image whose long edge exceeds 1568 px and bills the scaled size, so that
     * is the point below which shrinking actually saves tokens.
     *
     * The default keeps the API's own 1568 px ceiling — no quality change, just
     * no wasted upload. Lower SCAN_MAX_EDGE to trade legibility for tokens, and
     * measure the result with `php artisan scan:check` before keeping it.
     *
     * The original file on disk is never touched; this only affects the copy
     * that is sent to the model.
     *
     * @return array{0: string, 1: string, 2: array<string, mixed>|null}
     */
    private function prepare(string $path, string $mime): array
    {
        $maxEdge = (int) config('services.anthropic.max_edge', 1568);

        if (! function_exists('imagecreatefromstring')) {
            return [$path, $mime, null];
        }

        $size = @getimagesize($path);
        if (! $size) {
            return [$path, $mime, null];
        }

        [$width, $height] = $size;
        $longest = max($width, $height);
        $oversized = $longest > $maxEdge;
        $tooHeavy = filesize($path) > self::MAX_UPLOAD_BYTES;

        // Dimensions and weight are both fine: send the file untouched.
        if (! $oversized && ! $tooHeavy) {
            return [$path, $mime, null];
        }

        $source = @imagecreatefromstring((string) file_get_contents($path));
        if (! $source) {
            return [$path, $mime, null];
        }

        $scale = $oversized ? $maxEdge / $longest : 1.0;
        $targetW = max(1, (int) round($width * $scale));
        $targetH = max(1, (int) round($height * $scale));

        $resized = imagecreatetruecolor($targetW, $targetH);
        // Screenshots are flat UI, so a white matte is safer than a black one
        // if the source carries transparency.
        imagefill($resized, 0, 0, imagecolorallocate($resized, 255, 255, 255));
        imagecopyresampled($resized, $source, 0, 0, 0, 0, $targetW, $targetH, $width, $height);
        imagedestroy($source);

        $out = tempnam(sys_get_temp_dir(), 'scan_').'.png';
        imagepng($resized, $out, 6);
        $outMime = 'image/png';

        // PNG keeps text crisp, but it cannot always get a heavy image under the
        // wire limit. Fall back to JPEG, stepping quality down until it fits.
        if (filesize($out) > self::MAX_UPLOAD_BYTES) {
            foreach ([85, 70, 55] as $quality) {
                imagejpeg($resized, $out, $quality);
                $outMime = 'image/jpeg';
                if (filesize($out) <= self::MAX_UPLOAD_BYTES) {
                    break;
                }
            }
        }

        imagedestroy($resized);

        // At or above the API's own 1568 px ceiling the server would scale the
        // image to the same size anyway, so resizing here only saves upload
        // bytes — and flat UI screenshots compress so well as PNG that
        // resampling can leave a *bigger* file. There, keep whichever is
        // smaller. Below 1568 the caller is deliberately buying fewer billed
        // tokens, so the resized copy must win whatever it weighs.
        $bandwidthOnly = $maxEdge >= self::API_EDGE_LIMIT;

        if ($bandwidthOnly && filesize($out) >= filesize($path) && ! $tooHeavy) {
            @unlink($out);

            return [$path, $mime, null];
        }

        return [$out, $outMime, [
            'from' => $width.'x'.$height,
            'to' => $targetW.'x'.$targetH,
            'bytes_before' => filesize($path),
            'bytes_after' => filesize($out),
            'mime' => $outMime,
            'approx_tokens' => (int) round(($targetW * $targetH) / 750),
        ]];
    }

    /** Keep only a well-formed Y-m-d; the model is asked for that shape but may miss. */
    private function date(string $value): string
    {
        return preg_match('/^\d{4}-\d{2}-\d{2}$/', $value) === 1 ? $value : '';
    }

    private function prompt(array $columnKeys): string
    {
        return 'This is a screenshot of a message or email the user received. '
            .'Extract the actionable tasks it asks of the reader.'."\n\n"
            .'Rules:'."\n"
            .'- The title is short and imperative, written in the language of the message.'."\n"
            .'- The quote is a verbatim excerpt from the message that justifies the task.'."\n"
            .'- Leave due blank unless the message states or clearly implies a deadline.'."\n"
            .'- Use the "inbox" column unless the message clearly implies another.'."\n"
            .'- attachments names any file the message refers to, else blank.'."\n"
            .'- Return an empty tasks array if nothing actionable is present.'."\n"
            .'- Available columns: '.implode(', ', $columnKeys).'.'."\n"
            .'- Today is '.now()->toDateString().'.';
    }

    private function schema(array $columnKeys, array $sources): array
    {
        return [
            'type' => 'object',
            'properties' => [
                'source' => ['type' => 'string', 'enum' => $sources],
                'tasks' => [
                    'type' => 'array',
                    'items' => [
                        'type' => 'object',
                        'properties' => [
                            'title' => ['type' => 'string'],
                            'sender' => ['type' => 'string'],
                            'due' => ['type' => 'string', 'description' => 'YYYY-MM-DD, or empty string'],
                            'priority' => ['type' => 'string', 'enum' => Task::PRIORITIES],
                            'quote' => ['type' => 'string'],
                            'attachments' => ['type' => 'string'],
                            'column' => ['type' => 'string', 'enum' => $columnKeys],
                            'confidence' => ['type' => 'string', 'enum' => ['high', 'medium', 'low']],
                            'tags' => ['type' => 'array', 'items' => ['type' => 'string']],
                        ],
                        'required' => ['title', 'sender', 'due', 'priority', 'quote', 'attachments', 'column', 'confidence', 'tags'],
                        'additionalProperties' => false,
                    ],
                ],
            ],
            'required' => ['source', 'tasks'],
            'additionalProperties' => false,
        ];
    }
}
