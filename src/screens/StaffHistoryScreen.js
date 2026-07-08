import React, { useContext, useMemo } from 'react';
import {
  FlatList,
  Platform,
  SafeAreaView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { AppContext } from '../context/AppContext';
import {
  formatDate,
  formatDuration,
  isDateInCurrentMonth,
} from '../utils/dateTime';

const formatCurrency = (value) => `${Math.round(Number(value) || 0).toLocaleString('vi-VN')} đ`;

export default function StaffHistoryScreen({ navigation }) {
  const { currentUser, attendanceHistory, COLORS, isDarkMode } = useContext(AppContext);
  const styles = useMemo(() => getStyles(COLORS, isDarkMode), [COLORS, isDarkMode]);

  const myHistory = useMemo(
    () => attendanceHistory
      .filter((record) => record.user_id === currentUser?.id)
      .sort((a, b) => String(b.date).localeCompare(String(a.date))),
    [attendanceHistory, currentUser?.id],
  );
  const monthlyHistory = useMemo(
    () => myHistory.filter((record) => isDateInCurrentMonth(record.date)),
    [myHistory],
  );

  const hourlyWage = Number(currentUser?.wage) || 0;
  const totalHours = monthlyHistory.reduce(
    (sum, record) => sum + (Number(record.hours) || 0),
    0,
  );
  const estimatedSalary = totalHours * hourlyWage;

  const currentHour = new Date().getHours();
  const isMorning = currentHour < 12;
  const isAfternoon = currentHour >= 12 && currentHour < 18;
  const isEvening = currentHour >= 18;

  // Sáng: nền xanh lá nhạt, chữ xanh đậm.
  // Chiều: nền vàng nhạt có viền, chữ cam đậm.
  // Tối: nền tím đậm, chữ trắng.
  const themeStyles = {
    cardBg: isMorning ? '#dcfce7' : isAfternoon ? '#fef9c3' : '#1e1b4b',
    cardBorder: isAfternoon ? '#fde047' : 'transparent',
    textColor: isMorning ? '#166534' : isAfternoon ? '#9a3412' : '#ffffff',
    subTextColor: isMorning ? '#15803d' : isAfternoon ? '#c2410c' : '#a5b4fc',
    dividerBg: isMorning ? 'rgba(21, 128, 61, 0.2)' : isAfternoon ? 'rgba(194, 65, 12, 0.2)' : 'rgba(255,255,255,0.2)'
  };

  const renderItem = ({ item }) => {
    const isOpen = !(item.checkOut || item.check_out);
    return (
      <View style={styles.historyCard}>
        <View style={styles.cardHeader}>
          <Text style={styles.dateText}>{formatDate(item.date)}</Text>
          <View style={[styles.badge, isOpen ? styles.openBadge : styles.closedBadge]}>
            <Text style={[styles.badgeText, isOpen ? styles.openBadgeText : styles.closedBadgeText]}>
              {isOpen ? 'ĐANG TRONG CA' : 'HOÀN THÀNH'}
            </Text>
          </View>
        </View>
        <View style={styles.timeRow}>
          <View style={styles.timeBlock}>
            <Text style={styles.timeLabel}>Vào ca</Text>
            <Text style={styles.timeValue}>{item.checkIn || item.check_in || '--:--'}</Text>
          </View>
          <Ionicons name="arrow-forward" size={18} color="#94a3b8" />
          <View style={[styles.timeBlock, styles.timeBlockRight]}>
            <Text style={styles.timeLabel}>Kết thúc</Text>
            <Text style={styles.timeValue}>{item.checkOut || item.check_out || '--:--'}</Text>
          </View>
        </View>
        <View style={styles.cardFooter}>
          <Text style={styles.locationText} numberOfLines={1}>
            <Ionicons name="location-outline" size={13} />{' '}
            {item.check_in_location || 'Chưa có vị trí'}
          </Text>
          <Text style={styles.hoursText}>
            {isOpen ? 'Đang tính giờ' : formatDuration(item.hours)}
          </Text>
        </View>
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.headerRow}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={24} color="#1565c0" />
        </TouchableOpacity>
        <View>
          <Text style={styles.header}>Công & lương</Text>
          <Text style={styles.headerCaption}>Dữ liệu cá nhân của tháng hiện tại</Text>
        </View>
      </View>

      <View style={[styles.salaryCard, { backgroundColor: themeStyles.cardBg, borderColor: themeStyles.cardBorder, borderWidth: isAfternoon ? 2 : 0 }]}>
        <Text style={[styles.salaryEyebrow, { color: themeStyles.subTextColor }]}>LƯƠNG TẠM TÍNH THÁNG NÀY</Text>
        <Text style={[styles.salaryTotal, { color: themeStyles.textColor }]}>{formatCurrency(estimatedSalary)}</Text>
        <View style={[styles.salaryDivider, { backgroundColor: themeStyles.dividerBg }]} />
        <View style={styles.salaryStats}>
          <View style={styles.salaryStat}>
            <Text style={[styles.salaryStatLabel, { color: themeStyles.subTextColor }]}>Tổng giờ</Text>
            <Text style={[styles.salaryStatValue, { color: themeStyles.textColor }]}>{totalHours.toFixed(2)} giờ</Text>
          </View>
          <View style={styles.salaryStat}>
            <Text style={[styles.salaryStatLabel, { color: themeStyles.subTextColor }]}>Đơn giá</Text>
            <Text style={[styles.salaryStatValue, { color: themeStyles.textColor }]}>{formatCurrency(hourlyWage)}/h</Text>
          </View>
          <View style={[styles.salaryStat, styles.salaryStatLast]}>
            <Text style={[styles.salaryStatLabel, { color: themeStyles.subTextColor }]}>Số ca</Text>
            <Text style={[styles.salaryStatValue, { color: themeStyles.textColor }]}>{monthlyHistory.length}</Text>
          </View>
        </View>
      </View>

      <Text style={styles.sectionTitle}>Lịch sử chấm công</Text>

      <FlatList
        style={styles.flexRoot}
        data={myHistory}
        keyExtractor={(item) => String(item.id)}
        renderItem={renderItem}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={myHistory.length ? styles.listContent : styles.emptyContent}
        ListEmptyComponent={(
          <View style={styles.emptyState}>
            <Ionicons name="calendar-outline" size={42} color="#94a3b8" />
            <Text style={styles.emptyTitle}>Chưa có dữ liệu chấm công</Text>
            <Text style={styles.emptyText}>Các lượt vào ca và kết thúc ca sẽ xuất hiện tại đây.</Text>
          </View>
        )}
      />
    </SafeAreaView>
  );
}

const getStyles = (COLORS, isDarkMode) => StyleSheet.create({
  container: { flex: 1, minHeight: 0, overflow: Platform.OS === 'web' ? 'visible' : 'hidden', backgroundColor: COLORS.bg, paddingHorizontal: 20 },
  flexRoot: { flex: 1, minHeight: 0 },
  headerRow: { flexDirection: 'row', alignItems: 'center', marginTop: 10, marginBottom: 20 },
  backBtn: { padding: 8, marginRight: 8, marginLeft: -8 },
  header: { fontSize: 25, fontWeight: '800', color: COLORS.text },
  headerCaption: { color: COLORS.textMuted, marginTop: 2 },
  salaryCard: {
    backgroundColor: '#166534',
    padding: 20,
    borderRadius: 18,
    marginBottom: 24,
    shadowColor: '#14532d',
    shadowOpacity: 0.2,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 4,
  },
  salaryEyebrow: { color: '#bbf7d0', fontSize: 12, fontWeight: '800', letterSpacing: 0.5 },
  salaryTotal: { color: '#fff', fontSize: 30, fontWeight: '900', marginTop: 8 },
  salaryDivider: { height: 1, backgroundColor: 'rgba(255,255,255,0.2)', marginVertical: 17 },
  salaryStats: { flexDirection: 'row' },
  salaryStat: {
    flex: 1,
    borderRightWidth: 1,
    borderRightColor: 'rgba(255,255,255,0.18)',
    paddingRight: 10,
    marginRight: 10,
  },
  salaryStatLast: { borderRightWidth: 0, marginRight: 0, paddingRight: 0 },
  salaryStatLabel: { color: '#bbf7d0', fontSize: 11, marginBottom: 5 },
  salaryStatValue: { color: '#fff', fontWeight: '800', fontSize: 14 },
  sectionTitle: { fontSize: 18, fontWeight: '800', color: COLORS.text, marginBottom: 13 },
  listContent: { paddingBottom: 40 },
  emptyContent: { flexGrow: 1 },
  historyCard: {
    backgroundColor: COLORS.card,
    padding: 16,
    borderRadius: 14,
    marginBottom: 12,
    shadowColor: '#000',
    shadowOpacity: isDarkMode ? 0.22 : 0.06,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
    elevation: 2,
  },
  cardHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  dateText: { fontSize: 16, fontWeight: '800', color: COLORS.text },
  badge: { borderRadius: 20, paddingHorizontal: 9, paddingVertical: 5 },
  openBadge: { backgroundColor: '#dcfce7' },
  closedBadge: { backgroundColor: '#e0e7ff' },
  badgeText: { fontSize: 10, fontWeight: '800' },
  openBadgeText: { color: '#15803d' },
  closedBadgeText: { color: '#4338ca' },
  timeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 16,
    paddingBottom: 14,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  timeBlock: { flex: 1 },
  timeBlockRight: { alignItems: 'flex-end' },
  timeLabel: { color: COLORS.textMuted, fontSize: 12, marginBottom: 3 },
  timeValue: { color: COLORS.text, fontSize: 20, fontWeight: '800' },
  cardFooter: { flexDirection: 'row', alignItems: 'center', marginTop: 12 },
  locationText: { flex: 1, color: COLORS.textMuted, fontSize: 12, marginRight: 8 },
  hoursText: { color: '#ea580c', fontWeight: '800', fontSize: 12 },
  emptyState: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingBottom: 70 },
  emptyTitle: { color: COLORS.text, fontWeight: '800', fontSize: 17, marginTop: 12 },
  emptyText: { color: COLORS.textMuted, textAlign: 'center', marginTop: 5, lineHeight: 20 },
});
