-- A seventh, terminal lane for tasks that will not happen: same shape as
-- Done (is_done/done_on) but its own flag and date, never streak credit.
ALTER TABLE board_columns ADD COLUMN is_cancelled INTEGER NOT NULL DEFAULT 0;
ALTER TABLE tasks ADD COLUMN cancelled_on TEXT;
-- Every existing board gets the lane at the end.
INSERT INTO board_columns (board_id, key, name, position, is_done, is_cancelled, created_at, updated_at)
SELECT b.id, 'cancelled', 'Cancelled',
       (SELECT COALESCE(MAX(c.position), -1) + 1 FROM board_columns c WHERE c.board_id = b.id),
       0, 1, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
FROM boards b
WHERE NOT EXISTS (SELECT 1 FROM board_columns c WHERE c.board_id = b.id AND c.key = 'cancelled');
