import { createPublicClient, http, parseAbiItem } from "viem";
import { polygon } from "viem/chains";
import pg from "pg";

const confirmations = BigInt(process.env.INDEXER_CONFIRMATIONS ?? "64");
const chainId = Number(process.env.CHAIN_ID ?? "137");
const rpcUrls = (process.env.POLYGON_RPC_URLS ?? "").split(",").filter(Boolean);
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const vault = process.env.VAULT_ADDRESS as `0x${string}`;

function rpcClient(index = 0) {
  if (!rpcUrls[index]) throw new Error("RPC_FAILOVER_CONFIGURED is required");
  return createPublicClient({ chain: polygon, transport: http(rpcUrls[index]) });
}

async function checkpoint() {
  const result = await pool.query("SELECT block_number FROM indexer_checkpoints WHERE chain_id=$1", [chainId]);
  return result.rowCount ? BigInt(result.rows[0].block_number) : BigInt(process.env.INDEXER_START_BLOCK ?? "0");
}

async function indexRange(fromBlock: bigint, toBlock: bigint) {
  const client = rpcClient();
  const logs = await client.getLogs({
    address: vault,
    event: parseAbiItem("event BundleOpened(uint256 indexed bundleId,address indexed accountWallet,bytes32 indexed relationshipHash)"),
    fromBlock,
    toBlock,
  });
  await pool.query("BEGIN");
  try {
    for (const log of logs) {
      await pool.query(
        `INSERT INTO chain_events(chain_id,block_number,block_hash,transaction_hash,log_index,event_name,payload)
         VALUES($1,$2,$3,$4,$5,$6,$7)
         ON CONFLICT(chain_id,transaction_hash,log_index) DO NOTHING`,
        [chainId, log.blockNumber!.toString(), log.blockHash, log.transactionHash, log.logIndex, "BundleOpened", JSON.stringify(log.args)],
      );
    }
    const block = await client.getBlock({ blockNumber: toBlock });
    await pool.query(
      `INSERT INTO indexer_checkpoints(chain_id,block_number,block_hash,updated_at) VALUES($1,$2,$3,now())
       ON CONFLICT(chain_id) DO UPDATE SET block_number=EXCLUDED.block_number,block_hash=EXCLUDED.block_hash,updated_at=now()`,
      [chainId, toBlock.toString(), block.hash],
    );
    await pool.query("COMMIT");
  } catch (error) {
    await pool.query("ROLLBACK");
    throw error;
  }
}

async function run() {
  for (;;) {
    const client = rpcClient();
    const head = await client.getBlockNumber();
    const safeHead = head > confirmations ? head - confirmations : 0n;
    const from = (await checkpoint()) + 1n;
    if (from <= safeHead) await indexRange(from, safeHead);
    await new Promise((resolve) => setTimeout(resolve, 4_000));
  }
}

async function reconcile() {
  const stored = await pool.query("SELECT count(*)::integer AS count FROM bundles WHERE onchain_bundle_id IS NOT NULL");
  console.log(JSON.stringify({ status: "ok", indexedBundles: stored.rows[0].count }));
}

const command = process.argv[2] ?? "run";
if (command === "run") await run();
else if (command === "backfill") {
  const fromFlag = process.argv.indexOf("--from-block");
  const from = BigInt(fromFlag >= 0 ? process.argv[fromFlag + 1] : "0");
  const head = await rpcClient().getBlockNumber();
  await indexRange(from, head > confirmations ? head - confirmations : 0n);
} else if (command === "reconcile") await reconcile();
else throw new Error(`Unknown command: ${command}`);
await pool.end();
