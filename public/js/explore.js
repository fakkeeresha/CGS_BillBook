const paymentForm = document.querySelector('#payment-form');
const vendorSelect = document.querySelector('#payment-vendor');
const paymentDateInput = document.querySelector('#payment-date');
const paymentAmountInput = document.querySelector('#payment-amount');
const balanceAfter = document.querySelector('#balance-after');
const vendorsBody = document.querySelector('#vendors-body');
const paymentsBody = document.querySelector('#payments-body');
const vendorSearch = document.querySelector('#search-vendors');
const paymentButton = document.querySelector('#record-payment');
const loadError = document.querySelector('#load-error');
let vendors = [];
let selectedVendorName = '';

function formatAmount(value) {
  return `₹${new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(value) || 0)}`;
}
function formatDate(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || '').slice(0, 10));
  if (!match) return String(value || '—');
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }).format(date);
}
function today() {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
function createCell(value, className = '') {
  const cell = document.createElement('td');
  cell.textContent = value;
  if (className) cell.className = className;
  return cell;
}
function currentVendor() {
  return vendors.find((vendor) => vendor.vendorName === vendorSelect.value) || null;
}
function updateBalancePreview() {
  const vendor = currentVendor();
  if (!vendor) {
    balanceAfter.textContent = 'Select a vendor';
    balanceAfter.classList.remove('is-error');
    paymentButton.disabled = true;
    return;
  }
  const amount = Math.round((Number(paymentAmountInput.value) || 0) * 100);
  const balance = Math.round(vendor.unpaidAmount * 100);
  if (amount > balance) {
    balanceAfter.textContent = `Amount exceeds balance (${formatAmount(vendor.unpaidAmount)})`;
    balanceAfter.classList.add('is-error');
    paymentButton.disabled = true;
    return;
  }
  balanceAfter.textContent = formatAmount((balance - amount) / 100);
  balanceAfter.classList.remove('is-error');
  paymentButton.disabled = amount <= 0 || balance <= 0;
}
function renderPayments() {
  const vendor = currentVendor();
  paymentsBody.replaceChildren();
  document.querySelector('#selected-vendor-label').textContent = vendor
    ? `${vendor.vendorName} · outstanding ${formatAmount(vendor.unpaidAmount)}`
    : 'Select a vendor to view payments';
  for (const payment of vendor?.payments || []) {
    const row = document.createElement('tr');
    row.append(
      createCell(payment.paymentId, 'bill-number-cell'),
      createCell(formatDate(payment.date)),
      createCell(formatAmount(payment.amount), 'amount-column'),
      createCell(formatAmount(payment.remainingBalance), 'amount-column')
    );
    paymentsBody.append(row);
  }
  document.querySelector('#payments-empty').hidden = Boolean(!vendor || vendor.payments.length);
}
function renderVendors() {
  const search = vendorSearch.value.trim().toLocaleLowerCase();
  const visibleVendors = vendors.filter((vendor) => vendor.vendorName.toLocaleLowerCase().includes(search));
  vendorsBody.replaceChildren();
  for (const vendor of visibleVendors) {
    const row = document.createElement('tr');
    row.append(
      createCell(vendor.vendorName),
      createCell(String(vendor.billCount)),
      createCell(formatAmount(vendor.totalAmount), 'amount-column'),
      createCell(formatAmount(vendor.paidAmount), 'amount-column'),
      createCell(formatAmount(vendor.unpaidAmount), 'amount-column')
    );
    const actionCell = document.createElement('td');
    const chooseButton = document.createElement('button');
    chooseButton.type = 'button';
    chooseButton.className = 'choose-vendor-button';
    chooseButton.textContent = vendor.unpaidAmount > 0 ? 'Record payment' : 'No balance due';
    chooseButton.disabled = vendor.unpaidAmount <= 0;
    chooseButton.addEventListener('click', () => {
      vendorSelect.value = vendor.vendorName;
      selectedVendorName = vendor.vendorName;
      renderPayments();
      updateBalancePreview();
      document.querySelector('#payment-vendor').focus();
    });
    actionCell.append(chooseButton);
    row.append(actionCell);
    vendorsBody.append(row);
  }
  document.querySelector('#vendors-empty').hidden = visibleVendors.length > 0 || vendors.length === 0;
  document.querySelector('#vendor-count').textContent = `${vendors.length} ${vendors.length === 1 ? 'vendor' : 'vendors'}`;
}
function renderSummary(summary) {
  document.querySelector('#summary-total-amount').textContent = formatAmount(summary.totalAmount);
  document.querySelector('#summary-paid-amount').textContent = formatAmount(summary.paidAmount);
  document.querySelector('#summary-unpaid-amount').textContent = formatAmount(summary.unpaidAmount);
}
function renderVendorOptions() {
  const previousSelection = selectedVendorName || vendorSelect.value;
  vendorSelect.replaceChildren(new Option('Select a vendor', ''));
  for (const vendor of vendors) vendorSelect.add(new Option(vendor.vendorName, vendor.vendorName));
  if (vendors.some((vendor) => vendor.vendorName === previousSelection)) {
    vendorSelect.value = previousSelection;
    selectedVendorName = previousSelection;
  } else {
    vendorSelect.value = '';
    selectedVendorName = '';
  }
}
function showToast(message, isError = false) {
  const toast = document.createElement('div');
  toast.className = `toast${isError ? ' is-error' : ''}`;
  toast.textContent = message;
  document.querySelector('#toast-region').append(toast);
  window.setTimeout(() => toast.remove(), 4000);
}
async function readApiResponse(response, fallbackMessage) {
  if (!response.headers.get('content-type')?.includes('application/json')) {
    throw new Error('The bill book server is running an older version. Close its server window and start the app again to load vendor balances.');
  }
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || fallbackMessage);
  return result;
}
async function loadExplore() {
  try {
    const response = await fetch('/api/explore');
    const result = await readApiResponse(response, 'Unable to load vendor balances.');
    if (!result.summary || !Array.isArray(result.vendors)) throw new Error('The vendor balance response is incomplete. Restart the bill book server and try again.');
    vendors = result.vendors;
    renderSummary(result.summary);
    renderVendorOptions();
    renderVendors();
    renderPayments();
    updateBalancePreview();
    loadError.hidden = true;
    loadError.textContent = '';
  } catch (error) {
    loadError.textContent = error.message || 'Unable to load vendor balances.';
    loadError.hidden = false;
  }
}

paymentDateInput.value = today();
vendorSearch.addEventListener('input', renderVendors);
vendorSelect.addEventListener('change', () => {
  selectedVendorName = vendorSelect.value;
  renderPayments();
  updateBalancePreview();
});
paymentAmountInput.addEventListener('input', updateBalancePreview);
paymentForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const vendor = currentVendor();
  if (!vendor) {
    vendorSelect.focus();
    return;
  }
  if (Number(paymentAmountInput.value) > vendor.unpaidAmount + 0.001) {
    updateBalancePreview();
    paymentAmountInput.focus();
    return;
  }
  paymentButton.disabled = true;
  try {
    const response = await fetch('/api/payments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        vendorName: vendor.vendorName,
        date: paymentDateInput.value,
        amount: Number(paymentAmountInput.value)
      })
    });
    const result = await readApiResponse(response, 'Unable to record payment.');
    paymentAmountInput.value = '';
    selectedVendorName = vendor.vendorName;
    await loadExplore();
    showToast(`${formatAmount(result.amount)} payment recorded for ${result.vendorName}.`);
  } catch (error) {
    showToast(error.message || 'Unable to record payment.', true);
  } finally {
    updateBalancePreview();
  }
});

loadExplore();
