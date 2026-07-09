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
            name: 'Chá»§ Cá»­a HÃ ng',
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
        console.log('Lá»—i auto login:', e);
      }
    };
    autoLogin();
  }, [isDataLoading, staffList]);

  const handleLogin = async () => {
    const normalizedPhone = phone.replace(/\s/g, '');
    if (!normalizedPhone || !password) {
      Alert.alert('Thiáº¿u thÃ´ng tin', 'Vui lÃ²ng nháº­p sá»‘ Ä‘iá»‡n thoáº¡i vÃ  máº­t kháº©u.');
      return;
    }

    setIsSigningIn(true);
    try {
      if (normalizedPhone === '0900000000' && password === '123') {
        setCurrentUser({
          id: 'owner_1',
          name: 'Chá»§ Cá»­a HÃ ng',
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
        Alert.alert('KhÃ´ng tÃ¬m tháº¥y tÃ i khoáº£n', 'Sá»‘ Ä‘iá»‡n thoáº¡i chÆ°a Ä‘Æ°á»£c Ä‘Äƒng kÃ½ trong há»‡ thá»‘ng.');
        return;
      }
      if (password !== (user.password || '123')) {
        Alert.alert('ÄÄƒng nháº­p tháº¥t báº¡i', 'Máº­t kháº©u khÃ´ng Ä‘Ãºng.');
        return;
      }
      if (user.hasAppAccess === false) {
        Alert.alert('TÃ i khoáº£n bá»‹ khÃ³a', 'Vui lÃ²ng liÃªn há»‡ quáº£n lÃ½ Ä‘á»ƒ Ä‘Æ°á»£c cáº¥p quyá»n truy cáº­p.');
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
            source={{ uri: 'https://cdn-icons-png.flaticon.com/512/3003/3003984.png' }}
            style={styles.logo}
          />
        </View>
        <Text style={styles.title}>The Cá»‘c</Text>
        <Text style={styles.subtitle}>Váº­n hÃ nh cá»­a hÃ ng ná»™i bá»™</Text>
      </View>

      <View style={styles.formCard}>
        <Text style={styles.welcome}>ÄÄƒng nháº­p</Text>
        <Text style={styles.formCaption}>Sá»­ dá»¥ng tÃ i khoáº£n Ä‘Ã£ Ä‘Æ°á»£c quáº£n lÃ½ cáº¥p.</Text>

        {dataError ? (
          <TouchableOpacity style={styles.errorBox} onPress={refreshData}>
            <Ionicons name="cloud-offline-outline" size={20} color="#b91c1c" />
            <Text style={styles.errorText}>{dataError}{'\n'}Cháº¡m Ä‘á»ƒ thá»­ táº£i láº¡i.</Text>
          </TouchableOpacity>
        ) : null}

        <Text style={styles.label}>Sá»‘ Ä‘iá»‡n thoáº¡i</Text>
        <View style={styles.inputBox}>
          <Ionicons name="call-outline" size={20} color="#64748b" />
          <TextInput
            style={styles.input}
            placeholder="Nháº­p sá»‘ Ä‘iá»‡n thoáº¡i"
            placeholderTextColor="#94a3b8"
            keyboardType="phone-pad"
            autoComplete="tel"
            value={phone}
            onChangeText={setPhone}
          />
        </View>

        <Text style={styles.label}>Máº­t kháº©u</Text>
        <View style={styles.inputBox}>
          <Ionicons name="lock-closed-outline" size={20} color="#64748b" />
          <TextInput
            style={styles.input}
            placeholder="Nháº­p máº­t kháº©u"
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
            : <Text style={styles.buttonText}>ÄÄƒng nháº­p</Text>}
        </TouchableOpacity>
      </View>

      <Text style={styles.footer}>
        Dá»¯ liá»‡u váº­n hÃ nh Ä‘Æ°á»£c Ä‘á»“ng bá»™ báº£o máº­t qua Supabase.{'\n'}
        {Updates.updateId ? `PhiÃªn báº£n: v${Constants?.expoConfig?.version || '2.0.0'} (OTA: ${Updates.updateId.substring(0,8)})` : `PhiÃªn báº£n: v${Constants?.expoConfig?.version || '2.0.0'} (Gá»‘c)`}
      </Text>
    </KeyboardAvoidingView>
  );
}

const getStyles = (COLORS) => StyleSheet.create({
  container: { flex: 1, justifyContent: 'center', padding: 20, backgroundColor: COLORS.bg },
  brand: { alignItems: 'center', marginBottom: 25 },
  logoBox: { width: 86, height: 86, borderRadius: 25, backgroundColor: COLORS.card, alignItems: 'center', justifyContent: 'center', shadowColor: '#0f172a', shadowOpacity: 0.08, shadowRadius: 10, elevation: 3 },
  logo: { width: 62, height: 62 },
  title: { fontSize: 30, fontWeight: '900', color: COLORS.primary, marginTop: 13 },
  subtitle: { color: COLORS.textMuted, marginTop: 3 },
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
