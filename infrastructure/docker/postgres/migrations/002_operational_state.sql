BEGIN;

-- CQRS payloads used for low-latency API reads. Canonical accounting remains
-- in the normalized protocol tables from 001_initial.sql.
CREATE TABLE api_read_models (
  kind text NOT NULL,
  key text NOT NULL,
  payload jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(kind, key)
);

CREATE TABLE api_counters (
  name text PRIMARY KEY,
  value numeric(78,0) NOT NULL CHECK (value > 0)
);
INSERT INTO api_counters(name, value) VALUES ('quote_nonce', 1);

-- Raw SIWE nonces and bearer tokens are never persisted.
CREATE TABLE auth_nonces (
  nonce_hash text PRIMARY KEY,
  expires_at timestamptz NOT NULL,
  used_at timestamptz
);
CREATE INDEX auth_nonces_expiry_idx ON auth_nonces(expires_at);

CREATE TABLE auth_sessions (
  token_hash text PRIMARY KEY,
  address text NOT NULL,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz
);
CREATE INDEX auth_sessions_expiry_idx ON auth_sessions(expires_at);

COMMIT;
