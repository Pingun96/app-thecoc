import React, { useContext, useMemo, useState } from 'react';
import { Alert, SafeAreaView, ScrollView, StyleSheet, Text, TouchableOpacity, View, RefreshControl } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { AppContext } from '../context/AppContext';
import { getLocalDateKey, formatDate } from '../utils/dateTime';
import { buildAttendanceReview, getShiftLabel, getShiftWindow } from '../utils/attendanceRules';
import { supabase } from '../services/supabaseClient';

export default function AttendanceReviewScreen({ navigation }) {
  const {
    currentUser,
    selectedStoreId,
    attendanceHistory,
    shiftRegistrations,
    setShiftRegistrations,
    staffList,
    storeList,
    refreshData,
    isDataLoading,
    COLORS,
    isDarkMode,
  } = useContext(AppContext);

  const styles = useMemo(() => getStyles(COLORS, isDarkMode), [COLORS, isDarkMode]);
  const [targetDate, setTargetDate] = useState(getLocalDateKey());

  const isOwner = currentUser?.role === 'OWNER';
  const viewableStores = currentUser?.permissions?.viewable_stores || [];
  let displayStoreId = currentUser?.store_id;
  if (isOwner || viewableStores.includes(selectedStoreId)) displayStoreId = selectedStoreId;
  if (isOwner && selectedStoreId === 'ALL') displayStoreId = 'ALL';

  const reviewRows = useMemo(() => buildAttendanceReview({
    attendanceHistory,
    shiftRegistrations,
    staffList,
    storeList,
    date: targetDate,
    storeId: displayStoreId,
  }), [attendanceHistory, shiftRegistrations, staffList, storeList, targetDate, displayStoreId]);

  const goDate = (offset) => {
    const [year, month, day] = targetDate.split('-').map(Number);
    const next = new Date(year, month - 1, day);
    next.setDate(next.getDate() + offset);
    setTargetDate(getLocalDateKey(next));
  };

  const severityStyle = (severity) => {
    if (severity === 'danger') return styles.severityDanger;
    if (severity === 'warning') return styles.severityWarning;
    return styles.severityInfo;
  };

  const severityTextStyle = (severity) => {
    if (severity === 'danger') return styles.severityDangerText;
    if (severity === 'warning') return styles.severityWarningText;
    return styles.severityInfoText;
  };

  const summary = {
    danger: reviewRows.filter((row) => row.severity === 'danger').length,
    warning: reviewRows.filter((row) => row.severity === 'warning').length,
    info: reviewRows.filter((row) => row.severity === 'info').length,
  };

  const approveOutsideAttendance = (row) => {
    if (!row?.record?.user_id || !row?.record?.store_id) {
      Alert.alert('Chưa đủ dữ liệu', 'Lượt chấm công này thiếu nhân viên hoặc chi nhánh nên chưa thể duyệt vào lịch.');
      return;
    }

    const shiftType = row.shiftType || 'MORNING';
    Alert.alert(
      'Duyệt vào lịch',
      `Tạo ${getShiftLabel(shiftType)} đã duyệt cho ${row.staff?.name || 'nhân viên này'} tại ${row.store?.name || 'chi nhánh này'}?`,
      [
        { text: 'Huỷ', style: 'cancel' },
        {
          text: 'Duyệt',
          onPress: async () => {
            try {
              const newShift = {
                id: `reg_att_${Date.now()}`,
                user_id: row.record.user_id,
                store_id: row.record.store_id,
                date: row.record.date,
                shift_type: shiftType,
                status: 'APPROVED',
              };

              const { error } = await supabase.from('shift_registrations').insert([newShift]);
              if (error) throw error;

              setShiftRegistrations((current) => [...(current || []), newShift]);
              Alert.alert('Đã duyệt', 'Lượt chấm công đã được gắn vào lịch làm.');
            } catch (error) {
              Alert.alert('Không thể duyệt', error.message || 'Vui lòng thử lại.');
            }
          },
        },
      ],
    );
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.headerRow}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={24} color={COLORS.text} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={styles.header}>Đối chiếu chấm công</Text>
          <Text style={styles.caption}>So lịch đã duyệt với giờ công thực tế</Text>
        </View>
      </View>

      <View style={styles.dateCard}>
        <TouchableOpacity style={styles.dateBtn} onPress={() => goDate(-1)}>
          <Ionicons name="chevron-back" size={22} color={COLORS.text} />
        </TouchableOpacity>
        <View style={{ alignItems: 'center' }}>
          <Text style={styles.dateText}>{formatDate(targetDate)}</Text>
          <Text style={styles.dateSub}>{displayStoreId === 'ALL' ? 'Tất cả chi nhánh' : (storeList.find((s) => String(s.id) === String(displayStoreId))?.name || 'Chi nhánh')}</Text>
        </View>
        <TouchableOpacity style={styles.dateBtn} onPress={() => goDate(1)} disabled={targetDate >= getLocalDateKey()}>
          <Ionicons name="chevron-forward" size={22} color={targetDate >= getLocalDateKey() ? COLORS.textMuted : COLORS.text} />
        </TouchableOpacity>
      </View>

      <View style={styles.summaryRow}>
        <View style={[styles.summaryBox, styles.severityDanger]}><Text style={styles.summaryNumber}>{summary.danger}</Text><Text style={styles.summaryLabel}>Cần xử lý</Text></View>
        <View style={[styles.summaryBox, styles.severityWarning]}><Text style={styles.summaryNumber}>{summary.warning}</Text><Text style={styles.summaryLabel}>Cảnh báo</Text></View>
        <View style={[styles.summaryBox, styles.severityInfo]}><Text style={styles.summaryNumber}>{summary.info}</Text><Text style={styles.summaryLabel}>Ghi nhận</Text></View>
      </View>

      <ScrollView
        contentContainerStyle={styles.scrollContent}
        refreshControl={<RefreshControl refreshing={isDataLoading} onRefresh={refreshData} tintColor={COLORS.primary} />}
      >
        {reviewRows.length === 0 ? (
          <View style={styles.emptyCard}>
            <Ionicons name="checkmark-circle-outline" size={42} color={COLORS.accent} />
            <Text style={styles.emptyTitle}>Hôm nay ổn</Text>
            <Text style={styles.emptyText}>Chưa thấy lệch giữa lịch làm và chấm công.</Text>
          </View>
        ) : (
          reviewRows.map((row) => {
            const shiftWindow = getShiftWindow(row.shiftType);
            const checkIn = row.record?.checkIn || row.record?.check_in || '--:--';
            const checkOut = row.record?.checkOut || row.record?.check_out || '--:--';

            return (
              <View key={row.id} style={styles.issueCard}>
                <View style={styles.issueHeader}>
                  <View style={[styles.severityPill, severityStyle(row.severity)]}>
                    <Text style={[styles.severityPillText, severityTextStyle(row.severity)]}>{row.title}</Text>
                  </View>
                  <Text style={styles.shiftText}>{getShiftLabel(row.shiftType)}</Text>
                </View>

                <Text style={styles.staffName}>{row.staff?.name || `Nhân viên ${row.shift?.user_id || row.record?.user_id}`}</Text>
                <Text style={styles.metaText}>Chi nhánh: {row.store?.name || 'Chưa rõ'}</Text>
                <Text style={styles.metaText}>Khung ca: {shiftWindow ? `${shiftWindow.start} - ${shiftWindow.end}` : 'Ngoài lịch'}</Text>
                {row.record && <Text style={styles.metaText}>Thực tế: {checkIn} - {checkOut}</Text>}
                {row.type === 'outside_schedule' && (
                  <TouchableOpacity style={styles.approveBtn} onPress={() => approveOutsideAttendance(row)}>
                    <Ionicons name="checkmark-circle-outline" size={18} color="#fff" />
                    <Text style={styles.approveBtnText}>Duyệt vào lịch</Text>
                  </TouchableOpacity>
                )}
              </View>
            );
          })
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const getStyles = (COLORS, isDarkMode) => StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.bg },
  headerRow: { flexDirection: 'row', alignItems: 'center', padding: 20, paddingBottom: 10 },
  backBtn: { padding: 6, marginRight: 10 },
  header: { color: COLORS.text, fontSize: 22, fontWeight: '900' },
  caption: { color: COLORS.textMuted, marginTop: 3 },
  dateCard: { marginHorizontal: 20, marginTop: 8, marginBottom: 14, padding: 12, borderRadius: 16, backgroundColor: COLORS.card, borderWidth: 1, borderColor: COLORS.border, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  dateBtn: { width: 42, height: 42, alignItems: 'center', justifyContent: 'center', borderRadius: 21, backgroundColor: COLORS.inputBg },
  dateText: { color: COLORS.text, fontWeight: '900', fontSize: 17 },
  dateSub: { color: COLORS.textMuted, fontSize: 12, marginTop: 2 },
  summaryRow: { flexDirection: 'row', gap: 10, paddingHorizontal: 20, marginBottom: 8 },
  summaryBox: { flex: 1, borderRadius: 14, paddingVertical: 12, alignItems: 'center', borderWidth: 1 },
  summaryNumber: { color: COLORS.text, fontSize: 22, fontWeight: '900' },
  summaryLabel: { color: COLORS.textMuted, fontSize: 11, fontWeight: '800', marginTop: 2 },
  scrollContent: { padding: 20, paddingTop: 10, paddingBottom: 50 },
  emptyCard: { backgroundColor: COLORS.card, borderRadius: 18, padding: 24, alignItems: 'center', borderWidth: 1, borderColor: COLORS.border },
  emptyTitle: { color: COLORS.text, fontSize: 18, fontWeight: '900', marginTop: 10 },
  emptyText: { color: COLORS.textMuted, textAlign: 'center', marginTop: 5 },
  issueCard: { backgroundColor: COLORS.card, borderRadius: 16, padding: 15, marginBottom: 12, borderWidth: 1, borderColor: COLORS.border, shadowColor: '#000', shadowOpacity: isDarkMode ? 0.2 : 0.06, shadowRadius: 8, elevation: 2 },
  issueHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10, gap: 8 },
  severityPill: { flex: 1, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 6, borderWidth: 1 },
  severityPillText: { fontSize: 12, fontWeight: '900' },
  severityDanger: { backgroundColor: isDarkMode ? '#3b1111' : '#fee2e2', borderColor: isDarkMode ? '#7f1d1d' : '#fecaca' },
  severityDangerText: { color: isDarkMode ? '#fecaca' : '#991b1b' },
  severityWarning: { backgroundColor: isDarkMode ? '#3b2a11' : '#fef3c7', borderColor: isDarkMode ? '#92400e' : '#fde68a' },
  severityWarningText: { color: isDarkMode ? '#fde68a' : '#92400e' },
  severityInfo: { backgroundColor: isDarkMode ? '#0f2a44' : '#dbeafe', borderColor: isDarkMode ? '#1d4ed8' : '#bfdbfe' },
  severityInfoText: { color: isDarkMode ? '#bfdbfe' : '#1d4ed8' },
  shiftText: { color: COLORS.primary, fontWeight: '900', fontSize: 12 },
  staffName: { color: COLORS.text, fontSize: 16, fontWeight: '900', marginBottom: 4 },
  metaText: { color: COLORS.textMuted, marginTop: 2 },
  approveBtn: { marginTop: 12, backgroundColor: COLORS.accent, borderRadius: 10, paddingVertical: 10, alignItems: 'center', justifyContent: 'center', flexDirection: 'row' },
  approveBtnText: { color: '#fff', fontWeight: '900', marginLeft: 6 },
});
