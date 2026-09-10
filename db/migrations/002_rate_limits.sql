CREATE TABLE IF NOT EXISTS atlas.rate_limits(key text PRIMARY KEY,count integer NOT NULL,created_at timestamptz NOT NULL DEFAULT now());
ALTER TABLE atlas.rate_limits ENABLE ROW LEVEL SECURITY;
