import { readFile } from 'node:fs/promises';
import { extname } from 'node:path';

const TEXT_EXTENSIONS = new Set(['.txt', '.md', '.markdown']);

/**
 * Turns a source document into a flat list of text lines with page numbers.
 * PDF and DOCX support loads its adapter lazily, so text-only runs stay light.
 */
export async function extractDocument(filePath) {
  const extension = extname(filePath).toLowerCase();

  if (TEXT_EXTENSIONS.has(extension)) {
    const content = await readFile(filePath, 'utf8');
    return { entries: toEntries(content), pages: null };
  }

  if (extension === '.html' || extension === '.htm') {
    const content = await readFile(filePath, 'utf8');
    return { entries: toEntries(htmlToText(content)), pages: null };
  }

  if (extension === '.pdf') {
    return extractPdf(filePath);
  }

  if (extension === '.docx') {
    return extractDocx(filePath);
  }

  throw new Error(
    `Format neacceptat: ${extension || '(fără extensie)'}. Folosește PDF, DOCX, TXT, MD sau HTML.`,
  );
}

function toEntries(text) {
  return text
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line, index) => ({
      text: line.replace(/\s+/g, ' ').trim(),
      line: index + 1,
      page: null,
    }))
    .filter((entry) => entry.text.length > 0);
}

async function extractPdf(filePath) {
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const data = new Uint8Array(await readFile(filePath));
  const document = await getDocument({ data, useSystemFonts: true }).promise;
  const entries = [];

  for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber++) {
    const page = await document.getPage(pageNumber);
    const content = await page.getTextContent();
    let line = '';

    for (const item of content.items) {
      if (typeof item.str !== 'string') continue;
      line += item.str;
      if (item.hasEOL) {
        pushLine(entries, line, pageNumber);
        line = '';
      } else {
        line += ' ';
      }
    }
    pushLine(entries, line, pageNumber);
  }

  return { entries, pages: document.numPages };
}

function pushLine(entries, line, pageNumber) {
  const text = line.replace(/\s+/g, ' ').trim();
  if (text) {
    entries.push({ text, line: entries.length + 1, page: pageNumber });
  }
}

async function extractDocx(filePath) {
  const mammoth = await import('mammoth');
  const result = await mammoth.extractRawText({ path: filePath });
  return { entries: toEntries(result.value), pages: null };
}

function htmlToText(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<\/(p|div|li|h[1-6]|tr|section|article)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}
