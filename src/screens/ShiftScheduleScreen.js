import React, { useState, useContext } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, SafeAreaView, RefreshControl, Dimensions, Alert } from 'react-native';
import { AppContext } from '../context/AppContext';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../services/supabaseClient';

export default function ShiftScheduleScreen({ navigation }) {
  const { currentUser, shiftRegistrations, setShiftRegistrations, storeList, staffList, refreshData, isDataLoading } = useContext(AppContext);
  
  const myStoreId = currentUser?.store_id;
  const isManagerOrOwner = currentUser?.role === 'MANAGER' || currentUser?.role === 'OWNER';

  const [activeTab, setActiveTab] = useState('SCHEDULE');
  const [weekOffset, setWeekOffset] = useState(0);
  const [draftShifts, setDraftShifts] = useState([]); // [{date, shiftType}]
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Lấy danh sách 7 ngày (Thứ 2 - Chủ Nhật) của tuần được chọn
  const getWeekDates = (offset) => {
    const curr = new Date();
    const first = curr.getDate() - curr.getDay() + (curr.getDay() === 0 ? -6 : 1) + (offset * 7);
    const monday = new Date(curr.setDate(first));
    
    return Array.from({length: 7}, (_, i) => {
      const d = new Date(monday);
      d.setDate(monday.getDate() + i);
      const year = d.getFullYear();
      const month = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      return `${year}-${month}-${day}`;
    });
  };

  const weekDates = getWeekDates(weekOffset);

  const getDayName = (dateString) => {
    const d = new Date(dateString);
    const days = ['Chủ Nhật', 'Thứ 2', 'Thứ 3', 'Thứ 4', 'Thứ 5', 'Thứ 6', 'Thứ 7'];
    const dd = String(d.getDate()).padStart(2, '0');
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    return `${days[d.getDay()]} (${dd}/${mm})`;
  };

  // Lấy số lượng người đã đăng ký trong 1 ca (đã gửi)
  const getShiftRegistrations = (date, shiftType) => {
    return shiftRegistrations.filter(r => r.date === date && r.shift_type === shiftType && r.store_id === myStoreId && r.status === 'APPROVED');
  };

  // =====================
  // ĐĂNG KÝ CA (GIỎ HÀNG)
  // =====================
  const handleToggleDraft = (date, shiftType) => {
    const isDrafted = draftShifts.find(d => d.date === date && d.shiftType === shiftType);
    
    if (isDrafted) {
      // Bỏ chọn
      setDraftShifts(draftShifts.filter(d => !(d.date === date && d.shiftType === shiftType)));
      return;
    }

    // Kiểm tra giới hạn 4 người (chỉ cần kiểm tra số người đã đăng ký trên server)
    const currentRegs = getShiftRegistrations(date, shiftType);
    if (currentRegs.length >= 4) {
      Alert.alert('Lỗi', 'Ca này đã đủ 4 người, vui lòng chọn ca khác!');
      return;
    }

    // Kiểm tra sức khỏe (không làm 2 ca/ngày)
    const myShiftsThatDay = shiftRegistrations.filter(r => r.user_id === currentUser.id && r.date === date && r.status === 'APPROVED');
    const myDraftsThatDay = draftShifts.filter(d => d.date === date);
    
    if (myShiftsThatDay.length + myDraftsThatDay.length >= 1) {
      Alert.alert('Cảnh báo', 'Mỗi ngày bạn chỉ được đăng ký tối đa 1 ca làm việc!');
      return;
    }

    setDraftShifts([...draftShifts, { date, shiftType }]);
  };

  const handleSubmitDrafts = async () => {
    if (draftShifts.length === 0) return;
    setIsSubmitting(true);

    const newRegs = draftShifts.map((draft, index) => ({
      id: `reg_${Date.now()}_${index}`,
      user_id: currentUser.id,
      store_id: myStoreId,
      date: draft.date,
      shift_type: draft.shiftType,
      status: 'APPROVED'
    }));

    try {
      const { error } = await supabase.from('shift_registrations').insert(newRegs);
      if (error) throw error;
      
      setShiftRegistrations([...shiftRegistrations, ...newRegs]);
      setDraftShifts([]); // Xóa giỏ hàng
      Alert.alert('Thành công', `Đã gửi thành công ${newRegs.length} ca làm việc!`);
    } catch (e) {
      Alert.alert('Lỗi gửi đăng ký', e.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  // =====================
  // QUẢN LÝ XÓA CA NHÂN VIÊN
  // =====================
  const handleManagerDeleteShift = (regId, staffName) => {
    if (!isManagerOrOwner) return;
    Alert.alert(
      'Xóa Ca Làm Việc',
      `Bạn có chắc muốn xóa ca của nhân viên ${staffName} không?`,
      [
        { text: 'Hủy', style: 'cancel' },
        { 
          text: 'Xóa', 
          style: 'destructive',
          onPress: async () => {
            try {
              await supabase.from('shift_registrations').delete().eq('id', regId);
              setShiftRegistrations(shiftRegistrations.filter(r => r.id !== regId));
              Alert.alert('Thành công', 'Đã xóa ca nhân viên!');
            } catch (e) {
              Alert.alert('Lỗi xóa ca', e.message);
            }
          }
        }
      ]
    );
  };

  const renderStaffRegister = () => (
    <View style={{flex: 1}}>
      <ScrollView 
        showsVerticalScrollIndicator={false} 
        contentContainerStyle={{paddingBottom: 100}}
        refreshControl={<RefreshControl refreshing={isDataLoading} onRefresh={refreshData} />}
      >
        <Text style={styles.sectionTitle}>Đăng ký lịch làm việc (Tối đa 4 người/ca)</Text>
        
        <View style={styles.weekSelector}>
          <TouchableOpacity style={styles.weekBtn} onPress={() => setWeekOffset(weekOffset - 1)}>
            <Ionicons name="chevron-back" size={24} color="#1976d2" />
          </TouchableOpacity>
          <Text style={styles.weekText}>{weekOffset === 0 ? 'Tuần này' : weekOffset === 1 ? 'Tuần sau' : weekOffset === -1 ? 'Tuần trước' : `Cách đây ${Math.abs(weekOffset)} tuần`}</Text>
          <TouchableOpacity style={styles.weekBtn} onPress={() => setWeekOffset(weekOffset + 1)}>
            <Ionicons name="chevron-forward" size={24} color="#1976d2" />
          </TouchableOpacity>
        </View>

        {weekDates.map(date => {
          const morningRegs = getShiftRegistrations(date, 'MORNING');
          const afternoonRegs = getShiftRegistrations(date, 'AFTERNOON');
          
          const myMorningSubmitted = morningRegs.find(r => r.user_id === currentUser.id);
          const myAfternoonSubmitted = afternoonRegs.find(r => r.user_id === currentUser.id);
          
          const myMorningDraft = draftShifts.find(d => d.date === date && d.shiftType === 'MORNING');
          const myAfternoonDraft = draftShifts.find(d => d.date === date && d.shiftType === 'AFTERNOON');

          const morningFull = morningRegs.length >= 4;
          const afternoonFull = afternoonRegs.length >= 4;

          return (
            <View key={date} style={styles.card}>
              <Text style={styles.dateText}>{getDayName(date)}</Text>
              <View style={styles.shiftRow}>
                {/* CA SÁNG */}
                {myMorningSubmitted ? (
                  <View style={[styles.shiftBtn, styles.shiftSubmitted]}>
                    <Text style={[styles.shiftBtnText, styles.textWhite]}>SÁNG (Đã Gửi 🔒)</Text>
                  </View>
                ) : (
                  <TouchableOpacity 
                    style={[styles.shiftBtn, myMorningDraft ? styles.shiftDrafted : (morningFull ? styles.shiftFull : {})]} 
                    onPress={() => handleToggleDraft(date, 'MORNING')}
                    disabled={morningFull && !myMorningDraft}
                  >
                    <Text style={[styles.shiftBtnText, myMorningDraft ? styles.textWhite : (morningFull ? styles.textFull : {})]}>
                      {myMorningDraft ? 'SÁNG (Đang chọn)' : (morningFull ? 'SÁNG (Đã kín chỗ)' : `SÁNG (${morningRegs.length}/4)`)}
                    </Text>
                  </TouchableOpacity>
                )}
                
                {/* CA CHIỀU */}
                {myAfternoonSubmitted ? (
                  <View style={[styles.shiftBtn, styles.shiftSubmitted]}>
                    <Text style={[styles.shiftBtnText, styles.textWhite]}>CHIỀU (Đã Gửi 🔒)</Text>
                  </View>
                ) : (
                  <TouchableOpacity 
                    style={[styles.shiftBtn, myAfternoonDraft ? styles.shiftDrafted : (afternoonFull ? styles.shiftFull : {})]} 
                    onPress={() => handleToggleDraft(date, 'AFTERNOON')}
                    disabled={afternoonFull && !myAfternoonDraft}
                  >
                    <Text style={[styles.shiftBtnText, myAfternoonDraft ? styles.textWhite : (afternoonFull ? styles.textFull : {})]}>
                      {myAfternoonDraft ? 'CHIỀU (Đang chọn)' : (afternoonFull ? 'CHIỀU (Đã kín chỗ)' : `CHIỀU (${afternoonRegs.length}/4)`)}
                    </Text>
                  </TouchableOpacity>
                )}
              </View>
            </View>
          );
        })}
      </ScrollView>

      {/* FOOTER GỬI ĐĂNG KÝ */}
      {draftShifts.length > 0 && (
        <View style={styles.footerContainer}>
          <TouchableOpacity style={styles.submitBtn} onPress={handleSubmitDrafts} disabled={isSubmitting}>
            <Text style={styles.submitBtnText}>{isSubmitting ? 'ĐANG GỬI...' : `GỬI ĐĂNG KÝ (${draftShifts.length} CA)`}</Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );

  // =====================
  // LỊCH TỔNG (OVERVIEW)
  // =====================
  const renderScheduleOverview = () => (
    <ScrollView 
      showsVerticalScrollIndicator={false} 
      contentContainerStyle={{paddingBottom: 80}}
      refreshControl={<RefreshControl refreshing={isDataLoading} onRefresh={refreshData} />}
    >
      <Text style={styles.sectionTitle}>Lịch Tổng Chi Nhánh {myStoreId === 'ALL' ? '(Tất cả)' : myStoreId}</Text>
      <Text style={{color: '#666', marginBottom: 15, fontStyle: 'italic'}}>{isManagerOrOwner ? '* Nhấn vào tên nhân viên để Xóa ca' : ''}</Text>

      <View style={styles.weekSelector}>
        <TouchableOpacity style={styles.weekBtn} onPress={() => setWeekOffset(weekOffset - 1)}>
          <Ionicons name="chevron-back" size={24} color="#1976d2" />
        </TouchableOpacity>
        <Text style={styles.weekText}>{weekOffset === 0 ? 'Tuần này' : weekOffset === 1 ? 'Tuần sau' : weekOffset === -1 ? 'Tuần trước' : `Cách đây ${Math.abs(weekOffset)} tuần`}</Text>
        <TouchableOpacity style={styles.weekBtn} onPress={() => setWeekOffset(weekOffset + 1)}>
          <Ionicons name="chevron-forward" size={24} color="#1976d2" />
        </TouchableOpacity>
      </View>

      {weekDates.map(date => {
        const morningRegs = getShiftRegistrations(date, 'MORNING');
        const afternoonRegs = getShiftRegistrations(date, 'AFTERNOON');

        const getStaffName = (userId) => {
          const staff = staffList.find(s => s.id === userId);
          return staff ? staff.name : 'Unknown';
        };

        return (
          <View key={date} style={styles.overviewCard}>
            <Text style={styles.overviewDate}>{getDayName(date)}</Text>
            
            <View style={styles.overviewShiftContainer}>
              <View style={styles.overviewShiftCol}>
                <View style={[styles.shiftHeader, {backgroundColor: '#e3f2fd'}]}>
                  <Text style={styles.shiftHeaderTitle}>CA SÁNG</Text>
                  <Text style={styles.shiftHeaderCount}>{morningRegs.length}/4</Text>
                </View>
                <View style={styles.shiftStaffList}>
                  {morningRegs.length === 0 ? <Text style={styles.emptyStaff}>Chưa có ai</Text> : null}
                  {morningRegs.map(r => (
                    <TouchableOpacity key={r.id} onPress={() => handleManagerDeleteShift(r.id, getStaffName(r.user_id))} disabled={!isManagerOrOwner}>
                      <Text style={[styles.staffItem, isManagerOrOwner && {color: '#d32f2f', textDecorationLine: 'underline'}]}>• {getStaffName(r.user_id)}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>

              <View style={styles.verticalDivider} />

              <View style={styles.overviewShiftCol}>
                <View style={[styles.shiftHeader, {backgroundColor: '#fff3e0'}]}>
                  <Text style={[styles.shiftHeaderTitle, {color: '#e65100'}]}>CA CHIỀU</Text>
                  <Text style={[styles.shiftHeaderCount, {color: '#e65100'}]}>{afternoonRegs.length}/4</Text>
                </View>
                <View style={styles.shiftStaffList}>
                  {afternoonRegs.length === 0 ? <Text style={styles.emptyStaff}>Chưa có ai</Text> : null}
                  {afternoonRegs.map(r => (
                    <TouchableOpacity key={r.id} onPress={() => handleManagerDeleteShift(r.id, getStaffName(r.user_id))} disabled={!isManagerOrOwner}>
                      <Text style={[styles.staffItem, isManagerOrOwner && {color: '#d32f2f', textDecorationLine: 'underline'}]}>• {getStaffName(r.user_id)}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>
            </View>
          </View>
        );
      })}
    </ScrollView>
  );

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.headerRow}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={24} color="#1976d2" />
        </TouchableOpacity>
        <Text style={styles.header}>Quản lý Lịch Làm Việc</Text>
      </View>

      <View style={styles.tabContainer}>
        <TouchableOpacity style={[styles.tabBtn, activeTab === 'SCHEDULE' && styles.tabBtnActive]} onPress={() => setActiveTab('SCHEDULE')}>
          <Text style={[styles.tabText, activeTab === 'SCHEDULE' && styles.tabTextActive]}>Lịch Tổng</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.tabBtn, activeTab === 'REGISTER' && styles.tabBtnActive]} onPress={() => setActiveTab('REGISTER')}>
          <Text style={[styles.tabText, activeTab === 'REGISTER' && styles.tabTextActive]}>Đăng Ký Ca</Text>
        </TouchableOpacity>
      </View>

      <View style={{flex: 1, paddingHorizontal: 20}}>
        {activeTab === 'SCHEDULE' && renderScheduleOverview()}
        {activeTab === 'REGISTER' && renderStaffRegister()}
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
  weekSelector: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: '#e3f2fd', padding: 10, borderRadius: 8, marginBottom: 15 },
  weekBtn: { padding: 5 },
  weekText: { fontSize: 16, fontWeight: 'bold', color: '#1976d2' },
  dateText: { fontSize: 16, fontWeight: 'bold', color: '#333', marginBottom: 10 },
  shiftRow: { flexDirection: 'row', gap: 10 },
  shiftBtn: { flex: 1, borderWidth: 1, borderColor: '#1976d2', padding: 12, borderRadius: 8, alignItems: 'center' },
  shiftDrafted: { backgroundColor: '#1976d2' },
  shiftSubmitted: { backgroundColor: '#4CAF50', borderColor: '#4CAF50' },
  shiftFull: { backgroundColor: '#f5f5f5', borderColor: '#ccc' },
  shiftBtnText: { color: '#1976d2', fontWeight: 'bold', fontSize: 13 },
  textWhite: { color: '#fff' },
  textFull: { color: '#aaa' },
  
  footerContainer: { position: 'absolute', bottom: 10, left: 0, right: 0 },
  submitBtn: { backgroundColor: '#e91e63', padding: 15, borderRadius: 10, alignItems: 'center', elevation: 3 },
  submitBtnText: { color: '#fff', fontWeight: 'bold', fontSize: 16 },

  // Lịch Tổng styles
  overviewCard: { backgroundColor: '#fff', borderRadius: 10, marginBottom: 15, elevation: 2, overflow: 'hidden' },
  overviewDate: { fontSize: 16, fontWeight: 'bold', color: '#fff', backgroundColor: '#1976d2', padding: 10, textAlign: 'center' },
  overviewShiftContainer: { flexDirection: 'row', minHeight: 100 },
  overviewShiftCol: { flex: 1, padding: 0 },
  shiftHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 10, borderBottomWidth: 1, borderBottomColor: '#eee' },
  shiftHeaderTitle: { fontWeight: 'bold', color: '#1976d2', fontSize: 13 },
  shiftHeaderCount: { fontWeight: 'bold', color: '#1976d2', fontSize: 14, backgroundColor: 'rgba(255,255,255,0.7)', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 10, overflow: 'hidden' },
  shiftStaffList: { padding: 10 },
  staffItem: { fontSize: 14, color: '#333', marginBottom: 10, paddingVertical: 5 },
  emptyStaff: { fontSize: 14, color: '#aaa', fontStyle: 'italic', textAlign: 'center', marginTop: 10 },
  verticalDivider: { width: 1, backgroundColor: '#eee' }
});
