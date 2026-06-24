import React, { useState, useEffect, useCallback } from 'react';
import { Platform, View, StyleSheet } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createStackNavigator } from '@react-navigation/stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { Ionicons } from '@expo/vector-icons';
import LoginScreen from './src/screens/LoginScreen';
import DashboardScreen from './src/screens/DashboardScreen';
import StaffHistoryScreen from './src/screens/StaffHistoryScreen';
import StaffManagementScreen from './src/screens/StaffManagementScreen';
import InventoryScreen from './src/screens/InventoryScreen';
import StaffCheckinScreen from './src/screens/StaffCheckinScreen';
import ShiftScheduleScreen from './src/screens/ShiftScheduleScreen';
import { supabase } from './src/services/supabaseClient';
import { registerForPushNotificationsAsync, savePushTokenToDB } from './src/services/NotificationService';
import {
  normalizeAttendance,
  normalizeInventoryItem,
  normalizeInventoryLog,
  normalizeInventoryRequest,
  normalizeUser,
} from './src/services/dataMappers';
import { AppContext } from './src/context/AppContext';

const Stack = createStackNavigator();
const Tab = createBottomTabNavigator();

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
  const [inventoryRequests, setInventoryRequests] = useState([]);
  const [shifts, setShifts] = useState([]);
  const [attendanceHistory, setAttendanceHistory] = useState([]);
  const [shiftRegistrations, setShiftRegistrations] = useState([]);
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
        supabase.from('inventory_requests').select('*'),
        supabase.from('shifts').select('*'),
        supabase.from('attendance_logs').select('*'),
        supabase.from('shift_registrations').select('*'),
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
      ] = results;

      setStoreList(storesRes.data || []);
      setStaffList((usersRes.data || []).map(normalizeUser));
      setInventoryItems((itemsRes.data || []).map(normalizeInventoryItem));
      setInventoryLogs((logsRes.data || []).map(normalizeInventoryLog));
      setInventoryRequests((reqsRes.data || []).map(normalizeInventoryRequest));
      setShifts(shiftsRes.data || []);
      setAttendanceHistory((attendanceRes.data || []).map(normalizeAttendance));
      setShiftRegistrations(regRes.data || []);
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

  // Đăng ký Push Notification khi có currentUser
  useEffect(() => {
    if (currentUser) {
      registerForPushNotificationsAsync().then(token => {
        if (token) {
          savePushTokenToDB(currentUser.id, token);
        }
      });
    }
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
      inventoryRequests, setInventoryRequests,
      shifts, setShifts,
      isDataLoading, dataError, refreshData
    }}>
      <View style={styles.webContainer}>
        <View style={styles.webWrapper}>
          <NavigationContainer>
            <Stack.Navigator initialRouteName="Login" screenOptions={{ headerShown: false }}>
              <Stack.Screen name="Login" component={LoginScreen} />
              <Stack.Screen name="Dashboard" component={MainTabs} />
              <Stack.Screen name="StaffHistory" component={StaffHistoryScreen} />
              <Stack.Screen name="StaffManagement" component={StaffManagementScreen} />
              <Stack.Screen name="Inventory" component={InventoryScreen} />
              <Stack.Screen name="StaffCheckin" component={StaffCheckinScreen} />
              <Stack.Screen name="ShiftSchedule" component={ShiftScheduleScreen} />
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
    backgroundColor: '#fff',
  },
  webWrapper: {
    flex: 1,
    width: '100%',
    backgroundColor: '#fff',
  }
});
