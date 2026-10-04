function toPaise(value) {
  const amount = Number(value);
  return Number.isFinite(amount) ? Math.round(amount * 100) : 0;
}

function getGstRate(item) {
  const rateExclTax = Number(item.rateExclTax);
  const rateInclTax = Number(item.rateInclTax);
  if (!Number.isFinite(rateExclTax) || rateExclTax <= 0 || !Number.isFinite(rateInclTax) || rateInclTax <= 0) return null;
  const baseRate = Math.min(rateExclTax, rateInclTax);
  const grossRate = Math.max(rateExclTax, rateInclTax);
  return Number((((grossRate - baseRate) / baseRate) * 100).toFixed(2));
}

function summarizeTaxByHsn(items) {
  const groups = new Map();
  for (const item of Array.isArray(items) ? items : []) {
    if (item.isDiscount) continue;
    const hsn = String(item.hsn || '').trim() || '—';
    const taxablePaise = toPaise(item.amount);
    const rate = getGstRate(item);
    const taxPaise = rate > 0 ? Math.round(taxablePaise * rate / 100) : 0;
    const group = groups.get(hsn) || { hsn, taxablePaise: 0, taxPaise: 0, hasGstRate: true };
    group.taxablePaise += taxablePaise;
    group.taxPaise += taxPaise;
    if (rate === null) group.hasGstRate = false;
    groups.set(hsn, group);
  }
  return [...groups.values()].map((group) => {
    const gstRate = group.hasGstRate && group.taxablePaise
      ? Number((group.taxPaise / group.taxablePaise * 100).toFixed(2))
      : (group.hasGstRate ? 0 : null);
    const cgstPaise = Math.round(group.taxPaise / 2);
    return {
      hsn: group.hsn,
      taxableValue: group.taxablePaise / 100,
      gstRate,
      cgstRate: gstRate === null ? null : Number((gstRate / 2).toFixed(2)),
      cgstAmount: cgstPaise / 100,
      sgstRate: gstRate === null ? null : Number((gstRate / 2).toFixed(2)),
      sgstAmount: (group.taxPaise - cgstPaise) / 100,
      taxAmount: group.taxPaise / 100
    };
  });
}

module.exports = { summarizeTaxByHsn };
