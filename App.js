import React, { useState, createContext, useEffect } from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createStackNavigator } from '@react-navigation/stack';
import LoginScreen from './src/screens/LoginScreen';
import DashboardScreen from './src/screens/DashboardScreen';
import StaffHistoryScreen from './src/screens/StaffHistoryScreen';
import StaffManagementScreen from './src/screens/StaffManagementScreen';
import InventoryScreen from './src/screens/InventoryScreen';
import StaffCheckinScreen from './src/screens/StaffCheckinScreen';
import { supabase } from './src/services/supabaseClient';

export const AppContext = createContext();

const Stack = createStackNavigator();

export default function App() {
  const [storeList, setStoreList] = useState([]);
  const [selectedStoreId, setSelectedStoreId] = useState(1);
  const [staffList, setStaffList] = useState([]);
  const [currentUser, setCurrentUser] = useState(null);
  const [inventoryItems, setInventoryItems] = useState([]);
  const [inventoryLogs, setInventoryLogs] = useState([]);
  const [inventoryRequests, setInventoryRequests] = useState([]);
  const [attendanceHistory, setAttendanceHistory] = useState([]);
  const [shifts, setShifts] = useState([]);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const [storesRes, usersRes, itemsRes, logsRes, reqsRes, shiftsRes] = await Promise.all([
          supabase.from('stores').select('*'),
          supabase.from('users').select('*'),
          supabase.from('inventory_items').select('*'),
          supabase.from('inventory_logs').select('*'),
          supabase.from('inventory_requests').select('*'),
          supabase.from('shifts').select('*')
        ]);

        if (storesRes.data) setStoreList(storesRes.data);
        if (usersRes.data) setStaffList(usersRes.data.map(u => ({...u, hasAppAccess: u.hasappaccess !== undefined ? u.hasappaccess : u.hasAppAccess})));
        if (itemsRes.data) setInventoryItems(itemsRes.data.map(i => ({...i, safeLevel: i.safelevel !== undefined ? i.safelevel : i.safeLevel})));
        if (logsRes.data) setInventoryLogs(logsRes.data.map(l => ({...l, itemId: l.itemid !== undefined ? l.itemid : l.itemId})));
        if (reqsRes.data) setInventoryRequests(reqsRes.data.map(r => ({...r, itemId: r.itemid !== undefined ? r.itemid : r.itemId})));
        if (shiftsRes.data) setShifts(shiftsRes.data);
        
        // Mock attendance history until we create a table for it
        setAttendanceHistory([
          { id: '1', user_id: 'staff_1', date: '23/06/2026', checkIn: '07:00', checkOut: '15:15', hours: 8.25 },
          { id: '2', user_id: 'staff_2', date: '23/06/2026', checkIn: '07:10', checkOut: '15:00', hours: 7.83 },
        ]);
      } catch (error) {
        console.error("Lỗi khi kéo dữ liệu từ Supabase:", error);
      }
    };

    fetchData();
  }, []);

  return (
    <AppContext.Provider value={{ 
      staffList, setStaffList, 
      storeList, 
      selectedStoreId, setSelectedStoreId,
      currentUser, setCurrentUser,
      attendanceHistory, setAttendanceHistory,
      inventoryItems, setInventoryItems,
      inventoryLogs, setInventoryLogs,
      inventoryRequests, setInventoryRequests,
      shifts, setShifts
    }}>
      <NavigationContainer>
        <Stack.Navigator initialRouteName="Login" screenOptions={{ headerShown: false }}>
          <Stack.Screen name="Login" component={LoginScreen} />
          <Stack.Screen name="Dashboard" component={DashboardScreen} />
          <Stack.Screen name="StaffHistory" component={StaffHistoryScreen} />
          <Stack.Screen name="StaffManagement" component={StaffManagementScreen} />
          <Stack.Screen name="Inventory" component={InventoryScreen} />
          <Stack.Screen name="StaffCheckin" component={StaffCheckinScreen} />
          <Stack.Screen name="Shifts" component={require('./src/screens/ShiftScreen').default} />
        </Stack.Navigator>
      </NavigationContainer>
    </AppContext.Provider>
  );
}
