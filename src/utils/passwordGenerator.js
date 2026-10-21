/**
 * Password Generator & Date of Birth Formatter
 * 
 * Generates temporary student passwords from Date of Birth strictly in DDMMYYYY format.
 * Examples:
 *   "14 Mar 2006" -> "14032006"
 *   "14/03/2006"  -> "14032006"
 *   "2006-03-14"  -> "14032006"
 *   "5 Jan 2005"   -> "05012005"
 */

const MONTH_MAP = {
  jan: '01', january: '01',
  feb: '02', february: '02',
  mar: '03', march: '03',
  apr: '04', april: '04',
  may: '05',
  jun: '06', june: '06',
  jul: '07', july: '07',
  aug: '08', august: '08',
  sep: '09', sept: '09', september: '09',
  oct: '10', october: '10',
  nov: '11', november: '11',
  dec: '12', december: '12',
};

function generatePasswordFromDOB(dobInput) {
  if (!dobInput || typeof dobInput !== 'string') {
    throw new Error('Invalid Date of Birth provided');
  }

  const raw = dobInput.trim();

  // Already 8 digits? (e.g. "14032006")
  if (/^\d{8}$/.test(raw)) {
    return raw;
  }

  // Check formats: "14 Mar 2006" or "14-Mar-2006"
  const textMonthMatch = raw.match(/^(\d{1,2})[\s\-\/\.]([a-zA-Z]+)[\s\-\/\.](\d{4})$/);
  if (textMonthMatch) {
    const day = textMonthMatch[1].padStart(2, '0');
    const monthKey = textMonthMatch[2].toLowerCase();
    const month = MONTH_MAP[monthKey];
    const year = textMonthMatch[3];
    if (month && isValidDate(day, month, year)) {
      return `${day}${month}${year}`;
    }
  }

  // Check format: "DD/MM/YYYY" or "DD-MM-YYYY"
  const dmyMatch = raw.match(/^(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{4})$/);
  if (dmyMatch) {
    const day = dmyMatch[1].padStart(2, '0');
    const month = dmyMatch[2].padStart(2, '0');
    const year = dmyMatch[3];
    if (isValidDate(day, month, year)) {
      return `${day}${month}${year}`;
    }
  }

  // Check format: "YYYY-MM-DD" (ISO format)
  const ymdMatch = raw.match(/^(\d{4})[\/\-\.](\d{1,2})[\/\-\.](\d{1,2})$/);
  if (ymdMatch) {
    const year = ymdMatch[1];
    const month = ymdMatch[2].padStart(2, '0');
    const day = ymdMatch[3].padStart(2, '0');
    if (isValidDate(day, month, year)) {
      return `${day}${month}${year}`;
    }
  }

  // Attempt JavaScript Date parsing as fallback
  const parsed = new Date(raw);
  if (!isNaN(parsed.getTime())) {
    const day = String(parsed.getDate()).padStart(2, '0');
    const month = String(parsed.getMonth() + 1).padStart(2, '0');
    const year = String(parsed.getFullYear());
    return `${day}${month}${year}`;
  }

  throw new Error(`Unable to parse Date of Birth: "${dobInput}". Expected format DD MMM YYYY, DD/MM/YYYY, or YYYY-MM-DD.`);
}

function isValidDate(dayStr, monthStr, yearStr) {
  const d = parseInt(dayStr, 10);
  const m = parseInt(monthStr, 10);
  const y = parseInt(yearStr, 10);
  if (m < 1 || m > 12) return false;
  if (d < 1 || d > 31) return false;
  if (y < 1900 || y > 2100) return false;
  return true;
}

module.exports = {
  generatePasswordFromDOB,
  isValidDate,
};
