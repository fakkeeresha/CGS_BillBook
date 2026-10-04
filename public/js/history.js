const historyBody = document.querySelector('#history-body');
const emptyState = document.querySelector('#empty-state');
const loadError = document.querySelector('#load-error');
const searchInput = document.querySelector('#search-bills');
const statusFilter = document.querySelector('#status-filter');
const downloadExcelButton = document.querySelector('#download-excel');
let bills = [];

function formatAmount(value) {
  const amount = Number(value) || 0;
  return `₹${new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(amount)}`;
}
function formatDate(value) {
  if (!value) return '—';
  const dateText = String(value).slice(0, 10);
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateText);
  if (!match) return String(value);
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  const day = String(date.getDate()).padStart(2, '0');
  const month = new Intl.DateTimeFormat('en-GB', { month: 'short' }).format(date);
  return `${day}-${month}-${date.getFullYear()}`;
}
function showToast(message, isError = false) {
  const toast = document.createElement('div');
  toast.className = `toast${isError ? ' is-error' : ''}`;
  toast.textContent = message;
  document.querySelector('#toast-region').append(toast);
  window.setTimeout(() => toast.remove(), 4000);
}
function updateSummary() {
  const paidCount = bills.filter((bill) => bill.paymentStatus === 'Paid').length;
  const unpaid = bills.filter((bill) => bill.paymentStatus === 'Unpaid');
  document.querySelector('#summary-total').textContent = String(bills.length);
  document.querySelector('#summary-paid').textContent = String(paidCount);
  document.querySelector('#summary-unpaid').textContent = String(unpaid.length);
  document.querySelector('#summary-unpaid-amount').textContent = formatAmount(unpaid.reduce((sum, bill) => sum + (Number(bill.totalAmount) || 0), 0));
}
function createCell(value, className) {
  const cell = document.createElement('td');
  if (className) cell.className = className;
  cell.textContent = value;
  return cell;
}
function renderBills() {
  const search = searchInput.value.trim().toLocaleLowerCase();
  const status = statusFilter.value;
  const visibleBills = bills.filter((bill) => {
    const matchesName = String(bill.shipToName || '').toLocaleLowerCase().includes(search);
    return matchesName && (status === 'All' || bill.paymentStatus === status);
  });
  historyBody.replaceChildren();
  for (const bill of visibleBills) {
    const row = document.createElement('tr');
    row.append(createCell(bill.billId || '', 'bill-number-cell'));
    const nameCell = createCell(bill.shipToName || '');
    const downloadLink = document.createElement('a');
    downloadLink.className = 'download-bill-link';
    downloadLink.href = `/bill.html?billId=${encodeURIComponent(bill.billId)}`;
    downloadLink.textContent = 'Download bill';
    nameCell.append(downloadLink);
    row.append(nameCell);
    row.append(createCell(bill.shipToAddress || ''));
    row.append(createCell(formatDate(bill.invoiceDate)));
    row.append(createCell(formatAmount(bill.totalAmount)));
    const statusCell = document.createElement('td');
    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'status-toggle';
    toggle.dataset.billId = bill.billId;
    const badge = document.createElement('span');
    badge.className = `status-badge ${bill.paymentStatus === 'Paid' ? 'paid' : 'unpaid'}`;
    badge.textContent = bill.paymentStatus;
    const action = document.createElement('span');
    action.className = 'status-action';
    action.textContent = bill.paymentStatus === 'Paid' ? 'Mark unpaid' : 'Mark paid';
    toggle.setAttribute('aria-label', `${action.textContent}: ${bill.shipToName}`);
    toggle.append(badge, action);
    toggle.addEventListener('click', () => changePaymentStatus(bill, toggle));
    statusCell.append(toggle);
    row.append(statusCell);
    const actionsCell = document.createElement('td');
    const deleteButton = document.createElement('button');
    deleteButton.type = 'button';
    deleteButton.className = 'delete-bill-button';
    deleteButton.textContent = 'Delete';
    deleteButton.setAttribute('aria-label', `Delete bill ${bill.billId} for ${bill.shipToName}`);
    deleteButton.addEventListener('click', () => deleteBill(bill, deleteButton));
    actionsCell.append(deleteButton);
    row.append(actionsCell);
    historyBody.append(row);
  }
  const noBills = bills.length === 0;
  emptyState.hidden = visibleBills.length !== 0 || Boolean(loadError.textContent);
  document.querySelector('#empty-title').textContent = noBills ? 'No bills yet' : 'No matching bills';
  document.querySelector('#empty-copy').textContent = noBills ? 'Bills you create will appear here.' : 'Try a different name or payment status.';
  const createLink = emptyState.querySelector('a');
  createLink.hidden = !noBills;
}
async function changePaymentStatus(bill, toggle) {
  const previousStatus = bill.paymentStatus;
  const nextStatus = previousStatus === 'Paid' ? 'Unpaid' : 'Paid';
  bill.paymentStatus = nextStatus;
  updateSummary();
  renderBills();
  const updatedToggle = [...historyBody.querySelectorAll('.status-toggle')].find((button) => button.dataset.billId === bill.billId);
  if (updatedToggle) updatedToggle.disabled = true;
  try {
    const response = await fetch(`/api/bills/${encodeURIComponent(bill.billId)}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ paymentStatus: nextStatus })
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Unable to update payment status.');
    bill.paymentStatus = result.paymentStatus;
    bill.paidOn = result.paidOn;
    updateSummary();
    renderBills();
    showToast(`${bill.shipToName}: marked ${result.paymentStatus.toLowerCase()}.`);
  } catch (error) {
    bill.paymentStatus = previousStatus;
    updateSummary();
    renderBills();
    showToast(error.message || 'Unable to update payment status.', true);
  }
}
async function deleteBill(bill, button) {
  if (!window.confirm(`Permanently delete bill ${bill.billId} for ${bill.shipToName}? It will be removed from the history, JSON, and Excel workbook.`)) return;
  button.disabled = true;
  try {
    const response = await fetch(`/api/bills/${encodeURIComponent(bill.billId)}`, { method: 'DELETE' });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Unable to delete bill.');
    bills = bills.filter((entry) => entry.billId !== bill.billId);
    updateSummary();
    renderBills();
    showToast(`Bill ${bill.billId} was deleted.`);
  } catch (error) {
    button.disabled = false;
    showToast(error.message || 'Unable to delete bill.', true);
  }
}
async function downloadExcel() {
  downloadExcelButton.disabled = true;
  try {
    const response = await fetch('/api/bills/export');
    if (!response.ok) {
      const result = await response.json();
      throw new Error(result.error || 'Unable to download the Excel workbook.');
    }
    const workbookBlob = await response.blob();
    const downloadUrl = URL.createObjectURL(workbookBlob);
    const link = document.createElement('a');
    link.href = downloadUrl;
    link.download = 'bills.xlsx';
    document.body.append(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(downloadUrl);
  } catch (error) {
    showToast(error.message || 'Unable to download the Excel workbook.', true);
  } finally {
    downloadExcelButton.disabled = false;
  }
}
async function loadBills() {
  try {
    const response = await fetch('/api/bills');
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Unable to load bills.');
    bills = Array.isArray(result) ? result : [];
    updateSummary();
    renderBills();
  } catch (error) {
    loadError.textContent = error.message || 'Unable to load bills.';
    loadError.hidden = false;
    emptyState.hidden = true;
  }
}
searchInput.addEventListener('input', renderBills);
statusFilter.addEventListener('change', renderBills);
downloadExcelButton.addEventListener('click', downloadExcel);
loadBills();
