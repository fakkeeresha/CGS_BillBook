# Vendor PDF extractor

This local service extracts text from uploaded invoice PDFs and tries vendor-neutral table and field patterns that support split and compressed item rows, common amount formats, and varying invoice layouts. It recognizes "Free for", "Scheme for", and "Schema for" annotations, and keeps the PDF's printed invoice total and the marked discount amount in the draft. The bill form applies those discounts to the taxable amount and adds calculated GST. It appends the complete text to `data/extracted-content.json` and the structured draft to `data/extracted-drafts.json`. It does not require ChatGPT, sign-in, or an API key, and does not save PDF uploads. Extraction is best-effort rather than guaranteed for every custom layout; review the draft before submitting. Scanned/image-only PDFs require OCR and are not supported.

## Start

From the repository root, install this service's dependencies:

```sh
npm install --prefix backend_dataserve
```

Running `npm start` in the repository root starts both the bill book (port 3000) and this service (port 3001). To run the extractor on its own, use `npm start --prefix backend_dataserve`. It only accepts browser requests from the bill book on localhost.

Raw extracted PDF text is stored in `data/extracted-content.json`; structured bill drafts are stored separately in `data/extracted-drafts.json`. Review the populated form before submitting it to the regular bill book.
