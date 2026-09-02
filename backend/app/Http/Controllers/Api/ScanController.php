<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Board;
use App\Services\ScreenshotReader;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Storage;
use Throwable;

/**
 * Reads a screenshot of a message (Viber, email, Teams…) and proposes the tasks
 * inside it. The screenshot is stored whether or not the read succeeds, so a
 * failed scan still leaves the user something to work from.
 */
class ScanController extends Controller
{
    public function __construct(private readonly ScreenshotReader $reader) {}

    public function __invoke(Request $request, Board $board): JsonResponse
    {
        $request->validate([
            'image' => ['required', 'file', 'image', 'mimes:png,jpg,jpeg,gif,webp', 'max:10240'],
        ]);

        $file = $request->file('image');
        $path = $file->store('screenshots', 'public');

        $shot = ['path' => $path, 'url' => Storage::disk('public')->url($path)];

        // Automatic reading is optional. Without it this is a capture-and-type
        // flow, which is a complete way to work — not a degraded one — so it
        // says nothing about configuration.
        if (! $this->reader->configured()) {
            return response()->json([
                'screenshot' => $shot,
                'source' => 'Manual',
                'rows' => [],
                'error' => null,
                'manual' => true,
            ]);
        }

        try {
            $parsed = $this->reader->read(
                $file->getRealPath(),
                $file->getClientMimeType(),
                $board->columns->pluck('key')->all(),
                $board->sources()->active()->pluck('name')->all(),
            );
        } catch (Throwable $e) {
            Log::warning('Screenshot scan failed', ['board' => $board->slug, 'error' => $e->getMessage()]);

            return response()->json([
                'screenshot' => $shot,
                'source' => 'Manual',
                'rows' => [],
                'manual' => false,
                'error' => 'The image could not be scanned ('.$this->reason($e).'). '
                    .'Fill the fields in manually — the screenshot is already stored for traceability.',
            ]);
        }

        return response()->json([
            'screenshot' => $shot,
            'source' => $parsed['source'],
            'rows' => $parsed['rows'],
            'error' => null,
            'manual' => false,
        ]);
    }

    /** Turn SDK exceptions into something a user can act on. */
    private function reason(Throwable $e): string
    {
        $message = $e->getMessage();

        return match (true) {
            str_contains($message, 'authentication_error') => 'the API key was rejected',
            str_contains($message, 'permission_error') => 'the API key lacks access to this model',
            str_contains($message, 'rate_limit') => 'rate limited, try again shortly',
            str_contains($message, 'credit') || str_contains($message, 'billing') => 'the account has no credit',
            str_contains($message, 'Connection Error') => 'could not reach api.anthropic.com',
            default => class_basename($e),
        };
    }
}
