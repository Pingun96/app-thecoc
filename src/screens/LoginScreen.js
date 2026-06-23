import React, { useState, useContext } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, Alert, ActivityIndicator } from 'react-native';
import { AppContext } from '../../App';

export default function LoginScreen({ navigation }) {
  const { setCurrentUser, staffList } = useContext(AppContext);
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const handleLogin = async () => {
    if (!phone || !password) {
      alert('Vui lòng nhập số điện thoại và mật khẩu (VD: 0901234567 / 123)');
      return;
    }

    setIsLoading(true);
    // Giả lập thời gian load API
    setTimeout(() => {
      setIsLoading(false);
      
      if ((phone === '0901234567' || phone.toLowerCase() === 'admin') && password === '123') {
        setCurrentUser({ id: 'owner_1', name: 'Chủ Cửa Hàng', role: 'OWNER' });
        navigation.replace('OwnerDashboard');
      } else if (phone === '0907654321' && password === '123') {
        setCurrentUser({ id: 'manager_1', name: 'Quản Lý', role: 'MANAGER', store_id: 1 });
        navigation.replace('ManagerDashboard');
      } else {
        const staff = staffList.find(s => s.phone === phone);
        if (staff && password === '123') {
          setCurrentUser({ ...staff, role: 'STAFF' });
          navigation.replace('StaffDashboard');
        } else {
          alert('Số điện thoại hoặc mật khẩu không đúng!\n(Thử: admin/0907654321/0901112223 - pass: 123)');
        }
      }
    }, 1000);
  };

  return (
    <View style={styles.container}>
      {/* Khu vực Logo */}
      <View style={styles.logoContainer}>
        <View style={styles.logoCircle}>
          <Text style={styles.logoText}>THE CỐC</Text>
        </View>
        <Text style={styles.subtitle}>BÌNH KHÁNH</Text>
      </View>

      {/* Khu vực Form đăng nhập */}
      <View style={styles.formContainer}>
        <Text style={styles.headerTitle}>Đăng Nhập</Text>

        <TextInput
          style={styles.input}
          placeholder="Số điện thoại hoặc 'admin'"
          value={phone}
          onChangeText={setPhone}
          autoCapitalize="none"
        />

        <TextInput
          style={styles.input}
          placeholder="Mật khẩu"
          value={password}
          onChangeText={setPassword}
          secureTextEntry
        />

        <TouchableOpacity style={styles.loginBtn} onPress={handleLogin} disabled={isLoading}>
          {isLoading ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.loginText}>ĐĂNG NHẬP</Text>
          )}
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
  },
  logoContainer: {
    flex: 0.45,
    backgroundColor: '#1f2937', // Màu xám đen sang trọng làm ví dụ
    justifyContent: 'center',
    alignItems: 'center',
    borderBottomLeftRadius: 40,
    borderBottomRightRadius: 40,
  },
  logoCircle: {
    width: 120,
    height: 120,
    backgroundColor: '#fff',
    borderRadius: 60,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 5,
    elevation: 8,
  },
  logoText: {
    fontSize: 22,
    fontWeight: '900',
    color: '#1f2937',
  },
  subtitle: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '600',
    letterSpacing: 2,
  },
  formContainer: {
    flex: 0.55,
    paddingHorizontal: 30,
    paddingTop: 40,
  },
  headerTitle: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#333',
    marginBottom: 30,
  },
  input: {
    backgroundColor: '#f5f7fa',
    borderRadius: 10,
    padding: 15,
    marginBottom: 20,
    fontSize: 16,
    borderWidth: 1,
    borderColor: '#e5e7eb',
  },
  loginBtn: {
    backgroundColor: '#4CAF50', // Xanh lá cây nổi bật
    padding: 18,
    borderRadius: 10,
    alignItems: 'center',
    marginTop: 10,
    shadowColor: '#4CAF50',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 5,
    elevation: 5,
  },
  loginText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: 'bold',
    letterSpacing: 1,
  },
});
