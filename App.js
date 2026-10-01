import 'react-native-gesture-handler';
import 'react-native-url-polyfill/auto';
import React, { useState, useEffect, useCallback, useContext, useRef } from 'react';
import { Alert, Platform, View, Text, TouchableOpacity, StyleSheet, useColorScheme, AppState } from 'react-native';
import { NavigationContainer, createNavigationContainerRef } from '@react-navigation/native';
import { createStackNavigator } from '@react-navigation/stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import FinanceScreen from './src/screens/FinanceScreen';
import LoginScreen from './src/screens/LoginScreen';
import DashboardScreen from './src/screens/DashboardScreen';
import StaffHistoryScreen from './src/screens/StaffHistoryScreen';
import StaffManagementScreen from './src/screens/StaffManagementScreen';
import InventoryScreen from './src/screens/InventoryScreen';
import CentralWarehouseScreen from './src/screens/CentralWarehouseScreen';
import StaffCheckinScreen from './src/screens/StaffCheckinScreen';
import ShiftScheduleScreen from './src/screens/ShiftScheduleScreen';
import PayrollScreen from './src/screens/PayrollScreen';
import NotificationScreen from './src/screens/NotificationScreen';
import AttendanceReviewScreen from './src/screens/AttendanceReviewScreen';
import AttendanceCorrectionScreen from './src/screens/AttendanceCorrectionScreen';
import PwaInstallBanner from './src/components/PwaInstallBanner';
import WebNotificationBanner from './src/components/WebNotificationBanner';
import { supabase, clearAuthSession, setAuthFailureHandler } from './src/services/supabaseClient';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import {
  getLastNotificationData,
  observeNotificationResponses,
  registerForPushNotificationsAsync,
  savePushTokenToDB,
  showLocalNotification,
} from './src/services/NotificationService';
import {
  normalizeAttendance,
  normalizeInventoryItem,
  normalizeInventoryLog,
  normalizeInventoryRequest,
  normalizeUser,
  normalizeShiftSwap,
} from './src/services/dataMappers';
import { AppContext } from './src/context/AppContext';
import { getLocalDateKey } from './src/utils/dateTime';
import { setupPwaExperience } from './src/services/pwaService';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { canAccessRoute } from './src/utils/permissions';

const Stack = createStackNavigator();
const Tab = createBottomTabNavigator();
const navigationRef = createNavigationContainerRef();

const navigateFromNotificationData = (data = {}, currentUser = null) => {
  if (!navigationRef.isReady()) return;

  const route = data?.route;
  if (route === 'Inventory') {
    if (!canAccessRoute(currentUser, 'Inventory')) return;
    navigationRef.navigate('Inventory');
    return;
  }
  if (route === 'Payroll') {
    if (!canAccessRoute(currentUser, 'Payroll')) return;
    navigationRef.navigate('Payroll');
    return;
  }
  if (route === 'Shifts') {
    if (!canAccessRoute(currentUser, 'Shifts')) return;
    navigationRef.navigate('Shifts');
    return;
  }
  if (route === 'ScheduleTab') {
    if (!currentUser) return;
    navigationRef.navigate('Dashboard', { screen: 'ScheduleTab' });
    return;
  }

  if (currentUser) navigationRef.navigate('Notifications');
};

function ProtectedScreen({ component: Component, routeName, navigation, ...props }) {
  const { currentUser, COLORS } = useContext(AppContext);

  useEffect(() => {
    if (!currentUser) navigation.replace('Login');
  }, [currentUser, navigation]);

  if (!currentUser) return null;
  if (!canAccessRoute(currentUser, routeName)) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 28, backgroundColor: COLORS.bg }}>
        <Text style={{ fontSize: 42 }}>🔒</Text>
        <Text style={{ color: COLORS.text, fontSize: 18, fontWeight: '800', marginTop: 12, textAlign: 'center' }}>Bạn chưa được cấp quyền truy cập</Text>
        <Text style={{ color: COLORS.textMuted, marginTop: 8, textAlign: 'center' }}>Quyền của tài khoản vừa được kiểm tra lại. Hãy liên hệ Chủ quán nếu bạn cần sử dụng chức năng này.</Text>
        <TouchableOpacity onPress={() => navigation.replace('Dashboard')} style={{ marginTop: 18, backgroundColor: COLORS.primary, paddingHorizontal: 18, paddingVertical: 11, borderRadius: 10 }}>
          <Text style={{ color: '#fff', fontWeight: '800' }}>Về trang chủ</Text>
        </TouchableOpacity>
      </View>
    );
  }
  return <Component navigation={navigation} {...props} />;
}

function MainTabs() {
  return (
    <Tab.Navigator
      screenOptions={{
        headerShown: false,
        // Navigation is provided by the feature buttons on the Dashboard.
        // Removing the native tab bar eliminates iPhone PWA safe-area overlays.
        tabBarStyle: { display: 'none' },
      }}
    >
      <Tab.Screen name="HomeTab" component={DashboardScreen} options={{ title: 'Trang Chủ' }} />
      <Tab.Screen name="StaffCheckin" component={StaffCheckinScreen} options={{ title: 'Chấm công' }} />
      <Tab.Screen name="ScheduleTab" component={ShiftScheduleScreen} options={{ title: 'Lịch làm' }} />
    </Tab.Navigator>
  );
}
const THEMES = {
  light: {
    bg: '#F8FAFC',
    card: '#FFFFFF',
    text: '#0F172A',
    textMuted: '#64748B',
    border: '#E2E8F0',
    primary: '#166534',
    accent: '#10B981',
    danger: '#EF4444',
    inputBg: '#f8fafc',
    inputBorder: '#cbd5e1',
    inputText: '#172033',
    headerBg: '#1f2937',
  },
  dark: {
    bg: '#0F172A',
    card: '#1E293B',
    text: '#F8FAFC',
    textMuted: '#94A3B8',
    border: '#334155',
    primary: '#4ADE80',
    accent: '#10B981',
    danger: '#F87171',
    inputBg: '#1e293b',
    inputBorder: '#475569',
    inputText: '#f8fafc',
    headerBg: '#090d16',
  }
};

export default function App() {
  const colorScheme = useColorScheme();

  useEffect(() => {
    setupPwaExperience();
  }, []);

  const [themeMode, setThemeMode] = useState('light');
  const isDarkMode = false; // Bỏ hoàn toàn chế độ dark mode
  const COLORS = THEMES.light;

  const [storeList, setStoreList] = useState([]);
  const [selectedStoreId, setSelectedStoreId] = useState(1);
  const [staffList, setStaffList] = useState([]);
  const [currentUser, setCurrentUser] = useState(null);
  const [navigationEpoch, setNavigationEpoch] = useState(0);
  const [inventoryItems, setInventoryItems] = useState([]);
  const [inventoryLogs, setInventoryLogs] = useState([]);
  const [inventoryTickets, setInventoryTickets] = useState([]);
  const [shifts, setShifts] = useState([]);
  const [attendanceHistory, setAttendanceHistory] = useState([]);
  const [shiftRegistrations, setShiftRegistrations] = useState([]);
  const [shiftSwaps, setShiftSwaps] = useState([]);
  const [payrollAdjustments, setPayrollAdjustments] = useState([]);
  const [payrollApprovals, setPayrollApprovals] = useState([]);
  const [isDataLoading, setIsDataLoading] = useState(true);
  const [dataError, setDataError] = useState('');
  // Background refresh must not make the login form look like it is loading again.
  const hasLoadedDataRef = useRef(false);

  useEffect(() => {
    AsyncStorage.getItem('thecocThemeMode').then((savedMode) => {
      if (['light', 'dark', 'system'].includes(savedMode)) {
        setThemeMode(savedMode);
      }
    }).catch(() => {});
  }, []);

  const changeThemeMode = useCallback(async (nextMode) => {
    const safeMode = ['light', 'dark', 'system'].includes(nextMode) ? nextMode : 'system';
    setThemeMode(safeMode);
    try {
      await AsyncStorage.setItem('thecocThemeMode', safeMode);
    } catch (error) {
      console.log('Khong the luu che do giao dien:', error);
    }
  }, []);

  const toggleThemeMode = useCallback(() => {
    changeThemeMode(isDarkMode ? 'light' : 'dark');
  }, [changeThemeMode, isDarkMode]);

  const logout = useCallback(async () => {
    try {
      await AsyncStorage.removeItem('userPhone');
      await clearAuthSession();
    } finally {
      setCurrentUser(null);
      // Recreate the root navigator so nested tabs cannot retain a stale screen after logout.
      setNavigationEpoch((current) => current + 1);
    }
  }, []);

  useEffect(() => {
    setAuthFailureHandler(() => {
      setCurrentUser(null);
      setNavigationEpoch((current) => current + 1);
      Alert.alert('Phiên đăng nhập đã hết hạn', 'Vui lòng đăng nhập lại để tiếp tục.');
    });
    return () => setAuthFailureHandler(null);
  }, []);

  const refreshData = useCallback(async () => {
    if (!currentUser) {
      hasLoadedDataRef.current = true;
      setDataError('');
      setIsDataLoading(false);
      return;
    }
    if (!hasLoadedDataRef.current) setIsDataLoading(true);
    setDataError('');

    try {
      const tables = [
        { key: 'stores', query: supabase.from('stores').select('*'), critical: true },
        { key: 'users', query: supabase.from('users').select('*'), critical: true },
        { key: 'inventory_items', query: supabase.from('inventory_items').select('*') },
        { key: 'inventory_logs', query: supabase.from('inventory_logs').select('*') },
        { key: 'inventory_tickets', query: supabase.from('inventory_tickets').select('*') },
        { key: 'shifts', query: supabase.from('shifts').select('*') },
        { key: 'attendance_logs', query: supabase.from('attendance_logs').select('*') },
        { key: 'shift_registrations', query: supabase.from('shift_registrations').select('*') },
        { key: 'payroll_adjustments', query: supabase.from('payroll_adjustments').select('*') },
        { key: 'payroll_approvals', query: supabase.from('payroll_approvals').select('*') },
        { key: 'shift_swaps', query: supabase.from('shift_swaps').select('*') },
      ];

      const tableResults = await Promise.all(tables.map(async (table) => {
        const result = await table.query;
        return { ...table, ...result, data: result.data || [] };
      }));

      const failedCriticalResult = tableResults.find((result) => result.critical && result.error);
      if (failedCriticalResult?.error) throw failedCriticalResult.error;

      const optionalErrors = tableResults.filter((result) => !result.critical && result.error);
      if (optionalErrors.length) {
        console.log(
          'Một số bảng phụ chưa tải được, app vẫn tiếp tục:',
          optionalErrors.map((result) => `${result.key}: ${result.error?.message}`).join(' | ')
        );
      }

      const tableData = tableResults.reduce((acc, result) => {
        acc[result.key] = result.error ? [] : result.data;
        return acc;
      }, {});

      const normalizedUsers = (tableData.users || []).map(normalizeUser);
      setStoreList(tableData.stores || []);
      setStaffList(normalizedUsers);
      const freshCurrentUser = normalizedUsers.find((user) => String(user.id) === String(currentUser.id));
      if (freshCurrentUser) {
        setCurrentUser((previous) => {
          if (!previous) return previous;
          const oldAccessState = JSON.stringify([previous.role, previous.store_id, previous.permissions || {}, previous.hasAppAccess]);
          const newAccessState = JSON.stringify([freshCurrentUser.role, freshCurrentUser.store_id, freshCurrentUser.permissions || {}, freshCurrentUser.hasAppAccess]);
          return oldAccessState === newAccessState ? previous : { ...previous, ...freshCurrentUser };
        });
      }
      setInventoryItems((tableData.inventory_items || []).map(normalizeInventoryItem));
      setInventoryLogs((tableData.inventory_logs || []).map(normalizeInventoryLog));
      setInventoryTickets(tableData.inventory_tickets || []);
      setShifts(tableData.shifts || []);
      setAttendanceHistory((tableData.attendance_logs || []).map(normalizeAttendance));
      setShiftRegistrations(tableData.shift_registrations || []);
      setPayrollAdjustments(tableData.payroll_adjustments || []);
      setPayrollApprovals(tableData.payroll_approvals || []);
      setShiftSwaps((tableData.shift_swaps || []).map(normalizeShiftSwap));
    } catch (error) {
      console.error('Lỗi khi tải dữ liệu từ Supabase:', error);
      setDataError(error?.message || 'Không thể tải dữ liệu. Vui lòng kiểm tra kết nối.');
    } finally {
      hasLoadedDataRef.current = true;
      setIsDataLoading(false);
    }
  }, [currentUser]);

  useEffect(() => {
    refreshData();

    // Subscribe to ALL real-time changes on the database
    const refreshTimer = setInterval(refreshData, 30000);
    const channel = supabase.channel('global-db-changes')
      .on('postgres_changes', { event: '*', schema: 'public' }, () => {
        refreshData();
      })
      .subscribe();

    return () => {
      clearInterval(refreshTimer);
      supabase.removeChannel(channel);
    };
  }, [refreshData]);

  // ===== APPSTATE: Tự refresh data khi mở lại app từ background =====
  useEffect(() => {
    let lastActiveTime = Date.now();
    const REFRESH_THRESHOLD_MS = 30 * 1000; // 30 giây

    const handleAppStateChange = (nextState) => {
      if (nextState === 'active') {
        const elapsed = Date.now() - lastActiveTime;
        if (elapsed > REFRESH_THRESHOLD_MS) {
          refreshData();
        }
        lastActiveTime = Date.now();
      } else {
        lastActiveTime = Date.now();
      }
    };

    const subscription = AppState.addEventListener('change', handleAppStateChange);

    // Web PWA: visibilitychange covers browser/app resume events.
    const handleVisibilityChange = () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'visible') {
        const elapsed = Date.now() - lastActiveTime;
        if (elapsed > REFRESH_THRESHOLD_MS) {
          refreshData();
        }
        lastActiveTime = Date.now();
      } else {
        lastActiveTime = Date.now();
      }
    };

    if (Platform.OS === 'web' && typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', handleVisibilityChange);
    }

    return () => {
      subscription?.remove?.();
      if (Platform.OS === 'web' && typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', handleVisibilityChange);
      }
    };
  }, [refreshData]);

  useEffect(() => {
    if (!storeList.length) return;
    const selectedStoreExists = storeList.some((store) => store.id === selectedStoreId);
    if (!selectedStoreExists && selectedStoreId !== 'ALL') {
      setSelectedStoreId(storeList[0].id);
    }
  }, [storeList, selectedStoreId]);

  useEffect(() => {
    const handleForegroundPush = (e) => {
      if (e.detail) {
        Alert.alert(e.detail.title || 'Thông báo mới', e.detail.body || '');
      }
    };
    if (Platform.OS === 'web' && typeof window !== 'undefined') {
      window.addEventListener('onForegroundPush', handleForegroundPush);
    }
    return () => {
      if (Platform.OS === 'web' && typeof window !== 'undefined') {
        window.removeEventListener('onForegroundPush', handleForegroundPush);
      }
    };
  }, []);

  useEffect(() => {
    const unsubscribe = observeNotificationResponses((data) => navigateFromNotificationData(data, currentUser));

    getLastNotificationData().then((data) => {
      if (data) {
        setTimeout(() => navigateFromNotificationData(data, currentUser), 600);
      }
    });

    // Nhận message từ Service Worker khi bấm notification → navigate
    const handleSwMessage = (event) => {
      if (event.data?.type === 'THECOC_NAVIGATE' && event.data?.route) {
        setTimeout(() => navigateFromNotificationData({ route: event.data.route }, currentUser), 300);
      }
    };
    if (Platform.OS === 'web' && typeof navigator !== 'undefined' && navigator.serviceWorker) {
      navigator.serviceWorker.addEventListener('message', handleSwMessage);
    }

    return () => {
      unsubscribe();
      if (Platform.OS === 'web' && typeof navigator !== 'undefined' && navigator.serviceWorker) {
        navigator.serviceWorker.removeEventListener('message', handleSwMessage);
      }
    };
  }, [currentUser]);

  // Đăng ký Push Notification và Realtime Notification khi có currentUser
  useEffect(() => {
    if (!currentUser) return undefined;

    registerForPushNotificationsAsync({
      prompt: Platform.OS !== 'web',
      externalUserId: currentUser.id,
      storeId: currentUser.store_id,
    }).then((token) => {
      if (token) {
        savePushTokenToDB(currentUser.id, token, { storeId: currentUser.store_id });
      }
    });

    // Bật tính năng In-App Realtime Notification (Supabase)
    const channel = supabase
      .channel(`realtime-notifications-${currentUser.id}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'notifications',
          filter: `user_id=eq.${currentUser.id}`,
        },
        (payload) => {
          const { title, body, data, route } = payload.new;
          const notificationData = data || { route };

          showLocalNotification(title, body, notificationData);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [currentUser]);

  return (
    <SafeAreaProvider initialMetrics={null}>
    <AppContext.Provider value={{
      staffList, setStaffList,
      storeList, setStoreList,
      selectedStoreId, setSelectedStoreId,
      currentUser, setCurrentUser, logout,
      attendanceHistory, setAttendanceHistory,
      shiftRegistrations, setShiftRegistrations,
      inventoryItems, setInventoryItems,
      inventoryLogs, setInventoryLogs,
      inventoryTickets, setInventoryTickets,
      shifts, setShifts,
      payrollAdjustments, setPayrollAdjustments,
      payrollApprovals, setPayrollApprovals,
      shiftSwaps, setShiftSwaps,
      isDataLoading, dataError, refreshData,
      isDarkMode, COLORS,
      themeMode, setThemeMode: changeThemeMode, toggleThemeMode
    }}>
      <View style={[styles.webContainer, { backgroundColor: COLORS.bg }]}>
        <View style={[styles.webWrapper, { backgroundColor: COLORS.bg }]}>
          <NavigationContainer key={`thecoc-nav-${navigationEpoch}`} ref={navigationRef}>
            <Stack.Navigator initialRouteName="Login" screenOptions={{ headerShown: false }}>
              <Stack.Screen name="Login" component={LoginScreen} />
              <Stack.Screen name="Finance">{(props) => <ProtectedScreen {...props} routeName="Finance" component={FinanceScreen} />}</Stack.Screen>
              <Stack.Screen name="Dashboard">{(props) => <ProtectedScreen {...props} routeName="Dashboard" component={MainTabs} />}</Stack.Screen>
              <Stack.Screen name="StaffHistory">{(props) => <ProtectedScreen {...props} routeName="StaffHistory" component={StaffHistoryScreen} />}</Stack.Screen>
              <Stack.Screen name="StaffManagement">{(props) => <ProtectedScreen {...props} routeName="StaffManagement" component={StaffManagementScreen} />}</Stack.Screen>
              <Stack.Screen name="Inventory">{(props) => <ProtectedScreen {...props} routeName="Inventory" component={InventoryScreen} />}</Stack.Screen>
              <Stack.Screen name="CentralWarehouse">{(props) => <ProtectedScreen {...props} routeName="CentralWarehouse" component={CentralWarehouseScreen} />}</Stack.Screen>
              <Stack.Screen name="StaffCheckin">{(props) => <ProtectedScreen {...props} routeName="StaffCheckin" component={StaffCheckinScreen} />}</Stack.Screen>
              <Stack.Screen name="ShiftSchedule">{(props) => <ProtectedScreen {...props} routeName="ShiftSchedule" component={ShiftScheduleScreen} />}</Stack.Screen>
              <Stack.Screen name="Payroll">{(props) => <ProtectedScreen {...props} routeName="Payroll" component={PayrollScreen} />}</Stack.Screen>
              <Stack.Screen name="AttendanceReview">{(props) => <ProtectedScreen {...props} routeName="AttendanceReview" component={AttendanceReviewScreen} />}</Stack.Screen>
              <Stack.Screen name="AttendanceCorrection">{(props) => <ProtectedScreen {...props} routeName="AttendanceCorrection" component={AttendanceCorrectionScreen} />}</Stack.Screen>
              <Stack.Screen name="Notifications">{(props) => <ProtectedScreen {...props} routeName="Notifications" component={NotificationScreen} />}</Stack.Screen>
              <Stack.Screen name="Shifts">{(props) => <ProtectedScreen {...props} routeName="Shifts" component={require('./src/screens/ShiftScreen').default} />}</Stack.Screen>
            </Stack.Navigator>
          </NavigationContainer>
        </View>
        <PwaInstallBanner COLORS={COLORS} isDarkMode={isDarkMode} />
        <WebNotificationBanner currentUser={currentUser} COLORS={COLORS} isDarkMode={isDarkMode} />
      </View>
    </AppContext.Provider>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  webContainer: {
    flex: 1,
    height: '100%',
    backgroundColor: '#fff',
  },
  webWrapper: {
    flex: 1,
    width: '100%',
    backgroundColor: '#fff',
  },
  tabBar: {
    height: Platform.OS === 'ios' ? 88 : Platform.OS === 'web' ? 72 : 64,
    paddingTop: 6,
    paddingBottom: Platform.OS === 'ios' ? 24 : Platform.OS === 'web' ? 10 : 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    elevation: 14,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -4 },
    shadowRadius: 12,
  },
  tabBarLabel: {
    fontSize: 11,
    fontWeight: '700',
    marginTop: 2,
  },
  floatingButtonContainer: {
    top: -30,
    justifyContent: 'center',
    alignItems: 'center',
    width: 76,
    height: 76,
    borderRadius: 38,
    overflow: 'visible',
  },
  floatingButtonNotch: {
    position: 'absolute',
    top: -38,
    alignSelf: 'center',
    width: 90,
    height: 54,
    borderRadius: 45,
    opacity: 0.97,
    zIndex: -1,
  },
  floatingButtonRing: {
    position: 'absolute',
    width: 80,
    height: 80,
    borderRadius: 40,
    borderWidth: 3,
    top: -2,
  },
  floatingButton: {
    width: 66,
    height: 66,
    borderRadius: 33,
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 2,
  },
  floatingButtonInnerGlow: {
    position: 'absolute',
    top: 6,
    left: 6,
    right: 6,
    height: 22,
    borderRadius: 11,
  },
  floatingButtonIcon: {
    zIndex: 3,
  },
  floatingButtonShine: {
    position: 'absolute',
    top: 8,
    left: 14,
    width: 20,
    height: 7,
    borderRadius: 6,
    backgroundColor: 'rgba(255,255,255,0.30)',
    transform: [{ rotate: '-18deg' }],
  },
  floatingButtonLabel: {
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.3,
    marginTop: Platform.OS === 'web' ? 2 : Platform.OS === 'ios' ? 6 : 4,
    textTransform: 'uppercase',
  },
});
