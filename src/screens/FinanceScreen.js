import React, { useContext, useEffect, useState, useMemo } from 'react';
import {
  ActivityIndicator,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  Dimensions,
  RefreshControl,
  Modal,
  TextInput,
  KeyboardAvoidingView,
  Platform
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { AppContext } from '../context/AppContext';
import { getDailyRevenue } from '../services/financeService';
import { exportToExcel } from '../utils/exportExcel';
import DateRangePickerModal from '../components/DateRangePickerModal';

const screenWidth = Dimensions.get('window').width;

// Lấy ngày theo giờ Việt Nam (UTC+7)
function getVNDateStr(date = new Date()) {
  const vnTime = new Date(date.getTime() + 7 * 60 * 60 * 1000);
  return vnTime.toISOString().split('T')[0];
}

// Định dạng ngày yyyy-mm-dd -> dd/MM/yyyy để hiển thị
function formatDate(dateStr) {
  if (!dateStr || dateStr.length < 10) return dateStr;
  const [y, m, d] = dateStr.split('-');
  return `${d}/${m}/${y}`;
}

const THEMES = {
  light: {
    bg: '#F8FAFC', card: '#FFFFFF', primary: '#3B82F6', accent: '#10B981',
    text: '#0F172A', textMuted: '#64748B', danger: '#EF4444', border: '#E2E8F0',
    chartBarDim: 'rgba(59,130,246,0.18)', modalBg: 'rgba(0,0,0,0.4)'
  },
  dark: {
    bg: '#0F172A', card: '#1E293B', primary: '#3B82F6', accent: '#10B981',
    text: '#F8FAFC', textMuted: '#94A3B8', danger: '#EF4444', border: '#334155',
    chartBarDim: 'rgba(59,130,246,0.15)', modalBg: 'rgba(0,0,0,0.6)'
  }
};

// ---- Custom Bar Chart ----
function CustomBarChart({ data, labels, COLORS }) {
  if (!data || data.length === 0) return null;
  const maxVal = Math.max(...data, 1);
  const CHART_HEIGHT = 160;
  const barWidth = Math.max(18, Math.min(36, (screenWidth - 80) / data.length - 4));

  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 8 }}>
      <View style={{ flexDirection: 'row', alignItems: 'flex-end', height: CHART_HEIGHT + 36 }}>
        {data.map((val, idx) => {
          const barH = Math.max(4, Math.round((val / maxVal) * CHART_HEIGHT));
          const isMax = val === maxVal;
          const valLabel = val >= 1000000
            ? (val / 1000000).toFixed(1) + 'tr'
            : val >= 1000 ? (val / 1000).toFixed(0) + 'k' : String(val);
          return (
            <View key={idx} style={{ alignItems: 'center', marginHorizontal: 2, width: barWidth }}>
              <Text style={{ fontSize: 8, color: isMax ? COLORS.primary : COLORS.textMuted, fontWeight: isMax ? 'bold' : '400', marginBottom: 2 }}>
                {valLabel}
              </Text>
              <View style={{ width: barWidth, height: barH, backgroundColor: isMax ? COLORS.primary : COLORS.chartBarDim, borderRadius: 4, borderTopLeftRadius: 6, borderTopRightRadius: 6 }} />
              <Text style={{ fontSize: 8, color: COLORS.textMuted, marginTop: 4, textAlign: 'center' }} numberOfLines={1}>
                {labels[idx] || ''}
              </Text>
            </View>
          );
        })}
      </View>
    </ScrollView>
  );
}

// ---- Custom Progress Bars ----
function CustomPieBars({ data, COLORS }) {
  if (!data || data.length === 0) return null;
  const total = data.reduce((s, d) => s + d.population, 0);
  return (
    <View style={{ paddingHorizontal: 20 }}>
      {data.map((item, idx) => {
        const pct = total > 0 ? (item.population / total) * 100 : 0;
        return (
          <View key={idx} style={{ marginBottom: 12 }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: item.color, marginRight: 6 }} />
                <Text style={{ color: COLORS.text, fontSize: 13, fontWeight: '600' }}>{item.name}</Text>
              </View>
              <Text style={{ color: COLORS.textMuted, fontSize: 12 }}>
                {pct.toFixed(1)}% · {(item.population / 1000000).toFixed(1)}tr đ
              </Text>
            </View>
            <View style={{ height: 6, backgroundColor: COLORS.border, borderRadius: 3, overflow: 'hidden' }}>
              <View style={{ height: 6, width: `${pct}%`, backgroundColor: item.color, borderRadius: 3 }} />
            </View>
          </View>
        );
      })}
    </View>
  );
}

// ---- Custom Calendar Picker Component ----
function CalendarPicker({ startDate, endDate, onChange, COLORS }) {
  const [currentDate, setCurrentDate] = useState(new Date());
  const year = currentDate.getFullYear();
  const month = currentDate.getMonth();

  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const firstDayIndex = new Date(year, month, 1).getDay();

  const handlePrevMonth = () => {
    setCurrentDate(new Date(year, month - 1, 1));
  };

  const handleNextMonth = () => {
    setCurrentDate(new Date(year, month + 1, 1));
  };

  const handleDayPress = (day) => {
    const dayStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    
    if (!startDate || (startDate && endDate)) {
      onChange(dayStr, null);
    } else {
      if (dayStr < startDate) {
        onChange(dayStr, null);
      } else {
        onChange(startDate, dayStr);
      }
    }
  };

  const dayRows = [];
  let currentWeek = Array(firstDayIndex).fill(null);

  for (let d = 1; d <= daysInMonth; d++) {
    currentWeek.push(d);
    if (currentWeek.length === 7) {
      dayRows.push(currentWeek);
      currentWeek = [];
    }
  }
  if (currentWeek.length > 0) {
    while (currentWeek.length < 7) {
      currentWeek.push(null);
    }
    dayRows.push(currentWeek);
  }

  const dayNames = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'];

  return (
    <View style={{ marginBottom: 12 }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
        <TouchableOpacity onPress={handlePrevMonth} style={{ padding: 6 }}>
          <Ionicons name="chevron-back" size={20} color={COLORS.text} />
        </TouchableOpacity>
        <Text style={{ fontSize: 15, fontWeight: 'bold', color: COLORS.text }}>
          {`Tháng ${month + 1} / ${year}`}
        </Text>
        <TouchableOpacity onPress={handleNextMonth} style={{ padding: 6 }}>
          <Ionicons name="chevron-forward" size={20} color={COLORS.text} />
        </TouchableOpacity>
      </View>

      <View style={{ flexDirection: 'row', marginBottom: 4 }}>
        {dayNames.map((name, idx) => (
          <Text key={idx} style={{ flex: 1, textAlign: 'center', fontSize: 11, fontWeight: '600', color: COLORS.textMuted }}>
            {name}
          </Text>
        ))}
      </View>

      {dayRows.map((week, wIdx) => (
        <View key={wIdx} style={{ flexDirection: 'row', marginVertical: 1 }}>
          {week.map((day, dIdx) => {
            if (day === null) {
              return <View key={dIdx} style={{ flex: 1 }} />;
            }

            const dayStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
            const isStart = dayStr === startDate;
            const isEnd = dayStr === endDate;
            const isWithinRange = startDate && endDate && dayStr > startDate && dayStr < endDate;

            let bgStyle = {};
            let textStyle = { color: COLORS.text, fontWeight: '500' };

            if (isStart) {
              bgStyle = { backgroundColor: COLORS.primary, borderTopLeftRadius: 16, borderBottomLeftRadius: 16 };
              if (!endDate || startDate === endDate) bgStyle.borderRadius = 16;
              textStyle = { color: '#ffffff', fontWeight: 'bold' };
            } else if (isEnd) {
              bgStyle = { backgroundColor: COLORS.primary, borderTopRightRadius: 16, borderBottomRightRadius: 16 };
              textStyle = { color: '#ffffff', fontWeight: 'bold' };
            } else if (isWithinRange) {
              bgStyle = { backgroundColor: COLORS.chartBarDim };
              textStyle = { color: COLORS.text, fontWeight: '600' };
            }

            return (
              <TouchableOpacity
                key={dIdx}
                onPress={() => handleDayPress(day)}
                style={[{ flex: 1, height: 32, justifyContent: 'center', alignItems: 'center' }, bgStyle]}
              >
                <Text style={[{ fontSize: 12 }, textStyle]}>
                  {day}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
      ))}
    </View>
  );
}

// ---- Date Range Modal ----
function DateRangeModal({ visible, onClose, onApply, COLORS }) {
  const today = getVNDateStr();
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');

  // Đồng bộ lại khi Modal hiển thị
  useEffect(() => {
    if (visible) {
      setStartDate('');
      setEndDate('');
    }
  }, [visible]);

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: COLORS.modalBg }}
      >
        <View style={{ backgroundColor: COLORS.card, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20 }}>
          <Text style={{ fontSize: 18, fontWeight: 'bold', color: COLORS.text, marginBottom: 12 }}>Chọn khoảng thời gian</Text>

          {/* Calendar picker */}
          <CalendarPicker
            startDate={startDate}
            endDate={endDate}
            onChange={(start, end) => {
              setStartDate(start);
              setEndDate(end);
            }}
            COLORS={COLORS}
          />

          {/* Date range display */}
          <View style={{ flexDirection: 'row', justifyContent: 'center', alignItems: 'center', backgroundColor: COLORS.bg, borderRadius: 12, padding: 10, marginBottom: 12 }}>
            <Ionicons name="calendar-outline" size={16} color={COLORS.primary} style={{ marginRight: 6 }} />
            <Text style={{ fontSize: 13, fontWeight: '600', color: COLORS.text }}>
              {startDate ? formatDate(startDate) : 'Từ ngày'}
            </Text>
            <Text style={{ marginHorizontal: 8, color: COLORS.textMuted }}>→</Text>
            <Text style={{ fontSize: 13, fontWeight: '600', color: COLORS.text }}>
              {endDate ? formatDate(endDate) : 'Đến ngày'}
            </Text>
          </View>

          {/* Shortcut buttons */}
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 16 }}>
            {[
              { label: 'Hôm qua', start: (() => { const d = new Date(); d.setDate(d.getDate() - 1); return getVNDateStr(d); })(), end: (() => { const d = new Date(); d.setDate(d.getDate() - 1); return getVNDateStr(d); })() },
              { label: 'Tuần này', start: (() => { const d = new Date(); d.setDate(d.getDate() - d.getDay()); return getVNDateStr(d); })() },
              { label: 'Tháng này', start: getVNDateStr(new Date()).slice(0, 8) + '01' },
              { label: 'Tháng trước', start: (() => { const d = new Date(); d.setMonth(d.getMonth() - 1, 1); return getVNDateStr(d); })(), end: (() => { const d = new Date(); d.setDate(0); return getVNDateStr(d); })() },
            ].map((s, i) => (
              <TouchableOpacity key={i} onPress={() => { setStartDate(s.start); setEndDate(s.end || today); }}
                style={{ paddingHorizontal: 12, paddingVertical: 6, backgroundColor: COLORS.border, borderRadius: 16, marginRight: 8 }}>
                <Text style={{ color: COLORS.text, fontSize: 12, fontWeight: '600' }}>{s.label}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>

          <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
            <TouchableOpacity onPress={onClose} style={{ flex: 1, marginRight: 8, padding: 12, borderRadius: 12, borderWidth: 1, borderColor: COLORS.border, alignItems: 'center' }}>
              <Text style={{ color: COLORS.textMuted, fontWeight: '600' }}>Huỷ</Text>
            </TouchableOpacity>
            <TouchableOpacity 
              onPress={() => onApply(startDate || null, endDate || startDate || null)}
              style={{ flex: 1, padding: 12, borderRadius: 12, backgroundColor: COLORS.primary, alignItems: 'center' }}
            >
              <Text style={{ color: '#fff', fontWeight: 'bold' }}>Áp dụng</Text>
            </TouchableOpacity>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

export default function FinanceScreen({ navigation }) {
  const { currentUser, storeList, COLORS: appColors, isDarkMode } = useContext(AppContext);
  const COLORS = useMemo(() => ({
    ...appColors,
    chartBarDim: isDarkMode ? 'rgba(96,165,250,0.18)' : 'rgba(59,130,246,0.18)',
    modalBg: isDarkMode ? 'rgba(2,6,23,0.78)' : 'rgba(15,23,42,0.35)',
  }), [appColors, isDarkMode]);
  const styles = useMemo(() => getStyles(COLORS), [COLORS]);
  const isOwner = currentUser?.role === 'OWNER';
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [revenues, setRevenues] = useState([]);
  const [storeIdToView, setStoreIdToView] = useState(isOwner ? 'ALL' : currentUser?.store_id);
  const [period, setPeriod] = useState('7');
  const [showDateModal, setShowDateModal] = useState(false);
  const [customRange, setCustomRange] = useState({ start: null, end: null });

  const fetchRevenues = async (start = null, end = null) => {
    try {
      const now = new Date();
      let startDateStr = start;
      let endDateStr = end;

      if (!start) {
        if (period === 'today') {
          startDateStr = getVNDateStr();
          endDateStr = getVNDateStr();
        } else if (period === 'yesterday') {
          const d = new Date(now); d.setDate(d.getDate() - 1);
          startDateStr = getVNDateStr(d);
          endDateStr = getVNDateStr(d);
        } else if (period === 'week') {
          const d = new Date(now); d.setDate(d.getDate() - d.getDay());
          startDateStr = getVNDateStr(d);
          endDateStr = getVNDateStr(now);
        } else if (period === 'month') {
          startDateStr = getVNDateStr(now).slice(0, 8) + '01';
          endDateStr = getVNDateStr(now);
        } else if (period === '7') {
          const d = new Date(now); d.setDate(d.getDate() - 7);
          startDateStr = getVNDateStr(d);
        } else if (period === '30') {
          const d = new Date(now); d.setDate(d.getDate() - 30);
          startDateStr = getVNDateStr(d);
        }
      }

      const data = await getDailyRevenue(storeIdToView, startDateStr, endDateStr);
      setRevenues(data || []);
    } catch (e) {
      console.log('Error fetching revenue', e);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    setLoading(true);
    if (period === 'custom') {
      fetchRevenues(customRange.start, customRange.end);
    } else {
      fetchRevenues();
    }
  }, [storeIdToView, period, customRange]);

  const onRefresh = () => { setRefreshing(true); fetchRevenues(customRange.start, customRange.end); };

  const onApplyDateRange = (start, end) => {
    setCustomRange({ start, end });
    setPeriod('custom');
    setShowDateModal(false);
  };

  // Tính toán
  const totalRevenue = revenues.reduce((sum, i) => sum + Number(i.total_amount), 0);
  const totalOrders = revenues.reduce((sum, i) => sum + Number(i.order_count), 0);
  const aov = totalOrders > 0 ? Math.round(totalRevenue / totalOrders) : 0;

  const storeName = storeIdToView === 'ALL'
    ? 'Tất cả chi nhánh'
    : storeList.find((s) => String(s.id) === String(storeIdToView))?.name || 'Chi nhánh';

  // Dữ liệu biểu đồ
  const sortedRevenues = [...revenues].sort((a, b) => a.date.localeCompare(b.date));
  const grouped = {};
  sortedRevenues.forEach(r => {
    const d = r.date.slice(-5);
    grouped[d] = (grouped[d] || 0) + Number(r.total_amount);
  });
  const chartKeys = Object.keys(grouped);
  const chartData = chartKeys.map(k => grouped[k]);
  const chartLabels = chartKeys.map(k => k.replace('-', '/'));

  // Pie
  let pieData = [];
  if (storeIdToView === 'ALL' && sortedRevenues.length > 0) {
    const storeRev = {};
    sortedRevenues.forEach(r => { storeRev[r.store_id] = (storeRev[r.store_id] || 0) + Number(r.total_amount); });
    const colors = ['#3B82F6', '#10B981', '#F59E0B', '#8B5CF6', '#EC4899'];
    let ci = 0;
    Object.keys(storeRev).forEach(sId => {
      if (storeRev[sId] > 0) {
        const sName = storeList.find(s => String(s.id) === String(sId))?.name || `Quán ${sId}`;
        pieData.push({ name: sName, population: storeRev[sId], color: colors[ci++ % colors.length] });
      }
    });
  }

  const todayStr = getVNDateStr(); // Dùng giờ VN để so sánh

  const latestSyncTime = useMemo(() => {
    if (!revenues || revenues.length === 0) return null;
    let maxTime = null;
    revenues.forEach(r => {
      if (r.created_at) {
        if (!maxTime || r.created_at > maxTime) {
          maxTime = r.created_at;
        }
      }
    });
    if (!maxTime) return null;
    try {
      const d = new Date(maxTime);
      const hh = String(d.getHours()).padStart(2, '0');
      const mm = String(d.getMinutes()).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      const month = String(d.getMonth() + 1).padStart(2, '0');
      return `${hh}:${mm} (${day}/${month})`;
    } catch (e) {
      return null;
    }
  }, [revenues]);

  const renderMetric = (label, value, icon) => (
    <View style={styles.metricCard}>
      <View style={styles.metricIconWrap}>
        <Ionicons name={icon} size={20} color={COLORS.primary} />
      </View>
      <Text style={styles.metricLabel}>{label}</Text>
      <Text style={styles.metricValue}>{value}</Text>
    </View>
  );

  const periodLabel = period === 'custom'
    ? `${formatDate(customRange.start) || '...'} → ${formatDate(customRange.end) || '...'}`
    : null;

  const handleExportFinance = async () => {
    try {
      const exportData = revenues.map(item => {
        const store = storeList.find(s => String(s.id) === String(item.store_id));
        return {
          'Ngày': item.date,
          'Chi Nhánh': store?.name || `Quán ${item.store_id}`,
          'Doanh Thu Cửa Hàng': item.store_revenue,
          'Doanh Thu App (Ocha/Gofood/...)': item.app_revenue,
          'Tổng Doanh Thu': item.total_revenue
        };
      });
      
      const fileName = `Bao_Cao_Tai_Chinh_${periodLabel ? periodLabel.replace(/\s+/g, '_') : 'Hom_Nay'}`;
      await exportToExcel(exportData, fileName, 'Tài Chính');
      Alert.alert('Thành công', 'Đã xuất file Excel Tài chính!');
    } catch (error) {
      Alert.alert('Lỗi', 'Không thể xuất báo cáo: ' + error.message);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.headerRow}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={24} color={COLORS.text} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={styles.header}>Tài chính & Doanh thu</Text>
          <Text style={styles.headerCaption}>{storeName}</Text>
        </View>
        <TouchableOpacity onPress={handleExportFinance} style={{ padding: 5 }}>
          <Ionicons name="download-outline" size={24} color={COLORS.primary} />
        </TouchableOpacity>
      </View>

      {/* Branch Selector */}
      {isOwner && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterRow} style={{ flexGrow: 0, height: 50 }}>
          <TouchableOpacity style={[styles.filterBtn, storeIdToView === 'ALL' && styles.filterBtnActive]} onPress={() => setStoreIdToView('ALL')}>
            <Text style={[styles.filterBtnText, storeIdToView === 'ALL' && styles.filterBtnTextActive]}>Tất cả</Text>
          </TouchableOpacity>
          {storeList.map(s => (
            <TouchableOpacity key={s.id} style={[styles.filterBtn, storeIdToView === s.id && styles.filterBtnActive]} onPress={() => setStoreIdToView(s.id)}>
              <Text style={[styles.filterBtnText, storeIdToView === s.id && styles.filterBtnTextActive]}>{s.name}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      )}

      {/* Period Selector */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.periodRow} style={{ flexGrow: 0, height: 45 }}>
        {[['today', 'Hôm nay'], ['yesterday', 'Hôm qua'], ['week', 'Tuần này'], ['month', 'Tháng này'], ['7', '7 ngày'], ['30', '30 ngày']].map(([val, label]) => (
          <TouchableOpacity key={val} style={[styles.periodBtn, period === val && styles.periodBtnActive]} onPress={() => setPeriod(val)}>
            <Text style={[styles.periodText, period === val && styles.periodTextActive]}>{label}</Text>
          </TouchableOpacity>
        ))}
        <TouchableOpacity style={[styles.periodBtn, period === 'custom' && styles.periodBtnActive]} onPress={() => setShowDateModal(true)}>
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <Ionicons name="calendar-outline" size={13} color={period === 'custom' ? COLORS.primary : COLORS.textMuted} style={{ marginRight: 4 }} />
            <Text style={[styles.periodText, period === 'custom' && styles.periodTextActive]}>
              {period === 'custom' ? periodLabel : 'Tùy chọn'}
            </Text>
          </View>
        </TouchableOpacity>
      </ScrollView>

      {loading ? (
        <View style={styles.center}><ActivityIndicator size="large" color={COLORS.primary} /></View>
      ) : (
        <ScrollView style={styles.scrollContent} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={COLORS.primary} />}>
          <View style={styles.mainCard}>
            <Text style={styles.mainCardLabel}>Tổng doanh thu Ocha</Text>
            <Text style={styles.mainCardValue}>{totalRevenue.toLocaleString('vi-VN')} đ</Text>
            {latestSyncTime && (
              <Text style={styles.mainCardSync}>Cập nhật lúc: {latestSyncTime}</Text>
            )}
          </View>

          <View style={styles.metricsGrid}>
            {renderMetric('Đơn hàng', totalOrders.toLocaleString(), 'receipt-outline')}
            {renderMetric('Giá trị/Đơn', aov.toLocaleString() + ' đ', 'cash-outline')}
          </View>

          <View style={styles.chartCard}>
            <View style={styles.chartTitleRow}>
              <Text style={styles.sectionTitle}>Xu hướng doanh thu</Text>
              <View style={styles.chartTotalBadge}>
                <Text style={styles.chartTotalText}>{totalRevenue.toLocaleString('vi-VN')} đ</Text>
                <Text style={styles.chartTotalSub}>{chartKeys.length} ngày</Text>
              </View>
            </View>
            {chartData.length > 0
              ? <CustomBarChart data={chartData} labels={chartLabels} COLORS={COLORS} />
              : <Text style={styles.emptyText}>Chưa có dữ liệu biểu đồ</Text>
            }
          </View>

          {storeIdToView === 'ALL' && pieData.length > 0 && (
            <View style={styles.chartCard}>
              <Text style={[styles.sectionTitle, { paddingHorizontal: 20, marginBottom: 15 }]}>Tỷ trọng chi nhánh</Text>
              <CustomPieBars data={pieData} COLORS={COLORS} />
            </View>
          )}

          <View style={styles.listCard}>
            <Text style={[styles.sectionTitle, { paddingHorizontal: 20, marginBottom: 15 }]}>Lịch sử chi tiết</Text>
            {revenues.length === 0 ? (
              <Text style={styles.emptyText}>Không có dữ liệu</Text>
            ) : (
              [...revenues].sort((a, b) => b.date.localeCompare(a.date)).map((item, idx) => {
                const sName = storeList.find((s) => String(s.id) === String(item.store_id))?.name || `Quán ${item.store_id}`;
                const isToday = item.date === todayStr;
                return (
                  <View key={item.id} style={[styles.row, idx === revenues.length - 1 && { borderBottomWidth: 0 }, isToday && styles.rowToday]}>
                    <View style={styles.rowLeft}>
                      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                        <Text style={[styles.rowDate, isToday && { color: COLORS.primary }]}>{formatDate(item.date)}</Text>
                        {isToday && (
                          <View style={[styles.todayBadge, { marginLeft: 8 }]}>
                            <Text style={styles.todayBadgeText}>Hôm nay</Text>
                          </View>
                        )}
                      </View>
                      {storeIdToView === 'ALL' && <Text style={styles.rowMeta}>{sName}</Text>}
                    </View>
                    <View style={styles.rowRight}>
                      <Text style={[styles.rowAmount, isToday && { color: COLORS.primary }]}>{Number(item.total_amount).toLocaleString('vi-VN')} đ</Text>
                      <Text style={styles.rowMetaRight}>{item.order_count} đơn</Text>
                    </View>
                  </View>
                );
              })
            )}
          </View>
          <View style={{ height: 40 }} />
        </ScrollView>
      )}

      <DateRangePickerModal
        visible={showDateModal}
        onClose={() => setShowDateModal(false)}
        onApply={onApplyDateRange}
        initialStartDate={customRange.start}
        initialEndDate={customRange.end}
        COLORS={COLORS}
        isDarkMode={isDarkMode}
        title="Chọn ngày xem báo cáo"
      />
    </SafeAreaView>
  );
}

const getStyles = (COLORS) => StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.bg },
  headerRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingTop: 10, paddingBottom: 15 },
  backBtn: { marginRight: 15, padding: 5 },
  header: { fontSize: 22, fontWeight: 'bold', color: COLORS.text },
  headerCaption: { fontSize: 13, color: COLORS.textMuted, marginTop: 2 },
  filterRow: { flexDirection: 'row', paddingHorizontal: 20, alignItems: 'center' },
  filterBtn: { paddingHorizontal: 16, paddingVertical: 8, borderRadius: 20, backgroundColor: COLORS.border, marginRight: 10 },
  filterBtnActive: { backgroundColor: COLORS.primary },
  filterBtnText: { color: COLORS.textMuted, fontWeight: '600', fontSize: 13 },
  filterBtnTextActive: { color: '#FFF' },
  periodRow: { flexDirection: 'row', paddingHorizontal: 20, paddingVertical: 4, alignItems: 'center' },
  periodBtn: { paddingVertical: 6, paddingHorizontal: 12, marginRight: 12, borderBottomWidth: 2, borderBottomColor: 'transparent' },
  periodBtnActive: { borderBottomColor: COLORS.primary },
  periodText: { color: COLORS.textMuted, fontWeight: '600', fontSize: 13 },
  periodTextActive: { color: COLORS.primary },
  scrollContent: { paddingHorizontal: 20, paddingTop: 10 },
  mainCard: { backgroundColor: COLORS.primary, padding: 24, borderRadius: 20, marginBottom: 15, elevation: 5 },
  mainCardLabel: { color: 'rgba(255,255,255,0.8)', fontSize: 14, marginBottom: 8, fontWeight: '600' },
  mainCardValue: { color: '#fff', fontSize: 34, fontWeight: 'bold' },
  mainCardSync: { color: 'rgba(255,255,255,0.7)', fontSize: 11, marginTop: 8, fontWeight: '500' },
  metricsGrid: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 20 },
  metricCard: { width: '48%', backgroundColor: COLORS.card, padding: 16, borderRadius: 16, borderWidth: 1, borderColor: COLORS.border },
  metricIconWrap: { width: 36, height: 36, borderRadius: 18, backgroundColor: 'rgba(59,130,246,0.1)', justifyContent: 'center', alignItems: 'center', marginBottom: 12 },
  metricLabel: { color: COLORS.textMuted, fontSize: 12, marginBottom: 4 },
  metricValue: { color: COLORS.text, fontSize: 18, fontWeight: 'bold' },
  chartCard: { backgroundColor: COLORS.card, paddingTop: 20, paddingBottom: 8, borderRadius: 20, marginBottom: 20, borderWidth: 1, borderColor: COLORS.border },
  chartTitleRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', paddingHorizontal: 20, marginBottom: 15 },
  sectionTitle: { fontSize: 16, fontWeight: 'bold', color: COLORS.text },
  chartTotalBadge: { alignItems: 'flex-end' },
  chartTotalText: { fontSize: 14, fontWeight: 'bold', color: COLORS.accent },
  chartTotalSub: { fontSize: 11, color: COLORS.textMuted, marginTop: 2 },
  emptyText: { textAlign: 'center', color: COLORS.textMuted, fontStyle: 'italic', paddingVertical: 20 },
  listCard: { backgroundColor: COLORS.card, paddingVertical: 20, borderRadius: 20, borderWidth: 1, borderColor: COLORS.border },
  row: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 12, paddingHorizontal: 20, borderBottomWidth: 1, borderBottomColor: COLORS.border },
  rowToday: { backgroundColor: 'rgba(59,130,246,0.07)' },
  todayBadge: { backgroundColor: COLORS.primary, paddingHorizontal: 8, paddingVertical: 2, borderRadius: 10 },
  todayBadgeText: { color: '#fff', fontSize: 10, fontWeight: 'bold' },
  rowLeft: { flex: 1 },
  rowDate: { fontSize: 15, fontWeight: 'bold', color: COLORS.text },
  rowMeta: { fontSize: 12, color: COLORS.textMuted, marginTop: 4 },
  rowRight: { alignItems: 'flex-end' },
  rowAmount: { fontSize: 15, fontWeight: 'bold', color: COLORS.accent },
  rowMetaRight: { fontSize: 12, color: COLORS.textMuted, marginTop: 4 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' }
});
