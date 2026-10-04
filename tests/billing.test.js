const assert = require('node:assert/strict');
const { after, before, test } = require('node:test');
const { spawn } = require('node:child_process');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const ExcelJS = require('exceljs');
const pdfParse = require('../backend_dataserve/node_modules/pdf-parse');
const { summarizeTaxByHsn } = require('../lib/tax-summary');
const { amountInWords } = require('../lib/amount-in-words');
const { createInvoicePdf } = require('../lib/invoice-pdf');

const projectRoot = path.resolve(__dirname, '..');
let temporaryDirectory;
let dataDirectory;
let serverProcess;
let serverUrl;

function renderPdf(document) {
  const chunks = [];
  return new Promise((resolve, reject) => {
    document.on('data', (chunk) => chunks.push(chunk));
    document.on('end', () => resolve(Buffer.concat(chunks)));
    document.on('error', reject);
    document.end();
  });
}

test('formats totals as Indian Rupee words with paise', () => {
  assert.equal(amountInWords(59561.84), 'Indian Rupees Fifty Nine Thousand Five Hundred Sixty One and Eighty Four Paise Only');
  assert.equal(amountInWords(100000), 'Indian Rupees One Lakh Only');
  assert.equal(amountInWords(0), 'Indian Rupees Zero Only');
});

test('treats line amounts as taxable values and calculates GST from inclusive and exclusive rates', () => {
  const summary = summarizeTaxByHsn([
    { hsn: '34011110', rateExclTax: 100, rateInclTax: 118, amount: 100 },
    { hsn: '34011110', rateExclTax: 200, rateInclTax: 236, amount: 200 },
    { hsn: '34011120', rateExclTax: 100, rateInclTax: 110, amount: 100 },
    { hsn: '34011130', rateExclTax: 50, rateInclTax: 0, amount: 50 },
    { hsn: '34011140', rateExclTax: 480.81, rateInclTax: 567.36, amount: 480.81 }
  ]);

  assert.deepEqual(summary, [
    { hsn: '34011110', taxableValue: 300, gstRate: 18, cgstRate: 9, cgstAmount: 27, sgstRate: 9, sgstAmount: 27, taxAmount: 54 },
    { hsn: '34011120', taxableValue: 100, gstRate: 10, cgstRate: 5, cgstAmount: 5, sgstRate: 5, sgstAmount: 5, taxAmount: 10 },
    { hsn: '34011130', taxableValue: 50, gstRate: null, cgstRate: null, cgstAmount: 0, sgstRate: null, sgstAmount: 0, taxAmount: 0 },
    { hsn: '34011140', taxableValue: 480.81, gstRate: 18, cgstRate: 9, cgstAmount: 43.28, sgstRate: 9, sgstAmount: 43.27, taxAmount: 86.55 }
  ]);
});

test('PDF paginates long item and HSN summaries without failing', async () => {
  const items = Array.from({ length: 40 }, (_, index) => ({
    slNo: index + 1,
    description: `Invoice item ${index + 1}`,
    hsn: String(34010000 + index),
    quantity: 1,
    unit: 'Pc',
    rateExclTax: 100,
    rateInclTax: 118,
    amount: 100
  }));
  const document = await createInvoicePdf({
    billId: 'CGS-PAGINATION',
    invoiceDate: '2026-10-03',
    dueDate: '2026-10-13',
    dueDays: 10,
    vehicleNo: 'KA02AF7135',
    shipToName: 'Pagination Test',
    shipToAddress: 'Test address',
    totalAmount: 4720,
    items
  });
  const pdfBuffer = await renderPdf(document);
  const pageCount = (pdfBuffer.toString('latin1').match(/\/Type\s*\/Page\b/g) || []).length;
  assert.ok(pageCount >= 3, `Expected multiple item and tax-summary pages, got ${pageCount}.`);
  assert.equal(pdfBuffer.subarray(0, 5).toString(), '%PDF-');
});

test('keeps invoice totals with the items when they fit on the same page', async () => {
  const items = Array.from({ length: 7 }, (_, index) => ({
    slNo: index + 1,
    description: `Invoice item ${index + 1}`,
    hsn: ['34011930', '34054000', '34011110'][index % 3],
    quantity: 1,
    unit: 'Pc',
    rateExclTax: 100,
    rateInclTax: 118,
    amount: 100,
    isDiscount: index === 3
  }));
  const document = await createInvoicePdf({
    billId: 'CGS-0021',
    invoiceDate: '2026-10-04',
    vehicleNo: 'KA02AF7135',
    shipToName: 'Pagination Test',
    shipToAddress: 'Test address',
    totalAmount: 790,
    discountAmount: 100,
    roundOffAmount: 0,
    items
  });
  const pageTexts = [];
  await pdfParse(await renderPdf(document), {
    pagerender: (page) => page.getTextContent().then((content) => {
      const text = content.items.map((item) => item.str).join(' ');
      pageTexts.push(text);
      return text;
    })
  });
  const firstPage = pageTexts[0];

  assert.match(firstPage, /Invoice item 7/);
  assert.match(firstPage, /AMOUNT IN WORDS/);
  assert.match(firstPage, /Indian Rupees/);
});

function waitForServer(child) {
  return new Promise((resolve, reject) => {
    let output = '';
    const timeout = setTimeout(() => reject(new Error(`Server did not start. ${output}`)), 10000);
    const onOutput = (chunk) => {
      output += chunk.toString();
      const match = /running at http:\/\/localhost:(\d+)/.exec(output);
      if (match) {
        clearTimeout(timeout);
        resolve(`http://localhost:${match[1]}`);
      }
    };
    child.stdout.on('data', onOutput);
    child.stderr.on('data', onOutput);
    child.once('error', (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.once('exit', (code) => {
      clearTimeout(timeout);
      reject(new Error(`Server exited before startup with code ${code}. ${output}`));
    });
  });
}

async function submitBill(shipToName, percentageIncrease, items, totalAmount) {
  const response = await fetch(`${serverUrl}/api/bills`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      sellerName: 'CGS Global Enterprises',
      sellerAddress: '17 Residency Road, Bengaluru',
      shipToName,
      shipToAddress: '42 Test Road, Bengaluru',
      invoiceDate: '2026-10-03',
      vehicleNo: 'KA02AF7135',
      dueDays: 10,
      totalAmount,
      paymentStatus: 'Unpaid',
      percentageIncrease,
      items
    })
  });
  const result = await response.json();
  assert.equal(response.status, 201, result.error);
  return result;
}

before(async () => {
  temporaryDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'cgs-bill-book-test-'));
  dataDirectory = path.join(temporaryDirectory, 'data');
  serverProcess = spawn(process.execPath, [path.join(projectRoot, 'server.js')], {
    cwd: projectRoot,
    env: { ...process.env, PORT: '0', DATA_DIRECTORY: dataDirectory },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  serverUrl = await waitForServer(serverProcess);
});

after(async () => {
  if (serverProcess && serverProcess.exitCode === null) {
    serverProcess.kill();
    await new Promise((resolve) => serverProcess.once('exit', resolve));
  }
  if (temporaryDirectory) await fs.rm(temporaryDirectory, { recursive: true, force: true });
});

test('appends percentage-adjusted bills to JSON and Excel and syncs payment status', async () => {
  const first = await submitBill('Test Customer One', 10, [
    { description: 'Test item A', hsn: '1234', quantity: 1, unit: 'Pc', rateExclTax: 100, rateInclTax: 110, amount: 100 },
    { description: 'Test item B', hsn: '5678', quantity: 2, unit: 'Bx', rateExclTax: 100, rateInclTax: 110, amount: 200 }
  ], 330);
  const second = await submitBill('Test Customer Two', 0, [
    { description: 'Test item C', hsn: '9012', quantity: 1, unit: 'Kg', rateExclTax: 50, rateInclTax: 50, amount: 50 }
  ], 50);

  assert.equal(first.billId, 'CGS-0001');
  assert.equal(second.billId, 'CGS-0002');

  const firstDetailResponse = await fetch(`${serverUrl}/api/bills/${first.billId}`);
  const firstDetail = await firstDetailResponse.json();
  assert.deepEqual(firstDetail.items.map((item) => [item.rateExclTax, item.rateInclTax, item.amount]), [
    [110, 121, 110],
    [110, 121, 220]
  ]);
  assert.equal(firstDetail.totalAmount, 363);
  assert.equal(firstDetail.taxSummary.reduce((sum, row) => sum + row.taxAmount, 0), 33);

  const detailResponse = await fetch(`${serverUrl}/api/bills/${second.billId}`);
  const detail = await detailResponse.json();
  assert.equal(detail.dueDays, 10);
  assert.equal(detail.dueDate, '2026-10-13');
  assert.equal(detail.amountInWords, 'Indian Rupees Fifty Only');
  assert.deepEqual(detail.taxSummary, [{ hsn: '9012', taxableValue: 50, gstRate: 0, cgstRate: 0, cgstAmount: 0, sgstRate: 0, sgstAmount: 0, taxAmount: 0 }]);

  const pdfResponse = await fetch(`${serverUrl}/api/bills/${second.billId}/pdf`);
  assert.equal(pdfResponse.status, 200);
  assert.match(pdfResponse.headers.get('content-type'), /application\/pdf/);
  assert.match(pdfResponse.headers.get('content-disposition'), new RegExp(`${second.billId}\\.pdf`));
  const pdfBytes = Buffer.from(await pdfResponse.arrayBuffer());
  assert.equal(pdfBytes.subarray(0, 5).toString(), '%PDF-');
  assert.ok(pdfBytes.length > 1000);

  const listResponse = await fetch(`${serverUrl}/api/bills`);
  const bills = await listResponse.json();
  assert.deepEqual(bills.map((bill) => bill.billId), ['CGS-0002', 'CGS-0001']);

  const statusResponse = await fetch(`${serverUrl}/api/bills/${first.billId}/status`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ paymentStatus: 'Paid' })
  });
  const updatedBill = await statusResponse.json();
  assert.equal(updatedBill.paymentStatus, 'Paid');
  assert.ok(updatedBill.paidOn);

  const ledger = JSON.parse(await fs.readFile(path.join(dataDirectory, 'bills.json'), 'utf8'));
  assert.equal(ledger.length, 2);
  assert.deepEqual(ledger[0].items.map((item) => item.amount), [110, 220]);
  assert.equal(ledger[0].items[0].amountBeforeIncrease, 100);
  assert.deepEqual(ledger[0].items.map((item) => [item.rateExclTax, item.rateInclTax]), [
    [110, 121],
    [110, 121]
  ]);
  assert.equal(ledger[0].paymentStatus, 'Paid');
  assert.ok(ledger[0].paidOn);

  const malformedWorkbook = new ExcelJS.Workbook();
  await malformedWorkbook.xlsx.readFile(path.join(dataDirectory, 'bills.xlsx'));
  malformedWorkbook.getWorksheet('Bills').getRow(1).getCell(4).value = 'Seller Name';
  malformedWorkbook.getWorksheet('Bills').getRow(2).getCell(4).value = 'Misaligned value';
  await malformedWorkbook.xlsx.writeFile(path.join(dataDirectory, 'bills.xlsx'));

  const paymentResponse = await fetch(`${serverUrl}/api/payments`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ vendorName: 'Test Customer Two', date: '2026-10-04', amount: 20 })
  });
  assert.equal(paymentResponse.status, 201);
  const payment = await paymentResponse.json();
  assert.equal(payment.vendorName, 'Test Customer Two');
  assert.equal(payment.amount, 20);
  assert.equal(payment.remainingBalance, 30);

  const overpaymentResponse = await fetch(`${serverUrl}/api/payments`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ vendorName: 'Test Customer Two', date: '2026-10-04', amount: 30.01 })
  });
  assert.equal(overpaymentResponse.status, 400);
  const invalidPaymentResponse = await fetch(`${serverUrl}/api/payments`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ vendorName: 'Test Customer Two', date: '2026-02-31', amount: 0.001 })
  });
  assert.equal(invalidPaymentResponse.status, 400);

  const exploreResponse = await fetch(`${serverUrl}/api/explore`);
  const explore = await exploreResponse.json();
  assert.deepEqual(explore.summary, { totalAmount: 413, paidAmount: 383, unpaidAmount: 30, vendorCount: 2 });
  assert.equal(explore.vendors.find((vendor) => vendor.vendorName === 'Test Customer Two').payments.length, 1);
  const paymentLedger = JSON.parse(await fs.readFile(path.join(dataDirectory, 'payments.json'), 'utf8'));
  assert.equal(paymentLedger.length, 1);
  assert.equal(paymentLedger[0].remainingBalance, 30);

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(path.join(dataDirectory, 'bills.xlsx'));
  const billsSheet = workbook.getWorksheet('Bills');
  const itemsSheet = workbook.getWorksheet('Items');
  assert.equal(billsSheet.rowCount, 3);
  assert.equal(itemsSheet.rowCount, 4);
  assert.equal(itemsSheet.getRow(2).getCell(7).value, 110);
  assert.equal(itemsSheet.getRow(2).getCell(8).value, 121);
  assert.equal(itemsSheet.getRow(2).getCell(9).value, 110);
  assert.equal(itemsSheet.getRow(3).getCell(9).value, 220);
  assert.equal(itemsSheet.getRow(4).getCell(9).value, 50);
  assert.equal(billsSheet.getRow(2).getCell(9).value, 'Paid');
  assert.equal(billsSheet.getRow(2).getCell(4).value, '17 Residency Road, Bengaluru');
  assert.equal(billsSheet.getRow(2).getCell(5).value, 'Test Customer One');
  assert.equal(billsSheet.getRow(2).getCell(6).value, '42 Test Road, Bengaluru');
  assert.equal(billsSheet.getRow(2).getCell(7).value, 'KA02AF7135');
  assert.equal(billsSheet.getRow(2).getCell(8).value, 363);
  assert.equal(billsSheet.getRow(1).values.includes('Seller Name'), false);
  assert.equal(workbook.getWorksheet('Payments').getRow(2).getCell(4).value, 20);
  assert.deepEqual(workbook.getWorksheet('Bills 2026-10').getRow(1).values.slice(1), billsSheet.getRow(1).values.slice(1));
  assert.equal(workbook.getWorksheet('Bills 2026-10').rowCount, 3);

  const exportResponse = await fetch(`${serverUrl}/api/bills/export`);
  assert.equal(exportResponse.status, 200);
  assert.match(exportResponse.headers.get('content-type'), /application\/vnd\.openxmlformats-officedocument\.spreadsheetml\.sheet/);
  assert.match(exportResponse.headers.get('content-disposition'), /attachment;\s*filename="bills\.xlsx"/);
  const exportedWorkbook = new ExcelJS.Workbook();
  await exportedWorkbook.xlsx.load(Buffer.from(await exportResponse.arrayBuffer()));
  for (const sheetName of ['Bills', 'Items', 'Metadata', 'Payments', 'Bills 2026-10']) {
    assert.ok(exportedWorkbook.getWorksheet(sheetName), `Expected ${sheetName} in Excel export`);
  }
  assert.deepEqual(exportedWorkbook.worksheets.map((sheet) => sheet.name), ['Bills', 'Items', 'Payments', 'Bills 2026-10', 'Metadata']);
  assert.equal(exportedWorkbook.getWorksheet('Bills').getRow(2).getCell(1).value, 'CGS-0001');
  assert.equal(exportedWorkbook.getWorksheet('Items').getRow(2).getCell(1).value, 'CGS-0001');
});

test('deducts scheme/free item values from bill totals and records the discount across flows', async () => {
  const result = await submitBill('Scheme Customer', 10, [
    { description: 'Regular product', hsn: '1234', quantity: 2, unit: 'Pc', rateExclTax: 100, rateInclTax: 118, amount: 200 },
    { description: 'Free scheme product', hsn: '1234', quantity: 1, unit: 'Pc', rateExclTax: 50, rateInclTax: 59, amount: 50, isDiscount: true }
  ], 275);

  const response = await fetch(`${serverUrl}/api/bills/${result.billId}`);
  const bill = await response.json();
  assert.equal(bill.discountAmount, 55);
  assert.equal(bill.roundOffAmount, 0.4);
  assert.equal(bill.totalAmount, 260);
  assert.equal(bill.amountInWords, 'Indian Rupees Two Hundred Sixty Only');
  assert.deepEqual(bill.items.map((item) => item.isDiscount), [false, true]);
  assert.equal(bill.items[1].amount, 55);
  assert.equal(bill.taxSummary[0].taxableValue, 220);
  assert.equal(bill.taxSummary[0].taxAmount, 39.6);

  const pdfResponse = await fetch(`${serverUrl}/api/bills/${result.billId}/pdf`);
  assert.equal(pdfResponse.status, 200);
  const pdf = await pdfParse(Buffer.from(await pdfResponse.arrayBuffer()));
  assert.match(pdf.text, /SCHEME\/FREE ITEM/);
  assert.match(pdf.text, /DISCOUNT \(SCHEME\/FREE ITEMS\)/);
  assert.match(pdf.text, /₹55\.00/);
  assert.match(pdf.text, /TOTAL TAX AMOUNT/);
  assert.match(pdf.text, /₹39\.60/);
  assert.match(pdf.text, /ROUND OFF/);
  assert.match(pdf.text, /₹0\.40/);
  assert.match(pdf.text, /₹260\.00/);
  assert.match(pdf.text, /Indian Rupees Two Hundred Sixty Only/);
  assert.match(pdf.text, /RATE\s+EXCL\. GST/);
  assert.match(pdf.text, /RATE\s+INCL\. GST/);
  assert.match(pdf.text, /AMOUNT\s+EXCL\. GST/);

  const historyResponse = await fetch(`${serverUrl}/api/bills`);
  const history = await historyResponse.json();
  const historyRecord = history.find((entry) => entry.billId === result.billId);
  assert.equal(historyRecord.totalAmount, 260);
  assert.equal(historyRecord.discountAmount, 55);
  assert.equal(historyRecord.roundOffAmount, 0.4);

  const ledger = JSON.parse(await fs.readFile(path.join(dataDirectory, 'bills.json'), 'utf8'));
  const saved = ledger.find((entry) => entry.billId === result.billId);
  assert.equal(saved.discountAmount, 55);
  assert.equal(saved.totalAmount, 260);
  assert.equal(saved.roundOffAmount, 0.4);
  assert.equal(saved.items[1].isDiscount, true);

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(path.join(dataDirectory, 'bills.xlsx'));
  const billsSheet = workbook.getWorksheet('Bills');
  const itemsSheet = workbook.getWorksheet('Items');
  let billsRow;
  let discountRow;
  billsSheet.eachRow((row, rowNumber) => {
    if (rowNumber > 1 && row.getCell(1).value === result.billId) billsRow = row;
  });
  itemsSheet.eachRow((row, rowNumber) => {
    if (rowNumber > 1 && row.getCell(1).value === result.billId && row.getCell(2).value === 2) discountRow = row;
  });
  assert.equal(billsRow.getCell(11).value, 55);
  assert.equal(billsRow.getCell(12).value, 0.4);
  assert.equal(billsRow.getCell(8).value, 260);
  assert.equal(discountRow.getCell(10).value, 'Yes');
});

test('deletes a bill from JSON, Excel, and history', async () => {
  const bill = await submitBill('Delete Test Customer', 0, [
    { description: 'Delete test item', hsn: '1234', quantity: 1, unit: 'Pc', rateExclTax: 100, rateInclTax: 118, amount: 100 }
  ], 118);

  const deleteResponse = await fetch(`${serverUrl}/api/bills/${bill.billId}`, { method: 'DELETE' });
  assert.equal(deleteResponse.status, 200);
  assert.deepEqual(await deleteResponse.json(), { billId: bill.billId });

  const detailResponse = await fetch(`${serverUrl}/api/bills/${bill.billId}`);
  assert.equal(detailResponse.status, 404);
  const historyResponse = await fetch(`${serverUrl}/api/bills`);
  const history = await historyResponse.json();
  assert.equal(history.some((entry) => entry.billId === bill.billId), false);

  const ledger = JSON.parse(await fs.readFile(path.join(dataDirectory, 'bills.json'), 'utf8'));
  assert.equal(ledger.some((entry) => entry.billId === bill.billId), false);

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(path.join(dataDirectory, 'bills.xlsx'));
  for (const sheetName of ['Bills', 'Items', 'Bills 2026-10']) {
    let matchingRows = 0;
    workbook.getWorksheet(sheetName).eachRow((row, rowNumber) => {
      if (rowNumber > 1 && row.getCell(1).value === bill.billId) matchingRows += 1;
    });
    assert.equal(matchingRows, 0, `${sheetName} should not contain the deleted bill`);
  }

  const repeatedDeleteResponse = await fetch(`${serverUrl}/api/bills/${bill.billId}`, { method: 'DELETE' });
  assert.equal(repeatedDeleteResponse.status, 404);

  const nextBill = await submitBill('Post Delete Customer', 0, [
    { description: 'Post-delete test item', hsn: '1234', quantity: 1, unit: 'Pc', rateExclTax: 100, rateInclTax: 118, amount: 100 }
  ], 118);
  assert.notEqual(nextBill.billId, bill.billId, 'deleting the latest bill must not reuse its ID');
});
