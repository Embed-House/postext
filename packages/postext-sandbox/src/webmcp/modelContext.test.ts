import { afterEach, describe, expect, it, vi } from 'vitest';
import { ToolError, imageResult, registerWebMcpTools, runTool, validateArgs, type JsonSchema, type PageToolRegistry, type WebMcpTool } from './modelContext.js';

const schema: JsonSchema = {
  type: 'object',
  properties: {
    chapter: { type: ['integer', 'string'] },
    width: { type: 'integer', minimum: 160, maximum: 2400 },
    format: { type: 'string', enum: ['jpeg', 'png'] },
    edits: { type: 'array', minItems: 1, items: { type: 'object', properties: { find: { type: 'string' } }, required: ['find'], additionalProperties: false } },
    value: {},
  },
  required: ['format'],
  additionalProperties: false,
};

describe('validateArgs', () => {
  it('passes what the schema describes', () => {
    expect(validateArgs(schema, { format: 'png', chapter: 2, width: 900, edits: [{ find: 'a' }], value: null })).toEqual([]);
    expect(validateArgs(schema, { format: 'jpeg', chapter: 'Intro' })).toEqual([]);
  });

  it('names what is missing, unknown, of the wrong type or out of range', () => {
    expect(validateArgs(schema, {})).toEqual(['format is required']);
    expect(validateArgs(schema, { format: 'gif' })[0]).toContain('one of "jpeg", "png"');
    expect(validateArgs(schema, { format: 'png', widht: 2 })[0]).toContain('widht is not a parameter');
    expect(validateArgs(schema, { format: 'png', width: 90 })).toEqual(['width must be at least 160']);
    expect(validateArgs(schema, { format: 'png', width: 1.5 })).toEqual(['width must be integer, not number']);
    expect(validateArgs(schema, { format: 'png', chapter: true })).toEqual(['chapter must be integer or string, not boolean']);
    expect(validateArgs(schema, { format: 'png', edits: [] })).toEqual(['edits needs at least 1 item(s)']);
    expect(validateArgs(schema, { format: 'png', edits: [{ find: 'a' }, { fnd: 'b' }] })).toEqual(['edits[1].find is required', expect.stringContaining('edits[1].fnd is not a parameter')]);
    expect(validateArgs(schema, 'png')).toEqual(['the arguments must be object, not string']);
  });
});

const tool = (execute: WebMcpTool['execute']): WebMcpTool => ({ name: 'demo', description: 'A demo.', inputSchema: schema, execute });

describe('runTool', () => {
  it('answers an object result with ok, and a bare value as result', async () => {
    expect(await runTool(tool(() => ({ pages: 3 })), { format: 'png' })).toEqual({ ok: true, pages: 3 });
    expect(await runTool(tool(() => 'done'), { format: 'png' })).toEqual({ ok: true, result: 'done' });
    expect(await runTool(tool(() => undefined), { format: 'png' })).toEqual({ ok: true, result: null });
  });

  it('takes the arguments as JSON text, as Chrome 154 hands them', async () => {
    expect(await runTool(tool((args) => ({ got: args.format })), '{"format":"png"}')).toEqual({ ok: true, got: 'png' });
    expect(await runTool(tool(() => 1), '{nope')).toEqual({ ok: false, error: 'The arguments are not valid JSON.' });
  });

  it('answers a failure instead of rejecting: the browser would drop the message', async () => {
    const invalid = await runTool(tool(() => 1), { format: 'gif' }) as { ok: boolean; error: string };
    expect(invalid.ok).toBe(false);
    expect(invalid.error).toMatch(/^Invalid arguments: format must be one of/);
    expect(await runTool(tool(() => { throw new ToolError('No chapter 9.', { chapters: 3 }); }), { format: 'png' })).toEqual({ ok: false, error: 'No chapter 9.', chapters: 3 });
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(await runTool(tool(() => { throw new Error('boom'); }), { format: 'png' })).toEqual({ ok: false, error: 'demo failed: boom' });
    spy.mockRestore();
    expect(await runTool(tool(() => { throw new DOMException('Aborted', 'AbortError'); }), { format: 'png' })).toEqual({ ok: false, error: 'Cancelled.' });
  });

  it('hands a result made of content parts over as it is', async () => {
    const result = imageResult({ page: 1 }, [{ base64: 'AAAA', mimeType: 'image/jpeg' }]);
    expect(await runTool(tool(() => result), { format: 'png' })).toEqual({
      content: [{ type: 'text', text: '{"page":1}' }, { type: 'image', data: 'AAAA', mimeType: 'image/jpeg' }],
    });
  });
});

describe('registerWebMcpTools', () => {
  const host = globalThis as { document?: unknown; postextWebMcp?: PageToolRegistry };
  afterEach(() => {
    delete host.document;
    delete host.postextWebMcp;
  });

  it('registers with document.modelContext until the signal aborts', async () => {
    const registered: { name: string; signal?: AbortSignal; execute: (args: unknown) => Promise<unknown> }[] = [];
    host.document = { modelContext: { registerTool: (t: { name: string; execute: (args: unknown) => Promise<unknown> }, o?: { signal?: AbortSignal }) => { registered.push({ ...t, signal: o?.signal }); } } };
    const controller = new AbortController();
    registerWebMcpTools([tool(() => ({ fine: true }))], controller.signal);
    await Promise.resolve();
    expect(registered.map((t) => t.name)).toEqual(['demo']);
    expect(registered[0]!.signal).toBe(controller.signal);
    // The browser calls the wrapped tool: arguments are checked there too.
    expect(await registered[0]!.execute({ format: 'png' })).toEqual({ ok: true, fine: true });
    expect(await registered[0]!.execute({})).toMatchObject({ ok: false });
    expect(host.postextWebMcp!.listTools().map((t) => t.name)).toEqual(['demo']);
    controller.abort();
    expect(host.postextWebMcp!.listTools()).toEqual([]);
  });

  it('keeps the tools on the page for a browser without WebMCP', async () => {
    host.document = {};
    const controller = new AbortController();
    registerWebMcpTools([tool((args) => ({ format: args.format }))], controller.signal);
    expect(await host.postextWebMcp!.executeTool('demo', { format: 'jpeg' })).toEqual({ ok: true, format: 'jpeg' });
    expect(await host.postextWebMcp!.executeTool('nope')).toMatchObject({ ok: false, error: expect.stringContaining('No tool named "nope"') });
    controller.abort();
  });
});
