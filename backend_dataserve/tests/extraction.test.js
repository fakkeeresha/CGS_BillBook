const assert = require('node:assert/strict');
const { existsSync } = require('node:fs');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const pdfParse = require('pdf-parse');
const { parseVendorInvoiceText } = require('../local-invoice-parser');
const { appendJsonRecord } = require('../json-store');

const projectRoot = path.resolve(__dirname, '../..');
const sampleInvoices = [
  { filename: 'CGS to JS E 02-09-26.pdf', total: 188969, itemCount: 7 },
  { filename: 'CGS to SB E 02-09-26.pdf', total: 238732, itemCount: 6 },
  { filename: 'CGS to SMA 02-09-26.pdf', total: 229811, itemCount: 5 },
  { filename: 'CGS to SMT-JP 28-09-26 (1).pdf', total: 322540, itemCount: 4 },
  { filename: 'CGS to VE 18-09-26.pdf', total: 68330, itemCount: 5 },
  { filename: 'CGS to VE 28-09-26 (2).pdf', total: 75132, itemCount: 6 },
  { filename: 'CGS TO S B 25..06 (1).pdf', total: 204358, itemCount: 8, discount: 1729.84 }
];
const hasInputInvoice = existsSync(path.join(projectRoot, 'input.pdf'));
const hasSampleInvoices = sampleInvoices.every(({ filename }) =>
  existsSync(path.join(projectRoot, 'Sample', filename))
);

test('vendor PDF contains readable text and recognizable party labels', { skip: !hasInputInvoice }, async () => {
  const pdfBuffer = await fs.readFile(path.join(projectRoot, 'input.pdf'));
  const parsed = await pdfParse(pdfBuffer);
  assert.ok(parsed.numpages >= 1);
  assert.match(parsed.text, /Buyer \(Bill to\)/i);
  assert.match(parsed.text, /Consignee \(Ship to\)/i);
});

test('stores all extracted PDF text and appends later uploads to JSON', { skip: !hasInputInvoice }, async () => {
  const pdfBuffer = await fs.readFile(path.join(projectRoot, 'input.pdf'));
  const parsed = await pdfParse(pdfBuffer);
  const temporaryDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'cgs-extracted-json-'));
  const jsonPath = path.join(temporaryDirectory, 'extracted-content.json');
  try {
    const completeText = parsed.text.trim();
    await appendJsonRecord(jsonPath, { uploadedFileName: 'input.pdf', pageCount: parsed.numpages, text: completeText });
    await appendJsonRecord(jsonPath, { uploadedFileName: 'second.pdf', pageCount: 1, text: 'Second upload.' });
    const records = JSON.parse(await fs.readFile(jsonPath, 'utf8'));
    assert.equal(records.length, 2);
    assert.equal(records[0].text, completeText);
    assert.match(records[0].text, /Buyer \(Bill to\)/);
    assert.match(records[0].text, /Consignee \(Ship to\)/);
    assert.match(records[0].text, /1,88,969\.00/);
  } finally {
    await fs.rm(temporaryDirectory, { recursive: true, force: true });
  }
});

test('local fallback extracts all seven sample invoice items and final total', { skip: !hasInputInvoice }, async () => {
  const pdfBuffer = await fs.readFile(path.join(projectRoot, 'input.pdf'));
  const parsed = await pdfParse(pdfBuffer);
  const draft = parseVendorInvoiceText(parsed.text);
  assert.equal(draft.sellerName, 'CGS GLOBAL ENTERPRISES ( Electronic City)');
  assert.equal(draft.shipToName, 'JS ENTERPRISES - NAGARABHAVI');
  assert.equal(draft.invoiceDate, '2026-09-02');
  assert.equal(draft.vehicleNo, 'KA02AF7135');
  assert.equal(draft.discountAmount, 2404.08);
  assert.equal(draft.totalAmount, 188969);
  assert.equal(draft.items.length, 7);
  assert.deepEqual(
    [draft.items[0].quantity, draft.items[0].rateExclTax, draft.items[0].rateInclTax, draft.items[0].amount],
    [10, 480.81, 567.36, 4808.1]
  );
});

test('local parser extracts invoice totals and items from every supplied sample PDF', { skip: !hasSampleInvoices }, async () => {
  for (const sample of sampleInvoices) {
    const pdfBuffer = await fs.readFile(path.join(projectRoot, 'Sample', sample.filename));
    const parsed = await pdfParse(pdfBuffer);
    const draft = parseVendorInvoiceText(parsed.text);

    assert.ok(draft, `${sample.filename} should produce a draft`);
    assert.ok(draft.sellerName, `${sample.filename} should include the bill seller`);
    assert.ok(draft.shipToName, `${sample.filename} should include the consignee`);
    assert.match(draft.invoiceDate, /^\d{4}-\d{2}-\d{2}$/, `${sample.filename} should include a normalized date`);
    assert.equal(draft.totalAmount, sample.total, `${sample.filename} should extract the printed invoice total`);
    assert.equal(draft.items.length, sample.itemCount, `${sample.filename} should include every line item`);
    const markedDiscount = draft.items.filter((item) => item.isDiscount)
      .reduce((sum, item) => sum + Math.round(item.amount * 100), 0) / 100;
    assert.equal(draft.discountAmount, markedDiscount, `${sample.filename} should report its marked scheme/free discounts`);
    if (sample.discount !== undefined) assert.equal(draft.discountAmount, sample.discount);
    if (sample.filename === 'CGS TO S B 25..06 (1).pdf') {
      assert.deepEqual(draft.items.filter((item) => item.isDiscount).map((item) => item.amount), [1602.72, 127.12]);
    }
  }
});

test('local parser includes consignee GSTIN and state with the complete ship-to address', {
  skip: !existsSync(path.join(projectRoot, 'Sample', 'CGS to SMA 02-09-26.pdf'))
}, async () => {
  const pdfBuffer = await fs.readFile(path.join(projectRoot, 'Sample', 'CGS to SMA 02-09-26.pdf'));
  const parsed = await pdfParse(pdfBuffer);
  const draft = parseVendorInvoiceText(parsed.text);

  assert.equal(draft.shipToName, 'SRI MANJUNATHA  AGENCIES');
  assert.match(draft.shipToAddress, /No\.1206, 5th Cross Road, Prakash Nagar, Bangalore, Bengaluru/);
  assert.match(draft.shipToAddress, /GSTIN\/UIN:29BGXPR3551H1ZM/);
  assert.match(draft.shipToAddress, /State Name\s*:Karnataka, Code\s*:\s*29/);
});

test('local parser recognizes Scheme, Schema, and Free for annotations as discounts', () => {
  const text = [
    'Tax Invoice',
    'Consignee (Ship to)', 'Vajrakaya Enterprises', 'Bengaluru',
    'Buyer (Bill to)', 'CGS Global Enterprises', 'Bengaluru',
    'Invoice No.e-Way Bill No.', '1245562079886568',
    'Sl', 'Description of GoodsAmountperRateRateQuantityHSN/SAC', 'No.', '(Incl. of Tax)',
    '1', 'Paid product', '100.00Pc100.00118.001.00 Pc12345678',
    '2', 'Scheme product', '20.00Pc20.0023.601.00 Pc12345678',
    'Schema for Paid product',
    '3', 'Free product', '10.00Pc10.0011.801.00 Pc12345678',
    'Free for Paid product',
    'Total ₹ 130.00'
  ].join('\n');

  const draft = parseVendorInvoiceText(text);
  assert.deepEqual(draft.items.map((item) => item.isDiscount), [false, true, true]);
  assert.equal(draft.discountAmount, 30);
  assert.equal(draft.totalAmount, 130);
});

test('local parser handles a flat item table with compressed headings and appended HSN columns', async () => {
  const text = [
    'Invoice No: INV-100',
    'Invoice Date: 25/06/2026',
    'Seller: Acme Supplies',
    'Bill To: Example Stores',
    'S.NO.ITEMSHSNQTY.RATEAMOUNT',
    '1Shashi Scouring Powder 250g 10 /- 100pc3405400032 BAG676.921,660.88',
    '2Soap 340119301 Bx100.00100.00',
    'TOTAL₹1,760.88'
  ].join('\n');

  const draft = parseVendorInvoiceText(text);
  assert.ok(draft);
  assert.equal(draft.totalAmount, 1760.88);
  assert.equal(draft.items.length, 2);
  assert.deepEqual(
    draft.items.map((item) => [item.hsn, item.quantity, item.unit, item.rateExclTax, item.amount]),
    [['34054000', 32, 'BAG', 676.92, 1660.88], ['34011930', 1, 'Bx', 100, 100]]
  );
});

test('local parser extracts compressed generated-invoice rows and truncated concatenated amounts', () => {
  const text = [
    'CGS GLOBAL ENTERPRISES',
    'Invoice No. CGS-159',
    'Invoice Date: 03/10/2026',
    'BILL TO',
    'S B ENTERPRISES',
    'S.NO.ITEMSHSNQTY.RATEAMOUNT',
    '1SAVAAL WHITE DET CAKE 225GM Rs-22/ - 60pc3401193010 BOX821.398,213.9',
    '2Shashi Scouring Powder 500gm Rs.20/- 50pc3405400030 BAG654.5519,636.5',
    '3Shashi Scouring Powder 250g 10 /- 100pc3405400060 BAG680.2140,812.6',
    '4167-Shashi Pink Det Cake 150gm MRP 20/- 60pc34011930120 BOX821.3998,566.8',
    '5167-Shashi Pink Det Cake 150gm MRP 20/- 60pc340119302 BOX00',
    '676- Shashi Blue Det Cake 150gm Rs.10/- 60 Pc3401193010 BOX410.74,107',
    '7146-Shashi Pink Supreme Det Cake 250gm Rs 30/- 60pc340119305 BOX1,235.56,177.5',
    '8Shashi Wp(Blue Pouch)500gms Rs. 46/- 50Pcs',
    'FREE for Shashi Pink 250gm',
    '340119200.1 BAG00',
    'TOTAL-₹ 2,09,467',
    'Total Tax Amount'
  ].join('\n');

  const draft = parseVendorInvoiceText(text);
  assert.ok(draft);
  assert.equal(draft.sellerName, 'CGS GLOBAL ENTERPRISES');
  assert.equal(draft.shipToName, 'S B ENTERPRISES');
  assert.equal(draft.totalAmount, 209467);
  assert.equal(draft.items.length, 8);
  assert.deepEqual(draft.items.map((item) => item.amount), [
    8213.9, 19636.5, 40812.6, 98566.8, 0, 4107.4, 6177.8, 0
  ]);
  assert.deepEqual(draft.items.slice(3, 7).map((item) => item.description.slice(0, 4)), [
    '167-', '167-', '76- ', '146-'
  ]);
  assert.equal(draft.items[7].isDiscount, true);
  assert.equal(draft.discountAmount, 0);
});

test('local parser handles split-line vendor item columns and decimal quantities', () => {
  const text = [
    'Tax Invoice',
    'Consignee (Ship to)', 'Vajrakaya Enterprises', '13/6 Kulkarni Building, Head Master Layout, Chandapura Bangalore-99',
    'Buyer (Bill to)', 'CGS GLOBAL ENTERPRISES ( Electronic City)', '1st Cross, Site No 33, Chandapura Anekal road, Bengaluru',
    'Invoice No.e-Way Bill No.', '1245562079886568', 'Dated', '28-Sep-26',
    'Motor Vehicle No.', 'KA17D6813',
    'Sl', 'Description of GoodsAmountperRateRateQuantityHSN/SAC', 'No.', '(Incl. of Tax)',
    '1', 'Shashi Scouring Powder 250g 10/- 100pc', '21,236.16', 'Bg663.63783.08', '32.00 Bg', '34054000',
    '2', 'Shashi Pink Det Cake 150gm MRP 20/- 60pc', '1,068.21', 'Bx801.36945.60', '1.333 Bx', '34011930',
    'Less :', 'Round Off', '(-)0.35', 'Total', '₹ 75,132.00', 'Amount Chargeable (in words)'
  ].join('\n');
  const draft = parseVendorInvoiceText(text);
  assert.equal(draft.invoiceDate, '2026-09-28');
  assert.equal(draft.vehicleNo, 'KA17D6813');
  assert.equal(draft.totalAmount, 75132);
  assert.equal(draft.items.length, 2);
  assert.deepEqual(
    [draft.items[0].amount, draft.items[0].rateExclTax, draft.items[0].rateInclTax, draft.items[0].quantity],
    [21236.16, 663.63, 783.08, 32]
  );
  assert.equal(draft.items[1].quantity, 1.333);
});

test('invoice total ignores later continuation quantities and tax-summary totals', () => {
  const text = [
    'Tax Invoice',
    'Seller: Acme Supplies',
    'Bill To: Shreya Retail',
    'Item Description Qty Unit Rate Amount',
    'Soap 1 Bx 100.00 100.00',
    'Total ₹ 2,29,811.00',
    'Amount Chargeable (in words)',
    '155.000 Bx',
    'TotalIGSTTaxable 22,849.30 2,06,961.66'
  ].join('\n');

  const draft = parseVendorInvoiceText(text);
  assert.equal(draft.totalAmount, 229811);
});

test('local parser analyzes a differently formatted invoice without vendor-specific table headings', () => {
  const text = [
    'INVOICE',
    'Invoice Date: 03/10/2026',
    'Seller: Acme Supplies',
    '12 Market Road, Bengaluru',
    'Bill To: Shreya Retail',
    '42 Lake View Road, Bengaluru',
    'Vehicle No: KA02AF7135',
    'Item Description Qty Unit Rate Amount',
    'Paper reams 5 Pcs 100.00 500.00',
    'Total: INR 500.00'
  ].join('\n');

  const draft = parseVendorInvoiceText(text);
  assert.equal(draft.sellerName, 'Acme Supplies');
  assert.equal(draft.sellerAddress, '12 Market Road, Bengaluru');
  assert.equal(draft.shipToName, 'Shreya Retail');
  assert.equal(draft.shipToAddress, '42 Lake View Road, Bengaluru');
  assert.equal(draft.invoiceDate, '2026-10-03');
  assert.equal(draft.vehicleNo, 'KA02AF7135');
  assert.equal(draft.totalAmount, 500);
  assert.deepEqual(
    [draft.items[0].description, draft.items[0].quantity, draft.items[0].unit, draft.items[0].rateExclTax, draft.items[0].amount],
    ['Paper reams', 5, 'Pcs', 100, 500]
  );
});
