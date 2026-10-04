const form = document.querySelector('#bill-form');
const itemsBody = document.querySelector('#items-body');
const totalInput = document.querySelector('#total-amount');
const totalFormatted = document.querySelector('#total-formatted');
const taxFormatted = document.querySelector('#tax-formatted');
const roundOffFormatted = document.querySelector('#round-off-formatted');
const discountFormatted = document.querySelector('#discount-formatted');
const amountWords = document.querySelector('#amount-words');
const submitButton = document.querySelector('#submit-bill');
const vehicleInput = document.querySelector('#vehicle-no');
const increaseInput = document.querySelector('#percentage-increase');
const dueDaysInput = document.querySelector('#due-days');
const sameAsSellerInput = document.querySelector('#same-as-seller');
const sellerNameInput = document.querySelector('#seller-name');
const sellerAddressInput = document.querySelector('#seller-address');
const shipToNameInput = document.querySelector('#ship-to-name');
const shipToAddressInput = document.querySelector('#ship-to-address');
const vendorPdfInput = document.querySelector('#vendor-pdf');
const extractPdfButton = document.querySelector('#extract-vendor-pdf');
const extractStatus = document.querySelector('#extract-status');
const extractContent = document.querySelector('#extract-content');
const extractContentText = document.querySelector('#extract-content-text');
const today = () => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
};

function formatIndianAmount(value) {
  const amount = Number.isFinite(Number(value)) ? Number(value) : 0;
  return new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(amount);
}

const ones = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine'];
const teens = ['Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
const tens = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
function underThousand(value) {
  let words = '';
  if (value >= 100) {
    words += `${ones[Math.floor(value / 100)]} Hundred`;
    value %= 100;
    if (value) words += ' ';
  }
  if (value >= 20) words += `${tens[Math.floor(value / 10)]}${value % 10 ? ` ${ones[value % 10]}` : ''}`;
  else if (value >= 10) words += teens[value - 10];
  else if (value) words += ones[value];
  return words;
}
function numberToIndianWords(value) {
  if (!Number.isSafeInteger(value) || value < 0) return '';
  if (value === 0) return 'Zero';
  const groups = [[10000000, 'Crore'], [100000, 'Lakh'], [1000, 'Thousand'], [1, '']];
  let remainder = value;
  const words = [];
  for (const [size, label] of groups) {
    const part = Math.floor(remainder / size);
    if (!part) continue;
    words.push(`${underThousand(part)}${label ? ` ${label}` : ''}`);
    remainder %= size;
  }
  return words.join(' ');
}
function updateAmountWords(value) {
  const amount = Math.max(0, Number(value) || 0);
  const rupees = Math.floor(amount + 0.000001);
  const paise = Math.round((amount - rupees) * 100);
  let text = `Indian Rupees ${numberToIndianWords(rupees)}`;
  if (paise > 0) text += ` and ${numberToIndianWords(paise)} Paise`;
  amountWords.textContent = `${text} Only`;
}
function updateTotalDisplay() {
  const amount = Math.max(0, Number(totalInput.value) || 0);
  totalFormatted.textContent = `₹${formatIndianAmount(amount)}`;
  updateAmountWords(amount);
}
function updateTotalFromRows() {
  let subtotalPaise = 0;
  let discountPaise = 0;
  let taxPaise = 0;
  itemsBody.querySelectorAll('.item-row').forEach((row) => {
    const baseAmount = Number(row.querySelector('[data-field="amount"]').value) || 0;
    const finalAmount = Math.round((baseAmount * (1 + (Number(increaseInput.value) || 0) / 100) + Number.EPSILON) * 100) / 100;
    const isDiscount = row.querySelector('[data-field="isDiscount"]').checked;
    const rateExclTax = Number(row.querySelector('[data-field="rateExclTax"]').value) || 0;
    const rateInclTax = Number(row.querySelector('[data-field="rateInclTax"]').value) || 0;
    const gstRate = rateExclTax > 0 && rateInclTax > rateExclTax
      ? Math.round(((rateInclTax - rateExclTax) / rateExclTax) * 10000) / 10000
      : 0;
    const amountPaise = Math.round(finalAmount * 100);
    subtotalPaise += amountPaise;
    if (isDiscount) discountPaise += amountPaise;
    else taxPaise += Math.round(amountPaise * gstRate);
    row.querySelector('.amount-preview').textContent = isDiscount
      ? `Discount (excl. GST): −₹${formatIndianAmount(finalAmount)}`
      : `Excl. GST: ₹${formatIndianAmount(finalAmount)}`;
  });
  const calculatedPaise = subtotalPaise - discountPaise + taxPaise;
  const roundedTotalPaise = Math.ceil(calculatedPaise / 100) * 100;
  const roundOffPaise = roundedTotalPaise - calculatedPaise;
  totalInput.value = (roundedTotalPaise / 100).toFixed(2);
  taxFormatted.hidden = taxPaise === 0;
  taxFormatted.textContent = taxPaise ? `GST: +₹${formatIndianAmount(taxPaise / 100)}` : '';
  roundOffFormatted.hidden = roundOffPaise === 0;
  roundOffFormatted.textContent = roundOffPaise ? `Round off: +₹${formatIndianAmount(roundOffPaise / 100)}` : '';
  discountFormatted.hidden = discountPaise === 0;
  discountFormatted.textContent = discountPaise ? `Discount: −₹${formatIndianAmount(discountPaise / 100)}` : '';
  updateTotalDisplay();
}
function clearError(input) {
  input.removeAttribute('aria-invalid');
  const error = document.getElementById(`${input.id}-error`);
  if (error) error.textContent = '';
}
function syncSellerToConsignee() {
  const sameAsSeller = sameAsSellerInput.checked;
  shipToNameInput.readOnly = sameAsSeller;
  shipToAddressInput.readOnly = sameAsSeller;
  if (!sameAsSeller) return;
  shipToNameInput.value = sellerNameInput.value;
  shipToAddressInput.value = sellerAddressInput.value;
  clearError(shipToNameInput);
  clearError(shipToAddressInput);
}
function setDraftField(input, value) {
  if (value === null || value === undefined || value === '') return;
  input.value = String(value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
}
function populateExtractedDraft(draft) {
  sameAsSellerInput.checked = false;
  syncSellerToConsignee();
  setDraftField(sellerNameInput, draft.sellerName);
  setDraftField(sellerAddressInput, draft.sellerAddress);
  setDraftField(shipToNameInput, draft.shipToName);
  setDraftField(shipToAddressInput, draft.shipToAddress);

  const normalizedSellerName = sellerNameInput.value.trim().toLocaleLowerCase();
  const normalizedShipToName = shipToNameInput.value.trim().toLocaleLowerCase();
  const normalizedSellerAddress = sellerAddressInput.value.trim().toLocaleLowerCase();
  const normalizedShipToAddress = shipToAddressInput.value.trim().toLocaleLowerCase();
  sameAsSellerInput.checked = Boolean(normalizedSellerName && normalizedSellerAddress)
    && normalizedSellerName === normalizedShipToName
    && normalizedSellerAddress === normalizedShipToAddress;
  syncSellerToConsignee();

  setDraftField(document.querySelector('#invoice-date'), draft.invoiceDate);
  setDraftField(vehicleInput, draft.vehicleNo);
  setDraftField(dueDaysInput, draft.dueDays);

  const extractedItems = Array.isArray(draft.items) ? draft.items : [];
  if (extractedItems.length) {
    itemsBody.replaceChildren();
    for (const extractedItem of extractedItems) createItemRow();
    const rows = itemsBody.querySelectorAll('.item-row');
    extractedItems.forEach((extractedItem, index) => {
      const row = rows[index];
      row.querySelector('[data-field="description"]').value = extractedItem.description || '';
      row.querySelector('[data-field="hsn"]').value = extractedItem.hsn || '';
      row.querySelector('[data-field="quantity"]').value = extractedItem.quantity ?? '';
      row.querySelector('[data-field="rateExclTax"]').value = extractedItem.rateExclTax ?? '';
      row.querySelector('[data-field="rateInclTax"]').value = extractedItem.rateInclTax ?? '';
      row.querySelector('[data-field="isDiscount"]').checked = Boolean(extractedItem.isDiscount);
      const unitSelect = row.querySelector('[data-field="unit"]');
      const unitOptionExists = [...unitSelect.options].some((option) => option.value === extractedItem.unit);
      if (unitOptionExists) unitSelect.value = extractedItem.unit;
      else {
        unitSelect.value = 'Other';
        const customUnit = row.querySelector('[data-field="unitOther"]');
        customUnit.hidden = false;
        customUnit.value = extractedItem.unit || '';
      }
      const calculatedAmount = Number(extractedItem.quantity) * Number(extractedItem.rateExclTax);
      row.querySelector('[data-field="amount"]').value = Number(extractedItem.amount ?? calculatedAmount).toFixed(2);
    });
    renumberRows();
    updateTotalFromRows();
  }
  if (!extractedItems.length && Number.isFinite(Number(draft.totalAmount))) {
    totalInput.value = Number(draft.totalAmount).toFixed(2);
    updateTotalDisplay();
  }
}
async function extractVendorPdf() {
  const file = vendorPdfInput.files?.[0];
  if (!file) {
    extractStatus.textContent = 'Choose a vendor PDF first.';
    extractStatus.classList.add('is-error');
    return;
  }
  if (!file.name.toLowerCase().endsWith('.pdf') && file.type !== 'application/pdf') {
    extractStatus.textContent = 'Choose a PDF file.';
    extractStatus.classList.add('is-error');
    return;
  }
  extractPdfButton.disabled = true;
  extractPdfButton.classList.add('is-loading');
  extractPdfButton.querySelector('.button-label').textContent = 'Extracting…';
  extractStatus.classList.remove('is-error');
  extractStatus.textContent = 'Analyzing the PDF layout, extracting invoice fields, and saving the source text…';
  try {
    const formData = new FormData();
    formData.append('pdf', file);
    const response = await fetch('http://127.0.0.1:3001/api/extract', { method: 'POST', body: formData });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'PDF extraction failed.');
    if (result.rawTextSaved) {
      extractContentText.textContent = result.rawText || '';
      extractContent.hidden = false;
    }
    if (result.draft) {
      populateExtractedDraft(result.draft);
      if (result.warning) {
        extractStatus.classList.remove('is-error');
        extractStatus.classList.add('is-warning');
        extractStatus.textContent = result.warning;
      } else {
        extractStatus.classList.remove('is-error', 'is-warning');
        extractStatus.textContent = `Full PDF text and structured draft saved for ${result.uploadedFileName}. Review the fields before submitting.`;
      }
    } else {
      extractStatus.classList.remove('is-error');
      extractStatus.classList.add('is-warning');
      extractStatus.textContent = result.warning || `Full text from ${result.uploadedFileName} was copied to backend_dataserve/data/extracted-content.json. No bill fields were autofilled.`;
    }
  } catch (error) {
    extractStatus.classList.add('is-error');
    extractStatus.classList.remove('is-warning');
    extractStatus.textContent = error instanceof TypeError
      ? 'Could not reach the PDF analyzer. Restart the bill book with npm start and try again.'
      : (error.message || 'PDF extraction failed.');
  } finally {
    extractPdfButton.disabled = false;
    extractPdfButton.classList.remove('is-loading');
    extractPdfButton.querySelector('.button-label').textContent = 'Extract bill details';
  }
}
function setError(input, message) {
  input.setAttribute('aria-invalid', 'true');
  const error = document.getElementById(`${input.id}-error`);
  if (error) error.textContent = message;
}
function renumberRows() {
  itemsBody.querySelectorAll('.item-row').forEach((row, index) => {
    row.querySelector('.serial-number').textContent = String(index + 1);
  });
}
function createItemRow() {
  const row = document.createElement('tr');
  row.className = 'item-row';
  row.innerHTML = `
    <td><span class="serial-number" aria-label="Serial number"></span></td>
    <td><input data-field="description" type="text" aria-label="Description of goods" required><small class="field-error row-error" data-error="description"></small></td>
    <td><input data-field="hsn" type="text" inputmode="numeric" maxlength="8" aria-label="HSN code"><small class="field-error row-error" data-error="hsn"></small></td>
    <td><input data-field="quantity" type="number" min="0.01" step="any" inputmode="decimal" aria-label="Quantity" required><small class="field-error row-error" data-error="quantity"></small></td>
    <td><select data-field="unit" aria-label="Unit"><option value="">Select unit</option><option>Bx</option><option>Bg</option><option>Pc</option><option>Kg</option><option>Ltr</option><option value="Other">Other</option></select><input class="unit-other" data-field="unitOther" type="text" aria-label="Custom unit" placeholder="Enter unit" hidden><small class="field-error row-error" data-error="unit"></small></td>
    <td><input data-field="rateExclTax" type="number" min="0" step="0.01" inputmode="decimal" aria-label="Rate excluding tax"></td>
    <td><input data-field="rateInclTax" type="number" min="0" step="0.01" inputmode="decimal" aria-label="Rate including tax"></td>
    <td><input data-field="amount" type="number" min="0" step="0.01" inputmode="decimal" aria-label="Amount before increase"><small class="amount-preview">Final: ₹0.00</small><small class="field-error row-error" data-error="amount"></small></td>
    <td><label class="discount-item-toggle"><input data-field="isDiscount" type="checkbox" aria-label="Mark scheme or free item as a discount"><span>Deduct</span></label></td>
    <td><button class="remove-item" type="button" aria-label="Remove line item">Remove</button></td>`;
  const quantity = row.querySelector('[data-field="quantity"]');
  const rate = row.querySelector('[data-field="rateExclTax"]');
  const rateInclTax = row.querySelector('[data-field="rateInclTax"]');
  const amount = row.querySelector('[data-field="amount"]');
  const updateLineAmount = () => {
    const quantityValue = Number(quantity.value);
    const rateValue = Number(rate.value);
    if (quantity.value !== '' && rate.value !== '' && Number.isFinite(quantityValue * rateValue)) amount.value = (quantityValue * rateValue).toFixed(2);
    else amount.value = '';
    clearRowError(row, 'quantity');
    updateTotalFromRows();
  };
  quantity.addEventListener('input', updateLineAmount);
  rate.addEventListener('input', updateLineAmount);
  rateInclTax.addEventListener('input', updateTotalFromRows);
  amount.addEventListener('input', () => {
    clearRowError(row, 'amount');
    updateTotalFromRows();
  });
  row.querySelector('[data-field="isDiscount"]').addEventListener('change', updateTotalFromRows);
  row.querySelector('[data-field="hsn"]').addEventListener('input', (event) => {
    event.target.value = event.target.value.replace(/\D/g, '').slice(0, 8);
    clearRowError(row, 'hsn');
  });
  row.querySelector('[data-field="description"]').addEventListener('input', () => clearRowError(row, 'description'));
  row.querySelector('[data-field="unit"]').addEventListener('change', (event) => {
    const customUnit = row.querySelector('[data-field="unitOther"]');
    customUnit.hidden = event.target.value !== 'Other';
    if (customUnit.hidden) customUnit.value = '';
  });
  row.querySelector('[data-field="unitOther"]').addEventListener('input', updateTotalFromRows);
  row.querySelector('.remove-item').addEventListener('click', () => {
    row.remove();
    if (!itemsBody.querySelector('.item-row')) itemsBody.append(createItemRow());
    renumberRows();
    updateTotalFromRows();
  });
  itemsBody.append(row);
  renumberRows();
}
function clearRowError(row, field) {
  const input = row.querySelector(`[data-field="${field}"]`);
  const error = row.querySelector(`[data-error="${field}"]`);
  input.removeAttribute('aria-invalid');
  error.textContent = '';
}
function validateForm() {
  let valid = true;
  const requiredInputs = ['seller-name', 'seller-address', 'ship-to-name', 'ship-to-address', 'invoice-date', 'vehicle-no'];
  for (const id of requiredInputs) {
    const input = document.getElementById(id);
    if (!input.value.trim()) {
      setError(input, 'This field is required.');
      valid = false;
    } else clearError(input);
  }
  if (!Number.isInteger(Number(dueDaysInput.value)) || Number(dueDaysInput.value) < 1) {
    setError(dueDaysInput, 'Enter at least 1 due day.');
    valid = false;
  } else clearError(dueDaysInput);
  if (totalInput.value === '' || !Number.isFinite(Number(totalInput.value)) || Number(totalInput.value) < 0) {
    setError(totalInput, 'Enter a valid total amount.');
    valid = false;
  } else clearError(totalInput);
  if (increaseInput.value !== '' && (!Number.isFinite(Number(increaseInput.value)) || Number(increaseInput.value) < 0)) {
    setError(increaseInput, 'Enter a non-negative percentage.');
    valid = false;
  } else clearError(increaseInput);
  itemsBody.querySelectorAll('.item-row').forEach((row) => {
    const description = row.querySelector('[data-field="description"]');
    const hsn = row.querySelector('[data-field="hsn"]');
    const quantity = row.querySelector('[data-field="quantity"]');
    const unit = row.querySelector('[data-field="unit"]');
    const customUnit = row.querySelector('[data-field="unitOther"]');
    const amount = row.querySelector('[data-field="amount"]');
    const checks = [
      [description, 'description', description.value.trim() ? '' : 'Description is required.'],
      [hsn, 'hsn', hsn.value && !/^\d{4,8}$/.test(hsn.value) ? 'Enter 4 to 8 digits.' : ''],
      [quantity, 'quantity', Number(quantity.value) > 0 ? '' : 'Enter a quantity greater than 0.'],
      [unit, 'unit', unit.value === 'Other' ? (customUnit.value.trim() ? '' : 'Enter a unit.') : (unit.value ? '' : 'Select a unit.')],
      [amount, 'amount', amount.value !== '' && Number(amount.value) >= 0 ? '' : 'Enter a valid amount.']
    ];
    for (const [input, field, message] of checks) {
      const error = row.querySelector(`[data-error="${field}"]`);
      if (message) {
        input.setAttribute('aria-invalid', 'true');
        error.textContent = message;
        valid = false;
      } else {
        input.removeAttribute('aria-invalid');
        error.textContent = '';
      }
    }
  });
  if (!valid) {
    const firstInvalid = form.querySelector('[aria-invalid="true"]');
    firstInvalid?.focus();
  }
  return valid;
}
function showToast(message, isError = false) {
  const toast = document.createElement('div');
  toast.className = `toast${isError ? ' is-error' : ''}`;
  toast.textContent = message;
  document.querySelector('#toast-region').append(toast);
  window.setTimeout(() => toast.remove(), 4500);
}
function getItemPayload(row) {
  const value = (field) => row.querySelector(`[data-field="${field}"]`).value.trim();
  const unitSelect = value('unit');
  return {
    description: value('description'),
    hsn: value('hsn'),
    quantity: Number(value('quantity')),
    unit: unitSelect === 'Other' ? value('unitOther') : unitSelect,
    rateExclTax: Number(value('rateExclTax') || 0),
    rateInclTax: Number(value('rateInclTax') || 0),
    amount: Number(value('amount')),
    isDiscount: row.querySelector('[data-field="isDiscount"]').checked
  };
}
function resetBillForm() {
  form.reset();
  document.querySelector('#invoice-date').value = today();
  itemsBody.replaceChildren();
  createItemRow();
  form.querySelectorAll('[aria-invalid="true"]').forEach((input) => input.removeAttribute('aria-invalid'));
  form.querySelectorAll('.field-error').forEach((error) => { error.textContent = ''; });
  document.querySelector('#vehicle-warning').textContent = '';
  extractStatus.textContent = '';
  extractStatus.classList.remove('is-error', 'is-warning');
  extractContent.hidden = true;
  extractContentText.textContent = '';
  syncSellerToConsignee();
  totalInput.value = '0.00';
  discountFormatted.hidden = true;
  discountFormatted.textContent = '';
  updateTotalDisplay();
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!validateForm()) return;
  const payload = {
    sellerName: document.querySelector('#seller-name').value.trim(),
    sellerAddress: document.querySelector('#seller-address').value.trim(),
    shipToName: document.querySelector('#ship-to-name').value.trim(),
    shipToAddress: document.querySelector('#ship-to-address').value.trim(),
    invoiceDate: document.querySelector('#invoice-date').value,
    vehicleNo: vehicleInput.value.trim(),
    dueDays: Number(dueDaysInput.value),
    totalAmount: Number(totalInput.value),
    percentageIncrease: Number(increaseInput.value || 0),
    paymentStatus: document.querySelector('#payment-status').value,
    items: [...itemsBody.querySelectorAll('.item-row')].map(getItemPayload)
  };
  submitButton.disabled = true;
  submitButton.classList.add('is-loading');
  try {
    const response = await fetch('/api/bills', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Unable to save bill.');
    showToast(`Bill ${result.billId} saved successfully.`);
    resetBillForm();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  } catch (error) {
    showToast(error.message || 'Unable to save bill.', true);
  } finally {
    submitButton.disabled = false;
    submitButton.classList.remove('is-loading');
  }
});

document.querySelector('#add-item').addEventListener('click', createItemRow);
document.querySelector('#clear-form').addEventListener('click', resetBillForm);
extractPdfButton.addEventListener('click', extractVendorPdf);
sameAsSellerInput.addEventListener('change', syncSellerToConsignee);
vehicleInput.addEventListener('input', () => {
  vehicleInput.value = vehicleInput.value.toUpperCase().replace(/\s/g, '');
  clearError(vehicleInput);
  const warning = document.querySelector('#vehicle-warning');
  warning.textContent = vehicleInput.value && !/^[A-Z]{2}\d{2}[A-Z]{1,3}\d{4}$/.test(vehicleInput.value)
    ? 'Format usually looks like two letters, two digits, 1–3 letters, then four digits. This will not prevent saving.'
    : '';
});
totalInput.addEventListener('input', () => {
  clearError(totalInput);
  updateTotalDisplay();
});
increaseInput.addEventListener('input', () => {
  clearError(increaseInput);
  updateTotalFromRows();
});
form.addEventListener('input', (event) => {
  if (sameAsSellerInput.checked && (event.target === sellerNameInput || event.target === sellerAddressInput)) syncSellerToConsignee();
  if (event.target.matches('#seller-name, #seller-address, #ship-to-name, #ship-to-address, #invoice-date, #due-days')) clearError(event.target);
});

document.querySelector('#invoice-date').value = today();
syncSellerToConsignee();
createItemRow();
updateTotalDisplay();
