export const STAFF_REVENUE_WINDOWS = {
  MORNING: { startMinutes: 13 * 60 + 30, endMinutes: 14 * 60, label: '13:30–14:00' },
  AFTERNOON: { startMinutes: 21 * 60, endMinutes: 22 * 60, label: '21:00–22:00' },
};

const getBusinessMinutes = (date = new Date()) => {
  try {
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Asia/Ho_Chi_Minh',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(date);
    const hour = Number(parts.find((part) => part.type === 'hour')?.value);
    const minute = Number(parts.find((part) => part.type === 'minute')?.value);
    if (Number.isFinite(hour) && Number.isFinite(minute)) return hour * 60 + minute;
  } catch (_) {
    // Older native runtimes may not expose IANA timezone formatting.
  }
  return date.getHours() * 60 + date.getMinutes();
};

export const getShiftRevenuePeriod = (shift) => {
  const label = String(shift?.period_name || shift?.shift_name || shift?.opened_at || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
  if (label.includes('ca sang') || label.includes('morning')) return 'MORNING';
  if (label.includes('ca chieu') || label.includes('afternoon') || label.includes('evening')) return 'AFTERNOON';
  return null;
};

export const getStaffRevenueAccess = (user, shift, date = new Date()) => {
  if (user?.role !== 'STAFF') {
    return { allowed: true, period: null, label: null };
  }

  const period = getShiftRevenuePeriod(shift);
  const window = period ? STAFF_REVENUE_WINDOWS[period] : null;
  if (!window) {
    return {
      allowed: false,
      period: null,
      label: '13:30–14:00 (ca sáng) hoặc 21:00–22:00 (ca chiều)',
    };
  }

  const minutes = getBusinessMinutes(date);
  return {
    allowed: minutes >= window.startMinutes && minutes < window.endMinutes,
    period,
    label: window.label,
  };
};
