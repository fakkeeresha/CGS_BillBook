const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const express = require('express');
const multer = require('multer');
const pdfParse = require('pdf-parse');
const { parseVendorInvoiceText } = require('./local-invoice-parser');
const { appendJsonRecord } = require('./json-store');

const app = express();
const HOST = process.env.EXTRACTOR_HOST || '127.0.0.1';
const PORT = Number(process.env.EXTRACTOR_PORT) || 3001;
const MAIN_ORIGINS = new Set(['http://localhost:3000', 'http://127.0.0.1:3000']);
const DATA_DIRECTORY = path.join(__dirname, 'data');
const DRAFTS_PATH = path.join(DATA_DIRECTORY, 'extracted-drafts.json');
const RAW_CONTENT_PATH = path.join(DATA_DIRECTORY, 'extracted-content.json');
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });

let extractionQueue = Promise.resolve();
let extractionStage = 'idle';

function serializeExtraction(task) {
  const next = extractionQueue.then(task, task);
  extractionQueue = next.catch(() => {});
  return next;
}
function applyCors(request, response, next) {
  const origin = request.headers.origin;
  if (MAIN_ORIGINS.has(origin)) {
    response.setHeader('Access-Control-Allow-Origin', origin);
    response.setHeader('Vary', 'Origin');
    response.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    response.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  }
  if (request.method === 'OPTIONS') return response.sendStatus(204);
  next();
}
app.use(applyCors);
app.get('/api/health', (_request, response) => {
  response.json({
    ok: true,
    extractionStage,
    extractionMode: 'local-vendor-parser',
    draftsPath: 'backend_dataserve/data/extracted-drafts.json',
    extractedContentPath: 'backend_dataserve/data/extracted-content.json'
  });
});
app.get('/api/drafts', async (_request, response) => {
  try {
    const drafts = JSON.parse(await fs.readFile(DRAFTS_PATH, 'utf8'));
    response.json(Array.isArray(drafts) ? drafts : []);
  } catch (error) {
    if (error.code === 'ENOENT') return response.json([]);
    response.status(500).json({ error: 'Could not read extracted drafts JSON.' });
  }
});
app.get('/api/content', async (_request, response) => {
  try {
    const records = JSON.parse(await fs.readFile(RAW_CONTENT_PATH, 'utf8'));
    response.json(Array.isArray(records) ? records : []);
  } catch (error) {
    if (error.code === 'ENOENT') return response.json([]);
    response.status(500).json({ error: 'Could not read extracted PDF content JSON.' });
  }
});
app.post('/api/extract', upload.single('pdf'), async (request, response) => {
  if (!request.file) return response.status(400).json({ error: 'Choose a vendor PDF first.' });
  if (!request.file.buffer.subarray(0, 5).equals(Buffer.from('%PDF-'))) return response.status(400).json({ error: 'The uploaded file is not a valid PDF.' });

  try {
    const result = await serializeExtraction(async () => {
      extractionStage = 'reading PDF text';
      const parsedPdf = await pdfParse(request.file.buffer);
      const invoiceText = String(parsedPdf.text || '').trim();
      if (invoiceText.length < 40) {
        const error = new Error('No readable text was found. This PDF may be scanned; a text-based vendor PDF is required.');
        error.statusCode = 422;
        throw error;
      }
      if (invoiceText.length > 150000) {
        const error = new Error('This invoice contains too much text for extraction.');
        error.statusCode = 413;
        throw error;
      }
      const uploadedFileName = path.basename(request.file.originalname).slice(0, 180);
      const rawRecord = {
        contentId: crypto.randomUUID(),
        extractedAt: new Date().toISOString(),
        uploadedFileName,
        pageCount: parsedPdf.numpages,
        text: invoiceText
      };
      extractionStage = 'saving full PDF text to JSON';
      await appendJsonRecord(RAW_CONTENT_PATH, rawRecord);

      extractionStage = 'parsing vendor invoice fields locally';
      const draft = parseVendorInvoiceText(invoiceText);
      if (!draft) {
        return {
          rawTextSaved: true,
          rawContentId: rawRecord.contentId,
          uploadedFileName,
          pageCount: parsedPdf.numpages,
          rawText: invoiceText,
          draft: null,
          warning: 'The PDF text was saved, but no invoice fields could be identified. Review the extracted text and enter the bill details manually.'
        };
      }
      const entry = {
        draftId: crypto.randomUUID(),
        extractedAt: new Date().toISOString(),
        uploadedFileName,
        extractionMethod: 'local-parser',
        draft
      };
      extractionStage = 'saving structured draft JSON';
      await appendJsonRecord(DRAFTS_PATH, entry);
      return {
        ...entry,
        rawTextSaved: true,
        rawContentId: rawRecord.contentId,
        warning: draft.items.length ? '' : 'Invoice details were identified, but line items were not recognized. Review the fields and add the items manually.'
      };
    });
    response.json(result);
  } catch (error) {
    console.error('PDF extraction failed:', error.message);
    response.status(error.statusCode || 502).json({ error: error.message || 'Could not extract this PDF.' });
  } finally {
    extractionStage = 'idle';
  }
});

app.use((error, _request, response, _next) => {
  if (error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE') {
    return response.status(413).json({ error: 'PDF must be smaller than 25 MB.' });
  }
  console.error(error);
  response.status(500).json({ error: 'The PDF extraction service encountered an unexpected error.' });
});

const server = app.listen(PORT, HOST, () => {
  console.log(`Vendor PDF extractor listening at http://${HOST}:${server.address().port}`);
});

async function close() {
  server.close(() => process.exit(0));
}
process.once('SIGINT', close);
process.once('SIGTERM', close);
