import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from './supabaseClient';
import { getManagersToNotify, sendNotificationToUser } from './NotificationService';
import { isMissingColumnError } from './dataMappers';
import { formatDate, getLocalDateKey, getLocalTime } from '../utils/dateTime';
import {
  buildAttendanceReview,
  getShiftLabel,
  getShiftWindow,
  timeToMinutes,
} from '../utils/attendanceRules';

const LOCAL_SENT_KEY = 'thecoc_attendance_reminders_sent_v1';
const MISSING_CHECKIN_DELAY_MINUTES = 15;
const MISSING_CHECKOUT_DELAY_MINUTES = 15;
const REMINDER_TYPES = new Set(['missing_checkin', 'missing_checkout']);

const readLocalSentMap = async () => {
  try {
    const raw = await AsyncStorage.getItem(LOCAL_SENT_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch (_error) {
    return {};
  }
};

const writeLocalSentMap = async (sentMap) => {
  try {
    await AsyncStorage.setItem(LOCAL_SENT_KEY, JSON.stringify(sentMap));
  } catch (error) {
    console.log('Cannot save attendance reminder sent keys:', error?.message || error);
  }
};

const notificationExists = async ({ userId, reminderKey }) => {
  try {
    const result = await supabase
      .from('notifications')
      .select('id')
      .eq('user_id', userId)
      .eq('type', 'attendance_reminder')
      .filter('data->>reminder_key', 'eq', reminderKey)
      .limit(1);

    if (result.error) {
      if (!isMissingColumnError(result.error)) {
        console.log('Cannot check attendance reminder duplicate:', result.error.message);
      }
      return false;
    }

    return (result.data || []).length > 0;
  } catch (error) {
    console.log('Cannot check attendance reminder duplicate:', error?.message || error);
    return false;
  }
};

const shouldNotifyNow = (row, nowMinutes, dateKey) => {
  if (!REMINDER_TYPES.has(row.type)) return false;

  const isToday = dateKey === getLocalDateKey();
  if (!isToday) return true;

  const shiftWindow = getShiftWindow(row.shiftType);
  if (!shiftWindow) return false;

  if (row.type === 'missing_checkin') {
    const startMinutes = timeToMinutes(shiftWindow.start);
    return startMinutes != null && nowMinutes >= startMinutes + MISSING_CHECKIN_DELAY_MINUTES;
  }

  const endMinutes = timeToMinutes(shiftWindow.end);
  return endMinutes != null && nowMinutes >= endMinutes + MISSING_CHECKOUT_DELAY_MINUTES;
};

const getReminderKey = (row, dateKey) => [
  dateKey,
  row.type,
  row.shift?.id || row.record?.id || row.staff?.id || row.shift?.user_id || row.record?.user_id || 'unknown',
  row.shiftType || 'unknown_shift',
  row.store?.id || row.shift?.store_id || row.record?.store_id || 'unknown_store',
].join(':');

const buildReminderText = (row, dateKey) => {
  const staffName = row.staff?.name || `Nhân viên ${row.shift?.user_id || row.record?.user_id || ''}`.trim();
  const storeName = row.store?.name || `Chi nhánh ${row.shift?.store_id || row.record?.store_id || '--'}`;
  const shiftLabel = getShiftLabel(row.shiftType);
  const shiftWindow = getShiftWindow(row.shiftType);
  const shiftTime = shiftWindow ? `${shiftWindow.start}-${shiftWindow.end}` : 'chưa rõ giờ';
  const dateLabel = dateKey === getLocalDateKey() ? 'hôm nay' : `ngày ${formatDate(dateKey)}`;

  if (row.type === 'missing_checkout') {
    const checkIn = row.record?.checkIn || row.record?.check_in || '--:--';
    return {
      title: `Quên check-out: ${staffName}`,
      body: `${staffName} đã check-in lúc ${checkIn} cho ${shiftLabel} ${dateLabel} tại ${storeName}, nhưng chưa thấy check-out sau ${shiftTime}. Vào Đối chiếu công để nhắc làm bù.`,
    };
  }

  return {
    title: `Quên check-in: ${staffName}`,
    body: `${staffName} có ${shiftLabel} ${dateLabel} tại ${storeName} (${shiftTime}) nhưng chưa thấy check-in. Vào Đối chiếu công để xử lý làm bù.`,
  };
};

export const sendAttendanceExceptionReminders = async ({
  attendanceHistory = [],
  attendanceCorrectionLogs = [],
  shiftRegistrations = [],
  staffList = [],
  storeList = [],
  dateKey = getLocalDateKey(),
} = {}) => {
  if (!shiftRegistrations.length || !staffList.length) return { sent: 0 };

  const nowMinutes = timeToMinutes(getLocalTime());
  if (nowMinutes == null) return { sent: 0 };

  const rows = buildAttendanceReview({
    attendanceHistory,
    attendanceCorrectionLogs,
    shiftRegistrations,
    staffList,
    storeList,
    date: dateKey,
    storeId: 'ALL',
  }).filter((row) => shouldNotifyNow(row, nowMinutes, dateKey));

  if (!rows.length) return { sent: 0 };

  const localSentMap = await readLocalSentMap();
  let sentCount = 0;

  for (const row of rows) {
    const reminderKey = getReminderKey(row, dateKey);
    const storeId = row.store?.id || row.shift?.store_id || row.record?.store_id || null;
    const staffId = row.staff?.id || row.shift?.user_id || row.record?.user_id || null;
    const managers = await getManagersToNotify(storeId);
    const { title, body } = buildReminderText(row, dateKey);

    for (const manager of managers) {
      if (!manager?.id) continue;

      const localKey = `${manager.id}:${reminderKey}`;
      if (localSentMap[localKey]) continue;

      const alreadySent = await notificationExists({
        userId: manager.id,
        reminderKey,
      });
      if (alreadySent) {
        localSentMap[localKey] = new Date().toISOString();
        continue;
      }

      await sendNotificationToUser(
        manager.id,
        title,
        body,
        {
          route: 'AttendanceReview',
          type: 'attendance_reminder',
          reminder_key: reminderKey,
          attendance_issue_type: row.type,
          staff_id: staffId,
          store_id: storeId,
          date: dateKey,
          shift_type: row.shiftType,
        },
        {
          type: 'attendance_reminder',
          route: 'AttendanceReview',
          storeId,
          actorUserId: staffId,
        },
      );

      localSentMap[localKey] = new Date().toISOString();
      sentCount += 1;
    }
  }

  await writeLocalSentMap(localSentMap);
  return { sent: sentCount };
};
