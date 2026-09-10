CREATE SCHEMA IF NOT EXISTS atlas;
REVOKE ALL ON SCHEMA atlas FROM public, anon, authenticated;
CREATE TABLE IF NOT EXISTS atlas.users (
 id text PRIMARY KEY, name text NOT NULL, guest boolean NOT NULL DEFAULT false,
 settings jsonb NOT NULL DEFAULT '{"language":"ko","theme":"dark","masking":true,"provider":"zai","model":"glm-4.7-flash","endpoint":"https://api.z.ai/api/paas/v4"}',
 key_cipher text, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS atlas.devices (
 id uuid PRIMARY KEY, owner text REFERENCES atlas.users(id) ON DELETE CASCADE, token_hash text UNIQUE, revoked boolean NOT NULL DEFAULT false,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS atlas.pairings (
 code_hash text PRIMARY KEY, user_code text UNIQUE NOT NULL, device_id uuid REFERENCES atlas.devices(id) ON DELETE CASCADE,
 expires_at timestamptz NOT NULL, approved boolean NOT NULL DEFAULT false, claimed boolean NOT NULL DEFAULT false
);
CREATE TABLE IF NOT EXISTS atlas.sessions (
 id uuid PRIMARY KEY, owner text NOT NULL REFERENCES atlas.users(id) ON DELETE CASCADE, source_id text NOT NULL,
 generation text NOT NULL, project text NOT NULL, revision integer NOT NULL DEFAULT 0, offset_bytes bigint NOT NULL DEFAULT 0,
 first_received timestamptz NOT NULL DEFAULT now(), expires_at timestamptz NOT NULL DEFAULT now()+interval '7 days',
 deleted boolean NOT NULL DEFAULT false, UNIQUE(owner,source_id,generation)
);
CREATE INDEX IF NOT EXISTS sessions_owner ON atlas.sessions(owner,expires_at);
CREATE TABLE IF NOT EXISTS atlas.batches (
 id uuid NOT NULL, owner text NOT NULL REFERENCES atlas.users(id) ON DELETE CASCADE, session_id uuid NOT NULL REFERENCES atlas.sessions(id),
 received_hash text NOT NULL, stored_hash text NOT NULL, path text NOT NULL, bytes integer NOT NULL, end_offset bigint NOT NULL,
 masking boolean NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), purged boolean NOT NULL DEFAULT false, PRIMARY KEY(owner,id)
);
CREATE INDEX IF NOT EXISTS batches_session ON atlas.batches(session_id,created_at);
CREATE TABLE IF NOT EXISTS atlas.jobs (
 id uuid PRIMARY KEY, owner text NOT NULL REFERENCES atlas.users(id) ON DELETE CASCADE, request_key text NOT NULL,
 scope text NOT NULL, status text NOT NULL DEFAULT 'queued', run_id text, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(owner,request_key)
);
CREATE TABLE IF NOT EXISTS atlas.job_items (
 id uuid PRIMARY KEY, job_id uuid NOT NULL REFERENCES atlas.jobs(id) ON DELETE CASCADE, session_id uuid NOT NULL REFERENCES atlas.sessions(id),
 revision integer NOT NULL, batch_ids jsonb NOT NULL, status text NOT NULL DEFAULT 'queued', result jsonb,
 attempts integer NOT NULL DEFAULT 0, expires_at timestamptz NOT NULL, error text, UNIQUE(job_id,session_id)
);
CREATE TABLE IF NOT EXISTS atlas.summaries (
 session_id uuid PRIMARY KEY REFERENCES atlas.sessions(id), owner text NOT NULL REFERENCES atlas.users(id), metrics jsonb NOT NULL,
 candidate_count integer NOT NULL, expires_at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS atlas.leases (key text PRIMARY KEY, holder text NOT NULL, expires_at timestamptz NOT NULL);
CREATE TABLE IF NOT EXISTS atlas.schedule_runs (key text PRIMARY KEY, created_at timestamptz NOT NULL DEFAULT now());
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['users','devices','pairings','sessions','batches','jobs','job_items','summaries','leases','schedule_runs'] LOOP
  EXECUTE format('ALTER TABLE atlas.%I ENABLE ROW LEVEL SECURITY',t);
 END LOOP;
END $$;
