import React, { useContext, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, Image, Dimensions, ActivityIndicator, Alert, Modal, TextInput } from 'react-native';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { AppContext } from '../context/AppContext';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Updates from 'expo-updates';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { getLocalDateKey, isDateInCurrentMonth } from '../utils/dateTime';
import { supabase } from '../services/supabaseClient';

const { width } = Dimensions.get('window');

export default function DashboardScreen({ navigation }) {
  const insets = useSafeAreaInsets();
  const {
    currentUser,
    setCurrentUser,
    staffList,
    attendanceHistory,
    storeList,
    selectedStoreId,
    setSelectedStoreId,
    dataError,
    refreshData,
    COLORS,
    isDarkMode,
    themeMode,
    toggleThemeMode,
  } = useContext(AppContext);
  const [isCheckingUpdate, setIsCheckingUpdate] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);

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
    if (currentUser?.role === 'OWNER') {
      Alert.alert('Tính năng này', 'Tài khoản chủ cửa hàng hiện tại là tĩnh, không thay đổi được.');
      return;
    }
    setIsSavingProfile(true);
    try {
      const updates = {};
      if (newPassword.trim()) updates.password = newPassword.trim();
      if (newAvatar.trim()) updates.avatar_url = newAvatar.trim();

      if (Object.keys(updates).length > 0) {
        const { error } = await supabase.from('users').update(updates).eq('id', currentUser.id);
        if (error) throw error;

        setCurrentUser({...currentUser, ...updates});
        Alert.alert('Thành công', 'Cập nhật thông tin thành công!');
        setShowProfileModal(false);
      } else {
        setShowProfileModal(false);
      }
    } catch (e) {
      Alert.alert('Lỗi', e.message);
    } finally {
      setIsSavingProfile(false);
    }
  };

  const isOwner = currentUser?.role === 'OWNER';
  const viewableStores = currentUser?.permissions?.viewable_stores || [];

  // Hiển thị thanh chọn store nếu là OWNER hoặc được cấp quyền xem nhiều hơn 1 chi nhánh
  const canShowStoreSelector = isOwner || viewableStores.length > 1;

  let displayStoreId = currentUser?.store_id;
  if (isOwner || viewableStores.includes(selectedStoreId)) {
    displayStoreId = selectedStoreId;
  }
  if (isOwner && selectedStoreId === 'ALL') {
    displayStoreId = 'ALL';
  }

  const filteredStaff = staffList.filter(s => displayStoreId === 'ALL' || s.store_id === displayStoreId || s.permissions?.viewable_stores?.includes(displayStoreId));
  const activeStaffCount = filteredStaff.length;

  const today = getLocalDateKey();
  const todaysHistory = attendanceHistory.filter(r => r.date === today && filteredStaff.some(s => s.id === r.user_id));
  const todaysEstimatedCost = todaysHistory.reduce((sum, record) => {
    const staff = filteredStaff.find(s => s.id === record.user_id);
    return sum + ((record.hours || 0) * (staff?.wage || 0));
  }, 0);

  const myHistory = attendanceHistory.filter(
    r => r.user_id === currentUser?.id && isDateInCurrentMonth(r.date)
  );
  const totalMyHours = myHistory.reduce((sum, r) => sum + (r.hours || 0), 0);
  const totalMyWage = totalMyHours * (currentUser?.wage || 0);

  // Hàm kiểm tra quyền
  const hasPermission = (featureKey) => {
    if (currentUser?.role === 'OWNER') return true;

    const permissions = currentUser?.permissions || {};
    const hasExplicitPermissions = Object.keys(permissions).length > 0;

    // Tương thích tài khoản quản lý cũ chưa có object permissions.
    if (currentUser?.role === 'MANAGER' && !hasExplicitPermissions) return true;

    if (featureKey === 'finance') {
      return permissions.finance === true || permissions.reports === true;
    }

    if (featureKey === 'hr') {
      return permissions.hr === true || permissions.manage_permissions === true;
    }

    return permissions[featureKey] === true;
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

  const renderGridItem = (title, subTitle, iconName, iconLib, bgColor, featureKey, routeName, staffRouteName, fallbackAction) => {
    const allowed = hasPermission(featureKey);

    return (
      <TouchableOpacity
        style={[styles.gridItem, !allowed && styles.gridItemDisabled]}
        activeOpacity={allowed ? 0.7 : 1}
        onPress={() => handleNav(featureKey, routeName, staffRouteName, fallbackAction)}
      >
        <View style={[styles.gridIconBox, { backgroundColor: allowed ? bgColor : '#e5e7eb' }]}>
          {iconLib === 'Ionicons' ? (
            <Ionicons name={iconName} size={32} color={allowed ? (bgColor === '#e8f5e9' ? '#4CAF50' : '#00bcd4') : '#9ca3af'} />
          ) : (
            <MaterialCommunityIcons name={iconName} size={32} color={allowed ? (bgColor === '#fce4ec' ? '#e91e63' : '#ffc107') : '#9ca3af'} />
          )}
        </View>
        <Text style={[styles.gridItemTitle, !allowed && {color: '#9ca3af'}]}>{title}</Text>
        <Text style={[styles.gridItemSub, !allowed && {color: '#d1d5db'}]}>{subTitle}</Text>

        {!allowed && (
          <View style={styles.lockIcon}>
            <Ionicons name="lock-closed" size={16} color="#ef4444" />
          </View>
        )}
      </TouchableOpacity>
    );
  };

  return (
    <View style={styles.container}>
      {/* HEADER */}
      <View style={[styles.headerContainer, { paddingTop: Math.max(insets.top + 10, 20), backgroundColor: theme.headerBg, borderWidth: theme.borderWidth, borderColor: theme.borderColor, borderBottomWidth: theme.borderWidth > 0 ? theme.borderWidth : 0, borderTopWidth: 0, borderLeftWidth: 0, borderRightWidth: 0 }]}>
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
          <TouchableOpacity
            onPress={toggleThemeMode}
            style={styles.themeToggleBtn}
            accessibilityLabel={isDarkMode ? 'Chuyển sang giao diện sáng' : 'Chuyển sang giao diện tối'}
          >
            <Ionicons name={isDarkMode ? 'sunny-outline' : 'moon-outline'} size={24} color={theme.iconColor} />
            {themeMode !== 'system' && <View style={styles.themeModeDot} />}
          </TouchableOpacity>

          <TouchableOpacity onPress={() => navigation.navigate('Notifications')} style={{ position: 'relative' }}>
            <Ionicons name="notifications-outline" size={26} color={theme.iconColor} />
            {unreadCount > 0 && (
              <View style={styles.badge}>
                <Text style={styles.badgeText}>{unreadCount > 9 ? '9+' : unreadCount}</Text>
              </View>
            )}
          </TouchableOpacity>

          <TouchableOpacity onPress={handleManualUpdate}>
            {isCheckingUpdate ? <ActivityIndicator color={theme.iconColor} size="small" /> : <Ionicons name="cloud-download-outline" size={26} color={theme.iconColor} />}
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.logoutBtn}
            onPress={async () => {
              await AsyncStorage.removeItem('userPhone');
              setCurrentUser(null);
              navigation.replace('Login');
            }}
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
            {storeList.filter(s => isOwner || viewableStores.includes(s.id)).map(store => (
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
        <Text style={styles.sectionTitle}>Tổng quan {currentUser?.role === 'STAFF' ? 'cá nhân' : 'hôm nay'}</Text>
        <View style={styles.statsRow}>
          <View style={styles.statCard}>
            <View style={[styles.iconBox, { backgroundColor: '#e3f2fd' }]}>
              <Ionicons name={currentUser?.role === 'STAFF' ? "time" : "people"} size={24} color="#1976d2" />
            </View>
            <Text style={styles.statValue}>
              {currentUser?.role === 'STAFF' ? totalMyHours.toFixed(1) + 'h' : activeStaffCount}
            </Text>
            <Text style={styles.statLabel}>
              {currentUser?.role === 'STAFF' ? 'Tổng giờ làm' : 'Nhân sự'}
            </Text>
          </View>

          <View style={styles.statCard}>
            <View style={[styles.iconBox, { backgroundColor: '#fff3e0' }]}>
              <MaterialCommunityIcons name="currency-usd" size={24} color="#ff9800" />
            </View>
            <Text style={styles.statValue}>
              {currentUser?.role === 'STAFF' ? totalMyWage.toLocaleString() : todaysEstimatedCost.toLocaleString()}đ
            </Text>
            <Text style={styles.statLabel}>
              {currentUser?.role === 'STAFF' ? 'Lương tạm tính' : 'Chi phí lương'}
            </Text>
          </View>
        </View>

        {/* 2x2 GRID MENU */}
        <Text style={styles.sectionTitle}>Tính năng {currentUser?.role === 'STAFF' ? 'làm việc' : 'quản lý'}</Text>
        <View style={styles.gridContainer}>
          {renderGridItem('Giao Ca & Doanh Thu', 'Quản lý Két & Chốt Ca', 'cash-register', 'Material', '#e8f5e9', 'cashier', 'Shifts', 'Shifts')}
          {renderGridItem('Kho Hàng', 'Tồn kho & Yêu cầu', 'warehouse', 'Material', '#fff3e0', 'inventory', 'Inventory', 'Inventory')}
          {renderGridItem(currentUser?.role === 'STAFF' ? 'Chấm Công' : 'Nhân Sự', currentUser?.role === 'STAFF' ? 'Định vị GPS / Camera' : 'Hồ sơ & Phân quyền', currentUser?.role === 'STAFF' ? "scan-circle" : "id-card", 'Ionicons', '#e0f7fa', 'hr', 'StaffManagement', 'StaffCheckin')}
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
  statsRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 25 },
  statCard: { backgroundColor: COLORS.card, width: (width - 55) / 2, padding: 15, borderRadius: 16, elevation: 2, shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 5 },
  iconBox: { width: 40, height: 40, borderRadius: 10, justifyContent: 'center', alignItems: 'center', marginBottom: 10 },
  statValue: { fontSize: 18, fontWeight: 'bold', color: COLORS.text },
  statLabel: { fontSize: 12, color: COLORS.textMuted },
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
  gridContainer: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between' },
  gridItem: { backgroundColor: COLORS.card, width: (width - 55) / 2, padding: 20, borderRadius: 16, marginBottom: 15, alignItems: 'center', elevation: 2, shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 5 },
  gridItemDisabled: { backgroundColor: isDarkMode ? '#0f172a' : '#f9fafb', opacity: 0.8 },
  gridIconBox: { width: 60, height: 60, borderRadius: 20, justifyContent: 'center', alignItems: 'center', marginBottom: 15 },
  gridItemTitle: { fontSize: 16, fontWeight: 'bold', color: COLORS.text, marginBottom: 5 },
  gridItemSub: { fontSize: 12, color: COLORS.textMuted, textAlign: 'center' },
  lockIcon: { position: 'absolute', top: 10, right: 10 },

  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', padding: 20 },
  modalContent: { backgroundColor: COLORS.card, borderRadius: 16, padding: 20, elevation: 5 },
  modalTitle: { fontSize: 20, fontWeight: 'bold', color: COLORS.text, marginBottom: 20, textAlign: 'center' },
  modalLabel: { fontSize: 13, fontWeight: 'bold', color: COLORS.text, marginBottom: 8 },
  modalInput: { borderWidth: 1, borderColor: COLORS.inputBorder, borderRadius: 10, padding: 12, marginBottom: 15, fontSize: 15, backgroundColor: COLORS.inputBg, color: COLORS.text },
  modalBtnRow: { flexDirection: 'row', gap: 10, marginTop: 10 },
  modalBtn: { flex: 1, padding: 14, borderRadius: 10, alignItems: 'center' },
  modalBtnText: { color: '#fff', fontWeight: 'bold', fontSize: 16 }
});
