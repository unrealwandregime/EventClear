BEGIN;

ALTER TYPE relationship_status ADD VALUE IF NOT EXISTS 'EXTRACTED';
ALTER TYPE relationship_status ADD VALUE IF NOT EXISTS 'REVIEW_REQUIRED';

CREATE TABLE wallet_capabilities (
  wallet_account_id uuid PRIMARY KEY REFERENCES wallet_accounts(id),
  can_read_positions boolean NOT NULL,
  can_approve_erc1155 boolean NOT NULL,
  can_open_bundle boolean NOT NULL,
  blocker_code text,
  observed_at timestamptz NOT NULL
);

CREATE TABLE market_rule_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  market_id uuid NOT NULL REFERENCES markets(id),
  source_uri text NOT NULL,
  content_hash text NOT NULL,
  object_storage_key text NOT NULL,
  immutable boolean NOT NULL DEFAULT true,
  observed_at timestamptz NOT NULL,
  UNIQUE(market_id, content_hash)
);

CREATE TABLE relationship_predicates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  relationship_id uuid NOT NULL REFERENCES relationship_definitions(id),
  ordinal integer NOT NULL CHECK (ordinal >= 0),
  predicate jsonb NOT NULL,
  rule_document_hash text NOT NULL,
  UNIQUE(relationship_id, ordinal)
);

CREATE TABLE relationship_versions (
  relationship_id uuid PRIMARY KEY REFERENCES relationship_definitions(id),
  definition_hash text NOT NULL UNIQUE,
  object_storage_key text NOT NULL,
  immutable boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE risk_policies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  version integer NOT NULL UNIQUE,
  policy jsonb NOT NULL,
  policy_hash text NOT NULL UNIQUE,
  active boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE risk_policy_changes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  risk_policy_id uuid NOT NULL REFERENCES risk_policies(id),
  action text NOT NULL,
  proposer text NOT NULL,
  transaction_hash text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE quote_nonces (
  chain_id integer NOT NULL,
  borrower_address text NOT NULL,
  nonce numeric(78,0) NOT NULL,
  quote_id uuid REFERENCES financing_quotes(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(chain_id, borrower_address, nonce)
);

CREATE TABLE bundle_state_changes (
  id bigserial PRIMARY KEY,
  bundle_id uuid NOT NULL REFERENCES bundles(id),
  previous_status bundle_status,
  next_status bundle_status NOT NULL,
  transaction_hash text,
  block_number numeric(78,0),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE claim_balances (
  claim_id uuid NOT NULL REFERENCES claims(id),
  owner_address text NOT NULL,
  balance_atomic numeric(78,0) NOT NULL,
  observed_at timestamptz NOT NULL,
  PRIMARY KEY(claim_id, owner_address)
);

CREATE TABLE claim_redemptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  claim_id uuid NOT NULL REFERENCES claims(id),
  owner_address text NOT NULL,
  burned_atomic numeric(78,0) NOT NULL,
  payout_atomic numeric(78,0) NOT NULL,
  transaction_hash text NOT NULL,
  log_index integer NOT NULL,
  created_at timestamptz NOT NULL,
  UNIQUE(transaction_hash, log_index)
);

CREATE TABLE funding_pool_accounts (
  owner_address text PRIMARY KEY,
  shares_atomic numeric(78,0) NOT NULL,
  assets_atomic numeric(78,0) NOT NULL,
  observed_at timestamptz NOT NULL
);

CREATE TABLE funding_pool_exposures (
  bundle_id uuid PRIMARY KEY REFERENCES bundles(id),
  wallet_address text NOT NULL,
  relationship_hash text NOT NULL,
  gross_advance_atomic numeric(78,0) NOT NULL,
  active boolean NOT NULL,
  observed_at timestamptz NOT NULL
);

CREATE TABLE settlement_allocations (
  settlement_id uuid NOT NULL REFERENCES settlements(id),
  allocation_type text NOT NULL CHECK (allocation_type IN ('PRINCIPAL','RESIDUAL')),
  amount_atomic numeric(78,0) NOT NULL,
  PRIMARY KEY(settlement_id, allocation_type)
);

CREATE TABLE treasury_transfers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source text NOT NULL,
  token_address text NOT NULL,
  recipient_address text NOT NULL,
  amount_atomic numeric(78,0) NOT NULL,
  transaction_hash text NOT NULL,
  log_index integer NOT NULL,
  created_at timestamptz NOT NULL,
  UNIQUE(transaction_hash, log_index)
);

CREATE TABLE rpc_health (
  id bigserial PRIMARY KEY,
  rpc_url_hash text NOT NULL,
  chain_id integer NOT NULL,
  latency_ms integer,
  healthy boolean NOT NULL,
  error_code text,
  observed_at timestamptz NOT NULL
);

CREATE TABLE indexer_dead_letters (
  id bigserial PRIMARY KEY,
  chain_id integer NOT NULL,
  transaction_hash text NOT NULL,
  log_index integer NOT NULL,
  event_name text,
  payload jsonb NOT NULL,
  error text NOT NULL,
  retry_count integer NOT NULL DEFAULT 0,
  next_retry_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(chain_id, transaction_hash, log_index)
);

CREATE OR REPLACE FUNCTION immutable_approved_relationship() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status IN ('APPROVED','SUSPENDED','RETIRED') AND NEW.canonical_definition IS DISTINCT FROM OLD.canonical_definition THEN
    RAISE EXCEPTION 'approved relationship versions are immutable';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER relationship_definition_immutable
BEFORE UPDATE ON relationship_definitions
FOR EACH ROW EXECUTE FUNCTION immutable_approved_relationship();

COMMIT;
