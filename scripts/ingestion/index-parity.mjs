function manifestMap(items) {
  return new Map(
    items.map((item) => [
      item.chunk_id,
      JSON.stringify({
        source_id: item.source_id,
        title: item.title,
        page_number: item.page_number ?? null,
      }),
    ]),
  );
}

export function manifestParityError(expected, actual, label) {
  const expectedMap = manifestMap(expected);
  const actualMap = manifestMap(actual);
  if (expectedMap.size !== actualMap.size) {
    return new Error(
      `${label} parity failed: expected ${expectedMap.size} chunks, found ${actualMap.size}`,
    );
  }
  for (const [chunkId, metadata] of expectedMap) {
    if (actualMap.get(chunkId) !== metadata) {
      return new Error(`${label} parity failed for chunk ${chunkId}`);
    }
  }
  return null;
}

export function assertManifestParity(expected, actual, label) {
  const error = manifestParityError(expected, actual, label);
  if (error) throw error;
}

export async function waitForManifestParity({
  expected,
  label,
  load,
  attempts = 9,
  initialDelayMs = 2_000,
  sleep = (delayMs) => new Promise((resolve) => setTimeout(resolve, delayMs)),
}) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const actual = await load();
    lastError = manifestParityError(expected, actual, label);
    if (!lastError) return actual;
    if (attempt < attempts) {
      await sleep(Math.min(initialDelayMs * attempt, 10_000));
    }
  }
  throw lastError;
}
