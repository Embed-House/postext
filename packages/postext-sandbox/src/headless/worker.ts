// The worker entry of the headless Sandbox check (#736): the Sandbox's own
// layout worker, after the one global its bundler would have given it.

import './nodeGlobals.js';
import '../worker/layout.worker.js';
