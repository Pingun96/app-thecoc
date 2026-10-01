import React, { useContext, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, Image, Dimensions, ActivityIndicator, Modal, TextInput, Platform } from 'react-native';
import { Alert } from '../utils/alert';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { AppContext } from '../context/AppContext';
import * as Updates from 'expo-updates';
import { getLocalDateKey, isDateInCurrentMonth } from '../utils/dateTime';
import { supabase, updateMyProfile } from '../services/supabaseClient';
import { getBusinessStores } from '../utils/warehouse';
import { canAccessStore, getAllowedStoreIds, hasPermission as userHasPermission } from '../utils/permissions';

const { width } = Dimensions.get('window');
const APP_GRID_COLUMNS = 4;
const APP_GRID_MAX_WIDTH = 520;
const APP_GRID_GAP = 10;

export default function DashboardScreen({ navigation }) {
  const {
    currentUser,
    setCurrentUser,
    logout,
    staffList,
    attendanceHistory,
    shiftRegistrations = [],
    storeList,
    selectedStoreId,
    setSelectedStoreId,
    dataError,
    refreshData,
    isDataLoading,
    COLORS,
    isDarkMode,
    themeMode,
    toggleThemeMode,
  } = useContext(AppContext);
  const [isCheckingUpdate, setIsCheckingUpdate] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const isIosStandalone = Platform.OS === 'web'
    && typeof window !== 'undefined'
    && /iPad|iPhone|iPod/.test(window.navigator.userAgent)
    && (window.navigator.standalone === true || window.matchMedia?.('(display-mode: standalone)').matches);
  const hasDynamicIsland = isIosStandalone && (window.screen?.height >= 852 || window.screen?.width >= 852); const safeAreaTop = isIosStandalone ? (hasDynamicIsland ? 54 : 44) : (Platform.OS === 'web' ? 16 : 0);

  const getGreeting = () => {
    const hour = new Date().getHours();
    if (hour < 12) return 'Chào buổi sáng';
    if (hour < 18) return 'Chào buổi chiều';
    return 'Chào buổi tối';
  };

  const getThemeStyles = () => {
    if (isDarkMode) {
      return {
        headerBg: '#1e293b',
        nameColor: '#ffffff',
        greetingColor: '#94a3b8',
        roleColor: '#4ade80',
        iconColor: '#60a5fa',
        borderWidth: 0,
        borderColor: 'transparent',
      };
    }
    const hour = new Date().getHours();
    const isMorning = hour < 12;
    const isAfternoon = hour >= 12 && hour < 18;
    return {
      headerBg: isMorning ? '#dcfce7' : isAfternoon ? '#fef9c3' : '#1f2937',
      nameColor: isMorning ? '#166534' : isAfternoon ? '#9a3412' : '#ffffff',
      greetingColor: isMorning ? '#15803d' : isAfternoon ? '#c2410c' : '#9ca3af',
      roleColor: isMorning ? '#16a34a' : isAfternoon ? '#d97706' : '#86efac',
      iconColor: isMorning ? '#166534' : isAfternoon ? '#9a3412' : '#60a5fa',
      borderWidth: isAfternoon ? 2 : 0,
      borderColor: isAfternoon ? '#fde047' : 'transparent',
    };
  };
  const theme = getThemeStyles();

  const styles = React.useMemo(() => getStyles(COLORS, isDarkMode, theme), [COLORS, isDarkMode, theme]);

  React.useEffect(() => {
    if (Platform.OS !== 'web' || typeof document === 'undefined') return undefined;

    const root = document.documentElement;
    const body = document.body;
    const themeMeta = document.head.querySelector('meta[name="theme-color"]');
    const defaultShellBg = '#F8FAFC';
    const dashboardShellBg = COLORS.bg;
    const defaultThemeColor = '#208AEF';

    const applyHeaderShellColor = () => {
      root.style.setProperty('--thecoc-shell-bg', dashboardShellBg);
      root.style.backgroundColor = dashboardShellBg;
      if (body) body.style.backgroundColor = dashboardShellBg;
      themeMeta?.setAttribute('content', theme.headerBg);
    };

    const resetShellColor = () => {
      root.style.setProperty('--thecoc-shell-bg', defaultShellBg);
      root.style.backgroundColor = defaultShellBg;
      if (body) body.style.backgroundColor = defaultShellBg;
      themeMeta?.setAttribute('content', defaultThemeColor);
    };

    applyHeaderShellColor();
    const unsubscribeFocus = navigation.addListener('focus', applyHeaderShellColor);
    const unsubscribeBlur = navigation.addListener('blur', resetShellColor);

    return () => {
      unsubscribeFocus?.();
      unsubscribeBlur?.();
      resetShellColor();
    };
  }, [navigation, theme.headerBg, COLORS.bg]);

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

  const handleManualUpdate = async () => {
    if (Platform.OS === 'web') {
      setIsCheckingUpdate(true);
      if (typeof window !== 'undefined') {
        try {
          if (window.caches?.keys) {
            const keys = await window.caches.keys();
            await Promise.all(
              keys
                .filter((key) => key.startsWith('thecoc-pwa-'))
                .map((key) => window.caches.delete(key))
            );
          }

          if (typeof navigator !== 'undefined' && navigator.serviceWorker?.getRegistrations) {
            const registrations = await navigator.serviceWorker.getRegistrations();
            await Promise.all(registrations.map(async (registration) => {
              registration.waiting?.postMessage?.({ type: 'SKIP_WAITING' });
              await registration.update?.();
            }));
          }
        } catch (error) {
          console.log('Cannot clear PWA cache:', error?.message || error);
        } finally {
          const url = new URL(window.location.href);
          url.searchParams.set('v', Date.now().toString());
          window.location.replace(url.toString());
        }
      }
      return;
    }
    
    try {
      setIsCheckingUpdate(true);
      const update = await Updates.checkForUpdateAsync();
      if (update.isAvailable) {
        Alert.alert('Có bản cập nhật mới!', 'Đang tiến hành tải xuống...');
        await Updates.fetchUpdateAsync();
        Alert.alert('Thành công', 'Tải xong! App sẽ khởi động lại ngay.', [
          { text: 'OK', onPress: () => Updates.reloadAsync() }
        ]);
      } else {
        Alert.alert('Thông báo', 'Bạn đang dùng phiên bản mới nhất rồi!');
      }
    } catch (error) {
      Alert.alert('Lỗi cập nhật', error.message);
    } finally {
      setIsCheckingUpdate(false);
    }
  };

  const [showProfileModal, setShowProfileModal] = useState(false);
  const [newPassword, setNewPassword] = useState('');
  const [newAvatar, setNewAvatar] = useState(currentUser?.avatar_url || '');
  const [isSavingProfile, setIsSavingProfile] = useState(false);

  const handleUpdateProfile = async () => {
    setIsSavingProfile(true);
    try {
      const updates = {};
      if (newPassword.trim()) updates.password = newPassword.trim();
      if (newAvatar.trim()) updates.avatar_url = newAvatar.trim();

      if (Object.keys(updates).length > 0) {
        const { data: updatedUser, error } = await updateMyProfile(updates);
        if (error) throw error;
        setCurrentUser({ ...currentUser, ...updatedUser });
        setNewPassword('');
        Alert.alert('Thành công', 'Cập nhật thông tin thành công!');
      }
      setShowProfileModal(false);
    } catch (e) {
      Alert.alert('Lỗi', e.message || 'Không thể cập nhật hồ sơ.');
    } finally {
      setIsSavingProfile(false);
    }
  };
  const isOwner = currentUser?.role === 'OWNER';
  const viewableStores = getAllowedStoreIds(currentUser);
  const businessStores = React.useMemo(() => getBusinessStores(storeList), [storeList]);

  // Hiển thị thanh chọn store nếu là OWNER hoặc được cấp quyền xem nhiều hơn 1 chi nhánh
  const canShowStoreSelector = isOwner || viewableStores.length > 1;

  let displayStoreId = currentUser?.store_id;
  if (canAccessStore(currentUser, selectedStoreId)) {
    displayStoreId = selectedStoreId;
  }
  if (isOwner && selectedStoreId === 'ALL') {
    displayStoreId = 'ALL';
  }

  const filteredStaff = staffList.filter(s => displayStoreId === 'ALL' || String(s.store_id) === String(displayStoreId) || s.permissions?.viewable_stores?.some((storeId) => String(storeId) === String(displayStoreId)));
  const activeStaffCount = filteredStaff.length;

  const today = getLocalDateKey();
  const todaysHistory = attendanceHistory.filter((record) => (
    record.date === today && filteredStaff.some((staff) => staff.id === record.user_id)
  ));
  const isOpenAttendance = (record) => !Boolean(record.checkOut || record.check_out || record.check_out_at);
  const workingStaff = filteredStaff.filter((staff) => (
    todaysHistory.some((record) => record.user_id === staff.id && isOpenAttendance(record))
  ));
  const isScheduledShift = (shift) => !['REJECTED', 'CANCELLED', 'CANCELED'].includes(String(shift.status || '').toUpperCase());
  const todaysScheduledShifts = shiftRegistrations.filter((shift) => (
    shift.date === today && isScheduledShift(shift) && filteredStaff.some((staff) => staff.id === shift.user_id)
  ));
  const staffWithShiftToday = filteredStaff.filter((staff) => (
    todaysScheduledShifts.some((shift) => shift.user_id === staff.id)
  ));
  const myTodayShift = todaysScheduledShifts.find((shift) => shift.user_id === currentUser?.id);
  const hasCheckedIn = (record) => Boolean(record?.checkIn || record?.check_in || record?.checkInAt || record?.check_in_at);
  const missingCheckInStaff = staffWithShiftToday.filter((staff) => !todaysHistory.some((record) => (
    record.user_id === staff.id && hasCheckedIn(record)
  )));
  const missingCheckOutStaff = staffWithShiftToday.filter((staff) => todaysHistory.some((record) => (
    record.user_id === staff.id && hasCheckedIn(record) && isOpenAttendance(record)
  )));
  const previewStaffNames = (staff) => {
    const names = staff.map((item) => item.name || 'Nhân viên').filter(Boolean);
    if (names.length <= 2) return names.join(', ');
    return `${names.slice(0, 2).join(', ')} +${names.length - 2}`;
  };
  const managerStoreIds = isOwner
    ? businessStores.map((store) => store.id)
    : (viewableStores.length > 0 ? viewableStores : [currentUser?.store_id]).filter(Boolean);
  const uncoveredShiftsToday = currentUser?.role === 'STAFF' ? [] : managerStoreIds.flatMap((storeId) => (
    ['MORNING', 'AFTERNOON'].flatMap((shiftType) => {
      const store = storeList.find((item) => String(item.id) === String(storeId));
      const configuredTarget = Number(store?.staffing_targets?.[shiftType]);
      const requiredStaff = Number.isFinite(configuredTarget) && configuredTarget >= 1 ? Math.min(4, Math.round(configuredTarget)) : 2;
      const assignedStaff = shiftRegistrations.filter((shift) => (
        shift.date === today
        && String(shift.store_id) === String(storeId)
        && shift.shift_type === shiftType
        && shift.status === 'APPROVED'
      )).length;
      return assignedStaff < requiredStaff ? [{ storeId, shiftType, missing: requiredStaff - assignedStaff }] : [];
    })
  ));
  const coverageReminderText = uncoveredShiftsToday.length
    ? uncoveredShiftsToday.slice(0, 2).map((item) => {
      const storeName = storeList.find((store) => String(store.id) === String(item.storeId))?.name || `CN ${item.storeId}`;
      return `${storeName} ${item.shiftType === 'MORNING' ? 'sáng' : 'chiều'} thiếu ${item.missing}`;
    }).join(', ')
    : '';
  const managerReminderParts = [
    coverageReminderText ? `Ca thiếu người: ${coverageReminderText}` : '',
    missingCheckInStaff.length ? `Chưa check-in: ${previewStaffNames(missingCheckInStaff)}` : '',
    missingCheckOutStaff.length ? `Chưa check-out: ${previewStaffNames(missingCheckOutStaff)}` : '',
  ].filter(Boolean);
  const managerNeedsReminder = managerReminderParts.length > 0;
  const shiftLabel = String(myTodayShift?.shift_type || myTodayShift?.shiftType || 'Ca làm việc')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase());

  const monthlyHistory = attendanceHistory.filter((record) => (
    isDateInCurrentMonth(record.date) && filteredStaff.some((staff) => staff.id === record.user_id)
  ));
  const totalMonthlyHours = monthlyHistory.reduce((sum, record) => sum + (Number(record.hours) || 0), 0);
  const totalMonthlyWage = monthlyHistory.reduce((sum, record) => {
    const staff = filteredStaff.find((item) => item.id === record.user_id);
    return sum + ((Number(record.hours) || 0) * (Number(staff?.wage) || 0));
  }, 0);

  const myHistory = attendanceHistory.filter((record) => (
    record.user_id === currentUser?.id && isDateInCurrentMonth(record.date)
  ));
  const totalMyHours = myHistory.reduce((sum, record) => sum + (Number(record.hours) || 0), 0);
  const totalMyWage = totalMyHours * (Number(currentUser?.wage) || 0);
  const myOpenAttendance = todaysHistory.find((record) => (
    record.user_id === currentUser?.id && isOpenAttendance(record)
  ));
  const getCheckInDate = (record) => {
    const timestamp = record?.checkInAt || record?.check_in_at;
    if (timestamp) {
      const parsed = new Date(timestamp);
      if (!Number.isNaN(parsed.getTime())) return parsed;
    }

    const time = record?.checkIn || record?.check_in;
    if (record?.date && time && /^\d{1,2}:\d{2}/.test(String(time))) {
      const parsed = new Date(`${record.date}T${String(time).slice(0, 5)}:00`);
      if (!Number.isNaN(parsed.getTime())) return parsed;
    }
    return null;
  };
  const myCheckInDate = getCheckInDate(myOpenAttendance);
  const myCheckInTime = myCheckInDate
    ? myCheckInDate.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit', hour12: false })
    : (myOpenAttendance?.checkIn || myOpenAttendance?.check_in || '--:--');
  const minutesWorked = myCheckInDate ? Math.max(0, Math.floor((Date.now() - myCheckInDate.getTime()) / 60000)) : 0;
  const workedTodayText = minutesWorked >= 60
    ? `${Math.floor(minutesWorked / 60)} giờ${minutesWorked % 60 ? ` ${minutesWorked % 60} phút` : ''}`
    : `${minutesWorked} phút`;
  const dashboardHours = currentUser?.role === 'STAFF' ? totalMyHours : totalMonthlyHours;
  const dashboardWage = currentUser?.role === 'STAFF' ? totalMyWage : totalMonthlyWage;

  // Hàm kiểm tra quyền
  const hasPermission = (featureKey) => {
    if (featureKey === 'hr') {
      return userHasPermission(currentUser, 'hr') || userHasPermission(currentUser, 'manage_permissions');
    }
    return userHasPermission(currentUser, featureKey);
  };

  const handleNav = (featureKey, routeName, staffRouteName, fallbackAction) => {
    if (!hasPermission(featureKey)) {
      alert('Bạn chưa được cấp quyền truy cập tính năng này!');
      return;
    }

    if (routeName === 'ALERT') {
      fallbackAction();
      return;
    }

    if (currentUser?.role === 'STAFF' && staffRouteName) {
      navigation.navigate(staffRouteName);
    } else {
      navigation.navigate(routeName);
    }
  };

  const renderGridItem = (title, subTitle, iconName, iconLib, bgColor, featureKey, routeName, staffRouteName, fallbackAction, iconColor) => {
    const allowed = hasPermission(featureKey);
    if (!allowed) return null;

    const compactTitleMap = {
      cashier: 'Giao ca',
      inventory: 'Kho hàng',
      central_warehouse: 'Kho tổng',
      payroll: 'Bảng lương',
      finance: 'Tài chính',
    };
    const compactTitle = routeName === 'AttendanceReview'
      ? 'Đối chiếu'
      : featureKey === 'hr'
        ? (currentUser?.role === 'STAFF' ? 'Chấm công' : 'Nhân sự')
        : compactTitleMap[featureKey] || title;
    const iconColorMap = {
      cashier: '#16a34a',
      inventory: '#f97316',
      central_warehouse: '#7c3aed',
      payroll: '#d97706',
      finance: '#7c3aed',
      hr: routeName === 'AttendanceReview' ? '#0d9488' : '#2563eb',
    };
    const safeIconColor = iconColor || iconColorMap[featureKey] || COLORS.primary;

    return (
      <TouchableOpacity
        style={styles.gridItem}
        activeOpacity={0.7}
        onPress={() => handleNav(featureKey, routeName, staffRouteName, fallbackAction)}
        accessibilityRole="button"
        accessibilityLabel={`${compactTitle}. ${subTitle}`}
      >
        <View style={[styles.gridIconBox, { backgroundColor: bgColor }]}>
          {iconLib === 'Ionicons' ? (
            <Ionicons name={iconName} size={width <= 360 ? 34 : 36} color={safeIconColor} />
          ) : (
            <MaterialCommunityIcons name={iconName} size={width <= 360 ? 34 : 36} color={safeIconColor} />
          )}
        </View>
        <Text style={styles.gridItemTitle} numberOfLines={2}>
          {compactTitle}
        </Text>
      </TouchableOpacity>
    );
  };


  return (
    <View style={styles.container}>
      {/* HEADER */}
      <View style={[styles.headerContainer, { paddingTop: Math.max(safeAreaTop + 10, 20), backgroundColor: theme.headerBg, borderWidth: theme.borderWidth, borderColor: theme.borderColor, borderBottomWidth: theme.borderWidth > 0 ? theme.borderWidth : 0, borderTopWidth: 0, borderLeftWidth: 0, borderRightWidth: 0 }]}>
        <TouchableOpacity style={styles.headerProfile} onPress={() => { setNewAvatar(currentUser?.avatar_url || ''); setShowProfileModal(true); }}>
          <Image
            source={{ uri: currentUser?.avatar_url || (currentUser?.role === 'STAFF' ? 'https://i.pravatar.cc/100?img=33' : 'https://i.pravatar.cc/100?img=12') }}
            style={styles.avatar}
          />
          <View style={styles.headerTextContainer}>
            <Text style={[styles.greetingText, { color: theme.greetingColor }]}>{getGreeting()},</Text>
            <Text style={[styles.nameText, { color: theme.nameColor }]} numberOfLines={1}>
              {currentUser?.name || 'Thành viên The Cốc'}
            </Text>
            <Text style={[styles.roleText, { color: theme.roleColor }]}>
              {currentUser?.role === 'OWNER'
                ? 'Chủ cửa hàng'
                : currentUser?.role === 'MANAGER'
                  ? 'Quản lý'
                  : 'Nhân viên'}
            </Text>
          </View>
        </TouchableOpacity>

        <View style={{flexDirection: 'row', alignItems: 'center', gap: 15}}>


          <TouchableOpacity onPress={() => navigation.navigate('Notifications')} style={{ position: 'relative' }}>
            <Ionicons name="notifications-outline" size={26} color={theme.iconColor} />
            {unreadCount > 0 && (
              <View style={styles.badge}>
                <Text style={styles.badgeText}>{unreadCount > 9 ? '9+' : unreadCount}</Text>
              </View>
            )}
          </TouchableOpacity>

          <TouchableOpacity onPress={handleManualUpdate}>
            {isCheckingUpdate ? <ActivityIndicator color={theme.iconColor} size="small" /> : <Ionicons name="refresh-outline" size={26} color={theme.iconColor} />}
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.logoutBtn}
            onPress={logout}
          >
            <MaterialCommunityIcons name="logout" size={24} color="#ff5252" />
          </TouchableOpacity>
        </View>
      </View>

      {/* CHỌN CHI NHÁNH */}
      {canShowStoreSelector && (
        <View style={{ paddingHorizontal: 20, paddingTop: 15 }}>
          <Text style={{ fontSize: 14, fontWeight: 'bold', color: '#6b7280', marginBottom: 10 }}>Dữ liệu hiển thị cho:</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.storeSelector}>

            {/* TẤT CẢ CHI NHÁNH CHỈ DÀNH CHO OWNER */}
            {isOwner && (
              <TouchableOpacity
                style={[styles.storeChip, selectedStoreId === 'ALL' && styles.storeChipActive]}
                onPress={() => setSelectedStoreId('ALL')}
              >
                <Text style={[styles.storeChipText, selectedStoreId === 'ALL' && styles.storeChipTextActive]}>Tất cả Chi nhánh</Text>
              </TouchableOpacity>
            )}

            {/* CÁC CHI NHÁNH ĐƯỢC PHÉP XEM */}
            {businessStores.filter(s => isOwner || canAccessStore(currentUser, s.id)).map(store => (
              <TouchableOpacity
                key={store.id}
                style={[styles.storeChip, selectedStoreId === store.id && styles.storeChipActive]}
                onPress={() => setSelectedStoreId(store.id)}
              >
                <Text style={[styles.storeChipText, selectedStoreId === store.id && styles.storeChipTextActive]}>{store.name}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>
      )}

      {/* ERROR BANNER */}
      {dataError ? (
        <TouchableOpacity style={{ backgroundColor: '#fee2e2', padding: 15, marginHorizontal: 20, borderRadius: 10, marginTop: 10 }} onPress={refreshData}>
          <Text style={{ color: '#991b1b', fontWeight: 'bold' }}>Lỗi tải dữ liệu: {dataError}</Text>
          <Text style={{ color: '#991b1b', fontSize: 12 }}>Chạm vào đây để thử tải lại.</Text>
        </TouchableOpacity>
      ) : null}


      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scrollContent}>

        {/* QUICK STATS */}
        <Text style={styles.sectionTitle}>Tổng quan hôm nay</Text>
        <View style={[styles.quickStatusCard, {
          backgroundColor: currentUser?.role === 'STAFF' && !myTodayShift ? (isDarkMode ? '#1e3a5f' : '#eff6ff') : (currentUser?.role !== 'STAFF' && managerNeedsReminder ? (isDarkMode ? '#3f2a0b' : '#fff7ed') : (isDarkMode ? '#123529' : '#ecfdf3')),
          borderColor: currentUser?.role === 'STAFF' && !myTodayShift ? (isDarkMode ? '#1d4ed8' : '#bfdbfe') : (currentUser?.role !== 'STAFF' && managerNeedsReminder ? (isDarkMode ? '#854d0e' : '#fed7aa') : (isDarkMode ? '#166534' : '#a7f3d0')),
        }]}>
          <View style={[styles.quickStatusIcon, { backgroundColor: currentUser?.role === 'STAFF' && !myTodayShift ? '#2563eb' : (currentUser?.role !== 'STAFF' && managerNeedsReminder ? '#f59e0b' : '#16a34a') }]}>
            <Ionicons name={currentUser?.role === 'STAFF' && !myTodayShift ? 'calendar-outline' : (currentUser?.role !== 'STAFF' && managerNeedsReminder ? 'notifications-outline' : 'checkmark-circle-outline')} size={26} color="#fff" />
          </View>
          <View style={styles.quickStatusContent}>
            <Text style={styles.quickStatusTitle}>
              {isDataLoading
                ? 'Đang cập nhật lịch làm...'
                : currentUser?.role === 'STAFF'
                  ? (myOpenAttendance ? 'Bạn đang trong ca làm việc' : myTodayShift ? `Hôm nay bạn có ${shiftLabel}` : 'Hôm nay bạn không có ca làm việc')
                  : (managerNeedsReminder ? `${missingCheckInStaff.length + missingCheckOutStaff.length} nhân viên cần nhắc chấm công` : (staffWithShiftToday.length ? `${staffWithShiftToday.length}/${activeStaffCount} nhân viên có ca hôm nay` : 'Hôm nay chưa có nhân viên có ca làm việc'))}
            </Text>
            <Text style={styles.quickStatusSubtitle}>
              {currentUser?.role === 'STAFF'
                ? (myOpenAttendance ? `Đã check-in lúc ${myCheckInTime} · Đã làm ${workedTodayText}` : myTodayShift ? 'Bạn chưa check-in ca này' : 'Lịch làm hôm nay đang trống')
                : (managerNeedsReminder ? managerReminderParts.join(' · ') : `${workingStaff.length} nhân viên đang check-in trong ca`)}
            </Text>
          </View>
        </View>

        <Text style={styles.monthlyStatsTitle}>Thống kê tháng này</Text>
        <View style={styles.monthlyStatsRow}>
          <View style={styles.monthlyStatCard}>
            <View style={[styles.monthlyStatIcon, { backgroundColor: '#e3f2fd' }]}>
              <Ionicons name="time-outline" size={20} color="#1976d2" />
            </View>
            <View style={styles.monthlyStatContent}>
              <Text style={styles.monthlyStatValue}>{dashboardHours.toFixed(1)}h</Text>
              <Text style={styles.monthlyStatLabel}>Giờ làm</Text>
            </View>
          </View>
          <View style={styles.monthlyStatCard}>
            <View style={[styles.monthlyStatIcon, { backgroundColor: '#fff3e0' }]}>
              <MaterialCommunityIcons name="currency-usd" size={20} color="#ff9800" />
            </View>
            <View style={styles.monthlyStatContent}>
              <Text style={styles.monthlyStatValue}>{dashboardWage.toLocaleString()}đ</Text>
              <Text style={styles.monthlyStatLabel}>Lương tạm tính</Text>
            </View>
          </View>
        </View>

        {/* 2x2 GRID MENU */}
        <Text style={styles.sectionTitle}>Tính năng {currentUser?.role === 'STAFF' ? 'làm việc' : 'quản lý'}</Text>
        <View style={styles.gridContainer}>
          <TouchableOpacity
            style={styles.gridItem}
            activeOpacity={0.7}
            onPress={() => navigation.navigate('StaffCheckin')}
            accessibilityRole="button"
            accessibilityLabel="Chấm công"
          >
            <View style={[styles.gridIconBox, { backgroundColor: '#E8F8F0' }]}>
              <Ionicons name="log-in-outline" size={width <= 360 ? 34 : 36} color="#16A34A" />
            </View>
            <Text style={styles.gridItemTitle}>Chấm công</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.gridItem}
            activeOpacity={0.7}
            onPress={() => navigation.navigate('ScheduleTab')}
            accessibilityRole="button"
            accessibilityLabel="Lịch làm"
          >
            <View style={[styles.gridIconBox, { backgroundColor: '#EAF2FF' }]}>
              <Ionicons name="calendar-outline" size={width <= 360 ? 34 : 36} color="#2563EB" />
            </View>
            <Text style={styles.gridItemTitle}>Lịch làm</Text>
          </TouchableOpacity>          <TouchableOpacity
            style={styles.gridItem}
            activeOpacity={0.7}
            onPress={() => navigation.navigate('AttendanceCorrection')}
            accessibilityRole="button"
            accessibilityLabel="Bổ sung công"
          >
            <View style={[styles.gridIconBox, { backgroundColor: '#FEF3C7' }]}>
              <Ionicons name="document-text-outline" size={width <= 360 ? 34 : 36} color="#B45309" />
            </View>
            <Text style={styles.gridItemTitle}>{currentUser?.role === 'STAFF' ? 'Bổ sung công' : 'Yêu cầu công'}</Text>
          </TouchableOpacity>
          {renderGridItem('Giao Ca & Doanh Thu', 'Quản lý Két & Chốt Ca', 'cash-register', 'Material', '#e8f5e9', 'cashier', 'Shifts', 'Shifts')}
          {renderGridItem('Kho Hàng', 'Tồn kho & Yêu cầu', 'warehouse', 'Material', '#fff3e0', 'inventory', 'Inventory', 'Inventory')}
          {renderGridItem('Kho Tổng', 'Duyệt xuất hàng', 'package-variant-closed', 'Material', '#ede9fe', 'central_warehouse', 'CentralWarehouse', 'CentralWarehouse')}
          {currentUser?.role !== 'STAFF' && renderGridItem('Nhân Sự', 'Hồ sơ & Phân quyền', 'id-card', 'Ionicons', '#e0f7fa', 'hr', 'StaffManagement', 'StaffCheckin')}
          {currentUser?.role !== 'STAFF' && renderGridItem('Đối Chiếu Công', 'Lịch làm vs chấm công', 'clipboard-check-outline', 'Material', '#dcfce7', 'hr', 'AttendanceReview', 'AttendanceReview')}
          {renderGridItem('Bảng Lương', 'Bảng lương chi tiết', 'wallet-outline', 'Material', '#fff8e1', 'payroll', 'Payroll', 'Payroll')}
          {renderGridItem('Tài Chính', 'Doanh thu & Lợi nhuận', 'chart-line', 'Material', '#ede9fe', 'finance', 'Finance', 'Finance')}
        </View>

      </ScrollView>

      {/* MODAL CẬP NHẬT HỒ SƠ */}
      <Modal visible={showProfileModal} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Cập Nhật Cá Nhân</Text>

            <Text style={styles.modalLabel}>Đổi mật khẩu mới (Mặc định: 123):</Text>
            <TextInput
              style={styles.modalInput}
              secureTextEntry
              placeholder="Bỏ trống nếu không đổi"
              value={newPassword}
              onChangeText={setNewPassword}
            />

            <Text style={styles.modalLabel}>Link ảnh đại diện (Avatar URL):</Text>
            <TextInput
              style={styles.modalInput}
              placeholder="https://..."
              value={newAvatar}
              onChangeText={setNewAvatar}
            />

            <View style={styles.modalBtnRow}>
              <TouchableOpacity style={[styles.modalBtn, {backgroundColor: '#e5e7eb'}]} onPress={() => setShowProfileModal(false)}>
                <Text style={[styles.modalBtnText, {color: '#4b5563'}]}>Hủy</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.modalBtn, {backgroundColor: '#1976d2'}]} onPress={handleUpdateProfile} disabled={isSavingProfile}>
                {isSavingProfile ? <ActivityIndicator color="#fff" size="small"/> : <Text style={styles.modalBtnText}>Lưu</Text>}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

    </View>
  );
}

const getStyles = (COLORS, isDarkMode, theme) => StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.bg },
  headerContainer: { backgroundColor: theme.headerBg, paddingBottom: 25, paddingHorizontal: 20, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', borderBottomLeftRadius: 25, borderBottomRightRadius: 25, elevation: 5, shadowColor: '#000', shadowOpacity: 0.15, shadowRadius: 10 },
  headerProfile: { flexDirection: 'row', alignItems: 'center' },
  avatar: { width: 50, height: 50, borderRadius: 25, borderWidth: 2, borderColor: '#fff' },
  headerTextContainer: { marginLeft: 13, maxWidth: width - 135 },
  greetingText: { color: '#9ca3af', fontSize: 14 },
  nameText: { color: '#fff', fontSize: 18, fontWeight: 'bold' },
  roleText: { color: '#86efac', fontSize: 12, fontWeight: '700', marginTop: 2 },
  logoutBtn: { padding: 10, backgroundColor: 'rgba(255,255,255,0.1)', borderRadius: 20 },
  themeToggleBtn: { padding: 10, backgroundColor: 'rgba(255,255,255,0.1)', borderRadius: 20, position: 'relative' },
  themeModeDot: { position: 'absolute', right: 8, top: 8, width: 7, height: 7, borderRadius: 4, backgroundColor: COLORS.accent },
  storeSelector: { flexDirection: 'row' },
  storeChip: { backgroundColor: COLORS.border, paddingHorizontal: 16, paddingVertical: 8, borderRadius: 20, marginRight: 10, height: 36, justifyContent: 'center' },
  storeChipActive: { backgroundColor: '#1976d2' },
  storeChipText: { color: COLORS.textMuted, fontWeight: 'bold', fontSize: 13 },
  storeChipTextActive: { color: '#fff' },
  scrollContent: { padding: 20, paddingBottom: 40 },
  updateButton: { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-end', backgroundColor: isDarkMode ? '#1e293b' : '#e8f1ff', borderRadius: 20, paddingHorizontal: 13, paddingVertical: 9, marginBottom: 16 },
  updateButtonText: { color: '#1565c0', fontWeight: '800', fontSize: 12, marginLeft: 7 },
  sectionTitle: { fontSize: 18, fontWeight: 'bold', color: COLORS.text, marginBottom: 15, marginTop: 5 },
  quickStatusCard: { minHeight: 78, borderWidth: 1, borderRadius: 16, padding: 13, flexDirection: 'row', alignItems: 'center', marginBottom: 14 },
  quickStatusIcon: { width: 46, height: 46, borderRadius: 14, alignItems: 'center', justifyContent: 'center', marginRight: 12 },
  quickStatusContent: { flex: 1 },
  quickStatusTitle: { color: COLORS.text, fontSize: 15, fontWeight: '900' },
  quickStatusSubtitle: { color: COLORS.textMuted, fontSize: 12, marginTop: 3 },
  monthlyStatsTitle: { color: COLORS.textMuted, fontSize: 12, fontWeight: '800', marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.3 },
  monthlyStatsRow: { flexDirection: 'row', gap: 10, marginBottom: 22 },
  monthlyStatCard: { flex: 1, minHeight: 72, backgroundColor: COLORS.card, borderRadius: 14, paddingHorizontal: 11, flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: COLORS.border },
  monthlyStatIcon: { width: 36, height: 36, borderRadius: 11, alignItems: 'center', justifyContent: 'center', marginRight: 9 },
  monthlyStatContent: { flex: 1, minWidth: 0 },
  monthlyStatValue: { color: COLORS.text, fontWeight: '900', fontSize: 16 },
  monthlyStatLabel: { color: COLORS.textMuted, fontSize: 11, marginTop: 2 },
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
  gridContainer: {
    width: Math.min(width - 40, APP_GRID_MAX_WIDTH),
    alignSelf: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    columnGap: APP_GRID_GAP,
    rowGap: 16,
  },
  gridItem: {
    width: (Math.min(width - 40, APP_GRID_MAX_WIDTH) - (APP_GRID_GAP * (APP_GRID_COLUMNS - 1))) / APP_GRID_COLUMNS,
    alignItems: 'center',
    justifyContent: 'flex-start',
    paddingVertical: 4,
    position: 'relative',
  },
  gridItemDisabled: { opacity: 0.62 },
  gridIconBox: {
    width: width <= 360 ? 56 : 62,
    height: width <= 360 ? 56 : 62,
    borderRadius: 18,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 8,
    borderWidth: 1,
    borderColor: isDarkMode ? 'rgba(255,255,255,0.08)' : 'rgba(15,23,42,0.05)',
    shadowColor: '#000',
    shadowOpacity: isDarkMode ? 0.22 : 0.09,
    shadowRadius: 7,
    shadowOffset: { width: 0, height: 4 },
    elevation: 2,
  },
  gridItemTitle: {
    fontSize: 11,
    fontWeight: '800',
    color: COLORS.text,
    textAlign: 'center',
    lineHeight: 14,
    minHeight: 28,
  },
  gridItemSub: { display: 'none' },
  lockIcon: {
    position: 'absolute',
    top: 0,
    right: 7,
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: isDarkMode ? '#450a0a' : '#fee2e2',
    alignItems: 'center',
    justifyContent: 'center',
  },

  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', padding: 20 },
  modalContent: { backgroundColor: COLORS.card, borderRadius: 16, padding: 20, elevation: 5 },
  modalTitle: { fontSize: 20, fontWeight: 'bold', color: COLORS.text, marginBottom: 20, textAlign: 'center' },
  modalLabel: { fontSize: 13, fontWeight: 'bold', color: COLORS.text, marginBottom: 8 },
  modalInput: { borderWidth: 1, borderColor: COLORS.inputBorder, borderRadius: 10, padding: 12, marginBottom: 15, fontSize: 15, backgroundColor: COLORS.inputBg, color: COLORS.text },
  modalBtnRow: { flexDirection: 'row', gap: 10, marginTop: 10 },
  modalBtn: { flex: 1, padding: 14, borderRadius: 10, alignItems: 'center' },
  modalBtnText: { color: '#fff', fontWeight: 'bold', fontSize: 16 }
});

