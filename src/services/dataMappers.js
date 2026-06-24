import {
  calculateWorkedHours,
  normalizeDateKey,
} from '../utils/dateTime';

const asNumber = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

export const normalizeUser = (row) => ({
  ...row,
  name: row.name || row.full_name || '',
  phone: row.phone || row.phone_number || '',
  wage: asNumber(row.wage ?? row.wage_per_hour),
  hasAppAccess: row.hasappaccess ?? row.hasAppAccess ?? true,
  permissions: row.permissions || {},
});

export const normalizeInventoryItem = (row) => ({
  ...row,
  safeLevel: asNumber(row.safelevel ?? row.safeLevel ?? row.safe_level),
});

export const normalizeInventoryLog = (row) => ({
  ...row,
  itemId: row.itemid ?? row.itemId ?? row.item_id,
  amount: asNumber(row.amount),
});

export const normalizeInventoryRequest = (row) => ({
  ...row,
  itemId: row.itemid ?? row.itemId ?? row.item_id,
  amount: asNumber(row.amount),
});

export const normalizeAttendance = (row) => {
  const checkIn = row.check_in ?? row.checkIn ?? null;
  const checkOut = row.check_out ?? row.checkOut ?? null;
  const date = normalizeDateKey(row.date, row.check_in_at);
  const recordedHours = asNumber(row.hours);
  const calculatedHours = checkOut
    ? calculateWorkedHours({
        date,
        checkIn,
        checkOut,
        checkInAt: row.check_in_at,
        checkOutAt: row.check_out_at,
      })
    : 0;

  return {
    ...row,
    date,
    checkIn,
    checkOut,
    check_in: checkIn,
    check_out: checkOut,
    hours: recordedHours > 0 ? recordedHours : calculatedHours,
    isOpen: !checkOut,
  };
};

export const isMissingColumnError = (error) => (
  error?.code === '42703'
  || error?.code === 'PGRST204'
  || /column .* does not exist|Could not find the .* column/i.test(error?.message || '')
);
