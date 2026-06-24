import React, { useContext, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { AppContext } from '../context/AppContext';
import {
  checkoutAttendanceRecord,
  createAttendanceRecord,
  uploadAttendancePhoto,
} from '../services/attendanceService';
import { normalizeAttendance } from '../services/dataMappers';
import {
  calculateWorkedHours,
  formatDate,
  formatDuration,
  getLocalDateKey,
  getLocalTime,
} from '../utils/dateTime';

export default function StaffCheckinScreen({ navigation }) {
  const {
    currentUser,
    attendanceHistory,
    setAttendanceHistory,
    shiftRegistrations,
  } = useContext(AppContext);
  const [actionType, setActionType] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const today = getLocalDateKey();
  const currentRecord = useMemo(
    () => attendanceHistory.find(
      (record) => record.user_id === currentUser?.id
        && record.date === today
        && !(record.checkOut || record.check_out),
    ),
    [attendanceHistory, currentUser?.id, today],
  );

  const todayRecords = useMemo(
    () => attendanceHistory.filter(
      (record) => record.user_id === currentUser?.id && record.date === today,
    ),
    [attendanceHistory, currentUser?.id, today],
  );

  const requestAttendancePermissions = async () => {
    return true;
  };

  const handleAttendancePress = async (type) => {
    if (!currentUser?.id) {
      Alert.alert('Phiên đăng nhập không hợp lệ', 'Vui lòng đăng nhập lại.');
      return;
    }
    if (type === 'check-in' && currentRecord) {
      Alert.alert('Đã vào ca', 'Bạn cần kết thúc ca hiện tại trước khi chấm công mới.');
      return;
    }
    if (type === 'check-out' && !currentRecord) {
      Alert.alert('Không có ca đang mở', 'Không tìm thấy lượt check-in cần kết thúc.');
      return;
    }

    if (type === 'check-in') {
      const myApprovedShiftsToday = shiftRegistrations.filter(
        (r) => r.user_id === currentUser.id && r.date === today && r.status === 'APPROVED'
      );
      
      if (myApprovedShiftsToday.length === 0) {
        Alert.alert(
          'Không có lịch làm việc',
          'Quản lý chưa duyệt ca nào cho bạn trong ngày hôm nay.\n\nBạn có chắc chắn muốn Check-in làm ngoài ca không?',
          [
            { text: 'Hủy', style: 'cancel' },
            { 
              text: 'Vẫn Check-in', 
              onPress: async () => {
                setActionType(type);
                takePictureAndSubmit('check-in');
              }
            }
          ]
        );
        return; // Dừng lại chờ người dùng confirm
      }
    }

    setActionType(type);
    takePictureAndSubmit(type);
  };

  const takePictureAndSubmit = async (currentAction) => {
    if (isSubmitting) return;
    setIsSubmitting(true);

    try {
      const now = new Date();
      const time = getLocalTime(now);
      const timestamp = now.toISOString();
      const latitude = 0;
      const longitude = 0;
      const act = currentAction || actionType;

      if (act === 'check-in') {
        const recordId = `att_${Date.now()}`;

        const savedRecord = await createAttendanceRecord({
          id: recordId,
          userId: currentUser.id,
          storeId: currentUser.store_id,
          date: today,
          time,
          timestamp,
          latitude,
          longitude,
          photoPath: '',
        });

        const normalizedRecord = normalizeAttendance({
          ...savedRecord,
          check_in_at: timestamp,
          check_in_lat: latitude,
          check_in_lng: longitude,
          check_in_photo_path: '',
        });
        setAttendanceHistory((current) => [...current, normalizedRecord]);

        Alert.alert(
          'Check-in thành công',
          `${time} • Đã lưu dữ liệu chấm công.`,
        );
      } else {
        const workedHours = calculateWorkedHours({
          date: currentRecord.date,
          checkIn: currentRecord.checkIn || currentRecord.check_in,
          checkOut: time,
          checkInAt: currentRecord.check_in_at,
          checkOutAt: timestamp,
        });

        const savedFields = await checkoutAttendanceRecord({
          id: currentRecord.id,
          time,
          timestamp,
          hours: workedHours,
          latitude,
          longitude,
          photoPath: '',
        });

        setAttendanceHistory((current) => current.map((record) => (
          record.id === currentRecord.id
            ? normalizeAttendance({
                ...record,
                ...savedFields,
                check_out_at: timestamp,
                check_out_lat: latitude,
                check_out_lng: longitude,
                check_out_photo_path: '',
              })
            : record
        )));

        Alert.alert(
          'Check-out thành công',
          `${time} • Tổng thời gian: ${formatDuration(workedHours)}`,
        );
      }
    } catch (error) {
      console.error('Lỗi chấm công:', error);
      Alert.alert(
        'Không thể chấm công',
        error?.message || 'Đã có lỗi khi lưu dữ liệu.',
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  const latestRecord = [...todayRecords].sort((a, b) => String(b.id).localeCompare(String(a.id)))[0];

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <View style={styles.headerRow}>
          <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
            <Ionicons name="arrow-back" size={24} color="#1565c0" />
          </TouchableOpacity>
          <View>
            <Text style={styles.header}>Chấm công</Text>
            <Text style={styles.headerCaption}>Xác thực thời gian làm việc</Text>
          </View>
        </View>

        <View style={styles.statusCard}>
          <View style={styles.statusHeader}>
            <View>
              <Text style={styles.statusDate}>{formatDate(today)}</Text>
              <Text style={styles.statusTitle}>
                {currentRecord ? 'Bạn đang trong ca làm' : 'Chưa có ca đang mở'}
              </Text>
            </View>
            <View style={[styles.statusBadge, currentRecord ? styles.badgeActive : styles.badgeIdle]}>
              <Text style={[styles.statusBadgeText, currentRecord ? styles.badgeActiveText : styles.badgeIdleText]}>
                {currentRecord ? 'ĐANG LÀM' : 'CHỜ VÀO CA'}
              </Text>
            </View>
          </View>

          <View style={styles.timeline}>
            <View style={styles.timelineItem}>
              <Text style={styles.timelineLabel}>Vào ca</Text>
              <Text style={styles.timelineValue}>
                {currentRecord?.checkIn || currentRecord?.check_in || latestRecord?.checkIn || latestRecord?.check_in || '--:--'}
              </Text>
            </View>
            <Ionicons name="arrow-forward" size={20} color="#94a3b8" />
            <View style={styles.timelineItem}>
              <Text style={styles.timelineLabel}>Kết thúc</Text>
              <Text style={styles.timelineValue}>
                {latestRecord?.checkOut || latestRecord?.check_out || '--:--'}
              </Text>
            </View>
          </View>
        </View>

        <View style={styles.infoCard}>
          <Ionicons name="shield-checkmark-outline" size={24} color="#1565c0" />
          <Text style={styles.infoText}>
            Thời gian bắt đầu và kết thúc ca làm việc sẽ được ghi nhận.
          </Text>
        </View>

        {!currentRecord ? (
          <TouchableOpacity
            style={[styles.primaryButton, styles.checkInButton]}
            onPress={() => handleAttendancePress('check-in')}
          >
            <Ionicons name="log-in-outline" size={23} color="#fff" />
            <Text style={styles.primaryButtonText}>Check-in vào ca</Text>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity
            style={[styles.primaryButton, styles.checkOutButton]}
            onPress={() => handleAttendancePress('check-out')}
          >
            <Ionicons name="log-out-outline" size={23} color="#fff" />
            <Text style={styles.primaryButtonText}>Check-out kết thúc ca</Text>
          </TouchableOpacity>
        )}

        <Text style={styles.note}>
          Mỗi nhân viên chỉ có một ca đang mở tại một thời điểm.
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f4f7fb' },
  scrollContent: { paddingHorizontal: 20, paddingTop: 12, paddingBottom: 40 },
  headerRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 22 },
  backBtn: { padding: 8, marginRight: 8, marginLeft: -8 },
  header: { fontSize: 26, fontWeight: '800', color: '#172033' },
  headerCaption: { color: '#64748b', marginTop: 2 },
  statusCard: {
    backgroundColor: '#fff',
    borderRadius: 18,
    padding: 20,
    shadowColor: '#0f172a',
    shadowOpacity: 0.08,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 5 },
    elevation: 3,
  },
  statusHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  statusDate: { color: '#64748b', fontWeight: '600', marginBottom: 5 },
  statusTitle: { color: '#172033', fontWeight: '800', fontSize: 18 },
  statusBadge: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 20 },
  badgeActive: { backgroundColor: '#dcfce7' },
  badgeIdle: { backgroundColor: '#e2e8f0' },
  statusBadgeText: { fontSize: 11, fontWeight: '800' },
  badgeActiveText: { color: '#15803d' },
  badgeIdleText: { color: '#475569' },
  timeline: {
    marginTop: 22,
    paddingTop: 18,
    borderTopWidth: 1,
    borderTopColor: '#edf1f5',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  timelineItem: { flex: 1 },
  timelineLabel: { color: '#64748b', fontSize: 12, marginBottom: 4 },
  timelineValue: { color: '#172033', fontWeight: '800', fontSize: 24 },
  infoCard: {
    flexDirection: 'row',
    backgroundColor: '#e8f1ff',
    borderRadius: 14,
    padding: 15,
    marginTop: 18,
    alignItems: 'flex-start',
  },
  infoText: { flex: 1, color: '#334155', lineHeight: 20, marginLeft: 10 },
  primaryButton: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: 14,
    paddingVertical: 17,
    marginTop: 22,
    shadowColor: '#0f172a',
    shadowOpacity: 0.12,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 3,
  },
  checkInButton: { backgroundColor: '#16a34a' },
  checkOutButton: { backgroundColor: '#dc2626' },
  primaryButtonText: { color: '#fff', fontSize: 17, fontWeight: '800', marginLeft: 9 },
  note: { color: '#64748b', textAlign: 'center', marginTop: 14, fontSize: 12 },
  cameraContainer: { flex: 1, backgroundColor: '#000' },
  cameraTop: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    paddingTop: 54,
    paddingHorizontal: 18,
    paddingBottom: 24,
    backgroundColor: 'rgba(0,0,0,0.45)',
    flexDirection: 'row',
    alignItems: 'center',
  },
  cameraClose: { padding: 6, marginRight: 12 },
  cameraTitle: { color: '#fff', fontWeight: '700', fontSize: 16 },
  faceGuide: {
    position: 'absolute',
    width: 230,
    height: 300,
    borderRadius: 120,
    borderWidth: 3,
    borderColor: 'rgba(255,255,255,0.9)',
    alignSelf: 'center',
    top: '24%',
  },
  cameraBottom: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: 24,
    paddingTop: 24,
    paddingBottom: 46,
    backgroundColor: 'rgba(0,0,0,0.55)',
  },
  captureButton: {
    backgroundColor: '#16a34a',
    borderRadius: 30,
    minHeight: 58,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  captureButtonText: { color: '#fff', fontWeight: '800', fontSize: 16, marginLeft: 9 },
  buttonDisabled: { opacity: 0.5 },
  processingBox: { alignItems: 'center' },
  processingText: { color: '#fff', marginTop: 12, fontWeight: '600' },
});
