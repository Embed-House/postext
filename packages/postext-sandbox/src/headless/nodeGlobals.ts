// `gray-matter` (the engine's front matter reader) asks for Node's `Buffer`
// as a global. The site's bundler provides one to the Sandbox and to its
// worker; the headless build (#736) is made with bun, which resolves the
// module and leaves the global to its host. Imported first by both entries.

// @ts-expect-error The package has no Node types: the bundler of the headless build resolves it.
import { Buffer } from 'node:buffer';

const host = globalThis as { Buffer?: unknown };
host.Buffer ??= Buffer as unknown;
