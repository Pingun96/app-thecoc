import React, { useContext, useState, useEffect, useMemo } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { AppContext } from '../context/AppContext';
import * as Updates from 'expo-updates';
import Constants from 'expo-constants';
import { signInWithPassword, restoreAuthSession } from '../services/supabaseClient';

export default function LoginScreen({ navigation }) {
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [isSigningIn, setIsSigningIn] = useState(false);
  const {
    staffList,
    setCurrentUser,
    isDataLoading,
    dataError,
    refreshData,
    COLORS,
  } = useContext(AppContext);

  const styles = useMemo(() => getStyles(COLORS), [COLORS]);

  useEffect(() => {
    const autoLogin = async () => {
      if (isDataLoading) return;
      const { data: user } = await restoreAuthSession();
      if (user) {
        setCurrentUser({ ...user, role: user.role || 'STAFF' });
        navigation.replace('Dashboard');
      }
    };
    autoLogin();
  }, [isDataLoading, navigation, setCurrentUser]);

  const handleLogin = async () => {
    const normalizedPhone = phone.replace(/\s/g, '');
    if (!normalizedPhone || !password) {
      Alert.alert('Thiếu thông tin', 'Vui lòng nhập số điện thoại và mật khẩu.');
      return;
    }

    setIsSigningIn(true);
    try {
      const { data: user, error } = await signInWithPassword(normalizedPhone, password);
      if (error) {
        Alert.alert('Đăng nhập thất bại', error.message);
        return;
      }
      setCurrentUser({ ...user, role: user.role || 'STAFF' });
      navigation.replace('Dashboard');
    } finally {
      setIsSigningIn(false);
    }
  };
  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={styles.container}
    >
      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
      <View style={styles.brand}>
        <View style={styles.brandPanel}>
          <Image
            source={require('../../assets/images/thecoc-wordmark.png')}
            style={styles.logo}
            resizeMode="contain"
            accessibilityLabel="Tiệm trà, cafe TheCoc"
          />
          <View style={styles.brandLine} />
          <Text style={styles.brandCaption}>Hệ thống vận hành nội bộ</Text>
        </View>
      </View>

      <View style={styles.formCard}>
        <Text style={styles.welcome}>Đăng nhập</Text>
        <Text style={styles.formCaption}>Sử dụng tài khoản đã được quản lý cấp.</Text>

        {dataError ? (
          <TouchableOpacity style={styles.errorBox} onPress={refreshData}>
            <Ionicons name="cloud-offline-outline" size={20} color="#b91c1c" />
            <Text style={styles.errorText}>{dataError}{'\n'}Chạm để thử tải lại.</Text>
          </TouchableOpacity>
        ) : null}

        <Text style={styles.label}>Số điện thoại</Text>
        <View style={styles.inputBox}>
          <Ionicons name="call-outline" size={20} color="#64748b" />
          <TextInput
            style={styles.input}
            placeholder="Nhập số điện thoại"
            placeholderTextColor="#94a3b8"
            keyboardType="phone-pad"
            autoComplete="tel"
            value={phone}
            onChangeText={setPhone}
          />
        </View>

        <Text style={styles.label}>Mật khẩu</Text>
        <View style={styles.inputBox}>
          <Ionicons name="lock-closed-outline" size={20} color="#64748b" />
          <TextInput
            style={styles.input}
            placeholder="Nhập mật khẩu"
            placeholderTextColor="#94a3b8"
            secureTextEntry
            value={password}
            onChangeText={setPassword}
            onSubmitEditing={handleLogin}
          />
        </View>

        <TouchableOpacity
          style={[styles.button, (isSigningIn || isDataLoading) && styles.buttonDisabled]}
          onPress={handleLogin}
          disabled={isSigningIn || isDataLoading}
        >
          {isSigningIn || isDataLoading
            ? <ActivityIndicator color="#fff" />
            : <Text style={styles.buttonText}>Đăng nhập</Text>}
        </TouchableOpacity>
      </View>

      <Text style={styles.footer}>
        Dữ liệu vận hành được đồng bộ bảo mật qua Cloudflare.{'\n'}
        {Updates.updateId ? `Phiên bản: v${Constants?.expoConfig?.version || '2.0.0'} (OTA: ${Updates.updateId.substring(0,8)})` : `Phiên bản: v${Constants?.expoConfig?.version || '2.0.0'} (Gốc)`}
      </Text>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const getStyles = (COLORS) => StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.bg },
  content: { flexGrow: 1, justifyContent: 'center', padding: 20, paddingVertical: 28 },
  brand: { alignItems: 'center', marginBottom: 20 },
  brandPanel: { width: '100%', maxWidth: 410, alignItems: 'center', backgroundColor: '#000000', borderRadius: 24, paddingHorizontal: 18, paddingVertical: 16, shadowColor: '#020617', shadowOpacity: 0.23, shadowRadius: 16, shadowOffset: { width: 0, height: 8 }, elevation: 5 },
  logo: { width: '100%', height: 118 },
  brandLine: { width: 42, height: 2, backgroundColor: '#10B981', borderRadius: 99, marginTop: 1, marginBottom: 8 },
  brandCaption: { color: '#cbd5e1', fontSize: 13, fontWeight: '700', letterSpacing: 0.2 },
  formCard: { backgroundColor: COLORS.card, borderRadius: 20, padding: 20, shadowColor: '#0f172a', shadowOpacity: 0.08, shadowRadius: 14, shadowOffset: { width: 0, height: 5 }, elevation: 3 },
  welcome: { color: COLORS.text, fontSize: 23, fontWeight: '900' },
  formCaption: { color: COLORS.textMuted, marginTop: 4, marginBottom: 13 },
  label: { color: COLORS.text, fontSize: 13, fontWeight: '800', marginTop: 12, marginBottom: 7 },
  inputBox: { minHeight: 50, flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: COLORS.inputBorder, borderRadius: 13, backgroundColor: COLORS.inputBg, paddingHorizontal: 13 },
  input: { flex: 1, color: COLORS.text, fontSize: 15, marginLeft: 9 },
  button: { minHeight: 52, backgroundColor: COLORS.primary, borderRadius: 13, alignItems: 'center', justifyContent: 'center', marginTop: 22 },
  buttonDisabled: { opacity: 0.6 },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: '900' },
  errorBox: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#fee2e2', borderRadius: 12, padding: 12, marginTop: 13 },
  errorText: { flex: 1, color: '#991b1b', lineHeight: 18, marginLeft: 8, fontSize: 12 },
  footer: { color: COLORS.textMuted, textAlign: 'center', fontSize: 11, marginTop: 20 },
});
