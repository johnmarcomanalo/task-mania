-- A repeat rule (JSON) makes the task spawn its next occurrence when it is completed.
ALTER TABLE tasks ADD COLUMN repeat TEXT;
