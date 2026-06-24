import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import Constants from 'expo-constants';
import { Platform } from 'react-native';
import { supabase } from './supabaseClient';

// Cấu hình cách thông báo hiển thị khi app đang mở
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

export const registerForPushNotificationsAsync = async () => {
  let token;

  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('default', {
      name: 'default',
      importance: Notifications.AndroidImportance.MAX,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: '#FF231F7C',
    });
  }

  if (Device.isDevice) {
    const { status: existingStatus } = await Notifications.getPermissionsAsync();
    let finalStatus = existingStatus;
    if (existingStatus !== 'granted') {
      const { status } = await Notifications.requestPermissionsAsync();
      finalStatus = status;
    }
    if (finalStatus !== 'granted') {
      console.log('Failed to get push token for push notification!');
      return null;
    }
    try {
      const projectId =
        Constants?.expoConfig?.extra?.eas?.projectId ?? Constants?.easConfig?.projectId;
      
      // Lấy token
      token = (
        await Notifications.getExpoPushTokenAsync({
          projectId: projectId || 'b217d84a-9b44-4860-9111-c9172f854674', // fallback project ID
        })
      ).data;
    } catch (e) {
      token = `${e}`;
    }
  } else {
    console.log('Must use physical device for Push Notifications');
  }

  return token;
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
  // Tính toán thời gian bắt đầu ca
  // Giả sử: Ca Sáng = 8:00, Ca Chiều = 13:00
  const [year, month, day] = shiftDate.split('-').map(Number);
  const shiftTime = new Date(year, month - 1, day);
  
  if (shiftType === 'MORNING') {
    shiftTime.setHours(8, 0, 0, 0);
  } else {
    shiftTime.setHours(13, 0, 0, 0);
  }

  // Lùi lại X phút
  const triggerTime = new Date(shiftTime.getTime() - minutesBefore * 60000);

  // Không đặt lịch nếu thời điểm báo thức đã qua trong quá khứ
  if (triggerTime <= new Date()) return;

  await Notifications.scheduleNotificationAsync({
    content: {
      title: "⏰ Sắp tới ca làm việc!",
      body: `Bạn có ca làm việc lúc ${shiftType === 'MORNING' ? '08:00' : '13:00'}. Hãy chuẩn bị nhé!`,
      data: { shiftDate, shiftType },
    },
    trigger: triggerTime,
  });
};

// Hàm hủy tất cả thông báo đã lên lịch (khi hủy ca)
export const cancelAllScheduledNotifications = async () => {
  await Notifications.cancelAllScheduledNotificationsAsync();
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
