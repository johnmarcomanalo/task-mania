-- Per-user upload accounting so the app can refuse uploads before R2 bills past the free tier.
ALTER TABLE users ADD COLUMN storage_bytes INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN storage_files INTEGER NOT NULL DEFAULT 0;
