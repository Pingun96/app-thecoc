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
    storeList.find((store) => String(store.id) === String(storeId))?.name || `Chi nhÃ¡nh ${storeId || '--'}`
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
      checkoutReminder.isOverdue ? 'QuÃªn check-out?' : 'Sáº¯p háº¿t ca',
      checkoutReminder.isOverdue
        ? `Ca ${checkoutReminder.shiftLabel} Ä‘Ã£ qua giá» káº¿t thÃºc ${checkoutReminder.endTime}. Náº¿u Ä‘Ã£ xong viá»‡c, hÃ£y Check-out Ä‘á»ƒ chá»‘t giá» cÃ´ng.`
        : `CÃ²n khoáº£ng ${checkoutReminder.minutesToEnd} phÃºt Ä‘áº¿n giá» káº¿t thÃºc ${checkoutReminder.shiftLabel}. Nhá»› Check-out khi xong ca nhÃ©.`,
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
        reject(new Error('TrÃ¬nh duyá»‡t khÃ´ng há»— trá»£ Ä‘á»‹nh vá»‹ GPS.'));
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
          let msg = 'KhÃ´ng thá»ƒ láº¥y vá»‹ trÃ­. ';
          if (error.code === error.PERMISSION_DENIED) {
            msg += 'HÃ£y cho phÃ©p truy cáº­p GPS trong cÃ i Ä‘áº·t trÃ¬nh duyá»‡t/thiáº¿t bá»‹.';
          } else if (error.code === error.POSITION_UNAVAILABLE) {
            msg += 'KhÃ´ng cÃ³ tÃ­n hiá»‡u GPS.';
          } else if (error.code === error.TIMEOUT) {
            msg += 'QuÃ¡ thá»i gian láº¥y GPS.';
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
        'iPhone khÃ´ng pháº£n há»“i quyá»n vá»‹ trÃ­. HÃ£y má»Ÿ CÃ i Ä‘áº·t > Quyá»n riÃªng tÆ° > Dá»‹ch vá»¥ Ä‘á»‹nh vá»‹ vÃ  thá»­ láº¡i.'
      );
    } catch (error) {
      throw new Error(error?.message || 'KhÃ´ng thá»ƒ xin quyá»n vá»‹ trÃ­.');
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
        'KhÃ´ng láº¥y Ä‘Æ°á»£c GPS trong 12 giÃ¢y.'
      );
    } catch (_error) {
      const lastLocation = await withTimeout(
        Location.getLastKnownPositionAsync(),
        5000,
        'KhÃ´ng cÃ³ vá»‹ trÃ­ gáº§n nháº¥t.'
      ).catch(() => null);

      if (!lastLocation) {
        throw new Error('KhÃ´ng thá»ƒ láº¥y vá»‹ trÃ­. HÃ£y báº­t GPS/quyá»n vá»‹ trÃ­ cho The Cá»‘c rá»“i thá»­ láº¡i.');
      }

      return lastLocation;
    }
  };

  const isOwner = currentUser?.role === 'OWNER';

  const handleUpdateStoreLocation = async () => {
    try {
      let { status } = await requestLocationPermissionSafely();
      if (status !== 'granted') {
        Alert.alert('Tá»« chá»‘i quyá»n', 'Cáº§n quyá»n truy cáº­p vá»‹ trÃ­ Ä‘á»ƒ cáº­p nháº­t tá»a Ä‘á»™.');
        return;
      }
      setIsSubmitting(true);
      let location;
      try {
        location = await getCurrentLocationSafely();
      } catch (_locErr) {
        location = await withTimeout(Location.getLastKnownPositionAsync(), 5000, 'KhÃ´ng cÃ³ vá»‹ trÃ­ gáº§n nháº¥t.');
        if (!location) throw new Error('KhÃ´ng thá»ƒ láº¥y Ä‘Æ°á»£c vá»‹ trÃ­. HÃ£y báº­t GPS vÃ  thá»­ láº¡i ngoÃ i trá»i.');
      }
      const { latitude, longitude } = location.coords;
      
      const { error } = await supabase.from('stores').update({
        latitude,
        longitude,
        allowed_radius: 100
      }).eq('id', currentUser.store_id);
      
      if (error) throw error;
      Alert.alert('ThÃ nh cÃ´ng', 'ÄÃ£ lÆ°u tá»a Ä‘á»™ quÃ¡n thÃ nh cÃ´ng. NhÃ¢n viÃªn giá» Ä‘Ã¢y pháº£i Ä‘á»©ng cÃ¡ch tá»‘i Ä‘a 100m má»›i Ä‘Æ°á»£c cháº¥m cÃ´ng.');
      if (refreshData) await refreshData();
    } catch(e) {
      Alert.alert('Lá»—i', e.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const validateLocation = async (targetStoreId = currentUser.store_id) => {
    const myStore = storeList.find(s => String(s.id) === String(targetStoreId));
    if (!myStore?.latitude || !myStore?.longitude) {
      if (isOwner) {
         throw new Error('ChÆ°a cáº¥u hÃ¬nh Tá»a Ä‘á»™. Vui lÃ²ng báº¥m Thiáº¿t láº­p tá»a Ä‘á»™ quÃ¡n trÆ°á»›c.');
      }
      throw new Error('Chá»§ cá»­a hÃ ng chÆ°a thiáº¿t láº­p Tá»a Ä‘á»™ QuÃ¡n. Vui lÃ²ng bÃ¡o quáº£n lÃ½.');
    }

    let { status } = await requestLocationPermissionSafely();
    if (status !== 'granted') {
      throw new Error('Báº¡n cáº§n cáº¥p quyá»n truy cáº­p Vá»‹ trÃ­ (GPS) Ä‘á»ƒ cháº¥m cÃ´ng.');
    }

    let location;
    try {
      location = await getCurrentLocationSafely();
    } catch (_locErr) {
      location = await withTimeout(Location.getLastKnownPositionAsync(), 5000, 'KhÃ´ng cÃ³ vá»‹ trÃ­ gáº§n nháº¥t.');
      if (!location) throw new Error('KhÃ´ng thá»ƒ láº¥y Ä‘Æ°á»£c vá»‹ trÃ­ cá»§a báº¡n lÃºc nÃ y. Vui lÃ²ng kiá»ƒm tra GPS.');
    }
    const dist = getDistance(location.coords.latitude, location.coords.longitude, myStore.latitude, myStore.longitude);
    
    if (dist === null) throw new Error('KhÃ´ng thá»ƒ tÃ­nh toÃ¡n khoáº£ng cÃ¡ch.');
    
    const allowed = myStore.allowed_radius || 100;
    if (dist > allowed) {
      throw new Error(`Báº¡n Ä‘ang cÃ¡ch cá»­a hÃ ng ${Math.round(dist)}m. BÃ¡n kÃ­nh cho phÃ©p lÃ  ${allowed}m. Vui lÃ²ng Ä‘áº¿n Ä‘Ãºng cá»­a hÃ ng Ä‘á»ƒ cháº¥m cÃ´ng!`);
    }

    return location.coords;
  };

  const handleAttendancePress = async (type) => {
    if (!currentUser?.id) {
      Alert.alert('PhiÃªn Ä‘Äƒng nháº­p khÃ´ng há»£p lá»‡', 'Vui lÃ²ng Ä‘Äƒng nháº­p láº¡i.');
      return;
    }
    if (type === 'check-in' && currentRecord) {
      Alert.alert('ÄÃ£ vÃ o ca', 'Báº¡n cáº§n káº¿t thÃºc ca hiá»‡n táº¡i trÆ°á»›c khi cháº¥m cÃ´ng má»›i.');
      return;
    }
    if (type === 'check-out') {
      if (!currentRecord) {
        Alert.alert('KhÃ´ng cÃ³ ca Ä‘ang má»Ÿ', 'KhÃ´ng tÃ¬m tháº¥y lÆ°á»£t check-in cáº§n káº¿t thÃºc.');
        return;
      }

      const checkInTime = currentRecord.checkIn || currentRecord.check_in || '--:--';
      Alert.alert(
        'XÃ¡c nháº­n Check-out',
        `Báº¡n cháº¯c cháº¯n muá»‘n káº¿t thÃºc ca Ä‘ang má»Ÿ tá»« ${checkInTime}? Náº¿u báº¥m nháº§m, chá»‰ cÃ³ thá»ƒ dÃ¹ng â€œTiáº¿p tá»¥câ€ trong ${RESUME_LIMIT_MINUTES} phÃºt.`,
        [
          { text: 'Há»§y', style: 'cancel' },
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
          'KhÃ´ng cÃ³ lá»‹ch lÃ m viá»‡c',
          'Quáº£n lÃ½ chÆ°a duyá»‡t ca nÃ o cho báº¡n trong ngÃ y hÃ´m nay.\n\nBáº¡n cÃ³ cháº¯c cháº¯n muá»‘n Check-in lÃ m ngoÃ i ca khÃ´ng?',
          [
            { text: 'Há»§y', style: 'cancel' },
            { 
              text: 'Váº«n Check-in', 
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
      Alert.alert('PhiÃªn Ä‘Äƒng nháº­p khÃ´ng há»£p lá»‡', 'Vui lÃ²ng Ä‘Äƒng nháº­p láº¡i.');
      return;
    }
    if (currentRecord) {
      Alert.alert('Äang trong ca', 'Ca lÃ m hiá»‡n táº¡i váº«n Ä‘ang má»Ÿ.');
      return;
    }
    if (!latestClosedRecord) {
      Alert.alert('ChÆ°a cÃ³ ca Ä‘á»ƒ tiáº¿p tá»¥c', 'KhÃ´ng tÃ¬m tháº¥y lÆ°á»£t check-out hÃ´m nay Ä‘á»ƒ má»Ÿ láº¡i.');
      return;
    }
    if (!latestClosedResumeInfo?.canResume) {
      Alert.alert(
        'ÄÃ£ quÃ¡ thá»i gian tá»± má»Ÿ láº¡i',
        `NÃºt Tiáº¿p tá»¥c chá»‰ dÃ¹ng trong ${RESUME_LIMIT_MINUTES} phÃºt sau khi báº¥m nháº§m Check-out. Vui lÃ²ng bÃ¡o quáº£n lÃ½ xá»­ lÃ½ trong Äá»‘i chiáº¿u cÃ´ng.`,
      );
      return;
    }

    const checkoutTime = latestClosedRecord.checkOut || latestClosedRecord.check_out || '--:--';
    const checkinTime = latestClosedRecord.checkIn || latestClosedRecord.check_in || '--:--';

    Alert.alert(
      'Tiáº¿p tá»¥c giá» lÃ m?',
      `DÃ¹ng khi nhÃ¢n viÃªn báº¥m nháº§m check-out. App sáº½ xÃ³a giá» check-out ${checkoutTime} vÃ  má»Ÿ láº¡i ca báº¯t Ä‘áº§u lÃºc ${checkinTime}.`,
      [
        { text: 'Há»§y', style: 'cancel' },
        {
          text: 'Tiáº¿p tá»¥c',
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
                note: 'NhÃ¢n viÃªn báº¥m Tiáº¿p tá»¥c giá» lÃ m sau khi check-out nháº§m.',
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
                  title: 'CÃ³ chá»‰nh cÃ´ng cáº§n duyá»‡t',
                  body: `${currentUser.name || 'NhÃ¢n viÃªn'} vá»«a má»Ÿ láº¡i ca sau khi check-out nháº§m lÃºc ${checkoutTime}.`,
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
              Alert.alert('ÄÃ£ tiáº¿p tá»¥c ca', 'Ca lÃ m Ä‘Ã£ Ä‘Æ°á»£c má»Ÿ láº¡i. Khi káº¿t thÃºc tháº­t, báº¥m Check-out láº¡i má»™t láº§n ná»¯a.');
              if (refreshData) refreshData();
            } catch (error) {
              Alert.alert('KhÃ´ng thá»ƒ tiáº¿p tá»¥c ca', error?.message || 'Vui lÃ²ng thá»­ láº¡i.');
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
          'Check-in thÃ nh cÃ´ng',
          `${time} â€¢ ${scheduledShift ? `${getShiftLabel(scheduledShiftType)} táº¡i ${getStoreName(targetStoreId)}` : 'Cháº¥m cÃ´ng ngoÃ i lá»‹ch, quáº£n lÃ½ cáº§n Ä‘á»‘i chiáº¿u.'}`,
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
          'Check-out thÃ nh cÃ´ng',
          `${time} â€¢ Tá»•ng thá»i gian: ${formatDuration(workedHours)}${checkoutStatus.isEarlyLeave ? ` â€¢ Vá» sá»›m ${checkoutStatus.earlyLeaveMinutes} phÃºt` : checkoutStatus.overtimeMinutes > 5 ? ` â€¢ TÄƒng ca ${checkoutStatus.overtimeMinutes} phÃºt` : ''}`,
        );
      }
    } catch (error) {
      console.error('Lá»—i cháº¥m cÃ´ng:', error);
      Alert.alert(
        'KhÃ´ng thá»ƒ cháº¥m cÃ´ng',
        error?.message || 'ÄÃ£ cÃ³ lá»—i khi lÆ°u dá»¯ liá»‡u.',
      );
    } finally {
      setIsSubmitting(false);
    }
  };
  return (
    <SafeAreaView style={styles.container}>
      <ScrollView style={styles.flexScroll} contentContainerStyle={styles.scrollContent}>
        <View style={styles.headerRow}>
          <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
            <Ionicons name="arrow-back" size={24} color="#1565c0" />
          </TouchableOpacity>
          <View>
            <Text style={styles.header}>Cháº¥m cÃ´ng</Text>
            <Text style={styles.headerCaption}>XÃ¡c thá»±c thá»i gian lÃ m viá»‡c</Text>
          </View>
        </View>

        <View style={styles.statusCard}>
          <View style={styles.statusHeader}>
            <View>
              <Text style={styles.statusDate}>{formatDate(today)}</Text>
              <Text style={styles.statusTitle}>
                {currentRecord ? 'Báº¡n Ä‘ang trong ca lÃ m' : 'ChÆ°a cÃ³ ca Ä‘ang má»Ÿ'}
              </Text>
            </View>
            <View style={[styles.statusBadge, currentRecord ? styles.badgeActive : styles.badgeIdle]}>
              <Text style={[styles.statusBadgeText, currentRecord ? styles.badgeActiveText : styles.badgeIdleText]}>
                {currentRecord ? 'ÄANG LÃ€M' : 'CHá»œ VÃ€O CA'}
              </Text>
            </View>
          </View>

          <View style={styles.timeline}>
            <View style={styles.timelineItem}>
              <Text style={styles.timelineLabel}>VÃ o ca</Text>
              <Text style={styles.timelineValue}>
                {currentRecord?.checkIn || currentRecord?.check_in || latestRecord?.checkIn || latestRecord?.check_in || '--:--'}
              </Text>
            </View>
            <Ionicons name="arrow-forward" size={20} color="#94a3b8" />
            <View style={styles.timelineItem}>
              <Text style={styles.timelineLabel}>Káº¿t thÃºc</Text>
              <Text style={styles.timelineValue}>
                {latestRecord?.checkOut || latestRecord?.check_out || '--:--'}
              </Text>
            </View>
          </View>
        </View>

        <View style={styles.infoCard}>
          <Ionicons name="shield-checkmark-outline" size={24} color="#1565c0" />
          <Text style={styles.infoText}>
            Thá»i gian báº¯t Ä‘áº§u vÃ  káº¿t thÃºc ca lÃ m viá»‡c sáº½ Ä‘Æ°á»£c ghi nháº­n.
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
                ? `Ca ${checkoutReminder.shiftLabel} Ä‘Ã£ quÃ¡ giá» ${checkoutReminder.endTime}. Nhá»› Check-out Ä‘á»ƒ chá»‘t giá» cÃ´ng.`
                : `CÃ²n ${checkoutReminder.minutesToEnd} phÃºt Ä‘áº¿n giá» káº¿t thÃºc ${checkoutReminder.shiftLabel}.`}
            </Text>
          </View>
        ) : null}

        <View style={styles.scheduleCard}>
          <Text style={styles.scheduleTitle}>Lá»‹ch Ä‘Ã£ duyá»‡t hÃ´m nay</Text>
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
            <Text style={styles.scheduleEmpty}>HÃ´m nay chÆ°a cÃ³ ca Ä‘Ã£ duyá»‡t. Náº¿u váº«n Ä‘i lÃ m, lÆ°á»£t cháº¥m cÃ´ng sáº½ Ä‘Æ°á»£c Ä‘Æ°a vÃ o má»¥c Ä‘á»‘i chiáº¿u.</Text>
          )}
        </View>

        {!currentRecord ? (
          <>
            {latestClosedRecord ? (
              <View style={styles.resumeCard}>
                <View style={styles.resumeTextBlock}>
                  <Text style={styles.resumeTitle}>Báº¥m nháº§m Check-out?</Text>
                  <Text style={styles.resumeText}>
                    {latestClosedResumeInfo?.canResume
                      ? `Má»Ÿ láº¡i ca Ä‘Ã£ check-out lÃºc ${latestClosedRecord.checkOut || latestClosedRecord.check_out || '--:--'} Ä‘á»ƒ tiáº¿p tá»¥c. CÃ²n ${latestClosedResumeInfo.remainingMinutes} phÃºt.`
                      : `ÄÃ£ quÃ¡ ${RESUME_LIMIT_MINUTES} phÃºt. BÃ¡o quáº£n lÃ½ duyá»‡t chá»‰nh trong Äá»‘i chiáº¿u cÃ´ng.`}
                  </Text>
                </View>
                <TouchableOpacity
                  style={[styles.resumeButton, isSubmitting && styles.buttonDisabled]}
                  onPress={handleResumeShift}
                  disabled={isSubmitting || !latestClosedResumeInfo?.canResume}
                >
                  <Ionicons name="play-circle-outline" size={18} color={COLORS.primary} />
                  <Text style={styles.resumeButtonText}>{latestClosedResumeInfo?.canResume ? 'Tiáº¿p tá»¥c' : 'QuÃ¡ háº¡n'}</Text>
                </TouchableOpacity>
              </View>
            ) : null}
            <TouchableOpacity
              style={[styles.primaryButton, styles.checkInButton]}
              onPress={() => handleAttendancePress('check-in')}
              disabled={isSubmitting}
            >
              <Ionicons name="log-in-outline" size={23} color="#fff" />
              <Text style={styles.primaryButtonText}>Check-in vÃ o ca</Text>
            </TouchableOpacity>
          </>
        ) : (
          <TouchableOpacity
            style={[styles.primaryButton, styles.checkOutButton, isSubmitting && styles.buttonDisabled]}
            onPress={() => handleAttendancePress('check-out')}
            disabled={isSubmitting}
          >
            <Ionicons name="log-out-outline" size={23} color="#fff" />
            <Text style={styles.primaryButtonText}>Check-out káº¿t thÃºc ca</Text>
          </TouchableOpacity>
        )}

        <Text style={styles.note}>
          Má»—i nhÃ¢n viÃªn chá»‰ cÃ³ má»™t ca Ä‘ang má»Ÿ táº¡i má»™t thá»i Ä‘iá»ƒm.
        </Text>

        {isOwner && (
          <TouchableOpacity
            style={{backgroundColor: COLORS.inputBg, borderWidth: 1, borderColor: COLORS.border, padding: 15, borderRadius: 12, marginTop: 20, flexDirection: 'row', justifyContent: 'center', alignItems: 'center'}}
            onPress={handleUpdateStoreLocation}
          >
            <Ionicons name="location-outline" size={20} color={COLORS.textMuted} style={{marginRight: 8}}/>
            <Text style={{color: '#475569', fontWeight: 'bold'}}>Thiáº¿t láº­p tá»a Ä‘á»™ hiá»‡n táº¡i cho QuÃ¡n</Text>
          </TouchableOpacity>
        )}
      </ScrollView>

    </SafeAreaView>
  );
}

const getStyles = (COLORS, isDarkMode) => StyleSheet.create({
  container: { flex: 1, minHeight: 0, overflow: Platform.OS === 'web' ? 'visible' : 'hidden', backgroundColor: COLORS.bg },
  flexScroll: { flex: 1, minHeight: 0 },
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
