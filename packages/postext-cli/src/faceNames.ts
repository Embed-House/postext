// The family names a face file says it is of, and a copy of the file that
// says it is of another (#890). resvg matches an SVG's `font-family`
// against the family each face file names in its `name` table, while the
// book names its families as it likes: a bundle family `Frutiger LT Std
// Roman` whose files say `Frutiger LT Std` was not found, and the SVG's
// labels fell back to a serif. resvg is handed, beside each face, a copy
// named after the family the book registers it under.

/** The tables of a TrueType / OpenType file: tag → [offset, length], and
 *  the offset of each table record. Undefined for a collection or a file
 *  too short to be one. */
function tableDirectory(bytes: Uint8Array): Map<string, { offset: number; length: number; record: number }> | undefined {
  if (bytes.byteLength < 12) return undefined;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tag = view.getUint32(0);
  // 0x00010000 (TrueType), 'OTTO' (CFF), 'true'.
  if (tag !== 0x00010000 && tag !== 0x4f54544f && tag !== 0x74727565) return undefined;
  const count = view.getUint16(4);
  if (12 + count * 16 > bytes.byteLength) return undefined;
  const tables = new Map<string, { offset: number; length: number; record: number }>();
  for (let i = 0; i < count; i++) {
    const record = 12 + i * 16;
    const name = String.fromCharCode(bytes[record]!, bytes[record + 1]!, bytes[record + 2]!, bytes[record + 3]!);
    tables.set(name, { offset: view.getUint32(record + 8), length: view.getUint32(record + 12), record });
  }
  return tables;
}

interface NameRecord {
  platform: number;
  encoding: number;
  language: number;
  nameId: number;
  bytes: Uint8Array;
}

function nameRecords(bytes: Uint8Array): NameRecord[] | undefined {
  const name = tableDirectory(bytes)?.get('name');
  if (!name || name.offset + 6 > bytes.byteLength) return undefined;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const count = view.getUint16(name.offset + 2);
  const strings = name.offset + view.getUint16(name.offset + 4);
  const records: NameRecord[] = [];
  for (let i = 0; i < count; i++) {
    const r = name.offset + 6 + i * 12;
    if (r + 12 > bytes.byteLength) return undefined;
    const length = view.getUint16(r + 8);
    const start = strings + view.getUint16(r + 10);
    if (start + length > bytes.byteLength) continue;
    records.push({
      platform: view.getUint16(r),
      encoding: view.getUint16(r + 2),
      language: view.getUint16(r + 4),
      nameId: view.getUint16(r + 6),
      bytes: bytes.subarray(start, start + length),
    });
  }
  return records;
}

function utf16be(text: string): Uint8Array {
  const out = new Uint8Array(text.length * 2);
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    out[i * 2] = c >> 8;
    out[i * 2 + 1] = c & 0xff;
  }
  return out;
}

function decode(record: NameRecord): string | undefined {
  // Unicode, or Windows Unicode BMP / full repertoire: UTF-16BE.
  if (record.platform === 0 || (record.platform === 3 && (record.encoding === 1 || record.encoding === 10))) {
    let s = '';
    for (let i = 0; i + 1 < record.bytes.length; i += 2) s += String.fromCharCode((record.bytes[i]! << 8) | record.bytes[i + 1]!);
    return s;
  }
  // Mac Roman: the ASCII range is enough for a family name.
  if (record.platform === 1 && record.encoding === 0) return String.fromCharCode(...record.bytes);
  return undefined;
}

/** The family names a face file gives itself (typographic family, ID 16,
 *  and family, ID 1), in every language it gives them. */
export function faceFamilies(bytes: Uint8Array): string[] {
  const records = nameRecords(bytes) ?? [];
  const names = new Set<string>();
  for (const r of records) {
    if (r.nameId !== 1 && r.nameId !== 16) continue;
    const s = decode(r);
    if (s) names.add(s);
  }
  return [...names];
}

/**
 * A copy of a TrueType / OpenType file whose family names (IDs 1 and 16)
 * say `family`, the rest of the file untouched: the new `name` table is
 * appended and the table record pointed at it. Undefined for a collection
 * or a file with no `name` table, and when the file already names that
 * family.
 */
export function renameFace(bytes: Uint8Array, family: string): Uint8Array | undefined {
  const tables = tableDirectory(bytes);
  const name = tables?.get('name');
  const records = nameRecords(bytes);
  if (!tables || !name || !records) return undefined;
  if (faceFamilies(bytes).some((f) => f.toLowerCase() === family.toLowerCase())) return undefined;
  const kept = records.filter((r) => r.nameId !== 1 && r.nameId !== 16);
  const encoded = utf16be(family);
  for (const nameId of [1, 16]) kept.push({ platform: 3, encoding: 1, language: 0x409, nameId, bytes: encoded });
  kept.sort((a, b) => a.platform - b.platform || a.encoding - b.encoding || a.language - b.language || a.nameId - b.nameId);
  const header = 6 + kept.length * 12;
  const stringsLength = kept.reduce((n, r) => n + r.bytes.length, 0);
  const table = new Uint8Array(header + stringsLength);
  const tv = new DataView(table.buffer);
  tv.setUint16(0, 0);
  tv.setUint16(2, kept.length);
  tv.setUint16(4, header);
  let at = 0;
  kept.forEach((r, i) => {
    const o = 6 + i * 12;
    tv.setUint16(o, r.platform);
    tv.setUint16(o + 2, r.encoding);
    tv.setUint16(o + 4, r.language);
    tv.setUint16(o + 6, r.nameId);
    tv.setUint16(o + 8, r.bytes.length);
    tv.setUint16(o + 10, at);
    table.set(r.bytes, header + at);
    at += r.bytes.length;
  });
  if (at > 0xffff) return undefined;
  const start = Math.ceil(bytes.byteLength / 4) * 4;
  const out = new Uint8Array(start + Math.ceil(table.length / 4) * 4);
  out.set(bytes);
  out.set(table, start);
  const view = new DataView(out.buffer);
  view.setUint32(name.record + 8, start);
  view.setUint32(name.record + 12, table.length);
  let sum = 0;
  for (let i = 0; i < table.length; i += 4) {
    sum = (sum + (((table[i] ?? 0) << 24) | ((table[i + 1] ?? 0) << 16) | ((table[i + 2] ?? 0) << 8) | (table[i + 3] ?? 0))) >>> 0;
  }
  view.setUint32(name.record + 4, sum);
  return out;
}
