import React, { useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, RefreshControl, SafeAreaView, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Alert } from '../utils/alert';
import { AppContext } from '../context/AppContext';
import { supabase } from '../services/supabaseClient';
import { getLocalDateKey, formatDate } from '../utils/dateTime';

const REQUEST_TYPES = [
  { key: 'MISSING_CHECKIN', label: 'Quên check-in' },
  { key: 'MISSING_CHECKOUT', label: 'Quên check-out' },
  { key: 'CORRECT_TIME', label: 'Sai giờ chấm công' },
];

const monthKey = (date) => String(date || '').slice(0, 7);
const isTime = (value) => /^([01]\d|2[0-3]):[0-5]\d$/.test(String(value || '').trim());
const hoursBetween = (date, start, end) => {
  if (!isTime(start) || !isTime(end)) return 0;
  const startAt = new Date(`${date}T${start}:00`).getTime();
  let endAt = new Date(`${date}T${end}:00`).getTime();
  if (endAt < startAt) endAt += 24 * 60 * 60 * 1000;
  return Math.round(((endAt - startAt) / 3600000) * 100) / 100;
};

export default function AttendanceCorrectionScreen({ navigation }) {
  const { currentUser, storeList, refreshData, COLORS, isDarkMode } = useContext(AppContext);
  const styles = useMemo(() => getStyles(COLORS, isDarkMode), [COLORS, isDarkMode]);
  const isStaff = currentUser?.role === 'STAFF';
  const isOwner = currentUser?.role === 'OWNER';
  const viewableStores = currentUser?.permissions?.viewable_stores || [];
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [date, setDate] = useState(getLocalDateKey());
  const [type, setType] = useState('MISSING_CHECKIN');
  const [checkIn, setCheckIn] = useState('');
  const [checkOut, setCheckOut] = useState('');
  const [reason, setReason] = useState('');
  const [submitFeedback, setSubmitFeedback] = useState('');

  const allowedStoreIds = isOwner
    ? storeList.map((store) => store.id)
    : (viewableStores.length ? viewableStores : [currentUser?.store_id]);

  const loadRequests = useCallback(async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase.from('attendance_correction_requests').select('*').order('created_at', { ascending: false });
      if (error) throw error;
      setRequests(data || []);
    } catch (error) {
      Alert.alert('Không tải được yêu cầu', error?.message || 'Vui lòng thử lại.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadRequests();
    const unsubscribe = navigation.addListener('focus', loadRequests);
    return unsubscribe;
  }, [navigation, loadRequests]);

  const visibleRequests = requests.filter((request) => {
    if (isStaff) return String(request.user_id) === String(currentUser?.id);
    return allowedStoreIds.some((storeId) => String(storeId) === String(request.store_id));
  });

  const isLockedMonth = async (targetDate, userId = currentUser?.id) => {
    const { data, error } = await supabase.from('payroll_approvals').select('*').eq('user_id', userId);
    if (error) throw error;
    return (data || []).some((approval) => approval.month === monthKey(targetDate) && approval.owner_confirmed === true);
  };

  const submitRequest = async () => {
    const today = getLocalDateKey();
    const earliest = new Date(`${today}T00:00:00`);
    earliest.setDate(earliest.getDate() - 3);
    const earliestKey = getLocalDateKey(earliest);
    const cleanReason = reason.trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date > today || date < earliestKey) {
      setSubmitFeedback('Chọn ngày trong vòng 3 ngày gần đây.');
      Alert.alert('Ngoài thời hạn', 'Bạn chỉ được gửi yêu cầu bổ sung công trong vòng 3 ngày, không tính ngày tương lai.');
      return;
    }
    if (!cleanReason) {
      setSubmitFeedback('Vui lòng nhập lý do trước khi gửi.');
      Alert.alert('Thiếu lý do', 'Vui lòng ghi rõ lý do cần bổ sung hoặc sửa công.');
      return;
    }
    if ((type === 'MISSING_CHECKIN' || type === 'CORRECT_TIME') && !isTime(checkIn)) {
      Alert.alert('Sai giờ check-in', 'Nhập giờ theo dạng HH:MM, ví dụ 08:30.');
      return;
    }
    if ((type === 'MISSING_CHECKOUT' || type === 'CORRECT_TIME') && !isTime(checkOut)) {
      Alert.alert('Sai giờ check-out', 'Nhập giờ theo dạng HH:MM, ví dụ 17:30.');
      return;
    }
    if (type === 'CORRECT_TIME' && hoursBetween(date, checkIn, checkOut) <= 0) {
      Alert.alert('Thời gian không hợp lệ', 'Giờ check-out phải sau giờ check-in.');
      return;
    }
    const thisMonthRequests = visibleRequests.filter((request) => monthKey(request.created_at || request.date) === monthKey(date));
    if (thisMonthRequests.length >= 2) {
      Alert.alert('Đã đạt giới hạn', 'Mỗi nhân viên chỉ được gửi tối đa 2 yêu cầu bổ sung công trong một tháng.');
      return;
    }
    if (visibleRequests.some((request) => request.date === date && request.status === 'PENDING')) {
      Alert.alert('Đang chờ duyệt', 'Bạn đã có một yêu cầu bổ sung công cho ngày này.');
      return;
    }

    setSubmitting(true);
    try {
      if (await isLockedMonth(date)) {
        Alert.alert('Bảng lương đã chốt', 'Tháng này đã được Chủ quán chốt lương nên không thể gửi yêu cầu mới.');
        return;
      }
      const request = {
        id: `att_fix_${Date.now()}_${currentUser.id}`,
        user_id: currentUser.id,
        user_name: currentUser.name || 'Nhân viên',
        store_id: currentUser.store_id,
        date,
        request_type: type,
        requested_check_in: type === 'MISSING_CHECKOUT' ? '' : checkIn,
        requested_check_out: type === 'MISSING_CHECKIN' ? '' : checkOut,
        reason: cleanReason,
        status: 'PENDING',
        created_at: new Date().toISOString(),
      };
      const { error } = await supabase.from('attendance_correction_requests').insert([request]);
      if (error) throw error;
      setRequests((current) => [request, ...current]);
      setCheckIn('');
      setCheckOut('');
      setReason('');
      Alert.alert('Đã gửi', 'Yêu cầu bổ sung công đã gửi quản lý duyệt.');
    } catch (error) {
      Alert.alert('Không thể gửi yêu cầu', error?.message || 'Vui lòng thử lại.');
    } finally {
      setSubmitting(false);
    }
  };

  const decideRequest = async (request, approved) => {
    if (!approved) {
      const updates = { status: 'REJECTED', reviewed_by: currentUser.name, reviewed_at: new Date().toISOString(), review_note: 'Quản lý từ chối yêu cầu.' };
      const { error } = await supabase.from('attendance_correction_requests').update(updates).eq('id', request.id);
      if (error) { Alert.alert('Không thể từ chối', error.message); return; }
      setRequests((current) => current.map((item) => item.id === request.id ? { ...item, ...updates } : item));
      return;
    }
    try {
      if (await isLockedMonth(request.date, request.user_id)) {
        Alert.alert('Bảng lương đã chốt', 'Chỉ Chủ quán có thể mở lại bảng lương trước khi duyệt bổ sung công.');
        return;
      }
      const { data: rows, error: recordError } = await supabase.from('attendance_logs').select('*').eq('user_id', request.user_id).eq('date', request.date);
      if (recordError) throw recordError;
      const existing = (rows || [])[0];
      const nextCheckIn = request.requested_check_in || existing?.check_in || existing?.checkIn || '';
      const nextCheckOut = request.requested_check_out || existing?.check_out || existing?.checkOut || '';
      if (!nextCheckIn) throw new Error('Thiếu giờ check-in để tạo công.');
      const attendanceUpdate = {
        check_in: nextCheckIn,
        check_out: nextCheckOut || null,
        hours: nextCheckOut ? hoursBetween(request.date, nextCheckIn, nextCheckOut) : 0,
        correction_note: `Bổ sung công duyệt bởi ${currentUser.name || 'quản lý'}`,
      };
      if (existing) {
        const { error } = await supabase.from('attendance_logs').update(attendanceUpdate).eq('id', existing.id);
        if (error) throw error;
      } else {
        const created = {
          id: `att_manual_${Date.now()}_${request.user_id}`,
          user_id: request.user_id,
          store_id: request.store_id,
          date: request.date,
          ...attendanceUpdate,
          check_in_at: `${request.date}T${nextCheckIn}:00`,
          check_out_at: nextCheckOut ? `${request.date}T${nextCheckOut}:00` : null,
        };
        const { error } = await supabase.from('attendance_logs').insert([created]);
        if (error) throw error;
      }
      const updates = { status: 'APPROVED', reviewed_by: currentUser.name, reviewed_at: new Date().toISOString(), review_note: 'Đã cập nhật giờ công.' };
      const { error } = await supabase.from('attendance_correction_requests').update(updates).eq('id', request.id);
      if (error) throw error;
      setRequests((current) => current.map((item) => item.id === request.id ? { ...item, ...updates } : item));
      await refreshData();
      Alert.alert('Đã duyệt', 'Giờ công đã được cập nhật và sẽ được tính vào bảng lương.');
    } catch (error) {
      Alert.alert('Không thể duyệt', error?.message || 'Vui lòng thử lại.');
    }
  };

  const statusColor = (status) => status === 'APPROVED' ? '#15803d' : status === 'REJECTED' ? '#dc2626' : '#b45309';
  const statusLabel = (status) => status === 'APPROVED' ? 'Đã duyệt' : status === 'REJECTED' ? 'Từ chối' : 'Chờ duyệt';

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.headerRow}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}><Ionicons name="arrow-back" size={24} color={COLORS.text} /></TouchableOpacity>
        <View style={{ flex: 1 }}><Text style={styles.header}>{isStaff ? 'Bổ sung công' : 'Yêu cầu bổ sung công'}</Text><Text style={styles.caption}>{isStaff ? 'Tối đa 2 yêu cầu/tháng · trong 3 ngày' : 'Duyệt để cập nhật giờ công thực tế'}</Text></View>
      </View>
      <ScrollView contentContainerStyle={styles.content} refreshControl={<RefreshControl refreshing={loading} onRefresh={loadRequests} tintColor={COLORS.primary} />} keyboardShouldPersistTaps="handled">
        {isStaff && (
          <View style={styles.formCard}>
            <Text style={styles.cardTitle}>Tạo yêu cầu</Text>
            <Text style={styles.ruleText}>Chỉ gửi cho công của chính bạn; tháng lương đã chốt sẽ không thể sửa.</Text>
            <Text style={styles.label}>Ngày làm (YYYY-MM-DD)</Text><TextInput value={date} onChangeText={setDate} style={styles.input} placeholder="2026-07-13" placeholderTextColor={COLORS.textMuted} />
            <Text style={styles.label}>Loại yêu cầu</Text>
            <View style={styles.typeRow}>{REQUEST_TYPES.map((item) => <TouchableOpacity key={item.key} onPress={() => setType(item.key)} style={[styles.typeChip, type === item.key && styles.typeChipActive]}><Text style={[styles.typeText, type === item.key && styles.typeTextActive]}>{item.label}</Text></TouchableOpacity>)}</View>
            {type !== 'MISSING_CHECKOUT' && <><Text style={styles.label}>Giờ check-in đề nghị</Text><TextInput value={checkIn} onChangeText={setCheckIn} style={styles.input} placeholder="08:30" placeholderTextColor={COLORS.textMuted} keyboardType="numbers-and-punctuation" /></>}
            {type !== 'MISSING_CHECKIN' && <><Text style={styles.label}>Giờ check-out đề nghị</Text><TextInput value={checkOut} onChangeText={setCheckOut} style={styles.input} placeholder="17:30" placeholderTextColor={COLORS.textMuted} keyboardType="numbers-and-punctuation" /></>}
            <Text style={styles.label}>Lý do</Text><TextInput value={reason} onChangeText={setReason} style={[styles.input, styles.reasonInput]} multiline placeholder="Ví dụ: quên bấm check-out vì hỗ trợ đóng quán" placeholderTextColor={COLORS.textMuted} />
            <TouchableOpacity style={[styles.submitBtn, submitting && { opacity: 0.7 }]} onPress={() => submitRequest()} activeOpacity={0.8} disabled={submitting} accessibilityRole="button" accessibilityLabel="Gửi yêu cầu bổ sung công">{submitting ? <ActivityIndicator color="#fff" /> : <><Ionicons name="send" size={17} color="#fff" /><Text style={styles.submitText}>GỬI YÊU CẦU</Text></>}</TouchableOpacity>{submitFeedback ? <Text style={styles.submitFeedback}>{submitFeedback}</Text> : null}
          </View>
        )}
        <Text style={styles.listTitle}>{isStaff ? 'Yêu cầu của bạn' : 'Danh sách cần duyệt'}</Text>
        {visibleRequests.length === 0 ? <View style={styles.empty}><Ionicons name="checkmark-circle-outline" size={42} color={COLORS.accent} /><Text style={styles.emptyText}>Chưa có yêu cầu bổ sung công.</Text></View> : visibleRequests.map((request) => (
          <View key={request.id} style={styles.requestCard}>
            <View style={styles.requestTop}><View><Text style={styles.requestName}>{isStaff ? formatDate(request.date) : `${request.user_name || 'Nhân viên'} · ${formatDate(request.date)}`}</Text><Text style={styles.requestMeta}>{REQUEST_TYPES.find((item) => item.key === request.request_type)?.label || 'Bổ sung công'} · {request.requested_check_in || '--:--'} - {request.requested_check_out || '--:--'}</Text></View><Text style={[styles.status, { color: statusColor(request.status) }]}>{statusLabel(request.status)}</Text></View>
            <Text style={styles.reason}>“{request.reason}”</Text>
            {request.review_note ? <Text style={styles.reviewNote}>{request.review_note}{request.reviewed_by ? ` · ${request.reviewed_by}` : ''}</Text> : null}
            {!isStaff && request.status === 'PENDING' && <View style={styles.actions}><TouchableOpacity style={[styles.actionBtn, styles.rejectBtn]} onPress={() => decideRequest(request, false)}><Text style={styles.actionText}>Từ chối</Text></TouchableOpacity><TouchableOpacity style={[styles.actionBtn, styles.approveBtn]} onPress={() => decideRequest(request, true)}><Text style={styles.actionText}>Duyệt & cập nhật công</Text></TouchableOpacity></View>}
          </View>
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}

const getStyles = (COLORS, isDarkMode) => StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.bg }, headerRow: { flexDirection: 'row', alignItems: 'center', padding: 20, paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: COLORS.border }, backBtn: { padding: 6, marginRight: 10 }, header: { color: COLORS.text, fontSize: 22, fontWeight: '900' }, caption: { color: COLORS.textMuted, marginTop: 3, fontSize: 12, fontWeight: '700' }, content: { padding: 20, paddingBottom: 48 }, formCard: { backgroundColor: COLORS.card, borderWidth: 1, borderColor: COLORS.border, borderRadius: 18, padding: 15 }, cardTitle: { color: COLORS.text, fontSize: 17, fontWeight: '900' }, ruleText: { color: COLORS.textMuted, fontSize: 12, lineHeight: 18, marginTop: 4 }, label: { color: COLORS.text, fontSize: 12, fontWeight: '800', marginTop: 13, marginBottom: 6 }, input: { color: COLORS.text, backgroundColor: COLORS.inputBg, borderWidth: 1, borderColor: COLORS.inputBorder, borderRadius: 11, paddingHorizontal: 12, minHeight: 44 }, reasonInput: { height: 82, paddingTop: 10, textAlignVertical: 'top' }, typeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 }, typeChip: { paddingHorizontal: 10, paddingVertical: 8, borderRadius: 10, borderWidth: 1, borderColor: COLORS.border, backgroundColor: COLORS.inputBg }, typeChipActive: { backgroundColor: COLORS.primary, borderColor: COLORS.primary }, typeText: { color: COLORS.textMuted, fontSize: 12, fontWeight: '800' }, typeTextActive: { color: '#fff' }, submitBtn: { marginTop: 16, minHeight: 46, borderRadius: 11, backgroundColor: COLORS.primary, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 8 }, submitText: { color: '#fff', fontWeight: '900' }, listTitle: { color: COLORS.text, fontSize: 17, fontWeight: '900', marginTop: 22, marginBottom: 10 }, empty: { alignItems: 'center', backgroundColor: COLORS.card, borderRadius: 16, padding: 24, borderWidth: 1, borderColor: COLORS.border }, emptyText: { color: COLORS.textMuted, marginTop: 8, fontWeight: '700' }, requestCard: { backgroundColor: COLORS.card, borderWidth: 1, borderColor: COLORS.border, borderRadius: 15, padding: 14, marginBottom: 10 }, requestTop: { flexDirection: 'row', justifyContent: 'space-between', gap: 10 }, requestName: { color: COLORS.text, fontWeight: '900', fontSize: 15 }, requestMeta: { color: COLORS.textMuted, marginTop: 3, fontWeight: '700', fontSize: 12 }, status: { fontSize: 12, fontWeight: '900', textAlign: 'right' }, reason: { color: COLORS.text, marginTop: 10, lineHeight: 20 }, reviewNote: { color: COLORS.textMuted, marginTop: 8, fontSize: 12, fontStyle: 'italic' }, actions: { flexDirection: 'row', gap: 8, marginTop: 13 }, actionBtn: { flex: 1, minHeight: 40, borderRadius: 9, alignItems: 'center', justifyContent: 'center' }, rejectBtn: { backgroundColor: '#ef4444' }, approveBtn: { backgroundColor: COLORS.primary, flex: 1.6 }, actionText: { color: '#fff', fontSize: 12, fontWeight: '900' },
});