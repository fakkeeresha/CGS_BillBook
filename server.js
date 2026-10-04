const express = require('express');
const ExcelJS = require('exceljs');
const { spawn } = require('node:child_process');
const fs = require('node:fs/promises');
const path = require('node:path');
const { createInvoicePdf } = require('./lib/invoice-pdf');
const { summarizeTaxByHsn } = require('./lib/tax-summary');
const { amountInWords } = require('./lib/amount-in-words');

const app = express();
const PORT = process.env.PORT ? Number(process.env.PORT) : 3000;
const DATA_DIRECTORY = process.env.DATA_DIRECTORY || path.join(__dirname, 'data');
const WORKBOOK_PATH = path.join(DATA_DIRECTORY, 'bills.xlsx');
const JSON_PATH = path.join(DATA_DIRECTORY, 'bills.json');
const PAYMENTS_PATH = path.join(DATA_DIRECTORY, 'payments.json');
const EXTRACTOR_SERVER_PATH = path.join(__dirname, 'backend_dataserve', 'server.js');
const BILL_COLUMNS = [
  { header: 'Bill ID', key: 'billId', width: 16 },
  { header: 'Created At', key: 'createdAt', width: 24 },
  { header: 'Invoice Date', key: 'invoiceDate', width: 16 },
  { header: 'Seller Address', key: 'sellerAddress', width: 38 },
  { header: 'Ship To Name', key: 'shipToName', width: 24 },
  { header: 'Ship To Address', key: 'shipToAddress', width: 38 },
  { header: 'Vehicle No', key: 'vehicleNo', width: 18 },
  { header: 'Total Amount', key: 'totalAmount', width: 18, style: { numFmt: '#,##0.00' } },
  { header: 'Payment Status', key: 'paymentStatus', width: 18 },
  { header: 'Paid On', key: 'paidOn', width: 16 },
  { header: 'Discount Amount', key: 'discountAmount', width: 18, style: { numFmt: '#,##0.00' } },
  { header: 'Round Off', key: 'roundOffAmount', width: 14, style: { numFmt: '#,##0.00' } }
];
const PAYMENT_COLUMNS = [
  { header: 'Payment ID', key: 'paymentId', width: 18 },
  { header: 'Payment Date', key: 'date', width: 16 },
  { header: 'Vendor Name', key: 'vendorName', width: 28 },
  { header: 'Amount Received', key: 'amount', width: 20, style: { numFmt: '#,##0.00' } },
  { header: 'Remaining Balance', key: 'remainingBalance', width: 22, style: { numFmt: '#,##0.00' } }
];
const ITEM_COLUMNS = [
  { header: 'Bill ID', key: 'billId', width: 16 },
  { header: 'Sl No', key: 'slNo', width: 10 },
  { header: 'Description', key: 'description', width: 34 },
  { header: 'HSN', key: 'hsn', width: 14 },
  { header: 'Quantity', key: 'quantity', width: 14, style: { numFmt: '0.##' } },
  { header: 'Unit', key: 'unit', width: 12 },
  { header: 'Rate Excl Tax', key: 'rateExclTax', width: 18, style: { numFmt: '#,##0.00' } },
  { header: 'Rate Incl Tax', key: 'rateInclTax', width: 18, style: { numFmt: '#,##0.00' } },
  { header: 'Amount', key: 'amount', width: 18, style: { numFmt: '#,##0.00' } },
  { header: 'Discount Item', key: 'isDiscount', width: 16 }
];
let writeQueue = Promise.resolve();

function serializeWorkbook(task) {
  const next = writeQueue.then(task, task);
  writeQueue = next.catch(() => {});
  return next;
}
function addDataWorksheet(workbook, name, columns, records) {
  const existingSheet = workbook.getWorksheet(name);
  if (existingSheet) workbook.removeWorksheet(existingSheet.id);
  const sheet = workbook.addWorksheet(name);
  const headerRow = sheet.getRow(1);
  sheet.columns = columns;
  headerRow.font = { bold: true };
  sheet.views = [{ state: 'frozen', ySplit: 1 }];
  for (const record of records) sheet.addRow(record);
  sheet.autoFilter = { from: 'A1', to: `${sheet.getColumn(sheet.columnCount).letter}${Math.max(1, sheet.rowCount)}` };
  return sheet;
}
function monthSheetName(value) {
  const dateText = value instanceof Date ? value.toISOString().slice(0, 10) : String(value || '').slice(0, 10);
  return /^\d{4}-(0[1-9]|1[0-2])-\d{2}$/.test(dateText) ? `Bills ${dateText.slice(0, 7)}` : null;
}
function synchronizeMonthlySheets(workbook, billsSheet) {
  const recordsByMonth = new Map();
  billsSheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1 || !row.getCell('billId').value) return;
    const name = monthSheetName(row.getCell('invoiceDate').value);
    if (!name) return;
    if (!recordsByMonth.has(name)) recordsByMonth.set(name, []);
    recordsByMonth.get(name).push(billFromRow(row));
  });
  const existingMonths = workbook.worksheets.filter((sheet) => /^Bills \d{4}-\d{2}$/.test(sheet.name));
  for (const name of new Set([...existingMonths.map((sheet) => sheet.name), ...recordsByMonth.keys()])) {
    addDataWorksheet(workbook, name, BILL_COLUMNS, recordsByMonth.get(name) || []);
  }
}
function readBillRows(workbook, records) {
  const sheet = workbook.getWorksheet('Bills');
  const recordsByBillId = new Map(records.map((record) => [record.billId, record]));
  const rows = [];
  sheet.eachRow((row, rowNumber) => {
    if (rowNumber > 1 && row.getCell('billId').value) {
      const workbookBill = billFromRow(row);
      const record = recordsByBillId.get(workbookBill.billId);
      rows.push(record
        ? { ...workbookBill, ...withCalculatedInvoiceTotalsWhenItemsExist(record) }
        : workbookBill);
    }
  });
  return rows;
}
async function openWorkbook() {
  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.readFile(WORKBOOK_PATH);
  } catch (error) {
    if (error.code !== 'ENOENT' && !/^File not found:/i.test(error.message || '')) throw error;
  }
  const billLedger = await readJsonLedger();
  const paymentLedger = await readPaymentLedger();
  const existingMonthNames = workbook.worksheets
    .map((sheet) => sheet.name)
    .filter((name) => /^Bills \d{4}-\d{2}$/.test(name));
  let sequenceSheet = workbook.getWorksheet('Metadata');
  const previousSequence = sequenceSheet ? Number(sequenceSheet.getCell('A2').value) || 0 : 0;
  for (const sheet of [...workbook.worksheets]) {
    if (['Bills', 'Items', 'Payments'].includes(sheet.name) || /^Bills \d{4}-\d{2}$/.test(sheet.name)) {
      workbook.removeWorksheet(sheet.id);
    }
  }
  const billsSheet = addDataWorksheet(workbook, 'Bills', BILL_COLUMNS, billLedger.records);
  const itemRecords = billLedger.records.flatMap((bill) => (bill.items || []).map((item) => ({
    billId: bill.billId,
    slNo: item.slNo,
    description: item.description,
    hsn: item.hsn,
    quantity: item.quantity,
    unit: item.unit,
    rateExclTax: item.rateExclTax,
    rateInclTax: item.rateInclTax,
    amount: item.amount,
    isDiscount: item.isDiscount ? 'Yes' : ''
  })));
  addDataWorksheet(workbook, 'Items', ITEM_COLUMNS, itemRecords);
  addDataWorksheet(workbook, 'Payments', PAYMENT_COLUMNS, paymentLedger.records);
  const recordsByMonth = new Map();
  for (const bill of billLedger.records) {
    const name = monthSheetName(bill.invoiceDate);
    if (!name) continue;
    if (!recordsByMonth.has(name)) recordsByMonth.set(name, []);
    recordsByMonth.get(name).push(bill);
  }
  for (const name of new Set([...existingMonthNames, ...recordsByMonth.keys()])) {
    addDataWorksheet(workbook, name, BILL_COLUMNS, recordsByMonth.get(name) || []);
  }
  sequenceSheet = workbook.getWorksheet('Metadata') || workbook.addWorksheet('Metadata');
  sequenceSheet.state = 'veryHidden';
  if (!sequenceSheet.getCell('A1').value) sequenceSheet.getCell('A1').value = 'Last Bill Number';
  let highestBillNumber = 0;
  for (const bill of billLedger.records) {
    const match = /^CGS-(\d+)$/.exec(String(bill.billId || ''));
    if (match) highestBillNumber = Math.max(highestBillNumber, Number(match[1]));
  }
  sequenceSheet.getCell('A2').value = Math.max(previousSequence, highestBillNumber);
  const visibleSheetOrder = ['Bills', 'Items', 'Payments', ...[...recordsByMonth.keys()].sort()];
  const remainingSheets = workbook.worksheets.filter((sheet) => !visibleSheetOrder.includes(sheet.name) && sheet.name !== 'Metadata');
  [...visibleSheetOrder, ...remainingSheets.map((sheet) => sheet.name), 'Metadata']
    .forEach((name, index) => { workbook.getWorksheet(name).orderNo = index + 1; });
  return workbook;
}
function isLockedFileError(error) {
  return ['EBUSY', 'EPERM', 'EACCES', 'ETXTBSY'].includes(error.code) || /locked|permission denied|sharing violation/i.test(error.message || '');
}
function sendFileError(response, error) {
  if (isLockedFileError(error)) {
    response.status(503).json({ error: 'Please close bills.xlsx and try again' });
    return;
  }
  console.error(error);
  response.status(500).json({ error: 'Unable to access the bills workbook.' });
}
async function readJsonLedger() {
  try {
    const content = await fs.readFile(JSON_PATH, 'utf8');
    const records = JSON.parse(content);
    if (!Array.isArray(records)) throw new Error('bills.json must contain a JSON array.');
    return { content, records };
  } catch (error) {
    if (error.code === 'ENOENT') return { content: null, records: [] };
    throw error;
  }
}
async function writeJsonContent(content) {
  await writeJsonContentTo(JSON_PATH, content);
}
async function writeJsonContentTo(filePath, content) {
  const temporaryPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  try {
    await fs.writeFile(temporaryPath, content, 'utf8');
    await fs.rename(temporaryPath, filePath);
  } catch (error) {
    await fs.unlink(temporaryPath).catch(() => {});
    throw error;
  }
}
async function writeJsonRecords(records) {
  await writeJsonContent(`${JSON.stringify(records, null, 2)}\n`);
}
async function readPaymentLedger() {
  try {
    const content = await fs.readFile(PAYMENTS_PATH, 'utf8');
    const records = JSON.parse(content);
    if (!Array.isArray(records)) throw new Error('payments.json must contain a JSON array.');
    for (const [index, payment] of records.entries()) {
      if (!payment || typeof payment !== 'object' || !payment.paymentId || !payment.vendorName
        || !/^\d{4}-\d{2}-\d{2}$/.test(String(payment.date || ''))
        || !Number.isFinite(Number(payment.amount)) || Number(payment.amount) <= 0) {
        throw new Error(`payments.json contains an invalid payment at row ${index + 1}.`);
      }
    }
    return { content, records };
  } catch (error) {
    if (error.code === 'ENOENT') return { content: null, records: [] };
    throw error;
  }
}
async function writePaymentRecords(records) {
  await writeJsonContentTo(PAYMENTS_PATH, `${JSON.stringify(records, null, 2)}\n`);
}
async function restoreJsonLedger(content) {
  if (content === null) {
    await fs.unlink(JSON_PATH).catch((error) => { if (error.code !== 'ENOENT') throw error; });
    return;
  }
  await writeJsonContent(content);
}
function text(value) {
  return typeof value === 'string' ? value.trim() : '';
}
function validateBill(body) {
  const required = [
    ['sellerName', 'Seller name'], ['sellerAddress', 'Seller address'], ['shipToName', 'Ship-to name'],
    ['shipToAddress', 'Ship-to address'], ['invoiceDate', 'Invoice date'], ['vehicleNo', 'Vehicle number']
  ];
  for (const [key, label] of required) {
    if (!text(body[key])) return `${label} is required.`;
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text(body.invoiceDate)) || Number.isNaN(Date.parse(`${body.invoiceDate}T00:00:00`))) return 'Enter a valid invoice date.';
  if (!Number.isInteger(Number(body.dueDays ?? 10)) || Number(body.dueDays ?? 10) < 1) return 'Due days must be a whole number of at least 1.';
  if (!Array.isArray(body.items) || body.items.length === 0) return 'Add at least one line item.';
  if (!Number.isFinite(Number(body.totalAmount)) || Number(body.totalAmount) < 0) return 'Enter a valid total amount.';
  if (!Number.isFinite(Number(body.percentageIncrease ?? 0)) || Number(body.percentageIncrease ?? 0) < 0) return 'Percentage of increase must be a non-negative number.';
  if (body.paymentStatus !== undefined && !['Paid', 'Unpaid'].includes(body.paymentStatus)) return 'Payment status must be Paid or Unpaid.';
  for (const [index, item] of body.items.entries()) {
    if (!text(item.description)) return `Line ${index + 1}: description is required.`;
    if (!Number.isFinite(Number(item.quantity)) || Number(item.quantity) <= 0) return `Line ${index + 1}: quantity must be greater than 0.`;
    if (item.hsn && !/^\d{4,8}$/.test(String(item.hsn))) return `Line ${index + 1}: HSN must contain 4 to 8 digits.`;
    if (!text(item.unit)) return `Line ${index + 1}: unit is required.`;
    for (const key of ['rateExclTax', 'rateInclTax', 'amount']) {
      if (!Number.isFinite(Number(item[key])) || Number(item[key]) < 0) return `Line ${index + 1}: ${key} must be a valid non-negative number.`;
    }
  }
  return null;
}
function cellValue(row, key) {
  const value = row.getCell(key).value;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return value ?? '';
}
function billFromRow(row) {
  return {
    billId: cellValue(row, 'billId'),
    createdAt: cellValue(row, 'createdAt'),
    invoiceDate: cellValue(row, 'invoiceDate'),
    sellerAddress: cellValue(row, 'sellerAddress'),
    shipToName: cellValue(row, 'shipToName'),
    shipToAddress: cellValue(row, 'shipToAddress'),
    vehicleNo: cellValue(row, 'vehicleNo'),
    totalAmount: Number(cellValue(row, 'totalAmount')) || 0,
    discountAmount: Number(cellValue(row, 'discountAmount')) || 0,
    roundOffAmount: Number(cellValue(row, 'roundOffAmount')) || 0,
    paymentStatus: cellValue(row, 'paymentStatus'),
    paidOn: cellValue(row, 'paidOn') || null
  };
}
function localDate() {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
function validatePayment(body) {
  if (!text(body.vendorName)) return 'Choose a vendor.';
  const paymentDate = text(body.date);
  const parsedDate = new Date(`${paymentDate}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(paymentDate)
    || Number.isNaN(parsedDate.getTime())
    || parsedDate.toISOString().slice(0, 10) !== paymentDate) return 'Enter a valid payment date.';
  if (!Number.isFinite(Number(body.amount)) || Number(body.amount) <= 0) return 'Enter a payment amount greater than zero.';
  if (Math.abs(Number(body.amount) * 100 - Math.round(Number(body.amount) * 100)) > 0.000001) return 'Payment amount must use no more than two decimal places.';
  return null;
}
function summarizeVendors(bills, payments) {
  const vendors = new Map();
  for (const bill of bills) {
    const vendorName = text(bill.shipToName);
    if (!vendorName) continue;
    const key = vendorName.toLocaleLowerCase();
    if (!vendors.has(key)) {
      vendors.set(key, { vendorName, billCount: 0, totalAmount: 0, legacyPaidAmount: 0, payments: [] });
    }
    const vendor = vendors.get(key);
    const amount = Math.round((Number(bill.totalAmount) || 0) * 100);
    vendor.billCount += 1;
    vendor.totalAmount += amount;
    if (bill.paymentStatus === 'Paid') vendor.legacyPaidAmount += amount;
  }
  for (const payment of payments) {
    const vendor = vendors.get(text(payment.vendorName).toLocaleLowerCase());
    if (vendor) vendor.payments.push(payment);
  }
  const entries = [...vendors.values()].map((vendor) => {
    const amountReceived = vendor.payments.reduce((sum, payment) => sum + Math.round(Number(payment.amount) * 100), 0);
    const paidAmount = Math.min(vendor.totalAmount, vendor.legacyPaidAmount + amountReceived);
    return {
      vendorName: vendor.vendorName,
      billCount: vendor.billCount,
      totalAmount: vendor.totalAmount / 100,
      paidAmount: paidAmount / 100,
      unpaidAmount: Math.max(0, vendor.totalAmount - paidAmount) / 100,
      payments: vendor.payments.slice().sort((a, b) => b.date.localeCompare(a.date))
    };
  }).sort((a, b) => a.vendorName.localeCompare(b.vendorName));
  const totalPaise = entries.reduce((sum, vendor) => sum + Math.round(vendor.totalAmount * 100), 0);
  const paidPaise = entries.reduce((sum, vendor) => sum + Math.round(vendor.paidAmount * 100), 0);
  return {
    summary: {
      totalAmount: totalPaise / 100,
      paidAmount: paidPaise / 100,
      unpaidAmount: Math.max(0, totalPaise - paidPaise) / 100,
      vendorCount: entries.length
    },
    vendors: entries
  };
}
function dueDate(invoiceDate, dueDays) {
  const date = new Date(`${invoiceDate}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + dueDays);
  return date.toISOString().slice(0, 10);
}
function withCalculatedInvoiceTotals(bill) {
  const taxSummary = summarizeTaxByHsn(bill.items);
  const taxablePaise = taxSummary.reduce((sum, row) => sum + Math.round(row.taxableValue * 100), 0);
  const taxPaise = taxSummary.reduce((sum, row) => sum + Math.round(row.taxAmount * 100), 0);
  const calculatedPaise = taxablePaise + taxPaise;
  const roundedTotalPaise = Math.ceil(calculatedPaise / 100) * 100;
  return {
    ...bill,
    totalAmount: roundedTotalPaise / 100,
    roundOffAmount: (roundedTotalPaise - calculatedPaise) / 100,
    amountInWords: amountInWords(roundedTotalPaise / 100),
    taxSummary
  };
}
function withCalculatedInvoiceTotalsWhenItemsExist(bill) {
  return Array.isArray(bill.items) && bill.items.length
    ? withCalculatedInvoiceTotals(bill)
    : { ...bill, amountInWords: amountInWords(bill.totalAmount), taxSummary: [] };
}

app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public')));

app.post('/api/bills', async (request, response) => {
  const validationError = validateBill(request.body || {});
  if (validationError) return response.status(400).json({ error: validationError });
  try {
    const result = await serializeWorkbook(async () => {
      const workbook = await openWorkbook();
      const billsSheet = workbook.getWorksheet('Bills');
      const itemsSheet = workbook.getWorksheet('Items');
      let latestNumber = Number(workbook.getWorksheet('Metadata').getCell('A2').value) || 0;
      billsSheet.eachRow((row, rowNumber) => {
        if (rowNumber === 1) return;
        const match = /^CGS-(\d+)$/.exec(String(row.getCell('billId').value || ''));
        if (match) latestNumber = Math.max(latestNumber, Number(match[1]));
      });
      const billId = `CGS-${String(latestNumber + 1).padStart(4, '0')}`;
      workbook.getWorksheet('Metadata').getCell('A2').value = latestNumber + 1;
      const paymentStatus = request.body.paymentStatus || 'Unpaid';
      const percentageIncrease = Number(request.body.percentageIncrease || 0);
      const rateMultiplier = 1 + percentageIncrease / 100;
      const increaseRate = (rate) => Math.round((Number(rate) * rateMultiplier + Number.EPSILON) * 100) / 100;
      const items = request.body.items.map((item, index) => {
        const amountBeforeIncrease = Number(item.amount);
        const amount = Math.round((amountBeforeIncrease * (1 + percentageIncrease / 100) + Number.EPSILON) * 100) / 100;
        return {
          slNo: index + 1,
          description: text(item.description),
          hsn: text(String(item.hsn || '')),
          quantity: Number(item.quantity),
          unit: text(item.unit),
          rateExclTax: increaseRate(item.rateExclTax),
          rateInclTax: increaseRate(item.rateInclTax),
          amountBeforeIncrease,
          amount,
          isDiscount: Boolean(item.isDiscount)
        };
      });
      const subtotalPaise = items.reduce((sum, item) => sum + Math.round(item.amount * 100), 0);
      const discountPaise = items.reduce((sum, item) => (
        item.isDiscount ? sum + Math.round(item.amount * 100) : sum
      ), 0);
      const taxSummary = summarizeTaxByHsn(items);
      const taxPaise = taxSummary.reduce((sum, row) => sum + Math.round(row.taxAmount * 100), 0);
      const calculatedPaise = subtotalPaise - discountPaise + taxPaise;
      const roundedTotalPaise = Math.ceil(calculatedPaise / 100) * 100;
      const bill = {
        billId,
        createdAt: new Date().toISOString(),
        invoiceDate: text(request.body.invoiceDate),
        dueDays: Number(request.body.dueDays ?? 10),
        dueDate: dueDate(text(request.body.invoiceDate), Number(request.body.dueDays ?? 10)),
        sellerName: text(request.body.sellerName),
        sellerAddress: text(request.body.sellerAddress),
        shipToName: text(request.body.shipToName),
        shipToAddress: text(request.body.shipToAddress),
        vehicleNo: text(request.body.vehicleNo).toUpperCase().replace(/\s/g, ''),
        totalAmount: roundedTotalPaise / 100,
        discountAmount: discountPaise / 100,
        roundOffAmount: (roundedTotalPaise - calculatedPaise) / 100,
        paymentStatus,
        paidOn: paymentStatus === 'Paid' ? localDate() : '',
        percentageIncrease,
        items
      };
      const previousJson = await readJsonLedger();
      await writeJsonRecords([...previousJson.records, bill]);
      billsSheet.addRow(bill);
      items.forEach((item) => {
        itemsSheet.addRow({
          billId,
          slNo: item.slNo,
          description: item.description,
          hsn: item.hsn,
          quantity: item.quantity,
          unit: item.unit,
          rateExclTax: item.rateExclTax,
          rateInclTax: item.rateInclTax,
          amount: item.amount,
          isDiscount: item.isDiscount ? 'Yes' : ''
        });
      });
      try {
        synchronizeMonthlySheets(workbook, billsSheet);
        await workbook.xlsx.writeFile(WORKBOOK_PATH);
      } catch (error) {
        await restoreJsonLedger(previousJson.content);
        throw error;
      }
      return { billId, paymentStatus };
    });
    response.status(201).json(result);
  } catch (error) {
    sendFileError(response, error);
  }
});

app.get('/api/bills', async (_request, response) => {
  try {
    const bills = await serializeWorkbook(async () => {
      const workbook = await openWorkbook();
      const { records } = await readJsonLedger();
      return readBillRows(workbook, records).reverse();
    });
    response.json(bills);
  } catch (error) {
    sendFileError(response, error);
  }
});

app.get('/api/explore', async (_request, response) => {
  try {
    const data = await serializeWorkbook(async () => {
      const workbook = await openWorkbook();
      const [{ records }, paymentLedger] = await Promise.all([readJsonLedger(), readPaymentLedger()]);
      return summarizeVendors(readBillRows(workbook, records), paymentLedger.records);
    });
    response.json(data);
  } catch (error) {
    sendFileError(response, error);
  }
});

app.post('/api/payments', async (request, response) => {
  const validationError = validatePayment(request.body || {});
  if (validationError) return response.status(400).json({ error: validationError });
  try {
    const payment = await serializeWorkbook(async () => {
      const workbook = await openWorkbook();
      const bills = readBillRows(workbook, (await readJsonLedger()).records);
      const paymentLedger = await readPaymentLedger();
      const vendorSummary = summarizeVendors(bills, paymentLedger.records);
      const vendor = vendorSummary.vendors.find((entry) => (
        entry.vendorName.toLocaleLowerCase() === text(request.body.vendorName).toLocaleLowerCase()
      ));
      if (!vendor) return { error: 'Vendor not found.' };
      const amountPaise = Math.round(Number(request.body.amount) * 100);
      const balancePaise = Math.round(vendor.unpaidAmount * 100);
      if (amountPaise > balancePaise) {
        return { error: `Payment exceeds the outstanding balance of ₹${(balancePaise / 100).toFixed(2)}.` };
      }
      const updatedBalance = Math.max(0, balancePaise - amountPaise) / 100;
      const nextPayment = {
        paymentId: `PAY-${String(paymentLedger.records.length + 1).padStart(4, '0')}`,
        date: text(request.body.date),
        vendorName: vendor.vendorName,
        amount: amountPaise / 100,
        remainingBalance: updatedBalance,
        createdAt: new Date().toISOString()
      };
      await writePaymentRecords([...paymentLedger.records, nextPayment]);
      try {
        workbook.getWorksheet('Payments').addRow(nextPayment);
        await workbook.xlsx.writeFile(WORKBOOK_PATH);
      } catch (error) {
        if (paymentLedger.content === null) {
          await fs.unlink(PAYMENTS_PATH).catch((unlinkError) => { if (unlinkError.code !== 'ENOENT') throw unlinkError; });
        } else {
          await writeJsonContentTo(PAYMENTS_PATH, paymentLedger.content);
        }
        throw error;
      }
      return nextPayment;
    });
    if (payment.error) return response.status(payment.error === 'Vendor not found.' ? 404 : 400).json({ error: payment.error });
    response.status(201).json(payment);
  } catch (error) {
    sendFileError(response, error);
  }
});

app.get('/api/bills/export', async (_request, response) => {
  try {
    const workbookBuffer = await serializeWorkbook(async () => {
      const workbook = await openWorkbook();
      return workbook.xlsx.writeBuffer();
    });
    response.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    response.setHeader('Content-Disposition', 'attachment; filename="bills.xlsx"');
    response.send(Buffer.from(workbookBuffer));
  } catch (error) {
    sendFileError(response, error);
  }
});

app.get('/api/bills/:billId', async (request, response) => {
  try {
    const bill = await serializeWorkbook(async () => {
      const { records } = await readJsonLedger();
      const record = records.find((entry) => entry.billId === request.params.billId);
      return record ? withCalculatedInvoiceTotalsWhenItemsExist(record) : null;
    });
    if (!bill) return response.status(404).json({ error: 'Bill not found.' });
    response.json(bill);
  } catch (error) {
    sendFileError(response, error);
  }
});

app.get('/api/bills/:billId/pdf', async (request, response) => {
  try {
    const bill = await serializeWorkbook(async () => {
      const { records } = await readJsonLedger();
      const record = records.find((entry) => entry.billId === request.params.billId);
      return record ? withCalculatedInvoiceTotalsWhenItemsExist(record) : null;
    });
    if (!bill) return response.status(404).json({ error: 'Bill not found.' });
    const pdf = await createInvoicePdf(bill);
    const safeBillId = String(bill.billId).replace(/[^A-Za-z0-9-]/g, '');
    response.setHeader('Content-Type', 'application/pdf');
    response.setHeader('Content-Disposition', `attachment; filename="${safeBillId}.pdf"`);
    pdf.pipe(response);
    pdf.end();
  } catch (error) {
    sendFileError(response, error);
  }
});

app.delete('/api/bills/:billId', async (request, response) => {
  try {
    const deletedBill = await serializeWorkbook(async () => {
      const workbook = await openWorkbook();
      const billsSheet = workbook.getWorksheet('Bills');
      const itemsSheet = workbook.getWorksheet('Items');
      const previousJson = await readJsonLedger();
      const matchingRecords = previousJson.records.filter((record) => record.billId === request.params.billId);
      const billRows = [];
      const itemRows = [];
      billsSheet.eachRow((row, rowNumber) => {
        if (rowNumber > 1 && String(row.getCell('billId').value) === request.params.billId) billRows.push(rowNumber);
      });
      itemsSheet.eachRow((row, rowNumber) => {
        if (rowNumber > 1 && String(row.getCell('billId').value) === request.params.billId) itemRows.push(rowNumber);
      });
      if (billRows.length === 0 && matchingRecords.length === 0) return null;

      await writeJsonRecords(previousJson.records.filter((record) => record.billId !== request.params.billId));
      try {
        for (const rowNumber of billRows.reverse()) billsSheet.spliceRows(rowNumber, 1);
        for (const rowNumber of itemRows.reverse()) itemsSheet.spliceRows(rowNumber, 1);
        synchronizeMonthlySheets(workbook, billsSheet);
        await workbook.xlsx.writeFile(WORKBOOK_PATH);
      } catch (error) {
        await restoreJsonLedger(previousJson.content);
        throw error;
      }
      return { billId: request.params.billId };
    });
    if (!deletedBill) return response.status(404).json({ error: 'Bill not found.' });
    response.json(deletedBill);
  } catch (error) {
    sendFileError(response, error);
  }
});

app.patch('/api/bills/:billId/status', async (request, response) => {
  const { paymentStatus } = request.body || {};
  if (!['Paid', 'Unpaid'].includes(paymentStatus)) return response.status(400).json({ error: 'Payment status must be Paid or Unpaid.' });
  try {
    const bill = await serializeWorkbook(async () => {
      const workbook = await openWorkbook();
      const sheet = workbook.getWorksheet('Bills');
      let targetRow;
      sheet.eachRow((row, rowNumber) => {
        if (rowNumber > 1 && String(row.getCell('billId').value) === request.params.billId) targetRow = row;
      });
      if (!targetRow) return null;
      const previousJson = await readJsonLedger();
      const matchingRecord = previousJson.records.find((record) => record.billId === request.params.billId);
      if (matchingRecord) {
        matchingRecord.paymentStatus = paymentStatus;
        matchingRecord.paidOn = paymentStatus === 'Paid' ? localDate() : '';
        await writeJsonRecords(previousJson.records);
      }
      targetRow.getCell('paymentStatus').value = paymentStatus;
      targetRow.getCell('paidOn').value = paymentStatus === 'Paid' ? localDate() : '';
      try {
        synchronizeMonthlySheets(workbook, sheet);
        await workbook.xlsx.writeFile(WORKBOOK_PATH);
      } catch (error) {
        if (matchingRecord) await restoreJsonLedger(previousJson.content);
        throw error;
      }
      return billFromRow(targetRow);
    });
    if (!bill) return response.status(404).json({ error: 'Bill not found.' });
    response.json(bill);
  } catch (error) {
    sendFileError(response, error);
  }
});

async function start() {
  await fs.mkdir(DATA_DIRECTORY, { recursive: true });
  await serializeWorkbook(async () => {
    const workbook = await openWorkbook();
    const paymentLedger = await readPaymentLedger();
    if (paymentLedger.content === null) await writePaymentRecords([]);
    await workbook.xlsx.writeFile(WORKBOOK_PATH);
  });
  const server = app.listen(PORT, () => {
    console.log(`CGS Global Enterprises Bill Book running at http://localhost:${server.address().port}`);
    const extractor = spawn(process.execPath, [EXTRACTOR_SERVER_PATH], {
      cwd: path.dirname(EXTRACTOR_SERVER_PATH),
      env: process.env,
      stdio: 'inherit'
    });
    extractor.on('error', (error) => {
      console.error('Unable to start the vendor PDF extractor:', error);
    });
    extractor.on('exit', (code, signal) => {
      if (code && code !== 0) {
        console.error(`Vendor PDF extractor exited with code ${code}${signal ? ` (${signal})` : ''}.`);
      }
    });
    const stopExtractor = () => {
      if (!extractor.killed) extractor.kill();
    };
    const shutdown = () => {
      stopExtractor();
      server.close();
    };
    process.once('SIGINT', shutdown);
    process.once('SIGTERM', shutdown);
    server.once('close', stopExtractor);
  });
}

start().catch((error) => {
  console.error('Unable to initialize bills.xlsx:', error);
  process.exitCode = 1;
});
