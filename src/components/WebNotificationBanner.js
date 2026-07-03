import React, { useEffect, useState } from 'react';
import { Platform, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import {
  getWebNotificationPermissionState,
  requestNotificationPermissionAsync,
} from '../services/NotificationService';

export default function WebNotificationBanner({ currentUser, COLORS, isDarkMode }) {
  const [visible, setVisible] = useState(false);
  const [status, setStatus] = useState('default');
  const [isRequesting, setIsRequesting] = useState(false);

  useEffect(() => {
    if (Platform.OS !== 'web' || typeof window === 'undefined' || !currentUser) {
      setVisible(false);
      return;
    }

    const nextStatus = getWebNotificationPermissionState();
    setStatus(nextStatus);

    const dismissed = window.localStorage?.getItem('thecocWebNotificationBannerDismissed') === '1';
    setVisible(nextStatus === 'default' && !dismissed);
  }, [currentUser]);

  if (!visible) return null;

  const dismiss = () => {
    window.localStorage?.setItem('thecocWebNotificationBannerDismissed', '1');
    setVisible(false);
  };

  const enableNotifications = async () => {
    setIsRequesting(true);
    const result = await requestNotificationPermissionAsync();
    const nextStatus = result?.permission?.status || getWebNotificationPermissionState();
    setStatus(nextStatus);
    setIsRequesting(false);

    if (result?.granted || nextStatus === 'denied') {
      setVisible(false);
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
      <View style={[styles.iconBox, { backgroundColor: isDarkMode ? '#172554' : '#dbeafe' }]}>
        <Ionicons name="notifications-outline" size={20} color={COLORS.primary} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={[styles.title, { color: COLORS.text }]}>Bật thông báo điện thoại</Text>
        <Text style={[styles.body, { color: COLORS.textMuted }]}>
          Cho phép trình duyệt hiện thông báo khi có duyệt ca, kho hoặc chấm công mới.
        </Text>
        {status === 'denied' ? (
          <Text style={[styles.note, { color: COLORS.danger }]}>
            Trình duyệt đang chặn quyền thông báo. Hãy mở Cài đặt trang web để bật lại.
          </Text>
        ) : null}
      </View>
      <TouchableOpacity
        onPress={enableNotifications}
        disabled={isRequesting}
        style={[styles.primaryBtn, { backgroundColor: COLORS.primary, opacity: isRequesting ? 0.65 : 1 }]}
      >
        <Text style={styles.primaryText}>{isRequesting ? 'Đang bật...' : 'Bật'}</Text>
      </TouchableOpacity>
      <TouchableOpacity onPress={dismiss} style={styles.closeBtn}>
        <Ionicons name="close" size={18} color={COLORS.textMuted} />
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    left: 14,
    right: 14,
    bottom: 92,
    zIndex: 9998,
    borderRadius: 18,
    borderWidth: 1,
    padding: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    shadowColor: '#000',
    shadowOpacity: 0.14,
    shadowRadius: 12,
    elevation: 5,
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
  note: {
    fontSize: 11,
    marginTop: 4,
    fontWeight: '700',
  },
  primaryBtn: {
    paddingHorizontal: 14,
    paddingVertical: 9,
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
});
