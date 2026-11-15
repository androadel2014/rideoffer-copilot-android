/**
 * The ONLY module in the app that performs network I/O.
 * It is imported solely by src/sync/syncService.ts and every request still passes
 * through the global network gate (src/net/networkGate.ts).
 */
export interface PostResult {
  status: number;
  ok: boolean;
}

export async function postJson(
  url: string,
  body: unknown,
  headers: Record<string, string>,
  timeoutMs = 20_000
): Promise<PostResult> {
  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...headers },
      body: JSON.stringify(body),
      signal: controller?.signal,
    });
    return { status: res.status, ok: res.ok };
  } finally {
    if (timer) clearTimeout(timer);
  }
}
