import { Platform } from 'react-native';
import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { supabase } from './supabaseClient';
import { isMissingColumnError } from './dataMappers';

export const NOTIFICATION_CHANNEL_ID = 'thecoc-default';

const EXPO_PUSH_ENDPOINT = 'https://exp.host/--/api/v2/push/send';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
  }),
});

const makeId = (prefix) => `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;

const getProjectId = () => (
  Constants?.expoConfig?.extra?.eas?.projectId
  ?? Constants?.easConfig?.projectId
);

const isPermissionGranted = (permission) => {
  if (permission?.granted || permission?.status === 'granted') return true;

  const iosStatus = permission?.ios?.status;
  return [
    Notifications.IosAuthorizationStatus?.AUTHORIZED,
    Notifications.IosAuthorizationStatus?.PROVISIONAL,
    Notifications.IosAuthorizationStatus?.EPHEMERAL,
  ].includes(iosStatus);
};

const getPwaBasePath = () => {
  if (Platform.OS !== 'web' || typeof window === 'undefined') return '';
  const segments = window.location.pathname.split('/').filter(Boolean);
  return segments.length ? `/${segments[0]}` : '';
};

const getWebNotificationIcon = () => `${getPwaBasePath()}/icons/thecoc-icon-512.png`;

const isWebNotificationSupported = () => (
  Platform.OS === 'web'
  && typeof window !== 'undefined'
  && 'Notification' in window
);

export const getWebNotificationPermissionState = () => {
  if (!isWebNotificationSupported()) return 'unsupported';
  return window.Notification.permission || 'default';
};

export const ensureNotificationChannelAsync = async () => {
  if (Platform.OS !== 'android') return null;

  return Notifications.setNotificationChannelAsync(NOTIFICATION_CHANNEL_ID, {
    name: 'The Cốc',
    description: 'Thông báo vận hành, kho, ca làm và chấm công',
    importance: Notifications.AndroidImportance.MAX,
    vibrationPattern: [0, 250, 250, 250],
    lightColor: '#208AEF',
    lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
    sound: 'default',
  });
};

export const requestNotificationPermissionAsync = async () => {
  if (Platform.OS === 'web') {
    if (!isWebNotificationSupported()) {
      return { granted: false, permission: { status: 'unsupported' } };
    }

    if (window.Notification.permission === 'granted') {
      return { granted: true, permission: { status: 'granted' } };
    }

    if (window.Notification.permission === 'denied') {
      return { granted: false, permission: { status: 'denied' } };
    }

    const status = await window.Notification.requestPermission();
    return { granted: status === 'granted', permission: { status } };
  }

  await ensureNotificationChannelAsync();

  const existingPermission = await Notifications.getPermissionsAsync();
  if (isPermissionGranted(existingPermission)) {
    return { granted: true, permission: existingPermission };
  }

  const requestedPermission = await Notifications.requestPermissionsAsync({
    ios: {
      allowAlert: true,
      allowBadge: true,
      allowSound: true,
    },
  });

  return {
    granted: isPermissionGranted(requestedPermission),
    permission: requestedPermission,
  };
};

export const registerForPushNotificationsAsync = async () => {
  if (Platform.OS === 'web') return null;

  const { granted } = await requestNotificationPermissionAsync();
  if (!granted) {
    console.log('Notification permission was not granted.');
    return null;
  }

  const projectId = getProjectId();
  if (!projectId) {
    console.log('Missing EAS projectId. Cannot request Expo push token.');
    return null;
  }

  try {
    const tokenResponse = await Notifications.getExpoPushTokenAsync({ projectId });
    return tokenResponse?.data || null;
  } catch (error) {
    console.log('Cannot get Expo push token:', error?.message || error);
    return null;
  }
};

export const savePushTokenToDB = async (userId, token, metadata = {}) => {
  if (!userId || !token || Platform.OS === 'web') return null;

  const tokenPayload = {
    user_id: userId,
    expo_push_token: token,
    platform: Platform.OS,
    device_name: Device.deviceName || Device.modelName || null,
    project_id: getProjectId() || null,
    app_version: Constants?.expoConfig?.version || null,
    store_id: metadata.storeId ?? metadata.store_id ?? null,
    is_active: true,
    last_seen_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  const upsertResult = await supabase
    .from('push_tokens')
    .upsert(tokenPayload, { onConflict: 'user_id,expo_push_token' })
    .select('id')
    .maybeSingle();

  if (upsertResult.error && !isMissingColumnError(upsertResult.error)) {
    console.log('Cannot save push token to push_tokens:', upsertResult.error.message);
  }

  const legacyResult = await supabase
    .from('users')
    .update({ push_token: token })
    .eq('id', userId);

  if (legacyResult.error && !isMissingColumnError(legacyResult.error)) {
    console.log('Cannot save legacy push token:', legacyResult.error.message);
  }

  return upsertResult.data || { expo_push_token: token };
};

export const clearPushTokenForUser = async (userId, token) => {
  if (!userId) return;

  let query = supabase
    .from('push_tokens')
    .update({ is_active: false, updated_at: new Date().toISOString() })
    .eq('user_id', userId);

  if (token) query = query.eq('expo_push_token', token);

  const result = await query;
  if (result.error && !isMissingColumnError(result.error)) {
    console.log('Cannot deactivate push token:', result.error.message);
  }
};

const readPushTokensFromTable = async (userId) => {
  const result = await supabase
    .from('push_tokens')
    .select('expo_push_token')
    .eq('user_id', userId)
    .eq('is_active', true);

  if (result.error) {
    if (!isMissingColumnError(result.error)) {
      console.log('Cannot read push_tokens:', result.error.message);
    }
    return [];
  }

  return (result.data || [])
    .map((row) => row.expo_push_token)
    .filter(Boolean);
};

const readLegacyPushToken = async (userId) => {
  const result = await supabase
    .from('users')
    .select('push_token')
    .eq('id', userId)
    .maybeSingle();

  if (result.error) {
    if (!isMissingColumnError(result.error)) {
      console.log('Cannot read legacy push token:', result.error.message);
    }
    return [];
  }

  return result.data?.push_token ? [result.data.push_token] : [];
};

export const getUserPushTokens = async (userId) => {
  if (!userId) return [];

  const tokens = [
    ...(await readPushTokensFromTable(userId)),
    ...(await readLegacyPushToken(userId)),
  ];

  return [...new Set(tokens)].filter(Boolean);
};

export const getUserPushToken = async (userId) => {
  const tokens = await getUserPushTokens(userId);
  return tokens[0] || null;
};

export const createInAppNotification = async ({
  userId,
  title,
  body,
  data = {},
  type = 'general',
  route = data?.route || null,
  storeId = data?.store_id || data?.storeId || null,
  actorUserId = data?.actor_user_id || data?.actorUserId || null,
}) => {
  if (!userId || !title) return null;

  const basePayload = {
    id: makeId('notif'),
    user_id: userId,
    title,
    body: body || '',
    is_read: false,
    created_at: new Date().toISOString(),
  };

  const fullPayload = {
    ...basePayload,
    data,
    type,
    route,
    store_id: storeId,
    actor_user_id: actorUserId,
  };

  let result = await supabase
    .from('notifications')
    .insert(fullPayload)
    .select('*')
    .maybeSingle();

  if (result.error && isMissingColumnError(result.error)) {
    result = await supabase
      .from('notifications')
      .insert(basePayload)
      .select('*')
      .maybeSingle();
  }

  if (result.error) {
    console.log('Cannot create in-app notification:', result.error.message);
    return null;
  }

  return result.data;
};

const buildExpoPushMessage = (token, title, body, data = {}) => ({
  to: token,
  sound: 'default',
  title,
  body,
  data,
  priority: 'high',
  channelId: NOTIFICATION_CHANNEL_ID,
});

export const sendPushNotifications = async (expoPushTokens, title, body, data = {}) => {
  const uniqueTokens = [...new Set((expoPushTokens || []).filter(Boolean))];
  const nativeTokens = uniqueTokens.filter((token) => !String(token).startsWith('web_push_'));

  if (!nativeTokens.length) return { sent: 0, tickets: [] };

  const messages = nativeTokens.map((token) => buildExpoPushMessage(token, title, body, data));

  try {
    const response = await fetch(EXPO_PUSH_ENDPOINT, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Accept-Encoding': 'gzip, deflate',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(messages.length === 1 ? messages[0] : messages),
    });

    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      console.log('Expo push request failed:', payload || response.status);
      return { sent: 0, tickets: payload?.data || [], error: payload };
    }

    return { sent: nativeTokens.length, tickets: payload?.data || [] };
  } catch (error) {
    console.log('Cannot send Expo push:', error?.message || error);
    return { sent: 0, tickets: [], error };
  }
};

export const sendPushNotification = async (
  expoPushToken,
  title,
  body,
  data = {},
  targetUserId = null,
) => {
  if (targetUserId) {
    await createInAppNotification({
      userId: targetUserId,
      title,
      body,
      data,
      type: data?.type || 'general',
      route: data?.route || null,
      storeId: data?.store_id || data?.storeId || null,
      actorUserId: data?.actor_user_id || data?.actorUserId || null,
    });
  }

  if (!expoPushToken) return { sent: 0, tickets: [] };
  return sendPushNotifications([expoPushToken], title, body, data);
};

export const sendNotificationToUser = async (
  userId,
  title,
  body,
  data = {},
  options = {},
) => {
  if (!userId) return { sent: 0, tickets: [] };

  await createInAppNotification({
    userId,
    title,
    body,
    data,
    type: options.type || data?.type || 'general',
    route: options.route || data?.route || null,
    storeId: options.storeId ?? data?.store_id ?? data?.storeId ?? null,
    actorUserId: options.actorUserId ?? data?.actor_user_id ?? data?.actorUserId ?? null,
  });

  const tokens = await getUserPushTokens(userId);
  return sendPushNotifications(tokens, title, body, data);
};

export const sendNotificationToUsers = async (
  userIds,
  title,
  body,
  data = {},
  options = {},
) => {
  const uniqueUserIds = [...new Set((userIds || []).filter(Boolean))];
  if (!uniqueUserIds.length) return { sent: 0, tickets: [] };

  await Promise.all(uniqueUserIds.map((userId) => createInAppNotification({
    userId,
    title,
    body,
    data,
    type: options.type || data?.type || 'general',
    route: options.route || data?.route || null,
    storeId: options.storeId ?? data?.store_id ?? data?.storeId ?? null,
    actorUserId: options.actorUserId ?? data?.actor_user_id ?? data?.actorUserId ?? null,
  })));

  const tokenLists = await Promise.all(uniqueUserIds.map(getUserPushTokens));
  const tokens = tokenLists.flat();
  return sendPushNotifications(tokens, title, body, data);
};

export const showLocalNotification = async (title, body, data = {}) => {
  if (Platform.OS === 'web') {
    const { granted } = await requestNotificationPermissionAsync();
    if (!granted) return null;

    const options = {
      body: body || '',
      data,
      icon: getWebNotificationIcon(),
      badge: getWebNotificationIcon(),
      tag: data?.id || data?.route || `thecoc-${Date.now()}`,
    };

    try {
      const registration = await navigator?.serviceWorker?.ready?.catch(() => null);
      if (registration?.showNotification) {
        await registration.showNotification(title || 'The Cốc', options);
        return true;
      }

      return new window.Notification(title || 'The Cốc', options);
    } catch (error) {
      console.log('Cannot show web notification:', error?.message || error);
      return null;
    }
  }

  const { granted } = await requestNotificationPermissionAsync();
  if (!granted) return null;

  return Notifications.scheduleNotificationAsync({
    content: {
      title,
      body,
      data,
      sound: 'default',
    },
    trigger: null,
  });
};

export const scheduleLocalNotification = async ({
  title,
  body,
  data = {},
  date,
  seconds,
  repeats = false,
}) => {
  if (Platform.OS === 'web') return null;

  const { granted } = await requestNotificationPermissionAsync();
  if (!granted) return null;

  const trigger = date
    ? { type: Notifications.SchedulableTriggerInputTypes.DATE, date }
    : {
        type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
        seconds: Math.max(1, Number(seconds || 1)),
        repeats,
      };

  if (Platform.OS === 'android') {
    trigger.channelId = NOTIFICATION_CHANNEL_ID;
  }

  return Notifications.scheduleNotificationAsync({
    content: {
      title,
      body,
      data,
      sound: 'default',
    },
    trigger,
  });
};

export const scheduleShiftReminder = async (shiftDate, shiftType, minutesBefore = 60) => {
  const targetDate = new Date(shiftDate);
  if (Number.isNaN(targetDate.getTime())) return null;

  const reminderDate = new Date(targetDate.getTime() - Number(minutesBefore || 60) * 60 * 1000);
  if (reminderDate.getTime() <= Date.now()) return null;

  return scheduleLocalNotification({
    title: 'Sắp tới ca làm',
    body: `Bạn có ca ${shiftType || 'làm việc'} sau ${minutesBefore} phút.`,
    data: { route: 'ScheduleTab', type: 'shift_reminder' },
    date: reminderDate,
  });
};

export const cancelAllScheduledNotifications = async () => {
  if (Platform.OS === 'web') return;
  await Notifications.cancelAllScheduledNotificationsAsync();
};

export const getManagersToNotify = async (storeId) => {
  const result = await supabase.from('users').select('*');
  if (result.error) {
    console.log('Cannot read managers for notification:', result.error.message);
    return [];
  }

  return (result.data || [])
    .filter((user) => {
      const viewableStores = user.permissions?.viewable_stores || [];
      return user.role === 'OWNER'
        || user.is_primary_manager
        || (
          user.role === 'MANAGER'
          && (
            user.store_id === storeId
            || viewableStores.includes(storeId)
            || viewableStores.includes('ALL')
          )
        );
    })
    .map((user) => ({ id: user.id, push_token: user.push_token || null }));
};

export const getManagersPushTokens = async (storeId) => {
  const managers = await getManagersToNotify(storeId);
  const tokenLists = await Promise.all(managers.map((manager) => (
    manager.push_token ? [manager.push_token] : getUserPushTokens(manager.id)
  )));
  return [...new Set(tokenLists.flat().filter(Boolean))];
};

export const getLastNotificationData = async () => {
  if (Platform.OS === 'web') return null;

  try {
    const getter = Notifications.getLastNotificationResponseAsync
      || Notifications.getLastNotificationResponse;
    const response = await getter?.();
    return response?.notification?.request?.content?.data || null;
  } catch (_error) {
    return null;
  }
};

export const observeNotificationResponses = (handler) => {
  if (Platform.OS === 'web') return () => {};

  const subscription = Notifications.addNotificationResponseReceivedListener((response) => {
    const data = response?.notification?.request?.content?.data || {};
    handler?.(data, response);
  });

  return () => subscription.remove();
};
