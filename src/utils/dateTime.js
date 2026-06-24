const pad2 = (value) => String(value).padStart(2, '0');

export const getLocalDateKey = (date = new Date()) => (
  `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`
);

export const getLocalTime = (date = new Date()) => (
  `${pad2(date.getHours())}:${pad2(date.getMinutes())}`
);

export const normalizeDateKey = (value, fallbackTimestamp) => {
  if (fallbackTimestamp) {
    const timestamp = new Date(fallbackTimestamp);
    if (!Number.isNaN(timestamp.getTime())) return getLocalDateKey(timestamp);
  }

  if (!value) return '';
  const text = String(value).trim();

  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;

  const vietnameseDate = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (vietnameseDate) {
    return `${vietnameseDate[3]}-${pad2(vietnameseDate[2])}-${pad2(vietnameseDate[1])}`;
  }

  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? text : getLocalDateKey(parsed);
};

export const formatDate = (value) => {
  const key = normalizeDateKey(value);
  const match = key.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return match ? `${match[3]}/${match[2]}/${match[1]}` : value || '--';
};

export const combineLocalDateTime = (dateValue, timeValue) => {
  const key = normalizeDateKey(dateValue);
  const dateMatch = key.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const timeMatch = String(timeValue || '').match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?/);

  if (!dateMatch || !timeMatch) return null;

  return new Date(
    Number(dateMatch[1]),
    Number(dateMatch[2]) - 1,
    Number(dateMatch[3]),
    Number(timeMatch[1]),
    Number(timeMatch[2]),
    Number(timeMatch[3] || 0),
  );
};

export const calculateWorkedHours = ({
  date,
  checkIn,
  checkOut,
  checkInAt,
  checkOutAt,
}) => {
  let start = checkInAt ? new Date(checkInAt) : combineLocalDateTime(date, checkIn);
  let end = checkOutAt ? new Date(checkOutAt) : combineLocalDateTime(date, checkOut);

  if (!start || !end || Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return 0;

  if (!checkOutAt && end < start) {
    end = new Date(end.getTime() + 24 * 60 * 60 * 1000);
  }

  const hours = (end.getTime() - start.getTime()) / (60 * 60 * 1000);
  if (hours < 0 || hours > 24) return 0;
  return Number(hours.toFixed(2));
};

export const isDateInCurrentMonth = (value, now = new Date()) => {
  const key = normalizeDateKey(value);
  return key.startsWith(`${now.getFullYear()}-${pad2(now.getMonth() + 1)}`);
};

export const formatDuration = (hours = 0) => {
  const safeHours = Math.max(0, Number(hours) || 0);
  const totalMinutes = Math.round(safeHours * 60);
  const hourPart = Math.floor(totalMinutes / 60);
  const minutePart = totalMinutes % 60;
  return `${hourPart} giờ ${pad2(minutePart)} phút`;
};
