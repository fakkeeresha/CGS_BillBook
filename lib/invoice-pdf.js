const PDFDocument = require('pdfkit');
const fs = require('node:fs/promises');
const path = require('node:path');
const { summarizeTaxByHsn } = require('./tax-summary');
const { amountInWords } = require('./amount-in-words');

const PAGE_MARGIN = 32;
const INK = '#111111';
const RULE = '#9bb8b1';
const HEADER_FILL = '#e8f3f0';
const TOTAL_FILL = '#dceee8';
const COLUMN_WIDTHS = [28, 175, 52, 48, 73, 73, 82];
const SELLER_NAME = 'CGS GLOBAL ENTERPRISES';
const SELLER_ADDRESS = [
  '1st Cross, Site No 33, Chandapura Anekal road, Iggalur Village,',
  'HM Layout, Bengaluru, Bengaluru Urb, Bangalore, Karnataka, 560099',
  'GSTIN: 29CNDPN4917R1Z5  Mobile: 6360649010',
  'PAN Number: CNDPN4917R',
  'Email: cgsglobalenterprises@gmail.com'
].join('\n');
const BANK_DETAILS = [
  'Bank Details',
  'Name: CGS GLOBAL ENTERPRISES',
  'IFSC Code: BARB0VJSISA',
  'Account No: 67520200001650',
  'Bank: Bank of Baroda ,SINGASANDRA AECS LAYOUT'
];

function formatMoney(value) {
  return `₹${new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(value) || 0)}`;
}
function formatDate(value) {
  if (!value) return '—';
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value));
  if (!match) return String(value);
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  const month = new Intl.DateTimeFormat('en-GB', { month: 'short', timeZone: 'UTC' }).format(date);
  return `${match[3]}-${month}-${match[1]}`;
}
function drawRule(doc, x1, y1, x2, y2, width = 0.7) {
  doc.save().lineWidth(width).strokeColor(RULE).moveTo(x1, y1).lineTo(x2, y2).stroke().restore();
}
async function registerFonts(doc) {
  const windowsDirectory = path.join(process.env.WINDIR || 'C:\\Windows', 'Fonts');
  const fontPairs = [
    [path.join(windowsDirectory, 'arial.ttf'), path.join(windowsDirectory, 'arialbd.ttf')],
    ['/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf', '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf']
  ];
  for (const [regular, bold] of fontPairs) {
    try {
      await fs.access(regular);
      await fs.access(bold);
      doc.registerFont('Invoice', regular);
      doc.registerFont('Invoice-Bold', bold);
      return { regular: 'Invoice', bold: 'Invoice-Bold' };
    } catch {}
  }
  return { regular: 'Helvetica', bold: 'Helvetica-Bold' };
}
function drawTop(doc, bill, fonts) {
  const x = PAGE_MARGIN;
  const width = doc.page.width - PAGE_MARGIN * 2;
  const rightX = x + 330;
  const top = 48;
  const headerHeight = 112;
  doc.font(fonts.bold).fontSize(10).text('TAX INVOICE', x, 28);
  doc.font(fonts.regular).fontSize(8).text('ORIGINAL FOR RECIPIENT', x + 75, 29);
  doc.rect(x, top, width, headerHeight).lineWidth(0.8).strokeColor(RULE).stroke();
  drawRule(doc, rightX, top, rightX, top + headerHeight);
  drawRule(doc, rightX, top + 70, x + width, top + 70);
  doc.font(fonts.bold).fontSize(14).text(SELLER_NAME, x + 8, top + 8, { width: 313 });
  doc.font(fonts.regular).fontSize(9).text(SELLER_ADDRESS, x + 8, top + 28, { width: 313, height: 75, ellipsis: true });
  doc.font(fonts.bold).fontSize(8).text('INVOICE NO.', rightX + 12, top + 12);
  doc.font(fonts.regular).fontSize(9).text(bill.billId || '', rightX + 12, top + 27);
  doc.font(fonts.bold).fontSize(8).text('INVOICE DATE', rightX + 120, top + 12);
  doc.font(fonts.regular).fontSize(9).text(formatDate(bill.invoiceDate), rightX + 120, top + 27);
  doc.font(fonts.bold).fontSize(8).text('VEHICLE NO.', rightX + 12, top + 82);
  doc.font(fonts.regular).fontSize(9).text(bill.vehicleNo || '—', rightX + 12, top + 96, { width: 190 });

  const partiesTop = top + headerHeight + 10;
  const partyWidth = width / 2;
  const partyHeight = 74;
  doc.rect(x, partiesTop, partyWidth, partyHeight).lineWidth(0.8).strokeColor(RULE).stroke();
  doc.rect(x + partyWidth, partiesTop, partyWidth, partyHeight).lineWidth(0.8).strokeColor(RULE).stroke();
  doc.font(fonts.bold).fontSize(8).text('BILL TO', x + 8, partiesTop + 8);
  doc.font(fonts.bold).fontSize(10).text(bill.shipToName || '', x + 8, partiesTop + 23, { width: partyWidth - 16 });
  doc.font(fonts.regular).fontSize(8).text(bill.shipToAddress || '', x + 8, partiesTop + 39, { width: partyWidth - 16, height: 29, ellipsis: true });
  doc.font(fonts.bold).fontSize(8).text('SHIP TO', x + partyWidth + 8, partiesTop + 8);
  doc.font(fonts.bold).fontSize(10).text(bill.shipToName || '', x + partyWidth + 8, partiesTop + 23, { width: partyWidth - 16 });
  doc.font(fonts.regular).fontSize(8).text(bill.shipToAddress || '', x + partyWidth + 8, partiesTop + 39, { width: partyWidth - 16, height: 29, ellipsis: true });
  return partiesTop + partyHeight + 10;
}
function drawTableHeader(doc, x, y, fonts) {
  const headers = ['S.NO.', 'ITEMS', 'HSN', 'QTY.', 'RATE\nEXCL. GST', 'RATE\nINCL. GST', 'AMOUNT\nEXCL. GST'];
  const height = 30;
  let cursor = x;
  for (let index = 0; index < COLUMN_WIDTHS.length; index++) {
    const columnWidth = COLUMN_WIDTHS[index];
    doc.rect(cursor, y, columnWidth, height).fillAndStroke(HEADER_FILL, RULE);
    doc.fillColor(INK).font(fonts.bold).fontSize(7).text(headers[index], cursor + 3, y + 5, {
      width: columnWidth - 6,
      height: height - 8,
      align: index === 1 ? 'left' : 'center',
      lineGap: 1
    });
    cursor += columnWidth;
  }
  return y + height;
}
function drawInvoiceTable(doc, bill, startY, fonts) {
  const x = PAGE_MARGIN;
  const width = COLUMN_WIDTHS.reduce((sum, columnWidth) => sum + columnWidth, 0);
  let y = drawTableHeader(doc, x, startY, fonts);
  let quantityTotal = 0;
  const items = Array.isArray(bill.items) ? bill.items : [];
  items.forEach((item, index) => {
    const description = `${item.description || ''}${item.isDiscount ? ' (SCHEME/FREE ITEM)' : ''}`;
    const descriptionHeight = doc.font(fonts.regular).fontSize(8).heightOfString(description, { width: COLUMN_WIDTHS[1] - 10 });
    const rowHeight = Math.max(30, descriptionHeight + 12);
    if (y + rowHeight > doc.page.height - 156) {
      doc.addPage();
      doc.font(fonts.bold).fontSize(9).text(`TAX INVOICE ${bill.billId || ''} — CONTINUED`, x, 28);
      y = drawTableHeader(doc, x, 48, fonts);
    }
    const values = [
      String(item.slNo || index + 1),
      description,
      String(item.hsn || '—'),
      `${item.quantity ?? ''} ${item.unit || ''}`.trim(),
      formatMoney(item.rateExclTax),
      formatMoney(item.rateInclTax),
      formatMoney(item.amount)
    ];
    let cursor = x;
    for (let column = 0; column < COLUMN_WIDTHS.length; column++) {
      const columnWidth = COLUMN_WIDTHS[column];
      doc.rect(cursor, y, columnWidth, rowHeight).lineWidth(0.45).strokeColor(RULE).stroke();
      doc.fillColor(INK).font(fonts.regular).fontSize(8).text(values[column], cursor + 4, y + 7, {
        width: columnWidth - 8,
        height: rowHeight - 10,
        align: column === 1 ? 'left' : (column >= 4 ? 'right' : 'center'),
        ellipsis: true
      });
      cursor += columnWidth;
    }
    quantityTotal += Number(item.quantity) || 0;
    y += rowHeight;
  });
  return { y, x, width, quantityTotal };
}
function drawTaxSummary(doc, bill, x, startY, width, fonts) {
  const rows = summarizeTaxByHsn(bill.items);
  const columnWidths = [78, 105, 47, 74, 47, 74, width - 425];
  const rowHeight = 20;
  const headerHeight = 36;
  const totalHeight = 20;
  const footerReserve = 80;
  const pageBottom = doc.page.height - PAGE_MARGIN;
  let y = startY;
  const drawCell = (label, cellX, cellY, cellWidth, cellHeight, fontSize = 7) => {
    doc.rect(cellX, cellY, cellWidth, cellHeight).fillAndStroke(HEADER_FILL, RULE);
    doc.fillColor(INK).font(fonts.bold).fontSize(fontSize).text(label, cellX + 2, cellY + Math.max(4, (cellHeight - fontSize) / 2), {
      width: cellWidth - 4,
      height: cellHeight - 4,
      align: 'center',
      lineBreak: false
    });
  };
  const drawHeader = () => {
    const topY = y;
    const hsnX = x;
    const taxableX = hsnX + columnWidths[0];
    const cgstX = taxableX + columnWidths[1];
    const sgstX = cgstX + columnWidths[2] + columnWidths[3];
    const totalTaxX = sgstX + columnWidths[4] + columnWidths[5];
    drawCell('HSN/SAC', hsnX, topY, columnWidths[0], headerHeight, 7.5);
    drawCell('Taxable Value', taxableX, topY, columnWidths[1], headerHeight, 7.5);
    drawCell('CGST', cgstX, topY, columnWidths[2] + columnWidths[3], headerHeight / 2, 7.5);
    drawCell('SGST', sgstX, topY, columnWidths[4] + columnWidths[5], headerHeight / 2, 7.5);
    drawCell('Total Tax Amount', totalTaxX, topY, columnWidths[6], headerHeight, 7.5);
    drawCell('Rate', cgstX, topY + headerHeight / 2, columnWidths[2], headerHeight / 2);
    drawCell('Amount', cgstX + columnWidths[2], topY + headerHeight / 2, columnWidths[3], headerHeight / 2);
    drawCell('Rate', sgstX, topY + headerHeight / 2, columnWidths[4], headerHeight / 2);
    drawCell('Amount', sgstX + columnWidths[4], topY + headerHeight / 2, columnWidths[5], headerHeight / 2);
    y += headerHeight;
  };
  const startNextPage = () => {
    doc.addPage();
    y = PAGE_MARGIN;
    drawHeader();
  };
  const taxableTotal = rows.reduce((sum, row) => sum + row.taxableValue, 0);
  const cgstTotal = rows.reduce((sum, row) => sum + row.cgstAmount, 0);
  const sgstTotal = rows.reduce((sum, row) => sum + row.sgstAmount, 0);
  const taxTotal = rows.reduce((sum, row) => sum + row.taxAmount, 0);

  if (y + headerHeight + rowHeight + totalHeight + footerReserve > pageBottom) startNextPage();
  else drawHeader();
  for (const row of rows) {
    if (y + rowHeight + totalHeight + footerReserve > pageBottom) startNextPage();
    const rateLabel = (rate) => rate === null ? '—' : `${Number(rate)}%`;
    const values = [row.hsn, formatMoney(row.taxableValue), rateLabel(row.cgstRate), formatMoney(row.cgstAmount), rateLabel(row.sgstRate), formatMoney(row.sgstAmount), formatMoney(row.taxAmount)];
    let cursor = x;
    for (let index = 0; index < values.length; index++) {
      const columnWidth = columnWidths[index];
      doc.rect(cursor, y, columnWidth, rowHeight).lineWidth(0.45).strokeColor(RULE).stroke();
      doc.fillColor(INK).font(fonts.regular).fontSize(8).text(values[index], cursor + 4, y + 6, {
        width: columnWidth - 8,
        height: rowHeight - 8,
        align: index === 0 || index === 2 || index === 4 ? 'center' : 'right',
        lineBreak: false
      });
      cursor += columnWidth;
    }
    y += rowHeight;
  }
  if (y + totalHeight + footerReserve > pageBottom) startNextPage();
  const totals = [
    { label: 'TOTAL', width: columnWidths[0], align: 'left' },
    { label: formatMoney(taxableTotal), width: columnWidths[1], align: 'right' },
    { label: '', width: columnWidths[2], align: 'right' },
    { label: formatMoney(cgstTotal), width: columnWidths[3], align: 'right' },
    { label: '', width: columnWidths[4], align: 'right' },
    { label: formatMoney(sgstTotal), width: columnWidths[5], align: 'right' },
    { label: formatMoney(taxTotal), width: columnWidths[6], align: 'right' }
  ];
  let cursor = x;
  for (const total of totals) {
    doc.rect(cursor, y, total.width, totalHeight).fillAndStroke(TOTAL_FILL, RULE);
    doc.fillColor(INK).font(fonts.bold).fontSize(8).text(total.label, cursor + 4, y + 6, {
      width: total.width - 8,
      align: total.align,
      lineBreak: false
    });
    cursor += total.width;
  }
  return y + totalHeight;
}

function drawSummary(doc, bill, table, fonts) {
  const discountAmount = Number(bill.discountAmount)
    || (bill.items || []).filter((item) => item.isDiscount).reduce((sum, item) => sum + (Number(item.amount) || 0), 0);
  const taxSummary = summarizeTaxByHsn(bill.items);
  const taxAmount = taxSummary.reduce((sum, row) => sum + row.taxAmount, 0);
  const subtotalPaise = (bill.items || []).reduce((sum, item) => sum + Math.round((Number(item.amount) || 0) * 100), 0);
  const discountPaise = Math.round(discountAmount * 100);
  const taxPaise = Math.round(taxAmount * 100);
  const calculatedTotalPaise = subtotalPaise - discountPaise + taxPaise;
  const roundOffAmount = Number.isFinite(Number(bill.roundOffAmount))
    ? Number(bill.roundOffAmount)
    : (Math.ceil(calculatedTotalPaise / 100) * 100 - calculatedTotalPaise) / 100;
  const adjustmentRows = Number(discountAmount > 0 || taxAmount > 0)
    + Number(discountAmount > 0)
    + Number(taxAmount > 0)
    + Number(roundOffAmount > 0);
  const summaryHeaderHeight = adjustmentRows * 18 + 26 + 64;
  const pageBottom = doc.page.height - PAGE_MARGIN;
  let y = table.y + 12;
  if (y + summaryHeaderHeight > pageBottom) {
    doc.addPage();
    y = PAGE_MARGIN + 16;
  }
  const labelWidth = COLUMN_WIDTHS.slice(0, -1).reduce((sum, width) => sum + width, 0);
  if (adjustmentRows > 0) {
    const drawAdjustmentRow = (label, amount, rowTop, sign = '') => {
      doc.rect(table.x, rowTop, table.width, 18).fillAndStroke('#ffffff', RULE);
      doc.fillColor(INK).font(fonts.bold).fontSize(8).text(label, table.x + 8, rowTop + 5, { width: labelWidth - 16, align: 'right' });
      doc.font(fonts.bold).fontSize(8).text(`${sign}${formatMoney(amount)}`, table.x + table.width - COLUMN_WIDTHS[6] + 4, rowTop + 5, {
        width: COLUMN_WIDTHS[6] - 10,
        align: 'right'
      });
    };
    const subtotal = (bill.items || []).reduce((sum, item) => sum + (Number(item.amount) || 0), 0);
    drawAdjustmentRow('SUBTOTAL (EXCL. GST)', subtotal, y);
    y += 18;
    if (discountAmount > 0) {
      drawAdjustmentRow('DISCOUNT (SCHEME/FREE ITEMS)', discountAmount, y, '−');
      y += 18;
    }
    if (taxAmount > 0) {
      drawAdjustmentRow('TOTAL TAX AMOUNT', taxAmount, y, '+');
      y += 18;
    }
    if (roundOffAmount > 0) {
      drawAdjustmentRow('ROUND OFF', roundOffAmount, y, '+');
      y += 18;
    }
  }
  const totalTop = y;
  doc.rect(table.x, totalTop, table.width, 26).fillAndStroke(TOTAL_FILL, RULE);
  doc.fillColor(INK).font(fonts.bold).fontSize(9).text('TOTAL', table.x + 8, totalTop + 8, { width: labelWidth - 16, align: 'right' });
  doc.font(fonts.regular).fontSize(8).text(String(table.quantityTotal), table.x + COLUMN_WIDTHS[0] + COLUMN_WIDTHS[1] + COLUMN_WIDTHS[2] + 4, totalTop + 8, { width: COLUMN_WIDTHS[3] - 8, align: 'center' });
  doc.font(fonts.bold).fontSize(9).text(formatMoney(bill.totalAmount), table.x + table.width - COLUMN_WIDTHS[6] + 4, totalTop + 7, { width: COLUMN_WIDTHS[6] - 10, align: 'right' });

  const wordsTop = totalTop + 28;
  doc.rect(table.x, wordsTop, table.width, 36).fillAndStroke(HEADER_FILL, RULE);
  doc.font(fonts.bold).fontSize(8).text('AMOUNT IN WORDS', table.x + 6, wordsTop + 5);
  doc.font(fonts.regular).fontSize(8).text(amountInWords(bill.totalAmount), table.x + 6, wordsTop + 18, {
    width: table.width - 12,
    height: 14
  });

  const taxBottom = drawTaxSummary(doc, bill, table.x, wordsTop + 44, table.width, fonts);
  const footerHeight = 72;
  let signatureTop = taxBottom + 8;
  if (signatureTop + footerHeight > doc.page.height - PAGE_MARGIN) {
    doc.addPage();
    signatureTop = PAGE_MARGIN;
  }
  const dividerX = table.x + table.width * 0.55;
  doc.rect(table.x, signatureTop, table.width, footerHeight).lineWidth(0.8).strokeColor(RULE).stroke();
  drawRule(doc, dividerX, signatureTop, dividerX, signatureTop + footerHeight);
  doc.font(fonts.bold).fontSize(8).text(BANK_DETAILS[0], table.x + 8, signatureTop + 7);
  doc.font(fonts.regular).fontSize(7).text(BANK_DETAILS.slice(1).join('\n'), table.x + 8, signatureTop + 20, {
    width: dividerX - table.x - 16,
    height: footerHeight - 25,
    lineGap: 1
  });
  const signatureX = dividerX + 7;
  const signatureWidth = table.x + table.width - signatureX - 7;
  doc.font(fonts.bold).fontSize(8).text(`For ${SELLER_NAME}`, signatureX, signatureTop + 8, { width: signatureWidth, align: 'center' });
  drawRule(doc, signatureX + 7, signatureTop + 49, signatureX + signatureWidth - 7, signatureTop + 49);
  doc.font(fonts.regular).fontSize(8).text('Authorized Signatory', signatureX, signatureTop + 55, { width: signatureWidth, align: 'center' });
}

async function createInvoicePdf(bill) {
  const doc = new PDFDocument({ size: 'A4', margin: PAGE_MARGIN, bufferPages: false, compress: true });
  const fonts = await registerFonts(doc);
  doc.fillColor(INK);
  const tableTop = drawTop(doc, bill, fonts);
  const table = drawInvoiceTable(doc, bill, tableTop, fonts);
  drawSummary(doc, bill, table, fonts);
  return doc;
}

module.exports = { createInvoicePdf };
