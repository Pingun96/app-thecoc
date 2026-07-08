import React, { useContext, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Platform,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Alert } from '../utils/alert';
import { Ionicons } from '@expo/vector-icons';
import * as Location from 'expo-location';
import { supabase } from '../services/supabaseClient';
import { AppContext } from '../context/AppContext';
import {
  checkoutAttendanceRecord,
  createAttendanceCorrection,
  createAttendanceRecord,
  reopenAttendanceRecord,
  uploadAttendancePhoto,
} from '../services/attendanceService';
import { createInAppNotification } from '../services/NotificationService';
import { normalizeAttendance } from '../services/dataMappers';
import {
  calculateWorkedHours,
  combineLocalDateTime,
  formatDate,
  formatDuration,
  getLocalDateKey,
  getLocalTime,
} from '../utils/dateTime';
import {
  findBestShiftForCheckIn,
  getAttendanceShiftType,
  getShiftLabel,
  getShiftStatusFromTimes,
  getShiftWindow,
  timeToMinutes,
} from '../utils/attendanceRules';

const RESUME_LIMIT_MINUTES = 15;
const CHECKOUT_REMINDER_WINDOW_MINUTES = 15;

const getDistance = (lat1, lon1, lat2, lon2) => {
  if (lat1 == null || lon1 == null || lat2 == null || lon2 == null) return null;
  const R = 6371e3;
  const p1 = lat1 * Math.PI/180;
  const p2 = lat2 * Math.PI/180;
  const dp = (lat2-lat1) * Math.PI/180;
  const dl = (lon2-lon1) * Math.PI/180;
  const a = Math.sin(dp/2) * Math.sin(dp/2) +
            Math.cos(p1) * Math.cos(p2) *
            Math.sin(dl/2) * Math.sin(dl/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  return R * c;
};

const getNetworkTime = async () => {
  try {
    const res = await fetch('http://worldtimeapi.org/api/timezone/Asia/Ho_Chi_Minh');
    const data = await res.json();
    return new Date(data.datetime);
  } catch (e) {
    return new Date(); // fallback
  }
};

const getRecordSortKey = (record) => (
  record?.check_out_at
  || record?.check_in_at
  || `${record?.date || ''} ${record?.checkOut || record?.check_out || record?.checkIn || record?.check_in || ''}`
  || String(record?.id || '')
);

const getRecordDateTime = (record, timeField, timestampField) => {
  if (record?.[timestampField]) {
    const parsed = new Date(record[timestampField]);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }
  return combineLocalDateTime(record?.date, record?.[timeField]);
};

export default function StaffCheckinScreen({ navigation }) {
  const {
    currentUser,
    staffList,
    attendanceHistory,
    setAttendanceHistory,
    setAttendanceCorrectionLogs,
    shiftRegistrations,
    storeList,
    refreshData,
    COLORS,
    isDarkMode,
  } = useContext(AppContext);
  const styles = useMemo(() => getStyles(COLORS, isDarkMode), [COLORS, isDarkMode]);
  const [actionType, setActionType] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [minuteTick, setMinuteTick] = useState(0);
  const reminderShownRef = useRef('');

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

  const latestRecord = useMemo(
    () => [...todayRecords].sort((a, b) => String(getRecordSortKey(b)).localeCompare(String(getRecordSortKey(a))))[0],
    [todayRecords],
  );

  const latestClosedRecord = useMemo(
    () => [...todayRecords]
      .filter((record) => record.checkOut || record.check_out)
      .sort((a, b) => String(getRecordSortKey(b)).localeCompare(String(getRecordSortKey(a))))[0],
    [todayRecords],
  );

  const latestClosedResumeInfo = useMemo(() => {
    if (!latestClosedRecord) return null;
    const closedAt = getRecordDateTime(latestClosedRecord, 'checkOut', 'check_out_at')
      || getRecordDateTime(latestClosedRecord, 'check_out', 'check_out_at');
    if (!closedAt || Number.isNaN(closedAt.getTime())) {
      return { canResume: false, minutesSince: null, remainingMinutes: 0 };
    }
    const minutesSince = Math.floor((Date.now() - closedAt.getTime()) / 60000);
    return {
      canResume: minutesSince >= 0 && minutesSince <= RESUME_LIMIT_MINUTES,
      minutesSince,
      remainingMinutes: Math.max(0, RESUME_LIMIT_MINUTES - minutesSince),
    };
  }, [latestClosedRecord]);

  const checkoutReminder = useMemo(() => {
    if (!currentRecord) return null;
    const shiftType = getAttendanceShiftType(currentRecord);
    const window = getShiftWindow(shiftType);
    if (!window?.end) return null;
    const nowMinutes = timeToMinutes(getLocalTime(new Date(Date.now() + minuteTick)));
    const endMinutes = timeToMinutes(window.end);
    if (nowMinutes == null || endMinutes == null) return null;
    const minutesToEnd = endMinutes - nowMinutes;
    if (minutesToEnd > CHECKOUT_REMINDER_WINDOW_MINUTES) return null;
    return {
      shiftLabel: getShiftLabel(shiftType),
      endTime: window.end,
      minutesToEnd,
      isOverdue: minutesToEnd < 0,
    };
  }, [currentRecord, minuteTick]);

  const todayApprovedShifts = useMemo(
    () => shiftRegistrations.filter(
      (record) => String(record.user_id) === String(currentUser?.id)
        && record.date === today
        && record.status === 'APPROVED',
    ),
    [shiftRegistrations, currentUser?.id, today],
  );

  const getStoreName = (storeId) => (
    storeList.find((store) => String(store.id) === String(storeId))?.name || `Chi nhánh ${storeId || '--'}`
  );

  useEffect(() => {
    const timer = setInterval(() => {
      setMinuteTick((value) => value + 1);
    }, 60000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!checkoutReminder || !currentRecord?.id) return;
    const reminderKey = `${currentRecord.id}_${checkoutReminder.isOverdue ? 'late' : 'soon'}`;
    if (reminderShownRef.current === reminderKey) return;
    reminderShownRef.current = reminderKey;

    Alert.alert(
      checkoutReminder.isOverdue ? 'Quên check-out?' : 'Sắp hết ca',
      checkoutReminder.isOverdue
        ? `Ca ${checkoutReminder.shiftLabel} đã qua giờ kết thúc ${checkoutReminder.endTime}. Nếu đã xong việc, hãy Check-out để chốt giờ công.`
        : `Còn khoảng ${checkoutReminder.minutesToEnd} phút đến giờ kết thúc ${checkoutReminder.shiftLabel}. Nhớ Check-out khi xong ca nhé.`,
    );
  }, [checkoutReminder, currentRecord?.id]);


  const withTimeout = (promise, timeoutMs, timeoutMessage) => Promise.race([
    promise,
    new Promise((_, reject) => {
      setTimeout(() => reject(new Error(timeoutMessage)), timeoutMs);
    }),
  ]);

  const getWebLocation = () => {
    return new Promise((resolve, reject) => {
      if (typeof navigator === 'undefined' || !navigator.geolocation) {
        reject(new Error('Trình duyệt không hỗ trợ định vị GPS.'));
        return;
      }
      navigator.geolocation.getCurrentPosition(
        (position) => {
          resolve({
            coords: {
              latitude: position.coords.latitude,
              longitude: position.coords.longitude,
              accuracy: position.coords.accuracy,
            }
          });
        },
        (error) => {
          let msg = 'Không thể lấy vị trí. ';
          if (error.code === error.PERMISSION_DENIED) {
            msg += 'Hãy cho phép truy cập GPS trong cài đặt trình duyệt/thiết bị.';
          } else if (error.code === error.POSITION_UNAVAILABLE) {
            msg += 'Không có tín hiệu GPS.';
          } else if (error.code === error.TIMEOUT) {
            msg += 'Quá thời gian lấy GPS.';
          }
          reject(new Error(msg));
        },
        { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
      );
    });
  };

  const requestLocationPermissionSafely = async () => {
    if (Platform.OS === 'web') {
      return { status: 'granted' };
    }
    try {
      return await withTimeout(
        Location.requestForegroundPermissionsAsync(),
        15000,
        'iPhone không phản hồi quyền vị trí. Hãy mở Cài đặt > Quyền riêng tư > Dịch vụ định vị và thử lại.'
      );
    } catch (error) {
      throw new Error(error?.message || 'Không thể xin quyền vị trí.');
    }
  };

  const getCurrentLocationSafely = async () => {
    if (Platform.OS === 'web') {
      return await getWebLocation();
    }
    try {
      return await withTimeout(
        Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }),
        12000,
        'Không lấy được GPS trong 12 giây.'
      );
    } catch (_error) {
      const lastLocation = await withTimeout(
        Location.getLastKnownPositionAsync(),
        5000,
        'Không có vị trí gần nhất.'
      ).catch(() => null);

      if (!lastLocation) {
        throw new Error('Không thể lấy vị trí. Hãy bật GPS/quyền vị trí cho The Cốc rồi thử lại.');
      }

      return lastLocation;
    }
  };

  const isOwner = currentUser?.role === 'OWNER';

  const handleUpdateStoreLocation = async () => {
    try {
      let { status } = await requestLocationPermissionSafely();
      if (status !== 'granted') {
        Alert.alert('Từ chối quyền', 'Cần quyền truy cập vị trí để cập nhật tọa độ.');
        return;
      }
      setIsSubmitting(true);
      let location;
      try {
        location = await getCurrentLocationSafely();
      } catch (_locErr) {
        location = await withTimeout(Location.getLastKnownPositionAsync(), 5000, 'Không có vị trí gần nhất.');
        if (!location) throw new Error('Không thể lấy được vị trí. Hãy bật GPS và thử lại ngoài trời.');
      }
      const { latitude, longitude } = location.coords;
      
      const { error } = await supabase.from('stores').update({
        latitude,
        longitude,
        allowed_radius: 100
      }).eq('id', currentUser.store_id);
      
      if (error) throw error;
      Alert.alert('Thành công', 'Đã lưu tọa độ quán thành công. Nhân viên giờ đây phải đứng cách tối đa 100m mới được chấm công.');
      if (refreshData) await refreshData();
    } catch(e) {
      Alert.alert('Lỗi', e.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const validateLocation = async (targetStoreId = currentUser.store_id) => {
    const myStore = storeList.find(s => String(s.id) === String(targetStoreId));
    if (!myStore?.latitude || !myStore?.longitude) {
      if (isOwner) {
         throw new Error('Chưa cấu hình Tọa độ. Vui lòng bấm Thiết lập tọa độ quán trước.');
      }
      throw new Error('Chủ cửa hàng chưa thiết lập Tọa độ Quán. Vui lòng báo quản lý.');
    }

    let { status } = await requestLocationPermissionSafely();
    if (status !== 'granted') {
      throw new Error('Bạn cần cấp quyền truy cập Vị trí (GPS) để chấm công.');
    }

    let location;
    try {
      location = await getCurrentLocationSafely();
    } catch (_locErr) {
      location = await withTimeout(Location.getLastKnownPositionAsync(), 5000, 'Không có vị trí gần nhất.');
      if (!location) throw new Error('Không thể lấy được vị trí của bạn lúc này. Vui lòng kiểm tra GPS.');
    }
    const dist = getDistance(location.coords.latitude, location.coords.longitude, myStore.latitude, myStore.longitude);
    
    if (dist === null) throw new Error('Không thể tính toán khoảng cách.');
    
    const allowed = myStore.allowed_radius || 100;
    if (dist > allowed) {
      throw new Error(`Bạn đang cách cửa hàng ${Math.round(dist)}m. Bán kính cho phép là ${allowed}m. Vui lòng đến đúng cửa hàng để chấm công!`);
    }

    return location.coords;
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
    if (type === 'check-out') {
      if (!currentRecord) {
        Alert.alert('Không có ca đang mở', 'Không tìm thấy lượt check-in cần kết thúc.');
        return;
      }

      const checkInTime = currentRecord.checkIn || currentRecord.check_in || '--:--';
      Alert.alert(
        'Xác nhận Check-out',
        `Bạn chắc chắn muốn kết thúc ca đang mở từ ${checkInTime}? Nếu bấm nhầm, chỉ có thể dùng “Tiếp tục” trong ${RESUME_LIMIT_MINUTES} phút.`,
        [
          { text: 'Hủy', style: 'cancel' },
          {
            text: 'Check-out',
            style: 'destructive',
            onPress: () => {
              setActionType(type);
              takePictureAndSubmit(type);
            },
          },
        ],
      );
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
              onPress: () => {
                setActionType(type);
                takePictureAndSubmit('check-in');
              }
            }
          ]
        );
        return; 
      }
    }

    setActionType(type);
    takePictureAndSubmit(type);
  };

  const handleResumeShift = () => {
    if (!currentUser?.id) {
      Alert.alert('Phiên đăng nhập không hợp lệ', 'Vui lòng đăng nhập lại.');
      return;
    }
    if (currentRecord) {
      Alert.alert('Đang trong ca', 'Ca làm hiện tại vẫn đang mở.');
      return;
    }
    if (!latestClosedRecord) {
      Alert.alert('Chưa có ca để tiếp tục', 'Không tìm thấy lượt check-out hôm nay để mở lại.');
      return;
    }
    if (!latestClosedResumeInfo?.canResume) {
      Alert.alert(
        'Đã quá thời gian tự mở lại',
        `Nút Tiếp tục chỉ dùng trong ${RESUME_LIMIT_MINUTES} phút sau khi bấm nhầm Check-out. Vui lòng báo quản lý xử lý trong Đối chiếu công.`,
      );
      return;
    }

    const checkoutTime = latestClosedRecord.checkOut || latestClosedRecord.check_out || '--:--';
    const checkinTime = latestClosedRecord.checkIn || latestClosedRecord.check_in || '--:--';

    Alert.alert(
      'Tiếp tục giờ làm?',
      `Dùng khi nhân viên bấm nhầm check-out. App sẽ xóa giờ check-out ${checkoutTime} và mở lại ca bắt đầu lúc ${checkinTime}.`,
      [
        { text: 'Hủy', style: 'cancel' },
        {
          text: 'Tiếp tục',
          onPress: async () => {
            setIsSubmitting(true);
            try {
              const savedFields = await reopenAttendanceRecord({ id: latestClosedRecord.id });
              const correctionLog = await createAttendanceCorrection({
                attendanceId: latestClosedRecord.id,
                userId: latestClosedRecord.user_id,
                storeId: latestClosedRecord.store_id,
                date: latestClosedRecord.date,
                action: 'REOPEN_AFTER_MISTAKEN_CHECKOUT',
                previousCheckOut: latestClosedRecord.checkOut || latestClosedRecord.check_out,
                previousCheckOutAt: latestClosedRecord.check_out_at,
                previousHours: latestClosedRecord.hours,
                requestedBy: currentUser.id,
                note: 'Nhân viên bấm Tiếp tục giờ làm sau khi check-out nhầm.',
              });
              setAttendanceHistory((current) => current.map((record) => (
                record.id === latestClosedRecord.id
                  ? normalizeAttendance({
                      ...record,
                      ...savedFields,
                      checkOut: null,
                      check_out: null,
                      check_out_at: null,
                      check_out_lat: null,
                      check_out_lng: null,
                      check_out_location: null,
                      check_out_photo_path: null,
                      hours: 0,
                      attendance_status: 'ON_SCHEDULE',
                    })
                  : record
              )));
              if (correctionLog && setAttendanceCorrectionLogs) {
                setAttendanceCorrectionLogs((current) => [correctionLog, ...(current || [])]);
              }
              const managerTargets = (staffList || [])
                .filter((staff) => (
                  staff.role === 'OWNER'
                  || (staff.role === 'MANAGER' && String(staff.store_id) === String(latestClosedRecord.store_id || currentUser.store_id))
                  || staff.permissions?.is_primary_manager
                ))
                .map((staff) => staff.id)
                .filter((id) => id && String(id) !== String(currentUser.id));

              managerTargets.slice(0, 8).forEach((userId) => {
                createInAppNotification({
                  userId,
                  title: 'Có chỉnh công cần duyệt',
                  body: `${currentUser.name || 'Nhân viên'} vừa mở lại ca sau khi check-out nhầm lúc ${checkoutTime}.`,
                  type: 'attendance_correction',
                  route: 'AttendanceReview',
                  storeId: latestClosedRecord.store_id || currentUser.store_id,
                  actorUserId: currentUser.id,
                  data: {
                    route: 'AttendanceReview',
                    attendance_id: latestClosedRecord.id,
                    correction_id: correctionLog?.id,
                  },
                });
              });
              Alert.alert('Đã tiếp tục ca', 'Ca làm đã được mở lại. Khi kết thúc thật, bấm Check-out lại một lần nữa.');
              if (refreshData) refreshData();
            } catch (error) {
              Alert.alert('Không thể tiếp tục ca', error?.message || 'Vui lòng thử lại.');
            } finally {
              setIsSubmitting(false);
            }
          },
        },
      ],
    );
  };

  const takePictureAndSubmit = async (currentAction) => {
    if (isSubmitting) return;
    setIsSubmitting(true);

    try {
      // 1. Location Validation
      let coords = { latitude: 0, longitude: 0 };
      if (!isOwner) { 
        // Owner can checkin anywhere, or maybe Owner doesn't need to check in.
        // Let's strictly enforce it for everyone to be safe, but give Owner a bypass if they want.
        // Actually, enforce for everyone!
      }
      const now = await getNetworkTime();
      const time = getLocalTime(now);
      const timestamp = now.toISOString();
      const act = currentAction || actionType;

      let scheduledShift = null;
      let scheduledShiftType = null;
      let targetStoreId = currentUser.store_id;
      let attendanceStatus = 'ON_SCHEDULE';

      if (act === 'check-in') {
        const plan = findBestShiftForCheckIn({
          shiftRegistrations,
          userId: currentUser.id,
          date: today,
          currentTime: time,
        });
        scheduledShift = plan.shift;
        scheduledShiftType = plan.shift?.shift_type || plan.preferredShiftType;

        if (!scheduledShift) {
          attendanceStatus = plan.approvedToday.length > 0 ? 'WRONG_SHIFT' : 'OUTSIDE_SCHEDULE';
          targetStoreId = currentUser.store_id;
        } else {
          targetStoreId = scheduledShift.store_id;
        }
      } else if (currentRecord) {
        scheduledShiftType = getAttendanceShiftType(currentRecord);
        targetStoreId = currentRecord.store_id || currentUser.store_id;
      }

      coords = await validateLocation(targetStoreId);

      if (act === 'check-in') {
        const recordId = `att_${Date.now()}`;
        const savedRecord = await createAttendanceRecord({
          id: recordId,
          userId: currentUser.id,
          storeId: targetStoreId,
          date: today,
          time,
          timestamp,
          latitude: coords.latitude,
          longitude: coords.longitude,
          photoPath: '',
        });

        const normalizedRecord = normalizeAttendance({
          ...savedRecord,
          check_in_at: timestamp,
          check_in_lat: coords.latitude,
          check_in_lng: coords.longitude,
          check_in_photo_path: '',
          store_id: targetStoreId,
          scheduled_shift_type: scheduledShiftType,
          attendance_status: attendanceStatus,
        });
        setAttendanceHistory((current) => [...current, normalizedRecord]);

        Alert.alert(
          'Check-in thành công',
          `${time} • ${scheduledShift ? `${getShiftLabel(scheduledShiftType)} tại ${getStoreName(targetStoreId)}` : 'Chấm công ngoài lịch, quản lý cần đối chiếu.'}`,
        );
      } else {
        const workedHours = calculateWorkedHours({
          date: currentRecord.date,
          checkIn: currentRecord.checkIn || currentRecord.check_in,
          checkOut: time,
          checkInAt: currentRecord.check_in_at,
          checkOutAt: timestamp,
        });
        const checkoutStatus = getShiftStatusFromTimes({
          shiftType: scheduledShiftType,
          checkIn: currentRecord.checkIn || currentRecord.check_in,
          checkOut: time,
        });

        const savedFields = await checkoutAttendanceRecord({
          id: currentRecord.id,
          time,
          timestamp,
          hours: workedHours,
          latitude: coords.latitude,
          longitude: coords.longitude,
          photoPath: '',
        });

        setAttendanceHistory((current) => current.map((record) => (
          record.id === currentRecord.id
            ? normalizeAttendance({
                ...record,
                ...savedFields,
                check_out_at: timestamp,
                check_out_lat: coords.latitude,
                check_out_lng: coords.longitude,
                check_out_photo_path: '',
                scheduled_shift_type: scheduledShiftType,
                attendance_status: checkoutStatus.isEarlyLeave ? 'EARLY_LEAVE' : (checkoutStatus.overtimeMinutes > 5 ? 'OVERTIME' : 'ON_SCHEDULE'),
              })
            : record
        )));

        Alert.alert(
          'Check-out thành công',
          `${time} • Tổng thời gian: ${formatDuration(workedHours)}${checkoutStatus.isEarlyLeave ? ` • Về sớm ${checkoutStatus.earlyLeaveMinutes} phút` : checkoutStatus.overtimeMinutes > 5 ? ` • Tăng ca ${checkoutStatus.overtimeMinutes} phút` : ''}`,
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

        {checkoutReminder ? (
          <View style={[styles.reminderCard, checkoutReminder.isOverdue && styles.reminderCardDanger]}>
            <Ionicons
              name={checkoutReminder.isOverdue ? 'warning-outline' : 'alarm-outline'}
              size={21}
              color={checkoutReminder.isOverdue ? '#dc2626' : COLORS.primary}
            />
            <Text style={styles.reminderText}>
              {checkoutReminder.isOverdue
                ? `Ca ${checkoutReminder.shiftLabel} đã quá giờ ${checkoutReminder.endTime}. Nhớ Check-out để chốt giờ công.`
                : `Còn ${checkoutReminder.minutesToEnd} phút đến giờ kết thúc ${checkoutReminder.shiftLabel}.`}
            </Text>
          </View>
        ) : null}

        <View style={styles.scheduleCard}>
          <Text style={styles.scheduleTitle}>Lịch đã duyệt hôm nay</Text>
          {todayApprovedShifts.length > 0 ? (
            todayApprovedShifts.map((shift) => {
              const window = getShiftWindow(shift.shift_type);
              return (
                <View key={shift.id} style={styles.scheduleRow}>
                  <View>
                    <Text style={styles.scheduleShift}>{getShiftLabel(shift.shift_type)}</Text>
                    <Text style={styles.scheduleTime}>{window?.start} - {window?.end}</Text>
                  </View>
                  <Text style={styles.scheduleStore}>{getStoreName(shift.store_id)}</Text>
                </View>
              );
            })
          ) : (
            <Text style={styles.scheduleEmpty}>Hôm nay chưa có ca đã duyệt. Nếu vẫn đi làm, lượt chấm công sẽ được đưa vào mục đối chiếu.</Text>
          )}
        </View>

        {!currentRecord ? (
          <>
            {latestClosedRecord ? (
              <View style={styles.resumeCard}>
                <View style={styles.resumeTextBlock}>
                  <Text style={styles.resumeTitle}>Bấm nhầm Check-out?</Text>
                  <Text style={styles.resumeText}>
                    {latestClosedResumeInfo?.canResume
                      ? `Mở lại ca đã check-out lúc ${latestClosedRecord.checkOut || latestClosedRecord.check_out || '--:--'} để tiếp tục. Còn ${latestClosedResumeInfo.remainingMinutes} phút.`
                      : `Đã quá ${RESUME_LIMIT_MINUTES} phút. Báo quản lý duyệt chỉnh trong Đối chiếu công.`}
                  </Text>
                </View>
                <TouchableOpacity
                  style={[styles.resumeButton, isSubmitting && styles.buttonDisabled]}
                  onPress={handleResumeShift}
                  disabled={isSubmitting || !latestClosedResumeInfo?.canResume}
                >
                  <Ionicons name="play-circle-outline" size={18} color={COLORS.primary} />
                  <Text style={styles.resumeButtonText}>{latestClosedResumeInfo?.canResume ? 'Tiếp tục' : 'Quá hạn'}</Text>
                </TouchableOpacity>
              </View>
            ) : null}
            <TouchableOpacity
              style={[styles.primaryButton, styles.checkInButton]}
              onPress={() => handleAttendancePress('check-in')}
              disabled={isSubmitting}
            >
              <Ionicons name="log-in-outline" size={23} color="#fff" />
              <Text style={styles.primaryButtonText}>Check-in vào ca</Text>
            </TouchableOpacity>
          </>
        ) : (
          <TouchableOpacity
            style={[styles.primaryButton, styles.checkOutButton, isSubmitting && styles.buttonDisabled]}
            onPress={() => handleAttendancePress('check-out')}
            disabled={isSubmitting}
          >
            <Ionicons name="log-out-outline" size={23} color="#fff" />
            <Text style={styles.primaryButtonText}>Check-out kết thúc ca</Text>
          </TouchableOpacity>
        )}

        <Text style={styles.note}>
          Mỗi nhân viên chỉ có một ca đang mở tại một thời điểm.
        </Text>

        {isOwner && (
          <TouchableOpacity
            style={{backgroundColor: COLORS.inputBg, borderWidth: 1, borderColor: COLORS.border, padding: 15, borderRadius: 12, marginTop: 20, flexDirection: 'row', justifyContent: 'center', alignItems: 'center'}}
            onPress={handleUpdateStoreLocation}
          >
            <Ionicons name="location-outline" size={20} color={COLORS.textMuted} style={{marginRight: 8}}/>
            <Text style={{color: '#475569', fontWeight: 'bold'}}>Thiết lập tọa độ hiện tại cho Quán</Text>
          </TouchableOpacity>
        )}
      </ScrollView>

    </SafeAreaView>
  );
}

const getStyles = (COLORS, isDarkMode) => StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.bg },
  scrollContent: { paddingHorizontal: 20, paddingTop: 12, paddingBottom: 40 },
  headerRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 22, backgroundColor: COLORS.bg, ...(Platform.OS === 'web' ? { position: 'sticky', top: 0, zIndex: 40, paddingTop: 8, paddingBottom: 8 } : null) },
  backBtn: { padding: 8, marginRight: 8, marginLeft: -8 },
  header: { fontSize: 26, fontWeight: '800', color: COLORS.text },
  headerCaption: { color: COLORS.textMuted, marginTop: 2 },
  statusCard: {
    backgroundColor: COLORS.card,
    borderRadius: 18,
    padding: 20,
    borderWidth: 1,
    borderColor: COLORS.border,
    shadowColor: '#000',
    shadowOpacity: isDarkMode ? 0.22 : 0.08,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 5 },
    elevation: 3,
  },
  statusHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  statusDate: { color: COLORS.textMuted, fontWeight: '600', marginBottom: 5 },
  statusTitle: { color: COLORS.text, fontWeight: '800', fontSize: 18 },
  statusBadge: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 20 },
  badgeActive: { backgroundColor: '#dcfce7' },
  badgeIdle: { backgroundColor: COLORS.inputBg },
  statusBadgeText: { fontSize: 11, fontWeight: '800' },
  badgeActiveText: { color: '#15803d' },
  badgeIdleText: { color: COLORS.textMuted },
  timeline: {
    marginTop: 22,
    paddingTop: 18,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  timelineItem: { flex: 1 },
  timelineLabel: { color: COLORS.textMuted, fontSize: 12, marginBottom: 4 },
  timelineValue: { color: COLORS.text, fontWeight: '800', fontSize: 24 },
  infoCard: {
    flexDirection: 'row',
    backgroundColor: isDarkMode ? '#0f2a44' : '#e8f1ff',
    borderRadius: 14,
    padding: 15,
    marginTop: 18,
    alignItems: 'flex-start',
  },
  infoText: { flex: 1, color: COLORS.text, lineHeight: 20, marginLeft: 10 },
  reminderCard: { flexDirection: 'row', alignItems: 'center', gap: 9, backgroundColor: isDarkMode ? '#0f2a44' : '#eff6ff', borderWidth: 1, borderColor: isDarkMode ? '#1d4ed8' : '#bfdbfe', borderRadius: 13, padding: 11, marginTop: 12 },
  reminderCardDanger: { backgroundColor: isDarkMode ? '#3b1111' : '#fee2e2', borderColor: isDarkMode ? '#7f1d1d' : '#fecaca' },
  reminderText: { flex: 1, color: COLORS.text, fontSize: 12, lineHeight: 17, fontWeight: '800' },
  scheduleCard: { backgroundColor: COLORS.card, borderRadius: 16, padding: 16, marginTop: 16, borderWidth: 1, borderColor: COLORS.border },
  scheduleTitle: { color: COLORS.text, fontSize: 16, fontWeight: '900', marginBottom: 10 },
  scheduleRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 10, borderTopWidth: 1, borderTopColor: COLORS.border },
  scheduleShift: { color: COLORS.text, fontWeight: '800' },
  scheduleTime: { color: COLORS.textMuted, fontSize: 12, marginTop: 2 },
  scheduleStore: { color: COLORS.primary, fontWeight: '900', maxWidth: '50%', textAlign: 'right' },
  scheduleEmpty: { color: COLORS.textMuted, lineHeight: 20 },
  primaryButton: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: 14,
    paddingVertical: 17,
    marginTop: 22,
    shadowColor: '#000',
    shadowOpacity: isDarkMode ? 0.25 : 0.12,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 3,
  },
  checkInButton: { backgroundColor: '#16a34a' },
  checkOutButton: { backgroundColor: '#dc2626' },
  primaryButtonText: { color: '#fff', fontSize: 17, fontWeight: '800', marginLeft: 9 },
  resumeCard: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: isDarkMode ? '#052e16' : '#ecfdf5', borderWidth: 1, borderColor: isDarkMode ? '#166534' : '#bbf7d0', borderRadius: 14, padding: 12, marginTop: 18 },
  resumeTextBlock: { flex: 1, minWidth: 0 },
  resumeTitle: { color: COLORS.text, fontWeight: '900', marginBottom: 3 },
  resumeText: { color: COLORS.textMuted, fontSize: 12, lineHeight: 17 },
  resumeButton: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: COLORS.card, borderWidth: 1, borderColor: isDarkMode ? '#166534' : '#86efac', borderRadius: 999, paddingHorizontal: 11, paddingVertical: 8 },
  resumeButtonText: { color: COLORS.primary, fontWeight: '900', fontSize: 12 },
  note: { color: COLORS.textMuted, textAlign: 'center', marginTop: 14, fontSize: 12 },
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
