import 'react-native-gesture-handler';
import 'react-native-url-polyfill/auto';
import React, { useState, useEffect, useCallback, useContext, useMemo, useRef } from 'react';
import { Alert, Platform, View, Text, StyleSheet, TouchableOpacity, Pressable, AppState, Animated } from 'react-native';
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
import CentralWarehouseScreen from './src/screens/CentralWarehouseScreen';
import StaffCheckinScreen from './src/screens/StaffCheckinScreen';
import ShiftScheduleScreen from './src/screens/ShiftScheduleScreen';
import PayrollScreen from './src/screens/PayrollScreen';
import NotificationScreen from './src/screens/NotificationScreen';
import AttendanceReviewScreen from './src/screens/AttendanceReviewScreen';
import PwaInstallBanner from './src/components/PwaInstallBanner';
import WebNotificationBanner from './src/components/WebNotificationBanner';
import { supabase } from './src/services/supabaseClient';
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
import { sendAttendanceExceptionReminders } from './src/services/attendanceReminderService';
import AsyncStorage from '@react-native-async-storage/async-storage';

// Floating Check-in Button Component
const CustomTabBarButton = ({
  children,
  onPress,
  style,
  buttonColor = '#10B981',
  shadowColor = '#10B981',
  tabBarColor = '#fff',
  label = '',
}) => {
  const scaleAnim = React.useRef(new Animated.Value(1)).current;

  const handlePressIn = () => {
    Animated.spring(scaleAnim, {
      toValue: 0.88,
      useNativeDriver: true,
      speed: 40,
      bounciness: 6,
    }).start();
  };

  const handlePressOut = () => {
    Animated.spring(scaleAnim, {
      toValue: 1,
      useNativeDriver: true,
      speed: 20,
      bounciness: 10,
    }).start();
  };

  return (
    <View style={[style, { alignItems: 'center' }]}>
      {/* Notch background behind the button */}
      <View style={[styles.floatingButtonNotch, {
        backgroundColor: tabBarColor,
        borderColor: `${buttonColor}1F`,
        shadowColor: buttonColor,
      }]} />

      <Animated.View style={{ transform: [{ scale: scaleAnim }] }}>
        <Pressable
          onPress={onPress}
          onPressIn={handlePressIn}
          onPressOut={handlePressOut}
          style={[styles.floatingButtonContainer, {
            shadowColor,
            shadowOpacity: 0.55,
            shadowOffset: { width: 0, height: 8 },
            shadowRadius: 16,
            elevation: 12,
          }]}
          android_ripple={{ color: 'rgba(255,255,255,0.3)', borderless: true, radius: 38 }}
        >
          {/* Outer glow ring */}
          <View style={[styles.floatingButtonRing, {
            borderColor: buttonColor,
            opacity: 0.25,
          }]} />
          {/* Main circle */}
          <View style={[
            styles.floatingButton,
            {
              backgroundColor: buttonColor,
              borderColor: buttonColor,
            },
          ]}>
            {/* Shine highlight */}
            <View style={styles.floatingButtonShine} />
            {/* Inner glow */}
            <View style={[styles.floatingButtonInnerGlow, { backgroundColor: 'rgba(255,255,255,0.15)' }]} />
            <View style={styles.floatingButtonIcon}>
              {children}
            </View>
          </View>
        </Pressable>
      </Animated.View>

      {/* Label below the button - absolute positioned to avoid offset */}
      {label ? (
        <Text style={[styles.floatingButtonLabel, {
          color: buttonColor,
          position: 'absolute',
          bottom: Platform.OS === 'web' ? 4 : -2,
          left: -30,
          right: -30,
          textAlign: 'center',
        }]}>{label}</Text>
      ) : null}
    </View>
  );
};


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
  if (route === 'AttendanceReview') {
    navigationRef.navigate('AttendanceReview');
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
        tabBarActiveTintColor: COLORS.primary,
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
            <Ionicons name={checkActionIcon} size={30} color="#fff" />
          ),
          tabBarButton: (props) => (
            <CustomTabBarButton
              {...props}
              buttonColor={checkActionColor}
              shadowColor={checkActionColor}
              tabBarColor={COLORS.card}
              label={checkActionLabel}
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
    bg: '#F3F7F5',
    card: '#FFFFFF',
    text: '#10231B',
    textMuted: '#61736B',
    border: '#D8E4DE',
    primary: '#137A4B',
    accent: '#0FA86B',
    danger: '#DC2626',
    inputBg: '#F8FBF9',
    inputBorder: '#C8D8D1',
    inputText: '#10231B',
    headerBg: '#E2F4EA',
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
  const realtimeRefreshTimerRef = useRef(null);

  useEffect(() => {
    setupPwaExperience();
    
    // Fix iOS PWA Push Notification Layout Shift Bug
    if (Platform.OS === 'web' && typeof window !== 'undefined') {
      const handleVisibilityChange = () => {
        if (document.visibilityState === 'visible') {
          setTimeout(() => window.scrollTo(0, 0), 100);
          setTimeout(() => window.scrollTo(0, 0), 500);
        }
      };
      document.addEventListener('visibilitychange', handleVisibilityChange);
      return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
    }
  }, []);

  const [themeMode, setThemeMode] = useState('light');
  const isDarkMode = false; // Bỏ hoàn toàn chế độ dark mode
  const COLORS = THEMES.light;

  const [storeList, setStoreList] = useState([]);
  const [selectedStoreId, setSelectedStoreId] = useState(1);
  const [staffList, setStaffList] = useState([]);
  const [currentUser, setCurrentUser] = useState(null);
  const [inventoryItems, setInventoryItems] = useState([]);
  const [inventoryLogs, setInventoryLogs] = useState([]);
  const [inventoryTickets, setInventoryTickets] = useState([]);
  const [shifts, setShifts] = useState([]);
  const [attendanceHistory, setAttendanceHistory] = useState([]);
  const [attendanceCorrectionLogs, setAttendanceCorrectionLogs] = useState([]);
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
      const today = new Date();
      const previousMonthStart = new Date(today.getFullYear(), today.getMonth() - 1, 1);
      const scheduleStart = new Date(today);
      scheduleStart.setDate(today.getDate() - 14);
      const scheduleEnd = new Date(today);
      scheduleEnd.setDate(today.getDate() + 45);
      const toDateKey = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
      const toMonthKey = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
      const previousMonthKey = toMonthKey(previousMonthStart);
      const recentDateStart = toDateKey(previousMonthStart);
      const scheduleDateStart = toDateKey(scheduleStart);
      const scheduleDateEnd = toDateKey(scheduleEnd);

      // Tối ưu PWA: không kéo toàn bộ lịch sử mỗi lần mở app.
      // Dữ liệu vận hành lấy gần đây; lịch sử sâu sẽ được từng màn hình lọc/tải riêng khi cần.
      const tables = [
        { key: 'stores', query: supabase.from('stores').select('*'), critical: true },
        { key: 'users', query: supabase.from('users').select('*'), critical: true },
        { key: 'inventory_items', query: supabase.from('inventory_items').select('*') },
        { key: 'inventory_logs', query: supabase.from('inventory_logs').select('*').order('created_at', { ascending: false }).limit(800) },
        { key: 'inventory_tickets', query: supabase.from('inventory_tickets').select('*').order('created_at', { ascending: false }).limit(300) },
        { key: 'shifts', query: supabase.from('shifts').select('*').order('id', { ascending: false }).limit(300) },
        { key: 'attendance_logs', query: supabase.from('attendance_logs').select('*').gte('date', recentDateStart).order('date', { ascending: false }).limit(1500) },
        { key: 'attendance_corrections', query: supabase.from('attendance_corrections').select('*').gte('date', recentDateStart).order('date', { ascending: false }).limit(800) },
        { key: 'shift_registrations', query: supabase.from('shift_registrations').select('*').gte('date', scheduleDateStart).lte('date', scheduleDateEnd).order('date', { ascending: true }).limit(1000) },
        { key: 'payroll_adjustments', query: supabase.from('payroll_adjustments').select('*').gte('month', previousMonthKey).limit(500) },
        { key: 'payroll_approvals', query: supabase.from('payroll_approvals').select('*').gte('month', previousMonthKey).limit(500) },
        { key: 'shift_swaps', query: supabase.from('shift_swaps').select('*').order('created_at', { ascending: false }).limit(200) },
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
      setAttendanceCorrectionLogs(tableData.attendance_corrections || []);
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

  const scheduleRealtimeRefresh = useCallback(() => {
    if (realtimeRefreshTimerRef.current) {
      clearTimeout(realtimeRefreshTimerRef.current);
    }
    realtimeRefreshTimerRef.current = setTimeout(() => {
      realtimeRefreshTimerRef.current = null;
      refreshData();
    }, 2500);
  }, [refreshData]);

  useEffect(() => {
    refreshData();

    // PWA nhanh hơn: chỉ nghe các bảng vận hành chính, không nghe toàn bộ public schema.
    const realtimeTables = [
      'stores',
      'users',
      'inventory_items',
      'inventory_logs',
      'inventory_tickets',
      'shifts',
      'attendance_logs',
      'attendance_corrections',
      'shift_registrations',
      'payroll_adjustments',
      'payroll_approvals',
      'shift_swaps',
    ];
    let channel = supabase.channel('global-db-changes');
    realtimeTables.forEach((table) => {
      channel = channel.on('postgres_changes', { event: '*', schema: 'public', table }, () => {
        scheduleRealtimeRefresh();
      });
    });
    channel.subscribe();

    return () => {
      if (realtimeRefreshTimerRef.current) {
        clearTimeout(realtimeRefreshTimerRef.current);
        realtimeRefreshTimerRef.current = null;
      }
      supabase.removeChannel(channel);
    };
  }, [refreshData, scheduleRealtimeRefresh]);

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
    if (
      isDataLoading
      || !currentUser?.id
      || !staffList.length
      || !shiftRegistrations.length
    ) {
      return undefined;
    }

    let isCancelled = false;
    const timer = setTimeout(() => {
      if (isCancelled) return;

      sendAttendanceExceptionReminders({
        attendanceHistory,
        attendanceCorrectionLogs,
        shiftRegistrations,
        staffList,
        storeList,
      }).catch((error) => {
        console.log('Cannot send attendance reminders:', error?.message || error);
      });
    }, 900);

    return () => {
      isCancelled = true;
      clearTimeout(timer);
    };
  }, [
    isDataLoading,
    currentUser?.id,
    attendanceHistory,
    attendanceCorrectionLogs,
    shiftRegistrations,
    staffList,
    storeList,
  ]);

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

  const appContextValue = useMemo(() => ({
    staffList, setStaffList,
    storeList, setStoreList,
    selectedStoreId, setSelectedStoreId,
    currentUser, setCurrentUser,
    attendanceHistory, setAttendanceHistory,
    attendanceCorrectionLogs, setAttendanceCorrectionLogs,
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
    themeMode, setThemeMode: changeThemeMode, toggleThemeMode,
  }), [
    staffList,
    storeList,
    selectedStoreId,
    currentUser,
    attendanceHistory,
    attendanceCorrectionLogs,
    shiftRegistrations,
    inventoryItems,
    inventoryLogs,
    inventoryTickets,
    shifts,
    payrollAdjustments,
    payrollApprovals,
    shiftSwaps,
    isDataLoading,
    dataError,
    refreshData,
    isDarkMode,
    themeMode,
    changeThemeMode,
    toggleThemeMode,
  ]);

  return (
    <SafeAreaProvider>
    <AppContext.Provider value={appContextValue}>
      <View style={[styles.webContainer, { backgroundColor: COLORS.card }]}>
        <View style={[styles.webWrapper, { backgroundColor: COLORS.card }]}>
          <NavigationContainer ref={navigationRef}>
            <Stack.Navigator initialRouteName="Login" screenOptions={{ headerShown: false }}>
              <Stack.Screen name="Login" component={LoginScreen} />
              <Stack.Screen name="Finance" component={FinanceScreen} />
              <Stack.Screen name="Dashboard" component={MainTabs} />
              <Stack.Screen name="StaffHistory" component={StaffHistoryScreen} />
              <Stack.Screen name="StaffManagement" component={StaffManagementScreen} />
              <Stack.Screen name="Inventory" component={InventoryScreen} />
              <Stack.Screen name="CentralWarehouse" component={CentralWarehouseScreen} />
              <Stack.Screen name="StaffCheckin" component={StaffCheckinScreen} />
              <Stack.Screen name="ShiftSchedule" component={ShiftScheduleScreen} />
              <Stack.Screen name="Payroll" component={PayrollScreen} />
              <Stack.Screen name="AttendanceReview" component={AttendanceReviewScreen} />
              <Stack.Screen name="Notifications" component={NotificationScreen} />
              <Stack.Screen name="Shifts" component={require('./src/screens/ShiftScreen').default} />
            </Stack.Navigator>
          </NavigationContainer>
        </View>
        <PwaInstallBanner COLORS={COLORS} isDarkMode={isDarkMode} currentUser={currentUser} />
        <WebNotificationBanner currentUser={currentUser} COLORS={COLORS} isDarkMode={isDarkMode} />
      </View>
    </AppContext.Provider>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  webContainer: {
    flex: 1,
    height: Platform.OS === 'web' ? 'auto' : '100%',
    minHeight: Platform.OS === 'web' ? '100dvh' : '100%',
    backgroundColor: '#fff',
  },
  webWrapper: {
    flex: 1,
    minHeight: Platform.OS === 'web' ? '100dvh' : '100%',
    width: '100%',
    backgroundColor: '#fff',
  },
  tabBar: {
    height: Platform.OS === 'ios' ? 84 : Platform.OS === 'web' ? 78 : 62,
    paddingTop: 5,
    paddingBottom: Platform.OS === 'ios' ? 22 : Platform.OS === 'web' ? 6 : 7,
    borderTopWidth: StyleSheet.hairlineWidth,
    elevation: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -2 },
    shadowRadius: 8,
    ...(Platform.OS === 'web' ? { position: 'fixed', left: 0, right: 0, bottom: 0 } : null),
  },
  tabBarLabel: {
    fontSize: 11,
    fontWeight: '700',
    marginTop: 2,
  },
  floatingButtonContainer: {
    top: Platform.OS === 'web' ? -18 : -24,
    justifyContent: 'center',
    alignItems: 'center',
    width: 70,
    height: 70,
    borderRadius: 35,
    overflow: 'visible',
  },
  floatingButtonNotch: {
    position: 'absolute',
    top: Platform.OS === 'web' ? -21 : -27,
    alignSelf: 'center',
    width: 76,
    height: 76,
    borderRadius: 38,
    borderWidth: 1,
    opacity: 0.96,
    shadowOpacity: 0.08,
    shadowOffset: { width: 0, height: 4 },
    shadowRadius: 10,
    zIndex: -1,
  },
  floatingButtonRing: {
    position: 'absolute',
    width: 72,
    height: 72,
    borderRadius: 36,
    borderWidth: 3,
    top: -1,
  },
  floatingButton: {
    width: 60,
    height: 60,
    borderRadius: 30,
    borderWidth: 3,
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
    backgroundColor: 'rgba(255,255,255,0.22)',
    transform: [{ rotate: '-18deg' }],
  },
  floatingButtonLabel: {
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 0.3,
    marginTop: Platform.OS === 'ios' ? 6 : 4,
    textTransform: 'uppercase',
  },
});
