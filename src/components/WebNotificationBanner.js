import React, { useEffect, useMemo, useState } from 'react';
import { Modal, Platform, StyleSheet, Text, TouchableOpacity, View, ScrollView } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import {
  getWebNotificationPermissionState,
  registerForPushNotificationsAsync,
  requestNotificationPermissionAsync,
  savePushTokenToDB,
} from '../services/NotificationService';

const DISMISS_KEY = 'thecocPwaPermissionBannerDismissed:v2';

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

const isStandalonePwa = () => {
  if (!isWeb()) return false;
  return window.navigator?.standalone === true
    || window.matchMedia?.('(display-mode: standalone)')?.matches === true;
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
  const [showGuide, setShowGuide] = useState(false);
  const [statuses, setStatuses] = useState({
    notifications: 'checking',
    location: 'checking',
    camera: 'checking',
    photos: 'default',
  });
  const [isRequesting, setIsRequesting] = useState(false);
  const [registerResult, setRegisterResult] = useState(null); // 'ok' | 'fail' | null

  const iosNeedsHomeScreen = isIosWeb() && !isStandalonePwa();

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
      setVisible(!dismissed && (iosNeedsHomeScreen || isActionNeeded(nextStatuses)));
    };

    refreshStatuses();

    return () => {
      mounted = false;
    };
  }, [currentUser, iosNeedsHomeScreen]);

  useEffect(() => {
    if (!visible || isRequesting) return undefined;
    const timer = setTimeout(() => {
      if (!iosNeedsHomeScreen) setVisible(false);
    }, 12000);
    return () => clearTimeout(timer);
  }, [visible, isRequesting, iosNeedsHomeScreen]);

  const permissionRows = useMemo(() => ([
    {
      key: 'notifications',
      icon: 'notifications-outline',
      label: 'Thông báo',
      hint: iosNeedsHomeScreen
        ? 'iPhone cần mở từ icon ngoài màn hình chính'
        : 'Duyệt ca, kho, chấm công',
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
  ]), [iosNeedsHomeScreen]);

  if (!visible) return null;

  const dismiss = () => {
    window.localStorage?.setItem(DISMISS_KEY, '1');
    setVisible(false);
  };

  const requestAllPermissions = async () => {
    setIsRequesting(true);

    let nativePromptPromise = null;
    try {
      if (typeof window !== 'undefined' && window.Notification && window.Notification.permission === 'default') {
        nativePromptPromise = window.Notification.requestPermission();
      }
    } catch (e) {
      // Ignore
    }

    const processAsync = async () => {
      try {
        if (nativePromptPromise) {
          await nativePromptPromise;
        }

        let notificationState = getWebNotificationPermissionState();
        if (notificationState === 'default' || notificationState === 'prompt') {
          const notificationResult = await withTimeout(
            requestNotificationPermissionAsync(),
            12000,
            { permission: { status: getWebNotificationPermissionState() } }
          );
          notificationState = notificationResult?.permission?.status || getWebNotificationPermissionState();
        }

    const token = await withTimeout(
        registerForPushNotificationsAsync({
          prompt: notificationState !== 'granted',
          externalUserId: currentUser?.id,
          storeId: currentUser?.store_id,
        }),
        20000,
        null
      );

        if (token && currentUser?.id) {
          await savePushTokenToDB(currentUser.id, token, { storeId: currentUser.store_id });
          setRegisterResult('ok');
        } else {
          // On iOS, OneSignal may not return a token immediately – not necessarily an error
          setRegisterResult(isIosWeb() ? 'ios_pending' : 'fail');
        }

        const shouldSkipChainedPrompts = isIosWeb();
        const locationState = shouldSkipChainedPrompts
          ? await queryPermission('geolocation')
          : await withTimeout(requestLocationPermission(), 12000, 'default');
        const cameraState = shouldSkipChainedPrompts
          ? await queryPermission('camera')
          : await withTimeout(requestCameraPermission(), 12000, 'default');

        const nextStatuses = {
          notifications: getWebNotificationPermissionState(),
          location: locationState,
          camera: cameraState,
          photos: 'default',
        };

        setStatuses(nextStatuses);

        if (!isActionNeeded(nextStatuses)) {
          window.localStorage?.setItem(DISMISS_KEY, '1');
          setVisible(false);
        }
      } catch (error) {
        console.log('Error requesting permissions:', error);
      } finally {
        setIsRequesting(false);
      }
    };

    processAsync();
  };

  // Step guide cho iOS
  const IosGuideModal = () => (
    <Modal visible={showGuide} transparent animationType="slide">
      <View style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.5)' }}>
        <View style={[styles.guideSheet, { backgroundColor: COLORS.card }]}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
            <Text style={[styles.guideTitle, { color: COLORS.text }]}>📲 Cài PWA trên iPhone</Text>
            <TouchableOpacity onPress={() => setShowGuide(false)} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
              <Ionicons name="close" size={22} color={COLORS.textMuted} />
            </TouchableOpacity>
          </View>
          <Text style={[styles.guideSubtitle, { color: COLORS.textMuted }]}>
            iPhone cần bạn thêm app vào màn hình chính trước khi có thể nhận thông báo (yêu cầu iOS 16.4+)
          </Text>
          <ScrollView showsVerticalScrollIndicator={false}>
            {[
              { step: '1', icon: 'share-outline', text: 'Bấm nút Chia sẻ ↑ ở thanh dưới Safari (biểu tượng hình vuông có mũi tên lên)' },
              { step: '2', icon: 'add-circle-outline', text: 'Cuộn xuống và chọn "Thêm vào Màn hình Chính" (Add to Home Screen)' },
              { step: '3', icon: 'checkmark-circle-outline', text: 'Bấm "Thêm" (Add) ở góc trên phải' },
              { step: '4', icon: 'home-outline', text: 'Quay ra màn hình chính, mở The Cốc từ icon mới vừa tạo' },
              { step: '5', icon: 'notifications-outline', text: 'Vào Cài đặt → mục Quyền → Bật Thông báo khi được hỏi' },
            ].map(({ step, icon, text }) => (
              <View key={step} style={styles.guideStep}>
                <View style={[styles.guideStepBadge, { backgroundColor: COLORS.primary }]}>
                  <Text style={{ color: '#fff', fontSize: 12, fontWeight: '900' }}>{step}</Text>
                </View>
                <Ionicons name={icon} size={20} color={COLORS.primary} style={{ marginHorizontal: 8 }} />
                <Text style={[styles.guideStepText, { color: COLORS.text }]}>{text}</Text>
              </View>
            ))}

            <View style={[styles.guideNote, { backgroundColor: isDarkMode ? '#1e3a5f' : '#eff6ff', borderColor: isDarkMode ? '#1d4ed8' : '#bfdbfe' }]}>
              <Ionicons name="information-circle-outline" size={16} color="#1d4ed8" />
              <Text style={{ color: isDarkMode ? '#93c5fd' : '#1e40af', fontSize: 11, flex: 1, marginLeft: 6 }}>
                Sau khi cài xong, vào lại mục Thông báo và bấm "Cấp quyền" để hoàn tất đăng ký.
              </Text>
            </View>
          </ScrollView>

          <TouchableOpacity
            style={[styles.primaryBtn, { backgroundColor: COLORS.primary, marginTop: 14 }]}
            onPress={() => setShowGuide(false)}
          >
            <Text style={styles.primaryText}>Đã hiểu, tôi sẽ cài ngay!</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );

  return (
    <>
      <IosGuideModal />
      <View style={[
        styles.wrap,
        {
          backgroundColor: COLORS.card,
          borderColor: isDarkMode ? '#2f425c' : '#bfdbfe',
        },
      ]}>
        <View style={styles.headerRow}>
          <View style={[styles.iconBox, { backgroundColor: isDarkMode ? '#172554' : '#dbeafe' }]}>
            <Ionicons name={iosNeedsHomeScreen ? 'phone-portrait-outline' : 'shield-checkmark-outline'} size={20} color={COLORS.primary} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[styles.title, { color: COLORS.text }]}>
              {iosNeedsHomeScreen ? '📲 Cài PWA để nhận thông báo' : 'Cấp quyền PWA'}
            </Text>
            <Text style={[styles.body, { color: COLORS.textMuted }]}>
              {iosNeedsHomeScreen
                ? 'iPhone cần thêm The Cốc vào Màn hình chính trước khi bật thông báo.'
                : 'Bấm một lần để bật thông báo đẩy và các quyền trình duyệt hỗ trợ The Cốc.'}
            </Text>
          </View>
          <TouchableOpacity onPress={dismiss} style={styles.closeBtn}>
            <Ionicons name="close" size={18} color={COLORS.textMuted} />
          </TouchableOpacity>
        </View>

        {/* Result feedback */}
        {registerResult === 'ok' && (
          <View style={[styles.resultBox, { backgroundColor: '#dcfce7', borderColor: '#86efac' }]}>
            <Ionicons name="checkmark-circle" size={16} color="#16a34a" />
            <Text style={{ color: '#15803d', fontSize: 12, fontWeight: '700', marginLeft: 6 }}>Đã bật thông báo thành công! ✅</Text>
          </View>
        )}
        {registerResult === 'ios_pending' && (
          <View style={[styles.resultBox, { backgroundColor: '#fef9c3', borderColor: '#fde68a' }]}>
            <Ionicons name="time-outline" size={16} color="#b45309" />
            <Text style={{ color: '#92400e', fontSize: 11, flex: 1, marginLeft: 6 }}>iPhone đang xử lý... Nếu chưa thấy thông báo, hãy tắt và mở lại app từ icon màn hình chính.</Text>
          </View>
        )}
        {registerResult === 'fail' && (
          <View style={[styles.resultBox, { backgroundColor: '#fee2e2', borderColor: '#fca5a5' }]}>
            <Ionicons name="warning-outline" size={16} color="#dc2626" />
            <Text style={{ color: '#991b1b', fontSize: 11, flex: 1, marginLeft: 6 }}>Chưa lấy được token. Kiểm tra trình chặn quảng cáo hoặc thử trên Chrome/Safari.</Text>
          </View>
        )}

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

        {iosNeedsHomeScreen ? (
          <View style={{ gap: 8 }}>
            <TouchableOpacity
              onPress={() => setShowGuide(true)}
              style={[styles.primaryBtn, { backgroundColor: '#0ea5e9' }]}
            >
              <Ionicons name="book-outline" size={15} color="#fff" style={{ marginRight: 6 }} />
              <Text style={styles.primaryText}>Xem hướng dẫn cài từng bước</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={requestAllPermissions}
              disabled={isRequesting}
              style={[styles.primaryBtn, { backgroundColor: COLORS.primary, opacity: isRequesting ? 0.65 : 1 }]}
            >
              <Text style={styles.primaryText}>
                {isRequesting ? 'Đang đăng ký...' : 'Tôi đã mở từ icon → Bật thông báo'}
              </Text>
            </TouchableOpacity>
          </View>
        ) : (
          <TouchableOpacity
            onPress={requestAllPermissions}
            disabled={isRequesting}
            style={[styles.primaryBtn, { backgroundColor: COLORS.primary, opacity: isRequesting ? 0.65 : 1 }]}
          >
            <Text style={styles.primaryText}>
              {isRequesting ? 'Đang cấp quyền...' : 'Cấp hết quyền PWA'}
            </Text>
          </TouchableOpacity>
        )}

        <Text style={[styles.note, { color: COLORS.textMuted }]}>
          {iosNeedsHomeScreen
            ? 'Yêu cầu iOS 16.4+ và Safari. Sau khi cài vào màn hình chính, mở app từ icon để thông báo hoạt động.'
            : 'Nếu bị chặn, vào Cài đặt → Safari/Chrome → Thông báo để bật lại.'}
        </Text>
      </View>
    </>
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
  resultBox: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: 10,
    padding: 10,
  },
  guideSheet: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 20,
    paddingBottom: 36,
    maxHeight: '85%',
  },
  guideTitle: {
    fontSize: 16,
    fontWeight: '900',
  },
  guideSubtitle: {
    fontSize: 12,
    lineHeight: 17,
    marginBottom: 16,
  },
  guideStep: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 14,
  },
  guideStepBadge: {
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  guideStepText: {
    flex: 1,
    fontSize: 13,
    lineHeight: 18,
  },
  guideNote: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    borderWidth: 1,
    borderRadius: 10,
    padding: 10,
    marginTop: 8,
    marginBottom: 4,
  },
});
