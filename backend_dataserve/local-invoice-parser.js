const MONTHS = new Map([
  ['jan', '01'], ['feb', '02'], ['mar', '03'], ['apr', '04'], ['may', '05'], ['jun', '06'],
  ['jul', '07'], ['aug', '08'], ['sep', '09'], ['oct', '10'], ['nov', '11'], ['dec', '12']
]);

function isoDate(value) {
  const match = /^(\d{1,2})[-/ ]([A-Za-z]{3,})[-/ ](\d{2,4})$/.exec(String(value || '').trim());
  if (!match) return '';
  const month = MONTHS.get(match[2].slice(0, 3).toLowerCase());
  if (!month) return '';
  const year = match[3].length === 2 ? `20${match[3]}` : match[3];
  return `${year}-${month}-${match[1].padStart(2, '0')}`;
}

function sectionBetween(text, startLabel, endLabel) {
  const startIndex = text.search(startLabel);
  if (startIndex < 0) return '';
  const afterStart = text.slice(startIndex + text.match(startLabel)[0].length);
  const endIndex = afterStart.search(endLabel);
  return endIndex < 0 ? afterStart : afterStart.slice(0, endIndex);
}

function parseParty(block) {
  const lines = block.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (!lines.length) return { name: '', address: '' };
  const name = lines[0];
  const address = lines.slice(1).join(' ');
  return { name, address };
}

function numberFromText(value) {
  const number = Number(String(value || '').replace(/,/g, ''));
  return Number.isFinite(number) ? number : 0;
}

function parseItemRow(rowText, serialNumber) {
  const columns = /^(?<description>[\s\S]*?)(?<amount>[\d,]+\.\d{2})\s*(?<amountUnit>[A-Za-z]{1,8})(?<rateExclTax>[\d,]+\.\d{2})(?<rateInclTax>[\d,]+\.\d{2})\s*(?<quantity>\d+(?:\.\d{1,3})?)\s*(?<unit>[A-Za-z]{1,8})\s*(?<hsn>\d{4,8})$/i.exec(rowText.replace(/\s+/g, ' ').trim());
  if (!columns) return null;
  return {
    slNo: serialNumber,
    description: columns.groups.description.trim(),
    hsn: columns.groups.hsn,
    quantity: numberFromText(columns.groups.quantity),
    unit: columns.groups.unit,
    rateExclTax: numberFromText(columns.groups.rateExclTax),
    rateInclTax: numberFromText(columns.groups.rateInclTax),
    amount: numberFromText(columns.groups.amount),
    isDiscount: false
  };
}

function parseGenericItemRow(rowText, serialNumber) {
  const patterns = [
    /^(?<description>[\s\S]*?)(?<hsn>\d{4,8})\s*(?<quantity>\d+(?:\.\d{1,3})?)\s*(?<unit>[A-Za-z]{1,8})\s*(?<rate>(?:\d{1,3}(?:,\d{2,3})+|\d+)\.\d{2})\s*(?<amount>(?:\d{1,3}(?:,\d{2,3})+|\d+)\.\d{2})$/i,
    /^(?<description>[\s\S]*?)\s+(?<quantity>\d+(?:\.\d{1,3})?)\s*(?<unit>[A-Za-z]{1,8})\s*(?<rate>(?:\d{1,3}(?:,\d{2,3})+|\d+)\.\d{2})\s*(?<amount>(?:\d{1,3}(?:,\d{2,3})+|\d+)\.\d{2})\s*(?<hsn>\d{4,8})$/i
  ];
  for (const pattern of patterns) {
    const match = pattern.exec(rowText.replace(/\s+/g, ' ').trim());
    if (!match) continue;
    const description = match.groups.description.trim().replace(/^\d{1,3}[.)]?\s*/, '');
    if (description.length < 2) continue;
    const rate = numberFromText(match.groups.rate);
    return {
      slNo: serialNumber,
      description,
      hsn: match.groups.hsn,
      quantity: numberFromText(match.groups.quantity),
      unit: match.groups.unit,
      rateExclTax: rate,
      rateInclTax: rate,
      amount: numberFromText(match.groups.amount),
      isDiscount: false
    };
  }
  return null;
}

function parseCompressedItemRow(rowText, serialNumber) {
  const normalized = rowText.replace(/\s+/g, ' ').trim();
  const hsnMatches = [...normalized.matchAll(/(\d{8})(?=\d|\s)/g)];
  const amountPattern = /(?:\d{1,3}(?:,\d{2,3})+|\d+)(?:\.\d{1,2})?/g;
  for (const hsnMatch of hsnMatches.reverse()) {
    const tail = normalized.slice(hsnMatch.index + hsnMatch[0].length);
    const columns = /^(?<quantity>\d+(?:\.\d{1,3})?)\s*(?<unit>[A-Za-z]{1,8})(?<values>[\d,.\s]*)$/i.exec(tail);
    if (!columns) continue;
    const amounts = [...columns.groups.values.matchAll(amountPattern)];
    if (!amounts.length) continue;
    const rateMatch = amounts.length > 1 ? amounts.at(-2) : null;
    const rate = rateMatch ? numberFromText(rateMatch[0]) : 0;
    let amount = numberFromText(amounts.at(-1)[0]);
    if (rateMatch) {
      const remainder = columns.groups.values.slice(rateMatch.index + rateMatch[0].length).trim();
      if (remainder.startsWith(',')) {
        amount = Math.round(rate * numberFromText(columns.groups.quantity) * 100) / 100;
      }
    }
    const description = normalized.slice(0, hsnMatch.index).trim();
    if (description.length < 2) continue;
    return {
      slNo: serialNumber,
      description,
      hsn: hsnMatch[1],
      quantity: numberFromText(columns.groups.quantity),
      unit: columns.groups.unit,
      rateExclTax: rate,
      rateInclTax: rate,
      amount,
      isDiscount: false
    };
  }
  return null;
}

function isDiscountAnnotationLine(line) {
  return /^(?:schem[ae]\s+for\b|free\s+(?:for\b|item\b|goods\b))/i.test(line.trim());
}

function parseMainItems(text) {
  const heading = /Sl\s*Description of GoodsAmountperRateRateQuantityHSN\/SAC\s*No\./i;
  const headingMatch = heading.exec(text);
  if (!headingMatch) return [];
  const invoiceTable = text.slice(headingMatch.index + headingMatch[0].length).split(/continued to page number|\n\s*Less\s*:/i)[0];
  const items = [];
  let currentSerial = null;
  let currentLines = [];
  for (const rawLine of invoiceTable.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || /^SUBJECT TO|^This is a Computer Generated Invoice/i.test(line)) continue;
    if (/^\d{1,3}$/.test(line)) {
      currentSerial = Number(line);
      currentLines = [];
      continue;
    }
    if (isDiscountAnnotationLine(line)) {
      const discountItem = items.at(-1);
      if (discountItem) discountItem.isDiscount = true;
      continue;
    }
    if (currentSerial === null) continue;
    currentLines.push(line);
    const item = parseItemRow(currentLines.join(' '), currentSerial);
    if (item) {
      if (item.description) items.push(item);
      currentSerial = null;
      currentLines = [];
    }
  }
  return items;
}

function parseDynamicTableItems(text) {
  const lines = text.split(/\r?\n/).map((line) => line.trim());
  const headerIndex = lines.findIndex((line, index) => {
    const header = `${line} ${lines[index + 1] || ''}`.toLowerCase().replace(/[^a-z]/g, '');
    return /(?:item|description|particular)/.test(header)
      && /(?:hsn|sac)/.test(header)
      && /(?:qty|quantity)/.test(header)
      && /amount/.test(header);
  });
  if (headerIndex < 0) return [];

  const items = [];
  let serialNumber = null;
  let rowLines = [];
  let currentIsDiscount = false;
  const finishRow = () => {
    if (serialNumber === null || !rowLines.length) return;
    const rowText = rowLines.join(' ');
    const item = parseItemRow(rowText, serialNumber)
      || parseGenericItemRow(rowText, serialNumber)
      || parseCompressedItemRow(rowText, serialNumber);
    if (item) {
      item.isDiscount = currentIsDiscount;
      items.push(item);
    }
    rowLines = [];
    currentIsDiscount = false;
  };

  for (const line of lines.slice(headerIndex + 1)) {
    if (!line) continue;
    if (/^(?:less\s*:|grand\s+total|total\b|output\s+(?:igst|cgst|sgst)|(?:igst|cgst|sgst)\b|continued\b|hsn\s*\/?\s*sac\b)/i.test(line)) {
      finishRow();
      break;
    }
    if (isDiscountAnnotationLine(line)) {
      if (serialNumber !== null) {
        currentIsDiscount = true;
        continue;
      }
      finishRow();
      if (items.length) items.at(-1).isDiscount = true;
      continue;
    }
    const separateSerial = /^(\d{1,3})$/.exec(line);
    if (separateSerial) {
      finishRow();
      serialNumber = Number(separateSerial[1]);
      continue;
    }
    const expectedSerial = items.length + 1;
    const jammedSerial = serialNumber === null
      ? new RegExp(`^(${expectedSerial})(\\d{2,}-\\s*[A-Za-z].*)$`).exec(line)
      : null;
    const inlineSerial = /^(\d{1,3})(?=\s|[A-Za-z])\s*(.+)$/.exec(line);
    if (serialNumber === null && (inlineSerial || jammedSerial)) {
      serialNumber = Number(jammedSerial?.[1] || inlineSerial[1]);
      rowLines = [jammedSerial?.[2] || inlineSerial[2]];
    } else if (serialNumber !== null) {
      rowLines.push(line);
    }
    if (serialNumber !== null && rowLines.length) {
      const rowText = rowLines.join(' ');
      const item = parseItemRow(rowText, serialNumber)
        || parseGenericItemRow(rowText, serialNumber)
        || parseCompressedItemRow(rowText, serialNumber);
      if (item) {
        item.isDiscount = currentIsDiscount;
        items.push(item);
        serialNumber = null;
        rowLines = [];
        currentIsDiscount = false;
      }
    }
  }
  finishRow();
  return items;
}

function parseDate(text) {
  const match = /\b(?:invoice\s*)?date\s*[:#-]?\s*(?:\r?\n\s*)?(\d{1,2}[-/ ][A-Za-z]{3,}[-/ ]\d{2,4}|\d{1,2}[/-]\d{1,2}[/-]\d{2,4}|\d{4}-\d{2}-\d{2})/i.exec(text)
    || /\bDated\s*(?:\r?\n\s*)?(\d{1,2}[-/ ][A-Za-z]{3,}[-/ ]\d{2,4})/i.exec(text);
  if (match) {
    const normalized = normalizeDate(match[1]);
    if (normalized) return normalized;
  }
  const ackDate = /Ack Date\s*:\s*(\d{1,2}[-/ ][A-Za-z]{3,}[-/ ]\d{2,4})/i.exec(text);
  return ackDate ? normalizeDate(ackDate[1]) : '';
}

function normalizeDate(value) {
  const text = String(value || '').trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
  const namedDate = isoDate(text);
  if (namedDate) return namedDate;
  const numericDate = /^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/.exec(text);
  if (!numericDate) return '';
  const [, day, month, rawYear] = numericDate;
  const year = rawYear.length === 2 ? `20${rawYear}` : rawYear;
  const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  if (date.getUTCFullYear() !== Number(year) || date.getUTCMonth() + 1 !== Number(month) || date.getUTCDate() !== Number(day)) return '';
  return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
}

function labelledValue(text, labels) {
  const labelPattern = labels.join('|');
  const match = new RegExp(`(?:^|\\n)\\s*(?:${labelPattern})\\s*[:#-]?\\s*([^\\r\\n]+)`, 'im').exec(text);
  return match ? match[1].trim() : '';
}

function parseGenericItems(text) {
  const items = [];
  const seen = new Set();
  const lines = text.split(/\r?\n/).map((line) => line.replace(/\s+/g, ' ').trim()).filter(Boolean);
  const rowEnd = /(?:\b(?:total|subtotal|taxable|cgst|sgst|igst|discount|round\s*off|amount\s*(?:in|chargeable|payable))\b)/i;

  for (const rawLine of lines) {
    if (isDiscountAnnotationLine(rawLine)) {
      const discountItem = items.at(-1);
      if (discountItem) discountItem.isDiscount = true;
      continue;
    }
    if (rowEnd.test(rawLine) || /^(?:sl(?:\.| no)?|s\.?no\.?|description|particulars|item|hsn|qty|quantity|rate|amount)\b/i.test(rawLine)) continue;
    let line = rawLine.replace(/[₹$€£]/g, '').replace(/^\s*\d{1,3}[.)]?\s+/, '').trim();
    const tokens = line.split(/\s+/);
    const numericIndexes = [];
    tokens.forEach((token, index) => {
      if (/^(?:\(?-?\d[\d,]*(?:\.\d+)?\)?)$/.test(token)) numericIndexes.push(index);
    });
    if (numericIndexes.length < 3) continue;

    const lastNumericIndex = numericIndexes[numericIndexes.length - 1];
    const lastToken = tokens[lastNumericIndex];
    const precedingAmount = tokens[numericIndexes[numericIndexes.length - 2]] || '';
    const hsn = /^\d{4,8}$/.test(lastToken)
      && numericIndexes.length >= 4
      && (numericIndexes.length >= 5 || /\.\d{1,2}$/.test(precedingAmount))
      ? lastToken
      : '';
    const numericTail = hsn ? numericIndexes.slice(0, -1) : numericIndexes;
    if (numericTail.length < 3) continue;
    const amountIndex = numericTail[numericTail.length - 1];
    const rateIndex = numericTail[numericTail.length - 2];
    const quantityIndex = numericTail[numericTail.length - 3];
    const quantity = numberFromText(tokens[quantityIndex]);
    const rate = numberFromText(tokens[rateIndex]);
    const amount = numberFromText(tokens[amountIndex]);
    if (!(quantity > 0) || !(rate >= 0) || !(amount >= 0)) continue;

    let descriptionEnd = quantityIndex;
    let unit = '';
    if (quantityIndex + 1 < rateIndex && /^[A-Za-z][A-Za-z.-]{0,9}$/.test(tokens[quantityIndex + 1])) {
      unit = tokens[quantityIndex + 1];
      descriptionEnd = quantityIndex;
    }
    const description = tokens.slice(0, descriptionEnd).join(' ').replace(/[:\-]+$/, '').trim();
    if (description.length < 2) continue;
    const key = `${description.toLowerCase()}|${amount}`;
    if (seen.has(key)) continue;
    seen.add(key);
    items.push({
      slNo: items.length + 1,
      description,
      hsn,
      quantity,
      unit,
      rateExclTax: rate,
      rateInclTax: rate,
      amount,
      isDiscount: false
    });
  }
  return items;
}

function parseGenericParties(text) {
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const readAfterLabel = (pattern) => {
    const index = lines.findIndex((line) => pattern.test(line));
    if (index < 0) return { name: '', address: '' };
    const labelLine = lines[index];
    const inline = labelLine.replace(pattern, '').replace(/^[:\s-]+/, '').trim();
    const followingLines = [];
    for (const line of lines.slice(index + 1, index + 5)) {
      if (/^(?:seller|supplier|vendor|from|bill\s*to|billed\s*to|buyer|customer|consignee|ship\s*to|vehicle|truck|transport|invoice|date|item|description|qty|quantity|rate|amount|total|gstin|gst)\b/i.test(line)) break;
      followingLines.push(line);
    }
    const values = [inline, ...followingLines]
      .filter(Boolean)
      .filter((line) => !/^(?:gstin|gst|phone|mobile|email|invoice|date|ship to|bill to)\b/i.test(line));
    return { name: values[0] || '', address: values.slice(1).join(' ') };
  };
  const seller = readAfterLabel(/^(?:seller|supplier|vendor|from)(?:\s*[:\-]|\s*$)\s*/i);
  const customer = readAfterLabel(/^(?:bill\s*to|billed\s*to|buyer|customer|consignee|ship\s*to)(?:\s*[:\-]|\s*$)\s*/i);
  return { seller, customer };
}

function parseInvoiceTotal(text, items) {
  const lines = text.split(/\r?\n/);
  const totals = [];
  const amountPattern = /(?:^|[^\d])((?:\d{1,3}(?:,\d{2,3})+|\d+)(?:\.\d{1,2})?)(?!\d)/g;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index].trim();
    const label = /^(?:grand\s+total|invoice\s+total|total|amount\s+payable|net\s+payable)\b/i.exec(line);
    if (!label) continue;

    const amountsOnLine = [...line.slice(label[0].length).matchAll(amountPattern)];
    if (amountsOnLine.length > 1) continue;
    let amount = amountsOnLine.length ? numberFromText(amountsOnLine[0][1]) : null;
    if (amount === null) {
      const nextLine = (lines[index + 1] || '').trim();
      const nextLineAmount = /^\s*(?:₹|Rs\.?|INR)?\s*((?:\d{1,3}(?:,\d{2,3})+|\d+)(?:\.\d{1,2})?)\s*$/i.exec(nextLine);
      if (nextLineAmount) amount = numberFromText(nextLineAmount[1]);
    }
    if (amount !== null) {
      totals.push({
        amount,
        isExplicitInvoiceTotal: /^(?:grand\s+total|invoice\s+total|amount\s+payable|net\s+payable)\b/i.test(line)
      });
    }
  }

  const explicitTotal = totals.filter((total) => total.isExplicitInvoiceTotal).at(-1);
  if (explicitTotal) return explicitTotal.amount;
  if (totals.length) return totals.at(-1).amount;
  return items.reduce((sum, item) => sum + item.amount, 0);
}

function discountAmount(items) {
  const discountPaise = items.reduce((sum, item) => (
    item.isDiscount ? sum + Math.round(Number(item.amount) * 100) : sum
  ), 0);
  return discountPaise / 100;
}

function parseGenericInvoiceText(text) {
  const items = parseGenericItems(text);
  const { seller, customer } = parseGenericParties(text);
  const headerSeller = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).slice(0, 8)
    .find((line) => /\b(?:enterprise|enterprises|industries|traders|trading|agency|agencies|private limited|pvt\.?\s*ltd|llp)\b/i.test(line)
      && !/^(?:tax\s+)?invoice\b/i.test(line));
  const sellerName = seller.name || labelledValue(text, ['(?:seller|supplier|vendor)\\s*name', 'from']) || headerSeller || '';
  const shipToName = customer.name || labelledValue(text, ['(?:bill\\s*to|billed\\s*to|buyer|customer|consignee|ship\\s*to)\\s*name']);
  const sellerAddress = seller.address || labelledValue(text, ['(?:seller|supplier|vendor)\\s*address']);
  const shipToAddress = customer.address || labelledValue(text, ['(?:bill\\s*to|buyer|customer|consignee|ship\\s*to)\\s*address']);
  const vehicleNo = labelledValue(text, ['(?:vehicle|truck|transport)\\s*(?:no\\.?|number|registration)']);
  if (!items.length && !sellerName && !shipToName) return null;
  return {
    sellerName,
    sellerAddress,
    shipToName: shipToName || sellerName,
    shipToAddress: shipToAddress || sellerAddress,
    invoiceDate: parseDate(text),
    vehicleNo: vehicleNo.toUpperCase().replace(/[^A-Z0-9]/g, ''),
    dueDays: 10,
    percentageIncrease: 0,
    paymentStatus: 'Unpaid',
    totalAmount: parseInvoiceTotal(text, items),
    discountAmount: discountAmount(items),
    items
  };
}

function parseVendorInvoiceText(text) {
  const consignee = parseParty(sectionBetween(text, /Consignee\s*\(Ship to\)/i, /Buyer\s*\(Bill to\)/i));
  const buyer = parseParty(sectionBetween(text, /Buyer\s*\(Bill to\)/i, /Invoice No\.?e-Way Bill No\.?/i));
  const vehicleMatch = /Motor Vehicle No\.?\s*\r?\n\s*([A-Z0-9 ]{4,20})/i.exec(text);
  const items = parseMainItems(text);
  const dynamicItems = items.length ? items : parseDynamicTableItems(text);
  const genericDraft = parseGenericInvoiceText(text);
  if (!buyer.name && !consignee.name && !dynamicItems.length) return genericDraft;
  const invoiceItems = dynamicItems.length ? dynamicItems : genericDraft?.items || [];
  const totalAmount = parseInvoiceTotal(text, invoiceItems);
  return {
    sellerName: buyer.name || genericDraft?.sellerName || '',
    sellerAddress: buyer.address || genericDraft?.sellerAddress || '',
    shipToName: consignee.name || genericDraft?.shipToName || buyer.name,
    shipToAddress: consignee.address || genericDraft?.shipToAddress || buyer.address,
    invoiceDate: parseDate(text),
    vehicleNo: (vehicleMatch?.[1] || genericDraft?.vehicleNo || '').toUpperCase().replace(/\s/g, ''),
    dueDays: 10,
    percentageIncrease: 0,
    paymentStatus: 'Unpaid',
    totalAmount: totalAmount || genericDraft?.totalAmount || 0,
    discountAmount: discountAmount(invoiceItems),
    items: invoiceItems
  };
}

module.exports = { parseVendorInvoiceText, parseMainItems };
