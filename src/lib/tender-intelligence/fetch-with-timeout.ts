export type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;

export async function fetchWithTimeout(
  fetcher: FetchLike,
  input: string | URL,
  init: RequestInit = {},
  timeoutMilliseconds = 25_000,
) {
  const controller = new AbortController();
  const timeout = setTimeout(() => {
    controller.abort(new DOMException(
      `Request timed out after ${timeoutMilliseconds}ms.`,
      "TimeoutError",
    ));
  }, Math.max(1, timeoutMilliseconds));

  try {
    return await fetcher(input, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}
