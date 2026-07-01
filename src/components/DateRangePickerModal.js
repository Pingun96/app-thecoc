import React, { useEffect, useMemo, useState } from 'react';
import { Modal, Platform, ScrollView, Text, TouchableOpacity, View, KeyboardAvoidingView, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

const pad = (value) => String(value).padStart(2, '0');

const toDateKey = (date = new Date()) => {
  const local = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  return `${local.getFullYear()}-${pad(local.getMonth() + 1)}-${pad(local.getDate())}`;
};

const formatDate = (dateKey) => {
  if (!dateKey) return '';
  const [year, month, day] = dateKey.split('-');
  return `${day}/${month}/${year}`;
};

const getStartOfWeek = () => {
  const today = new Date();
  const day = today.getDay();
  const diff = day === 0 ? 6 : day - 1;
  const monday = new Date(today);
  monday.setDate(today.getDate() - diff);
  return monday;
};

export default function DateRangePickerModal({
  visible,
  onClose,
  onApply,
  initialStartDate,
  initialEndDate,
  COLORS,
  isDarkMode,
  title = 'Chọn khoảng thời gian',
}) {
  const todayKey = toDateKey();
  const [cursorDate, setCursorDate] = useState(new Date());
  const [startDate, setStartDate] = useState(initialStartDate || todayKey);
  const [endDate, setEndDate] = useState(initialEndDate || todayKey);

  useEffect(() => {
    if (!visible) return;
    const start = initialStartDate || todayKey;
    const end = initialEndDate || initialStartDate || todayKey;
    setStartDate(start);
    setEndDate(end);
    const [year, month] = start.split('-').map(Number);
    if (year && month) {
      setCursorDate(new Date(year, month - 1, 1));
    }
  }, [visible, initialStartDate, initialEndDate, todayKey]);

  const styles = useMemo(() => getStyles(COLORS, isDarkMode), [COLORS, isDarkMode]);
  const year = cursorDate.getFullYear();
  const month = cursorDate.getMonth();

  const weeks = useMemo(() => {
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const firstDay = new Date(year, month, 1).getDay();
    const rows = [];
    let row = Array(firstDay).fill(null);

    for (let day = 1; day <= daysInMonth; day += 1) {
      row.push(day);
      if (row.length === 7) {
        rows.push(row);
        row = [];
      }
    }

    if (row.length) {
      while (row.length < 7) row.push(null);
      rows.push(row);
    }

    return rows;
  }, [year, month]);

  const selectDay = (day) => {
    const nextDate = `${year}-${pad(month + 1)}-${pad(day)}`;

    if (!startDate || (startDate && endDate)) {
      setStartDate(nextDate);
      setEndDate(null);
      return;
    }

    if (nextDate < startDate) {
      setStartDate(nextDate);
      setEndDate(null);
      return;
    }

    setEndDate(nextDate);
  };

  const applyShortcut = (type) => {
    const now = new Date();

    if (type === 'today') {
      const key = toDateKey(now);
      setStartDate(key);
      setEndDate(key);
      setCursorDate(new Date(now.getFullYear(), now.getMonth(), 1));
      return;
    }

    if (type === 'yesterday') {
      const d = new Date(now);
      d.setDate(now.getDate() - 1);
      const key = toDateKey(d);
      setStartDate(key);
      setEndDate(key);
      setCursorDate(new Date(d.getFullYear(), d.getMonth(), 1));
      return;
    }

    if (type === 'week') {
      const start = getStartOfWeek();
      setStartDate(toDateKey(start));
      setEndDate(toDateKey(now));
      setCursorDate(new Date(start.getFullYear(), start.getMonth(), 1));
      return;
    }

    if (type === 'month') {
      const start = new Date(now.getFullYear(), now.getMonth(), 1);
      setStartDate(toDateKey(start));
      setEndDate(toDateKey(now));
      setCursorDate(start);
      return;
    }

    if (type === 'lastMonth') {
      const start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const end = new Date(now.getFullYear(), now.getMonth(), 0);
      setStartDate(toDateKey(start));
      setEndDate(toDateKey(end));
      setCursorDate(start);
    }
  };

  const handleApply = () => {
    const finalStart = startDate || todayKey;
    const finalEnd = endDate || startDate || todayKey;
    onApply(finalStart <= finalEnd ? finalStart : finalEnd, finalStart <= finalEnd ? finalEnd : finalStart);
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.overlay}
      >
        <View style={styles.sheet}>
          <View style={styles.headerRow}>
            <View>
              <Text style={styles.title}>{title}</Text>
              <Text style={styles.subtitle}>Chạm ngày bắt đầu, rồi chọn ngày kết thúc.</Text>
            </View>
            <TouchableOpacity onPress={onClose} style={styles.closeBtn}>
              <Ionicons name="close" size={22} color={COLORS.text} />
            </TouchableOpacity>
          </View>

          <View style={styles.monthRow}>
            <TouchableOpacity style={styles.monthBtn} onPress={() => setCursorDate(new Date(year, month - 1, 1))}>
              <Ionicons name="chevron-back" size={22} color={COLORS.text} />
            </TouchableOpacity>
            <Text style={styles.monthText}>Tháng {month + 1} / {year}</Text>
            <TouchableOpacity style={styles.monthBtn} onPress={() => setCursorDate(new Date(year, month + 1, 1))}>
              <Ionicons name="chevron-forward" size={22} color={COLORS.text} />
            </TouchableOpacity>
          </View>

          <View style={styles.weekdayRow}>
            {['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'].map((day) => (
              <Text key={day} style={styles.weekdayText}>{day}</Text>
            ))}
          </View>

          {weeks.map((week, weekIndex) => (
            <View key={weekIndex} style={styles.weekRow}>
              {week.map((day, dayIndex) => {
                if (!day) return <View key={dayIndex} style={styles.dayCell} />;

                const dateKey = `${year}-${pad(month + 1)}-${pad(day)}`;
                const isStart = dateKey === startDate;
                const isEnd = dateKey === endDate;
                const isToday = dateKey === todayKey;
                const inRange = startDate && endDate && dateKey > startDate && dateKey < endDate;
                const selected = isStart || isEnd;

                return (
                  <TouchableOpacity
                    key={dateKey}
                    style={[
                      styles.dayCell,
                      inRange && styles.dayInRange,
                      selected && styles.daySelected,
                      isToday && !selected && styles.dayToday,
                    ]}
                    onPress={() => selectDay(day)}
                  >
                    <Text style={[
                      styles.dayText,
                      selected && styles.dayTextSelected,
                      inRange && styles.dayTextInRange,
                    ]}>
                      {day}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          ))}

          <View style={styles.rangePreview}>
            <Ionicons name="calendar-outline" size={17} color={COLORS.primary} />
            <Text style={styles.rangeText}>
              {startDate ? formatDate(startDate) : 'Từ ngày'}  →  {endDate ? formatDate(endDate) : 'Đến ngày'}
            </Text>
          </View>

          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.shortcutRow}>
            {[
              ['today', 'Hôm nay'],
              ['yesterday', 'Hôm qua'],
              ['week', 'Tuần này'],
              ['month', 'Tháng này'],
              ['lastMonth', 'Tháng trước'],
            ].map(([key, label]) => (
              <TouchableOpacity key={key} style={styles.shortcutBtn} onPress={() => applyShortcut(key)}>
                <Text style={styles.shortcutText}>{label}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>

          <View style={styles.actionRow}>
            <TouchableOpacity style={[styles.actionBtn, styles.cancelBtn]} onPress={onClose}>
              <Text style={styles.cancelText}>Huỷ</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.actionBtn, styles.applyBtn]} onPress={handleApply}>
              <Text style={styles.applyText}>Áp dụng</Text>
            </TouchableOpacity>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const getStyles = (COLORS, isDarkMode) => StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: isDarkMode ? 'rgba(2,6,23,0.78)' : 'rgba(15,23,42,0.35)',
  },
  sheet: {
    backgroundColor: COLORS.card,
    borderTopLeftRadius: 26,
    borderTopRightRadius: 26,
    padding: 20,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 14 },
  title: { fontSize: 19, fontWeight: '900', color: COLORS.text },
  subtitle: { color: COLORS.textMuted, fontSize: 12, marginTop: 4 },
  closeBtn: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: COLORS.inputBg },
  monthRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: COLORS.inputBg, borderRadius: 16, padding: 8, borderWidth: 1, borderColor: COLORS.border },
  monthBtn: { width: 38, height: 34, alignItems: 'center', justifyContent: 'center' },
  monthText: { color: COLORS.text, fontSize: 16, fontWeight: '800' },
  weekdayRow: { flexDirection: 'row', marginTop: 16, marginBottom: 6 },
  weekdayText: { flex: 1, textAlign: 'center', color: COLORS.textMuted, fontSize: 12, fontWeight: '800' },
  weekRow: { flexDirection: 'row', marginVertical: 2 },
  dayCell: { flex: 1, minHeight: 40, marginHorizontal: 2, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  dayToday: { borderWidth: 1, borderColor: COLORS.primary },
  dayInRange: { backgroundColor: isDarkMode ? '#0f2a44' : '#dbeafe' },
  daySelected: { backgroundColor: COLORS.primary },
  dayText: { color: COLORS.text, fontSize: 14, fontWeight: '700' },
  dayTextInRange: { color: COLORS.text },
  dayTextSelected: { color: isDarkMode ? '#052e16' : '#ffffff', fontWeight: '900' },
  rangePreview: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: COLORS.inputBg, borderRadius: 14, padding: 12, marginTop: 14, borderWidth: 1, borderColor: COLORS.border },
  rangeText: { color: COLORS.text, fontWeight: '800', fontSize: 13 },
  shortcutRow: { paddingVertical: 14 },
  shortcutBtn: { paddingHorizontal: 14, paddingVertical: 8, backgroundColor: COLORS.inputBg, borderRadius: 18, marginRight: 8, borderWidth: 1, borderColor: COLORS.border },
  shortcutText: { color: COLORS.text, fontSize: 12, fontWeight: '800' },
  actionRow: { flexDirection: 'row', gap: 10 },
  actionBtn: { flex: 1, paddingVertical: 14, borderRadius: 14, alignItems: 'center' },
  cancelBtn: { backgroundColor: COLORS.inputBg, borderWidth: 1, borderColor: COLORS.border },
  applyBtn: { backgroundColor: COLORS.primary },
  cancelText: { color: COLORS.text, fontWeight: '800' },
  applyText: { color: isDarkMode ? '#052e16' : '#ffffff', fontWeight: '900' },
});
