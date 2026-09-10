ALTER TABLE atlas.jobs ADD COLUMN IF NOT EXISTS settings jsonb;
ALTER TABLE atlas.jobs ADD COLUMN IF NOT EXISTS key_cipher text;
