import React, { useState, useContext } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, SafeAreaView, FlatList, Alert } from 'react-native';
import { AppContext } from '../../App';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../services/supabaseClient';

export default function ShiftScheduleScreen({ navigation }) {
  const { currentUser, shiftRegistrations, setShiftRegistrations, storeList, staffList } = useContext(AppContext);
  
  const isManagerOrOwner = currentUser?.role === 'MANAGER' || currentUser?.role === 'OWNER';
  const myStoreId = currentUser?.store_id;

  const [activeTab, setActiveTab] = useState(isManagerOrOwner ? 'APPROVAL' : 'REGISTER');

  // Helpers for dates
  const today = new Date();
  const nextDates = Array.from({length: 7}, (_, i) => {
    const d = new Date();
    d.setDate(today.getDate() + i + 1); // Start from tomorrow
    return d.toISOString().split('T')[0]; // YYYY-MM-DD
  });

  // =====================
  // STAFF: ĐĂNG KÝ CA
  // =====================
  const handleRegisterShift = async (date, shiftType) => {
    if (isManagerOrOwner) return; // Manager should just see or they can register if needed
    
    // Kiểm tra đã đăng ký chưa
    const existing = shiftRegistrations.find(r => r.user_id === currentUser.id && r.date === date && r.shift_type === shiftType);
    if (existing) {
      alert('Bạn đã đăng ký ca này rồi!');
      return;
    }

    const newReg = {
      id: `reg_${Date.now()}_${Math.floor(Math.random()*1000)}`,
      user_id: currentUser.id,
      store_id: myStoreId,
      date: date,
      shift_type: shiftType,
      status: 'PENDING'
    };

    try {
      await supabase.from('shift_registrations').insert([newReg]);
      setShiftRegistrations([...shiftRegistrations, newReg]);
      alert(`Đã đăng ký ${shiftType === 'MORNING' ? 'Ca Sáng' : 'Ca Chiều'} ngày ${date}`);
    } catch (e) {
      alert('Lỗi đăng ký ca: ' + e.message);
    }
  };

  const renderStaffRegister = () => (
    <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{paddingBottom: 80}}>
      <Text style={styles.sectionTitle}>Đăng ký lịch làm việc (7 ngày tới)</Text>
      {nextDates.map(date => {
        const myMorning = shiftRegistrations.find(r => r.user_id === currentUser.id && r.date === date && r.shift_type === 'MORNING');
        const myAfternoon = shiftRegistrations.find(r => r.user_id === currentUser.id && r.date === date && r.shift_type === 'AFTERNOON');
        return (
          <View key={date} style={styles.card}>
            <Text style={styles.dateText}>Ngày: {date}</Text>
            <View style={styles.shiftRow}>
              <TouchableOpacity 
                style={[styles.shiftBtn, myMorning ? styles.shiftRegistered : {}]} 
                onPress={() => handleRegisterShift(date, 'MORNING')}
                disabled={!!myMorning}
              >
                <Text style={[styles.shiftBtnText, myMorning ? styles.textWhite : {}]}>
                  {myMorning ? (myMorning.status === 'APPROVED' ? 'SÁNG (Đã Duyệt)' : 'SÁNG (Chờ duyệt)') : 'SÁNG (06:00-14:00)'}
                </Text>
              </TouchableOpacity>
              
              <TouchableOpacity 
                style={[styles.shiftBtn, myAfternoon ? styles.shiftRegistered : {}]} 
                onPress={() => handleRegisterShift(date, 'AFTERNOON')}
                disabled={!!myAfternoon}
              >
                <Text style={[styles.shiftBtnText, myAfternoon ? styles.textWhite : {}]}>
                  {myAfternoon ? (myAfternoon.status === 'APPROVED' ? 'CHIỀU (Đã Duyệt)' : 'CHIỀU (Chờ duyệt)') : 'CHIỀU (14:00-22:00)'}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        );
      })}
    </ScrollView>
  );

  // =====================
  // MANAGER: DUYỆT CA
  // =====================
  const handleApprove = async (regId, newStatus) => {
    try {
      await supabase.from('shift_registrations').update({ status: newStatus }).eq('id', regId);
      setShiftRegistrations(shiftRegistrations.map(r => r.id === regId ? {...r, status: newStatus} : r));
      alert(`Đã ${newStatus === 'APPROVED' ? 'Duyệt' : 'Từ chối'} ca làm việc.`);
    } catch (e) {
      alert('Lỗi cập nhật: ' + e.message);
    }
  };

  const renderManagerApproval = () => {
    const pendingRegs = shiftRegistrations.filter(r => r.status === 'PENDING' && (currentUser.role === 'OWNER' || r.store_id === myStoreId));
    
    if (pendingRegs.length === 0) {
      return <Text style={{textAlign: 'center', marginTop: 50, color: '#666'}}>Không có đăng ký ca nào cần duyệt.</Text>;
    }

    return (
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{paddingBottom: 80}}>
        <Text style={styles.sectionTitle}>Danh sách nhân viên xin xếp ca</Text>
        {pendingRegs.map(reg => {
          const staff = staffList.find(s => s.id === reg.user_id);
          return (
            <View key={reg.id} style={styles.card}>
              <Text style={styles.staffName}>{staff?.name || 'Nhân viên'} <Text style={{fontSize: 12, fontWeight: 'normal'}}>- Chi nhánh {storeList.find(s=>s.id === reg.store_id)?.name}</Text></Text>
              <Text style={{color: '#555', marginBottom: 10}}>Muốn làm: {reg.shift_type === 'MORNING' ? 'CA SÁNG (06-14h)' : 'CA CHIỀU (14-22h)'} ngày {reg.date}</Text>
              <View style={{flexDirection: 'row', gap: 10}}>
                <TouchableOpacity style={[styles.actionBtn, {backgroundColor: '#F44336'}]} onPress={() => handleApprove(reg.id, 'REJECTED')}>
                  <Text style={styles.textWhite}>Từ chối</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[styles.actionBtn, {backgroundColor: '#4CAF50'}]} onPress={() => handleApprove(reg.id, 'APPROVED')}>
                  <Text style={styles.textWhite}>Duyệt Ca</Text>
                </TouchableOpacity>
              </View>
            </View>
          );
        })}
      </ScrollView>
    );
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.headerRow}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={24} color="#1976d2" />
        </TouchableOpacity>
        <Text style={styles.header}>Quản lý Lịch Làm Việc</Text>
      </View>

      <View style={styles.tabContainer}>
        {isManagerOrOwner && (
          <TouchableOpacity style={[styles.tabBtn, activeTab === 'APPROVAL' && styles.tabBtnActive]} onPress={() => setActiveTab('APPROVAL')}>
            <Text style={[styles.tabText, activeTab === 'APPROVAL' && styles.tabTextActive]}>Duyệt Ca</Text>
          </TouchableOpacity>
        )}
        <TouchableOpacity style={[styles.tabBtn, activeTab === 'REGISTER' && styles.tabBtnActive]} onPress={() => setActiveTab('REGISTER')}>
          <Text style={[styles.tabText, activeTab === 'REGISTER' && styles.tabTextActive]}>Đăng Ký Ca</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.tabBtn, activeTab === 'SCHEDULE' && styles.tabBtnActive]} onPress={() => setActiveTab('SCHEDULE')}>
          <Text style={[styles.tabText, activeTab === 'SCHEDULE' && styles.tabTextActive]}>Lịch Tổng</Text>
        </TouchableOpacity>
      </View>

      <View style={{flex: 1, paddingHorizontal: 20}}>
        {activeTab === 'REGISTER' && renderStaffRegister()}
        {activeTab === 'APPROVAL' && renderManagerApproval()}
        {activeTab === 'SCHEDULE' && (
          <View style={{flex: 1, justifyContent: 'center', alignItems: 'center'}}>
            <Ionicons name="calendar" size={60} color="#ccc" />
            <Text style={{color: '#888', marginTop: 10}}>Tính năng xem Lịch dạng Bảng đang được phát triển.</Text>
          </View>
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f0f2f5' },
  headerRow: { flexDirection: 'row', alignItems: 'center', padding: 20, paddingBottom: 10 },
  backBtn: { padding: 5, marginRight: 10 },
  header: { fontSize: 22, fontWeight: 'bold', color: '#1f2937' },
  tabContainer: { flexDirection: 'row', backgroundColor: '#e5e7eb', borderRadius: 8, marginHorizontal: 20, marginBottom: 15, padding: 4 },
  tabBtn: { flex: 1, paddingVertical: 10, alignItems: 'center', borderRadius: 6 },
  tabBtnActive: { backgroundColor: '#fff', elevation: 2 },
  tabText: { fontWeight: 'bold', color: '#6b7280' },
  tabTextActive: { color: '#1976d2' },
  sectionTitle: { fontSize: 16, fontWeight: 'bold', color: '#1976d2', marginBottom: 15 },
  card: { backgroundColor: '#fff', padding: 15, borderRadius: 10, marginBottom: 15, elevation: 2 },
  dateText: { fontSize: 16, fontWeight: 'bold', color: '#333', marginBottom: 10 },
  shiftRow: { flexDirection: 'row', gap: 10 },
  shiftBtn: { flex: 1, borderWidth: 1, borderColor: '#1976d2', padding: 12, borderRadius: 8, alignItems: 'center' },
  shiftRegistered: { backgroundColor: '#1976d2' },
  shiftBtnText: { color: '#1976d2', fontWeight: 'bold', fontSize: 13 },
  textWhite: { color: '#fff' },
  staffName: { fontSize: 16, fontWeight: 'bold', color: '#e91e63', marginBottom: 5 },
  actionBtn: { flex: 1, padding: 12, borderRadius: 8, alignItems: 'center' }
});
