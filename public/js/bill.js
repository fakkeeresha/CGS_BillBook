const billId = new URLSearchParams(window.location.search).get('billId');
const invoice = document.querySelector('#invoice-paper');
const loading = document.querySelector('#bill-loading');
const errorMessage = document.querySelector('#bill-error');
const downloadButton = document.querySelector('#download-pdf');

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
function addTextCell(row, value, className) {
  const cell = document.createElement('td');
  if (className) cell.className = className;
  cell.textContent = value;
  row.append(cell);
}
function renderBill(bill) {
  document.querySelector('#invoice-number').textContent = bill.billId || '';
  document.querySelector('#invoice-date').textContent = formatDate(bill.invoiceDate);
  document.querySelector('#vehicle-number').textContent = bill.vehicleNo || '—';
  document.querySelector('#bill-to-name').textContent = bill.shipToName || '';
  document.querySelector('#bill-to-address').textContent = bill.shipToAddress || '';
  document.querySelector('#ship-to-name').textContent = bill.shipToName || '';
  document.querySelector('#ship-to-address').textContent = bill.shipToAddress || '';
  document.querySelector('#amount-in-words').textContent = bill.amountInWords || '';
  document.title = `${bill.billId || 'Invoice'} | CGS Global Enterprises`;

  const itemsBody = document.querySelector('#invoice-items');
  let quantityTotal = 0;
  let subtotal = 0;
  for (const [index, item] of (Array.isArray(bill.items) ? bill.items : []).entries()) {
    const row = document.createElement('tr');
    addTextCell(row, String(item.slNo || index + 1), 'invoice-serial');
    addTextCell(row, `${item.description || ''}${item.isDiscount ? ' (SCHEME/FREE ITEM)' : ''}`);
    addTextCell(row, item.hsn || '—', 'invoice-centered');
    addTextCell(row, `${item.quantity ?? ''} ${item.unit || ''}`.trim(), 'invoice-centered');
    addTextCell(row, formatMoney(item.rateExclTax), 'invoice-number');
    addTextCell(row, formatMoney(item.rateInclTax), 'invoice-number');
    addTextCell(row, formatMoney(item.amount), 'invoice-number');
    itemsBody.append(row);
    quantityTotal += Number(item.quantity) || 0;
    subtotal += Number(item.amount) || 0;
  }
  document.querySelector('#quantity-total').textContent = String(quantityTotal);
  const discount = Number(bill.discountAmount) || (bill.items || [])
    .filter((item) => item.isDiscount)
    .reduce((sum, item) => sum + (Number(item.amount) || 0), 0);
  document.querySelector('#invoice-subtotal-row').hidden = discount <= 0;
  document.querySelector('#invoice-discount-row').hidden = discount <= 0;
  document.querySelector('#invoice-subtotal').textContent = formatMoney(subtotal);
  document.querySelector('#invoice-discount').textContent = `−${formatMoney(discount)}`;
  const taxTotal = (bill.taxSummary || []).reduce((sum, summary) => sum + (Number(summary.taxAmount) || 0), 0);
  document.querySelector('#invoice-tax-row').hidden = taxTotal <= 0;
  document.querySelector('#invoice-tax-amount').textContent = `+${formatMoney(taxTotal)}`;
  const roundOff = Number(bill.roundOffAmount) || 0;
  document.querySelector('#invoice-round-off-row').hidden = roundOff <= 0;
  document.querySelector('#invoice-round-off').textContent = `+${formatMoney(roundOff)}`;
  document.querySelector('#invoice-total').textContent = formatMoney(bill.totalAmount);
  const taxRows = document.querySelector('#invoice-tax-summary');
  taxRows.replaceChildren();
  let taxableTotal = 0;
  let cgstTotal = 0;
  let sgstTotal = 0;
  let taxSummaryTotal = 0;
  for (const summary of bill.taxSummary || []) {
    const row = document.createElement('tr');
    addTextCell(row, summary.hsn || '—', 'invoice-centered');
    addTextCell(row, formatMoney(summary.taxableValue), 'invoice-number');
    addTextCell(row, summary.cgstRate === null ? '—' : `${Number(summary.cgstRate)}%`, 'invoice-centered');
    addTextCell(row, formatMoney(summary.cgstAmount), 'invoice-number');
    addTextCell(row, summary.sgstRate === null ? '—' : `${Number(summary.sgstRate)}%`, 'invoice-centered');
    addTextCell(row, formatMoney(summary.sgstAmount), 'invoice-number');
    addTextCell(row, formatMoney(summary.taxAmount), 'invoice-number');
    taxRows.append(row);
    taxableTotal += Number(summary.taxableValue) || 0;
    cgstTotal += Number(summary.cgstAmount) || 0;
    sgstTotal += Number(summary.sgstAmount) || 0;
    taxSummaryTotal += Number(summary.taxAmount) || 0;
  }
  document.querySelector('#taxable-total').textContent = formatMoney(taxableTotal);
  document.querySelector('#cgst-total').textContent = formatMoney(cgstTotal);
  document.querySelector('#sgst-total').textContent = formatMoney(sgstTotal);
  document.querySelector('#tax-total').textContent = formatMoney(taxSummaryTotal);
  downloadButton.addEventListener('click', () => {
    window.location.href = `/api/bills/${encodeURIComponent(bill.billId)}/pdf`;
  }, { once: true });
  downloadButton.disabled = false;
  loading.hidden = true;
  invoice.hidden = false;
}

async function loadBill() {
  if (!billId) {
    loading.hidden = true;
    errorMessage.textContent = 'No bill was selected.';
    errorMessage.hidden = false;
    return;
  }
  try {
    const response = await fetch(`/api/bills/${encodeURIComponent(billId)}`);
    const bill = await response.json();
    if (!response.ok) throw new Error(bill.error || 'Unable to load invoice.');
    renderBill(bill);
  } catch (error) {
    loading.hidden = true;
    errorMessage.textContent = error.message || 'Unable to load invoice.';
    errorMessage.hidden = false;
  }
}

loadBill();
