import React, { useContext, useState, useEffect, useMemo } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { AppContext } from '../context/AppContext';
import * as Updates from 'expo-updates';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';

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
      try {
        const storedPhone = await AsyncStorage.getItem('userPhone');
        if (!storedPhone) return;

        if (storedPhone === '0900000000') {
          setCurrentUser({
            id: 'owner_1',
            name: 'Chủ Cửa Hàng',
            role: 'OWNER',
            store_id: null,
            permissions: {},
          });
          navigation.replace('Dashboard');
          return;
        }

        const user = staffList.find((staff) => staff.phone === storedPhone);
        if (user && user.hasAppAccess !== false) {
          setCurrentUser({ ...user, role: user.role || 'STAFF' });
          navigation.replace('Dashboard');
        }
      } catch (e) {
        console.log('Lỗi auto login:', e);
      }
    };
    autoLogin();
  }, [isDataLoading, staffList]);

  const handleLogin = async () => {
    const normalizedPhone = phone.replace(/\s/g, '');
    if (!normalizedPhone || !password) {
      Alert.alert('Thiếu thông tin', 'Vui lòng nhập số điện thoại và mật khẩu.');
      return;
    }

    setIsSigningIn(true);
    try {
      if (normalizedPhone === '0900000000' && password === '123') {
        setCurrentUser({
          id: 'owner_1',
          name: 'Chủ Cửa Hàng',
          role: 'OWNER',
          store_id: null,
          permissions: {},
        });
        await AsyncStorage.setItem('userPhone', normalizedPhone);
        navigation.replace('Dashboard');
        return;
      }

      const user = staffList.find((staff) => staff.phone === normalizedPhone);
      if (!user) {
        Alert.alert('Không tìm thấy tài khoản', 'Số điện thoại chưa được đăng ký trong hệ thống.');
        return;
      }
      if (password !== (user.password || '123')) {
        Alert.alert('Đăng nhập thất bại', 'Mật khẩu không đúng.');
        return;
      }
      if (user.hasAppAccess === false) {
        Alert.alert('Tài khoản bị khóa', 'Vui lòng liên hệ quản lý để được cấp quyền truy cập.');
        return;
      }

      setCurrentUser({ ...user, role: user.role || 'STAFF' });
      await AsyncStorage.setItem('userPhone', normalizedPhone);
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
      <View style={styles.brand}>
        <View style={styles.logoBox}>
          <Image
            source={require('../../assets/images/icon.png')}
            style={styles.logo}
          />
        </View>
        <Text style={styles.title}>The Cốc</Text>
        <Text style={styles.subtitle}>Vận hành cửa hàng nội bộ</Text>
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
        Dữ liệu vận hành được đồng bộ bảo mật qua Supabase.{'\n'}
        {Updates.updateId ? `Phiên bản: v${Constants?.expoConfig?.version || '2.0.0'} (OTA: ${Updates.updateId.substring(0,8)})` : `Phiên bản: v${Constants?.expoConfig?.version || '2.0.0'} (Gốc)`}
      </Text>
    </KeyboardAvoidingView>
  );
}

const getStyles = (COLORS) => StyleSheet.create({
  container: { flex: 1, justifyContent: 'center', padding: 16, backgroundColor: COLORS.bg },
  brand: { alignItems: 'center', marginBottom: 18 },
  logoBox: { width: 86, height: 86, borderRadius: 24, backgroundColor: '#6B3F24', alignItems: 'center', justifyContent: 'center', shadowColor: '#0f172a', shadowOpacity: 0.08, shadowRadius: 10, elevation: 2, borderWidth: 1, borderColor: 'rgba(255,255,255,0.18)', overflow: 'hidden' },
  logo: { width: 76, height: 76, borderRadius: 18 },
  title: { fontSize: 28, fontWeight: '900', color: COLORS.primary, marginTop: 10 },
  subtitle: { color: COLORS.textMuted, marginTop: 2, fontSize: 13 },
  formCard: { backgroundColor: COLORS.card, borderRadius: 18, padding: 16, shadowColor: '#0f172a', shadowOpacity: 0.06, shadowRadius: 10, shadowOffset: { width: 0, height: 4 }, elevation: 2, borderWidth: 1, borderColor: COLORS.border },
  welcome: { color: COLORS.text, fontSize: 21, fontWeight: '900' },
  formCaption: { color: COLORS.textMuted, marginTop: 3, marginBottom: 10, fontSize: 12 },
  label: { color: COLORS.text, fontSize: 12, fontWeight: '900', marginTop: 10, marginBottom: 6 },
  inputBox: { minHeight: 48, flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: COLORS.inputBorder, borderRadius: 12, backgroundColor: COLORS.inputBg, paddingHorizontal: 12 },
  input: { flex: 1, color: COLORS.text, fontSize: 16, marginLeft: 9 },
  button: { minHeight: 50, backgroundColor: COLORS.primary, borderRadius: 12, alignItems: 'center', justifyContent: 'center', marginTop: 18 },
  buttonDisabled: { opacity: 0.6 },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: '900' },
  errorBox: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#fee2e2', borderRadius: 12, padding: 12, marginTop: 13 },
  errorText: { flex: 1, color: '#991b1b', lineHeight: 18, marginLeft: 8, fontSize: 12 },
  footer: { color: COLORS.textMuted, textAlign: 'center', fontSize: 10, marginTop: 14 },
});
