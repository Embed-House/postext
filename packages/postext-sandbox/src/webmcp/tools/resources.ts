// The book's resources (pictures, diagrams, tables) and its own fonts.

import type { CustomFontFamily, Resource, TableCell, TableModel } from 'postext';
import { parseTSV } from 'postext';
import { getConfigFontFamilies, isCustomFontFamily } from '../../controls/fontLoader';
import { fetchGoogleFonts } from '../../controls/FontPicker';
import { invalidateResourceImage } from '../../controls/resourceImages';
import { slugify, uniqueSlug } from '../../panels/resources/slugify';
import { isValidSvg, svgIntrinsicSize } from '../../panels/resources/svgIntrinsic';
import { resourceFromFile } from '../../panels/resources/uploadFiles';
import { getBlob, putBlob } from '../../storage/blobStore';
import { deleteFontFile, formatFromFilename, generateFontFileId, putFontFile } from '../../storage/fontStorage';
import { dispatchAndWait, type SandboxToolHost } from '../host';
import { ToolError, type WebMcpTool } from '../modelContext';
import { layoutAnswer } from './book';

/** Largest file a tool takes in (a picture, a font), in bytes. */
const MAX_FILE_BYTES = 40 * 1024 * 1024;

const FILE_PARAM = {
  type: 'object',
  description: 'A file: where to fetch it (url) or its bytes (base64).',
  properties: {
    url: { type: 'string', description: 'An http(s) or data: URL the page can fetch.' },
    base64: { type: 'string', description: 'The bytes, base64-encoded.' },
    mimeType: { type: 'string', description: 'Its media type, e.g. image/png. Read from the response or the file name when left out.' },
    fileName: { type: 'string', description: 'Its file name, with its extension.' },
  },
  additionalProperties: false,
} as const;

export interface FileInput {
  url?: string;
  base64?: string;
  mimeType?: string;
  fileName?: string;
}

const EXTENSION_TYPES: Record<string, string> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', svg: 'image/svg+xml',
  woff2: 'font/woff2', woff: 'font/woff', ttf: 'font/ttf', otf: 'font/otf', postext: 'application/zip', zip: 'application/zip',
};

/** The file an agent hands over: fetched, or decoded from base64. */
export async function readFileInput(input: FileInput, signal?: AbortSignal): Promise<File> {
  let bytes: ArrayBuffer;
  let type = input.mimeType ?? '';
  let name = input.fileName ?? '';
  if (input.base64 !== undefined) {
    let binary: string;
    try {
      binary = atob(input.base64.replace(/^data:[^,]*,/, '').replace(/\s+/g, ''));
    } catch {
      throw new ToolError('The base64 text could not be decoded.');
    }
    const view = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) view[i] = binary.charCodeAt(i);
    bytes = view.buffer;
  } else if (input.url !== undefined) {
    let url: URL;
    try {
      url = new URL(input.url, window.location.href);
    } catch {
      throw new ToolError(`"${input.url}" is not a URL.`);
    }
    if (!['http:', 'https:', 'data:', 'blob:'].includes(url.protocol)) throw new ToolError('Only http(s), data: and blob: URLs can be fetched.');
    let res: Response;
    try {
      res = await fetch(url, { signal });
    } catch (err) {
      throw new ToolError(`The file could not be fetched (${err instanceof Error ? err.message : 'network error'}). A file on another site must allow cross-origin requests; otherwise hand its bytes over as base64.`);
    }
    if (!res.ok) throw new ToolError(`The file could not be fetched: ${url.href} answered ${res.status}.`);
    bytes = await res.arrayBuffer();
    type ||= (res.headers.get('content-type') ?? '').split(';')[0]!.trim();
    name ||= url.protocol === 'data:' ? '' : decodeURIComponent(url.pathname.split('/').pop() ?? '');
  } else {
    throw new ToolError('A file needs a "url" or its bytes as "base64".');
  }
  if (bytes.byteLength === 0) throw new ToolError('The file is empty.');
  if (bytes.byteLength > MAX_FILE_BYTES) throw new ToolError(`The file is ${Math.round(bytes.byteLength / 1048576)} MB; the most a tool takes is ${MAX_FILE_BYTES / 1048576} MB.`);
  const extension = name.split('.').pop()?.toLowerCase() ?? '';
  if (!type || type === 'application/octet-stream') type = EXTENSION_TYPES[extension] ?? type;
  if (!name) name = `file.${Object.entries(EXTENSION_TYPES).find(([, t]) => t === type)?.[0] ?? 'bin'}`;
  return new File([bytes], name, { type });
}

const sizeOf = (r: Resource): { width: number; height: number } | null => {
  const from = r.bitmap ?? r.svg ?? r.video;
  return from?.width && from?.height ? { width: from.width, height: from.height } : null;
};

const tableRows = (model: TableModel): string[][] => model.rows.map((row) => row.map((cell) => cell.content));

export function resourceTools(host: SandboxToolHost): WebMcpTool[] {
  const { store } = host;

  const listResources: WebMcpTool = {
    name: 'sandbox_list_resources',
    title: 'Sandbox: the book\'s resources',
    description: 'The pictures, diagrams, tables and videos of the book, which the text places with ::resource{id="…"} and cites with :ref{id="…"}: each one\'s id, kind, type, caption, size and how often the text uses it. With an id: that resource in full — its record, the source of an SVG, the cells of a table.',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string', description: 'Give this resource in full.' } },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, untrustedContentHint: true },
    execute: async (args) => {
      const s = store.getSnapshot();
      const text = s.chapters.map((c) => c.markdown).join('\n');
      const uses = (id: string): number => text.split(`id="${id}"`).length - 1;
      if (args.id !== undefined) {
        const resource = s.resources.find((r) => r.id === args.id);
        if (!resource) throw new ToolError(`No resource with id ${JSON.stringify(args.id)}. The ids: ${s.resources.map((r) => r.id).join(', ') || 'none'}.`);
        const answer: Record<string, unknown> = { resource, usedInText: uses(resource.id) };
        if (resource.kind === 'svg' && resource.svg) {
          const blob = await getBlob(resource.svg.fileId).catch(() => null);
          if (blob) answer.svg = new TextDecoder().decode(blob.bytes);
        }
        if (resource.kind === 'table' && resource.table) answer.rows = tableRows(resource.table.model);
        return answer;
      }
      return {
        types: (s.config.resourceTypes ?? []).map((t) => ({ id: t.id, name: t.name })),
        resources: s.resources.map((r) => ({
          id: r.id,
          kind: r.kind,
          type: r.typeId,
          ...(r.caption ? { caption: r.caption } : {}),
          ...(sizeOf(r) ? { size: sizeOf(r) } : {}),
          ...(r.kind === 'table' && r.table ? { rows: r.table.model.rows.length, columns: r.table.model.rows[0]?.length ?? 0 } : {}),
          usedInText: uses(r.id),
        })),
      };
    },
  };

  const saveResource: WebMcpTool = {
    name: 'sandbox_save_resource',
    title: 'Sandbox: add or change a resource',
    description: 'Add a resource to the book or change one. A new resource takes a picture file (PNG, JPEG, WebP, GIF or SVG, by url or base64), the source of an SVG, or the rows of a table; an existing id replaces that content or just changes its caption, note, alternative text, type or placement. The text then places it with ::resource{id="…"}. Answers with the stored record and, when the content changed, the pages the book came to.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'The resource to change, or the id to give a new one (letters, digits, hyphens). A new resource without one is named after its file or caption.' },
        type: { type: 'string', description: 'The resource type id (figure, table, or one the book defines); it decides the numbering and the caption label.' },
        caption: { type: 'string' },
        note: { type: 'string', description: 'A note set under the caption (a source, a credit).' },
        altText: { type: 'string', description: 'What the picture shows, for readers who cannot see it.' },
        image: FILE_PARAM,
        svg: { type: 'string', description: 'The source of an SVG drawing.' },
        table: {
          type: 'object',
          description: 'A table: its rows of cell texts (Markdown inline marks allowed), or tsv text.',
          properties: {
            rows: { type: 'array', items: { type: 'array', items: { type: 'string' } } },
            tsv: { type: 'string', description: 'Tab-separated values, one row per line.' },
            headerRows: { type: 'integer', minimum: 0, description: 'Rows at the top that are headers (default 1).' },
          },
          additionalProperties: false,
        },
        placement: { type: 'object', description: 'Where it goes, merged into its placement: position (auto, top, bottom, here), span (column, page, side), width, align, wrap and so on.' },
        fields: { type: 'object', description: 'Any other fields of the resource record, merged in as given (safeArea, anchors, a bitmap\'s resolution…).' },
        wait: { type: 'boolean', description: 'Wait for the book to be laid out again (default true).' },
      },
      additionalProperties: false,
    },
    execute: async (args, { signal }) => {
      const s = store.getSnapshot();
      const now = Date.now();
      const existing = args.id !== undefined ? s.resources.find((r) => r.id === args.id) : undefined;
      const ids = new Set(s.resources.map((r) => r.id));
      const contents = [args.image, args.svg, args.table].filter((c) => c !== undefined).length;
      if (contents > 1) throw new ToolError('Give one content: an image, an svg source or a table.');
      if (!existing && contents === 0) throw new ToolError(args.id !== undefined ? `No resource with id ${JSON.stringify(args.id)} to change; a new one needs an image, an svg source or a table.` : 'A new resource needs an image, an svg source or a table.');
      const types = s.config.resourceTypes ?? [];
      if (args.type !== undefined && types.length > 0 && !types.some((t) => t.id === args.type)) {
        throw new ToolError(`No resource type ${JSON.stringify(args.type)}. The types: ${types.map((t) => t.id).join(', ')}.`);
      }
      const typeFor = (kind: 'table' | 'picture'): string => (args.type as string | undefined)
        ?? existing?.typeId
        ?? (kind === 'table' ? types.find((t) => t.id === 'table')?.id : types.find((t) => t.id === 'figure')?.id)
        ?? types[0]?.id
        ?? (kind === 'table' ? 'table' : 'figure');

      // The content, as the fields of the record it replaces.
      let content: Partial<Resource> | null = null;
      let nameHint = '';
      if (args.image !== undefined) {
        const file = await readFileInput(args.image as FileInput, signal);
        const made = await resourceFromFile(file, typeFor('picture'), new Set());
        if (!made || made.kind === 'video') throw new ToolError(`That file is not a picture the Sandbox takes (${file.type || 'unknown type'}): PNG, JPEG, WebP, GIF or SVG.`);
        content = made.kind === 'svg' ? { kind: 'svg', svg: made.svg } : { kind: 'bitmap', bitmap: made.bitmap };
        nameHint = file.name.replace(/\.[^.]+$/, '');
      } else if (args.svg !== undefined) {
        const source = args.svg as string;
        if (!isValidSvg(source)) throw new ToolError('The svg source does not parse as an SVG document (it needs an <svg> root in the SVG namespace).');
        const fileId = await putBlob(new TextEncoder().encode(source).buffer as ArrayBuffer, 'image/svg+xml');
        content = { kind: 'svg', svg: { fileId, ...svgIntrinsicSize(source) } };
      } else if (args.table !== undefined) {
        const table = args.table as { rows?: string[][]; tsv?: string; headerRows?: number };
        const headerRows = table.headerRows ?? 1;
        let model: TableModel;
        if (table.tsv !== undefined) model = { ...parseTSV(table.tsv), headerRowCount: headerRows };
        else if (table.rows && table.rows.length > 0) {
          const columns = Math.max(...table.rows.map((r) => r.length));
          if (columns === 0) throw new ToolError('The table has no cells.');
          model = {
            headerRowCount: headerRows,
            rows: table.rows.map((row, r) => Array.from({ length: columns }, (_, c): TableCell => ({ content: row[c] ?? '', ...(r < headerRows ? { isHeader: true } : {}) }))),
          };
        } else throw new ToolError('A table needs "rows" or "tsv".');
        content = { kind: 'table', table: { ...(existing?.table?.styleId ? { styleId: existing.table.styleId } : {}), ...(existing?.table?.direction ? { direction: existing.table.direction } : {}), model } };
      }

      let id = existing?.id;
      if (!id) {
        const wanted = slugify((args.id as string | undefined) ?? nameHint ?? '') || slugify((args.caption as string | undefined) ?? '');
        id = uniqueSlug(wanted, ids, content?.kind === 'table' ? 'table' : 'image');
      }
      const base: Resource = existing
        ? { ...existing }
        : { id, typeId: typeFor(content!.kind === 'table' ? 'table' : 'picture'), kind: content!.kind!, createdAt: now, updatedAt: now };
      if (content) {
        // One kind of content at a time: the other kinds' payloads go.
        delete base.bitmap;
        delete base.svg;
        delete base.table;
        delete base.video;
        Object.assign(base, content);
      }
      if (args.type !== undefined) base.typeId = args.type as string;
      for (const key of ['caption', 'note', 'altText'] as const) {
        if (args[key] === undefined) continue;
        if (args[key] === '') delete base[key];
        else base[key] = args[key] as string;
      }
      if (args.placement !== undefined) base.placement = { ...base.placement, ...(args.placement as Resource['placement']) };
      if (args.fields !== undefined) {
        const { id: _id, kind: _kind, createdAt: _created, ...rest } = args.fields as Record<string, unknown>;
        void _id; void _kind; void _created;
        Object.assign(base, rest);
      }
      base.updatedAt = now;
      await dispatchAndWait(host, { type: 'UPSERT_RESOURCE', payload: base });
      return {
        id,
        created: !existing,
        resource: base,
        use: `::resource{id="${id}"}`,
        ...(await layoutAnswer(host, args.wait, signal)),
      };
    },
  };

  const deleteResource: WebMcpTool = {
    name: 'sandbox_delete_resource',
    title: 'Sandbox: delete a resource',
    description: 'Delete a resource and its file from the book. It cannot be undone; places in the text that use it are left pointing at nothing and show up as warnings.',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string' }, wait: { type: 'boolean', description: 'Wait for the book to be laid out again (default true).' } },
      required: ['id'],
      additionalProperties: false,
    },
    annotations: { consequentialHint: true },
    execute: async (args, { signal }) => {
      const s = store.getSnapshot();
      const resource = s.resources.find((r) => r.id === args.id);
      if (!resource) throw new ToolError(`No resource with id ${JSON.stringify(args.id)}. The ids: ${s.resources.map((r) => r.id).join(', ') || 'none'}.`);
      const usedInText = s.chapters.map((c) => c.markdown).join('\n').split(`id="${resource.id}"`).length - 1;
      await dispatchAndWait(host, { type: 'DELETE_RESOURCE', payload: resource.id });
      const fileId = resource.bitmap?.fileId ?? resource.svg?.fileId;
      if (fileId) invalidateResourceImage(fileId);
      return { deleted: resource.id, stillUsedInText: usedInText, ...(await layoutAnswer(host, args.wait, signal)) };
    },
  };

  const listFonts: WebMcpTool = {
    name: 'sandbox_list_fonts',
    title: 'Sandbox: fonts',
    description: "The font families the book sets its text in, the families uploaded into the book (custom fonts, with their weights and styles), and — with search — families of the open-font catalogue (Google Fonts through Fontsource) whose name matches. A family is put to use by writing its name into a fontFamily setting (bodyText.fontFamily, a heading style's, a paragraph style's) with sandbox_set_config; catalogue families load on demand.",
    inputSchema: {
      type: 'object',
      properties: { search: { type: 'string', description: 'Part of a family name to look up in the catalogue.' } },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true },
    execute: async (args) => {
      const s = store.getSnapshot();
      const inUse = getConfigFontFamilies(s.config, s.chapters.map((c) => c.markdown));
      const answer: Record<string, unknown> = {
        inUse: inUse.map((family) => ({ family, source: isCustomFontFamily(family) ? 'custom' : 'catalogue' })),
        custom: (s.config.customFonts ?? []).map((f) => ({ family: f.name, faces: f.variants.map((v) => ({ weight: v.weight, style: v.style, file: v.fileName ?? v.format })) })),
      };
      const search = (args.search as string | undefined)?.trim().toLowerCase();
      if (search) {
        const catalogue = await fetchGoogleFonts();
        const found = catalogue.filter((f) => f.family.toLowerCase().includes(search));
        answer.catalogue = found.slice(0, 50).map((f) => ({ family: f.family, subsets: f.subsets }));
        if (found.length > 50) answer.more = found.length - 50;
      }
      return answer;
    },
  };

  const saveFont: WebMcpTool = {
    name: 'sandbox_save_font',
    title: 'Sandbox: add or remove a custom font',
    description: "Upload a font file (WOFF2, WOFF, TTF or OTF, by url or base64) into the book as one face — a weight and a style — of a custom family, or remove a face or a whole family. The family's name is then used like any other in a fontFamily setting, and travels with the book in its .postext file.",
    inputSchema: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['add', 'remove'] },
        family: { type: 'string', description: 'The family name.' },
        weight: { type: 'integer', minimum: 1, maximum: 1000, description: 'add: the face\'s weight (default 400). remove: only the faces of this weight.' },
        style: { type: 'string', enum: ['normal', 'italic'], description: 'add: the face\'s style (default normal). remove: only the faces of this style.' },
        file: FILE_PARAM,
        wait: { type: 'boolean', description: 'Wait for the book to be laid out again (default true).' },
      },
      required: ['action', 'family'],
      additionalProperties: false,
    },
    execute: async (args, { signal }) => {
      const s = store.getSnapshot();
      const name = (args.family as string).trim();
      if (!name) throw new ToolError('The family needs a name.');
      const families: CustomFontFamily[] = [...(s.config.customFonts ?? [])];
      const at = families.findIndex((f) => f.name === name);
      if (args.action === 'add') {
        if (args.file === undefined) throw new ToolError('add needs the font file.');
        const file = await readFileInput(args.file as FileInput, signal);
        const format = formatFromFilename(file.name);
        if (!format) throw new ToolError(`"${file.name}" is not a font file the Sandbox takes: its name must end in .woff2, .woff, .ttf or .otf (give fileName when the URL has none).`);
        const fileId = generateFontFileId();
        await putFontFile({ fileId, fileName: file.name, format, buffer: await file.arrayBuffer() });
        const face = { weight: (args.weight as number | undefined) ?? 400, style: (args.style as 'normal' | 'italic' | undefined) ?? 'normal', fileId, format, fileName: file.name };
        if (at < 0) families.push({ name, variants: [face] });
        else {
          // A face of the same weight and style is replaced, not doubled.
          const kept = families[at]!.variants.filter((v) => v.weight !== face.weight || v.style !== face.style);
          for (const v of families[at]!.variants) if (!kept.includes(v)) await deleteFontFile(v.fileId).catch(() => undefined);
          families[at] = { ...families[at]!, variants: [...kept, face] };
        }
        await dispatchAndWait(host, { type: 'UPDATE_CONFIG', payload: { customFonts: families } });
        return { family: name, faces: families.find((f) => f.name === name)!.variants.map((v) => ({ weight: v.weight, style: v.style })), ...(await layoutAnswer(host, args.wait, signal)) };
      }
      if (at < 0) throw new ToolError(`No custom family named ${JSON.stringify(name)}. The custom families: ${families.map((f) => f.name).join(', ') || 'none'}.`);
      const family = families[at]!;
      const goes = family.variants.filter((v) => (args.weight === undefined || v.weight === args.weight) && (args.style === undefined || v.style === args.style));
      if (goes.length === 0) throw new ToolError('The family has no face of that weight and style.');
      for (const v of goes) await deleteFontFile(v.fileId).catch(() => undefined);
      const left = family.variants.filter((v) => !goes.includes(v));
      if (left.length === 0) families.splice(at, 1);
      else families[at] = { ...family, variants: left };
      await dispatchAndWait(host, { type: 'UPDATE_CONFIG', payload: { customFonts: families.length > 0 ? families : undefined } });
      return { family: name, removedFaces: goes.length, familyRemoved: left.length === 0, ...(await layoutAnswer(host, args.wait, signal)) };
    },
  };

  return [listResources, saveResource, deleteResource, listFonts, saveFont];
}
