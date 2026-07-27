BEGIN;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TYPE relationship_status AS ENUM ('DRAFT','REVIEW','APPROVED','SUSPENDED','RETIRED');
CREATE TYPE bundle_status AS ENUM ('ACTIVE','RESOLUTION_PENDING','SETTLED','SHORTFALL','CANCELLED');

CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE wallet_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id),
  chain_id integer NOT NULL,
  signer_address text NOT NULL,
  account_wallet_address text NOT NULL,
  wallet_type text NOT NULL CHECK (wallet_type IN ('EOA','DEPOSIT','SAFE','PROXY')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(chain_id, account_wallet_address)
);
CREATE TABLE markets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  condition_id text NOT NULL UNIQUE,
  external_market_id text NOT NULL UNIQUE,
  question text NOT NULL,
  category text NOT NULL,
  active boolean NOT NULL,
  closed boolean NOT NULL,
  end_at timestamptz,
  updated_at timestamptz NOT NULL
);
CREATE TABLE market_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  market_id uuid NOT NULL REFERENCES markets(id),
  token_id numeric(78,0) NOT NULL UNIQUE,
  outcome text NOT NULL CHECK (outcome IN ('YES','NO','OTHER'))
);
CREATE TABLE market_resolution_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  market_id uuid NOT NULL REFERENCES markets(id),
  version integer NOT NULL,
  source_uri text NOT NULL,
  content_hash text NOT NULL,
  normalized_rules jsonb NOT NULL,
  observed_at timestamptz NOT NULL,
  UNIQUE(market_id, version)
);
CREATE TABLE market_snapshots (
  id bigserial PRIMARY KEY,
  market_id uuid NOT NULL REFERENCES markets(id),
  best_bid_atomic bigint,
  best_ask_atomic bigint,
  last_trade_atomic bigint,
  sequence numeric(78,0),
  stale boolean NOT NULL DEFAULT false,
  observed_at timestamptz NOT NULL,
  UNIQUE(market_id, observed_at)
);
CREATE TABLE position_snapshots (
  id bigserial PRIMARY KEY,
  wallet_account_id uuid NOT NULL REFERENCES wallet_accounts(id),
  market_token_id uuid NOT NULL REFERENCES market_tokens(id),
  amount_atomic numeric(78,0) NOT NULL,
  current_value_atomic numeric(78,0),
  observed_at timestamptz NOT NULL,
  UNIQUE(wallet_account_id, market_token_id, observed_at)
);
CREATE TABLE relationship_definitions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  logical_id text NOT NULL,
  version integer NOT NULL,
  relationship_type text NOT NULL,
  status relationship_status NOT NULL,
  canonical_definition jsonb NOT NULL,
  canonical_definition_hash text NOT NULL UNIQUE,
  resolution_rules_hash text NOT NULL,
  approved_by text,
  approved_at timestamptz,
  valid_from timestamptz NOT NULL,
  valid_until timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(logical_id, version)
);
CREATE TABLE relationship_markets (
  relationship_id uuid NOT NULL REFERENCES relationship_definitions(id),
  market_id uuid NOT NULL REFERENCES markets(id),
  PRIMARY KEY(relationship_id, market_id)
);
CREATE TABLE relationship_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  relationship_id uuid NOT NULL REFERENCES relationship_definitions(id),
  reviewer text NOT NULL,
  decision text NOT NULL,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE solver_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  relationship_id uuid NOT NULL REFERENCES relationship_definitions(id),
  input_hash text NOT NULL,
  proof_hash text NOT NULL UNIQUE,
  guaranteed_floor_atomic numeric(78,0) NOT NULL,
  maximum_payout_atomic numeric(78,0) NOT NULL,
  solver_version text NOT NULL,
  duration_ms integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE solver_artifacts (
  proof_hash text PRIMARY KEY REFERENCES solver_runs(proof_hash),
  artifact jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE OR REPLACE FUNCTION immutable_solver_artifact() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'solver artifacts are immutable'; END $$;
CREATE TRIGGER solver_artifacts_no_update BEFORE UPDATE OR DELETE ON solver_artifacts
FOR EACH ROW EXECUTE FUNCTION immutable_solver_artifact();
CREATE TABLE financing_quotes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  wallet_account_id uuid NOT NULL REFERENCES wallet_accounts(id),
  solver_run_id uuid NOT NULL REFERENCES solver_runs(id),
  chain_id integer NOT NULL,
  vault_address text NOT NULL,
  nonce numeric(78,0) NOT NULL,
  quote jsonb NOT NULL,
  signature text NOT NULL,
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(chain_id, wallet_account_id, nonce)
);
CREATE TABLE bundles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  onchain_bundle_id numeric(78,0),
  quote_id uuid NOT NULL UNIQUE REFERENCES financing_quotes(id),
  status bundle_status NOT NULL,
  guaranteed_floor_atomic numeric(78,0) NOT NULL,
  principal_atomic numeric(78,0) NOT NULL,
  advance_atomic numeric(78,0) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  settled_at timestamptz
);
CREATE TABLE bundle_legs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bundle_id uuid NOT NULL REFERENCES bundles(id),
  condition_id text NOT NULL,
  token_id numeric(78,0) NOT NULL,
  amount_atomic numeric(78,0) NOT NULL,
  UNIQUE(bundle_id, token_id)
);
CREATE TABLE claims (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bundle_id uuid NOT NULL REFERENCES bundles(id),
  claim_type text NOT NULL CHECK (claim_type IN ('PRINCIPAL','RESIDUAL')),
  token_id numeric(78,0) NOT NULL UNIQUE,
  supply_atomic numeric(78,0) NOT NULL
);
CREATE TABLE settlements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bundle_id uuid NOT NULL UNIQUE REFERENCES bundles(id),
  proceeds_atomic numeric(78,0) NOT NULL,
  principal_allocation_atomic numeric(78,0) NOT NULL,
  residual_allocation_atomic numeric(78,0) NOT NULL,
  tx_hash text NOT NULL UNIQUE,
  settled_at timestamptz NOT NULL
);
CREATE TABLE funding_pool_snapshots (
  id bigserial PRIMARY KEY,
  total_assets_atomic numeric(78,0) NOT NULL,
  liquid_atomic numeric(78,0) NOT NULL,
  outstanding_cost_basis_atomic numeric(78,0) NOT NULL,
  realized_yield_atomic numeric(78,0) NOT NULL,
  observed_at timestamptz NOT NULL UNIQUE
);
CREATE TABLE protocol_fees (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bundle_id uuid REFERENCES bundles(id),
  source text NOT NULL,
  amount_atomic numeric(78,0) NOT NULL,
  tx_hash text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE chain_events (
  id bigserial PRIMARY KEY,
  chain_id integer NOT NULL,
  block_number numeric(78,0) NOT NULL,
  block_hash text NOT NULL,
  transaction_hash text NOT NULL,
  log_index integer NOT NULL,
  event_name text NOT NULL,
  payload jsonb NOT NULL,
  removed boolean NOT NULL DEFAULT false,
  UNIQUE(chain_id, transaction_hash, log_index)
);
CREATE TABLE indexer_checkpoints (
  chain_id integer PRIMARY KEY,
  block_number numeric(78,0) NOT NULL,
  block_hash text NOT NULL,
  updated_at timestamptz NOT NULL
);
CREATE TABLE audit_logs (
  id bigserial PRIMARY KEY,
  actor text NOT NULL,
  action text NOT NULL,
  target_type text NOT NULL,
  target_id text NOT NULL,
  correlation_id uuid,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
COMMIT;
