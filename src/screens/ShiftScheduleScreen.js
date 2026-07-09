import React, { useState, useContext, useMemo } from 'react';
import { Platform, View, Text, StyleSheet, TouchableOpacity, ScrollView, SafeAreaView, RefreshControl, Dimensions, Modal, Image } from 'react-native';
import { AppContext } from '../context/AppContext';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../services/supabaseClient';
import { Alert } from '../utils/alert';
import { scheduleShiftReminder, getManagersToNotify, sendPushNotification, sendNotificationToUser } from '../services/NotificationService';

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
    ? 'Táº¥t cáº£ chi nhÃ¡nh'
    : storeList.find((store) => store.id === myStoreId)?.name || `Chi nhÃ¡nh ${myStoreId || '--'}`;

  const canScheduleShift = isOwner || (isManager && currentUser?.permissions?.can_schedule_shift === true);

  const [activeTab, setActiveTab] = useState('PERSONAL');
  const [weekOffset, setWeekOffset] = useState(0);
  const [draftShifts, setDraftShifts] = useState([]); // [{date, shiftType, storeId}]
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const [deleteConfirmTarget, setDeleteConfirmTarget] = useState(null);

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

  // NhÃ¢n viÃªn chá»‰ Ä‘Äƒng kÃ½ vÃ o chi nhÃ¡nh gá»‘c cá»§a mÃ¬nh. Chá»§/Quáº£n lÃ½ sáº½ Ä‘iá»u Ä‘á»™ng sau.
  const [registerStoreId, setRegisterStoreId] = useState(currentUser?.store_id);

  // Modal Xáº¿p Ca
  const [showAssignModal, setShowAssignModal] = useState(false);
  const [assignTarget, setAssignTarget] = useState(null); // { date, shiftType }

  // Modal Äá»•i Ca
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
      Alert.alert('ThÃ nh cÃ´ng', 'ÄÃ£ gá»­i yÃªu cáº§u Ä‘á»•i ca. Äang chá» quáº£n lÃ½ duyá»‡t.');

      // Notify Manager
      const storeId = swapShiftReg.store_id;
      const managers = await getManagersToNotify(storeId);
      for (const manager of managers) {
        if (manager) {
          sendPushNotification(manager.push_token, 'YÃªu cáº§u Ä‘á»•i ca má»›i ðŸ””', `NhÃ¢n viÃªn ${currentUser.name} vá»«a gá»­i yÃªu cáº§u nhá» lÃ m thay ca.`, {}, manager.id);
        }
      }
    } catch (e) {
      Alert.alert('Lá»—i', e.message);
    }
  };

  const handleApproveSwap = async (swapId) => {
    try {
      const swap = shiftSwaps.find(s => s.id === swapId);
      if (!swap) return;

      const shiftToSwap = shiftRegistrations.find(r => r.id === swap.shift_id);
      if (!shiftToSwap) return;

      // VALIDATE: 1 ngÆ°á»i khÃ´ng Ä‘Æ°á»£c lÃ m 2 ca cÃ¹ng lÃºc
      const targetHasSameShift = shiftRegistrations.some(r => r.user_id === swap.target_user_id && r.date === shiftToSwap.date && r.shift_type === shiftToSwap.shift_type && (r.status === 'APPROVED' || r.status === 'PENDING'));
      if (targetHasSameShift) {
        Alert.alert('Tá»« chá»‘i Äá»•i Ca', 'NhÃ¢n viÃªn nháº­n ca ÄÃƒ CÃ“ Lá»ŠCH lÃ m viá»‡c vÃ o khung giá» nÃ y rá»“i. Vui lÃ²ng tá»« chá»‘i yÃªu cáº§u nÃ y!');
        return;
      }

      // VALIDATE: KhÃ´ng vÆ°á»£t quÃ¡ 2 ca/ngÃ y
      const targetShiftsThatDay = shiftRegistrations.filter(r => r.user_id === swap.target_user_id && r.date === shiftToSwap.date && (r.status === 'APPROVED' || r.status === 'PENDING'));
      if (targetShiftsThatDay.length >= 2) {
        Alert.alert('Tá»« chá»‘i Äá»•i Ca', 'NhÃ¢n viÃªn nháº­n ca ÄÃƒ KÃN Lá»ŠCH trong ngÃ y nÃ y. Vui lÃ²ng tá»« chá»‘i!');
        return;
      }

      // VALIDATE: 1 ngÃ y 1 chi nhÃ¡nh
      const hasDifferentStoreShift = targetShiftsThatDay.some(r => r.store_id !== shiftToSwap.store_id);
      if (hasDifferentStoreShift) {
        Alert.alert('Tá»« chá»‘i Äá»•i Ca', 'NhÃ¢n viÃªn nháº­n ca Ä‘ang cÃ³ lá»‹ch lÃ m á»Ÿ CHI NHÃNH KHÃC trong ngÃ y nÃ y. Vui lÃ²ng tá»« chá»‘i!');
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

      Alert.alert('ThÃ nh cÃ´ng', 'ÄÃ£ duyá»‡t Ä‘á»•i ca!');

      // Send notifications to both users
      const requester = staffList.find(s => s.id === swap.requester_id);
      const targetUser = staffList.find(s => s.id === swap.target_user_id);
      if (requester) {
        sendPushNotification(requester.push_token, 'Äá»•i ca thÃ nh cÃ´ng âœ…', 'Quáº£n lÃ½ Ä‘Ã£ duyá»‡t yÃªu cáº§u Ä‘á»•i ca cá»§a báº¡n.', {}, requester.id);
      }
      if (targetUser) {
        sendPushNotification(targetUser.push_token, 'Báº¡n cÃ³ ca má»›i ðŸ“…', 'Quáº£n lÃ½ Ä‘Ã£ duyá»‡t Ä‘á»•i ca. Báº¡n sáº½ lÃ m thay ca nÃ y.', {}, targetUser.id);
      }

    } catch (e) {
      Alert.alert('Lá»—i', e.message);
    }
  };

  const handleRejectSwap = async (swapId) => {
    try {
      const { error } = await supabase.from('shift_swaps').update({ status: 'REJECTED' }).eq('id', swapId);
      if (error) throw error;

      setShiftSwaps(shiftSwaps.map(s => s.id === swapId ? { ...s, status: 'REJECTED' } : s));
    } catch (e) {
      Alert.alert('Lá»—i', e.message);
    }
  };

  // Láº¥y danh sÃ¡ch 7 ngÃ y (Thá»© 2 - Chá»§ Nháº­t) cá»§a tuáº§n Ä‘Æ°á»£c chá»n
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

  const weekLabel = weekOffset === 0 ? 'Tuáº§n nÃ y' : weekOffset === 1 ? 'Tuáº§n sau' : weekOffset === -1 ? 'Tuáº§n trÆ°á»›c' : (weekOffset > 1 ? `Tuáº§n sau +${weekOffset-1}` : `CÃ¡ch Ä‘Ã¢y ${Math.abs(weekOffset)} tuáº§n`);
  const weekRangeText = `${weekLabel} (${getShortDate(weekDates[0])} - ${getShortDate(weekDates[6])})`;

  const isRegistrationLocked = (dateStr) => {
    const d = new Date(dateStr);
    const diffToMonday = d.getDay() === 0 ? 6 : d.getDay() - 1;
    const mondayOfThisWeek = new Date(d);
    mondayOfThisWeek.setDate(d.getDate() - diffToMonday);

    const previousSunday = new Date(mondayOfThisWeek);
    previousSunday.setDate(mondayOfThisWeek.getDate() - 1);
    previousSunday.setHours(13, 0, 0, 0); // 13:00 Chá»§ nháº­t tuáº§n trÆ°á»›c

    return new Date() > previousSunday;
  };

  const getDayName = (dateString) => {
    const d = new Date(dateString);
    const days = ['Chá»§ Nháº­t', 'Thá»© 2', 'Thá»© 3', 'Thá»© 4', 'Thá»© 5', 'Thá»© 6', 'Thá»© 7'];
    const dd = String(d.getDate()).padStart(2, '0');
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    return `${days[d.getDay()]} (${dd}/${mm})`;
  };

  // Láº¥y sá»‘ lÆ°á»£ng ngÆ°á»i Ä‘Ã£ Ä‘Äƒng kÃ½ trong 1 ca (Ä‘Ã£ gá»­i, bao gá»“m PENDING & APPROVED)
  const getShiftRegistrations = (date, shiftType) => {
    return shiftRegistrations.filter(r => r.date === date && r.shift_type === shiftType && r.store_id === myStoreId && (r.status === 'APPROVED' || r.status === 'PENDING'));
  };

  // Láº¥y sá»‘ ngÆ°á»i Ä‘Ã£ DUYá»†T
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
  // ÄÄ‚NG KÃ CA (GIá»Ž HÃ€NG)
  // =====================
  const handleToggleDraft = (date, shiftType) => {
    if (isRegistrationLocked(date)) {
      Alert.alert('Háº¿t háº¡n Ä‘Äƒng kÃ½', 'ÄÃ£ chá»‘t lá»‹ch. Báº¡n pháº£i Ä‘Äƒng kÃ½ ca lÃ m viá»‡c trÆ°á»›c 13:00 Chá»§ Nháº­t cá»§a tuáº§n trÆ°á»›c Ä‘Ã³.');
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
      Alert.alert('Cáº£nh bÃ¡o', 'Báº¡n chá»‰ Ä‘Æ°á»£c Ä‘Äƒng kÃ½ tá»‘i Ä‘a 2 ca/ngÃ y (SÃ¡ng vÃ  Chiá»u)!');
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
      setDraftShifts([]); // XÃ³a giá» hÃ ng

      // 1. LÃªn lá»‹ch bÃ¡o thá»©c cho nhÃ¢n viÃªn (trÆ°á»›c 60 phÃºt)
      for (const draft of draftShifts) {
        await scheduleShiftReminder(draft.date, draft.shiftType, 60);
      }

      // 2. Gá»­i Push Notification cho Quáº£n LÃ½ chi nhÃ¡nh
      const uniqueStoreIds = [...new Set(draftShifts.map(d => d.storeId))];
      for (const sId of uniqueStoreIds) {
        const managers = await getManagersToNotify(sId);
        for (const manager of managers) {
          await sendPushNotification(
            manager.push_token,
            'Lá»‹ch LÃ m Viá»‡c Má»›i',
            `NhÃ¢n viÃªn ${currentUser?.name} vá»«a gá»­i Ä‘Äƒng kÃ½ ca lÃ m viá»‡c. Äang chá» báº¡n duyá»‡t.`,
            {},
            manager.id
          );
        }
      }

      Alert.alert('ThÃ nh cÃ´ng', `ÄÃ£ gá»­i thÃ nh cÃ´ng ${newRegs.length} ca lÃ m viá»‡c. Vui lÃ²ng chá» quáº£n lÃ½ duyá»‡t!`);
    } catch (e) {
      Alert.alert('Lá»—i gá»­i Ä‘Äƒng kÃ½', e.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  // =====================
  // QUáº¢N LÃ CA LÃ€M VIá»†C
  // =====================
  const handleManagerDeleteShift = (regId, staffName, staffId) => {
    if (!canScheduleShift) {
      Alert.alert('KhÃ´ng cÃ³ quyá»n', 'Báº¡n khÃ´ng cÃ³ quyá»n xÃ³a ca lÃ m viá»‡c.');
      return;
    }
    setDeleteConfirmTarget({ regId, staffName, staffId });
  };

  const confirmDeleteShift = async () => {
    if (!deleteConfirmTarget) return;
    const { regId, staffName, staffId } = deleteConfirmTarget;
    try {
      // Láº¥y thÃ´ng tin ca Ä‘á»ƒ gá»­i thÃ´ng bÃ¡o trÆ°á»›c khi xÃ³a
      const shiftToDelete = shiftRegistrations.find(r => r.id === regId);

      const { error } = await supabase
        .from('shift_registrations')
        .delete()
        .eq('id', regId);
      if (error) {
        Alert.alert('Lá»—i xÃ³a ca', error.message || 'KhÃ´ng xÃ³a Ä‘Æ°á»£c, thá»­ láº¡i!');
        return;
      }
      setShiftRegistrations(prev => prev.filter(r => r.id !== regId));
      Alert.alert('ThÃ nh cÃ´ng', `ÄÃ£ xÃ³a ca cá»§a ${staffName}!`);

      // Gá»­i thÃ´ng bÃ¡o cho nhÃ¢n viÃªn bá»‹ xÃ³a ca (tá»± Ä‘á»™ng xá»­ lÃ½ push + in-app)
      if (staffId) {
        const shiftDateStr = shiftToDelete?.date ? ` ngÃ y ${shiftToDelete.date}` : '';
        const shiftTypeStr = shiftToDelete?.shift_type ? ` (ca ${shiftToDelete.shift_type})` : '';
        sendNotificationToUser(
          staffId,
          'ðŸ“… Ca lÃ m viá»‡c bá»‹ há»§y',
          `Ca lÃ m viá»‡c cá»§a báº¡n${shiftDateStr}${shiftTypeStr} Ä‘Ã£ bá»‹ quáº£n lÃ½ há»§y.`,
          { route: 'ScheduleTab', type: 'SHIFT_CANCELLED' }
        ).catch(e => console.log('Lá»—i gá»­i thÃ´ng bÃ¡o xÃ³a ca:', e?.message));
      }
    } catch (e) {
      Alert.alert('Lá»—i', e.message);
    } finally {
      setDeleteConfirmTarget(null);
    }
  };

  const handleApproveShift = async (regId, staffId) => {
    try {
      const shiftToApprove = shiftRegistrations.find(r => r.id === regId);

      // KIá»‚M TRA TRÃ™NG Lá»ŠCH KHI DUYá»†T
      if (shiftToApprove) {
        // 1. TrÃ¹ng ca: ÄÃ£ cÃ³ ca nÃ o Ä‘Æ°á»£c duyá»‡t á»Ÿ cÃ¹ng khung giá» nÃ y chÆ°a?
        const existingApprovedSameTime = shiftRegistrations.find(r => r.user_id === staffId && r.date === shiftToApprove.date && r.shift_type === shiftToApprove.shift_type && r.status === 'APPROVED' && r.id !== regId);
        if (existingApprovedSameTime) {
          Alert.alert('Lá»—i Duyá»‡t Ca', 'NhÃ¢n viÃªn nÃ y Ä‘Ã£ Ä‘Æ°á»£c duyá»‡t 1 ca lÃ m viá»‡c khÃ¡c vÃ o cÃ¹ng khung giá» nÃ y rá»“i!');
          return;
        }

        // 2. KÃ­n lá»‹ch: ÄÃ£ lÃ m Ä‘á»§ 2 ca/ngÃ y chÆ°a?
        const approvedShiftsThatDay = shiftRegistrations.filter(r => r.user_id === staffId && r.date === shiftToApprove.date && r.status === 'APPROVED' && r.id !== regId);
        if (approvedShiftsThatDay.length >= 2) {
          Alert.alert('Lá»—i Duyá»‡t Ca', 'NhÃ¢n viÃªn nÃ y Ä‘Ã£ kÃ­n lá»‹ch (2 ca) trong ngÃ y hÃ´m nay rá»“i!');
          return;
        }
      }

      const { error } = await supabase.from('shift_registrations').update({ status: 'APPROVED' }).eq('id', regId);
      if (error) throw error;

      // Auto-reject cÃ¡c ca PENDING bá»‹ xung Ä‘á»™t (cÃ¹ng khung giá»)
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
         sendPushNotification(staff.push_token, 'Lá»‹ch Ä‘Ã£ duyá»‡t âœ…', 'Ca lÃ m viá»‡c cá»§a báº¡n Ä‘Ã£ Ä‘Æ°á»£c quáº£n lÃ½ phÃª duyá»‡t!', {}, staff.id);
      }
    } catch (e) {
      Alert.alert('Lá»—i duyá»‡t ca', e.message);
    }
  };

  const handleRejectShift = async (regId, staffId) => {
    try {
      await supabase.from('shift_registrations').update({ status: 'REJECTED' }).eq('id', regId);
      setShiftRegistrations(shiftRegistrations.map(r => r.id === regId ? { ...r, status: 'REJECTED' } : r));

      const staff = staffList.find(s => s.id === staffId);
      if (staff) {
         sendPushNotification(staff.push_token, 'ÄÄƒng kÃ½ ca bá»‹ tá»« chá»‘i', 'ÄÄƒng kÃ½ ca lÃ m viá»‡c cá»§a báº¡n Ä‘Ã£ bá»‹ tá»« chá»‘i!', {}, staff.id);
      }
    } catch (e) {
      Alert.alert('Lá»—i tá»« chá»‘i ca', e.message);
    }
  };

  const handleAssignStaff = async (staffId) => {
    const { date, shiftType, storeId } = assignTarget;

    // TÃ¬m Ä‘Äƒng kÃ½ cá»§a nhÃ¢n viÃªn nÃ y trong ca Ä‘Ã³
    const existingReg = shiftRegistrations.find(r => r.user_id === staffId && r.date === date && r.shift_type === shiftType);

    try {
      if (existingReg) {
        // Cáº­p nháº­t store_id vÃ  duyá»‡t luÃ´n
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
        // Táº¡o Ä‘Äƒng kÃ½ má»›i tinh (Force Assign)
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
         sendPushNotification(staff.push_token, 'Äiá»u Ä‘á»™ng cÃ´ng tÃ¡c ðŸƒ', `Báº¡n Ä‘Ã£ Ä‘Æ°á»£c quáº£n lÃ½ xáº¿p sang lÃ m viá»‡c táº¡i ${storeName} cho ca Ä‘Äƒng kÃ½ nÃ y!`, {}, staff.id);
      }

      Alert.alert('ThÃ nh cÃ´ng', `ÄÃ£ Ä‘iá»u Ä‘á»™ng ${staff?.name} sang chi nhÃ¡nh nÃ y!`);
    } catch (e) {
      Alert.alert('Lá»—i', e.message);
    }
  };

  const renderPersonalSchedule = () => (
    <View style={styles.flexRoot}>
      <ScrollView
        keyboardShouldPersistTaps="handled"
        style={styles.flexRoot}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{paddingBottom: 100}}
        refreshControl={<RefreshControl refreshing={isDataLoading} onRefresh={refreshData} />}
      >
        <Text style={styles.sectionTitle}>Lá»‹ch lÃ m viá»‡c cÃ¡ nhÃ¢n</Text>

        <View style={styles.weekSelector}>
          <TouchableOpacity style={styles.weekBtn} onPress={() => setWeekOffset(weekOffset - 1)}>
            <Ionicons name="chevron-back" size={24} color="#1976d2" />
          </TouchableOpacity>
          <Text style={styles.weekText}>{weekRangeText}</Text>
          <TouchableOpacity style={styles.weekBtn} onPress={() => setWeekOffset(weekOffset + 1)}>
            <Ionicons name="chevron-forward" size={24} color="#1976d2" />
          </TouchableOpacity>
        </View>

        <ScrollView
        keyboardShouldPersistTaps="handled" horizontal showsHorizontalScrollIndicator={false}>
          <View style={styles.timetableContainer}>
            {/* Header Row: NgÃ y */}
            <View style={styles.timeTableRow}>
              <View style={[styles.timeTableCell, styles.timeTableHeaderCell, {width: 60, backgroundColor: '#1e3a8a', borderBottomColor: '#1e40af'}]}><Text style={[styles.timeTableTitle, {color: '#fff'}]}>Ca \ Thá»©</Text></View>
              {weekDates.map(date => (
                <View key={`header_${date}`} style={[styles.timeTableCell, styles.timeTableHeaderCell, {backgroundColor: '#1e3a8a', borderBottomColor: '#1e40af'}]}>
                  <Text style={[styles.timeTableTitle, {color: '#fff'}]}>{getDayName(date).replace(/ (\d{1,2}\/\d{1,2})/, '\n($1)')}</Text>
                </View>
              ))}
            </View>

            {/* Row SÃ¡ng */}
            <View style={styles.timeTableRow}>
              <View style={[styles.timeTableCell, styles.timeTableSidebarCell, {width: 60, backgroundColor: '#dcfce7', borderColor: '#86efac', borderWidth: 1}]}>
                <Text style={[styles.timeTableSidebarText, {color: '#15803d'}]}>SÃNG</Text>
              </View>
              {weekDates.map(date => {
                const myRegs = shiftRegistrations.filter(r => r.date === date && r.shift_type === 'MORNING' && r.user_id === currentUser.id);
                const reg = myRegs.find(r => r.status === 'APPROVED') || myRegs.find(r => r.status === 'PENDING');
                const sName = reg ? (storeList.find(s => s.id === reg.store_id)?.name || `CN ${reg.store_id}`) : '';
                const pendingSwap = reg ? shiftSwaps.find(s => s.shift_id === reg.id && s.status === 'PENDING') : null;
                const bgColor = reg ? (reg.status === 'APPROVED' ? getStoreColor(reg.store_id) : '#ff9800') : (isDarkMode ? '#12231b' : '#f0fdf4');

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
                          {pendingSwap ? '(Chá» Ä‘á»•i)' : (reg.status === 'APPROVED' ? '(ÄÃ£ duyá»‡t)' : '(Chá»)')}
                        </Text>
                      </>
                    ) : (
                      <Text style={styles.cellEmptyText}>-</Text>
                    )}
                  </TouchableOpacity>
                );
              })}
            </View>

            {/* Row Chiá»u */}
            <View style={styles.timeTableRow}>
              <View style={[styles.timeTableCell, styles.timeTableSidebarCell, {width: 60, backgroundColor: '#fef08a', borderColor: '#fde047', borderWidth: 1}]}>
                <Text style={[styles.timeTableSidebarText, {color: '#a16207'}]}>CHIá»€U</Text>
              </View>
              {weekDates.map(date => {
                const myRegs = shiftRegistrations.filter(r => r.date === date && r.shift_type === 'AFTERNOON' && r.user_id === currentUser.id);
                const reg = myRegs.find(r => r.status === 'APPROVED') || myRegs.find(r => r.status === 'PENDING');
                const sName = reg ? (storeList.find(s => s.id === reg.store_id)?.name || `CN ${reg.store_id}`) : '';
                const pendingSwap = reg ? shiftSwaps.find(s => s.shift_id === reg.id && s.status === 'PENDING') : null;
                const bgColor = reg ? (reg.status === 'APPROVED' ? getStoreColor(reg.store_id) : '#ff9800') : (isDarkMode ? '#2b2110' : '#fefce8');

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
                          {pendingSwap ? '(Chá» Ä‘á»•i)' : (reg.status === 'APPROVED' ? '(ÄÃ£ duyá»‡t)' : '(Chá»)')}
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
    <View style={styles.flexRoot}>
      <ScrollView
        keyboardShouldPersistTaps="handled"
        style={styles.flexRoot}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{paddingBottom: 100}}
        refreshControl={<RefreshControl refreshing={isDataLoading} onRefresh={refreshData} />}
      >
        <Text style={styles.sectionTitle}>ÄÄƒng kÃ½ lá»‹ch lÃ m viá»‡c (Tá»‘i Ä‘a 4 ngÆ°á»i/ca)</Text>
        <Text style={{fontSize: 13, color: COLORS.textMuted, fontStyle: 'italic', marginBottom: 15}}>LÆ°u Ã½: Báº¡n chá»‰ chá»n khung giá» ráº£nh. Quáº£n lÃ½ sáº½ tá»± Ä‘á»™ng Ä‘iá»u Ä‘á»™ng báº¡n vÃ o chi nhÃ¡nh phÃ¹ há»£p.</Text>

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
            <View key={date} style={[styles.card, isPastDate && styles.cardPast]}>
              <Text style={styles.dateText}>{getDayName(date)}</Text>
              <View style={styles.shiftRow}>
                {/* CA SÃNG */}
                {myMorningSubmitted ? (
                  <View style={[styles.shiftBtn, myMorningSubmitted.status === 'APPROVED' ? styles.shiftSubmitted : styles.shiftPending]}>
                    <Text style={[styles.shiftBtnText, styles.textWhite]}>
                      {myMorningSubmitted.status === 'APPROVED' ? `SÃNG - ${getStoreAbbr(myMorningSubmitted.store_id)}` : 'SÃNG'}
                    </Text>
                    <Text style={[styles.shiftBtnText, styles.textWhite, {fontSize: 10}]}>({myMorningSubmitted.status === 'APPROVED' ? 'ÄÃ£ Duyá»‡t' : 'Chá» Duyá»‡t'})</Text>
                  </View>
                ) : (
                  <TouchableOpacity
                    style={[styles.shiftBtn, myMorningDraft ? styles.shiftDrafted : {}]}
                    disabled={isPastDate}
                    onPress={() => handleToggleDraft(date, 'MORNING')}
                  >
                    <Text style={[styles.shiftBtnText, myMorningDraft ? styles.textWhite : {}]}>
                      {myMorningDraft ? 'SÃNG (Äang chá»n)' : `SÃNG (ÄÄƒng kÃ½)`}
                    </Text>
                  </TouchableOpacity>
                )}

                {/* CA CHIá»€U */}
                {myAfternoonSubmitted ? (
                  <View style={[styles.shiftBtn, myAfternoonSubmitted.status === 'APPROVED' ? styles.shiftSubmitted : styles.shiftPending]}>
                    <Text style={[styles.shiftBtnText, styles.textWhite]}>
                      {myAfternoonSubmitted.status === 'APPROVED' ? `CHIá»€U - ${getStoreAbbr(myAfternoonSubmitted.store_id)}` : 'CHIá»€U'}
                    </Text>
                    <Text style={[styles.shiftBtnText, styles.textWhite, {fontSize: 10}]}>({myAfternoonSubmitted.status === 'APPROVED' ? 'ÄÃ£ Duyá»‡t' : 'Chá» Duyá»‡t'})</Text>
                  </View>
                ) : (
                  <TouchableOpacity
                    style={[styles.shiftBtn, myAfternoonDraft ? styles.shiftDrafted : {}]}
                    disabled={isPastDate}
                    onPress={() => handleToggleDraft(date, 'AFTERNOON')}
                  >
                    <Text style={[styles.shiftBtnText, myAfternoonDraft ? styles.textWhite : {}]}>
                      {myAfternoonDraft ? 'CHIá»€U (Äang chá»n)' : `CHIá»€U (ÄÄƒng kÃ½)`}
                    </Text>
                  </TouchableOpacity>
                )}
              </View>
            </View>
          );
        })}
      </ScrollView>

      {/* FOOTER Gá»¬I ÄÄ‚NG KÃ */}
      {draftShifts.length > 0 && (
        <View style={styles.footerContainer}>
          <TouchableOpacity style={styles.submitBtn} onPress={handleSubmitDrafts} disabled={isSubmitting}>
            <Text style={styles.submitBtnText}>{isSubmitting ? 'ÄANG Gá»¬I...' : `Gá»¬I ÄÄ‚NG KÃ (${draftShifts.length} CA)`}</Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );

  // =====================
  // Lá»ŠCH Tá»”NG (OVERVIEW)
  // =====================
  const renderScheduleOverview = () => (
    <ScrollView
      style={styles.flexRoot}
      showsVerticalScrollIndicator={false}
      contentContainerStyle={{paddingBottom: 80}}
      refreshControl={<RefreshControl refreshing={isDataLoading} onRefresh={refreshData} />}
    >
      <Text style={styles.sectionTitle}>Lá»‹ch Tá»•ng - Táº¥t cáº£ chi nhÃ¡nh</Text>

      <View style={styles.weekSelector}>
        <TouchableOpacity style={styles.weekBtn} onPress={() => setWeekOffset(weekOffset - 1)}>
          <Ionicons name="chevron-back" size={24} color="#1976d2" />
        </TouchableOpacity>
        <Text style={styles.weekText}>{weekRangeText}</Text>
        <TouchableOpacity style={styles.weekBtn} onPress={() => setWeekOffset(weekOffset + 1)}>
          <Ionicons name="chevron-forward" size={24} color="#1976d2" />
        </TouchableOpacity>
      </View>

      {/* YÃªu cáº§u Äá»•i ca (DÃ nh cho Quáº£n lÃ½) */}
      {canScheduleShift && shiftSwaps.filter(s => s.status === 'PENDING').length > 0 && (
        <View style={styles.swapApprovalContainer}>
          <Text style={styles.swapApprovalTitle}>âš ï¸ Cáº§n Duyá»‡t Äá»•i Ca</Text>
          {shiftSwaps.filter(s => s.status === 'PENDING').map(swap => {
            const shift = shiftRegistrations.find(r => r.id === swap.shift_id);
            if (!shift) return null;
            const requester = staffList.find(u => u.id === swap.requester_id);
            const target = staffList.find(u => u.id === swap.target_user_id);
            const sName = storeList.find(s => s.id === shift.store_id)?.name || `CN ${shift.store_id}`;
            const dateStr = getDayName(shift.date);
            const shiftName = shift.shift_type === 'MORNING' ? 'SÃ¡ng' : 'Chiá»u';

            return (
              <View key={swap.id} style={styles.swapItem}>
                <View style={{flex: 1}}>
                  <Text style={styles.swapItemText}><Text style={{fontWeight: 'bold'}}>{requester?.name}</Text> muá»‘n nhÆ°á»£ng ca cho <Text style={{fontWeight: 'bold'}}>{target?.name}</Text></Text>
                  <Text style={styles.swapItemDetail}>Ca {shiftName} - {dateStr} táº¡i {sName}</Text>
                </View>
                <View style={{flexDirection: 'row', gap: 10}}>
                  <TouchableOpacity onPress={() => handleApproveSwap(swap.id)} style={[styles.swapActionBtn, {backgroundColor: '#4CAF50'}]}>
                    <Text style={{color: '#fff', fontSize: 12, fontWeight: 'bold'}}>Duyá»‡t</Text>
                  </TouchableOpacity>
                  <TouchableOpacity onPress={() => handleRejectSwap(swap.id)} style={[styles.swapActionBtn, {backgroundColor: '#f44336'}]}>
                    <Text style={{color: '#fff', fontSize: 12, fontWeight: 'bold'}}>Tá»« chá»‘i</Text>
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

            <ScrollView
        keyboardShouldPersistTaps="handled" horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.horizontalScroll}>
              {weekDates.map(date => {
                const isPastDate = new Date(date).setHours(0,0,0,0) < new Date().setHours(0,0,0,0);
                const morningRegs = shiftRegistrations.filter(r => r.date === date && r.shift_type === 'MORNING' && r.store_id === storeId);
                const afternoonRegs = shiftRegistrations.filter(r => r.date === date && r.shift_type === 'AFTERNOON' && r.store_id === storeId);

                const getStaffDetails = (userId) => {
                  const staff = staffList.find(s => s.id === userId);
                  if (!staff) return { name: 'Unknown', label: '', bgColor: '#f0fdfa', textColor: '#0f766e' };

                  let label = 'PC'; // Pha cháº¿ máº·c Ä‘á»‹nh
                  if (staff.role === 'OWNER') label = 'CHá»¦';
                  else if (staff.role === 'MANAGER') label = 'QL';
                  else if (staff.permissions?.cashier) label = 'TN'; // Thu ngÃ¢n

                  // Táº¡o mÃ u ngáº«u nhiÃªn nhÆ°ng cá»‘ Ä‘á»‹nh theo userId
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
                            <View key={r.id} style={[styles.staffBadgeRow, {backgroundColor: s.bgColor, paddingHorizontal: 5, paddingVertical: 5, borderRadius: 6, marginBottom: 4}]}>
                              <View style={{flexDirection: 'row', alignItems: 'center', flex: 1}}>
                                {s.avatar_url ? (
                                  <Image source={{uri: s.avatar_url}} style={{width: 18, height: 18, borderRadius: 9, marginRight: 5}} />
                                ) : (
                                  <View style={{width: 18, height: 18, borderRadius: 9, marginRight: 5, backgroundColor: s.textColor, justifyContent: 'center', alignItems: 'center'}}>
                                    <Text style={{color: s.bgColor, fontSize: 8, fontWeight: 'bold'}}>{s.label}</Text>
                                  </View>
                                )}
                                <Text style={[styles.staffBadgeText, {color: s.textColor}]} numberOfLines={1}>
                                  {getDisplayName(s.name, staffList)}
                                </Text>
                              </View>
                              {canScheduleShift && !isPastDate && (
                                <TouchableOpacity
                                  hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
                                  style={styles.iconActionBtn}
                                  onPress={() => handleManagerDeleteShift(r.id, s.name, r.user_id)}
                                >
                                  <Ionicons name="close-circle" size={18} color={s.textColor} />
                                </TouchableOpacity>
                              )}
                            </View>
                          );
                        })}

                        {pending.map(r => {
                          const s = getStaffDetails(r.user_id);
                          return (
                            <View key={r.id} style={[styles.staffBadgeRow, {backgroundColor: '#fffbeb', paddingHorizontal: 5, paddingVertical: 5, borderRadius: 6, borderWidth: 1, borderColor: '#fde047', marginBottom: 4}]}>
                              <View style={{flexDirection: 'row', alignItems: 'center', flex: 1}}>
                                {s.avatar_url ? (
                                  <Image source={{uri: s.avatar_url}} style={{width: 18, height: 18, borderRadius: 9, marginRight: 5, opacity: 0.7}} />
                                ) : (
                                  <View style={{width: 18, height: 18, borderRadius: 9, marginRight: 5, backgroundColor: '#fcd34d', justifyContent: 'center', alignItems: 'center'}}>
                                    <Text style={{color: '#b45309', fontSize: 8, fontWeight: 'bold'}}>{s.label}</Text>
                                  </View>
                                )}
                                <Text style={[styles.staffBadgeText, {color: '#b45309'}]} numberOfLines={1}>
                                  â³ {getDisplayName(s.name, staffList)}
                                </Text>
                              </View>
                              {canScheduleShift && !isPastDate && (
                                <View style={{flexDirection: 'row', gap: 6}}>
                                  <TouchableOpacity hitSlop={{ top: 10, bottom: 10, left: 8, right: 8 }} onPress={() => handleApproveShift(r.id, r.user_id)}>
                                    <Ionicons name="checkmark-circle" size={20} color="#22c55e" />
                                  </TouchableOpacity>
                                  <TouchableOpacity hitSlop={{ top: 10, bottom: 10, left: 8, right: 8 }} onPress={() => handleRejectShift(r.id, r.user_id)}>
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
                            <Text style={styles.addBtnTextSmall}>Xáº¿p</Text>
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
                      {renderShiftBox(morningRegs, 'MORNING', 'SÃNG', '#15803d', '#dcfce7', '#86efac')}
                      {renderShiftBox(afternoonRegs, 'AFTERNOON', 'CHIá»€U', '#a16207', '#fef08a', '#fde047')}
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
      <View style={styles.stickyTopBar}>
      <View style={styles.headerRow}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={24} color="#1976d2" />
        </TouchableOpacity>
        <Text style={styles.header}>Quáº£n lÃ½ Lá»‹ch LÃ m Viá»‡c</Text>
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
          <Text style={[styles.tabText, activeTab === 'PERSONAL' && styles.tabTextActive]}>CÃ¡ NhÃ¢n</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.tabBtn, activeTab === 'SCHEDULE' && styles.tabBtnActive]} onPress={() => setActiveTab('SCHEDULE')}>
          <Text style={[styles.tabText, activeTab === 'SCHEDULE' && styles.tabTextActive]}>Lá»‹ch QuÃ¡n</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.tabBtn, activeTab === 'REGISTER' && styles.tabBtnActive]} onPress={() => setActiveTab('REGISTER')}>
          <Text style={[styles.tabText, activeTab === 'REGISTER' && styles.tabTextActive]}>ÄÄƒng KÃ½</Text>
        </TouchableOpacity>
      </View>
      </View>

      <View style={styles.contentArea}>
        {activeTab === 'PERSONAL' && renderPersonalSchedule()}
        {activeTab === 'SCHEDULE' && renderScheduleOverview()}
        {activeTab === 'REGISTER' && renderStaffRegister()}
      </View>

      {/* Modal Chá»n NhÃ¢n ViÃªn Äá»ƒ Xáº¿p Ca */}
      <Modal visible={showAssignModal} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Xáº¿p NhÃ¢n ViÃªn</Text>
              <TouchableOpacity onPress={() => setShowAssignModal(false)}>
                <Ionicons name="close" size={24} color={COLORS.textMuted} />
              </TouchableOpacity>
            </View>
            <Text style={styles.modalSubtitle}>
              {assignTarget ? `${assignTarget.shiftType === 'MORNING' ? 'Ca SÃ¡ng' : 'Ca Chiá»u'} - ${getDayName(assignTarget.date)}` : ''}
            </Text>
            <ScrollView keyboardShouldPersistTaps="handled" style={{maxHeight: 300, marginTop: 10}}>
              {staffList.filter(staff => {
                if (!assignTarget) return false;
                if (staff.is_active === false) return false; // KhÃ´ng xáº¿p nhÃ¢n viÃªn Ä‘Ã£ nghá»‰

                // 1. Kiá»ƒm tra nhÃ¢n viÃªn cÃ³ Ä‘Æ°á»£c phÃ©p lÃ m á»Ÿ chi nhÃ¡nh Ä‘Ã­ch khÃ´ng
                const isAllowedAtStore = staff.store_id === assignTarget.storeId || staff.permissions?.viewable_stores?.includes(assignTarget.storeId);
                if (!isAllowedAtStore) return false;

                const staffShiftsToday = shiftRegistrations.filter(r => r.user_id === staff.id && r.date === assignTarget.date);

                const sameShiftReg = staffShiftsToday.find(r => r.shift_type === assignTarget.shiftType);

                // Náº¿u Ä‘Ã£ Ä‘Æ°á»£c duyá»‡t lÃ m viá»‡c táº¡i CHI NHÃNH KHÃC trong Ä‘Ãºng ca nÃ y -> KhÃ´ng Ä‘Æ°á»£c xáº¿p ná»¯a
                if (sameShiftReg && sameShiftReg.status === 'APPROVED' && sameShiftReg.store_id !== assignTarget.storeId) return false;

                // Náº¿u Ä‘Ã£ Ä‘Æ°á»£c duyá»‡t lÃ m viá»‡c Táº I ÄÃ‚Y trong Ä‘Ãºng ca nÃ y -> áº¨n Ä‘i cho Ä‘á»¡ rá»‘i (vÃ¬ Ä‘Ã£ cÃ³ trÃªn lá»‹ch)
                if (sameShiftReg && sameShiftReg.status === 'APPROVED' && sameShiftReg.store_id === assignTarget.storeId) return false;

                // 4. Luáº­t 1 ngÃ y 1 chi nhÃ¡nh: Náº¿u há» cÃ³ 1 ca KHÃC á»Ÿ chi nhÃ¡nh khÃ¡c Ä‘Ã£ APPROVED (vÃ­ dá»¥ SÃ¡ng lÃ m á»Ÿ A, thÃ¬ chiá»u khÃ´ng thá»ƒ lÃ m á»Ÿ B)
                const hasOtherStoreDifferentShift = staffShiftsToday.some(r => r.store_id !== assignTarget.storeId && r.shift_type !== assignTarget.shiftType && r.status === 'APPROVED');
                if (hasOtherStoreDifferentShift) return false;

                return true;
              }).map(staff => (
                <TouchableOpacity key={staff.id} style={styles.staffSelectBtn} onPress={() => handleAssignStaff(staff.id)}>
                  <View>
                    <Text style={styles.staffSelectName}>{staff.name}</Text>
                    <Text style={styles.staffSelectRole}>{staff.role === 'MANAGER' ? 'Quáº£n LÃ½' : staff.role === 'STAFF' ? 'NhÃ¢n ViÃªn' : 'Chá»§ Cá»­a HÃ ng'}</Text>
                  </View>
                  <Ionicons name="add-circle" size={24} color="#1976d2" />
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* Modal XÃ¡c Nháº­n XÃ³a Ca */}
      <Modal visible={!!deleteConfirmTarget} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>XÃ³a Ca LÃ m Viá»‡c</Text>
              <TouchableOpacity onPress={() => setDeleteConfirmTarget(null)}>
                <Ionicons name="close" size={24} color={COLORS.textMuted} />
              </TouchableOpacity>
            </View>
            <Text style={[styles.modalSubtitle, { marginBottom: 20 }]}>
              Báº¡n cÃ³ cháº¯c muá»‘n xÃ³a ca cá»§a {deleteConfirmTarget?.staffName} khÃ´ng?
            </Text>
            <View style={{ flexDirection: 'row', justifyContent: 'flex-end', gap: 10 }}>
              <TouchableOpacity style={[styles.btn, { backgroundColor: '#f3f4f6', paddingHorizontal: 20 }]} onPress={() => setDeleteConfirmTarget(null)}>
                <Text style={{ color: '#4b5563', fontWeight: 'bold' }}>Há»§y</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.btn, { backgroundColor: '#ef4444', paddingHorizontal: 20 }]} onPress={confirmDeleteShift}>
                <Text style={{ color: '#fff', fontWeight: 'bold' }}>XÃ³a</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Modal Chá»n NhÃ¢n ViÃªn Äá»ƒ Äá»•i Ca */}
      <Modal visible={showSwapModal} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Xin Äá»•i Ca</Text>
              <TouchableOpacity onPress={() => setShowSwapModal(false)}>
                <Ionicons name="close" size={24} color={COLORS.textMuted} />
              </TouchableOpacity>
            </View>
            <Text style={styles.modalSubtitle}>
              Chá»n Ä‘á»“ng nghiá»‡p báº¡n muá»‘n nhá» lÃ m thay:
            </Text>
            <ScrollView keyboardShouldPersistTaps="handled" style={{maxHeight: 300, marginTop: 10}}>
              {staffList.filter(staff => {
                if (staff.id === currentUser.id) return false;
                if (!swapShiftReg) return false;

                // 1. KhÃ´ng hiá»ƒn thá»‹ nhÃ¢n viÃªn Ä‘Ã£ cÃ³ ca lÃ m viá»‡c á»Ÿ cÃ¹ng khung giá» SÃ¡ng/Chiá»u Ä‘Ã³
                const targetHasSameShift = shiftRegistrations.some(r => r.user_id === staff.id && r.date === swapShiftReg.date && r.shift_type === swapShiftReg.shift_type && (r.status === 'APPROVED' || r.status === 'PENDING'));
                if (targetHasSameShift) return false;

                // 2. KhÃ´ng hiá»ƒn thá»‹ nhÃ¢n viÃªn Ä‘Ã£ lÃ m 2 ca trong ngÃ y Ä‘Ã³ (kÃ­n lá»‹ch)
                const targetShiftsThatDay = shiftRegistrations.filter(r => r.user_id === staff.id && r.date === swapShiftReg.date && (r.status === 'APPROVED' || r.status === 'PENDING'));
                if (targetShiftsThatDay.length >= 2) return false;

                // 3. Quy táº¯c 1 ngÃ y 1 chi nhÃ¡nh: Náº¿u nhÃ¢n viÃªn Ä‘Ã£ cÃ³ ca lÃ m viá»‡c khÃ¡c trong ngÃ y, thÃ¬ pháº£i cÃ¹ng chi nhÃ¡nh vá»›i ca Ä‘ang xin Ä‘á»•i
                const hasDifferentStoreShift = targetShiftsThatDay.some(r => r.store_id !== swapShiftReg.store_id);
                if (hasDifferentStoreShift) return false;

                return true;
              }).map(staff => (
                <TouchableOpacity key={staff.id} style={styles.staffSelectBtn} onPress={() => handleRequestSwap(staff.id)}>
                  <View>
                    <Text style={styles.staffSelectName}>{staff.name}</Text>
                    <Text style={styles.staffSelectRole}>{staff.role === 'MANAGER' ? 'Quáº£n LÃ½' : staff.role === 'STAFF' ? 'NhÃ¢n ViÃªn' : 'Chá»§ Cá»­a HÃ ng'}</Text>
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
  container: { flex: 1, minHeight: 0, overflow: Platform.OS === 'web' ? 'visible' : 'hidden', backgroundColor: COLORS.bg },
  flexRoot: { flex: 1, minHeight: 0 },
  contentArea: { flex: 1, minHeight: 0, paddingHorizontal: 20 },
  stickyTopBar: { backgroundColor: COLORS.bg, paddingBottom: 10, ...(Platform.OS === 'web' ? { position: 'sticky', top: 0, zIndex: 40 } : null) },
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
  cardPast: { opacity: 0.65, backgroundColor: isDarkMode ? '#111827' : '#f5f5f5' },
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

  // Lá»‹ch Tá»•ng styles
  storeCard: { backgroundColor: COLORS.card, borderRadius: 12, marginBottom: 20, elevation: 3, shadowColor: '#000', shadowOpacity: isDarkMode ? 0.25 : 0.1, shadowRadius: 5, shadowOffset: {width: 0, height: 2}, overflow: 'hidden', borderWidth: 1, borderColor: COLORS.border },
  storeHeader: { flexDirection: 'row', alignItems: 'center', backgroundColor: COLORS.inputBg, padding: 12, borderBottomWidth: 1, borderBottomColor: COLORS.border },
  storeHeaderText: { fontSize: 16, fontWeight: 'bold', color: COLORS.text },
  horizontalScroll: { padding: 10, paddingRight: 20 },
  dayColumn: { width: 160, marginRight: 10, backgroundColor: COLORS.card, borderRadius: 8, borderWidth: 1, borderColor: COLORS.border, overflow: 'hidden' },
  dayColHeader: { backgroundColor: '#1976d2', color: '#fff', textAlign: 'center', paddingVertical: 6, fontWeight: 'bold', fontSize: 12 },
  dayColBody: { padding: 5 },
  shiftBox: { marginBottom: 8, borderRadius: 6, borderWidth: 1, borderColor: COLORS.border, overflow: 'hidden' },
  shiftBoxHeader: { paddingVertical: 4, paddingHorizontal: 6, borderBottomWidth: 1, borderBottomColor: COLORS.border },
  shiftBoxTitle: { fontWeight: 'bold', fontSize: 10, textAlign: 'center' },
  shiftBoxContent: { padding: 5, backgroundColor: COLORS.inputBg, minHeight: 50 },
  emptyStaff: { fontSize: 11, color: COLORS.textMuted, fontStyle: 'italic', textAlign: 'center', marginVertical: 8 },
  staffBadgeRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 0 },
  staffBadgeText: { fontSize: 11, color: COLORS.text, flex: 1, fontWeight: '600' },
  addBtnSmall: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', backgroundColor: isDarkMode ? '#0f2a44' : '#e3f2fd', paddingVertical: 5, borderRadius: 4, marginTop: 4, borderWidth: 1, borderColor: isDarkMode ? '#1d4ed8' : '#bbdefb' },
  addBtnTextSmall: { color: isDarkMode ? '#93c5fd' : '#1976d2', fontWeight: 'bold', fontSize: 11, marginLeft: 2 },
  iconActionBtn: { padding: 5, marginLeft: 2 },

  // Modal styles
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', padding: 20 },
  modalContent: { backgroundColor: COLORS.card, borderRadius: 12, padding: 20, borderWidth: 1, borderColor: COLORS.border },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  modalTitle: { fontSize: 20, fontWeight: 'bold', color: COLORS.text },
  modalSubtitle: { fontSize: 14, color: COLORS.textMuted, marginTop: 5, marginBottom: 10 },
  staffSelectBtn: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: COLORS.border },
  staffSelectName: { fontSize: 16, fontWeight: 'bold', color: COLORS.text },
  staffSelectRole: { fontSize: 12, color: COLORS.textMuted, marginTop: 2 },

  // Thá»i KhÃ³a Biá»ƒu
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
  cellEmptyText: { color: isDarkMode ? '#64748b' : '#94a3b8' },

  // Swap Approval Box
  swapApprovalContainer: { backgroundColor: isDarkMode ? '#2b2110' : '#fff8e1', borderRadius: 8, padding: 12, marginBottom: 20, borderWidth: 1, borderColor: isDarkMode ? '#92400e' : '#ffe082' },
  swapApprovalTitle: { fontWeight: 'bold', color: isDarkMode ? '#fbbf24' : '#f57c00', marginBottom: 10, fontSize: 15 },
  swapItem: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: COLORS.card, padding: 10, borderRadius: 6, marginBottom: 8, elevation: 1, borderWidth: 1, borderColor: COLORS.border },
  swapItemText: { fontSize: 13, color: COLORS.text },
  swapItemDetail: { fontSize: 11, color: COLORS.textMuted, marginTop: 2 },
  swapActionBtn: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 4 }
});
