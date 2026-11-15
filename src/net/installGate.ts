// Imported FIRST by index.ts so the gate is in place before any other module runs.
import { installNetworkGate } from './networkGate';

declare const __DEV__: boolean;

installNetworkGate(globalThis, { allowDevHosts: typeof __DEV__ !== 'undefined' && __DEV__ });
