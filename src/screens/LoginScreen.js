import React, { useContext, useState } from 'react';
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
  } = useContext(AppContext);

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
        navigation.replace('Dashboard');
        return;
      }

      const user = staffList.find((staff) => staff.phone === normalizedPhone);
      if (!user) {
        Alert.alert('Không tìm thấy tài khoản', 'Số điện thoại chưa được đăng ký trong hệ thống.');
        return;
      }
      if (password !== '123') {
        Alert.alert('Đăng nhập thất bại', 'Mật khẩu không đúng.');
        return;
      }
      if (user.hasAppAccess === false) {
        Alert.alert('Tài khoản bị khóa', 'Vui lòng liên hệ quản lý để được cấp quyền truy cập.');
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
      <View style={styles.brand}>
        <View style={styles.logoBox}>
          <Image
            source={{ uri: 'https://cdn-icons-png.flaticon.com/512/3003/3003984.png' }}
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
        {Updates.updateId ? `Phiên bản: v1.0.0 (OTA: ${Updates.updateId.substring(0,8)})` : 'Phiên bản: v1.0.0 (Gốc)'}
      </Text>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: 'center', padding: 20, backgroundColor: '#f4f7fb' },
  brand: { alignItems: 'center', marginBottom: 25 },
  logoBox: { width: 86, height: 86, borderRadius: 25, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center', shadowColor: '#0f172a', shadowOpacity: 0.08, shadowRadius: 10, elevation: 3 },
  logo: { width: 62, height: 62 },
  title: { fontSize: 30, fontWeight: '900', color: '#166534', marginTop: 13 },
  subtitle: { color: '#64748b', marginTop: 3 },
  formCard: { backgroundColor: '#fff', borderRadius: 20, padding: 20, shadowColor: '#0f172a', shadowOpacity: 0.08, shadowRadius: 14, shadowOffset: { width: 0, height: 5 }, elevation: 3 },
  welcome: { color: '#172033', fontSize: 23, fontWeight: '900' },
  formCaption: { color: '#64748b', marginTop: 4, marginBottom: 13 },
  label: { color: '#475569', fontSize: 13, fontWeight: '800', marginTop: 12, marginBottom: 7 },
  inputBox: { minHeight: 50, flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: '#cbd5e1', borderRadius: 13, backgroundColor: '#f8fafc', paddingHorizontal: 13 },
  input: { flex: 1, color: '#172033', fontSize: 15, marginLeft: 9 },
  button: { minHeight: 52, backgroundColor: '#166534', borderRadius: 13, alignItems: 'center', justifyContent: 'center', marginTop: 22 },
  buttonDisabled: { opacity: 0.6 },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: '900' },
  errorBox: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#fee2e2', borderRadius: 12, padding: 12, marginTop: 13 },
  errorText: { flex: 1, color: '#991b1b', lineHeight: 18, marginLeft: 8, fontSize: 12 },
  footer: { color: '#94a3b8', textAlign: 'center', fontSize: 11, marginTop: 20 },
});
