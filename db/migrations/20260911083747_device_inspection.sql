ALTER TABLE atlas.devices ADD COLUMN IF NOT EXISTS control_seen_at timestamptz;
CREATE TABLE atlas.device_inspections (
  device_id uuid PRIMARY KEY REFERENCES atlas.devices(id) ON DELETE CASCADE,
  request_id uuid NOT NULL UNIQUE,
  status text NOT NULL CHECK (status IN ('pending','complete','failed')),
  snapshot jsonb,
  expires_at timestamptz NOT NULL
);
ALTER TABLE atlas.device_inspections ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON atlas.device_inspections FROM anon, authenticated;
