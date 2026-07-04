import 'react-native-gesture-handler';
import 'react-native-url-polyfill/auto';
import React, { useState, useEffect, useCallback, useContext } from 'react';
import { Platform, View, StyleSheet, TouchableOpacity, Pressable, useColorScheme, AppState } from 'react-native';
import { NavigationContainer, createNavigationContainerRef } from '@react-navigation/native';
import { createStackNavigator } from '@react-navigation/stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { Ionicons } from '@expo/vector-icons';
import FinanceScreen from './src/screens/FinanceScreen';
import LoginScreen from './src/screens/LoginScreen';
import DashboardScreen from './src/screens/DashboardScreen';
import StaffHistoryScreen from './src/screens/StaffHistoryScreen';
import StaffManagementScreen from './src/screens/StaffManagementScreen';
import InventoryScreen from './src/screens/InventoryScreen';
import StaffCheckinScreen from './src/screens/StaffCheckinScreen';
import ShiftScheduleScreen from './src/screens/ShiftScheduleScreen';
import PayrollScreen from './src/screens/PayrollScreen';
import NotificationScreen from './src/screens/NotificationScreen';
import AttendanceReviewScreen from './src/screens/AttendanceReviewScreen';
import PwaInstallBanner from './src/components/PwaInstallBanner';
import WebNotificationBanner from './src/components/WebNotificationBanner';
import { supabase } from './src/services/supabaseClient';
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

// Floating Check-in Button Component
const CustomTabBarButton = ({
  children,
  onPress,
  style,
  buttonColor = '#e91e63',
  shadowColor = '#e91e63',
  tabBarColor = '#fff',
}) => (
  <View style={style}>
    <View style={[styles.floatingButtonNotch, { backgroundColor: tabBarColor }]} />
    <Pressable
      onPress={onPress}
      style={[styles.floatingButtonContainer, { shadowColor }]}
      android_ripple={{ color: 'rgba(255,255,255,0.3)', borderless: true, radius: 35 }}
    >
      <View style={[styles.floatingButtonDropTail, { backgroundColor: buttonColor }]} />
      <View style={[styles.floatingButton, { backgroundColor: buttonColor }]}>
        <View style={styles.floatingButtonIcon}>
          {children}
        </View>
        <View style={styles.floatingButtonShine} />
      </View>
    </Pressable>
  </View>
);

const Stack = createStackNavigator();
const Tab = createBottomTabNavigator();
const navigationRef = createNavigationContainerRef();

const navigateFromNotificationData = (data = {}) => {
  if (!navigationRef.isReady()) return;

  const route = data?.route;
  if (route === 'Inventory') {
    navigationRef.navigate('Inventory');
    return;
  }
  if (route === 'Payroll') {
    navigationRef.navigate('Payroll');
    return;
  }
  if (route === 'Shifts') {
    navigationRef.navigate('Shifts');
    return;
  }
  if (route === 'ScheduleTab') {
    navigationRef.navigate('Dashboard', { screen: 'ScheduleTab' });
    return;
  }

  navigationRef.navigate('Notifications');
};

function MainTabs() {
  const {
    COLORS,
    isDarkMode,
    currentUser,
    attendanceHistory = [],
  } = useContext(AppContext);

  const today = getLocalDateKey();
  const hasOpenAttendance = Boolean(
    currentUser?.id && attendanceHistory.some((record) => {
      const recordUserId = record.user_id ?? record.userId ?? record.staff_id;
      const isCurrentUser = String(recordUserId) === String(currentUser.id);
      const isToday = record.date === today;
      const hasCheckedOut = Boolean(record.checkOut || record.check_out || record.check_out_at);
      return isCurrentUser && isToday && !hasCheckedOut;
    })
  );

  const checkActionLabel = hasOpenAttendance ? 'Check-out' : 'Check-in';
  const checkActionIcon = hasOpenAttendance ? 'log-out-outline' : 'log-in-outline';
  const checkActionColor = hasOpenAttendance ? COLORS.danger : COLORS.accent;

  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        headerShown: false,
        tabBarIcon: ({ focused, color, size }) => {
          let iconName;
          if (route.name === 'HomeTab') {
            iconName = focused ? 'home' : 'home-outline';
          } else if (route.name === 'ScheduleTab') {
            iconName = focused ? 'calendar' : 'calendar-outline';
          }
          return <Ionicons name={iconName} size={size} color={color} />;
        },
        tabBarActiveTintColor: isDarkMode ? COLORS.primary : '#e91e63',
        tabBarInactiveTintColor: COLORS.textMuted,
        tabBarStyle: [
          styles.tabBar,
          {
            backgroundColor: COLORS.card,
            borderTopColor: COLORS.border,
            shadowOpacity: isDarkMode ? 0.35 : 0.12,
          },
        ],
        tabBarLabelStyle: styles.tabBarLabel,
      })}
    >
      <Tab.Screen name="HomeTab" component={DashboardScreen} options={{ title: 'Trang Chủ' }} />

      {/* Nút Chấm Công Nổi */}
      <Tab.Screen
        name="StaffCheckin"
        component={StaffCheckinScreen}
        options={{
          title: checkActionLabel,
          tabBarLabel: () => null,
          tabBarAccessibilityLabel: checkActionLabel,
          tabBarIcon: () => (
            <Ionicons name={checkActionIcon} size={32} color="#fff" />
          ),
          tabBarButton: (props) => (
            <CustomTabBarButton
              {...props}
              buttonColor={checkActionColor}
              shadowColor={checkActionColor}
              tabBarColor={COLORS.card}
            />
          )
        }}
      />

      <Tab.Screen name="ScheduleTab" component={ShiftScheduleScreen} options={{ title: 'Lịch Làm' }} />
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

  const [themeMode, setThemeMode] = useState('system');
  const isDarkMode = themeMode === 'system' ? colorScheme === 'dark' : themeMode === 'dark';
  const COLORS = isDarkMode ? THEMES.dark : THEMES.light;

  const [storeList, setStoreList] = useState([]);
  const [selectedStoreId, setSelectedStoreId] = useState(1);
  const [staffList, setStaffList] = useState([]);
  const [currentUser, setCurrentUser] = useState(null);
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

  const refreshData = useCallback(async () => {
    setIsDataLoading(true);
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

      setStoreList(tableData.stores || []);
      setStaffList((tableData.users || []).map(normalizeUser));
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
      setIsDataLoading(false);
    }
  }, []);

  useEffect(() => {
    refreshData();

    // Subscribe to ALL real-time changes on the database
    const channel = supabase.channel('global-db-changes')
      .on('postgres_changes', { event: '*', schema: 'public' }, () => {
        refreshData();
      })
      .subscribe();

    return () => {
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

    // iOS PWA: dùng visibilitychange vì AppState không fire trên web
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
    const unsubscribe = observeNotificationResponses(navigateFromNotificationData);

    getLastNotificationData().then((data) => {
      if (data) {
        setTimeout(() => navigateFromNotificationData(data), 600);
      }
    });

    // Nhận message từ Service Worker khi bấm notification → navigate
    const handleSwMessage = (event) => {
      if (event.data?.type === 'THECOC_NAVIGATE' && event.data?.route) {
        setTimeout(() => navigateFromNotificationData({ route: event.data.route }), 300);
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
  }, []);

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
    <AppContext.Provider value={{
      staffList, setStaffList,
      storeList, setStoreList,
      selectedStoreId, setSelectedStoreId,
      currentUser, setCurrentUser,
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
          <NavigationContainer ref={navigationRef}>
            <Stack.Navigator initialRouteName="Login" screenOptions={{ headerShown: false }}>
              <Stack.Screen name="Login" component={LoginScreen} />
              <Stack.Screen name="Finance" component={FinanceScreen} />
              <Stack.Screen name="Dashboard" component={MainTabs} />
              <Stack.Screen name="StaffHistory" component={StaffHistoryScreen} />
              <Stack.Screen name="StaffManagement" component={StaffManagementScreen} />
              <Stack.Screen name="Inventory" component={InventoryScreen} />
              <Stack.Screen name="StaffCheckin" component={StaffCheckinScreen} />
              <Stack.Screen name="ShiftSchedule" component={ShiftScheduleScreen} />
              <Stack.Screen name="Payroll" component={PayrollScreen} />
              <Stack.Screen name="AttendanceReview" component={AttendanceReviewScreen} />
              <Stack.Screen name="Notifications" component={NotificationScreen} />
              <Stack.Screen name="Shifts" component={require('./src/screens/ShiftScreen').default} />
            </Stack.Navigator>
          </NavigationContainer>
        </View>
        <PwaInstallBanner COLORS={COLORS} isDarkMode={isDarkMode} />
        <WebNotificationBanner currentUser={currentUser} COLORS={COLORS} isDarkMode={isDarkMode} />
      </View>
    </AppContext.Provider>
  );
}

const styles = StyleSheet.create({
  webContainer: {
    flex: 1,
    height: Platform.OS === 'web' ? '100vh' : '100%',
    backgroundColor: '#fff',
  },
  webWrapper: {
    flex: 1,
    width: '100%',
    backgroundColor: '#fff',
  },
  tabBar: {
    // iOS native: 88px. iOS PWA (Platform.OS=web): cần safe-area bottom.
    // Android/web: 64px chuẩn
    height: Platform.OS === 'ios' ? 88 : Platform.OS === 'web' ? 76 : 64,
    paddingTop: 6,
    paddingBottom: Platform.OS === 'ios' ? 24 : Platform.OS === 'web' ? 16 : 8,
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
    top: -33,
    justifyContent: 'center',
    alignItems: 'center',
    width: 82,
    height: 86,
    borderRadius: 41,
    elevation: 8,
    shadowColor: '#e91e63',
    shadowOpacity: 0.34,
    shadowOffset: { width: 0, height: 8 },
    shadowRadius: 10,
    overflow: 'visible',
  },
  floatingButtonNotch: {
    position: 'absolute',
    top: -34,
    alignSelf: 'center',
    width: 94,
    height: 56,
    borderRadius: 47,
    opacity: 0.96,
    zIndex: -1,
  },
  floatingButton: {
    position: 'absolute',
    top: 0,
    width: 62,
    height: 62,
    borderRadius: 31,
    backgroundColor: '#e91e63',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 2,
  },
  floatingButtonDropTail: {
    position: 'absolute',
    top: 44,
    width: 34,
    height: 34,
    borderBottomLeftRadius: 18,
    borderBottomRightRadius: 18,
    borderTopLeftRadius: 12,
    borderTopRightRadius: 12,
    transform: [{ scaleX: 0.92 }],
    zIndex: 1,
  },
  floatingButtonIcon: {
    zIndex: 3,
    marginTop: -3,
  },
  floatingButtonShine: {
    position: 'absolute',
    top: 9,
    left: 16,
    width: 18,
    height: 8,
    borderRadius: 8,
    backgroundColor: 'rgba(255,255,255,0.22)',
    transform: [{ rotate: '-18deg' }],
  },
});
