/**
 * Offline Word export for the Milestone 7 editor. Everything is assembled in
 * the browser: private evidence is loaded through the existing authenticated
 * job adapter and is never sent to an export/conversion service.
 *
 * DOCX is an OpenXML ZIP, not a renamed HTML file. This writer intentionally
 * creates fresh Word-compatible styles; a custom template's semantic heading
 * mapping is respected, but its exact headers, pagination and graphical theme
 * are not reproduced by this first export version.
 */
import { zipSync } from 'fflate';
import type { DocumentData, Figure } from '../types';

type EvidenceLoader = (path: string) => Promise<Blob>;
type Archive = Record<string, Uint8Array>;
const encoder = new TextEncoder();
const EMU_PER_INCH = 914400;
const MAX_FIGURES = 80;
const MAX_IMAGE_BYTES = 12 * 1024 * 1024;
const MAX_TOTAL_IMAGE_BYTES = 72 * 1024 * 1024;
const XML_DECL = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
const WORD_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const REL_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const DRAW_NS = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const PICTURE_NS = 'http://schemas.openxmlformats.org/drawingml/2006/picture';
const WORD_DRAW_NS = 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing';

const utf = (s: string) => encoder.encode(s);
const xml = (text: string) => String(text)
  .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff]/g, '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
const textRun = (text: string, props = '') =>
  `<w:r>${props ? `<w:rPr>${props}</w:rPr>` : ''}<w:t xml:space="preserve">${xml(text)}</w:t></w:r>`;
const para = (runs: string, style = 'Normal', settings = '') =>
  `<w:p><w:pPr><w:pStyle w:val="${style}"/>${settings}</w:pPr>${runs || textRun('')}</w:p>`;

interface Marks { bold?: boolean; italic?: boolean; underline?: boolean; strike?: boolean; family?: string; size?: number }
function styledText(node: Node, marks: Marks = {}): string {
  if (node.nodeType === Node.TEXT_NODE) return (node.nodeValue || '').length ? textRun(node.nodeValue!, markProps(marks)) : '';
  if (node.nodeType !== Node.ELEMENT_NODE) return '';
  const el = node as HTMLElement;
  if (['SCRIPT', 'STYLE', 'SVG', 'IFRAME', 'OBJECT'].includes(el.tagName)) return '';
  if (el.tagName === 'BR') return '<w:r><w:br/></w:r>';
  const next = { ...marks };
  if (['STRONG', 'B'].includes(el.tagName)) next.bold = true;
  if (['EM', 'I'].includes(el.tagName)) next.italic = true;
  if (el.tagName === 'U') next.underline = true;
  if (['S', 'STRIKE', 'DEL'].includes(el.tagName)) next.strike = true;
  if (el.style?.fontWeight === 'bold' || Number(el.style?.fontWeight) >= 600) next.bold = true;
  if (el.style?.fontStyle === 'italic') next.italic = true;
  if (el.style?.textDecoration?.includes('underline')) next.underline = true;
  if (el.style?.textDecoration?.includes('line-through')) next.strike = true;
  if (el.style?.fontFamily) next.family = el.style.fontFamily.replace(/["']/g, '').slice(0, 60);
  if (el.style?.fontSize?.endsWith('px')) {
    const px = Number.parseFloat(el.style.fontSize);
    if (Number.isFinite(px) && px >= 8 && px <= 72) next.size = Math.round(px * 1.5);
  }
  return Array.from(el.childNodes).map((child) => styledText(child, next)).join('');
}
function markProps(marks: Marks): string {
  return [marks.bold ? '<w:b/>' : '', marks.italic ? '<w:i/>' : '',
    marks.underline ? '<w:u w:val="single"/>' : '', marks.strike ? '<w:strike/>' : '',
    marks.family ? `<w:rFonts w:ascii="${xml(marks.family)}" w:hAnsi="${xml(marks.family)}"/>` : '',
    marks.size ? `<w:sz w:val="${marks.size}"/>` : ''].join('');
}

/** Parse only presentation text: no HTML is copied into Word's XML. */
export function htmlToParagraphs(html: string): string[] {
  const parsed = new DOMParser().parseFromString(html, 'text/html');
  const output: string[] = [];
  const walk = (node: Node, list?: { type: 'ol' | 'ul'; level: number }) => {
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const el = node as HTMLElement;
    const tag = el.tagName.toLowerCase();
    if (tag === 'script' || tag === 'style') return;
    if (tag === 'ol' || tag === 'ul') {
      Array.from(el.children).forEach((child) => walk(child, { type: tag, level: Math.min(list ? list.level + 1 : 0, 7) }));
    } else if (tag === 'li') {
      const children = Array.from(el.childNodes).filter((child) => !(child instanceof HTMLElement && ['OL', 'UL'].includes(child.tagName)));
      const runs = children.map((child) => styledText(child)).join('');
      const level = list?.level || 0;
      output.push(para(runs, 'Normal',
        `<w:numPr><w:ilvl w:val="${level}"/><w:numId w:val="${list?.type === 'ol' ? 2 : 1}"/></w:numPr>`));
      Array.from(el.children).filter((c) => ['OL', 'UL'].includes(c.tagName)).forEach((child) => walk(child, list));
    } else if (['p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote', 'pre'].includes(tag)) {
      const align = ['left', 'right', 'center', 'justify'].includes(el.style.textAlign)
        ? `<w:jc w:val="${el.style.textAlign}"/>` : '';
      const style = /^h[1-6]$/.test(tag) ? (['h1', 'h2'].includes(tag) ? 'Heading2' : 'Heading3') : 'Normal';
      output.push(para(Array.from(el.childNodes).map((child) => styledText(child)).join(''), style, align));
    } else if (tag === 'br') {
      output.push(para(''));
    } else {
      for (const child of Array.from(node.childNodes)) walk(child, list);
    }
  };
  Array.from(parsed.body.childNodes).forEach((node) => {
    if (node.nodeType === Node.TEXT_NODE && node.textContent?.trim()) output.push(para(textRun(node.textContent)));
    else walk(node);
  });
  return output;
}

function imageInfo(data: Uint8Array): { type: 'png' | 'jpeg'; width: number; height: number } | null {
  if (data.length >= 24 && [137, 80, 78, 71, 13, 10, 26, 10].every((n, i) => data[i] === n)) {
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    return { type: 'png', width: view.getUint32(16), height: view.getUint32(20) };
  }
  if (data[0] === 0xff && data[1] === 0xd8) {
    let offset = 2;
    while (offset + 9 < data.length) {
      if (data[offset] !== 0xff) break;
      const marker = data[offset + 1];
      if (marker === 0xd9 || marker === 0xda) break;
      const length = (data[offset + 2] << 8) + data[offset + 3];
      if (length < 2 || offset + 2 + length > data.length) break;
      if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb].includes(marker)) {
        return { type: 'jpeg', height: (data[offset + 5] << 8) + data[offset + 6],
          width: (data[offset + 7] << 8) + data[offset + 8] };
      }
      offset += length + 2;
    }
  }
  return null;
}
/**
 * Browsers support reading Blob bytes with FileReader. Some Blob implementations
 * (including the jsdom Blob used by Vitest) do not implement arrayBuffer().
 * Keep the native fast path when available and use FileReader otherwise.
 */
async function readBlobBytes(blob: Blob): Promise<Uint8Array> {
  if (typeof blob.arrayBuffer === 'function') {
    return new Uint8Array(await blob.arrayBuffer());
  }
  if (typeof FileReader === 'undefined') {
    throw new Error('This environment cannot read evidence images.');
  }
  return new Promise<Uint8Array>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (reader.result instanceof ArrayBuffer) resolve(new Uint8Array(reader.result));
      else reject(new Error('Cannot read the evidence image.'));
    };
    reader.onerror = () => reject(reader.error ?? new Error('Cannot read the evidence image.'));
    reader.onabort = () => reject(new Error('Evidence image read was cancelled.'));
    try { reader.readAsArrayBuffer(blob); } catch (error) { reject(error); }
  });
}

async function normaliseImage(blob: Blob): Promise<{ bytes: Uint8Array; type: 'png' | 'jpeg'; width: number; height: number }> {
  if (blob.size > MAX_IMAGE_BYTES) throw new Error('An evidence image exceeds the 12 MiB Word export limit.');
  const bytes = await readBlobBytes(blob);
  const parsed = imageInfo(bytes);
  if (parsed) {
    if (parsed.width < 1 || parsed.height < 1 || parsed.width > 12000 || parsed.height > 12000)
      throw new Error('An evidence image has invalid dimensions.');
    return { bytes, ...parsed };
  }
  // WebP evidence is converted locally. Never upload it to an external service.
  if (blob.type === 'image/webp' && typeof createImageBitmap === 'function') {
    const bitmap = await createImageBitmap(blob);
    try {
      const canvas = document.createElement('canvas');
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      if (!canvas.width || !canvas.height || canvas.width > 12000 || canvas.height > 12000)
        throw new Error('Evidence image dimensions are invalid.');
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('Cannot convert the WebP evidence image.');
      ctx.drawImage(bitmap, 0, 0);
      const png = await new Promise<Blob>((resolve, reject) => canvas.toBlob((value) =>
        value ? resolve(value) : reject(new Error('Cannot convert the WebP evidence image.')), 'image/png'));
      return normaliseImage(png);
    } finally { bitmap.close(); }
  }
  throw new Error('Unsupported evidence image type. Word export accepts PNG, JPEG or convertible WebP.');
}

function imageParagraph(relId: string, number: number, width: number, height: number, caption: string): string {
  // Fit images within A4 text width and a reasonable page height; preserve ratio.
  const scale = Math.min(1, 6.2 * EMU_PER_INCH / width, 5.35 * EMU_PER_INCH / height);
  const cx = Math.max(1, Math.round(width * scale));
  const cy = Math.max(1, Math.round(height * scale));
  const safeCaption = xml(caption || `Figure ${number}`);
  return `<w:p><w:pPr><w:jc w:val="center"/><w:spacing w:before="100" w:after="60"/></w:pPr><w:r><w:drawing>` +
    `<wp:inline distT="0" distB="0" distL="0" distR="0" xmlns:wp="${WORD_DRAW_NS}">` +
    `<wp:extent cx="${cx}" cy="${cy}"/><wp:docPr id="${number}" name="Figure ${number}" descr="${safeCaption}"/>` +
    `<a:graphic xmlns:a="${DRAW_NS}"><a:graphicData uri="${PICTURE_NS}">` +
    `<pic:pic xmlns:pic="${PICTURE_NS}"><pic:nvPicPr><pic:cNvPr id="0" name="Figure ${number}"/><pic:cNvPicPr/></pic:nvPicPr>` +
    `<pic:blipFill><a:blip r:embed="${relId}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>` +
    `<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm>` +
    `<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic>` +
    `</a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>`;
}
const stylesXml = `${XML_DECL}<w:styles xmlns:w="${WORD_NS}">` +
  `<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Aptos" w:hAnsi="Aptos"/><w:sz w:val="22"/></w:rPr></w:rPrDefault></w:docDefaults>` +
  `<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:pPr><w:spacing w:after="150" w:line="290" w:lineRule="auto"/></w:pPr></w:style>` +
  `<w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:after="300"/></w:pPr><w:rPr><w:b/><w:sz w:val="36"/><w:color w:val="20283B"/></w:rPr></w:style>` +
  `<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:pPr><w:keepNext/><w:spacing w:before="280" w:after="125"/><w:outlineLvl w:val="0"/></w:pPr><w:rPr><w:b/><w:sz w:val="28"/><w:color w:val="2B3652"/></w:rPr></w:style>` +
  `<w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:basedOn w:val="Normal"/><w:pPr><w:keepNext/><w:spacing w:before="220" w:after="95"/><w:outlineLvl w:val="1"/></w:pPr><w:rPr><w:b/><w:sz w:val="24"/><w:color w:val="35435E"/></w:rPr></w:style>` +
  `<w:style w:type="paragraph" w:styleId="Heading3"><w:name w:val="heading 3"/><w:basedOn w:val="Normal"/><w:pPr><w:keepNext/><w:outlineLvl w:val="2"/></w:pPr><w:rPr><w:b/></w:rPr></w:style>` +
  `<w:style w:type="paragraph" w:styleId="Caption"><w:name w:val="caption"/><w:basedOn w:val="Normal"/><w:pPr><w:jc w:val="center"/><w:spacing w:after="190"/></w:pPr><w:rPr><w:i/><w:sz w:val="19"/><w:color w:val="616C80"/></w:rPr></w:style>` +
  `</w:styles>`;
const numberingXml = `${XML_DECL}<w:numbering xmlns:w="${WORD_NS}">` +
  `<w:abstractNum w:abstractNumId="0">${Array.from({ length: 8 }, (_, i) => `<w:lvl w:ilvl="${i}"><w:start w:val="1"/><w:numFmt w:val="bullet"/><w:lvlText w:val="•"/><w:lvlJc w:val="left"/></w:lvl>`).join('')}</w:abstractNum>` +
  `<w:abstractNum w:abstractNumId="1">${Array.from({ length: 8 }, (_, i) => `<w:lvl w:ilvl="${i}"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%${i + 1}."/><w:lvlJc w:val="left"/></w:lvl>`).join('')}</w:abstractNum>` +
  `<w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num><w:num w:numId="2"><w:abstractNumId w:val="1"/></w:num></w:numbering>`;

function safeName(value: string) {
  return (value.trim().replace(/[\\/:*?"<>|\u0000-\u001f]/g, '-').replace(/\.+$/g, '').slice(0, 90) || 'DocuAI Document') + '.docx';
}
export interface WordExport { filename: string; bytes: Uint8Array; figureCount: number }

export async function buildWordDocument(doc: DocumentData, getEvidence: EvidenceLoader): Promise<WordExport> {
  if (!doc.sections.length) throw new Error('There are no document sections to export.');
  const archive: Archive = {};
  const paragraphs: string[] = [para(textRun(doc.title), 'Title')];
  if (doc.docType.trim()) paragraphs.push(para(textRun(doc.docType)));
  const relationships: string[] = [
    `<Relationship Id="rId1" Type="${REL_NS}/styles" Target="styles.xml"/>`,
    `<Relationship Id="rId2" Type="${REL_NS}/numbering" Target="numbering.xml"/>`,
  ];
  const imageTypes = new Set<string>();
  let figureCount = 0;
  let totalBytes = 0;
  const cache = new Map<string, { relId: string; width: number; height: number }>();
  for (const section of doc.sections) {
    const step = /^\d+(?:\.\d+)*[.)]?\s+/.test(section.heading);
    const templateMapped = doc.templateLayout?.sections.find((s) => s.heading === section.heading);
    const style = step || templateMapped?.headingStyleId === 'Heading2' ? 'Heading2' : 'Heading1';
    paragraphs.push(para(textRun(section.heading), style));
    paragraphs.push(...htmlToParagraphs(section.html));
    for (const figure of section.blocks) {
      if (++figureCount > MAX_FIGURES) throw new Error('This document has more than 80 figures; export it in smaller parts.');
      const path = evidencePath(doc, figure);
      if (!path) throw new Error(`Missing image URL for figure ${figureCount}. Export stopped rather than omitting evidence.`);
      let image = cache.get(path);
      if (!image) {
        const blob = await getEvidence(path);
        const normalized = await normaliseImage(blob);
        totalBytes += normalized.bytes.byteLength;
        if (totalBytes > MAX_TOTAL_IMAGE_BYTES) throw new Error('Images exceed the 72 MiB total Word export limit.');
        const fileId = cache.size + 1;
        const relId = `rId${fileId + 2}`;
        const ext = normalized.type === 'jpeg' ? 'jpg' : 'png';
        archive[`word/media/evidence-${fileId}.${ext}`] = normalized.bytes;
        imageTypes.add(normalized.type);
        relationships.push(`<Relationship Id="${relId}" Type="${REL_NS}/image" Target="media/evidence-${fileId}.${ext}"/>`);
        // Pixel->EMU conversion at 96 DPI, bounded by page dimensions above.
        image = { relId, width: Math.round(normalized.width * 9525), height: Math.round(normalized.height * 9525) };
        cache.set(path, image);
      }
      paragraphs.push(imageParagraph(image.relId, figureCount, image.width, image.height, figure.caption));
      paragraphs.push(para(textRun(`Figure ${figureCount}. ${figure.caption}`), 'Caption'));
      if (figure.checkpoint) paragraphs.push(para(textRun(`Checkpoint: ${figure.checkpoint}`)));
    }
    for (const flag of section.flags) paragraphs.push(para(textRun(`Review required: ${flag.text}`)));
  }
  const sectPr = `<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1300" w:right="1200" w:bottom="1300" w:left="1200" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr>`;
  archive['word/document.xml'] = utf(`${XML_DECL}<w:document xmlns:w="${WORD_NS}" xmlns:r="${REL_NS}"><w:body>${paragraphs.join('')}${sectPr}</w:body></w:document>`);
  archive['word/styles.xml'] = utf(stylesXml);
  archive['word/numbering.xml'] = utf(numberingXml);
  archive['word/_rels/document.xml.rels'] = utf(`${XML_DECL}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${relationships.join('')}</Relationships>`);
  archive['_rels/.rels'] = utf(`${XML_DECL}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${REL_NS}/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>`);
  archive['docProps/core.xml'] = utf(`${XML_DECL}<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>${xml(doc.title)}</dc:title><dc:creator>DocuAI</dc:creator></cp:coreProperties>`);
  archive['[Content_Types].xml'] = utf(`${XML_DECL}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
    `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
    `<Default Extension="xml" ContentType="application/xml"/>` +
    (imageTypes.has('png') ? `<Default Extension="png" ContentType="image/png"/>` : '') +
    (imageTypes.has('jpeg') ? `<Default Extension="jpg" ContentType="image/jpeg"/>` : '') +
    `<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>` +
    `<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>` +
    `<Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/>` +
    `<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>`);
  return { filename: safeName(doc.title), bytes: new Uint8Array(zipSync(archive, { level: 6 })), figureCount };
}

function evidencePath(doc: DocumentData, figure: Figure): string | undefined {
  return figure.fileUrl || doc.frames?.find((item) => item.frameId === figure.frameId)?.fileUrl;
}

export function downloadWordDocument(file: WordExport): void {
  const blob = new Blob([new Uint8Array(file.bytes)], {
    type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  });
  const url = URL.createObjectURL(blob);
  try {
    const link = document.createElement('a');
    link.href = url;
    link.download = file.filename;
    document.body.append(link);
    link.click();
    link.remove();
  } finally { setTimeout(() => URL.revokeObjectURL(url), 30_000); }
}
