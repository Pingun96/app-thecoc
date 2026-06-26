import React, { useContext, useState, useMemo } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, SafeAreaView, RefreshControl, Modal, TextInput, Alert, KeyboardAvoidingView, Platform } from 'react-native';
import { AppContext } from '../context/AppContext';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../services/supabaseClient';
import { sendPushNotification } from '../services/NotificationService';

export default function PayrollScreen({ navigation }) {
  const { currentUser, attendanceHistory, staffList, payrollAdjustments, setPayrollAdjustments, payrollApprovals, setPayrollApprovals, refreshData, isDataLoading } = useContext(AppContext);
  
  const isOwner = currentUser?.role === 'OWNER';
  const isManager = currentUser?.role === 'MANAGER';
  const isStaff = currentUser?.role === 'STAFF';

  // State chọn tháng
  const [monthOffset, setMonthOffset] = useState(0);

  // Lấy thông tin tháng được chọn
  const getSelectedMonthInfo = () => {
    const d = new Date();
    d.setMonth(d.getMonth() + monthOffset);
    return {
      year: d.getFullYear(),
      month: d.getMonth() + 1, // 1-12
      label: `Tháng ${d.getMonth() + 1} / ${d.getFullYear()}`
    };
  };

  const selectedMonth = getSelectedMonthInfo();
  const targetMonthStr = `${selectedMonth.year}-${String(selectedMonth.month).padStart(2, '0')}`;

  // Gom nhóm dữ liệu chấm công theo nhân viên cho tháng được chọn
  const payrollData = useMemo(() => {
    const monthlyRecords = attendanceHistory.filter(r => r.date && r.date.startsWith(targetMonthStr) && r.hours > 0);

    const grouped = {};
    monthlyRecords.forEach(record => {
      if (!grouped[record.user_id]) {
        grouped[record.user_id] = { totalHours: 0, records: [] };
      }
      grouped[record.user_id].totalHours += Number(record.hours || 0);
      grouped[record.user_id].records.push(record);
    });

    const result = [];
    staffList.forEach(staff => {
      if (isStaff && staff.id !== currentUser.id) return;

      const data = grouped[staff.id] || { totalHours: 0, records: [] };
      const wage = staff.wage || 0; 
      
      const allAdjs = payrollAdjustments?.filter(a => a.user_id === staff.id && a.month === targetMonthStr) || [];
      const manualAdj = allAdjs.find(a => a.id.startsWith('adj_manual_')) || { bonus_hours: 0, bonus_money: 0, penalty_money: 0, note: '' };
      
      const autoAdjs = allAdjs.filter(a => !a.id.startsWith('adj_manual_'));
      const autoPenaltyTotal = autoAdjs.reduce((sum, a) => sum + Number(a.penalty_money || 0), 0);
      const autoNotes = autoAdjs.filter(a => a.note).map(a => '- ' + a.note).join('\n');
      
      const combinedAdj = {
        bonus_hours: Number(manualAdj.bonus_hours || 0),
        bonus_money: Number(manualAdj.bonus_money || 0),
        penalty_money: Number(manualAdj.penalty_money || 0) + autoPenaltyTotal,
        manual_penalty: Number(manualAdj.penalty_money || 0),
        auto_penalty: autoPenaltyTotal,
        note: manualAdj.note || '',
        auto_note: autoNotes
      };
      
      const apprv = payrollApprovals?.find(a => a.user_id === staff.id && a.month === targetMonthStr) || {
        staff_confirmed: false, manager_confirmed: false, owner_confirmed: false, status: 'DRAFT'
      };

      const finalHours = data.totalHours + Number(combinedAdj.bonus_hours || 0);
      const totalSalary = (finalHours * wage) + Number(combinedAdj.bonus_money || 0) - Number(combinedAdj.penalty_money || 0);

      result.push({
        ...staff,
        totalHours: data.totalHours,
        finalHours: finalHours,
        totalSalary: totalSalary > 0 ? totalSalary : 0,
        recordsCount: data.records.length,
        records: data.records.sort((a, b) => a.date.localeCompare(b.date)),
        adjustment: combinedAdj,
        approval: apprv
      });
    });

    return result.sort((a, b) => b.totalSalary - a.totalSalary);

  }, [attendanceHistory, staffList, payrollAdjustments, payrollApprovals, targetMonthStr, isStaff, currentUser.id]);

  // Expand detail
  const [expandedUser, setExpandedUser] = useState(null);

  // Modal Điều Chỉnh Thưởng Phạt
  const [showAdjModal, setShowAdjModal] = useState(false);
  const [adjTarget, setAdjTarget] = useState(null); 
  const [editBonusHours, setEditBonusHours] = useState('0');
  const [editBonusMoney, setEditBonusMoney] = useState('0');
  const [editPenaltyMoney, setEditPenaltyMoney] = useState('0');
  const [editNote, setEditNote] = useState('');
  const [isSavingAdj, setIsSavingAdj] = useState(false);

  const openAdjustmentModal = (staffItem) => {
    setAdjTarget(staffItem);
    setEditBonusHours(String(staffItem.adjustment?.bonus_hours || 0));
    setEditBonusMoney(String(staffItem.adjustment?.bonus_money || 0));
    setEditPenaltyMoney(String(staffItem.adjustment?.manual_penalty || 0));
    setEditNote(staffItem.adjustment?.note || '');
    setShowAdjModal(true);
  };

  const handleSaveAdjustment = async () => {
    setIsSavingAdj(true);
    const newAdj = {
      id: `adj_manual_${Date.now()}`,
      user_id: adjTarget.id,
      month: targetMonthStr,
      bonus_hours: Number(editBonusHours) || 0,
      bonus_money: Number(editBonusMoney) || 0,
      penalty_money: Number(editPenaltyMoney) || 0,
      note: editNote.trim()
    };

    try {
      // Chỉ xóa khoản phạt/thưởng thủ công cũ
      await supabase.from('payroll_adjustments').delete().like('id', 'adj_manual_%').eq('user_id', adjTarget.id).eq('month', targetMonthStr);
      // Thêm khoản thưởng phạt mới ghi đè tổng
      const { error } = await supabase.from('payroll_adjustments').insert([newAdj]);
      if (error) throw error;
      
      const newAdjustments = [...(payrollAdjustments || []).filter(a => !(a.id.startsWith('adj_manual_') && a.user_id === adjTarget.id && a.month === targetMonthStr)), newAdj];
      setPayrollAdjustments(newAdjustments);
      setShowAdjModal(false);
      Alert.alert('Thành công', 'Đã lưu điều chỉnh thưởng/phạt!');
    } catch (e) {
      Alert.alert('Lỗi', e.message || 'Không thể lưu. Kiểm tra kết nối mạng!');
    } finally {
      setIsSavingAdj(false);
    }
  };

  // Logic Duyệt 3 bước
  const handleApprove = async (staffItem, roleType) => {
    const currentApproval = staffItem.approval || {};
    
    let updates = {
      id: currentApproval.id || `apprv_${Date.now()}`,
      user_id: staffItem.id,
      month: targetMonthStr,
      staff_confirmed: currentApproval.staff_confirmed || false,
      manager_confirmed: currentApproval.manager_confirmed || false,
      owner_confirmed: currentApproval.owner_confirmed || false,
      status: currentApproval.status || 'DRAFT'
    };
    
    const nowStr = new Date().toLocaleTimeString('vi-VN', {hour: '2-digit', minute:'2-digit'}) + ' ' + new Date().toLocaleDateString('vi-VN');

    if (roleType === 'STAFF') {
      updates.staff_confirmed = true;
      updates.status = 'STAFF_APPROVED';
      updates.staff_confirmed_at = nowStr;
    } else if (roleType === 'MANAGER') {
      updates.manager_confirmed = true;
      updates.status = 'MANAGER_APPROVED';
      updates.manager_confirmed_by = currentUser.name;
      updates.manager_confirmed_at = nowStr;
    } else if (roleType === 'OWNER') {
      updates.owner_confirmed = true;
      updates.status = 'FINALIZED';
      updates.owner_confirmed_by = currentUser.name;
      updates.owner_confirmed_at = nowStr;
    }
    
    try {
      const { error } = await supabase.from('payroll_approvals').upsert([updates]);
      if (error) throw error;
      
      const newApprovals = [...(payrollApprovals || []).filter(a => a.id !== updates.id), updates];
      setPayrollApprovals(newApprovals);
      Alert.alert('Thành công', 'Đã xác nhận phiếu lương!');

      // Send notification
      const targetStaff = staffList.find(s => s.id === staffItem.id);
      if (targetStaff) {
        if (roleType === 'MANAGER') {
          sendPushNotification(targetStaff.push_token, 'Duyệt lương (Quản lý) 🟢', `Quản lý đã xác nhận phiếu lương tháng ${targetMonthStr} của bạn.`, {}, targetStaff.id);
        } else if (roleType === 'OWNER') {
          sendPushNotification(targetStaff.push_token, 'Chốt lương (Chủ cửa hàng) ✅', `Chủ cửa hàng đã chốt phiếu lương tháng ${targetMonthStr} của bạn.`, {}, targetStaff.id);
        }
      }
    } catch (e) {
      Alert.alert('Lỗi xác nhận', e.message);
    }
  };

  const handleCancelApprove = async (staffItem) => {
    const currentApproval = staffItem.approval || {};
    if (!currentApproval.id) return;

    let updates = {
      id: currentApproval.id,
      user_id: staffItem.id,
      month: targetMonthStr,
      staff_confirmed: false,
      manager_confirmed: false,
      owner_confirmed: false,
      status: 'DRAFT',
      staff_confirmed_at: null,
      manager_confirmed_by: null,
      manager_confirmed_at: null,
      owner_confirmed_by: null,
      owner_confirmed_at: null
    };

    try {
      const { error } = await supabase.from('payroll_approvals').upsert([updates]);
      if (error) throw error;
      const newApprovals = [...(payrollApprovals || []).filter(a => a.id !== updates.id), updates];
      setPayrollApprovals(newApprovals);
      Alert.alert('Thành công', 'Đã hủy duyệt phiếu lương!');
    } catch (e) {
      Alert.alert('Lỗi', e.message);
    }
  };

  const formatMoney = (amount) => {
    return Math.round(amount).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  };

  const renderApprovalProgress = (item) => {
    const { staff_confirmed, manager_confirmed, owner_confirmed, staff_confirmed_at, manager_confirmed_by, manager_confirmed_at, owner_confirmed_by, owner_confirmed_at } = item.approval || {};
    const isLocked = owner_confirmed; // Khóa điều chỉnh nếu Owner đã chốt
    
    return (
      <View style={styles.progressBlock}>
        <View style={{flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10}}>
          <Text style={{fontWeight: 'bold', color: '#1976d2'}}>Tiến trình duyệt lương:</Text>
          {(isOwner || (isManager && !owner_confirmed)) && (staff_confirmed || manager_confirmed || owner_confirmed) && (
            <TouchableOpacity onPress={() => handleCancelApprove(item)}>
              <Text style={{color: '#d32f2f', fontSize: 12, fontWeight: 'bold'}}>Hủy duyệt (Mở khóa)</Text>
            </TouchableOpacity>
          )}
        </View>

        <View style={styles.stepRow}>
          <Ionicons name={staff_confirmed ? "checkmark-circle" : "ellipse-outline"} size={20} color={staff_confirmed ? "#4CAF50" : "#ccc"} />
          <View>
            <Text style={[styles.stepText, staff_confirmed && styles.stepTextActive]}>1. Nhân viên xác nhận giờ & lương</Text>
            {staff_confirmed && staff_confirmed_at && <Text style={{fontSize: 11, color: '#6b7280', marginTop: 2, marginLeft: 5}}>Lúc: {staff_confirmed_at}</Text>}
          </View>
        </View>
        <View style={styles.stepRow}>
          <Ionicons name={manager_confirmed ? "checkmark-circle" : "ellipse-outline"} size={20} color={manager_confirmed ? "#4CAF50" : "#ccc"} />
          <View>
            <Text style={[styles.stepText, manager_confirmed && styles.stepTextActive]}>2. Quản lý duyệt phiếu lương</Text>
            {manager_confirmed && manager_confirmed_by && <Text style={{fontSize: 11, color: '#6b7280', marginTop: 2, marginLeft: 5}}>Duyệt bởi: {manager_confirmed_by} - {manager_confirmed_at}</Text>}
          </View>
        </View>
        <View style={styles.stepRow}>
          <Ionicons name={owner_confirmed ? "checkmark-circle" : "ellipse-outline"} size={20} color={owner_confirmed ? "#4CAF50" : "#ccc"} />
          <View>
            <Text style={[styles.stepText, owner_confirmed && styles.stepTextActive]}>3. Chủ quán chốt (Hoàn tất)</Text>
            {owner_confirmed && owner_confirmed_by && <Text style={{fontSize: 11, color: '#6b7280', marginTop: 2, marginLeft: 5}}>Duyệt bởi: {owner_confirmed_by} - {owner_confirmed_at}</Text>}
          </View>
        </View>

        {/* Nút thao tác */}
        {isStaff && item.id === currentUser.id && !staff_confirmed && (
          <TouchableOpacity style={[styles.approveBtn, {backgroundColor: '#1976d2'}]} onPress={() => handleApprove(item, 'STAFF')}>
            <Text style={styles.approveBtnText}>TÔI XÁC NHẬN GIỜ & LƯƠNG ĐÚNG</Text>
          </TouchableOpacity>
        )}
        
        {isManager && staff_confirmed && !manager_confirmed && (
          <TouchableOpacity style={[styles.approveBtn, {backgroundColor: '#1976d2'}]} onPress={() => handleApprove(item, 'MANAGER')}>
            <Text style={styles.approveBtnText}>QUẢN LÝ XÁC NHẬN PHIẾU LƯƠNG</Text>
          </TouchableOpacity>
        )}

        {isOwner && manager_confirmed && !owner_confirmed && (
          <TouchableOpacity style={[styles.approveBtn, {backgroundColor: '#ff9800'}]} onPress={() => handleApprove(item, 'OWNER')}>
            <Text style={styles.approveBtnText}>CHỐT PHIẾU LƯƠNG CUỐI CÙNG</Text>
          </TouchableOpacity>
        )}
        
        {owner_confirmed && (
          <View style={styles.finalizedBadge}>
            <Ionicons name="shield-checkmark" size={16} color="#fff" />
            <Text style={styles.finalizedText}>ĐÃ CHỐT PHIẾU LƯƠNG</Text>
          </View>
        )}
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.headerRow}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={24} color="#1976d2" />
        </TouchableOpacity>
        <Text style={styles.header}>Bảng Lương</Text>
      </View>

      <View style={styles.monthSelector}>
        <TouchableOpacity style={styles.monthBtn} onPress={() => setMonthOffset(monthOffset - 1)}>
          <Ionicons name="chevron-back" size={24} color="#1976d2" />
        </TouchableOpacity>
        <Text style={styles.monthText}>{selectedMonth.label}</Text>
        <TouchableOpacity style={styles.monthBtn} onPress={() => setMonthOffset(monthOffset + 1)} disabled={monthOffset >= 0}>
          <Ionicons name="chevron-forward" size={24} color={monthOffset >= 0 ? "#ccc" : "#1976d2"} />
        </TouchableOpacity>
      </View>

      <ScrollView 
        style={{ flex: 1 }}
        contentContainerStyle={{padding: 20, paddingBottom: 100}}
        refreshControl={<RefreshControl refreshing={isDataLoading} onRefresh={refreshData} />}
      >
        {isManager || isOwner ? (
          <View style={styles.summaryCard}>
            <Text style={styles.summaryTitle}>Tổng quỹ lương tháng</Text>
            <Text style={styles.summaryAmount}>
              {formatMoney(payrollData.reduce((sum, item) => sum + item.totalSalary, 0))} đ
            </Text>
          </View>
        ) : null}

        <Text style={styles.sectionTitle}>Chi tiết nhân sự</Text>
        
        {payrollData.length === 0 ? (
          <Text style={{textAlign: 'center', color: '#666', marginTop: 20}}>Chưa có dữ liệu chấm công tháng này</Text>
        ) : (
          payrollData.map(item => (
            <View key={item.id} style={styles.staffCard}>
              <TouchableOpacity 
                style={[styles.staffHeader, item.approval.owner_confirmed && {backgroundColor: '#f1f8e9'}]} 
                onPress={() => setExpandedUser(expandedUser === item.id ? null : item.id)}
                activeOpacity={0.7}
              >
                <View style={{flex: 1}}>
                  <Text style={styles.staffName}>{item.name}</Text>
                  <Text style={styles.staffRole}>{item.role === 'MANAGER' ? 'Quản Lý' : 'Nhân Viên'} • {item.wage ? `${formatMoney(item.wage)}đ/h` : 'Chưa nhập lương'}</Text>
                  {item.approval.owner_confirmed && <Text style={{color: '#388e3c', fontSize: 12, fontWeight: 'bold', marginTop: 2}}>✓ Đã chốt lương</Text>}
                </View>
                <View style={{alignItems: 'flex-end'}}>
                  <Text style={styles.staffTotal}>{formatMoney(item.totalSalary)} đ</Text>
                  <Text style={styles.staffHours}>Thực tế: {item.finalHours.toFixed(1)} giờ</Text>
                </View>
              </TouchableOpacity>

              {expandedUser === item.id && (
                <View style={styles.staffDetails}>
                  <View style={styles.divider} />
                  
                  {/* Khối Thưởng Phạt */}
                  <View style={styles.adjBlock}>
                    <View style={{flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center'}}>
                      <Text style={{fontWeight: 'bold', color: '#1976d2'}}>Lương & Thưởng / Phạt</Text>
                      {isOwner && !item.approval.owner_confirmed && (
                        <TouchableOpacity style={styles.adjEditBtn} onPress={() => openAdjustmentModal(item)}>
                          <Ionicons name="pencil" size={14} color="#1976d2" />
                          <Text style={{color: '#1976d2', fontSize: 12, marginLeft: 4}}>Điều chỉnh</Text>
                        </TouchableOpacity>
                      )}
                    </View>
                    <View style={{marginTop: 8, gap: 4}}>
                      <Text style={styles.adjText}>• Giờ làm gốc: {item.totalHours.toFixed(1)}h ({item.recordsCount} ca)</Text>
                      {item.adjustment?.bonus_hours > 0 && <Text style={[styles.adjText, {color: '#388e3c'}]}>• Thưởng thêm giờ: +{item.adjustment.bonus_hours}h</Text>}
                      {item.adjustment?.bonus_money > 0 && <Text style={[styles.adjText, {color: '#388e3c'}]}>• Tiền thưởng (Quy định quán): +{formatMoney(item.adjustment.bonus_money)}đ</Text>}
                      {item.adjustment?.manual_penalty > 0 && <Text style={[styles.adjText, {color: 'red'}]}>• Tiền phạt (Quy định quán): -{formatMoney(item.adjustment.manual_penalty)}đ</Text>}
                      {item.adjustment?.note ? <Text style={[styles.adjText, {fontStyle: 'italic', color: '#666', marginLeft: 10}]}>Lý do: {item.adjustment.note}</Text> : null}
                      
                      {item.adjustment?.auto_penalty > 0 && (
                        <>
                          <Text style={[styles.adjText, {color: 'red', marginTop: 4}]}>• Lệch két (Hệ thống tự trừ): -{formatMoney(item.adjustment.auto_penalty)}đ</Text>
                          {item.adjustment?.auto_note ? <Text style={[styles.adjText, {fontStyle: 'italic', color: '#666', marginLeft: 10}]}>{item.adjustment.auto_note}</Text> : null}
                        </>
                      )}
                    </View>
                  </View>

                  {/* Khối Tiến trình Duyệt Lương */}
                  {renderApprovalProgress(item)}

                  <Text style={{fontWeight: 'bold', marginBottom: 10, color: '#555', marginTop: 15}}>Chi tiết các ngày làm việc:</Text>
                  {item.records.length === 0 ? (
                    <Text style={{color: '#999', fontStyle: 'italic'}}>Không có dữ liệu</Text>
                  ) : (
                    item.records.map((r, idx) => (
                      <View key={idx} style={styles.recordRow}>
                        <Text style={styles.recordDate}>{r.date}</Text>
                        <Text style={styles.recordTime}>{r.check_in || r.checkIn} - {r.check_out || r.checkOut}</Text>
                        <Text style={styles.recordHours}>{Number(r.hours).toFixed(1)}h</Text>
                      </View>
                    ))
                  )}
                </View>
              )}
            </View>
          ))
        )}
      </ScrollView>

      {/* MODAL ĐIỀU CHỈNH THƯỞNG PHẠT */}
      <Modal visible={showAdjModal} transparent animationType="fade">
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Thưởng / Phạt</Text>
              <TouchableOpacity onPress={() => setShowAdjModal(false)}>
                <Ionicons name="close" size={24} color="#666" />
              </TouchableOpacity>
            </View>
            <Text style={styles.modalSubtitle}>Nhân viên: {adjTarget?.name}</Text>
            
            <ScrollView showsVerticalScrollIndicator={false}>
              <Text style={styles.label}>Số giờ thưởng thêm (vd: 2.5):</Text>
              <TextInput style={styles.input} keyboardType="numeric" value={editBonusHours} onChangeText={setEditBonusHours} />
              
              <Text style={styles.label}>Số tiền thưởng thêm (VNĐ):</Text>
              <TextInput style={styles.input} keyboardType="numeric" value={editBonusMoney} onChangeText={setEditBonusMoney} />
              
              <Text style={styles.label}>Số tiền phạt / trừ lệch két (VNĐ):</Text>
              <TextInput style={styles.input} keyboardType="numeric" value={editPenaltyMoney} onChangeText={setEditPenaltyMoney} />
              
              <Text style={styles.label}>Ghi chú lý do:</Text>
              <TextInput style={[styles.input, {height: 60}]} multiline value={editNote} onChangeText={setEditNote} placeholder="Vd: Thưởng lễ, đi trễ, làm vỡ ly..." />
              
              <TouchableOpacity style={styles.saveBtn} onPress={handleSaveAdjustment} disabled={isSavingAdj}>
                <Text style={styles.saveBtnText}>{isSavingAdj ? 'Đang lưu...' : 'Lưu Điều Chỉnh'}</Text>
              </TouchableOpacity>
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>

    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f0f2f5' },
  headerRow: { flexDirection: 'row', alignItems: 'center', padding: 20, paddingBottom: 10 },
  backBtn: { padding: 5, marginRight: 10 },
  header: { fontSize: 22, fontWeight: 'bold', color: '#1f2937' },
  
  monthSelector: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: '#e3f2fd', marginHorizontal: 20, padding: 10, borderRadius: 8, marginTop: 10 },
  monthBtn: { padding: 5 },
  monthText: { fontSize: 18, fontWeight: 'bold', color: '#1976d2' },
  
  summaryCard: { backgroundColor: '#1976d2', padding: 20, borderRadius: 12, marginBottom: 20, alignItems: 'center', elevation: 4 },
  summaryTitle: { color: '#e3f2fd', fontSize: 16, marginBottom: 5 },
  summaryAmount: { color: '#fff', fontSize: 32, fontWeight: 'bold' },
  
  sectionTitle: { fontSize: 18, fontWeight: 'bold', color: '#333', marginBottom: 15 },
  
  staffCard: { backgroundColor: '#fff', borderRadius: 10, marginBottom: 12, elevation: 2, overflow: 'hidden' },
  staffHeader: { flexDirection: 'row', justifyContent: 'space-between', padding: 15, alignItems: 'center' },
  staffName: { fontSize: 16, fontWeight: 'bold', color: '#333' },
  staffRole: { fontSize: 13, color: '#666', marginTop: 4 },
  staffTotal: { fontSize: 16, fontWeight: 'bold', color: '#4CAF50' },
  staffHours: { fontSize: 13, color: '#888', marginTop: 4 },
  
  staffDetails: { padding: 15, backgroundColor: '#f9fafb' },
  divider: { height: 1, backgroundColor: '#e5e7eb', marginBottom: 15, marginTop: -5 },
  
  adjBlock: { backgroundColor: '#e3f2fd', padding: 12, borderRadius: 8, marginBottom: 15 },
  adjEditBtn: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#bbdefb', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 15 },
  adjText: { fontSize: 13, color: '#333' },

  progressBlock: { backgroundColor: '#fff', padding: 15, borderRadius: 8, borderWidth: 1, borderColor: '#e0e0e0', marginBottom: 15 },
  stepRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 8 },
  stepText: { fontSize: 14, color: '#666', marginLeft: 8 },
  stepTextActive: { color: '#333', fontWeight: 'bold' },
  approveBtn: { padding: 12, borderRadius: 8, alignItems: 'center', marginTop: 10 },
  approveBtnText: { color: '#fff', fontWeight: 'bold', fontSize: 13 },
  finalizedBadge: { flexDirection: 'row', backgroundColor: '#4CAF50', padding: 12, borderRadius: 8, alignItems: 'center', justifyContent: 'center', marginTop: 10 },
  finalizedText: { color: '#fff', fontWeight: 'bold', fontSize: 13, marginLeft: 6 },

  recordRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: '#eee' },
  recordDate: { width: 90, color: '#555', fontWeight: 'bold' },
  recordTime: { flex: 1, color: '#666', textAlign: 'center' },
  recordHours: { width: 50, color: '#1976d2', fontWeight: 'bold', textAlign: 'right' },

  // Modal Styles
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', padding: 20 },
  modalContent: { backgroundColor: '#fff', borderRadius: 12, padding: 20, maxHeight: '90%' },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
  modalTitle: { fontSize: 20, fontWeight: 'bold', color: '#333' },
  modalSubtitle: { fontSize: 14, color: '#666', marginBottom: 20 },
  label: { fontSize: 14, fontWeight: 'bold', color: '#333', marginBottom: 5 },
  input: { backgroundColor: '#f5f5f5', padding: 12, borderRadius: 8, marginBottom: 15, borderWidth: 1, borderColor: '#ddd' },
  saveBtn: { backgroundColor: '#4CAF50', padding: 15, borderRadius: 8, alignItems: 'center', marginTop: 10 },
  saveBtnText: { color: '#fff', fontWeight: 'bold', fontSize: 16 }
});
