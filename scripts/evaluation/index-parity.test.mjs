import assert from "node:assert/strict";
import test from "node:test";

import {
  assertManifestParity,
  waitForManifestParity,
} from "../ingestion/index-parity.mjs";

const expected = [
  { chunk_id: "a", source_id: "source-a", title: "A", page_number: 1 },
  { chunk_id: "b", source_id: "source-b", title: "B", page_number: 2 },
];

test("manifest parity remains strict", () => {
  assert.throws(
    () => assertManifestParity(expected, expected.slice(0, 1), "v2 target"),
    /expected 2 chunks, found 1/,
  );
  assert.doesNotThrow(() => assertManifestParity(expected, [...expected], "v2 target"));
});

test("target parity waits for Azure Search indexing consistency", async () => {
  let reads = 0;
  const delays = [];
  const actual = await waitForManifestParity({
    expected,
    label: "v2 target",
    load: async () => {
      reads += 1;
      return reads < 3 ? expected.slice(0, 1) : [...expected];
    },
    attempts: 4,
    initialDelayMs: 5,
    sleep: async (delayMs) => delays.push(delayMs),
  });

  assert.equal(reads, 3);
  assert.deepEqual(delays, [5, 10]);
  assert.deepEqual(actual, expected);
});

test("target parity still fails closed after bounded retries", async () => {
  let reads = 0;
  await assert.rejects(
    waitForManifestParity({
      expected,
      label: "v2 target",
      load: async () => {
        reads += 1;
        return expected.slice(0, 1);
      },
      attempts: 3,
      initialDelayMs: 1,
      sleep: async () => {},
    }),
    /expected 2 chunks, found 1/,
  );
  assert.equal(reads, 3);
});
