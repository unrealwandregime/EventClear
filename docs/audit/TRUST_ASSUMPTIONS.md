# Trust assumptions

- Reviewers correctly translate source-market rules into immutable predicates,
  worlds, time bounds and hashes.
- Polymarket CTF, collateral adapter and resolution contracts behave according
  to the verified interfaces and deployed bytecode.
- The solver proves the supplied formal model, not the real-world meaning.
- RPC providers, indexer and frontend may fail; contract state remains the
  authority.
- The KMS quote signer and administrator roles can cause bounded harm within
  configured caps; pause, separation of duties and monitoring limit exposure.
- Only verified EOA-held standard-market positions are executable in v1.
