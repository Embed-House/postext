// The page entry of the headless Sandbox check (#736): `pnpm cookbook
// sandbox` builds this file and `worker/layout.worker.ts` from the working
// tree and calls `window.__postextSandbox.layOutBundle` once per edition.

import './nodeGlobals';
import { layOutBundle } from './layOutBundle';
import type { LaidOutBundle, LayOutBundleOptions } from './layOutBundle';

declare global {
  interface Window {
    __postextSandbox?: { layOutBundle: (bytes: Uint8Array, options: LayOutBundleOptions) => Promise<LaidOutBundle> };
  }
}

window.__postextSandbox = { layOutBundle };
