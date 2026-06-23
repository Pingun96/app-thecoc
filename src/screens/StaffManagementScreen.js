import React, { useState, useContext } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput, Alert } from 'react-native';
import { AppContext } from '../../App';

export default function StaffManagementScreen({ navigation }) {
  const { staffList, setStaffList, storeList } = useContext(AppContext);

  // Form State
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [wage, setWage] = useState('');
  const [storeId, setStoreId] = useState(storeList[0]?.id || 1);

  const handleCreateStaff = () => {
    if (!fullName || !phone || !password || !wage) {
      alert('Vui lòng điền đầy đủ thông tin nhân viên!');
      return;
    }

    const newStaff = {
      id: `staff_${Date.now()}`,
      name: fullName,
      phone: phone,
      wage: Number(wage),
      store_id: storeId
    };

    setStaffList([...staffList, newStaff]);
    alert(`Đã tạo thành công tài khoản cho ${fullName}`);
    
    // Reset Form
    setFullName(''); setPhone(''); setPassword(''); setWage('');
  };

  return (
    <ScrollView style={styles.container}>
      <View style={styles.headerRow}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
          <Text style={styles.backText}>{'< Trở lại'}</Text>
        </TouchableOpacity>
        <Text style={styles.header}>Quản Lý Nhân Sự</Text>
      </View>

      {/* TẠO NHÂN VIÊN MỚI */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>+ THÊM NHÂN VIÊN MỚI</Text>
        
        <Text style={styles.label}>Họ và tên:</Text>
        <TextInput style={styles.input} placeholder="VD: Nguyễn Văn A" value={fullName} onChangeText={setFullName} />

        <Text style={styles.label}>Số điện thoại đăng nhập:</Text>
        <TextInput style={styles.input} placeholder="VD: 0901234567" keyboardType="phone-pad" value={phone} onChangeText={setPhone} />

        <Text style={styles.label}>Mật khẩu:</Text>
        <TextInput style={styles.input} placeholder="Mật khẩu khởi tạo" value={password} onChangeText={setPassword} secureTextEntry />

        <Text style={styles.label}>Mức lương (VNĐ/giờ):</Text>
        <TextInput style={styles.input} placeholder="VD: 25000" keyboardType="numeric" value={wage} onChangeText={setWage} />

        <Text style={styles.label}>Chi nhánh trực thuộc (Store ID):</Text>
        <View style={styles.storeSelectRow}>
          {storeList.map(store => (
            <TouchableOpacity 
              key={store.id} 
              style={[styles.storeChip, storeId === store.id && styles.storeChipActive]}
              onPress={() => setStoreId(store.id)}
            >
              <Text style={[styles.storeChipText, storeId === store.id && styles.storeChipTextActive]}>{store.name}</Text>
            </TouchableOpacity>
          ))}
        </View>

        <TouchableOpacity style={styles.createBtn} onPress={handleCreateStaff}>
          <Text style={styles.btnText}>TẠO NHÂN VIÊN</Text>
        </TouchableOpacity>
      </View>

      {/* DANH SÁCH NHÂN SỰ HIỆN TẠI */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>DANH SÁCH NHÂN SỰ</Text>
        {staffList.map(staff => (
          <View key={staff.id} style={styles.staffCard}>
            <View>
              <Text style={styles.staffName}>{staff.name}</Text>
              <Text style={styles.staffDetail}>Lương: {staff.wage.toLocaleString()}đ/h</Text>
              <Text style={styles.staffDetail}>Chi nhánh: {storeList.find(s=>s.id === staff.store_id)?.name}</Text>
            </View>
            <TouchableOpacity style={styles.editBtn}>
              <Text style={styles.editBtnText}>Sửa</Text>
            </TouchableOpacity>
          </View>
        ))}
      </View>

    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f0f2f5', padding: 20 },
  headerRow: { flexDirection: 'row', alignItems: 'center', marginTop: 30, marginBottom: 20 },
  backBtn: { padding: 10, marginRight: 10 },
  backText: { color: '#2196F3', fontSize: 16, fontWeight: 'bold' },
  header: { fontSize: 22, fontWeight: 'bold', color: '#333' },
  
  section: { backgroundColor: '#fff', padding: 20, borderRadius: 12, marginBottom: 20, elevation: 2 },
  sectionTitle: { fontSize: 16, fontWeight: 'bold', color: '#1976d2', marginBottom: 15 },
  label: { fontSize: 14, fontWeight: '600', color: '#555', marginBottom: 5, marginTop: 10 },
  input: { borderWidth: 1, borderColor: '#ccc', borderRadius: 8, padding: 12, backgroundColor: '#fafafa' },
  
  storeSelectRow: { flexDirection: 'row', marginTop: 10 },
  storeChip: { backgroundColor: '#e0e0e0', paddingHorizontal: 15, paddingVertical: 8, borderRadius: 20, marginRight: 10 },
  storeChipActive: { backgroundColor: '#4CAF50' },
  storeChipText: { color: '#555', fontWeight: 'bold' },
  storeChipTextActive: { color: '#fff' },

  createBtn: { backgroundColor: '#4CAF50', padding: 15, borderRadius: 8, alignItems: 'center', marginTop: 25 },
  btnText: { color: '#fff', fontWeight: 'bold', fontSize: 16 },

  staffCard: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 15, borderBottomWidth: 1, borderBottomColor: '#eee' },
  staffName: { fontSize: 16, fontWeight: 'bold', color: '#333', marginBottom: 5 },
  staffDetail: { color: '#666', fontSize: 13 },
  editBtn: { backgroundColor: '#e3f2fd', paddingHorizontal: 15, paddingVertical: 8, borderRadius: 20 },
  editBtnText: { color: '#1976d2', fontWeight: 'bold' }
});
