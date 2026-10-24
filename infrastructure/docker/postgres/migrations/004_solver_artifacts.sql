BEGIN;
CREATE TABLE IF NOT EXISTS solver_artifact_blobs (
    artifact_hash text PRIMARY KEY CHECK (artifact_hash ~ '^[0-9a-f]{64}$'),
    canonical_json bytea NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE OR REPLACE FUNCTION eventclear_immutable_artifact() RETURNS trigger
LANGUAGE plpgsql AS $$ BEGIN
    RAISE EXCEPTION 'SOLVER_ARTIFACT_IMMUTABLE';
END $$;
CREATE TRIGGER solver_artifact_blobs_immutable BEFORE UPDATE OR DELETE ON solver_artifact_blobs
FOR EACH ROW EXECUTE FUNCTION eventclear_immutable_artifact();
COMMIT;
