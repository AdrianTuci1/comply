import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';

import JSZip from 'jszip';

import { extractDocument } from '../src/extract.mjs';
import { tempDir } from './helpers.mjs';

function buildPdf(lines) {
  const escape = (line) => line.replace(/[()\\]/g, '\\$&');
  const stream = `BT /F1 12 Tf 72 720 Td 16 TL\n${lines
    .map((line, index) => `${index === 0 ? '' : 'T* '}(${escape(line)}) Tj`)
    .join('\n')}\nET`;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];

  let pdf = '%PDF-1.4\n';
  const offsets = [];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) pdf += `${String(offset).padStart(10, '0')} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf, 'latin1');
}

test('extrage text din TXT păstrând numerele de linie', async (t) => {
  const directory = await tempDir(t);
  const path = join(directory, 'source.txt');
  await writeFile(path, 'Articolul 21\nMăsuri de securitate\n', 'utf8');

  const result = await extractDocument(path);
  assert.equal(result.pages, null);
  assert.deepEqual(result.entries, [
    { text: 'Articolul 21', line: 1, page: null },
    { text: 'Măsuri de securitate', line: 2, page: null },
  ]);
});

test('extrage text din HTML fără scripturi și stiluri', async (t) => {
  const directory = await tempDir(t);
  const path = join(directory, 'source.html');
  await writeFile(
    path,
    '<html><head><style>.x{color:red}</style></head><body><h1>Articolul 9</h1><p>Riscul &amp; controlul</p><script>alert(1)</script></body></html>',
    'utf8',
  );

  const result = await extractDocument(path);
  assert.deepEqual(
    result.entries.map((entry) => entry.text),
    ['Articolul 9', 'Riscul & controlul'],
  );
});

test('extrage text din PDF și reține numărul paginii', async (t) => {
  const directory = await tempDir(t);
  const path = join(directory, 'source.pdf');
  await writeFile(path, buildPdf(['Article 9', 'Risk management system']));

  const result = await extractDocument(path);
  assert.equal(result.pages, 1);
  assert.ok(result.entries.some((entry) => entry.text.includes('Article 9')));
  assert.ok(result.entries.every((entry) => entry.page === 1));
});

test('extrage text din DOCX', async (t) => {
  const directory = await tempDir(t);
  const zip = new JSZip();
  zip.file(
    '[Content_Types].xml',
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
  );
  zip.file(
    '_rels/.rels',
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
  );
  zip.file(
    'word/document.xml',
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Articolul 9</w:t></w:r></w:p><w:p><w:r><w:t>Sistem de management al riscului</w:t></w:r></w:p></w:body></w:document>',
  );

  const path = join(directory, 'source.docx');
  await writeFile(path, await zip.generateAsync({ type: 'nodebuffer' }));

  const result = await extractDocument(path);
  assert.deepEqual(
    result.entries.map((entry) => entry.text),
    ['Articolul 9', 'Sistem de management al riscului'],
  );
});

test('refuză formatele necunoscute cu un mesaj clar', async (t) => {
  const directory = await tempDir(t);
  const path = join(directory, 'source.rtf');
  await writeFile(path, 'test', 'utf8');

  await assert.rejects(() => extractDocument(path), /Format neacceptat/);
});
