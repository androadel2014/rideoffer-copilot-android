// Static network audit (runs in CI). Fails if any code other than the two allow-listed
// files references a networking primitive or library, or if a networking/analytics/ads
// package sneaks into package.json, or if Kotlin code opens connections.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const ALLOW = new Set(['src/net/transport.ts', 'src/net/networkGate.ts']);
const JS_PATTERNS = [
  /\bfetch\s*\(/,
  /\bXMLHttpRequest\b/,
  /\bnew\s+WebSocket\b/,
  /\bEventSource\b/,
  /\bnavigator\.sendBeacon\b/,
  /from\s+['"](axios|ky|got|superagent|socket\.io-client)['"]/,
];
const KT_PATTERNS = [/HttpURLConnection/, /\bokhttp3?\b/i, /java\.net\.(URL|Socket)/, /\bRetrofit\b/];
const BANNED_DEPS = [
  /analytics/i, /firebase/i, /sentry/i, /bugsnag/i, /amplitude/i, /mixpanel/i, /segment/i,
  /admob/i, /google-mobile-ads/i, /^react-native-ads/i, /expo-updates/, /expo-notifications/, /expo-dev-client/, /axios/, /accessibility/i,
];

const problems = [];

function walk(dir, exts, out = []) {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name.startsWith('.')) continue;
    const p = path.join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, exts, out);
    else if (exts.some((e) => name.endsWith(e))) out.push(p);
  }
  return out;
}

for (const file of [...walk(path.join(root, 'src'), ['.ts', '.tsx']), ...walk(path.join(root, 'modules'), ['.ts', '.tsx']), path.join(root, 'index.ts')]) {
  const rel = path.relative(root, file).split(path.sep).join('/');
  if (ALLOW.has(rel)) continue;
  const src = readFileSync(file, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
  for (const re of JS_PATTERNS) if (re.test(src)) problems.push(`${rel}: forbidden network usage ${re}`);
}

// transport.ts may only be imported by the sync service.
for (const file of walk(path.join(root, 'src'), ['.ts', '.tsx'])) {
  const rel = path.relative(root, file).split(path.sep).join('/');
  if (rel === 'src/sync/syncService.ts' || ALLOW.has(rel)) continue;
  if (/from\s+['"][./]*(net\/)?transport['"]/.test(readFileSync(file, 'utf8'))) {
    problems.push(`${rel}: only src/sync/syncService.ts may import the transport`);
  }
}

for (const file of walk(path.join(root, 'modules'), ['.kt', '.java'])) {
  const src = readFileSync(file, 'utf8');
  for (const re of KT_PATTERNS) if (re.test(src)) problems.push(`${path.relative(root, file)}: native networking ${re}`);
}

const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
for (const dep of Object.keys({ ...pkg.dependencies, ...pkg.devDependencies })) {
  if (BANNED_DEPS.some((re) => re.test(dep))) problems.push(`package.json: banned dependency ${dep}`);
}

const manifest = readFileSync(path.join(root, 'modules/screen-watcher/android/src/main/AndroidManifest.xml'), 'utf8');
if (/BIND_ACCESSIBILITY_SERVICE|AccessibilityService/.test(manifest)) problems.push('Accessibility service declared');

if (problems.length) {
  console.error('Network/privacy audit FAILED:\n  ' + problems.join('\n  '));
  process.exit(1);
}
console.log('Network/privacy audit passed: only src/net/transport.ts can reach the network, and only via the gate.');
