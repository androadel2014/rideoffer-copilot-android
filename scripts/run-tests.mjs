// Compiles the pure-TypeScript engine + tests with tsc, then runs them with node:test.
import { execFileSync } from 'node:child_process';
import { readdirSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const out = path.join(root, '.test-build');
rmSync(out, { recursive: true, force: true });

let tsc;
try {
  tsc = createRequire(import.meta.url).resolve('typescript/bin/tsc');
} catch {
  tsc = null;
}
if (tsc) execFileSync(process.execPath, [tsc, '-p', 'tsconfig.test.json'], { cwd: root, stdio: 'inherit' });
else execFileSync('tsc', ['-p', 'tsconfig.test.json'], { cwd: root, stdio: 'inherit' });

const dir = path.join(out, 'tests');
const files = readdirSync(dir).filter((f) => f.endsWith('.test.js')).map((f) => path.join(dir, f));
execFileSync(process.execPath, ['--test', ...files], { cwd: root, stdio: 'inherit' });
