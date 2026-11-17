/**
 * NETWORK GATE — makes "sync OFF ⇒ zero network calls" provable.
 *
 * Three independent layers:
 *  1. Structure: the only code that issues a request is src/net/transport.ts, which is
 *     only reachable from src/sync/syncService.ts, which only runs when sync is enabled.
 *     `npm run audit:network` (CI) fails the build if fetch/XMLHttpRequest/WebSocket or a
 *     networking library appears anywhere else in src/ or modules/.
 *  2. Runtime: installNetworkGate() (called first thing in index.ts) replaces global
 *     fetch, XMLHttpRequest and WebSocket. Every request is refused unless sync is enabled
 *     AND the URL is exactly {baseUrl}/api/rideoffer/v1/ingest. Even a third-party
 *     dependency cannot phone home.
 *  3. Native: no Kotlin code in this app opens sockets; ML Kit's telemetry backend is
 *     removed from the merged manifest (plugins/withPrivacyHardening.js).
 */

export interface SyncPolicy {
  enabled: boolean;
  baseUrl: string;
}

let policyProvider: () => SyncPolicy = () => ({ enabled: false, baseUrl: '' });

export const gateStats = { allowed: 0, blocked: 0, lastBlockedUrl: '' as string };

export class NetworkBlockedError extends Error {
  constructor(url: string) {
    super(`Network request blocked by RideOffer Copilot privacy gate: ${url}`);
    this.name = 'NetworkBlockedError';
  }
}

export function setSyncPolicyProvider(fn: () => SyncPolicy): void {
  policyProvider = fn;
}

export function allowedIngestUrl(p: SyncPolicy): string | null {
  if (!p.enabled) return null;
  const base = (p.baseUrl || '').trim().replace(/\/+$/, '');
  if (!/^https:\/\//i.test(base)) return null;
  return `${base}/api/rideoffer/v1/ingest`;
}

const DEV_HOST = /^(https?|wss?):\/\/(localhost|127\.0\.0\.1|10\.0\.2\.2|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+)(:\d+)?(\/|$)/i;
let devHostsAllowed = false;

export function isUrlAllowed(url: string): boolean {
  if (devHostsAllowed && DEV_HOST.test(String(url))) return true;
  let p: SyncPolicy;
  try {
    p = policyProvider();
  } catch {
    return false;
  }
  const allowed = allowedIngestUrl(p);
  return allowed != null && String(url) === allowed;
}

function urlOf(input: unknown): string {
  if (typeof input === 'string') return input;
  if (input && typeof input === 'object' && 'url' in (input as any)) return String((input as any).url);
  return String(input);
}

let installed = false;

export interface GateOptions {
  /**
   * Development builds only (__DEV__): let the Metro bundler / hot reload reach the
   * developer's machine on localhost or the LAN. Release builds pass false.
   */
  allowDevHosts?: boolean;
}

/** Replaces the global networking primitives with gated versions. Idempotent. */
export function installNetworkGate(g: any = globalThis, options: GateOptions = {}): void {
  devHostsAllowed = options.allowDevHosts === true;
  if (installed && g === globalThis) return;
  if (g === globalThis) installed = true;

  const originalFetch = g.fetch;
  if (typeof originalFetch === 'function') {
    g.fetch = function gatedFetch(input: unknown, init?: unknown) {
      const url = urlOf(input);
      if (!isUrlAllowed(url)) {
        gateStats.blocked++;
        gateStats.lastBlockedUrl = url;
        return Promise.reject(new NetworkBlockedError(url));
      }
      gateStats.allowed++;
      return originalFetch.call(g, input, init);
    };
  }

  const XHR = g.XMLHttpRequest;
  if (typeof XHR === 'function' && XHR.prototype && typeof XHR.prototype.open === 'function') {
    const originalOpen = XHR.prototype.open;
    XHR.prototype.open = function gatedOpen(this: any, method: string, url: string, ...rest: unknown[]) {
      if (!isUrlAllowed(String(url))) {
        gateStats.blocked++;
        gateStats.lastBlockedUrl = String(url);
        throw new NetworkBlockedError(String(url));
      }
      gateStats.allowed++;
      return originalOpen.call(this, method, url, ...rest);
    };
  }

  const OriginalWebSocket = g.WebSocket;
  if (typeof OriginalWebSocket === 'function') {
    g.WebSocket = function GatedWebSocket(url: string, ...rest: unknown[]) {
      if (devHostsAllowed && DEV_HOST.test(String(url))) return new OriginalWebSocket(url, ...rest);
      gateStats.blocked++;
      gateStats.lastBlockedUrl = String(url);
      throw new NetworkBlockedError(String(url));
    };
  }
}
