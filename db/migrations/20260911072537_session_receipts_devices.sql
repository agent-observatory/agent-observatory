ALTER TABLE atlas.sessions ADD COLUMN source text NOT NULL DEFAULT 'codex' CHECK (source IN ('codex','claude-code'));
ALTER TABLE atlas.sessions DROP CONSTRAINT sessions_owner_source_id_generation_key;
ALTER TABLE atlas.sessions ADD CONSTRAINT sessions_source_identity UNIQUE(owner,source,source_id,generation);
ALTER TABLE atlas.sessions ADD COLUMN last_received timestamptz;
-- Historical receipt time is knowable; historical snapshot completion is not.
UPDATE atlas.sessions s SET last_received=coalesce((SELECT max(b.created_at) FROM atlas.batches b WHERE b.session_id=s.id),s.first_received);
ALTER TABLE atlas.sessions ALTER COLUMN last_received SET DEFAULT now();
ALTER TABLE atlas.sessions ALTER COLUMN last_received SET NOT NULL;
ALTER TABLE atlas.sessions ADD COLUMN ingestion_complete_at timestamptz;
ALTER TABLE atlas.sessions ADD COLUMN completed_snapshot_offset bigint;
ALTER TABLE atlas.sessions ADD CONSTRAINT sessions_completion_pair CHECK ((ingestion_complete_at IS NULL) = (completed_snapshot_offset IS NULL));
ALTER TABLE atlas.devices ADD COLUMN last_seen_at timestamptz;
ALTER TABLE atlas.devices ADD COLUMN collector_version text;
ALTER TABLE atlas.devices ADD COLUMN source_types jsonb NOT NULL DEFAULT '[]';
ALTER TABLE atlas.devices ADD COLUMN paused boolean;
ALTER TABLE atlas.devices ADD COLUMN sync_status text;
ALTER TABLE atlas.devices ADD COLUMN last_sync_at timestamptz;
ALTER TABLE atlas.devices ADD COLUMN last_error_code text;
