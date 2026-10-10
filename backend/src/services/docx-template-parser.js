import { createHash } from 'node:crypto';
import { inflateRawSync } from 'node:zlib';
import { AppError } from '../utils/app-error.js';

// Deliberately minimal, read-only DOCX inspection. Do not render or execute
// uploaded OOXML. Original bytes are kept private for a later export milestone.
export const MAX_TEMPLATE_BYTES = 8 * 1024 * 1024;
const MAX_UNPACKED_BYTES = 24 * 1024 * 1024;
const MAX_ENTRY_BYTES = 6 * 1024 * 1024;
const MAX_ENTRIES = 512;
const CRC_TABLE = Array.from({ length: 256 }, (_, i) => {
  let n = i;
  for (let j = 0; j < 8; j++) n = (n & 1) ? (0xedb88320 ^ (n >>> 1)) : n >>> 1;
  return n >>> 0;
});
function crc32(bytes) {
  let c = 0xffffffff;
  for (const byte of bytes) c = CRC_TABLE[(c ^ byte) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
const invalid = () => new AppError(415, 'INVALID_DOCX_TEMPLATE', 'Upload a valid, unencrypted .docx Word document.');
const entityDecode = (value) => value.replace(/&(?:amp|lt|gt|quot|apos|#x[0-9a-f]+|#[0-9]+);/gi, (entity) => {
  const known = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&apos;': "'" };
  if (known[entity.toLowerCase()] !== undefined) return known[entity.toLowerCase()];
  const hex = entity.startsWith('&#x') || entity.startsWith('&#X');
  const codePoint = Number.parseInt(entity.slice(hex ? 3 : 2, -1), hex ? 16 : 10);
  return Number.isInteger(codePoint) && codePoint > 0 && codePoint <= 0x10ffff
    && !(codePoint >= 0xd800 && codePoint <= 0xdfff) ? String.fromCodePoint(codePoint) : '';
});
const xmlText = (xml) => entityDecode([...xml.matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g)]
  .map((m) => m[1]).join('')).trim();

// ZIP central directory is the authoritative index. Never follow local file
// names or paths and never decompress arbitrary contents beyond tight limits.
function readZip(buffer) {
  if (buffer.length < 22 || buffer.length > MAX_TEMPLATE_BYTES) throw invalid();
  let eocd = -1;
  for (let i = buffer.length - 22; i >= Math.max(0, buffer.length - 65557); i--) {
    if (buffer.readUInt32LE(i) === 0x06054b50 && i + 22 + buffer.readUInt16LE(i + 20) === buffer.length) {
      eocd = i; break;
    }
  }
  if (eocd < 0 || buffer.readUInt16LE(eocd + 4) !== 0 || buffer.readUInt16LE(eocd + 6) !== 0) throw invalid();
  const entryCount = buffer.readUInt16LE(eocd + 10);
  const length = buffer.readUInt32LE(eocd + 12);
  const offset = buffer.readUInt32LE(eocd + 16);
  if (entryCount < 3 || entryCount > MAX_ENTRIES || length === 0xffffffff || offset === 0xffffffff
    || offset + length > eocd) throw invalid();
  const files = new Map();
  let cursor = offset, totalSize = 0;
  for (let i = 0; i < entryCount; i++) {
    if (cursor + 46 > eocd || buffer.readUInt32LE(cursor) !== 0x02014b50) throw invalid();
    const flags = buffer.readUInt16LE(cursor + 8);
    const method = buffer.readUInt16LE(cursor + 10);
    const checksum = buffer.readUInt32LE(cursor + 16);
    const compressed = buffer.readUInt32LE(cursor + 20);
    const uncompressed = buffer.readUInt32LE(cursor + 24);
    const nameLen = buffer.readUInt16LE(cursor + 28);
    const extraLen = buffer.readUInt16LE(cursor + 30);
    const commentLen = buffer.readUInt16LE(cursor + 32);
    const localOffset = buffer.readUInt32LE(cursor + 42);
    if (cursor + 46 + nameLen + extraLen + commentLen > eocd || flags & 1
      || (method !== 0 && method !== 8) || compressed === 0xffffffff || uncompressed === 0xffffffff
      || uncompressed > MAX_ENTRY_BYTES || (totalSize += uncompressed) > MAX_UNPACKED_BYTES) throw invalid();
    const name = buffer.toString('utf8', cursor + 46, cursor + 46 + nameLen);
    if (!name || name.startsWith('/') || name.includes('\\') || name.split('/').includes('..') || files.has(name)) throw invalid();
    files.set(name, { method, compressed, uncompressed, localOffset, checksum });
    cursor += 46 + nameLen + extraLen + commentLen;
  }
  if (cursor !== offset + length) throw invalid();
  if ([...files.keys()].some((name) => /(?:vbaProject|\.bin$|activeX|embeddings\/)/i.test(name))) throw invalid();
  function extract(name) {
    const entry = files.get(name);
    if (!entry || entry.localOffset + 30 > buffer.length || buffer.readUInt32LE(entry.localOffset) !== 0x04034b50) throw invalid();
    const localNameLen = buffer.readUInt16LE(entry.localOffset + 26);
    const localExtraLen = buffer.readUInt16LE(entry.localOffset + 28);
    const start = entry.localOffset + 30 + localNameLen + localExtraLen;
    if (start + entry.compressed > buffer.length) throw invalid();
    const raw = buffer.subarray(start, start + entry.compressed);
    let value;
    try { value = entry.method === 0 ? raw : inflateRawSync(raw, { maxOutputLength: entry.uncompressed + 1 }); }
    catch { throw invalid(); }
    if (value.length !== entry.uncompressed || crc32(value) !== entry.checksum) throw invalid();
    return value.toString('utf8');
  }
  return { files, extract };
}

function getStyles(xml) {
  const styles = new Map();
  for (const m of xml.matchAll(/<w:style\b([^>]*)>([\s\S]*?)<\/w:style>/g)) {
    const id = /\bw:styleId="([^"]+)"/.exec(m[1])?.[1];
    if (!id) continue;
    const name = /<w:name\b[^>]*\bw:val="([^"]+)"/.exec(m[2])?.[1] ?? id;
    const outline = /<w:outlineLvl\b[^>]*\bw:val="([0-9]+)"/.exec(m[2])?.[1];
    styles.set(id, { id: id.slice(0, 100), name: entityDecode(name).slice(0, 100),
      level: outline === undefined ? null : Number(outline) + 1 });
  }
  return styles;
}

function parseHeadings(xml, styles) {
  const headings = [];
  for (const p of xml.matchAll(/<w:p(?:\s[^>]*)?>([\s\S]*?)<\/w:p>/g)) {
    const text = xmlText(p[1]).replace(/\s+/g, ' ').slice(0, 180);
    if (!text) continue;
    const styleId = /<w:pStyle\b[^>]*\bw:val="([^"]+)"/.exec(p[1])?.[1];
    const style = styles.get(styleId);
    const inferred = /^Heading([1-6])$/i.exec(styleId ?? '');
    const level = style?.level ?? (inferred ? Number(inferred[1]) : null);
    if (level !== null && level >= 1 && level <= 6 && headings.length < 50) {
      headings.push({ heading: text, styleId: styleId?.slice(0, 100) ?? 'Heading1', level });
    }
  }
  return headings;
}

export function inspectDocxTemplate(buffer, filename = 'template.docx') {
  if (!Buffer.isBuffer(buffer) || buffer.length > MAX_TEMPLATE_BYTES || !/\.docx$/i.test(filename)) throw invalid();
  const zip = readZip(buffer);
  const types = zip.extract('[Content_Types].xml');
  if (!/wordprocessingml\.document\.main\+xml/i.test(types) || /macroEnabled/i.test(types)) throw invalid();
  const doc = zip.extract('word/document.xml');
  const styleXml = zip.files.has('word/styles.xml') ? zip.extract('word/styles.xml') : '';
  if (!/<w:document\b/.test(doc) || !/<w:body\b/.test(doc) || /<!DOCTYPE|<!ENTITY/i.test(doc + styleXml)) throw invalid();
  const styles = getStyles(styleXml);
  const headings = parseHeadings(doc, styles);
  const hasStyle = (id) => styles.has(id);
  return {
    source: 'uploaded', filename: filename.slice(0, 160),
    sha256: createHash('sha256').update(buffer).digest('hex'), byteSize: buffer.length,
    styles: { title: hasStyle('Title') ? 'Title' : 'Normal',
      heading1: hasStyle('Heading1') ? 'Heading1' : headings[0]?.styleId ?? 'Normal',
      heading2: hasStyle('Heading2') ? 'Heading2' : 'Normal',
      body: hasStyle('Normal') ? 'Normal' : 'Normal' },
    templateHeadings: headings,
  };
}

export function defaultTemplateProfile() {
  return { source: 'default', filename: null, sha256: null, byteSize: null,
    styles: { title: 'Title', heading1: 'Heading1', heading2: 'Heading2', body: 'Normal' },
    templateHeadings: [] };
}
