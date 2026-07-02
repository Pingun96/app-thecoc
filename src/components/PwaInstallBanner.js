import React, { useEffect, useState } from 'react';
import { Platform, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

const isStandalonePwa = () => {
  if (Platform.OS !== 'web' || typeof window === 'undefined') return true;
  return window.matchMedia?.('(display-mode: standalone)')?.matches
    || window.navigator?.standalone === true;
};

export default function PwaInstallBanner({ COLORS, isDarkMode }) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (Platform.OS !== 'web' || typeof window === 'undefined') return;
    if (isStandalonePwa()) return;
    if (window.localStorage?.getItem('thecocPwaInstallBannerDismissed') === '1') return;

    const timer = setTimeout(() => setVisible(true), 1200);
    return () => clearTimeout(timer);
  }, []);

  if (!visible) return null;

  const dismiss = () => {
    window.localStorage?.setItem('thecocPwaInstallBannerDismissed', '1');
    setVisible(false);
  };

  return (
    <View style={[styles.wrap, { backgroundColor: COLORS.card, borderColor: COLORS.border }]}>
      <View style={[styles.iconBox, { backgroundColor: isDarkMode ? '#0f2a44' : '#dbeafe' }]}>
        <Ionicons name="phone-portrait-outline" size={20} color={COLORS.primary} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={[styles.title, { color: COLORS.text }]}>Cài The Cốc như app iPhone</Text>
        <Text style={[styles.body, { color: COLORS.textMuted }]}>
          Bấm Chia sẻ → Thêm vào Màn hình chính để mở nhanh như app, không cần IPA.
        </Text>
      </View>
      <TouchableOpacity onPress={dismiss} style={styles.closeBtn}>
        <Ionicons name="close" size={19} color={COLORS.textMuted} />
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    left: 14,
    right: 14,
    bottom: 14,
    zIndex: 9999,
    borderRadius: 18,
    borderWidth: 1,
    padding: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    shadowColor: '#000',
    shadowOpacity: 0.16,
    shadowRadius: 12,
    elevation: 6,
  },
  iconBox: {
    width: 42,
    height: 42,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: { fontWeight: '900', fontSize: 14 },
  body: { fontSize: 12, lineHeight: 17, marginTop: 2 },
  closeBtn: { padding: 8 },
});
