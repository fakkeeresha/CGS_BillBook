const ONES = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine'];
const TEENS = ['Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

function underThousand(value) {
  let words = '';
  if (value >= 100) {
    words += `${ONES[Math.floor(value / 100)]} Hundred`;
    value %= 100;
    if (value) words += ' ';
  }
  if (value >= 20) words += `${TENS[Math.floor(value / 10)]}${value % 10 ? ` ${ONES[value % 10]}` : ''}`;
  else if (value >= 10) words += TEENS[value - 10];
  else if (value) words += ONES[value];
  return words;
}

function numberToIndianWords(value) {
  if (!Number.isSafeInteger(value) || value < 0) return '';
  if (value === 0) return 'Zero';
  const groups = [
    [1000000000000000, 'Padma'],
    [10000000000000, 'Neel'],
    [100000000000, 'Kharab'],
    [1000000000, 'Arab'],
    [10000000, 'Crore'],
    [100000, 'Lakh'],
    [1000, 'Thousand'],
    [1, '']
  ];
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

function amountInWords(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount < 0) return 'Amount unavailable';
  const totalPaise = Math.round((amount + Number.EPSILON) * 100);
  if (!Number.isSafeInteger(totalPaise)) return 'Amount unavailable';
  const rupees = Math.floor(totalPaise / 100);
  const paise = totalPaise % 100;
  const paiseWords = paise ? ` and ${numberToIndianWords(paise)} Paise` : '';
  return `Indian Rupees ${numberToIndianWords(rupees)}${paiseWords} Only`;
}

module.exports = { amountInWords };