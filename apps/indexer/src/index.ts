import {
  createPublicClient,
  decodeEventLog,
  http,
  parseAbi,
  type Hex,
  type Log,
} from "viem";
import { polygon } from "viem/chains";
import pg from "pg";
import { pathToFileURL } from "node:url";
import { rebuildProjection, type IndexedEvent } from "./projection.js";

const confirmations = BigInt(process.env.INDEXER_CONFIRMATIONS ?? "64");
const chainId = Number(process.env.CHAIN_ID ?? "137");
const rpcUrls = (process.env.POLYGON_RPC_URLS ?? "").split(",").map((value) => value.trim()).filter(Boolean);
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const addresses = [
  process.env.VAULT_ADDRESS,
  process.env.RELATIONSHIP_REGISTRY_ADDRESS,
  process.env.FUNDING_POOL_ADDRESS,
  process.env.CLAIMS_ADDRESS,
  process.env.TREASURY_ADDRESS,
  process.env.RISK_POLICY_ADDRESS,
].filter(Boolean) as `0x${string}`[];

export const protocolAbi = parseAbi([
  "event RelationshipRegistered(bytes32 indexed definitionHash,uint32 version,bytes32 ruleDocumentHash)",
  "event RelationshipStatusChanged(bytes32 indexed definitionHash,uint8 status)",
  "event BundleOpened(uint256 indexed bundleId,address indexed positionWallet,bytes32 indexed relationshipHash)",
  "event PositionsEscrowed(uint256 indexed bundleId,bytes32[] conditionIds,uint256[] tokenIds,uint256[] amounts)",
  "event AdvanceFunded(uint256 indexed bundleId,uint256 grossAdvance,uint256 originationFee,uint256 netAdvance)",
  "event ClaimsMinted(uint256 indexed bundleId,uint256 principalSupply,uint256 residualSupply)",
  "event SettlementStarted(uint256 indexed bundleId)",
  "event PositionsRedeemed(uint256 indexed bundleId,uint256 proceeds)",
  "event BundleSettled(uint256 indexed bundleId,uint256 principalAllocation,uint256 residualAllocation)",
  "event BundleShortfall(uint256 indexed bundleId,uint256 principal,uint256 proceeds)",
  "event PrincipalClaimed(uint256 indexed bundleId,address indexed account,uint256 claimsBurned,uint256 payout)",
  "event ResidualClaimed(uint256 indexed bundleId,address indexed account,uint256 claimsBurned,uint256 payout)",
  "event PrincipalSettled(uint256 indexed bundleId,uint256 principalReceived,uint256 realizedNetYield,uint256 protocolFee)",
  "event OriginationFeeSettled(uint256 indexed bundleId,uint256 quotedFee,uint256 realizedFee,uint256 refundedFee)",
  "event FeeRecorded(bytes32 indexed source,uint256 amount)",
  "event Deposit(address indexed sender,address indexed owner,uint256 assets,uint256 shares)",
  "event Withdraw(address indexed sender,address indexed receiver,address indexed owner,uint256 assets,uint256 shares)",
  "event TransferSingle(address indexed operator,address indexed from,address indexed to,uint256 id,uint256 value)",
  "event TransferBatch(address indexed operator,address indexed from,address indexed to,uint256[] ids,uint256[] values)",
  "event Paused(address account)",
  "event Unpaused(address account)",
  "event RoleGranted(bytes32 indexed role,address indexed account,address indexed sender)",
  "event RoleRevoked(bytes32 indexed role,address indexed account,address indexed sender)",
  "event LimitsUpdated(uint16 maximumAdvanceRatioBps,uint64 maximumBundleDuration,uint256 maximumGrossAdvance,uint256 perWalletExposureCap,uint256 perMarketExposureCap,uint256 perRelationshipExposureCap,uint256 globalExposureCap)",
  "event QuoteSignerUpdated(address indexed signer)",
  "event OriginationsPauseUpdated(bool paused)",
]);

const stringify = (value: unknown) =>
  JSON.stringify(value, (_, item) => (typeof item === "bigint" ? item.toString() : item));

function rpcClient(index: number) {
  if (!rpcUrls[index]) throw new Error("RPC_FAILOVER_CONFIGURED");
  return createPublicClient({ chain: polygon, transport: http(rpcUrls[index], { timeout: 15_000 }) });
}

async function withRpc<T>(operation: (client: ReturnType<typeof rpcClient>) => Promise<T>): Promise<T> {
  let lastError: unknown;
  for (let index = 0; index < rpcUrls.length; index++) {
    const started = Date.now();
    try {
      const result = await operation(rpcClient(index));
      await pool.query(
        "INSERT INTO rpc_health(rpc_url_hash,chain_id,latency_ms,healthy,observed_at) VALUES(md5($1),$2,$3,true,now())",
        [rpcUrls[index], chainId, Date.now() - started],
      );
      return result;
    } catch (error) {
      lastError = error;
      await pool.query(
        "INSERT INTO rpc_health(rpc_url_hash,chain_id,latency_ms,healthy,error_code,observed_at) VALUES(md5($1),$2,$3,false,$4,now())",
        [rpcUrls[index], chainId, Date.now() - started, error instanceof Error ? error.name : "UNKNOWN"],
      );
    }
  }
  throw lastError;
}

type Checkpoint = { blockNumber: bigint; blockHash: Hex } | null;

async function checkpoint(): Promise<Checkpoint> {
  const result = await pool.query("SELECT block_number,block_hash FROM indexer_checkpoints WHERE chain_id=$1", [chainId]);
  return result.rowCount
    ? { blockNumber: BigInt(result.rows[0].block_number), blockHash: result.rows[0].block_hash as Hex }
    : null;
}

export function decodeProtocolLog(log: Pick<Log, "data" | "topics">) {
  return decodeEventLog({ abi: protocolAbi, data: log.data, topics: log.topics, strict: false });
}

async function ensureCanonicalCheckpoint(): Promise<bigint> {
  const stored = await checkpoint();
  if (!stored) return BigInt(process.env.INDEXER_START_BLOCK ?? "0");
  const current = await withRpc((client) => client.getBlock({ blockNumber: stored.blockNumber }));
  if (current.hash === stored.blockHash) return stored.blockNumber;

  const rollbackTo = stored.blockNumber > confirmations ? stored.blockNumber - confirmations : 0n;
  const canonical = await withRpc((client) => client.getBlock({ blockNumber: rollbackTo }));
  const database = await pool.connect();
  try {
    await database.query("BEGIN");
    await database.query(
      "UPDATE chain_events SET removed=true WHERE chain_id=$1 AND block_number>$2",
      [chainId, rollbackTo.toString()],
    );
    await database.query(
      `INSERT INTO indexer_checkpoints(chain_id,block_number,block_hash,updated_at)
       VALUES($1,$2,$3,now())
       ON CONFLICT(chain_id) DO UPDATE SET block_number=EXCLUDED.block_number,block_hash=EXCLUDED.block_hash,updated_at=now()`,
      [chainId, rollbackTo.toString(), canonical.hash],
    );
    await rebuildReadModels(database);
    await database.query("COMMIT");
  } catch (error) {
    await database.query("ROLLBACK");
    throw error;
  } finally {
    database.release();
  }
  return rollbackTo;
}

async function rebuildReadModels(database: pg.PoolClient) {
  const result = await database.query(
    `SELECT block_number,transaction_hash,log_index,event_name,payload,removed
     FROM chain_events WHERE chain_id=$1 ORDER BY block_number,log_index`,
    [chainId],
  );
  const events: IndexedEvent[] = result.rows.map((row) => ({
    chainId,
    blockNumber: BigInt(row.block_number),
    transactionHash: row.transaction_hash,
    logIndex: Number(row.log_index),
    eventName: row.event_name,
    payload: row.payload,
    removed: Boolean(row.removed),
  }));
  const projection = rebuildProjection(events);
  const ctfAddress = process.env.CTF_ADDRESS as `0x${string}` | undefined;
  if (ctfAddress) {
    for (const bundle of projection.bundles.values()) {
      const conditionIds = (bundle.conditionIds as Hex[] | undefined) ?? [];
      if (!conditionIds.length || bundle.status !== "ACTIVE") continue;
      const denominators = await Promise.all(
        conditionIds.map((conditionId) =>
          withRpc((client) =>
            client.readContract({
              address: ctfAddress,
              abi: parseAbi(["function payoutDenominator(bytes32) view returns (uint256)"]),
              functionName: "payoutDenominator",
              args: [conditionId],
            })
          )
        ),
      );
      bundle.conditionsResolved = denominators.every((value) => value !== 0n);
      bundle.unresolvedConditions = conditionIds.filter((_, index) => denominators[index] === 0n);
    }
  }
  const fundingPoolAddress = process.env.FUNDING_POOL_ADDRESS as `0x${string}` | undefined;
  if (fundingPoolAddress) {
    for (const [owner, account] of projection.poolAccounts) {
      account.availableWithdrawalAtomic = (
        await withRpc((client) =>
          client.readContract({
            address: fundingPoolAddress,
            abi: parseAbi(["function maxWithdraw(address) view returns (uint256)"]),
            functionName: "maxWithdraw",
            args: [owner as `0x${string}`],
          })
        )
      ).toString();
    }
  }
  await database.query(
    "DELETE FROM api_read_models WHERE kind IN ('bundle','claim','event','pool_state','pool_account')",
  );
  for (const [rawId, bundle] of projection.bundles) {
    const key = `EC-${rawId.padStart(5, "0")}`;
    const payload = { ...bundle, id: key, onchainBundleId: rawId };
    await database.query(
      "INSERT INTO api_read_models(kind,key,payload) VALUES('bundle',$1,$2::jsonb)",
      [key, stringify(payload)],
    );
  }
  for (const [key, claim] of projection.claims) {
    await database.query(
      "INSERT INTO api_read_models(kind,key,payload) VALUES('claim',$1,$2::jsonb)",
      [key, stringify(claim)],
    );
  }
  for (const [key, event] of projection.protocolEvents) {
    await database.query(
      "INSERT INTO api_read_models(kind,key,payload) VALUES('event',$1,$2::jsonb)",
      [key, stringify(event)],
    );
  }
  for (const [key, account] of projection.poolAccounts) {
    await database.query(
      "INSERT INTO api_read_models(kind,key,payload) VALUES('pool_account',$1,$2::jsonb)",
      [key, stringify(account)],
    );
  }
  await database.query(
    "INSERT INTO api_read_models(kind,key,payload) VALUES('pool_state','current',$1::jsonb)",
    [stringify(projection.pool)],
  );
}

async function persistLog(database: pg.PoolClient, log: Log) {
  try {
    const decoded = decodeProtocolLog(log);
    await database.query(
      `INSERT INTO chain_events(chain_id,block_number,block_hash,transaction_hash,log_index,event_name,payload,removed)
       VALUES($1,$2,$3,$4,$5,$6,$7,false)
       ON CONFLICT(chain_id,transaction_hash,log_index)
       DO UPDATE SET block_hash=EXCLUDED.block_hash,payload=EXCLUDED.payload,removed=false`,
      [
        chainId,
        log.blockNumber!.toString(),
        log.blockHash,
        log.transactionHash,
        log.logIndex,
        decoded.eventName,
        stringify(decoded.args),
      ],
    );
  } catch (error) {
    await database.query(
      `INSERT INTO indexer_dead_letters(chain_id,transaction_hash,log_index,payload,error)
       VALUES($1,$2,$3,$4,$5)
       ON CONFLICT(chain_id,transaction_hash,log_index)
       DO UPDATE SET retry_count=indexer_dead_letters.retry_count+1,error=EXCLUDED.error,next_retry_at=now()+interval '1 minute'`,
      [chainId, log.transactionHash, log.logIndex, stringify(log), String(error)],
    );
  }
}

async function indexRange(fromBlock: bigint, toBlock: bigint) {
  if (!addresses.length) throw new Error("INDEXER_CONTRACT_ADDRESSES_REQUIRED");
  const logs = await withRpc((client) => client.getLogs({ address: addresses, fromBlock, toBlock }));
  const database = await pool.connect();
  try {
    await database.query("BEGIN");
    for (const log of logs) await persistLog(database, log);
    await rebuildReadModels(database);
    const block = await withRpc((client) => client.getBlock({ blockNumber: toBlock }));
    await database.query(
      `INSERT INTO indexer_checkpoints(chain_id,block_number,block_hash,updated_at) VALUES($1,$2,$3,now())
       ON CONFLICT(chain_id) DO UPDATE SET block_number=EXCLUDED.block_number,block_hash=EXCLUDED.block_hash,updated_at=now()`,
      [chainId, toBlock.toString(), block.hash],
    );
    await database.query("COMMIT");
  } catch (error) {
    await database.query("ROLLBACK");
    throw error;
  } finally {
    database.release();
  }
}

async function safeHead() {
  const head = await withRpc((client) => client.getBlockNumber());
  return head > confirmations ? head - confirmations : 0n;
}

async function run() {
  for (;;) {
    const from = (await ensureCanonicalCheckpoint()) + 1n;
    const head = await safeHead();
    if (from <= head) await indexRange(from, head);
    await new Promise((resolve) => setTimeout(resolve, 4_000));
  }
}

async function reconcile() {
  const [events, bundles, deadLetters] = await Promise.all([
    pool.query("SELECT count(*)::integer AS count FROM chain_events WHERE chain_id=$1 AND removed=false", [chainId]),
    pool.query("SELECT count(*)::integer AS count FROM bundles WHERE onchain_bundle_id IS NOT NULL"),
    pool.query("SELECT count(*)::integer AS count FROM indexer_dead_letters"),
  ]);
  console.log(stringify({
    status: deadLetters.rows[0].count === 0 ? "ok" : "degraded",
    indexedEvents: events.rows[0].count,
    indexedBundles: bundles.rows[0].count,
    deadLetters: deadLetters.rows[0].count,
  }));
}

async function status() {
  const stored = await checkpoint();
  const head = await safeHead();
  console.log(stringify({
    chainId,
    checkpoint: stored?.blockNumber ?? null,
    safeHead: head,
    lag: stored ? head - stored.blockNumber : head,
    rpcProviders: rpcUrls.length,
  }));
}

export async function main(args = process.argv.slice(2)) {
  const command = args[0] ?? "run";
  if (command === "run") await run();
  else if (command === "backfill") {
    const fromFlag = args.indexOf("--from-block");
    const from = BigInt(fromFlag >= 0 ? args[fromFlag + 1] : "0");
    await indexRange(from, await safeHead());
  } else if (command === "reconcile") await reconcile();
  else if (command === "status") await status();
  else throw new Error(`Unknown command: ${command}`);
  await pool.end();
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
