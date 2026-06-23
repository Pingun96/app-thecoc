import React, { useState, useContext } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, Image } from 'react-native';
import { AppContext } from '../../App';

export default function LoginScreen({ navigation }) {
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const { staffList, setCurrentUser } = useContext(AppContext);

  const handleLogin = () => {
    // 1. Quản trị viên tối cao (Chủ hệ thống)
    if (phone === '0900000000' && password === '123') {
      setCurrentUser({ id: 'owner_1', name: 'Chủ Cửa Hàng', role: 'OWNER', store_id: null });
      navigation.replace('Dashboard');
      return;
    }

    // 2. Nhân viên & Quản lý (Từ Database/State)
    const user = staffList.find(s => s.phone === phone);
    if (user) {
      if (password === '123') {
        if (user.hasAppAccess === false) {
          alert('Tài khoản của bạn chưa được cấp quyền truy cập ứng dụng!');
          return;
        }
        // Gán Role nếu chưa có (Backup)
        setCurrentUser({ ...user, role: user.role || 'STAFF' });
        navigation.replace('Dashboard');
      } else {
        alert('Mật khẩu không đúng!');
      }
    } else {
      alert('Không tìm thấy số điện thoại trong hệ thống!');
    }
  };

  return (
    <View style={styles.container}>
      <Image 
        source={{ uri: 'https://cdn-icons-png.flaticon.com/512/3003/3003984.png' }} 
        style={styles.logo} 
      />
      <Text style={styles.title}>The Cốc - Internal App</Text>
      
      <TextInput 
        style={styles.input} 
        placeholder="Số điện thoại" 
        keyboardType="phone-pad"
        value={phone}
        onChangeText={setPhone}
      />
      <TextInput 
        style={styles.input} 
        placeholder="Mật khẩu" 
        secureTextEntry 
        value={password}
        onChangeText={setPassword}
      />
      
      <TouchableOpacity style={styles.button} onPress={handleLogin}>
        <Text style={styles.buttonText}>ĐĂNG NHẬP</Text>
      </TouchableOpacity>

      <Text style={styles.hintText}>
        Mẹo: {'\n'}
        Chủ (0900000000) - Pass 123 {'\n'}
        Quản lý (0907654321) - Pass 123 {'\n'}
        Nhân viên A (0901112223) - Pass 123 {'\n'}
        Nhân viên B (0901112224) - Bị khóa quyền
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: 'center', padding: 20, backgroundColor: '#fff' },
  logo: { width: 100, height: 100, alignSelf: 'center', marginBottom: 20 },
  title: { fontSize: 24, fontWeight: 'bold', textAlign: 'center', marginBottom: 40, color: '#4CAF50' },
  input: { borderWidth: 1, borderColor: '#ccc', padding: 15, borderRadius: 10, marginBottom: 15, fontSize: 16 },
  button: { backgroundColor: '#4CAF50', padding: 15, borderRadius: 10, alignItems: 'center' },
  buttonText: { color: '#fff', fontSize: 18, fontWeight: 'bold' },
  hintText: { marginTop: 30, color: '#888', textAlign: 'center', lineHeight: 22 }
});
