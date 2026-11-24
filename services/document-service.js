'use strict';

const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs/promises');
const { spawn } = require('node:child_process');

const MAX_DOCUMENT_BYTES = 15 * 1024 * 1024;
const MAX_EXTRACTED_CHARS = 2_000_000;
const MAX_DOCX_UNCOMPRESSED_BYTES = 32 * 1024 * 1024;
const MAX_DOCX_ENTRIES = 4096;
const MAX_OCR_PAGES = 8;
const MAX_OCR_IMAGE_BYTES = 18 * 1024 * 1024;
const MAX_OCR_PAGE_CHARS = 180_000;
const MAX_OCR_TOTAL_CHARS = 900_000;
const OCR_PAGE_TIMEOUT_MS = 22_000;

function runProcess(command, args, { timeoutMs = OCR_PAGE_TIMEOUT_MS, maxOutputBytes = 1_000_000 } = {}) {
  return new Promise((resolve, reject) => {
    let child;
    try { child = spawn(command, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }); }
    catch (error) { reject(error); return; }
    const stdout = []; const stderr = []; let stdoutBytes = 0; let stderrBytes = 0; let settled = false;
    const finish = (error, value) => { if (settled) return; settled = true; clearTimeout(timer); error ? reject(error) : resolve(value); };
    const timer = setTimeout(() => { child.kill(); finish(new Error(`${command} timed out.`)); }, timeoutMs);
    child.stdout.on('data', chunk => { stdoutBytes += chunk.length; if (stdoutBytes > maxOutputBytes) { child.kill(); finish(new Error(`${command} output exceeded its safety limit.`)); return; } stdout.push(chunk); });
    child.stderr.on('data', chunk => { if (stderrBytes < 24_000) { const kept = chunk.subarray(0, 24_000 - stderrBytes); stderr.push(kept); stderrBytes += kept.length; } });
    child.on('error', error => finish(new Error(`${command} is unavailable: ${error.message}`)));
    child.on('close', code => {
      if (settled) return;
      const errorText = Buffer.concat(stderr).toString('utf8').trim().slice(0, 500);
      if (code !== 0) finish(new Error(`${command} exited with code ${code}${errorText ? `: ${errorText}` : ''}`));
      else finish(null, Buffer.concat(stdout, stdoutBytes).toString('utf8'));
    });
  });
}

async function extractPdfOcr(buffer, pageCount, selectedPages = null) {
  const requestedPages = Array.isArray(selectedPages)
    ? [...new Set(selectedPages.map(Number).filter(page => Number.isInteger(page) && page >= 1 && page <= pageCount))].sort((a, b) => a - b)
    : Array.from({ length: Math.min(Number(pageCount) || 0, MAX_OCR_PAGES) }, (_, index) => index + 1);
  const pageNumbers = requestedPages.slice(0, MAX_OCR_PAGES);
  if (!pageNumbers.length) return { text: '', pages: 0, truncated: false, error: null };
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'local-ai-runner-ocr-'));
  const pdfPath = path.join(directory, 'source.pdf');
  const deadline = Date.now() + 60_000;
  let text = ''; let pages = 0; let errorMessage = null;
  try {
    await fs.writeFile(pdfPath, buffer, { flag: 'wx', mode: 0o600 });
    for (const page of pageNumbers) {
      const remaining = deadline - Date.now();
      if (remaining <= 0) { errorMessage = 'OCR reached its 60-second document time limit.'; break; }
      const prefix = path.join(directory, `page-${page}`);
      try {
        await runProcess('pdftoppm', ['-f', String(page), '-l', String(page), '-r', '120', '-scale-to', '2400', '-png', '-singlefile', pdfPath, prefix], { timeoutMs: Math.min(OCR_PAGE_TIMEOUT_MS, remaining), maxOutputBytes: 64_000 });
        const imagePath = `${prefix}.png`;
        const stat = await fs.stat(imagePath);
        if (!stat.isFile() || stat.size <= 0 || stat.size > MAX_OCR_IMAGE_BYTES) throw new Error(`OCR page ${page} image exceeded the 18 MB safety limit.`);
        const ocrRemaining = deadline - Date.now();
        if (ocrRemaining <= 0) { errorMessage = 'OCR reached its 60-second document time limit.'; break; }
        const pageText = await runProcess('tesseract', [imagePath, 'stdout', '-l', 'eng', '--psm', '6', '-c', 'preserve_interword_spaces=1'], { timeoutMs: Math.min(OCR_PAGE_TIMEOUT_MS, ocrRemaining), maxOutputBytes: MAX_OCR_PAGE_CHARS });
        const clean = pageText.replace(/\u0000/g, '').trim().slice(0, MAX_OCR_PAGE_CHARS);
        if (clean) { text += `${text ? '\n\n' : ''}[Page ${page} · OCR]\n${clean}`; pages++; }
        if (text.length >= MAX_OCR_TOTAL_CHARS) { text = text.slice(0, MAX_OCR_TOTAL_CHARS); break; }
      } catch (error) {
        errorMessage = error.message;
        break;
      }
    }
    return { text, pages, truncated: Number(pageCount) > pageNumbers.length || requestedPages.length > pageNumbers.length || text.length >= MAX_OCR_TOTAL_CHARS || pages < requestedPages.length, error: errorMessage };
  } finally { await fs.rm(directory, { recursive: true, force: true }).catch(() => {}); }
}

function validateDocxArchive(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 22) throw new Error('The DOCX archive is incomplete or invalid.');
  const minimumOffset = Math.max(0, buffer.length - 22 - 0xffff);
  let endRecord = -1;
  for (let offset = buffer.length - 22; offset >= minimumOffset; offset--) {
    if (buffer.readUInt32LE(offset) === 0x06054b50) {
      const commentLength = buffer.readUInt16LE(offset + 20);
      if (offset + 22 + commentLength === buffer.length) { endRecord = offset; break; }
    }
  }
  if (endRecord < 0) throw new Error('The DOCX archive is incomplete or invalid.');
  const diskNumber = buffer.readUInt16LE(endRecord + 4);
  const directoryDisk = buffer.readUInt16LE(endRecord + 6);
  const entriesOnDisk = buffer.readUInt16LE(endRecord + 8);
  const totalEntries = buffer.readUInt16LE(endRecord + 10);
  const directorySize = buffer.readUInt32LE(endRecord + 12);
  const directoryOffset = buffer.readUInt32LE(endRecord + 16);
  if (diskNumber || directoryDisk || entriesOnDisk !== totalEntries) throw new Error('Multi-part DOCX archives are not supported.');
  if (totalEntries === 0xffff || directorySize === 0xffffffff || directoryOffset === 0xffffffff) throw new Error('ZIP64 DOCX archives are not supported.');
  if (totalEntries > MAX_DOCX_ENTRIES || directoryOffset + directorySize > endRecord) throw new Error('The DOCX archive structure exceeds the supported limits.');

  let position = directoryOffset;
  let totalUncompressed = 0;
  for (let index = 0; index < totalEntries; index++) {
    if (position + 46 > endRecord || buffer.readUInt32LE(position) !== 0x02014b50) throw new Error('The DOCX archive contains an invalid directory entry.');
    const flags = buffer.readUInt16LE(position + 8);
    const method = buffer.readUInt16LE(position + 10);
    const compressedSize = buffer.readUInt32LE(position + 20);
    const uncompressedSize = buffer.readUInt32LE(position + 24);
    const nameLength = buffer.readUInt16LE(position + 28);
    const extraLength = buffer.readUInt16LE(position + 30);
    const commentLength = buffer.readUInt16LE(position + 32);
    const next = position + 46 + nameLength + extraLength + commentLength;
    if (next > directoryOffset + directorySize || next > endRecord) throw new Error('The DOCX archive directory is truncated.');
    if (flags & 0x41) throw new Error('Encrypted DOCX archives are not supported.');
    if (method !== 0 && method !== 8) throw new Error('The DOCX archive uses an unsupported compression method.');
    if (compressedSize === 0xffffffff || uncompressedSize === 0xffffffff) throw new Error('ZIP64 DOCX entries are not supported.');
    totalUncompressed += uncompressedSize;
    if (totalUncompressed > MAX_DOCX_UNCOMPRESSED_BYTES) throw new Error('The DOCX expands beyond the 32 MB extraction safety limit.');
    position = next;
  }
  if (position !== directoryOffset + directorySize) throw new Error('The DOCX archive directory size is inconsistent.');
  return { entries: totalEntries, uncompressedBytes: totalUncompressed };
}

async function extractDocument({ name, base64 }) {
  const filename = String(name || 'document').slice(0, 180);
  const extension = path.extname(filename).toLowerCase();
  if (typeof base64 !== 'string' || base64.length > Math.ceil(MAX_DOCUMENT_BYTES * 1.4)) {
    throw new Error('Document exceeds the 15 MB upload limit.');
  }
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(base64) || base64.length % 4 === 1) throw new Error('Document data is not valid base64.');
  const buffer = Buffer.from(base64, 'base64');
  if (!buffer.length || buffer.length > MAX_DOCUMENT_BYTES) throw new Error('Document is empty or too large.');

  let text = '';
  let extractionTruncated = false;
  let ocrUsed = false;
  let documentPageCount = 0;
  const pagesNeedingOcr = [];
  if (extension === '.pdf') {
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const document = await pdfjs.getDocument({
      data: new Uint8Array(buffer),
      useSystemFonts: true,
      isEvalSupported: false,
      stopAtErrors: true,
      maxImageSize: 0,
      disableFontFace: true
    }).promise;
    try {
      documentPageCount = document.numPages;
      const pages = [];
      let extractedCharacters = 0;
      const pageLimit = Math.min(document.numPages, 500);
      for (let pageNumber = 1; pageNumber <= pageLimit; pageNumber++) {
        const page = await document.getPage(pageNumber);
        const content = await page.getTextContent();
        const line = content.items.map(item => item.str || '').join(' ').replace(/\s+/g, ' ').trim();
        if (line.length < 40) pagesNeedingOcr.push(pageNumber);
        if (line) {
          const pageText = `[Page ${pageNumber}]\n${line}`;
          const remaining = Math.max(0, MAX_EXTRACTED_CHARS - extractedCharacters);
          if (pageText.length > remaining) {
            if (remaining > 0) pages.push(pageText.slice(0, remaining));
            extractedCharacters += Math.min(pageText.length, remaining);
            extractionTruncated = true;
            break;
          }
          pages.push(pageText);
          extractedCharacters += pageText.length;
        }
        if (extractedCharacters >= MAX_EXTRACTED_CHARS) {
          extractionTruncated = pageNumber < document.numPages;
          break;
        }
      }
      text = pages.join('\n\n');
      if (document.numPages > pageLimit) extractionTruncated = true;
      if (extractionTruncated) text += `\n\n[Extraction stopped at the ${MAX_EXTRACTED_CHARS.toLocaleString()} character limit or 500-page limit.]`;
    } finally { await document.destroy(); }
  } else if (extension === '.docx') {
    validateDocxArchive(buffer);
    const mammoth = require('mammoth');
    const result = await mammoth.extractRawText({ buffer });
    text = result.value || '';
  } else {
    throw new Error('Only PDF and DOCX are supported by the document extraction service.');
  }

  text = String(text).replace(/\u0000/g, '').trim();
  let ocrWarning = '';
  if (extension === '.pdf' && (text.length < 80 || pagesNeedingOcr.length)) {
    try {
      const targets = text.length < 80 ? null : pagesNeedingOcr;
      const ocr = await extractPdfOcr(buffer, documentPageCount || 0, targets);
      if (ocr.text) { text = [text, ocr.text].filter(Boolean).join('\n\n'); ocrUsed = ocr.pages > 0; }
      extractionTruncated = extractionTruncated || ocr.truncated;
      if (ocr.error) ocrWarning = `Some scanned pages could not be OCR processed: ${ocr.error}`;
    } catch (error) {
      ocrWarning = `Scanned-PDF OCR needs Poppler (pdftoppm) and Tesseract installed and available on PATH. OCR could not run: ${error.message}`;
      if (!text) throw new Error(`No selectable text was found. ${ocrWarning}`);
    }
  }
  if (!text) throw new Error(`No readable text was found. The PDF may be image-only or contain unsupported text encoding.${ocrWarning ? ` ${ocrWarning}` : ''}`);

  const truncated = extractionTruncated || text.length > MAX_EXTRACTED_CHARS;
  if (text.length > MAX_EXTRACTED_CHARS) text = text.slice(0, MAX_EXTRACTED_CHARS);
  return { name: filename, text, characters: text.length, truncated, ocrUsed, ...(ocrWarning ? { ocrWarning } : {}) };
}

module.exports = { extractDocument, validateDocxArchive, extractPdfOcr, runProcess };
