// The page entry of the headless Sandbox check (#736): `pnpm cookbook
// sandbox` builds this file and `worker/layout.worker.ts` from the working
// tree and calls `window.__postextSandbox.layOutBundle` once per edition.

import './nodeGlobals.js';
import { layOutBundle, layOutState } from './layOutBundle.js';
import type { LaidOutBundle, LayOutBundleOptions } from './layOutBundle.js';

declare global {
  interface Window {
    __postextSandbox?: { layOutBundle: (bytes: Uint8Array, options: LayOutBundleOptions) => Promise<LaidOutBundle>; state: () => unknown };
  }
}

window.__postextSandbox = { layOutBundle, state: layOutState };
