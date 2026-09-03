-- Task Mania schema. Timestamps are ISO-8601 UTC text; dates are YYYY-MM-DD.
-- MySQL's default collation is case-insensitive, so source names keep that
-- behaviour here with COLLATE NOCASE.

CREATE TABLE users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  email         TEXT NOT NULL UNIQUE,
  name          TEXT,
  created_at    TEXT NOT NULL,
  last_seen_at  TEXT NOT NULL
);

CREATE TABLE boards (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  slug        TEXT NOT NULL UNIQUE,
  description TEXT,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);

CREATE TABLE board_columns (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  board_id   INTEGER NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
  key        TEXT NOT NULL,
  name       TEXT NOT NULL,
  position   INTEGER NOT NULL DEFAULT 0,
  is_done    INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (board_id, key)
);
CREATE INDEX board_columns_board_position ON board_columns (board_id, position);

CREATE TABLE sources (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  board_id    INTEGER NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
  name        TEXT NOT NULL COLLATE NOCASE,
  position    INTEGER NOT NULL DEFAULT 0,
  is_archived INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL,
  UNIQUE (board_id, name)
);
CREATE INDEX sources_board_position ON sources (board_id, position);

CREATE TABLE tasks (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  board_id         INTEGER NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
  board_column_id  INTEGER NOT NULL REFERENCES board_columns(id) ON DELETE CASCADE,
  title            TEXT NOT NULL,
  source           TEXT NOT NULL DEFAULT 'Manual' COLLATE NOCASE,
  sender           TEXT,
  due_date         TEXT,
  priority         TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('high','normal','low')),
  quote            TEXT,
  attachments_note TEXT,
  tags             TEXT,
  screenshot_path  TEXT,
  captured_on      TEXT,
  done_on          TEXT,
  position         INTEGER NOT NULL DEFAULT 0,
  created_at       TEXT NOT NULL,
  updated_at       TEXT NOT NULL
);
CREATE INDEX tasks_column_position ON tasks (board_column_id, position);
CREATE INDEX tasks_board_due       ON tasks (board_id, due_date);
CREATE INDEX tasks_board_done      ON tasks (board_id, done_on);

CREATE TABLE task_files (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id    INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  mime       TEXT,
  size       INTEGER NOT NULL DEFAULT 0,
  path       TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE activities (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  board_id   INTEGER NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
  task_id    INTEGER REFERENCES tasks(id) ON DELETE SET NULL,
  text       TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX activities_board_created ON activities (board_id, created_at);
CREATE INDEX activities_task_created  ON activities (task_id, created_at);
