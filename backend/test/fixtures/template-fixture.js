// Minimal real OOXML DOCX fixture, built without third-party tooling so that
// this integration test ships as an ordinary text-only patch.
const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="xml" ContentType="application/xml"/>
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
</Types>`;
const rels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`;
const heading = (text) => `<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>${text}</w:t></w:r></w:p>`;
const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>
<w:p><w:pPr><w:pStyle w:val="Title"/></w:pPr><w:r><w:t>Example SOP Template</w:t></w:r></w:p>
${heading('Purpose')}<w:p><w:r><w:t>Replace this placeholder when exporting the approved draft.</w:t></w:r></w:p>
${heading('Procedure')}<w:p><w:r><w:t>Steps placeholder.</w:t></w:r></w:p>
${heading('Appendix')}<w:p><w:r><w:t>Unmapped template content.</w:t></w:r></w:p>
<w:sectPr/></w:body></w:document>`;
const style = (id, name, lvl) => `<w:style w:type="paragraph" w:styleId="${id}"><w:name w:val="${name}"/>${lvl === null ? '' : `<w:pPr><w:outlineLvl w:val="${lvl}"/></w:pPr>`}</w:style>`;
const stylesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
${style('Normal', 'Normal', null)}${style('Title', 'Title', null)}${style('Heading1', 'heading 1', 0)}${style('Heading2', 'heading 2', 1)}
</w:styles>`;

const CRC_TABLE = Array.from({ length: 256 }, (_, i) => {
  let n = i;
  for (let j = 0; j < 8; j++) n = (n & 1) ? (0xedb88320 ^ (n >>> 1)) : n >>> 1;
  return n >>> 0;
});
function crc32(buffer) {
  let crc = 0xffffffff;
  for (const octet of buffer) crc = CRC_TABLE[(crc ^ octet) & 255] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

export function makeTemplateFixture() {
  const files = [
    ['[Content_Types].xml', contentTypes],
    ['_rels/.rels', rels],
    ['word/document.xml', documentXml],
    ['word/styles.xml', stylesXml],
  ];
  const local = [], central = [];
  let offset = 0;
  for (const [filename, value] of files) {
    const name = Buffer.from(filename, 'utf8'), bytes = Buffer.from(value, 'utf8');
    const crc = crc32(bytes);
    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt32LE(crc, 14);
    localHeader.writeUInt32LE(bytes.length, 18);
    localHeader.writeUInt32LE(bytes.length, 22);
    localHeader.writeUInt16LE(name.length, 26);
    local.push(localHeader, name, bytes);
    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(20, 4);
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt32LE(crc, 16);
    centralHeader.writeUInt32LE(bytes.length, 20);
    centralHeader.writeUInt32LE(bytes.length, 24);
    centralHeader.writeUInt16LE(name.length, 28);
    centralHeader.writeUInt32LE(offset, 42);
    central.push(centralHeader, name);
    offset += localHeader.length + name.length + bytes.length;
  }
  const centralSize = central.reduce((total, part) => total + part.length, 0);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(files.length, 8);
  eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(centralSize, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, ...central, eocd]);
}
