import 'react-native-gesture-handler';
import 'react-native-url-polyfill/auto';
import React, { useState, useEffect, useCallback } from 'react';
import { Platform, View, StyleSheet, TouchableOpacity, Pressable, Alert } from 'react-native';
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
import InventoryTransferScreen from './src/screens/InventoryTransferScreen';
import StaffCheckinScreen from './src/screens/StaffCheckinScreen';
import ShiftScheduleScreen from './src/screens/ShiftScheduleScreen';
import PayrollScreen from './src/screens/PayrollScreen';
import NotificationScreen from './src/screens/NotificationScreen';
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

// Floating Check-in Button Component
const CustomTabBarButton = ({ children, onPress, style }) => (
  <View style={style}>
    <Pressable
      onPress={onPress}
      style={styles.floatingButtonContainer}
      android_ripple={{ color: 'rgba(255,255,255,0.3)', borderless: true, radius: 35 }}
    >
      <View style={styles.floatingButton}>
        {children}
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
        tabBarActiveTintColor: '#e91e63',
        tabBarInactiveTintColor: 'gray',
      })}
    >
      <Tab.Screen name="HomeTab" component={DashboardScreen} options={{ title: 'Trang Chủ' }} />

      {/* Nút Chấm Công Nổi */}
      <Tab.Screen
        name="StaffCheckin"
        component={StaffCheckinScreen}
        options={{
          title: '',
          tabBarIcon: () => (
            <Ionicons name="scan" size={32} color="#fff" />
          ),
          tabBarButton: (props) => (
            <CustomTabBarButton {...props} />
          )
        }}
      />

      <Tab.Screen name="ScheduleTab" component={ShiftScheduleScreen} options={{ title: 'Lịch Làm' }} />
    </Tab.Navigator>
  );
}

export default function App() {
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

  const refreshData = useCallback(async () => {
    setIsDataLoading(true);
    setDataError('');

    try {
      const results = await Promise.all([
        supabase.from('stores').select('*'),
        supabase.from('users').select('*'),
        supabase.from('inventory_items').select('*'),
        supabase.from('inventory_logs').select('*'),
        supabase.from('inventory_tickets').select('*'),
        supabase.from('shifts').select('*'),
        supabase.from('attendance_logs').select('*'),
        supabase.from('shift_registrations').select('*'),
        supabase.from('payroll_adjustments').select('*'),
        supabase.from('payroll_approvals').select('*'),
        supabase.from('shift_swaps').select('*'),
      ]);

      const failedResult = results.find((result) => result.error);
      if (failedResult?.error) throw failedResult.error;

      const [
        storesRes,
        usersRes,
        itemsRes,
        logsRes,
        reqsRes,
        shiftsRes,
        attendanceRes,
        regRes,
        adjustmentsRes,
        approvalsRes,
        swapsRes,
      ] = results;

      setStoreList(storesRes.data || []);
      setStaffList((usersRes.data || []).map(normalizeUser));
      setInventoryItems((itemsRes.data || []).map(normalizeInventoryItem));
      setInventoryLogs((logsRes.data || []).map(normalizeInventoryLog));
      setInventoryTickets(reqsRes.data || []);
      setShifts(shiftsRes.data || []);
      setAttendanceHistory((attendanceRes.data || []).map(normalizeAttendance));
      setShiftRegistrations(regRes.data || []);
      setPayrollAdjustments(adjustmentsRes.data || []);
      setPayrollApprovals(approvalsRes.data || []);
      setShiftSwaps((swapsRes.data || []).map(normalizeShiftSwap));
    } catch (error) {
      console.error('Lỗi khi tải dữ liệu từ Supabase:', error);
      setDataError(error?.message || 'Không thể tải dữ liệu. Vui lòng kiểm tra kết nối.');
    } finally {
      setIsDataLoading(false);
    }
  }, []);

  useEffect(() => {
    refreshData();
  }, [refreshData]);

  useEffect(() => {
    if (!storeList.length) return;
    const selectedStoreExists = storeList.some((store) => store.id === selectedStoreId);
    if (!selectedStoreExists && selectedStoreId !== 'ALL') {
      setSelectedStoreId(storeList[0].id);
    }
  }, [storeList, selectedStoreId]);

  useEffect(() => {
    const unsubscribe = observeNotificationResponses(navigateFromNotificationData);

    getLastNotificationData().then((data) => {
      if (data) {
        setTimeout(() => navigateFromNotificationData(data), 600);
      }
    });

    return unsubscribe;
  }, []);

  // Đăng ký Push Notification và Realtime Notification khi có currentUser
  useEffect(() => {
    if (!currentUser) return undefined;

    if (Platform.OS !== 'web') {
      registerForPushNotificationsAsync().then((token) => {
        if (token) {
          savePushTokenToDB(currentUser.id, token, { storeId: currentUser.store_id });
        }
      });
    }

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
          Alert.alert(`🔔 ${title}`, body, [
            { text: 'Để sau', style: 'cancel' },
            { text: 'Mở', onPress: () => navigateFromNotificationData(notificationData) },
          ]);
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
      isDataLoading, dataError, refreshData
    }}>
      <View style={styles.webContainer}>
        <View style={styles.webWrapper}>
          <NavigationContainer ref={navigationRef}>
            <Stack.Navigator initialRouteName="Login" screenOptions={{ headerShown: false }}>
              <Stack.Screen name="Login" component={LoginScreen} />
              <Stack.Screen name="Finance" component={FinanceScreen} />
              <Stack.Screen name="Dashboard" component={MainTabs} />
              <Stack.Screen name="StaffHistory" component={StaffHistoryScreen} />
              <Stack.Screen name="StaffManagement" component={StaffManagementScreen} />
              <Stack.Screen name="Inventory" component={InventoryScreen} />
              <Stack.Screen name="InventoryTransfer" component={InventoryTransferScreen} />
              <Stack.Screen name="StaffCheckin" component={StaffCheckinScreen} />
              <Stack.Screen name="ShiftSchedule" component={ShiftScheduleScreen} />
              <Stack.Screen name="Payroll" component={PayrollScreen} />
              <Stack.Screen name="Notifications" component={NotificationScreen} />
              <Stack.Screen name="Shifts" component={require('./src/screens/ShiftScreen').default} />
            </Stack.Navigator>
          </NavigationContainer>
        </View>
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
  floatingButtonContainer: {
    top: -25,
    justifyContent: 'center',
    alignItems: 'center',
    width: 70,
    height: 70,
    borderRadius: 35,
    elevation: 8,
    shadowColor: '#e91e63',
    shadowOpacity: 0.3,
    shadowOffset: { width: 0, height: 5 },
    shadowRadius: 5,
  },
  floatingButton: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: '#e91e63',
    justifyContent: 'center',
    alignItems: 'center',
  }
});
