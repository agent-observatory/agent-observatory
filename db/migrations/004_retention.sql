-- Summaries survive independently for 30 days; detailed metadata does not.
ALTER TABLE atlas.summaries DROP CONSTRAINT IF EXISTS summaries_session_id_fkey;
CREATE INDEX IF NOT EXISTS batches_path ON atlas.batches(path);
CREATE INDEX IF NOT EXISTS job_items_expiry ON atlas.job_items(expires_at);
