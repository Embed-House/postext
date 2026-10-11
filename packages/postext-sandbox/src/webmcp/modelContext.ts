// WebMCP (https://webmachinelearning.github.io/webmcp/): a page hands an
// agent its own tools through `document.modelContext`, instead of leaving
// it to click through the interface. This module is the part that knows
// the browser API — what a tool is, how its arguments are checked, how a
// set of tools is registered and taken back. It imports nothing of the
// Sandbox, so a host (the website) registers its own tools through it:
// `import { registerWebMcpTools } from 'postext-sandbox/webmcp'`.

export type JsonSchema = {
  type?: 'object' | 'string' | 'number' | 'integer' | 'boolean' | 'array' | 'null' | readonly string[];
  description?: string;
  enum?: readonly unknown[];
  properties?: Record<string, JsonSchema>;
  required?: readonly string[];
  additionalProperties?: boolean | JsonSchema;
  items?: JsonSchema;
  minimum?: number;
  maximum?: number;
  minItems?: number;
  maxItems?: number;
  default?: unknown;
};

export interface WebMcpAnnotations {
  /** The tool changes nothing. */
  readOnlyHint?: boolean;
  /** The tool's effect is hard to take back (a book deleted): a browser
   *  may ask the reader before running it. */
  consequentialHint?: boolean;
  /** The result carries text the page did not write (a book's own text, a
   *  file fetched from elsewhere): a browser may guard the model from it. */
  untrustedContentHint?: boolean;
}

export interface WebMcpTool {
  name: string;
  title?: string;
  description: string;
  inputSchema: JsonSchema;
  annotations?: WebMcpAnnotations;
  /** Resolves to the result, a JSON value. A {@link ToolError} thrown here
   *  reaches the agent as `{ ok: false, error }`. */
  execute: (args: Record<string, unknown>, options: { signal?: AbortSignal }) => unknown | Promise<unknown>;
}

/** A failure the agent can act on: the message says what was wrong with
 *  the request and, where there is one, what to ask instead. */
export class ToolError extends Error {
  readonly details?: Record<string, unknown>;
  constructor(message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = 'ToolError';
    this.details = details;
  }
}

/** A picture among a tool's results, in the shape MCP gives one (the
 *  result is then `{ content: [...] }`, which the bridges between WebMCP
 *  and an MCP client hand over as a picture rather than as text). */
export interface ImageContent {
  type: 'image';
  data: string;
  mimeType: string;
}
export interface TextContent {
  type: 'text';
  text: string;
}
export interface ContentResult {
  content: (TextContent | ImageContent)[];
}

/** A result made of pictures: what is known about them as JSON text
 *  first, then each picture. */
export function imageResult(about: unknown, images: readonly { base64: string; mimeType: string }[]): ContentResult {
  return {
    content: [
      { type: 'text', text: JSON.stringify(about) },
      ...images.map((i): ImageContent => ({ type: 'image', data: i.base64, mimeType: i.mimeType })),
    ],
  };
}

const typeOf = (value: unknown): string => {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  if (typeof value === 'number') return Number.isInteger(value) ? 'integer' : 'number';
  return typeof value;
};

const matchesType = (value: unknown, type: string): boolean => {
  const actual = typeOf(value);
  return actual === type || (type === 'number' && actual === 'integer');
};

/** What is wrong with `value` for `schema`, as sentences an agent can
 *  correct itself from; empty when nothing is. A browser does not promise
 *  to enforce a tool's schema, so every call is checked here: the subset
 *  the tools use (types, enums, required and unknown members, ranges). */
export function validateArgs(schema: JsonSchema, value: unknown, path = ''): string[] {
  const at = path || 'the arguments';
  const types = schema.type === undefined ? [] : typeof schema.type === 'string' ? [schema.type] : [...schema.type];
  if (types.length > 0 && !types.some((t) => matchesType(value, t))) {
    return [`${at} must be ${types.join(' or ')}, not ${typeOf(value)}`];
  }
  const problems: string[] = [];
  if (schema.enum && !schema.enum.includes(value)) {
    problems.push(`${at} must be one of ${schema.enum.map((v) => JSON.stringify(v)).join(', ')}`);
  }
  if (typeof value === 'number') {
    if (schema.minimum !== undefined && value < schema.minimum) problems.push(`${at} must be at least ${schema.minimum}`);
    if (schema.maximum !== undefined && value > schema.maximum) problems.push(`${at} must be at most ${schema.maximum}`);
  }
  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) problems.push(`${at} needs at least ${schema.minItems} item(s)`);
    if (schema.maxItems !== undefined && value.length > schema.maxItems) problems.push(`${at} takes at most ${schema.maxItems} item(s)`);
    if (schema.items) value.forEach((item, i) => problems.push(...validateArgs(schema.items!, item, `${path}[${i}]`)));
  }
  if (typeOf(value) === 'object' && (schema.properties || schema.required)) {
    const record = value as Record<string, unknown>;
    const properties = schema.properties ?? {};
    for (const key of schema.required ?? []) {
      if (record[key] === undefined) problems.push(`${path ? `${path}.` : ''}${key} is required`);
    }
    for (const [key, member] of Object.entries(record)) {
      const child = path ? `${path}.${key}` : key;
      const known = properties[key];
      if (known) {
        if (member !== undefined) problems.push(...validateArgs(known, member, child));
      } else if (schema.additionalProperties === false) {
        problems.push(`${child} is not a parameter (the parameters are ${Object.keys(properties).join(', ') || 'none'})`);
      } else if (typeof schema.additionalProperties === 'object') {
        problems.push(...validateArgs(schema.additionalProperties, member, child));
      }
    }
  }
  return problems;
}

/** Run a tool the way the browser will: the arguments checked against its
 *  schema, a failure given back as a result. A browser tells the agent no
 *  more than "the invocation failed" when `execute` rejects, so what went
 *  wrong is always answered, never thrown. */
export async function runTool(tool: WebMcpTool, args: unknown, options: { signal?: AbortSignal } = {}): Promise<unknown> {
  // Chrome 154 and before take the arguments as JSON text.
  let input: unknown = args ?? {};
  if (typeof input === 'string') {
    try {
      input = input.trim() === '' ? {} : JSON.parse(input);
    } catch {
      return { ok: false, error: 'The arguments are not valid JSON.' };
    }
  }
  const problems = validateArgs(tool.inputSchema, input);
  if (problems.length > 0) return { ok: false, error: `Invalid arguments: ${problems.join('; ')}.` };
  try {
    const result = await tool.execute(input as Record<string, unknown>, options);
    if (result !== null && typeof result === 'object' && Array.isArray((result as ContentResult).content)) return result;
    if (result !== null && typeof result === 'object' && !Array.isArray(result)) return { ok: true, ...(result as object) };
    return { ok: true, result: result ?? null };
  } catch (err) {
    if (err instanceof ToolError) return { ok: false, error: err.message, ...(err.details ?? {}) };
    if ((err as { name?: string } | null)?.name === 'AbortError') return { ok: false, error: 'Cancelled.' };
    console.error(`[webmcp] ${tool.name} failed`, err);
    return { ok: false, error: `${tool.name} failed: ${err instanceof Error ? err.message : String(err)}` };
  }
}

/** The part of `document.modelContext` this module calls. */
interface ModelContextLike {
  registerTool: (tool: Record<string, unknown>, options?: { signal?: AbortSignal }) => unknown;
  /** Before registrations took a signal (early previews). */
  unregisterTool?: (name: string) => unknown;
}

/** The browser's model context, or null where WebMCP is not offered.
 *  `document.modelContext` is the standard name; `navigator.modelContext`
 *  was the first previews' (deprecated in Chrome 150). */
export function getModelContext(): ModelContextLike | null {
  const doc = (globalThis as { document?: { modelContext?: ModelContextLike } }).document;
  const nav = (globalThis as { navigator?: { modelContext?: ModelContextLike } }).navigator;
  return doc?.modelContext ?? nav?.modelContext ?? null;
}

/** The same tools for an agent in a browser without WebMCP, which can
 *  still run script in the page (a browser automation tool, an
 *  extension): `postextWebMcp.listTools()` and
 *  `await postextWebMcp.executeTool(name, args)`, with the results a
 *  WebMCP call gives. */
export interface PageToolRegistry {
  listTools: () => { name: string; title?: string; description: string; inputSchema: JsonSchema; annotations?: WebMcpAnnotations }[];
  executeTool: (name: string, args?: unknown) => Promise<unknown>;
}

const pageTools = new Map<string, WebMcpTool>();

function pageRegistry(): PageToolRegistry {
  return {
    listTools: () => [...pageTools.values()]
      .sort((a, b) => a.name.localeCompare(b.name))
      .map(({ name, title, description, inputSchema, annotations }) => ({ name, ...(title ? { title } : {}), description, inputSchema, ...(annotations ? { annotations } : {}) })),
    executeTool: async (name, args) => {
      const tool = pageTools.get(name);
      if (!tool) return { ok: false, error: `No tool named ${JSON.stringify(name)} on this page. The tools here: ${[...pageTools.keys()].sort().join(', ')}.` };
      return runTool(tool, args);
    },
  };
}

/** Register `tools` with the browser until `signal` aborts (a component
 *  unmounting, a page left). Without WebMCP only the page's own registry
 *  holds them. A name another registration holds is left to it. */
export function registerWebMcpTools(tools: readonly WebMcpTool[], signal: AbortSignal): void {
  if (signal.aborted || typeof globalThis.document === 'undefined') return;
  const host = globalThis as { postextWebMcp?: PageToolRegistry };
  host.postextWebMcp ??= pageRegistry();
  const context = getModelContext();
  for (const tool of tools) {
    if (pageTools.has(tool.name)) {
      console.warn(`[webmcp] a tool named ${tool.name} is already registered`);
      continue;
    }
    pageTools.set(tool.name, tool);
    signal.addEventListener('abort', () => {
      if (pageTools.get(tool.name) === tool) pageTools.delete(tool.name);
    }, { once: true });
    if (!context) continue;
    const definition = {
      name: tool.name,
      ...(tool.title ? { title: tool.title } : {}),
      description: tool.description,
      inputSchema: tool.inputSchema,
      annotations: { readOnlyHint: false, ...tool.annotations },
      execute: (args: unknown, options?: { signal?: AbortSignal }) => runTool(tool, args, { signal: options?.signal }),
    };
    void (async () => {
      try {
        await context.registerTool(definition, { signal });
        // An early preview that ignores the signal.
        if (context.unregisterTool) {
          signal.addEventListener('abort', () => {
            try {
              void context.unregisterTool!(tool.name);
            } catch {
              // Already gone.
            }
          }, { once: true });
        }
      } catch (err) {
        if (!signal.aborted) console.warn(`[webmcp] ${tool.name} was not registered`, err);
      }
    })();
  }
}
