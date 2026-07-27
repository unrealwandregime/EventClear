PNPM ?= pnpm
PYTHON ?= python

.PHONY: install dev test test-contracts test-solver test-integration fork-test lint typecheck seed deploy-local
install:
	$(PNPM) install
	$(PYTHON) -m pip install -e apps/solver -e apps/api
	cd packages/contracts && forge install OpenZeppelin/openzeppelin-contracts@v5.4.0 foundry-rs/forge-std --no-commit

dev:
	docker compose up --build

test: test-solver test-contracts
	$(PYTHON) -m pytest apps/api/tests
	$(PNPM) test

test-contracts:
	cd packages/contracts && forge test -vvv

test-solver:
	$(PYTHON) -m pytest apps/solver/tests

test-integration:
	$(PYTHON) -m pytest apps/api/tests

fork-test:
	cd packages/contracts && forge test --match-path "test/fork/*" --fork-url "$(POLYGON_RPC_URL)"

lint:
	$(PNPM) lint
	$(PYTHON) -m ruff check apps
	cd packages/contracts && forge fmt --check

typecheck:
	$(PNPM) typecheck

seed:
	$(PYTHON) scripts/seed.py

deploy-local:
	cd packages/contracts && forge script script/DeployLocal.s.sol --rpc-url http://localhost:8545 --broadcast
