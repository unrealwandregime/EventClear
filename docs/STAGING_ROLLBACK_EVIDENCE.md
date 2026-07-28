# Staging rollback evidence

Status: **NOT RUN**

No immutable external service revision exists to roll back. A valid test must
deploy a harmless change, restore the previous ECS task-definition revisions,
and record frontend/API health, database compatibility, indexer checkpoint
continuity, unchanged contract state, UTC times and image digests.
