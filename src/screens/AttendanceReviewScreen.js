import React, { useContext, useMemo, useState } from 'react';
import { Alert, RefreshControl, SafeAreaView, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { AppContext } from '../context/AppContext';
import { getLocalDateKey, formatDate } from '../utils/dateTime';
import { buildAttendanceReview, getShiftLabel, getShiftWindow } from '../utils/attendanceRules';
import { supabase } from '../services/supabaseClient';
import DateRangePickerModal from '../components/DateRangePickerModal';

const addDays = (dateKey, offset) => {
  const [year, month, day] = dateKey.split('-').map(Number);
  const next = new Date(year, month - 1, day);
  next.setDate(next.getDate() + offset);
  return getLocalDateKey(next);
};

const getMonthStart = () => {
  const now = new Date();
  return getLocalDateKey(new Date(now.getFullYear(), now.getMonth(), 1));
};

const getDateKeysInRange = (start, end) => {
  const safeStart = start <= end ? start : end;
  const safeEnd = start <= end ? end : start;
  const keys = [];
  let cursor = safeStart;
  while (cursor <= safeEnd) {
    keys.push(cursor);
    cursor = addDays(cursor, 1);
  }
  return keys;
};

const formatMinutes = (minutes = 0) => {
  const safe = Math.max(0, Number(minutes) || 0);
  const hours = Math.floor(safe / 60);
  const mins = safe % 60;
  if (hours > 0 && mins > 0) return `${hours}g ${mins}p`;
  if (hours > 0) return `${hours}g`;
  return `${mins}p`;
};

const FILTERS = [
  { key: 'ALL', label: 'Tất cả' },
  { key: 'ACTION', label: 'Cần xử lý' },
  { key: 'missing_checkin', label: 'Có lịch chưa check-in' },
  { key: 'outside_schedule', label: 'Ngoài lịch / sai quán' },
  { key: 'missing_checkout', label: 'Thiếu checkout' },
  { key: 'late', label: 'Đi trễ' },
  { key: 'early_leave', label: 'Về sớm' },
  { key: 'overtime', label: 'Tăng ca' },
];

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
  const todayKey = getLocalDateKey();
  const [rangeStart, setRangeStart] = useState(getMonthStart());
  const [rangeEnd, setRangeEnd] = useState(todayKey);
  const [showDateModal, setShowDateModal] = useState(false);
  const [typeFilter, setTypeFilter] = useState('ACTION');
  const [searchText, setSearchText] = useState('');
  const [storeFilter, setStoreFilter] = useState('ALL');

  const isOwner = currentUser?.role === 'OWNER';
  const viewableStores = currentUser?.permissions?.viewable_stores || [];
  let displayStoreId = currentUser?.store_id;
  if (isOwner || viewableStores.includes(selectedStoreId)) displayStoreId = selectedStoreId;
  if (isOwner && selectedStoreId === 'ALL') displayStoreId = 'ALL';

  const availableStores = useMemo(() => {
    if (displayStoreId !== 'ALL') {
      return storeList.filter((store) => String(store.id) === String(displayStoreId));
    }
    return storeList.filter((store) => store.id !== 'ALL');
  }, [displayStoreId, storeList]);

  const effectiveStoreId = displayStoreId === 'ALL' ? storeFilter : displayStoreId;
  const dateKeys = useMemo(() => getDateKeysInRange(rangeStart, rangeEnd), [rangeStart, rangeEnd]);

  const reviewRows = useMemo(() => dateKeys.flatMap((dateKey) => (
    buildAttendanceReview({
      attendanceHistory,
      shiftRegistrations,
      staffList,
      storeList,
      date: dateKey,
      storeId: effectiveStoreId,
    }).map((row) => ({ ...row, date: dateKey }))
  )), [attendanceHistory, shiftRegistrations, staffList, storeList, dateKeys, effectiveStoreId]);

  const filteredRows = useMemo(() => {
    const search = searchText.trim().toLowerCase();
    const priority = { danger: 0, warning: 1, info: 2 };
    return reviewRows
      .filter((row) => {
        if (typeFilter === 'ALL') return true;
        if (typeFilter === 'ACTION') return row.severity === 'danger' || row.severity === 'warning';
        return row.type === typeFilter;
      })
      .filter((row) => {
        if (!search) return true;
        return [
          row.staff?.name,
          row.store?.name,
          row.title,
          row.payrollImpact,
          getShiftLabel(row.shiftType),
          row.date,
        ].some((value) => String(value || '').toLowerCase().includes(search));
      })
      .sort((a, b) => (
        (priority[a.severity] ?? 9) - (priority[b.severity] ?? 9)
        || String(b.date).localeCompare(String(a.date))
        || String(a.staff?.name || '').localeCompare(String(b.staff?.name || ''))
      ));
  }, [reviewRows, typeFilter, searchText]);

  const summary = useMemo(() => {
    const danger = reviewRows.filter((row) => row.severity === 'danger').length;
    const warning = reviewRows.filter((row) => row.severity === 'warning').length;
    const info = reviewRows.filter((row) => row.severity === 'info').length;
    const lateMinutes = reviewRows.filter((row) => row.type === 'late').reduce((sum, row) => sum + Number(row.impactMinutes || 0), 0);
    const earlyMinutes = reviewRows.filter((row) => row.type === 'early_leave').reduce((sum, row) => sum + Number(row.impactMinutes || 0), 0);
    const overtimeMinutes = reviewRows.filter((row) => row.type === 'overtime').reduce((sum, row) => sum + Number(row.impactMinutes || 0), 0);
    const payrollRisk = reviewRows.filter((row) => row.severity !== 'info').length;
    return { danger, warning, info, lateMinutes, earlyMinutes, overtimeMinutes, payrollRisk };
  }, [reviewRows]);

  const rangeLabel = rangeStart === rangeEnd
    ? formatDate(rangeStart)
    : `${formatDate(rangeStart)} → ${formatDate(rangeEnd)}`;

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

  const applyRange = (start, end) => {
    setRangeStart(start);
    setRangeEnd(end);
    setShowDateModal(false);
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

  const renderStoreFilters = () => {
    if (displayStoreId !== 'ALL') return null;
    return (
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
        <TouchableOpacity
          style={[styles.filterChip, storeFilter === 'ALL' && styles.filterChipActive]}
          onPress={() => setStoreFilter('ALL')}
        >
          <Text style={[styles.filterChipText, storeFilter === 'ALL' && styles.filterChipTextActive]}>Tất cả quán</Text>
        </TouchableOpacity>
        {availableStores.map((store) => (
          <TouchableOpacity
            key={store.id}
            style={[styles.filterChip, String(storeFilter) === String(store.id) && styles.filterChipActive]}
            onPress={() => setStoreFilter(store.id)}
          >
            <Text style={[styles.filterChipText, String(storeFilter) === String(store.id) && styles.filterChipTextActive]}>{store.name}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>
    );
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.headerRow}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={24} color={COLORS.text} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={styles.header}>Đối chiếu công</Text>
          <Text style={styles.caption}>Lọc vi phạm theo quán để chốt lương minh bạch</Text>
        </View>
      </View>

      <ScrollView
        contentContainerStyle={styles.scrollContent}
        refreshControl={<RefreshControl refreshing={isDataLoading} onRefresh={refreshData} tintColor={COLORS.primary} />}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.controlCard}>
          <TouchableOpacity style={styles.rangeButton} onPress={() => setShowDateModal(true)}>
            <Ionicons name="calendar-outline" size={20} color={COLORS.primary} />
            <View style={{ flex: 1 }}>
              <Text style={styles.rangeLabel}>Khoảng thời gian</Text>
              <Text style={styles.rangeValue}>{rangeLabel}</Text>
            </View>
            <Ionicons name="chevron-down" size={18} color={COLORS.textMuted} />
          </TouchableOpacity>

          <View style={styles.searchBox}>
            <Ionicons name="search" size={19} color="#94a3b8" />
            <TextInput
              value={searchText}
              onChangeText={setSearchText}
              placeholder="Tìm nhân viên, quán, lỗi..."
              placeholderTextColor="#94a3b8"
              style={styles.searchInput}
            />
          </View>

          {renderStoreFilters()}

          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
            {FILTERS.map((filter) => (
              <TouchableOpacity
                key={filter.key}
                style={[styles.filterChip, typeFilter === filter.key && styles.filterChipActive]}
                onPress={() => setTypeFilter(filter.key)}
              >
                <Text style={[styles.filterChipText, typeFilter === filter.key && styles.filterChipTextActive]}>{filter.label}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>

        <View style={styles.summaryGrid}>
          <View style={[styles.summaryBox, styles.severityDanger]}>
            <Text style={styles.summaryNumber}>{summary.danger}</Text>
            <Text style={styles.summaryLabel}>Cần xử lý</Text>
          </View>
          <View style={[styles.summaryBox, styles.severityWarning]}>
            <Text style={styles.summaryNumber}>{summary.warning}</Text>
            <Text style={styles.summaryLabel}>Cảnh báo</Text>
          </View>
          <View style={[styles.summaryBox, styles.severityInfo]}>
            <Text style={styles.summaryNumber}>{summary.info}</Text>
            <Text style={styles.summaryLabel}>Tăng ca</Text>
          </View>
        </View>

        <View style={styles.payrollCard}>
          <View style={styles.payrollRow}>
            <Text style={styles.payrollLabel}>Ảnh hưởng chốt lương</Text>
            <Text style={styles.payrollValue}>{summary.payrollRisk} mục</Text>
          </View>
          <View style={styles.payrollMiniGrid}>
            <Text style={styles.payrollMini}>Trễ: {formatMinutes(summary.lateMinutes)}</Text>
            <Text style={styles.payrollMini}>Về sớm: {formatMinutes(summary.earlyMinutes)}</Text>
            <Text style={styles.payrollMini}>Tăng ca: {formatMinutes(summary.overtimeMinutes)}</Text>
          </View>
        </View>

        {filteredRows.length === 0 ? (
          <View style={styles.emptyCard}>
            <Ionicons name="checkmark-circle-outline" size={42} color={COLORS.accent} />
            <Text style={styles.emptyTitle}>Không có trường hợp phù hợp</Text>
            <Text style={styles.emptyText}>Thử đổi khoảng ngày, quán hoặc bộ lọc vi phạm.</Text>
          </View>
        ) : (
          filteredRows.map((row) => {
            const shiftWindow = getShiftWindow(row.shiftType);
            const checkIn = row.record?.checkIn || row.record?.check_in || '--:--';
            const checkOut = row.record?.checkOut || row.record?.check_out || '--:--';
            const workedHours = Number(row.record?.hours || 0);

            return (
              <View key={`${row.date}_${row.id}`} style={styles.issueCard}>
                <View style={styles.issueHeader}>
                  <View style={[styles.severityPill, severityStyle(row.severity)]}>
                    <Text style={[styles.severityPillText, severityTextStyle(row.severity)]}>{row.title}</Text>
                  </View>
                  <Text style={styles.dateBadge}>{formatDate(row.date)}</Text>
                </View>

                <Text style={styles.staffName}>{row.staff?.name || `Nhân viên ${row.shift?.user_id || row.record?.user_id}`}</Text>
                <View style={styles.metaGrid}>
                  <Text style={styles.metaText}>Quán: {row.store?.name || 'Chưa rõ'}</Text>
                  <Text style={styles.metaText}>Ca: {getShiftLabel(row.shiftType)}</Text>
                  <Text style={styles.metaText}>Khung ca: {shiftWindow ? `${shiftWindow.start} - ${shiftWindow.end}` : 'Ngoài lịch'}</Text>
                  <Text style={styles.metaText}>Thực tế: {row.record ? `${checkIn} - ${checkOut}` : 'Chưa chấm công'}</Text>
                  {row.record ? <Text style={styles.metaText}>Giờ công ghi nhận: {workedHours.toFixed(2)}h</Text> : null}
                </View>

                <View style={styles.payrollImpactBox}>
                  <Ionicons name="wallet-outline" size={18} color={COLORS.primary} />
                  <Text style={styles.payrollImpactText}>{row.payrollImpact || 'Cần kiểm tra trước khi chốt lương.'}</Text>
                </View>

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

      <DateRangePickerModal
        visible={showDateModal}
        onClose={() => setShowDateModal(false)}
        onApply={applyRange}
        initialStartDate={rangeStart}
        initialEndDate={rangeEnd}
        COLORS={COLORS}
        isDarkMode={isDarkMode}
        title="Chọn khoảng đối chiếu công"
      />
    </SafeAreaView>
  );
}

const getStyles = (COLORS, isDarkMode) => StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.bg },
  headerRow: { flexDirection: 'row', alignItems: 'center', padding: 20, paddingBottom: 10 },
  backBtn: { padding: 6, marginRight: 10 },
  header: { color: COLORS.text, fontSize: 22, fontWeight: '900' },
  caption: { color: COLORS.textMuted, marginTop: 3, lineHeight: 19 },
  scrollContent: { padding: 20, paddingTop: 8, paddingBottom: 50 },
  controlCard: { backgroundColor: COLORS.card, borderRadius: 18, padding: 14, borderWidth: 1, borderColor: COLORS.border, marginBottom: 14 },
  rangeButton: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: COLORS.inputBg, borderRadius: 14, padding: 12, borderWidth: 1, borderColor: COLORS.inputBorder },
  rangeLabel: { color: COLORS.textMuted, fontSize: 12, fontWeight: '700' },
  rangeValue: { color: COLORS.text, fontWeight: '900', fontSize: 15, marginTop: 2 },
  searchBox: { flexDirection: 'row', alignItems: 'center', backgroundColor: COLORS.inputBg, borderWidth: 1, borderColor: COLORS.inputBorder, borderRadius: 14, paddingHorizontal: 12, marginTop: 10 },
  searchInput: { flex: 1, minHeight: 44, paddingLeft: 8, color: COLORS.text },
  chipRow: { paddingTop: 10, paddingBottom: 2 },
  filterChip: { backgroundColor: COLORS.inputBg, borderRadius: 999, paddingHorizontal: 13, paddingVertical: 9, marginRight: 8, borderWidth: 1, borderColor: COLORS.border },
  filterChipActive: { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
  filterChipText: { color: COLORS.textMuted, fontWeight: '800', fontSize: 12 },
  filterChipTextActive: { color: isDarkMode ? '#052e16' : '#fff' },
  summaryGrid: { flexDirection: 'row', gap: 10, marginBottom: 10 },
  summaryBox: { flex: 1, borderRadius: 14, paddingVertical: 12, alignItems: 'center', borderWidth: 1 },
  summaryNumber: { color: COLORS.text, fontSize: 23, fontWeight: '900' },
  summaryLabel: { color: COLORS.textMuted, fontSize: 11, fontWeight: '800', marginTop: 2, textAlign: 'center' },
  payrollCard: { backgroundColor: COLORS.card, borderRadius: 16, padding: 14, borderWidth: 1, borderColor: COLORS.border, marginBottom: 14 },
  payrollRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  payrollLabel: { color: COLORS.text, fontWeight: '900', fontSize: 15 },
  payrollValue: { color: '#dc2626', fontWeight: '900', fontSize: 16 },
  payrollMiniGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 10 },
  payrollMini: { color: COLORS.textMuted, backgroundColor: COLORS.inputBg, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 7, fontSize: 12, fontWeight: '800' },
  emptyCard: { backgroundColor: COLORS.card, borderRadius: 18, padding: 24, alignItems: 'center', borderWidth: 1, borderColor: COLORS.border },
  emptyTitle: { color: COLORS.text, fontSize: 18, fontWeight: '900', marginTop: 10 },
  emptyText: { color: COLORS.textMuted, textAlign: 'center', marginTop: 5, lineHeight: 20 },
  issueCard: { backgroundColor: COLORS.card, borderRadius: 16, padding: 15, marginBottom: 12, borderWidth: 1, borderColor: COLORS.border, shadowColor: '#000', shadowOpacity: isDarkMode ? 0.2 : 0.06, shadowRadius: 8, elevation: 2 },
  issueHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10, gap: 8 },
  severityPill: { flex: 1, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 7, borderWidth: 1 },
  severityPillText: { fontSize: 12, fontWeight: '900' },
  severityDanger: { backgroundColor: isDarkMode ? '#3b1111' : '#fee2e2', borderColor: isDarkMode ? '#7f1d1d' : '#fecaca' },
  severityDangerText: { color: isDarkMode ? '#fecaca' : '#991b1b' },
  severityWarning: { backgroundColor: isDarkMode ? '#3b2a11' : '#fef3c7', borderColor: isDarkMode ? '#92400e' : '#fde68a' },
  severityWarningText: { color: isDarkMode ? '#fde68a' : '#92400e' },
  severityInfo: { backgroundColor: isDarkMode ? '#0f2a44' : '#dbeafe', borderColor: isDarkMode ? '#1d4ed8' : '#bfdbfe' },
  severityInfoText: { color: isDarkMode ? '#bfdbfe' : '#1d4ed8' },
  dateBadge: { color: COLORS.primary, fontWeight: '900', fontSize: 12, backgroundColor: COLORS.inputBg, paddingHorizontal: 9, paddingVertical: 6, borderRadius: 999 },
  staffName: { color: COLORS.text, fontSize: 17, fontWeight: '900', marginBottom: 8 },
  metaGrid: { backgroundColor: COLORS.inputBg, borderRadius: 12, padding: 11, borderWidth: 1, borderColor: COLORS.border },
  metaText: { color: COLORS.textMuted, marginTop: 2, lineHeight: 20, fontWeight: '700' },
  payrollImpactBox: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, backgroundColor: isDarkMode ? '#0f2a44' : '#eff6ff', borderRadius: 12, padding: 11, marginTop: 10, borderWidth: 1, borderColor: isDarkMode ? '#1d4ed8' : '#bfdbfe' },
  payrollImpactText: { flex: 1, color: COLORS.text, fontWeight: '800', lineHeight: 20 },
  approveBtn: { marginTop: 12, backgroundColor: COLORS.accent, borderRadius: 10, paddingVertical: 11, alignItems: 'center', justifyContent: 'center', flexDirection: 'row' },
  approveBtnText: { color: '#fff', fontWeight: '900', marginLeft: 6 },
});
