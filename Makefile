PNPM ?= pnpm
PYTHON ?= python

.PHONY: install dev stop reset seed test test-contracts test-solver test-api test-indexer test-e2e test-fork lint typecheck security deploy-local demo-lifecycle
install:
	$(PNPM) install
	$(PYTHON) -m pip install -e apps/solver -e apps/api
	cd packages/contracts && forge install OpenZeppelin/openzeppelin-contracts@v5.4.0 foundry-rs/forge-std --no-commit

dev:
	docker compose up --build

stop:
	docker compose down

reset:
	docker compose down --volumes
	docker compose up --build --detach

test: test-solver test-contracts test-api test-indexer
	$(PNPM) test

test-contracts:
	cd packages/contracts && forge test -vvv

test-solver:
	$(PYTHON) -m pytest apps/solver/tests

test-api:
	$(PYTHON) -m pytest apps/api/tests

test-indexer:
	$(PNPM) indexer:test

test-e2e:
	$(PNPM) test

test-fork:
	cd packages/contracts && forge test --match-path "test/fork/*" --fork-url "$(POLYGON_RPC_URL)"

lint:
	$(PNPM) lint
	$(PYTHON) -m ruff check apps
	cd packages/contracts && forge fmt --check

typecheck:
	$(PNPM) typecheck

security:
	cd packages/contracts && slither . --config-file ../../slither.config.json
	$(PNPM) audit --audit-level high

seed:
	$(PYTHON) scripts/seed.py

deploy-local:
	cd packages/contracts && forge script script/DeployLocal.s.sol --rpc-url http://localhost:8545 --broadcast
	$(PNPM) deployment:sync-local

demo-lifecycle: seed
	cd packages/contracts && forge script script/DemoLifecycle.s.sol:DemoLifecycle --rpc-url http://localhost:8545 --broadcast -vvv
