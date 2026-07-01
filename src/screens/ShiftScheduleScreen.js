import React, { useState, useContext, useMemo } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, SafeAreaView, RefreshControl, Dimensions, Alert, Modal, Image } from 'react-native';
import { AppContext } from '../context/AppContext';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../services/supabaseClient';
import { scheduleShiftReminder, getManagersToNotify, sendPushNotification } from '../services/NotificationService';

export default function ShiftScheduleScreen({ navigation }) {
  const { currentUser, selectedStoreId, shiftRegistrations, setShiftRegistrations, shiftSwaps, setShiftSwaps, storeList, staffList, refreshData, isDataLoading, COLORS, isDarkMode } = useContext(AppContext);
  const styles = useMemo(() => getStyles(COLORS, isDarkMode), [COLORS, isDarkMode]);

  const isOwner = currentUser?.role === 'OWNER';
  const isManager = currentUser?.role === 'MANAGER';
  const isStaff = currentUser?.role === 'STAFF';
  const viewableStores = currentUser?.permissions?.viewable_stores || [];

  let overviewStores = [];
  if (isOwner) {
    overviewStores = storeList.map(s => s.id);
  } else {
    overviewStores = viewableStores.length > 0 ? viewableStores : [currentUser?.store_id];
  }

  let myStoreId = currentUser?.store_id;
  if (isOwner || viewableStores.includes(selectedStoreId)) myStoreId = selectedStoreId;
  if (isOwner && selectedStoreId === 'ALL') myStoreId = 'ALL';

  const storeName = myStoreId === 'ALL'
    ? 'Tất cả chi nhánh'
    : storeList.find((store) => store.id === myStoreId)?.name || `Chi nhánh ${myStoreId || '--'}`;

  const canScheduleShift = isOwner || (isManager && currentUser?.permissions?.can_schedule_shift === true);

  const [activeTab, setActiveTab] = useState('PERSONAL');
  const [weekOffset, setWeekOffset] = useState(0);
  const [draftShifts, setDraftShifts] = useState([]); // [{date, shiftType, storeId}]
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);

  React.useEffect(() => {
    const unsubscribe = navigation.addListener('focus', () => {
      fetchUnreadCount();
    });
    return unsubscribe;
  }, [navigation, currentUser]);

  const fetchUnreadCount = async () => {
    if (!currentUser) return;
    try {
      const { count, error } = await supabase
        .from('notifications')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', currentUser.id)
        .eq('is_read', false);
      if (!error) setUnreadCount(count || 0);
    } catch (e) {}
  };

  const staffAllowedStores = currentUser?.permissions?.viewable_stores?.length > 0
    ? currentUser.permissions.viewable_stores
    : [currentUser?.store_id];

  // Nhân viên chỉ đăng ký vào chi nhánh gốc của mình. Chủ/Quản lý sẽ điều động sau.
  const [registerStoreId, setRegisterStoreId] = useState(currentUser?.store_id);

  // Modal Xếp Ca
  const [showAssignModal, setShowAssignModal] = useState(false);
  const [assignTarget, setAssignTarget] = useState(null); // { date, shiftType }

  // Modal Đổi Ca
  const [showSwapModal, setShowSwapModal] = useState(false);
  const [swapShiftReg, setSwapShiftReg] = useState(null); // The shift to swap

  const handleRequestSwap = async (targetUserId) => {
    try {
      const newSwap = {
        id: `swap_${Date.now()}`,
        shift_id: swapShiftReg.id,
        requester_id: currentUser.id,
        target_user_id: targetUserId,
        status: 'PENDING'
      };

      const { error } = await supabase.from('shift_swaps').insert(newSwap);
      if (error) throw error;

      setShiftSwaps([...shiftSwaps, newSwap]);
      setShowSwapModal(false);
      Alert.alert('Thành công', 'Đã gửi yêu cầu đổi ca. Đang chờ quản lý duyệt.');

      // Notify Manager
      const storeId = swapShiftReg.store_id;
      const managers = await getManagersToNotify(storeId);
      for (const manager of managers) {
        if (manager) {
          sendPushNotification(manager.push_token, 'Yêu cầu đổi ca mới 🔔', `Nhân viên ${currentUser.name} vừa gửi yêu cầu nhờ làm thay ca.`, {}, manager.id);
        }
      }
    } catch (e) {
      Alert.alert('Lỗi', e.message);
    }
  };

  const handleApproveSwap = async (swapId) => {
    try {
      const swap = shiftSwaps.find(s => s.id === swapId);
      if (!swap) return;

      const shiftToSwap = shiftRegistrations.find(r => r.id === swap.shift_id);
      if (!shiftToSwap) return;

      // VALIDATE: 1 người không được làm 2 ca cùng lúc
      const targetHasSameShift = shiftRegistrations.some(r => r.user_id === swap.target_user_id && r.date === shiftToSwap.date && r.shift_type === shiftToSwap.shift_type && (r.status === 'APPROVED' || r.status === 'PENDING'));
      if (targetHasSameShift) {
        Alert.alert('Từ chối Đổi Ca', 'Nhân viên nhận ca ĐÃ CÓ LỊCH làm việc vào khung giờ này rồi. Vui lòng từ chối yêu cầu này!');
        return;
      }

      // VALIDATE: Không vượt quá 2 ca/ngày
      const targetShiftsThatDay = shiftRegistrations.filter(r => r.user_id === swap.target_user_id && r.date === shiftToSwap.date && (r.status === 'APPROVED' || r.status === 'PENDING'));
      if (targetShiftsThatDay.length >= 2) {
        Alert.alert('Từ chối Đổi Ca', 'Nhân viên nhận ca ĐÃ KÍN LỊCH trong ngày này. Vui lòng từ chối!');
        return;
      }

      // VALIDATE: 1 ngày 1 chi nhánh
      const hasDifferentStoreShift = targetShiftsThatDay.some(r => r.store_id !== shiftToSwap.store_id);
      if (hasDifferentStoreShift) {
        Alert.alert('Từ chối Đổi Ca', 'Nhân viên nhận ca đang có lịch làm ở CHI NHÁNH KHÁC trong ngày này. Vui lòng từ chối!');
        return;
      }

      // Update swap status
      const { error: swapError } = await supabase.from('shift_swaps').update({ status: 'APPROVED' }).eq('id', swapId);
      if (swapError) throw swapError;

      // Update shift user_id
      const { error: shiftError } = await supabase.from('shift_registrations').update({ user_id: swap.target_user_id }).eq('id', swap.shift_id);
      if (shiftError) throw shiftError;

      setShiftSwaps(shiftSwaps.map(s => s.id === swapId ? { ...s, status: 'APPROVED' } : s));
      setShiftRegistrations(shiftRegistrations.map(r => r.id === swap.shift_id ? { ...r, user_id: swap.target_user_id } : r));

      Alert.alert('Thành công', 'Đã duyệt đổi ca!');

      // Send notifications to both users
      const requester = staffList.find(s => s.id === swap.requester_id);
      const targetUser = staffList.find(s => s.id === swap.target_user_id);
      if (requester) {
        sendPushNotification(requester.push_token, 'Đổi ca thành công ✅', 'Quản lý đã duyệt yêu cầu đổi ca của bạn.', {}, requester.id);
      }
      if (targetUser) {
        sendPushNotification(targetUser.push_token, 'Bạn có ca mới 📅', 'Quản lý đã duyệt đổi ca. Bạn sẽ làm thay ca này.', {}, targetUser.id);
      }

    } catch (e) {
      Alert.alert('Lỗi', e.message);
    }
  };

  const handleRejectSwap = async (swapId) => {
    try {
      const { error } = await supabase.from('shift_swaps').update({ status: 'REJECTED' }).eq('id', swapId);
      if (error) throw error;

      setShiftSwaps(shiftSwaps.map(s => s.id === swapId ? { ...s, status: 'REJECTED' } : s));
    } catch (e) {
      Alert.alert('Lỗi', e.message);
    }
  };

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

  const getShortDate = (dateStr) => {
    const d = new Date(dateStr);
    return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`;
  };

  const weekLabel = weekOffset === 0 ? 'Tuần này' : weekOffset === 1 ? 'Tuần sau' : weekOffset === -1 ? 'Tuần trước' : (weekOffset > 1 ? `Tuần sau +${weekOffset-1}` : `Cách đây ${Math.abs(weekOffset)} tuần`);
  const weekRangeText = `${weekLabel} (${getShortDate(weekDates[0])} - ${getShortDate(weekDates[6])})`;

  const isRegistrationLocked = (dateStr) => {
    const d = new Date(dateStr);
    const diffToMonday = d.getDay() === 0 ? 6 : d.getDay() - 1;
    const mondayOfThisWeek = new Date(d);
    mondayOfThisWeek.setDate(d.getDate() - diffToMonday);

    const previousSunday = new Date(mondayOfThisWeek);
    previousSunday.setDate(mondayOfThisWeek.getDate() - 1);
    previousSunday.setHours(13, 0, 0, 0); // 13:00 Chủ nhật tuần trước

    return new Date() > previousSunday;
  };

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

  const STORE_COLORS = ['#4CAF50', '#2196F3', '#9C27B0', '#E91E63', '#009688', '#795548', '#607D8B'];
  const getStoreColor = (storeId) => {
    const index = storeList.findIndex(s => s.id === storeId);
    return STORE_COLORS[index % STORE_COLORS.length] || '#4CAF50';
  };

  const getDisplayName = (fullName, allStaff) => {
    if (!fullName) return '';
    const parts = fullName.trim().split(' ');
    const firstName = parts[parts.length - 1];

    const duplicates = allStaff.filter(s => {
      const p = (s.name || '').trim().split(' ');
      return p[p.length - 1] === firstName;
    });

    if (duplicates.length > 1 && parts.length > 1) {
      return parts[parts.length - 2] + ' ' + firstName;
    }
    return firstName;
  };

  // =====================
  // ĐĂNG KÝ CA (GIỎ HÀNG)
  // =====================
  const handleToggleDraft = (date, shiftType) => {
    if (isRegistrationLocked(date)) {
      Alert.alert('Hết hạn đăng ký', 'Đã chốt lịch. Bạn phải đăng ký ca làm việc trước 13:00 Chủ Nhật của tuần trước đó.');
      return;
    }

    const isDrafted = draftShifts.find(d => d.date === date && d.shiftType === shiftType);

    if (isDrafted) {
      setDraftShifts(draftShifts.filter(d => !(d.date === date && d.shiftType === shiftType)));
      return;
    }

    const myShiftsThatDay = shiftRegistrations.filter(r => r.user_id === currentUser.id && r.date === date && (r.status === 'APPROVED' || r.status === 'PENDING'));
    const myDraftsThatDay = draftShifts.filter(d => d.date === date);

    const uniqueSubmittedShifts = new Set(myShiftsThatDay.map(r => r.shift_type)).size;
    const uniqueDraftedShifts = new Set(myDraftsThatDay.map(d => d.shiftType)).size;

    if (uniqueSubmittedShifts + uniqueDraftedShifts >= 2) {
      Alert.alert('Cảnh báo', 'Bạn chỉ được đăng ký tối đa 2 ca/ngày (Sáng và Chiều)!');
      return;
    }

    const targetStores = viewableStores.length > 0 ? viewableStores : [currentUser.store_id];
    const newDrafts = targetStores.map(sId => ({ date, shiftType, storeId: sId }));

    setDraftShifts([...draftShifts, ...newDrafts]);
  };

  const handleSubmitDrafts = async () => {
    if (draftShifts.length === 0) return;
    setIsSubmitting(true);

    const newRegs = draftShifts.map((draft, index) => ({
      id: `reg_${Date.now()}_${index}`,
      user_id: currentUser.id,
      store_id: draft.storeId,
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
      const uniqueStoreIds = [...new Set(draftShifts.map(d => d.storeId))];
      for (const sId of uniqueStoreIds) {
        const managers = await getManagersToNotify(sId);
        for (const manager of managers) {
          await sendPushNotification(
            manager.push_token,
            'Lịch Làm Việc Mới',
            `Nhân viên ${currentUser?.name} vừa gửi đăng ký ca làm việc. Đang chờ bạn duyệt.`,
            {},
            manager.id
          );
        }
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
    if (!canScheduleShift) return;
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
      const shiftToApprove = shiftRegistrations.find(r => r.id === regId);

      // KIỂM TRA TRÙNG LỊCH KHI DUYỆT
      if (shiftToApprove) {
        // 1. Trùng ca: Đã có ca nào được duyệt ở cùng khung giờ này chưa?
        const existingApprovedSameTime = shiftRegistrations.find(r => r.user_id === staffId && r.date === shiftToApprove.date && r.shift_type === shiftToApprove.shift_type && r.status === 'APPROVED' && r.id !== regId);
        if (existingApprovedSameTime) {
          Alert.alert('Lỗi Duyệt Ca', 'Nhân viên này đã được duyệt 1 ca làm việc khác vào cùng khung giờ này rồi!');
          return;
        }

        // 2. Kín lịch: Đã làm đủ 2 ca/ngày chưa?
        const approvedShiftsThatDay = shiftRegistrations.filter(r => r.user_id === staffId && r.date === shiftToApprove.date && r.status === 'APPROVED' && r.id !== regId);
        if (approvedShiftsThatDay.length >= 2) {
          Alert.alert('Lỗi Duyệt Ca', 'Nhân viên này đã kín lịch (2 ca) trong ngày hôm nay rồi!');
          return;
        }
      }

      const { error } = await supabase.from('shift_registrations').update({ status: 'APPROVED' }).eq('id', regId);
      if (error) throw error;

      // Auto-reject các ca PENDING bị xung đột (cùng khung giờ)
      const conflictingPending = shiftRegistrations.filter(r =>
        r.user_id === staffId &&
        r.date === shiftToApprove.date &&
        r.status === 'PENDING' &&
        r.id !== regId &&
        r.shift_type === shiftToApprove.shift_type
      );

      if (conflictingPending.length > 0) {
        const conflictingIds = conflictingPending.map(c => c.id);
        await supabase.from('shift_registrations').update({ status: 'REJECTED' }).in('id', conflictingIds);
      }

      setShiftRegistrations(shiftRegistrations.map(r => {
        if (r.id === regId) return { ...r, status: 'APPROVED' };
        if (conflictingPending.find(c => c.id === r.id)) return { ...r, status: 'REJECTED' };
        return r;
      }));

      const staff = staffList.find(s => s.id === staffId);
      if (staff) {
         sendPushNotification(staff.push_token, 'Lịch đã duyệt ✅', 'Ca làm việc của bạn đã được quản lý phê duyệt!', {}, staff.id);
      }
    } catch (e) {
      Alert.alert('Lỗi duyệt ca', e.message);
    }
  };

  const handleRejectShift = async (regId, staffId) => {
    try {
      await supabase.from('shift_registrations').update({ status: 'REJECTED' }).eq('id', regId);
      setShiftRegistrations(shiftRegistrations.map(r => r.id === regId ? { ...r, status: 'REJECTED' } : r));

      const staff = staffList.find(s => s.id === staffId);
      if (staff) {
         sendPushNotification(staff.push_token, 'Đăng ký ca bị từ chối', 'Đăng ký ca làm việc của bạn đã bị từ chối!', {}, staff.id);
      }
    } catch (e) {
      Alert.alert('Lỗi từ chối ca', e.message);
    }
  };

  const handleAssignStaff = async (staffId) => {
    const { date, shiftType, storeId } = assignTarget;

    // Tìm đăng ký của nhân viên này trong ca đó
    const existingReg = shiftRegistrations.find(r => r.user_id === staffId && r.date === date && r.shift_type === shiftType);

    try {
      if (existingReg) {
        // Cập nhật store_id và duyệt luôn
        const { error } = await supabase.from('shift_registrations')
          .update({ store_id: storeId, status: 'APPROVED' })
          .eq('id', existingReg.id);

        if (error) throw error;

        setShiftRegistrations(shiftRegistrations.map(r =>
          r.id === existingReg.id
            ? { ...r, store_id: storeId, status: 'APPROVED' }
            : r
        ));
      } else {
        // Tạo đăng ký mới tinh (Force Assign)
        const newReg = {
          id: `sr_${Date.now()}_${Math.random().toString(36).substring(7)}`,
          user_id: staffId,
          store_id: storeId,
          date: date,
          shift_type: shiftType,
          status: 'APPROVED'
        };

        const { error } = await supabase.from('shift_registrations').insert([newReg]);
        if (error) throw error;

        setShiftRegistrations([...shiftRegistrations, newReg]);
      }

      setShowAssignModal(false);

      const staff = staffList.find(s => s.id === staffId);
      const storeName = storeList.find(s => s.id === storeId)?.name || storeId;
      if (staff) {
         sendPushNotification(staff.push_token, 'Điều động công tác 🏃', `Bạn đã được quản lý xếp sang làm việc tại ${storeName} cho ca đăng ký này!`, {}, staff.id);
      }

      Alert.alert('Thành công', `Đã điều động ${staff?.name} sang chi nhánh này!`);
    } catch (e) {
      Alert.alert('Lỗi', e.message);
    }
  };

  const renderPersonalSchedule = () => (
    <View style={{flex: 1}}>
      <ScrollView
        style={{ flex: 1 }}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{paddingBottom: 100}}
        refreshControl={<RefreshControl refreshing={isDataLoading} onRefresh={refreshData} />}
      >
        <Text style={styles.sectionTitle}>Lịch làm việc cá nhân</Text>

        <View style={styles.weekSelector}>
          <TouchableOpacity style={styles.weekBtn} onPress={() => setWeekOffset(weekOffset - 1)}>
            <Ionicons name="chevron-back" size={24} color="#1976d2" />
          </TouchableOpacity>
          <Text style={styles.weekText}>{weekRangeText}</Text>
          <TouchableOpacity style={styles.weekBtn} onPress={() => setWeekOffset(weekOffset + 1)}>
            <Ionicons name="chevron-forward" size={24} color="#1976d2" />
          </TouchableOpacity>
        </View>

        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          <View style={styles.timetableContainer}>
            {/* Header Row: Ngày */}
            <View style={styles.timeTableRow}>
              <View style={[styles.timeTableCell, styles.timeTableHeaderCell, {width: 60, backgroundColor: '#1e3a8a', borderBottomColor: '#1e40af'}]}><Text style={[styles.timeTableTitle, {color: '#fff'}]}>Ca \ Thứ</Text></View>
              {weekDates.map(date => (
                <View key={`header_${date}`} style={[styles.timeTableCell, styles.timeTableHeaderCell, {backgroundColor: '#1e3a8a', borderBottomColor: '#1e40af'}]}>
                  <Text style={[styles.timeTableTitle, {color: '#fff'}]}>{getDayName(date).replace(/ (\d{1,2}\/\d{1,2})/, '\n($1)')}</Text>
                </View>
              ))}
            </View>

            {/* Row Sáng */}
            <View style={styles.timeTableRow}>
              <View style={[styles.timeTableCell, styles.timeTableSidebarCell, {width: 60, backgroundColor: '#dcfce7', borderColor: '#86efac', borderWidth: 1}]}>
                <Text style={[styles.timeTableSidebarText, {color: '#15803d'}]}>SÁNG</Text>
              </View>
              {weekDates.map(date => {
                const myRegs = shiftRegistrations.filter(r => r.date === date && r.shift_type === 'MORNING' && r.user_id === currentUser.id);
                const reg = myRegs.find(r => r.status === 'APPROVED') || myRegs.find(r => r.status === 'PENDING');
                const sName = reg ? (storeList.find(s => s.id === reg.store_id)?.name || `CN ${reg.store_id}`) : '';
                const pendingSwap = reg ? shiftSwaps.find(s => s.shift_id === reg.id && s.status === 'PENDING') : null;
                const bgColor = reg ? (reg.status === 'APPROVED' ? getStoreColor(reg.store_id) : '#ff9800') : '#f0fdf4';

                return (
                  <TouchableOpacity
                    key={`morning_${date}`}
                    style={[styles.timeTableCell, { backgroundColor: bgColor }]}
                    onPress={() => {
                      if (reg && reg.status === 'APPROVED' && !pendingSwap) {
                        setSwapShiftReg(reg);
                        setShowSwapModal(true);
                      }
                    }}
                    disabled={!reg || reg.status !== 'APPROVED' || !!pendingSwap}
                  >
                    {reg ? (
                      <>
                        <Text style={[styles.cellStoreText, reg.status === 'APPROVED' ? styles.textWhite : {}]}>{sName}</Text>
                        <Text style={[styles.cellStatusText, reg.status === 'APPROVED' ? styles.textWhite : {}]}>
                          {pendingSwap ? '(Chờ đổi)' : (reg.status === 'APPROVED' ? '(Đã duyệt)' : '(Chờ)')}
                        </Text>
                      </>
                    ) : (
                      <Text style={styles.cellEmptyText}>-</Text>
                    )}
                  </TouchableOpacity>
                );
              })}
            </View>

            {/* Row Chiều */}
            <View style={styles.timeTableRow}>
              <View style={[styles.timeTableCell, styles.timeTableSidebarCell, {width: 60, backgroundColor: '#fef08a', borderColor: '#fde047', borderWidth: 1}]}>
                <Text style={[styles.timeTableSidebarText, {color: '#a16207'}]}>CHIỀU</Text>
              </View>
              {weekDates.map(date => {
                const myRegs = shiftRegistrations.filter(r => r.date === date && r.shift_type === 'AFTERNOON' && r.user_id === currentUser.id);
                const reg = myRegs.find(r => r.status === 'APPROVED') || myRegs.find(r => r.status === 'PENDING');
                const sName = reg ? (storeList.find(s => s.id === reg.store_id)?.name || `CN ${reg.store_id}`) : '';
                const pendingSwap = reg ? shiftSwaps.find(s => s.shift_id === reg.id && s.status === 'PENDING') : null;
                const bgColor = reg ? (reg.status === 'APPROVED' ? getStoreColor(reg.store_id) : '#ff9800') : '#fefce8';

                return (
                  <TouchableOpacity
                    key={`afternoon_${date}`}
                    style={[styles.timeTableCell, { backgroundColor: bgColor }]}
                    onPress={() => {
                      if (reg && reg.status === 'APPROVED' && !pendingSwap) {
                        setSwapShiftReg(reg);
                        setShowSwapModal(true);
                      }
                    }}
                    disabled={!reg || reg.status !== 'APPROVED' || !!pendingSwap}
                  >
                    {reg ? (
                      <>
                        <Text style={[styles.cellStoreText, reg.status === 'APPROVED' ? styles.textWhite : {}]}>{sName}</Text>
                        <Text style={[styles.cellStatusText, reg.status === 'APPROVED' ? styles.textWhite : {}]}>
                          {pendingSwap ? '(Chờ đổi)' : (reg.status === 'APPROVED' ? '(Đã duyệt)' : '(Chờ)')}
                        </Text>
                      </>
                    ) : (
                      <Text style={styles.cellEmptyText}>-</Text>
                    )}
                  </TouchableOpacity>
                );
              })}
            </View>

          </View>
        </ScrollView>
      </ScrollView>
    </View>
  );

  const renderStaffRegister = () => (
    <View style={{flex: 1}}>
      <ScrollView
        style={{ flex: 1 }}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{paddingBottom: 100}}
        refreshControl={<RefreshControl refreshing={isDataLoading} onRefresh={refreshData} />}
      >
        <Text style={styles.sectionTitle}>Đăng ký lịch làm việc (Tối đa 4 người/ca)</Text>
        <Text style={{fontSize: 13, color: COLORS.textMuted, fontStyle: 'italic', marginBottom: 15}}>Lưu ý: Bạn chỉ chọn khung giờ rảnh. Quản lý sẽ tự động điều động bạn vào chi nhánh phù hợp.</Text>

        <View style={styles.weekSelector}>
          <TouchableOpacity style={styles.weekBtn} onPress={() => setWeekOffset(weekOffset - 1)}>
            <Ionicons name="chevron-back" size={24} color="#1976d2" />
          </TouchableOpacity>
          <Text style={styles.weekText}>{weekRangeText}</Text>
          <TouchableOpacity style={styles.weekBtn} onPress={() => setWeekOffset(weekOffset + 1)}>
            <Ionicons name="chevron-forward" size={24} color="#1976d2" />
          </TouchableOpacity>
        </View>

        {weekDates.map(date => {
          const isPastDate = new Date(date).setHours(0,0,0,0) < new Date().setHours(0,0,0,0);
          const myMorningRegs = shiftRegistrations.filter(r => r.date === date && r.shift_type === 'MORNING' && r.user_id === currentUser.id);
          const myMorningSubmitted = myMorningRegs.find(r => r.status === 'APPROVED') || myMorningRegs.find(r => r.status === 'PENDING');

          const myAfternoonRegs = shiftRegistrations.filter(r => r.date === date && r.shift_type === 'AFTERNOON' && r.user_id === currentUser.id);
          const myAfternoonSubmitted = myAfternoonRegs.find(r => r.status === 'APPROVED') || myAfternoonRegs.find(r => r.status === 'PENDING');

          const myMorningDraft = draftShifts.find(d => d.date === date && d.shiftType === 'MORNING');
          const myAfternoonDraft = draftShifts.find(d => d.date === date && d.shiftType === 'AFTERNOON');

          const getStoreAbbr = (sid) => storeList.find(s => s.id === sid)?.name || `CN ${sid}`;

          return (
            <View key={date} style={[styles.card, isPastDate && { opacity: 0.6, backgroundColor: '#f5f5f5' }]}>
              <Text style={styles.dateText}>{getDayName(date)}</Text>
              <View style={styles.shiftRow}>
                {/* CA SÁNG */}
                {myMorningSubmitted ? (
                  <View style={[styles.shiftBtn, myMorningSubmitted.status === 'APPROVED' ? styles.shiftSubmitted : styles.shiftPending]}>
                    <Text style={[styles.shiftBtnText, styles.textWhite]}>
                      {myMorningSubmitted.status === 'APPROVED' ? `SÁNG - ${getStoreAbbr(myMorningSubmitted.store_id)}` : 'SÁNG'}
                    </Text>
                    <Text style={[styles.shiftBtnText, styles.textWhite, {fontSize: 10}]}>({myMorningSubmitted.status === 'APPROVED' ? 'Đã Duyệt' : 'Chờ Duyệt'})</Text>
                  </View>
                ) : (
                  <TouchableOpacity
                    style={[styles.shiftBtn, myMorningDraft ? styles.shiftDrafted : {}]}
                    disabled={isPastDate}
                    onPress={() => handleToggleDraft(date, 'MORNING')}
                  >
                    <Text style={[styles.shiftBtnText, myMorningDraft ? styles.textWhite : {}]}>
                      {myMorningDraft ? 'SÁNG (Đang chọn)' : `SÁNG (Đăng ký)`}
                    </Text>
                  </TouchableOpacity>
                )}

                {/* CA CHIỀU */}
                {myAfternoonSubmitted ? (
                  <View style={[styles.shiftBtn, myAfternoonSubmitted.status === 'APPROVED' ? styles.shiftSubmitted : styles.shiftPending]}>
                    <Text style={[styles.shiftBtnText, styles.textWhite]}>
                      {myAfternoonSubmitted.status === 'APPROVED' ? `CHIỀU - ${getStoreAbbr(myAfternoonSubmitted.store_id)}` : 'CHIỀU'}
                    </Text>
                    <Text style={[styles.shiftBtnText, styles.textWhite, {fontSize: 10}]}>({myAfternoonSubmitted.status === 'APPROVED' ? 'Đã Duyệt' : 'Chờ Duyệt'})</Text>
                  </View>
                ) : (
                  <TouchableOpacity
                    style={[styles.shiftBtn, myAfternoonDraft ? styles.shiftDrafted : {}]}
                    disabled={isPastDate}
                    onPress={() => handleToggleDraft(date, 'AFTERNOON')}
                  >
                    <Text style={[styles.shiftBtnText, myAfternoonDraft ? styles.textWhite : {}]}>
                      {myAfternoonDraft ? 'CHIỀU (Đang chọn)' : `CHIỀU (Đăng ký)`}
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
      <Text style={styles.sectionTitle}>Lịch Tổng - Tất cả chi nhánh</Text>

      <View style={styles.weekSelector}>
        <TouchableOpacity style={styles.weekBtn} onPress={() => setWeekOffset(weekOffset - 1)}>
          <Ionicons name="chevron-back" size={24} color="#1976d2" />
        </TouchableOpacity>
        <Text style={styles.weekText}>{weekRangeText}</Text>
        <TouchableOpacity style={styles.weekBtn} onPress={() => setWeekOffset(weekOffset + 1)}>
          <Ionicons name="chevron-forward" size={24} color="#1976d2" />
        </TouchableOpacity>
      </View>

      {/* Yêu cầu Đổi ca (Dành cho Quản lý) */}
      {canScheduleShift && shiftSwaps.filter(s => s.status === 'PENDING').length > 0 && (
        <View style={styles.swapApprovalContainer}>
          <Text style={styles.swapApprovalTitle}>⚠️ Cần Duyệt Đổi Ca</Text>
          {shiftSwaps.filter(s => s.status === 'PENDING').map(swap => {
            const shift = shiftRegistrations.find(r => r.id === swap.shift_id);
            if (!shift) return null;
            const requester = staffList.find(u => u.id === swap.requester_id);
            const target = staffList.find(u => u.id === swap.target_user_id);
            const sName = storeList.find(s => s.id === shift.store_id)?.name || `CN ${shift.store_id}`;
            const dateStr = getDayName(shift.date);
            const shiftName = shift.shift_type === 'MORNING' ? 'Sáng' : 'Chiều';

            return (
              <View key={swap.id} style={styles.swapItem}>
                <View style={{flex: 1}}>
                  <Text style={styles.swapItemText}><Text style={{fontWeight: 'bold'}}>{requester?.name}</Text> muốn nhượng ca cho <Text style={{fontWeight: 'bold'}}>{target?.name}</Text></Text>
                  <Text style={styles.swapItemDetail}>Ca {shiftName} - {dateStr} tại {sName}</Text>
                </View>
                <View style={{flexDirection: 'row', gap: 10}}>
                  <TouchableOpacity onPress={() => handleApproveSwap(swap.id)} style={[styles.swapActionBtn, {backgroundColor: '#4CAF50'}]}>
                    <Text style={{color: '#fff', fontSize: 12, fontWeight: 'bold'}}>Duyệt</Text>
                  </TouchableOpacity>
                  <TouchableOpacity onPress={() => handleRejectSwap(swap.id)} style={[styles.swapActionBtn, {backgroundColor: '#f44336'}]}>
                    <Text style={{color: '#fff', fontSize: 12, fontWeight: 'bold'}}>Từ chối</Text>
                  </TouchableOpacity>
                </View>
              </View>
            );
          })}
        </View>
      )}

      {overviewStores.map((storeId, index) => {
        const sName = storeList.find(s => s.id === storeId)?.name || `CN ${storeId}`;

        // Define a palette of highly distinct colors
        const STORE_PALETTE = [
          '#ef4444', // Red
          '#3b82f6', // Blue
          '#10b981', // Green
          '#f59e0b', // Amber
          '#8b5cf6', // Purple
          '#ec4899', // Pink
          '#14b8a6', // Teal
          '#f97316'  // Orange
        ];
        
        const storeColor = STORE_PALETTE[index % STORE_PALETTE.length];
        const storeBg = storeColor + '10'; // 10% opacity background for header

        return (
          <View key={storeId} style={[
            styles.storeCard, 
            { 
              borderColor: storeColor, 
              borderWidth: 1,
              borderBottomWidth: 4, // 3D effect
              borderRightWidth: 2,  // 3D effect
              elevation: 4,
              shadowColor: storeColor,
              shadowOffset: { width: 2, height: 4 },
              shadowOpacity: 0.2,
              shadowRadius: 5
            }
          ]}>
            <View style={[styles.storeHeader, { backgroundColor: storeBg, borderBottomColor: storeColor }]}>
              <Ionicons name="location" size={20} color={storeColor} style={{marginRight: 8}}/>
              <Text style={[styles.storeHeaderText, { color: storeColor }]}>{sName}</Text>
            </View>

            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.horizontalScroll}>
              {weekDates.map(date => {
                const isPastDate = new Date(date).setHours(0,0,0,0) < new Date().setHours(0,0,0,0);
                const morningRegs = shiftRegistrations.filter(r => r.date === date && r.shift_type === 'MORNING' && r.store_id === storeId);
                const afternoonRegs = shiftRegistrations.filter(r => r.date === date && r.shift_type === 'AFTERNOON' && r.store_id === storeId);

                const getStaffDetails = (userId) => {
                  const staff = staffList.find(s => s.id === userId);
                  if (!staff) return { name: 'Unknown', label: '', bgColor: '#f0fdfa', textColor: '#0f766e' };

                  let label = 'PC'; // Pha chế mặc định
                  if (staff.role === 'OWNER') label = 'CHỦ';
                  else if (staff.role === 'MANAGER') label = 'QL';
                  else if (staff.permissions?.cashier) label = 'TN'; // Thu ngân

                  // Tạo màu ngẫu nhiên nhưng cố định theo userId
                  let hash = 0;
                  for (let i = 0; i < userId.length; i++) {
                    hash = userId.charCodeAt(i) + ((hash << 5) - hash);
                  }
                  const hue = Math.abs(hash) % 360;

                  return {
                    name: staff.name,
                    label,
                    bgColor: `hsl(${hue}, 85%, 90%)`,
                    textColor: `hsl(${hue}, 85%, 25%)`,
                    avatar_url: staff.avatar_url
                  };
                };

                const renderShiftBox = (regs, shiftType, title, colorHex, bgColor, borderColor = '#f0f0f0') => {
                  const approved = regs.filter(r => r.status === 'APPROVED');
                  const pending = regs.filter(r => r.status === 'PENDING');

                  return (
                    <View style={[styles.shiftBox, { borderColor, borderWidth: borderColor !== '#f0f0f0' ? 1.5 : 1 }]}>
                      <View style={[styles.shiftBoxHeader, {backgroundColor: bgColor}]}>
                        <Text style={[styles.shiftBoxTitle, {color: colorHex}]}>{title} ({approved.length}/4)</Text>
                      </View>
                      <View style={styles.shiftBoxContent}>
                        {approved.length === 0 && pending.length === 0 ? <Text style={styles.emptyStaff}>-</Text> : null}

                        {approved.map(r => {
                          const s = getStaffDetails(r.user_id);
                          return (
                            <View key={r.id} style={[styles.staffBadgeRow, {backgroundColor: s.bgColor, paddingHorizontal: 6, paddingVertical: 4, borderRadius: 6}]}>
                              <View style={{flexDirection: 'row', alignItems: 'center', flex: 1}}>
                                {s.avatar_url ? (
                                  <Image source={{uri: s.avatar_url}} style={{width: 20, height: 20, borderRadius: 10, marginRight: 6}} />
                                ) : (
                                  <View style={{width: 20, height: 20, borderRadius: 10, marginRight: 6, backgroundColor: s.textColor, justifyContent: 'center', alignItems: 'center'}}>
                                    <Text style={{color: s.bgColor, fontSize: 9, fontWeight: 'bold'}}>{s.label}</Text>
                                  </View>
                                )}
                                <Text style={[styles.staffBadgeText, {color: s.textColor}]} numberOfLines={1}>
                                  {getDisplayName(s.name, staffList)}
                                </Text>
                              </View>
                              {canScheduleShift && !isPastDate && (
                                <TouchableOpacity style={styles.iconActionBtn} onPress={() => handleManagerDeleteShift(r.id, s.name)}>
                                  <Ionicons name="close" size={16} color={s.textColor} />
                                </TouchableOpacity>
                              )}
                            </View>
                          );
                        })}

                        {pending.map(r => {
                          const s = getStaffDetails(r.user_id);
                          return (
                            <View key={r.id} style={[styles.staffBadgeRow, {backgroundColor: '#fffbeb', paddingHorizontal: 6, paddingVertical: 4, borderRadius: 6, borderWidth: 1, borderColor: '#fde047'}]}>
                              <View style={{flexDirection: 'row', alignItems: 'center', flex: 1}}>
                                {s.avatar_url ? (
                                  <Image source={{uri: s.avatar_url}} style={{width: 20, height: 20, borderRadius: 10, marginRight: 6, opacity: 0.7}} />
                                ) : (
                                  <View style={{width: 20, height: 20, borderRadius: 10, marginRight: 6, backgroundColor: '#fcd34d', justifyContent: 'center', alignItems: 'center'}}>
                                    <Text style={{color: '#b45309', fontSize: 9, fontWeight: 'bold'}}>{s.label}</Text>
                                  </View>
                                )}
                                <Text style={[styles.staffBadgeText, {color: '#b45309'}]} numberOfLines={1}>
                                  ⏳ {getDisplayName(s.name, staffList)}
                                </Text>
                              </View>
                              {canScheduleShift && !isPastDate && (
                                <View style={{flexDirection: 'row', gap: 6}}>
                                  <TouchableOpacity onPress={() => handleApproveShift(r.id, r.user_id)}>
                                    <Ionicons name="checkmark-circle" size={20} color="#22c55e" />
                                  </TouchableOpacity>
                                  <TouchableOpacity onPress={() => handleRejectShift(r.id, r.user_id)}>
                                    <Ionicons name="close-circle" size={20} color="#ef4444" />
                                  </TouchableOpacity>
                                </View>
                              )}
                            </View>
                          );
                        })}

                        {canScheduleShift && !isPastDate && approved.length < 4 && (
                          <TouchableOpacity
                            style={styles.addBtnSmall}
                            onPress={() => {
                              setAssignTarget({ date, shiftType, storeId });
                              setShowAssignModal(true);
                            }}
                          >
                            <Ionicons name="add" size={14} color="#1976d2" />
                            <Text style={styles.addBtnTextSmall}>Xếp</Text>
                          </TouchableOpacity>
                        )}
                      </View>
                    </View>
                  );
                };

                return (
                  <View key={date} style={[styles.dayColumn, isPastDate && { opacity: 0.6, backgroundColor: '#f5f5f5' }]}>
                    <Text style={styles.dayColHeader}>{getDayName(date)}</Text>
                    <View style={styles.dayColBody}>
                      {renderShiftBox(morningRegs, 'MORNING', 'SÁNG', '#15803d', '#dcfce7', '#86efac')}
                      {renderShiftBox(afternoonRegs, 'AFTERNOON', 'CHIỀU', '#a16207', '#fef08a', '#fde047')}
                    </View>
                  </View>
                );
              })}
            </ScrollView>
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
        <TouchableOpacity onPress={() => navigation.navigate('Notifications')} style={{ position: 'relative', marginRight: 10 }}>
          <Ionicons name="notifications-outline" size={26} color="#60a5fa" />
          {unreadCount > 0 && (
            <View style={styles.badge}>
              <Text style={styles.badgeText}>{unreadCount > 9 ? '9+' : unreadCount}</Text>
            </View>
          )}
        </TouchableOpacity>
      </View>

      <View style={styles.tabContainer}>
        <TouchableOpacity style={[styles.tabBtn, activeTab === 'PERSONAL' && styles.tabBtnActive]} onPress={() => setActiveTab('PERSONAL')}>
          <Text style={[styles.tabText, activeTab === 'PERSONAL' && styles.tabTextActive]}>Cá Nhân</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.tabBtn, activeTab === 'SCHEDULE' && styles.tabBtnActive]} onPress={() => setActiveTab('SCHEDULE')}>
          <Text style={[styles.tabText, activeTab === 'SCHEDULE' && styles.tabTextActive]}>Lịch Quán</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.tabBtn, activeTab === 'REGISTER' && styles.tabBtnActive]} onPress={() => setActiveTab('REGISTER')}>
          <Text style={[styles.tabText, activeTab === 'REGISTER' && styles.tabTextActive]}>Đăng Ký</Text>
        </TouchableOpacity>
      </View>

      <View style={{flex: 1, paddingHorizontal: 20}}>
        {activeTab === 'PERSONAL' && renderPersonalSchedule()}
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
              {staffList.filter(staff => {
                if (!assignTarget) return false;
                if (staff.is_active === false) return false; // Không xếp nhân viên đã nghỉ

                // 1. Kiểm tra nhân viên có được phép làm ở chi nhánh đích không
                const isAllowedAtStore = staff.store_id === assignTarget.storeId || staff.permissions?.viewable_stores?.includes(assignTarget.storeId);
                if (!isAllowedAtStore) return false;

                const staffShiftsToday = shiftRegistrations.filter(r => r.user_id === staff.id && r.date === assignTarget.date);

                const sameShiftReg = staffShiftsToday.find(r => r.shift_type === assignTarget.shiftType);

                // Nếu đã được duyệt làm việc tại CHI NHÁNH KHÁC trong đúng ca này -> Không được xếp nữa
                if (sameShiftReg && sameShiftReg.status === 'APPROVED' && sameShiftReg.store_id !== assignTarget.storeId) return false;

                // Nếu đã được duyệt làm việc TẠI ĐÂY trong đúng ca này -> Ẩn đi cho đỡ rối (vì đã có trên lịch)
                if (sameShiftReg && sameShiftReg.status === 'APPROVED' && sameShiftReg.store_id === assignTarget.storeId) return false;

                // 4. Luật 1 ngày 1 chi nhánh: Nếu họ có 1 ca KHÁC ở chi nhánh khác đã APPROVED (ví dụ Sáng làm ở A, thì chiều không thể làm ở B)
                const hasOtherStoreDifferentShift = staffShiftsToday.some(r => r.store_id !== assignTarget.storeId && r.shift_type !== assignTarget.shiftType && r.status === 'APPROVED');
                if (hasOtherStoreDifferentShift) return false;

                return true;
              }).map(staff => (
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

      {/* Modal Chọn Nhân Viên Để Đổi Ca */}
      <Modal visible={showSwapModal} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Xin Đổi Ca</Text>
              <TouchableOpacity onPress={() => setShowSwapModal(false)}>
                <Ionicons name="close" size={24} color="#666" />
              </TouchableOpacity>
            </View>
            <Text style={styles.modalSubtitle}>
              Chọn đồng nghiệp bạn muốn nhờ làm thay:
            </Text>
            <ScrollView style={{maxHeight: 300, marginTop: 10}}>
              {staffList.filter(staff => {
                if (staff.id === currentUser.id) return false;
                if (!swapShiftReg) return false;

                // 1. Không hiển thị nhân viên đã có ca làm việc ở cùng khung giờ Sáng/Chiều đó
                const targetHasSameShift = shiftRegistrations.some(r => r.user_id === staff.id && r.date === swapShiftReg.date && r.shift_type === swapShiftReg.shift_type && (r.status === 'APPROVED' || r.status === 'PENDING'));
                if (targetHasSameShift) return false;

                // 2. Không hiển thị nhân viên đã làm 2 ca trong ngày đó (kín lịch)
                const targetShiftsThatDay = shiftRegistrations.filter(r => r.user_id === staff.id && r.date === swapShiftReg.date && (r.status === 'APPROVED' || r.status === 'PENDING'));
                if (targetShiftsThatDay.length >= 2) return false;

                // 3. Quy tắc 1 ngày 1 chi nhánh: Nếu nhân viên đã có ca làm việc khác trong ngày, thì phải cùng chi nhánh với ca đang xin đổi
                const hasDifferentStoreShift = targetShiftsThatDay.some(r => r.store_id !== swapShiftReg.store_id);
                if (hasDifferentStoreShift) return false;

                return true;
              }).map(staff => (
                <TouchableOpacity key={staff.id} style={styles.staffSelectBtn} onPress={() => handleRequestSwap(staff.id)}>
                  <View>
                    <Text style={styles.staffSelectName}>{staff.name}</Text>
                    <Text style={styles.staffSelectRole}>{staff.role === 'MANAGER' ? 'Quản Lý' : staff.role === 'STAFF' ? 'Nhân Viên' : 'Chủ Cửa Hàng'}</Text>
                  </View>
                  <Ionicons name="swap-horizontal" size={24} color="#1976d2" />
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        </View>
      </Modal>

    </SafeAreaView>
  );
}

const getStyles = (COLORS, isDarkMode) => StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.bg },
  headerRow: { flexDirection: 'row', alignItems: 'center', padding: 20, paddingBottom: 10 },
  backBtn: { padding: 5, marginRight: 10 },
  header: { fontSize: 22, fontWeight: 'bold', color: COLORS.text },
  tabContainer: { flexDirection: 'row', backgroundColor: COLORS.inputBg, borderRadius: 8, marginHorizontal: 20, marginBottom: 15, padding: 4, borderWidth: 1, borderColor: COLORS.border },
  tabBtn: { flex: 1, paddingVertical: 10, alignItems: 'center', borderRadius: 6 },
  tabBtnActive: { backgroundColor: COLORS.card, elevation: 2 },
  tabText: { fontWeight: 'bold', color: COLORS.textMuted, fontSize: 13 },
  tabTextActive: { color: COLORS.primary },
  sectionTitle: { fontSize: 16, fontWeight: 'bold', color: COLORS.primary, marginBottom: 15 },
  card: { backgroundColor: COLORS.card, padding: 15, borderRadius: 10, marginBottom: 15, elevation: 2, borderWidth: 1, borderColor: COLORS.border },
  weekSelector: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: isDarkMode ? '#0f2a44' : '#e3f2fd', padding: 10, borderRadius: 8, marginBottom: 15, borderWidth: 1, borderColor: COLORS.border },
  weekBtn: { padding: 5 },
  weekText: { fontSize: 16, fontWeight: 'bold', color: COLORS.primary },
  dateText: { fontSize: 16, fontWeight: 'bold', color: COLORS.text, marginBottom: 10 },
  shiftRow: { flexDirection: 'row', gap: 10 },
  shiftBtn: { flex: 1, borderWidth: 1, borderColor: '#1976d2', padding: 12, borderRadius: 8, alignItems: 'center' },
  shiftDrafted: { backgroundColor: '#1976d2' },
  shiftSubmitted: { backgroundColor: '#4CAF50', borderColor: '#4CAF50' },
  shiftPending: { backgroundColor: '#ff9800', borderColor: '#ff9800' },
  shiftFull: { backgroundColor: COLORS.inputBg, borderColor: COLORS.border },
  shiftBtnText: { color: COLORS.primary, fontWeight: 'bold', fontSize: 13, textAlign: 'center' },
  textWhite: { color: '#fff' },
  textFull: { color: '#aaa' },

  storeChip: { backgroundColor: COLORS.inputBg, paddingHorizontal: 15, paddingVertical: 8, borderRadius: 20, marginRight: 10, borderWidth: 1, borderColor: COLORS.border },
  storeChipActive: { backgroundColor: '#4CAF50' },
  modalCloseText: { color: '#fff', fontWeight: 'bold' },
  badge: {
    position: 'absolute',
    top: -4,
    right: -4,
    backgroundColor: '#ff5252',
    borderRadius: 10,
    minWidth: 18,
    height: 18,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 4,
  },
  badgeText: {
    color: '#fff',
    fontSize: 10,
    fontWeight: 'bold',
  },
  storeChipText: { color: COLORS.textMuted, fontWeight: 'bold' },
  storeChipTextActive: { color: '#fff' },

  footerContainer: { position: 'absolute', bottom: 10, left: 0, right: 0 },
  submitBtn: { backgroundColor: '#e91e63', padding: 15, borderRadius: 10, alignItems: 'center', elevation: 3 },
  submitBtnText: { color: '#fff', fontWeight: 'bold', fontSize: 16 },

  // Lịch Tổng styles
  storeCard: { backgroundColor: COLORS.card, borderRadius: 12, marginBottom: 20, elevation: 3, shadowColor: '#000', shadowOpacity: isDarkMode ? 0.25 : 0.1, shadowRadius: 5, shadowOffset: {width: 0, height: 2}, overflow: 'hidden', borderWidth: 1, borderColor: COLORS.border },
  storeHeader: { flexDirection: 'row', alignItems: 'center', backgroundColor: COLORS.inputBg, padding: 12, borderBottomWidth: 1, borderBottomColor: COLORS.border },
  storeHeaderText: { fontSize: 16, fontWeight: 'bold', color: COLORS.text },
  horizontalScroll: { padding: 10, paddingRight: 20 },
  dayColumn: { width: 160, marginRight: 15, backgroundColor: COLORS.card, borderRadius: 8, borderWidth: 1, borderColor: COLORS.border, overflow: 'hidden' },
  dayColHeader: { backgroundColor: '#1976d2', color: '#fff', textAlign: 'center', paddingVertical: 8, fontWeight: 'bold', fontSize: 13 },
  dayColBody: { padding: 5 },
  shiftBox: { marginBottom: 10, borderRadius: 6, borderWidth: 1, borderColor: COLORS.border, overflow: 'hidden' },
  shiftBoxHeader: { paddingVertical: 4, paddingHorizontal: 6, borderBottomWidth: 1, borderBottomColor: COLORS.border },
  shiftBoxTitle: { fontWeight: 'bold', fontSize: 11, textAlign: 'center' },
  shiftBoxContent: { padding: 5, backgroundColor: COLORS.inputBg, minHeight: 60 },
  emptyStaff: { fontSize: 12, color: COLORS.textMuted, fontStyle: 'italic', textAlign: 'center', marginVertical: 10 },
  staffBadgeRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 },
  staffBadgeText: { fontSize: 11, color: COLORS.text, flex: 1, fontWeight: '600' },
  addBtnSmall: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', backgroundColor: '#e3f2fd', paddingVertical: 4, borderRadius: 4, marginTop: 5, borderWidth: 1, borderColor: '#bbdefb' },
  addBtnTextSmall: { color: '#1976d2', fontWeight: 'bold', fontSize: 11, marginLeft: 2 },
  iconActionBtn: { padding: 2 },

  // Modal styles
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', padding: 20 },
  modalContent: { backgroundColor: COLORS.card, borderRadius: 12, padding: 20, borderWidth: 1, borderColor: COLORS.border },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  modalTitle: { fontSize: 20, fontWeight: 'bold', color: COLORS.text },
  modalSubtitle: { fontSize: 14, color: COLORS.textMuted, marginTop: 5, marginBottom: 10 },
  staffSelectBtn: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: COLORS.border },
  staffSelectName: { fontSize: 16, fontWeight: 'bold', color: COLORS.text },
  staffSelectRole: { fontSize: 12, color: COLORS.textMuted, marginTop: 2 },

  // Thời Khóa Biểu
  timetableContainer: { backgroundColor: COLORS.card, borderRadius: 10, borderWidth: 1, borderColor: COLORS.border, overflow: 'hidden' },
  timeTableRow: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: COLORS.border },
  timeTableCell: { width: 100, minHeight: 70, borderRightWidth: 1, borderRightColor: COLORS.border, justifyContent: 'center', alignItems: 'center', padding: 5 },
  timeTableHeaderCell: { backgroundColor: COLORS.inputBg, minHeight: 40 },
  timeTableSidebarCell: { backgroundColor: COLORS.inputBg },
  timeTableTitle: { fontWeight: 'bold', fontSize: 12, color: COLORS.textMuted, textAlign: 'center' },
  timeTableSidebarText: { fontWeight: 'bold', fontSize: 12, color: COLORS.text },
  cellApproved: { backgroundColor: '#4CAF50' },
  cellPending: { backgroundColor: '#ff9800' },
  cellEmpty: { backgroundColor: COLORS.card },
  cellStoreText: { fontSize: 11, fontWeight: 'bold', textAlign: 'center' },
  cellStatusText: { fontSize: 9, textAlign: 'center' },
  cellEmptyText: { color: '#d1d5db' },

  // Swap Approval Box
  swapApprovalContainer: { backgroundColor: '#fff8e1', borderRadius: 8, padding: 12, marginBottom: 20, borderWidth: 1, borderColor: '#ffe082' },
  swapApprovalTitle: { fontWeight: 'bold', color: '#f57c00', marginBottom: 10, fontSize: 15 },
  swapItem: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: COLORS.card, padding: 10, borderRadius: 6, marginBottom: 8, elevation: 1, borderWidth: 1, borderColor: COLORS.border },
  swapItemText: { fontSize: 13, color: COLORS.text },
  swapItemDetail: { fontSize: 11, color: COLORS.textMuted, marginTop: 2 },
  swapActionBtn: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 4 }
});
