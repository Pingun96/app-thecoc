import React, { useContext, useState, useEffect } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, Image, Dimensions, ActivityIndicator, Modal, TextInput, Platform } from 'react-native';
import { Alert } from '../utils/alert';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { AppContext } from '../context/AppContext';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Updates from 'expo-updates';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { getLocalDateKey, isDateInCurrentMonth } from '../utils/dateTime';
import { supabase } from '../services/supabaseClient';
import SkeletonLoader from '../components/SkeletonLoader';

const { width } = Dimensions.get('window');
const APP_GRID_COLUMNS = 4;
const APP_GRID_MAX_WIDTH = 520;
const APP_GRID_GAP = 10;
const WEB_HEADER_TOP_PADDING = 15;

const useWebSafeAreaTop = () => {
  const [safeTop, setSafeTop] = useState(0);

  React.useEffect(() => {
    if (Platform.OS !== 'web' || typeof window === 'undefined' || typeof document === 'undefined') return undefined;

    const readSafeTop = () => {
      const raw = window
        .getComputedStyle(document.documentElement)
        .getPropertyValue('--sat')
        .trim();
      const parsed = Number.parseFloat(raw || '0');
      setSafeTop(Number.isFinite(parsed) ? Math.min(Math.max(parsed, 0), 60) : 0);
    };

    readSafeTop();
    window.addEventListener('resize', readSafeTop);
    window.addEventListener('orientationchange', readSafeTop);
    window.visualViewport?.addEventListener('resize', readSafeTop);

    return () => {
      window.removeEventListener('resize', readSafeTop);
      window.removeEventListener('orientationchange', readSafeTop);
      window.visualViewport?.removeEventListener('resize', readSafeTop);
    };
  }, []);

  return safeTop;
};

export default function DashboardScreen({ navigation }) {
  const insets = useSafeAreaInsets();
  const webSafeTop = useWebSafeAreaTop();
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
    isDataLoading,
    COLORS,
    isDarkMode,
    themeMode,
    toggleThemeMode,
  } = useContext(AppContext);
  const [isCheckingUpdate, setIsCheckingUpdate] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);

  const getGreeting = () => {
    const hour = new Date().getHours();
    if (hour < 12) return 'ChÃ o buá»•i sÃ¡ng';
    if (hour < 18) return 'ChÃ o buá»•i chiá»u';
    return 'ChÃ o buá»•i tá»‘i';
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
  const headerTopPadding = Platform.OS === 'web'
    ? Math.max(webSafeTop + 10, WEB_HEADER_TOP_PADDING)
    : Math.max(insets.top + 10, 20);

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
    if (Platform.OS === 'web') {
      setIsCheckingUpdate(true);
      if (typeof window !== 'undefined') {
        window.location.reload();
      }
      return;
    }
    
    try {
      setIsCheckingUpdate(true);
      const update = await Updates.checkForUpdateAsync();
      if (update.isAvailable) {
        Alert.alert('CÃ³ báº£n cáº­p nháº­t má»›i!', 'Äang tiáº¿n hÃ nh táº£i xuá»‘ng...');
        await Updates.fetchUpdateAsync();
        Alert.alert('ThÃ nh cÃ´ng', 'Táº£i xong! App sáº½ khá»Ÿi Ä‘á»™ng láº¡i ngay.', [
          { text: 'OK', onPress: () => Updates.reloadAsync() }
        ]);
      } else {
        Alert.alert('ThÃ´ng bÃ¡o', 'Báº¡n Ä‘ang dÃ¹ng phiÃªn báº£n má»›i nháº¥t rá»“i!');
      }
    } catch (error) {
      Alert.alert('Lá»—i cáº­p nháº­t', error.message);
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
      Alert.alert('TÃ­nh nÄƒng nÃ y', 'TÃ i khoáº£n chá»§ cá»­a hÃ ng hiá»‡n táº¡i lÃ  tÄ©nh, khÃ´ng thay Ä‘á»•i Ä‘Æ°á»£c.');
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
        Alert.alert('ThÃ nh cÃ´ng', 'Cáº­p nháº­t thÃ´ng tin thÃ nh cÃ´ng!');
        setShowProfileModal(false);
      } else {
        setShowProfileModal(false);
      }
    } catch (e) {
      Alert.alert('Lá»—i', e.message);
    } finally {
      setIsSavingProfile(false);
    }
  };

  const isOwner = currentUser?.role === 'OWNER';
  const viewableStores = currentUser?.permissions?.viewable_stores || [];

  // Hiá»ƒn thá»‹ thanh chá»n store náº¿u lÃ  OWNER hoáº·c Ä‘Æ°á»£c cáº¥p quyá»n xem nhiá»u hÆ¡n 1 chi nhÃ¡nh
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

  // HÃ m kiá»ƒm tra quyá»n
  const hasPermission = (featureKey) => {
    if (currentUser?.role === 'OWNER') return true;

    const permissions = currentUser?.permissions || {};
    const hasExplicitPermissions = Object.keys(permissions).length > 0;

    // TÆ°Æ¡ng thÃ­ch tÃ i khoáº£n quáº£n lÃ½ cÅ© chÆ°a cÃ³ object permissions.
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
      alert('Báº¡n chÆ°a Ä‘Æ°á»£c cáº¥p quyá»n truy cáº­p tÃ­nh nÄƒng nÃ y!');
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
    const compactTitleMap = {
      cashier: 'Giao ca',
      inventory: 'Kho hÃ ng',
      payroll: 'Báº£ng lÆ°Æ¡ng',
      finance: 'TÃ i chÃ­nh',
    };
    const compactTitle = routeName === 'AttendanceReview'
      ? 'Äá»‘i chiáº¿u'
      : featureKey === 'hr'
        ? (currentUser?.role === 'STAFF' ? 'Cháº¥m cÃ´ng' : 'NhÃ¢n sá»±')
        : compactTitleMap[featureKey] || title;
    const iconColorMap = {
      cashier: '#16a34a',
      inventory: '#f97316',
      payroll: '#d97706',
      finance: '#7c3aed',
      hr: routeName === 'AttendanceReview' ? '#0d9488' : '#2563eb',
    };
    const safeIconColor = allowed ? (iconColor || iconColorMap[featureKey] || COLORS.primary) : '#9ca3af';

    return (
      <TouchableOpacity
        style={[styles.gridItem, !allowed && styles.gridItemDisabled]}
        activeOpacity={allowed ? 0.7 : 1}
        onPress={() => handleNav(featureKey, routeName, staffRouteName, fallbackAction)}
        accessibilityRole="button"
        accessibilityLabel={`${compactTitle}. ${subTitle}`}
      >
        <View style={[styles.gridIconBox, { backgroundColor: allowed ? bgColor : '#e5e7eb' }]}>
          {iconLib === 'Ionicons' ? (
            <Ionicons name={iconName} size={28} color={safeIconColor} />
          ) : (
            <MaterialCommunityIcons name={iconName} size={28} color={safeIconColor} />
          )}
        </View>
        <Text style={[styles.gridItemTitle, !allowed && {color: '#9ca3af'}]} numberOfLines={2}>
          {compactTitle}
        </Text>

        {!allowed && (
          <View style={styles.lockIcon}>
            <Ionicons name="lock-closed" size={12} color="#ef4444" />
          </View>
        )}
      </TouchableOpacity>
    );
  };

  return (
    <View style={styles.container}>
      {/* HEADER */}
      <View style={[styles.headerContainer, { paddingTop: headerTopPadding, backgroundColor: theme.headerBg, borderWidth: theme.borderWidth, borderColor: theme.borderColor, borderBottomWidth: theme.borderWidth > 0 ? theme.borderWidth : 0, borderTopWidth: 0, borderLeftWidth: 0, borderRightWidth: 0 }]}>
        <TouchableOpacity style={styles.headerProfile} onPress={() => { setNewAvatar(currentUser?.avatar_url || ''); setShowProfileModal(true); }}>
          <Image
            source={{ uri: currentUser?.avatar_url || (currentUser?.role === 'STAFF' ? 'https://i.pravatar.cc/100?img=33' : 'https://i.pravatar.cc/100?img=12') }}
            style={styles.avatar}
          />
          <View style={styles.headerTextContainer}>
            <Text style={[styles.greetingText, { color: theme.greetingColor }]}>{getGreeting()},</Text>
            <Text style={[styles.nameText, { color: theme.nameColor }]} numberOfLines={1}>
              {currentUser?.name || 'ThÃ nh viÃªn The Cá»‘c'}
            </Text>
            <Text style={[styles.roleText, { color: theme.roleColor }]}>
              {currentUser?.role === 'OWNER'
                ? 'Chá»§ cá»­a hÃ ng'
                : currentUser?.role === 'MANAGER'
                  ? 'Quáº£n lÃ½'
                  : 'NhÃ¢n viÃªn'}
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

      {/* CHá»ŒN CHI NHÃNH */}
      {canShowStoreSelector && (
        <View style={{ paddingHorizontal: 20, paddingTop: 15 }}>
          <Text style={{ fontSize: 14, fontWeight: 'bold', color: '#6b7280', marginBottom: 10 }}>Dá»¯ liá»‡u hiá»ƒn thá»‹ cho:</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.storeSelector}>

            {/* Táº¤T Cáº¢ CHI NHÃNH CHá»ˆ DÃ€NH CHO OWNER */}
            {isOwner && (
              <TouchableOpacity
                style={[styles.storeChip, selectedStoreId === 'ALL' && styles.storeChipActive]}
                onPress={() => setSelectedStoreId('ALL')}
              >
                <Text style={[styles.storeChipText, selectedStoreId === 'ALL' && styles.storeChipTextActive]}>Táº¥t cáº£ Chi nhÃ¡nh</Text>
              </TouchableOpacity>
            )}

            {/* CÃC CHI NHÃNH ÄÆ¯á»¢C PHÃ‰P XEM */}
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
          <Text style={{ color: '#991b1b', fontWeight: 'bold' }}>Lá»—i táº£i dá»¯ liá»‡u: {dataError}</Text>
          <Text style={{ color: '#991b1b', fontSize: 12 }}>Cháº¡m vÃ o Ä‘Ã¢y Ä‘á»ƒ thá»­ táº£i láº¡i.</Text>
        </TouchableOpacity>
      ) : null}

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scrollContent}>

        {/* QUICK STATS */}
        <Text style={styles.sectionTitle}>Tá»•ng quan {currentUser?.role === 'STAFF' ? 'cÃ¡ nhÃ¢n' : 'hÃ´m nay'}</Text>
        <View style={styles.statsRow}>
          {isDataLoading && staffList.length === 0 ? (
            <>
              <SkeletonLoader width={(width - 55) / 2} height={125} borderRadius={16} isDarkMode={isDarkMode} />
              <SkeletonLoader width={(width - 55) / 2} height={125} borderRadius={16} isDarkMode={isDarkMode} />
            </>
          ) : (
            <>
              <View style={styles.statCard}>
                <View style={[styles.iconBox, { backgroundColor: '#e3f2fd' }]}>
                  <Ionicons name={currentUser?.role === 'STAFF' ? "time" : "people"} size={24} color="#1976d2" />
                </View>
                <Text style={styles.statValue}>
                  {currentUser?.role === 'STAFF' ? totalMyHours.toFixed(1) + 'h' : activeStaffCount}
                </Text>
                <Text style={styles.statLabel}>
                  {currentUser?.role === 'STAFF' ? 'Tá»•ng giá» lÃ m' : 'NhÃ¢n sá»±'}
                </Text>
              </View>

              <View style={styles.statCard}>
                <View style={[styles.iconBox, { backgroundColor: '#fff3e0' }]}>
                  <MaterialCommunityIcons name="currency-usd" size={24} color="#ff9800" />
                </View>
                <Text style={styles.statValue}>
                  {currentUser?.role === 'STAFF' ? totalMyWage.toLocaleString() : todaysEstimatedCost.toLocaleString()}Ä‘
                </Text>
                <Text style={styles.statLabel}>
                  {currentUser?.role === 'STAFF' ? 'LÆ°Æ¡ng táº¡m tÃ­nh' : 'Chi phÃ­ lÆ°Æ¡ng'}
                </Text>
              </View>
            </>
          )}
        </View>

        {/* 2x2 GRID MENU */}
        <Text style={styles.sectionTitle}>TÃ­nh nÄƒng {currentUser?.role === 'STAFF' ? 'lÃ m viá»‡c' : 'quáº£n lÃ½'}</Text>
        <View style={styles.gridContainer}>
          {renderGridItem('Giao Ca & Doanh Thu', 'Quáº£n lÃ½ KÃ©t & Chá»‘t Ca', 'cash-register', 'Material', '#e8f5e9', 'cashier', 'Shifts', 'Shifts')}
          {renderGridItem('Kho HÃ ng', 'Tá»“n kho & YÃªu cáº§u', 'warehouse', 'Material', '#fff3e0', 'inventory', 'Inventory', 'Inventory')}
          {renderGridItem(currentUser?.role === 'STAFF' ? 'Cháº¥m CÃ´ng' : 'NhÃ¢n Sá»±', currentUser?.role === 'STAFF' ? 'Äá»‹nh vá»‹ GPS / Camera' : 'Há»“ sÆ¡ & PhÃ¢n quyá»n', currentUser?.role === 'STAFF' ? "scan-circle" : "id-card", 'Ionicons', '#e0f7fa', 'hr', 'StaffManagement', 'StaffCheckin')}
          {currentUser?.role !== 'STAFF' && renderGridItem('Äá»‘i Chiáº¿u CÃ´ng', 'Lá»‹ch lÃ m vs cháº¥m cÃ´ng', 'clipboard-check-outline', 'Material', '#dcfce7', 'hr', 'AttendanceReview', 'AttendanceReview')}
          {renderGridItem('Báº£ng LÆ°Æ¡ng', 'Báº£ng lÆ°Æ¡ng chi tiáº¿t', 'wallet-outline', 'Material', '#fff8e1', 'payroll', 'Payroll', 'Payroll')}
          {renderGridItem('TÃ i ChÃ­nh', 'Doanh thu & Lá»£i nhuáº­n', 'chart-line', 'Material', '#ede9fe', 'finance', 'Finance', 'Finance')}
        </View>

      </ScrollView>

      {/* MODAL Cáº¬P NHáº¬T Há»’ SÆ  */}
      <Modal visible={showProfileModal} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Cáº­p Nháº­t CÃ¡ NhÃ¢n</Text>

            <Text style={styles.modalLabel}>Äá»•i máº­t kháº©u má»›i (Máº·c Ä‘á»‹nh: 123):</Text>
            <TextInput
              style={styles.modalInput}
              secureTextEntry
              placeholder="Bá» trá»‘ng náº¿u khÃ´ng Ä‘á»•i"
              value={newPassword}
              onChangeText={setNewPassword}
            />

            <Text style={styles.modalLabel}>Link áº£nh Ä‘áº¡i diá»‡n (Avatar URL):</Text>
            <TextInput
              style={styles.modalInput}
              placeholder="https://..."
              value={newAvatar}
              onChangeText={setNewAvatar}
            />

            <View style={styles.modalBtnRow}>
              <TouchableOpacity style={[styles.modalBtn, {backgroundColor: '#e5e7eb'}]} onPress={() => setShowProfileModal(false)}>
                <Text style={[styles.modalBtnText, {color: '#4b5563'}]}>Há»§y</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.modalBtn, {backgroundColor: '#1976d2'}]} onPress={handleUpdateProfile} disabled={isSavingProfile}>
                {isSavingProfile ? <ActivityIndicator color="#fff" size="small"/> : <Text style={styles.modalBtnText}>LÆ°u</Text>}
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
  statCard: { backgroundColor: COLORS.card, width: (width - 55) / 2, padding: 15, borderRadius: 16, elevation: 2, shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 5, alignItems: 'center', justifyContent: 'center', minHeight: 125 },
  iconBox: { width: 44, height: 44, borderRadius: 12, justifyContent: 'center', alignItems: 'center', marginBottom: 10, alignSelf: 'center' },
  statValue: { fontSize: 18, fontWeight: 'bold', color: COLORS.text, textAlign: 'center' },
  statLabel: { fontSize: 12, color: COLORS.textMuted, textAlign: 'center', marginTop: 3 },
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
    width: 58,
    height: 58,
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
