PNPM ?= pnpm
PYTHON ?= python

.PHONY: install dev stop reset seed test test-contracts test-api-contract-integration test-solver test-api test-indexer test-e2e test-fork lint typecheck security deploy-local demo-lifecycle
install:
	$(PNPM) install
	$(PYTHON) -m pip install -e apps/solver -e apps/api pytest
	cd packages/contracts && forge install OpenZeppelin/openzeppelin-contracts@v5.4.0 foundry-rs/forge-std --no-git

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
	$(PYTHON) scripts/check_api_abi.py
	cd packages/contracts && forge test --no-match-path "test/fork/*" -vvv

test-solver:
	$(PYTHON) -m pytest apps/solver/tests

test-api:
	$(PYTHON) -m pytest apps/api/tests

test-api-contract-integration:
	bash scripts/test-api-contract-integration.sh

test-indexer:
	$(PNPM) indexer:test

test-e2e:
	$(PNPM) test

test-fork:
	cd packages/contracts && forge test --match-path "test/fork/*" --fork-url "$(POLYGON_RPC_URL)" --fork-block-number 90963627

lint:
	$(PNPM) lint
	$(PYTHON) -m ruff check apps
	cd packages/contracts && forge fmt --check

typecheck:
	$(PNPM) typecheck

security:
	cd packages/contracts && slither . --config-file ../../slither.config.json
	$(PNPM) security:dependencies
	$(PNPM) security:licenses

seed:
	$(PYTHON) scripts/seed.py

deploy-local:
	cd packages/contracts && forge script script/DeployLocal.s.sol --rpc-url http://localhost:8545 --broadcast
	$(PNPM) deployment:sync-local

demo-lifecycle: seed
	cd packages/contracts && forge script script/DemoLifecycle.s.sol:DemoLifecycle --rpc-url http://localhost:8545 --broadcast -vvv
