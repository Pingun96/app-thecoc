import React, { useState, useContext } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, TextInput } from 'react-native';
import { AppContext } from '../../App';

export default function OwnerDashboardScreen({ navigation }) {
  const { staffList, setStaffList, storeList, selectedStoreId, setSelectedStoreId } = useContext(AppContext);

  const updateStaffWage = (id, newWageStr) => {
    const newWage = Number(newWageStr);
    if (!newWage) return;
    
    setStaffList(staffList.map(staff => 
      staff.id === id ? { ...staff, wage: newWage } : staff
    ));
    alert('Đã cập nhật lương nhân viên thành công!');
  };

  const currentStaffList = staffList.filter(s => selectedStoreId === 'ALL' || s.store_id === selectedStoreId);

  return (
    <ScrollView style={styles.container}>
      <Text style={styles.header}>Bảng Điều Khiển - CHỦ HỆ THỐNG</Text>

      {/* CHỌN CỬA HÀNG */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.storeSelector}>
        <TouchableOpacity 
          style={[styles.storeChip, selectedStoreId === 'ALL' && styles.storeChipActive]} 
          onPress={() => setSelectedStoreId('ALL')}
        >
          <Text style={[styles.storeChipText, selectedStoreId === 'ALL' && styles.storeChipTextActive]}>Tất cả Chi nhánh</Text>
        </TouchableOpacity>
        {storeList.map(store => (
          <TouchableOpacity 
            key={store.id}
            style={[styles.storeChip, selectedStoreId === store.id && styles.storeChipActive]} 
            onPress={() => setSelectedStoreId(store.id)}
          >
            <Text style={[styles.storeChipText, selectedStoreId === store.id && styles.storeChipTextActive]}>{store.name}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      {/* LỐI TẮT QUẢN LÝ NHÂN SỰ */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Nhân Sự & Tiền Lương</Text>
        <Text style={{ color: '#666', marginBottom: 15 }}>Quản lý danh sách nhân viên, tài khoản đăng nhập và cài đặt mức lương theo giờ cho từng người.</Text>
        <TouchableOpacity style={styles.hrBtn} onPress={() => navigation.navigate('StaffManagement')}>
          <Text style={styles.btnText}>Truy Cập Quản Lý Nhân Sự</Text>
        </TouchableOpacity>
      </View>

      {/* TỔNG QUAN DOANH THU */}
      <View style={[styles.section, { backgroundColor: '#2196F3' }]}>
        <Text style={[styles.sectionTitle, { color: '#fff' }]}>DOANH THU HÔM NAY (Đã đồng bộ)</Text>
        <Text style={styles.revenueText}>4,250,000 VNĐ</Text>
        <Text style={styles.compareText}>↑ Tăng 12% so với hôm qua</Text>
      </View>

      {/* BIỂU ĐỒ MÔ PHỎNG */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Biểu Đồ Doanh Thu 7 Ngày Qua</Text>
        <View style={styles.chartContainer}>
          <View style={styles.barContainer}><View style={[styles.bar, { height: 60 }]} /><Text>T2</Text></View>
          <View style={styles.barContainer}><View style={[styles.bar, { height: 80 }]} /><Text>T3</Text></View>
          <View style={styles.barContainer}><View style={[styles.bar, { height: 50 }]} /><Text>T4</Text></View>
          <View style={styles.barContainer}><View style={[styles.bar, { height: 90 }]} /><Text>T5</Text></View>
          <View style={styles.barContainer}><View style={[styles.bar, { height: 120 }]} /><Text>T6</Text></View>
          <View style={styles.barContainer}><View style={[styles.bar, { height: 150 }]} /><Text>T7</Text></View>
          <View style={styles.barContainer}><View style={[styles.bar, { height: 140 }]} /><Text>CN</Text></View>
        </View>
      </View>

      {/* LỐI TẮT */}
      <View style={styles.grid}>
        <TouchableOpacity style={styles.gridItem}>
          <Text style={styles.gridIcon}>📦</Text>
          <Text style={styles.gridText}>Kho / Nguyên liệu</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.gridItem}>
          <Text style={styles.gridIcon}>👥</Text>
          <Text style={styles.gridText}>Quản lý Nhân sự</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.gridItem} onPress={() => navigation.navigate('ManagerDashboard')}>
          <Text style={styles.gridIcon}>📝</Text>
          <Text style={styles.gridText}>Duyệt Báo Cáo</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.gridItem}>
          <Text style={styles.gridIcon}>⚙️</Text>
          <Text style={styles.gridText}>Cài Đặt</Text>
        </TouchableOpacity>
      </View>

      <TouchableOpacity style={styles.logoutBtn} onPress={() => navigation.replace('Login')}>
        <Text style={styles.btnText}>Đăng Xuất</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f0f2f5', padding: 20 },
  header: { fontSize: 24, fontWeight: 'bold', color: '#1f2937', marginBottom: 20, marginTop: 40 },
  section: { backgroundColor: '#fff', padding: 20, borderRadius: 12, marginBottom: 20, elevation: 3 },
  sectionTitle: { fontSize: 16, fontWeight: 'bold', marginBottom: 10, color: '#555' },
  revenueText: { fontSize: 36, fontWeight: '900', color: '#fff', marginVertical: 10 },
  compareText: { color: '#e0f2f1', fontWeight: 'bold' },
  chartContainer: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end', height: 180, paddingBottom: 20, paddingTop: 20 },
  barContainer: { alignItems: 'center' },
  bar: { width: 30, backgroundColor: '#4CAF50', borderTopLeftRadius: 5, borderTopRightRadius: 5, marginBottom: 5 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', marginBottom: 20 },
  gridItem: { width: '48%', backgroundColor: '#fff', padding: 20, borderRadius: 12, alignItems: 'center', marginBottom: 15, elevation: 2 },
  gridIcon: { fontSize: 32, marginBottom: 10 },
  gridText: { fontSize: 14, fontWeight: 'bold', color: '#444' },
  logoutBtn: { backgroundColor: '#F44336', padding: 15, borderRadius: 10, alignItems: 'center', marginBottom: 40 },
  btnText: { color: '#fff', fontWeight: 'bold' },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 10 },
  wageInput: { flex: 1, borderWidth: 1, borderColor: '#ccc', borderRadius: 5, paddingHorizontal: 10, height: 40, marginRight: 10 },
  updateBtn: { backgroundColor: '#2196F3', paddingHorizontal: 15, justifyContent: 'center', borderRadius: 5 },
  staffWageCard: { marginBottom: 15, paddingBottom: 15, borderBottomWidth: 1, borderBottomColor: '#eee' },
  staffName: { fontSize: 16, fontWeight: '600', color: '#333' },
  storeSelector: { flexDirection: 'row', marginBottom: 20 },
  storeChip: { backgroundColor: '#e0e0e0', paddingHorizontal: 15, paddingVertical: 10, borderRadius: 20, marginRight: 10, height: 40, justifyContent: 'center' },
  storeChipActive: { backgroundColor: '#1976d2' },
  storeChipText: { color: '#555', fontWeight: 'bold' },
  storeChipTextActive: { color: '#fff' },
  hrBtn: { backgroundColor: '#FF9800', padding: 15, borderRadius: 8, alignItems: 'center', marginTop: 10 }
});
