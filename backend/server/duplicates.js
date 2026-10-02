const normalizeBusiness = (value) => String(value || '')
  .normalize('NFKD')
  .replace(/[\u0300-\u036f]/g, '')
  .toLowerCase()
  .replace(/[^a-z0-9]/g, '');

const normalizePhone = (value) => String(value || '').replace(/\D/g, '');

export function findCallDuplicates(existingRows, candidates) {
  const byBusiness = new Map();
  const byPhone = new Map();
  const duplicates = [];
  const remember = (row, source) => {
    const business = normalizeBusiness(row.business);
    const phone = normalizePhone(row.phone);
    const entry = { business: row.business, phone: row.phone, source };
    if (business) byBusiness.set(business, entry);
    if (phone) byPhone.set(phone, entry);
  };

  existingRows.forEach((row) => remember(row, row.source || 'existing records'));
  candidates.forEach((candidate, index) => {
    const business = normalizeBusiness(candidate.business);
    const phone = normalizePhone(candidate.phone);
    const match = (phone && byPhone.get(phone)) || (business && byBusiness.get(business));
    if (match) {
      duplicates.push({
        rowId: candidate.id || String(index),
        business: candidate.business,
        phone: candidate.phone,
        matchBusiness: match.business,
        matchPhone: match.phone,
        matchSource: match.source,
        reason: phone && match.phone && normalizePhone(match.phone) === phone ? 'phone number' : 'business name',
      });
    }
    remember(candidate, 'this review batch');
  });
  return duplicates;
}