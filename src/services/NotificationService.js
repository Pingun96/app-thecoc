import { Platform } from 'react-native';
import { supabase } from './supabaseClient';

export const registerForPushNotificationsAsync = async () => {
  return null;
};

// Gửi Push Notification (Gọi API Expo)
export const sendPushNotification = async (expoPushToken, title, body, data = {}) => {
  if (!expoPushToken) return;

  const message = {
    to: expoPushToken,
    sound: 'default',
    title: title,
    body: body,
    data: data,
  };

  await fetch('https://exp.host/--/api/v2/push/send', {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Accept-encoding': 'gzip, deflate',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(message),
  });
};

// Lên lịch thông báo Local (Sắp tới ca làm việc)
export const scheduleShiftReminder = async (shiftDate, shiftType, minutesBefore = 60) => {
  return;
};

// Hàm hủy tất cả thông báo đã lên lịch (khi hủy ca)
export const cancelAllScheduledNotifications = async () => {
  return;
};

// Hàm lưu token vào Supabase
export const savePushTokenToDB = async (userId, token) => {
  if (!token) return;
  await supabase.from('users').update({ push_token: token }).eq('id', userId);
};

// Hàm lấy token của người dùng khác
export const getUserPushToken = async (userId) => {
  const { data } = await supabase.from('users').select('push_token').eq('id', userId).single();
  return data?.push_token;
};

export const getManagersPushTokens = async (storeId) => {
  // Tìm quản lý có quyền xem storeId này
  const { data } = await supabase.from('users').select('push_token, permissions').eq('role', 'MANAGER');
  if (!data) return [];
  
  return data
    .filter(u => u.push_token && u.permissions?.viewable_stores?.includes(storeId))
    .map(u => u.push_token);
};
