import React, { useState, useContext } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, SafeAreaView, RefreshControl, Dimensions, Alert, Modal } from 'react-native';
import { AppContext } from '../context/AppContext';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../services/supabaseClient';
import { scheduleShiftReminder, getManagersPushTokens, sendPushNotification } from '../services/NotificationService';

export default function ShiftScheduleScreen({ navigation }) {
  const { currentUser, selectedStoreId, shiftRegistrations, setShiftRegistrations, storeList, staffList, refreshData, isDataLoading } = useContext(AppContext);
  
  const isOwner = currentUser?.role === 'OWNER';
  const isManager = currentUser?.role === 'MANAGER';
  const isStaff = currentUser?.role === 'STAFF';
  const viewableStores = currentUser?.permissions?.viewable_stores || [];

  let myStoreId = currentUser?.store_id;
  if (isOwner || viewableStores.includes(selectedStoreId)) myStoreId = selectedStoreId;
  if (isOwner && selectedStoreId === 'ALL') myStoreId = 'ALL';

  const storeName = myStoreId === 'ALL'
    ? 'Tất cả chi nhánh'
    : storeList.find((store) => store.id === myStoreId)?.name || `Chi nhánh ${myStoreId || '--'}`;

  const isManagerOrOwner = isOwner || isManager;

  const [activeTab, setActiveTab] = useState('SCHEDULE');
  const [weekOffset, setWeekOffset] = useState(0);
  const [draftShifts, setDraftShifts] = useState([]); // [{date, shiftType}]
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Modal Xếp Ca
  const [showAssignModal, setShowAssignModal] = useState(false);
  const [assignTarget, setAssignTarget] = useState(null); // { date, shiftType }

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

  // Lấy số lượng người đã đăng ký trong 1 ca (đã gửi, bao gồm PENDING & APPROVED)
  const getShiftRegistrations = (date, shiftType) => {
    return shiftRegistrations.filter(r => r.date === date && r.shift_type === shiftType && r.store_id === myStoreId && (r.status === 'APPROVED' || r.status === 'PENDING'));
  };

  // Lấy số người đã DUYỆT
  const getApprovedRegistrations = (date, shiftType) => {
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

    // Kiểm tra giới hạn 4 người
    const approvedRegs = getApprovedRegistrations(date, shiftType);
    if (approvedRegs.length >= 4) {
      Alert.alert('Lỗi', 'Ca này đã đủ 4 người, vui lòng chọn ca khác!');
      return;
    }

    // Kiểm tra sức khỏe (không làm 2 ca/ngày)
    const myShiftsThatDay = shiftRegistrations.filter(r => r.user_id === currentUser.id && r.date === date && (r.status === 'APPROVED' || r.status === 'PENDING'));
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
      status: 'PENDING'
    }));

    try {
      const { error } = await supabase.from('shift_registrations').insert(newRegs);
      if (error) throw error;
      
      setShiftRegistrations([...shiftRegistrations, ...newRegs]);
      setDraftShifts([]); // Xóa giỏ hàng

      // 1. Lên lịch báo thức cho nhân viên (trước 60 phút)
      for (const draft of draftShifts) {
        await scheduleShiftReminder(draft.date, draft.shiftType, 60);
      }

      // 2. Gửi Push Notification cho Quản Lý chi nhánh
      const managerTokens = await getManagersPushTokens(myStoreId);
      for (const token of managerTokens) {
        await sendPushNotification(
          token, 
          'Lịch Làm Việc Mới', 
          `Nhân viên ${currentUser?.name} vừa gửi đăng ký ${draftShifts.length} ca làm việc. Đang chờ bạn duyệt.`
        );
      }

      Alert.alert('Thành công', `Đã gửi thành công ${newRegs.length} ca làm việc. Vui lòng chờ quản lý duyệt!`);
    } catch (e) {
      Alert.alert('Lỗi gửi đăng ký', e.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  // =====================
  // QUẢN LÝ CA LÀM VIỆC
  // =====================
  const handleManagerDeleteShift = (regId, staffName) => {
    if (!isManagerOrOwner) return;
    Alert.alert(
      'Xóa Ca Làm Việc',
      `Bạn có chắc muốn xóa ca của ${staffName} không?`,
      [
        { text: 'Hủy', style: 'cancel' },
        { 
          text: 'Xóa', 
          style: 'destructive',
          onPress: async () => {
            try {
              await supabase.from('shift_registrations').delete().eq('id', regId);
              setShiftRegistrations(shiftRegistrations.filter(r => r.id !== regId));
              Alert.alert('Thành công', 'Đã xóa ca!');
            } catch (e) {
              Alert.alert('Lỗi xóa ca', e.message);
            }
          }
        }
      ]
    );
  };

  const handleApproveShift = async (regId, staffId) => {
    try {
      const { error } = await supabase.from('shift_registrations').update({ status: 'APPROVED' }).eq('id', regId);
      if (error) throw error;
      setShiftRegistrations(shiftRegistrations.map(r => r.id === regId ? { ...r, status: 'APPROVED' } : r));
      
      const staff = staffList.find(s => s.id === staffId);
      if (staff?.push_token) {
         sendPushNotification(staff.push_token, 'Lịch đã duyệt ✅', 'Ca làm việc của bạn đã được quản lý phê duyệt!');
      }
    } catch (e) {
      Alert.alert('Lỗi duyệt ca', e.message);
    }
  };

  const handleRejectShift = async (regId, staffId) => {
    try {
      await supabase.from('shift_registrations').delete().eq('id', regId);
      setShiftRegistrations(shiftRegistrations.filter(r => r.id !== regId));

      const staff = staffList.find(s => s.id === staffId);
      if (staff?.push_token) {
         sendPushNotification(staff.push_token, 'Đăng ký ca bị từ chối', 'Đăng ký ca làm việc của bạn đã bị từ chối!');
      }
    } catch (e) {
      Alert.alert('Lỗi từ chối ca', e.message);
    }
  };

  const handleAssignStaff = async (staffId) => {
    const { date, shiftType } = assignTarget;
    // Kiểm tra nhân viên đó đã có ca nào trong ngày chưa
    const staffShifts = shiftRegistrations.filter(r => r.user_id === staffId && r.date === date && (r.status === 'APPROVED' || r.status === 'PENDING'));
    if (staffShifts.length >= 1) {
      Alert.alert('Cảnh báo', 'Nhân viên này đã có 1 ca trong ngày hôm nay rồi!');
      return;
    }
    
    const newReg = {
      id: `reg_${Date.now()}`,
      user_id: staffId,
      store_id: myStoreId,
      date,
      shift_type: shiftType,
      status: 'APPROVED'
    };

    try {
      const { error } = await supabase.from('shift_registrations').insert([newReg]);
      if (error) throw error;
      setShiftRegistrations([...shiftRegistrations, newReg]);
      setShowAssignModal(false);
      
      const staff = staffList.find(s => s.id === staffId);
      if (staff?.push_token) {
         sendPushNotification(staff.push_token, 'Lịch làm việc mới 📅', 'Bạn vừa được Quản lý xếp vào ca làm việc!');
      }
      
      Alert.alert('Thành công', `Đã xếp ${staff?.name} vào ca!`);
    } catch (e) {
      Alert.alert('Lỗi', e.message);
    }
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
          const morningRegs = getApprovedRegistrations(date, 'MORNING');
          const afternoonRegs = getApprovedRegistrations(date, 'AFTERNOON');
          
          const myMorningSubmitted = shiftRegistrations.find(r => r.date === date && r.shift_type === 'MORNING' && r.user_id === currentUser.id);
          const myAfternoonSubmitted = shiftRegistrations.find(r => r.date === date && r.shift_type === 'AFTERNOON' && r.user_id === currentUser.id);
          
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
                  <View style={[styles.shiftBtn, myMorningSubmitted.status === 'APPROVED' ? styles.shiftSubmitted : styles.shiftPending]}>
                    <Text style={[styles.shiftBtnText, styles.textWhite]}>SÁNG ({myMorningSubmitted.status === 'APPROVED' ? 'Đã Duyệt 🔒' : 'Chờ Duyệt ⏳'})</Text>
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
                  <View style={[styles.shiftBtn, myAfternoonSubmitted.status === 'APPROVED' ? styles.shiftSubmitted : styles.shiftPending]}>
                    <Text style={[styles.shiftBtnText, styles.textWhite]}>CHIỀU ({myAfternoonSubmitted.status === 'APPROVED' ? 'Đã Duyệt 🔒' : 'Chờ Duyệt ⏳'})</Text>
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
      <Text style={styles.sectionTitle}>Lịch Tổng - {storeName}</Text>

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
        const morningRegs = shiftRegistrations.filter(r => r.date === date && r.shift_type === 'MORNING' && (r.store_id === myStoreId || myStoreId === 'ALL'));
        const afternoonRegs = shiftRegistrations.filter(r => r.date === date && r.shift_type === 'AFTERNOON' && (r.store_id === myStoreId || myStoreId === 'ALL'));

        const getStaffName = (userId) => {
          const staff = staffList.find(s => s.id === userId);
          return staff ? staff.name : 'Unknown';
        };

        const renderShiftCol = (regs, shiftType, title, colorHex, bgColor) => {
          const approved = regs.filter(r => r.status === 'APPROVED');
          const pending = regs.filter(r => r.status === 'PENDING');

          return (
            <View style={styles.overviewShiftCol}>
              <View style={[styles.shiftHeader, {backgroundColor: bgColor}]}>
                <Text style={[styles.shiftHeaderTitle, {color: colorHex}]}>{title}</Text>
                <Text style={[styles.shiftHeaderCount, {color: colorHex}]}>{approved.length}/4</Text>
              </View>
              <View style={styles.shiftStaffList}>
                {approved.length === 0 && pending.length === 0 ? <Text style={styles.emptyStaff}>Chưa có ai</Text> : null}
                
                {/* Danh sách đã duyệt */}
                {approved.map(r => (
                  <View key={r.id} style={styles.staffItemRow}>
                    <Text style={styles.staffItemText}>• {getStaffName(r.user_id)}</Text>
                    {isManagerOrOwner && (
                      <TouchableOpacity style={styles.iconActionBtn} onPress={() => handleManagerDeleteShift(r.id, getStaffName(r.user_id))}>
                        <Ionicons name="trash-outline" size={18} color="#d32f2f" />
                      </TouchableOpacity>
                    )}
                  </View>
                ))}
                
                {/* Danh sách chờ duyệt */}
                {pending.map(r => (
                  <View key={r.id} style={[styles.staffItemRow, {backgroundColor: '#fff8e1', padding: 6, borderRadius: 6, marginTop: 4}]}>
                    <Text style={[styles.staffItemText, {color: '#f57c00'}]} numberOfLines={1}>⏳ {getStaffName(r.user_id)}</Text>
                    {isManagerOrOwner && (
                      <View style={{flexDirection: 'row', gap: 8}}>
                        <TouchableOpacity onPress={() => handleApproveShift(r.id, r.user_id)}>
                          <Ionicons name="checkmark-circle" size={24} color="#388e3c" />
                        </TouchableOpacity>
                        <TouchableOpacity onPress={() => handleRejectShift(r.id, r.user_id)}>
                          <Ionicons name="close-circle" size={24} color="#d32f2f" />
                        </TouchableOpacity>
                      </View>
                    )}
                  </View>
                ))}

                {/* Nút Xếp Nhân Viên */}
                {isManagerOrOwner && approved.length < 4 && (
                  <TouchableOpacity 
                    style={styles.assignBtn} 
                    onPress={() => {
                      setAssignTarget({ date, shiftType });
                      setShowAssignModal(true);
                    }}
                  >
                    <Ionicons name="add" size={16} color="#1976d2" />
                    <Text style={styles.assignBtnText}>Xếp nhân viên</Text>
                  </TouchableOpacity>
                )}
              </View>
            </View>
          );
        };

        return (
          <View key={date} style={styles.overviewCard}>
            <Text style={styles.overviewDate}>{getDayName(date)}</Text>
            
            <View style={styles.overviewShiftContainer}>
              {renderShiftCol(morningRegs, 'MORNING', 'CA SÁNG', '#1976d2', '#e3f2fd')}
              <View style={styles.verticalDivider} />
              {renderShiftCol(afternoonRegs, 'AFTERNOON', 'CA CHIỀU', '#e65100', '#fff3e0')}
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

      {/* Modal Chọn Nhân Viên Để Xếp Ca */}
      <Modal visible={showAssignModal} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Xếp Nhân Viên</Text>
              <TouchableOpacity onPress={() => setShowAssignModal(false)}>
                <Ionicons name="close" size={24} color="#666" />
              </TouchableOpacity>
            </View>
            <Text style={styles.modalSubtitle}>
              {assignTarget ? `${assignTarget.shiftType === 'MORNING' ? 'Ca Sáng' : 'Ca Chiều'} - ${getDayName(assignTarget.date)}` : ''}
            </Text>
            <ScrollView style={{maxHeight: 300, marginTop: 10}}>
              {staffList.map(staff => (
                <TouchableOpacity key={staff.id} style={styles.staffSelectBtn} onPress={() => handleAssignStaff(staff.id)}>
                  <View>
                    <Text style={styles.staffSelectName}>{staff.name}</Text>
                    <Text style={styles.staffSelectRole}>{staff.role === 'MANAGER' ? 'Quản Lý' : staff.role === 'STAFF' ? 'Nhân Viên' : 'Chủ Cửa Hàng'}</Text>
                  </View>
                  <Ionicons name="add-circle" size={24} color="#1976d2" />
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        </View>
      </Modal>

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
  shiftPending: { backgroundColor: '#ff9800', borderColor: '#ff9800' },
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
  staffItemRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
  staffItemText: { fontSize: 14, color: '#333', flex: 1 },
  iconActionBtn: { padding: 4 },
  emptyStaff: { fontSize: 14, color: '#aaa', fontStyle: 'italic', textAlign: 'center', marginTop: 10 },
  verticalDivider: { width: 1, backgroundColor: '#eee' },
  assignBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', marginTop: 10, paddingVertical: 8, backgroundColor: '#e3f2fd', borderRadius: 6, borderWidth: 1, borderColor: '#bbdefb' },
  assignBtnText: { color: '#1976d2', fontWeight: 'bold', fontSize: 13, marginLeft: 4 },

  // Modal styles
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', padding: 20 },
  modalContent: { backgroundColor: '#fff', borderRadius: 12, padding: 20 },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  modalTitle: { fontSize: 20, fontWeight: 'bold', color: '#333' },
  modalSubtitle: { fontSize: 14, color: '#666', marginTop: 5, marginBottom: 10 },
  staffSelectBtn: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#eee' },
  staffSelectName: { fontSize: 16, fontWeight: 'bold', color: '#333' },
  staffSelectRole: { fontSize: 12, color: '#888', marginTop: 2 }
});
