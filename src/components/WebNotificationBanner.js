import React, { useEffect, useMemo, useState } from 'react';
import { Platform, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import {
  getWebNotificationPermissionState,
  requestNotificationPermissionAsync,
} from '../services/NotificationService';

const DISMISS_KEY = 'thecocPwaPermissionBannerDismissed';

const STATUS_LABEL = {
  granted: 'Đã cấp',
  denied: 'Đang chặn',
  prompt: 'Chưa cấp',
  default: 'Chưa cấp',
  unsupported: 'Không hỗ trợ',
  checking: 'Đang kiểm tra',
};

const isWeb = () => Platform.OS === 'web' && typeof window !== 'undefined';

const isIosWeb = () => {
  if (!isWeb()) return false;
  const userAgent = window.navigator?.userAgent || '';
  const platform = window.navigator?.platform || '';
  return /iPad|iPhone|iPod/.test(userAgent)
    || (platform === 'MacIntel' && window.navigator?.maxTouchPoints > 1);
};

const withTimeout = (promise, timeoutMs, fallback) => Promise.race([
  promise,
  new Promise((resolve) => {
    setTimeout(() => resolve(fallback), timeoutMs);
  }),
]);

const queryPermission = async (name) => {
  if (!isWeb() || !navigator.permissions?.query) return 'default';

  try {
    const result = await navigator.permissions.query({ name });
    return result?.state || 'default';
  } catch (_error) {
    return 'default';
  }
};

const requestLocationPermission = () => new Promise((resolve) => {
  if (!isWeb() || !navigator.geolocation) {
    resolve('unsupported');
    return;
  }

  navigator.geolocation.getCurrentPosition(
    () => resolve('granted'),
    (error) => {
      if (error?.code === error.PERMISSION_DENIED) resolve('denied');
      else resolve('default');
    },
    { enableHighAccuracy: true, timeout: 9000, maximumAge: 0 }
  );
});

const requestCameraPermission = async () => {
  if (!isWeb() || !navigator.mediaDevices?.getUserMedia) return 'unsupported';

  try {
    const stream = await navigator.mediaDevices.getUserMedia({ video: true });
    stream.getTracks().forEach((track) => track.stop());
    return 'granted';
  } catch (error) {
    if (error?.name === 'NotAllowedError' || error?.name === 'SecurityError') return 'denied';
    if (error?.name === 'NotFoundError') return 'unsupported';
    return 'default';
  }
};

const getInitialStatuses = async () => ({
  notifications: getWebNotificationPermissionState(),
  location: await queryPermission('geolocation'),
  camera: await queryPermission('camera'),
  photos: 'default',
});

const isActionNeeded = (statuses) => (
  (isIosWeb() ? ['notifications'] : ['notifications', 'location', 'camera']).some((key) => (
    !['granted', 'denied', 'unsupported'].includes(statuses[key])
  ))
);

export default function WebNotificationBanner({ currentUser, COLORS, isDarkMode }) {
  const [visible, setVisible] = useState(false);
  const [statuses, setStatuses] = useState({
    notifications: 'checking',
    location: 'checking',
    camera: 'checking',
    photos: 'default',
  });
  const [isRequesting, setIsRequesting] = useState(false);

  useEffect(() => {
    let mounted = true;

    const refreshStatuses = async () => {
      if (!isWeb() || !currentUser) {
        if (mounted) setVisible(false);
        return;
      }

      const nextStatuses = await getInitialStatuses();
      if (!mounted) return;

      setStatuses(nextStatuses);
      const dismissed = window.localStorage?.getItem(DISMISS_KEY) === '1';
      setVisible(!dismissed && isActionNeeded(nextStatuses));
    };

    refreshStatuses();

    return () => {
      mounted = false;
    };
  }, [currentUser]);

  useEffect(() => {
    if (!visible || isRequesting) return undefined;
    const timer = setTimeout(() => {
      setVisible(false);
    }, 12000);
    return () => clearTimeout(timer);
  }, [visible, isRequesting]);

  const permissionRows = useMemo(() => ([
    {
      key: 'notifications',
      icon: 'notifications-outline',
      label: 'Thông báo',
      hint: 'Duyệt ca, kho, chấm công',
    },
    {
      key: 'location',
      icon: 'location-outline',
      label: 'Vị trí',
      hint: 'Xác minh check-in/out',
    },
    {
      key: 'camera',
      icon: 'camera-outline',
      label: 'Camera',
      hint: 'Chụp ảnh báo cáo',
    },
    {
      key: 'photos',
      icon: 'images-outline',
      label: 'Thư viện ảnh',
      hint: 'PWA sẽ hỏi khi chọn ảnh',
    },
  ]), []);

  if (!visible) return null;

  const dismiss = () => {
    window.localStorage?.setItem(DISMISS_KEY, '1');
    setVisible(false);
  };

  const requestAllPermissions = async () => {
    setIsRequesting(true);

    try {
      const notificationResult = await withTimeout(
        requestNotificationPermissionAsync(),
        12000,
        { permission: { status: getWebNotificationPermissionState() } }
      );

      const shouldSkipChainedPrompts = isIosWeb();
      const locationState = shouldSkipChainedPrompts
        ? await queryPermission('geolocation')
        : await withTimeout(requestLocationPermission(), 12000, 'default');
      const cameraState = shouldSkipChainedPrompts
        ? await queryPermission('camera')
        : await withTimeout(requestCameraPermission(), 12000, 'default');

      const nextStatuses = {
        notifications: notificationResult?.permission?.status || getWebNotificationPermissionState(),
        location: locationState,
        camera: cameraState,
        photos: 'default',
      };

      setStatuses(nextStatuses);

      if (!isActionNeeded(nextStatuses)) {
        window.localStorage?.setItem(DISMISS_KEY, '1');
        setVisible(false);
      }
    } finally {
      setIsRequesting(false);
    }
  };

  return (
    <View style={[
      styles.wrap,
      {
        backgroundColor: COLORS.card,
        borderColor: isDarkMode ? '#2f425c' : '#bfdbfe',
      },
    ]}>
      <View style={[styles.headerRow]}>
        <View style={[styles.iconBox, { backgroundColor: isDarkMode ? '#172554' : '#dbeafe' }]}>
          <Ionicons name="shield-checkmark-outline" size={20} color={COLORS.primary} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={[styles.title, { color: COLORS.text }]}>Cấp quyền PWA</Text>
          <Text style={[styles.body, { color: COLORS.textMuted }]}>
            Bấm một lần để bật các quyền trình duyệt hỗ trợ cho The Cốc.
          </Text>
        </View>
        <TouchableOpacity onPress={dismiss} style={styles.closeBtn}>
          <Ionicons name="close" size={18} color={COLORS.textMuted} />
        </TouchableOpacity>
      </View>

      <View style={styles.permissionGrid}>
        {permissionRows.map((row) => {
          const status = statuses[row.key] || 'default';
          const isGranted = status === 'granted';
          const isDenied = status === 'denied';
          const statusColor = isGranted ? COLORS.accent : isDenied ? COLORS.danger : COLORS.textMuted;

          return (
            <View key={row.key} style={[styles.permissionRow, { borderColor: COLORS.border }]}>
              <Ionicons name={row.icon} size={17} color={statusColor} />
              <View style={{ flex: 1 }}>
                <Text style={[styles.permissionTitle, { color: COLORS.text }]}>{row.label}</Text>
                <Text style={[styles.permissionHint, { color: COLORS.textMuted }]}>{row.hint}</Text>
              </View>
              <Text style={[styles.statusText, { color: statusColor }]}>
                {STATUS_LABEL[status] || STATUS_LABEL.default}
              </Text>
            </View>
          );
        })}
      </View>

      <TouchableOpacity
        onPress={requestAllPermissions}
        disabled={isRequesting}
        style={[styles.primaryBtn, { backgroundColor: COLORS.primary, opacity: isRequesting ? 0.65 : 1 }]}
      >
        <Text style={styles.primaryText}>{isRequesting ? 'Đang cấp quyền...' : 'Cấp hết quyền PWA'}</Text>
      </TouchableOpacity>
      <Text style={[styles.note, { color: COLORS.textMuted }]}>
        Nếu iPhone báo chặn, vào Cài đặt Safari/trang web để bật lại quyền đã từ chối.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    left: 14,
    right: 14,
    top: 82,
    zIndex: 9998,
    borderRadius: 18,
    borderWidth: 1,
    padding: 12,
    gap: 10,
    shadowColor: '#000',
    shadowOpacity: 0.14,
    shadowRadius: 12,
    elevation: 5,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  iconBox: {
    width: 42,
    height: 42,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    fontWeight: '900',
    fontSize: 14,
  },
  body: {
    fontSize: 12,
    lineHeight: 17,
    marginTop: 2,
  },
  permissionGrid: {
    gap: 7,
  },
  permissionRow: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  permissionTitle: {
    fontSize: 12,
    fontWeight: '800',
  },
  permissionHint: {
    fontSize: 10,
    marginTop: 1,
  },
  statusText: {
    fontSize: 10,
    fontWeight: '900',
  },
  primaryBtn: {
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 12,
  },
  primaryText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '900',
  },
  closeBtn: {
    padding: 6,
  },
  note: {
    fontSize: 10,
    lineHeight: 14,
  },
});
