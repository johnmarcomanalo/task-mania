<?php

use App\Http\Controllers\Api\BoardController;
use App\Http\Controllers\Api\ScanController;
use App\Http\Controllers\Api\SourceController;
use App\Http\Controllers\Api\TaskController;
use Illuminate\Support\Facades\Route;

Route::get('boards', [BoardController::class, 'index']);
Route::get('boards/{board}', [BoardController::class, 'show']);
Route::get('boards/{board}/activity', [BoardController::class, 'activity']);

Route::get('boards/{board}/sources', [SourceController::class, 'index']);
Route::post('boards/{board}/sources', [SourceController::class, 'store']);
Route::patch('sources/{source}', [SourceController::class, 'update']);
Route::delete('sources/{source}', [SourceController::class, 'destroy']);

Route::post('boards/{board}/tasks', [TaskController::class, 'store']);
Route::post('boards/{board}/tasks/bulk', [TaskController::class, 'bulk']);

// Reads a screenshot and proposes tasks; stores the image either way.
Route::post('boards/{board}/scan', ScanController::class);

Route::patch('tasks/{task}', [TaskController::class, 'update']);
Route::patch('tasks/{task}/move', [TaskController::class, 'move']);
Route::delete('tasks/{task}', [TaskController::class, 'destroy']);

Route::post('tasks/{task}/files', [TaskController::class, 'attach']);
Route::delete('task-files/{file}', [TaskController::class, 'detach']);
