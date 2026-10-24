import assert from "node:assert/strict";
import test from "node:test";
import {blockRanges} from "../src/ranges.js";

test("catchup ranges cover every missed block exactly once and respect RPC limits",()=>{
 assert.deepEqual([...blockRanges(10n,20n,4n)],[[10n,13n],[14n,17n],[18n,20n]]);
 assert.deepEqual([...blockRanges(21n,20n,4n)],[]);
 assert.throws(()=>[...blockRanges(1n,2n,0n)],/INVALID_INDEXER_BATCH_SIZE/);
 assert.throws(()=>[...blockRanges(1n,2n,10_001n)],/INVALID_INDEXER_BATCH_SIZE/);
});
