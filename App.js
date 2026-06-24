import React, { useState, createContext } from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createStackNavigator } from '@react-navigation/stack';
import LoginScreen from './src/screens/LoginScreen';
import DashboardScreen from './src/screens/DashboardScreen';
import StaffHistoryScreen from './src/screens/StaffHistoryScreen';
import StaffManagementScreen from './src/screens/StaffManagementScreen';
import InventoryScreen from './src/screens/InventoryScreen';
import StaffCheckinScreen from './src/screens/StaffCheckinScreen';

export const AppContext = createContext();

const Stack = createStackNavigator();

export default function App() {
  const [storeList] = useState([
    { id: 1, name: 'The Cốc - Bình Khánh' },
    { id: 2, name: 'The Cốc - Quận 7' }
  ]);

  const [selectedStoreId, setSelectedStoreId] = useState(1);

  const [staffList, setStaffList] = useState([
    { id: 'manager_1', name: 'Quản Lý (Admin 1)', phone: '0907654321', wage: 30000, store_id: 1, role: 'MANAGER', hasAppAccess: true, permissions: { reports: true, inventory: true, cashier: true, hr: true, payroll: true, viewable_stores: [1] } },
    { id: 'staff_1', name: 'Nguyễn Văn A (Kiểm kho)', phone: '0901112223', wage: 25000, store_id: 1, role: 'STAFF', hasAppAccess: true, permissions: { reports: false, inventory: true, cashier: false, hr: true, payroll: true, viewable_stores: [1] } },
    { id: 'staff_2', name: 'Trần Thị B (Thu ngân)', phone: '0901112224', wage: 22000, store_id: 1, role: 'STAFF', hasAppAccess: false, permissions: { reports: false, inventory: false, cashier: true, hr: true, payroll: true, viewable_stores: [1] } },
    { id: 'staff_3', name: 'Lê Văn C (Pha chế)', phone: '0901112225', wage: 26000, store_id: 2, role: 'STAFF', hasAppAccess: true, permissions: { reports: false, inventory: false, cashier: false, hr: true, payroll: true, viewable_stores: [2] } }
  ]);

  const [currentUser, setCurrentUser] = useState(null);

  const [inventoryItems, setInventoryItems] = useState([
    { id: 'item_1', name: 'Cà phê Hạt Arabica', unit: 'kg', safeLevel: 5, store_id: 1 },
    { id: 'item_2', name: 'Sữa Đặc Ngôi Sao', unit: 'hộp', safeLevel: 10, store_id: 1 },
    { id: 'item_3', name: 'Ly Nhựa 500ml', unit: 'cái', safeLevel: 100, store_id: 1 },
    { id: 'item_4', name: 'Trà Oolong', unit: 'kg', safeLevel: 2, store_id: 2 },
  ]);

  const [inventoryLogs, setInventoryLogs] = useState([
    { id: 'log_1', itemId: 'item_1', type: 'IMPORT', amount: 20, date: '2026-06-20', store_id: 1 },
    { id: 'log_2', itemId: 'item_1', type: 'EXPORT', amount: 3, date: '2026-06-21', store_id: 1 },
    { id: 'log_3', itemId: 'item_2', type: 'EXPORT', amount: 15, date: '2026-06-22', store_id: 1 },
    { id: 'log_4', itemId: 'item_2', type: 'IMPORT', amount: 20, date: '2026-06-20', store_id: 1 }, 
  ]);

  const [inventoryRequests, setInventoryRequests] = useState([
    { id: 'req_1', itemId: 'item_1', type: 'IMPORT', amount: 5, date: '2026-06-23', store_id: 1, requested_by_name: 'Nguyễn Văn A', status: 'PENDING_MANAGER' }
  ]);

  const [attendanceHistory, setAttendanceHistory] = useState([
    { id: '1', user_id: 'staff_1', date: '23/06/2026', checkIn: '07:00', checkOut: '15:15', hours: 8.25 },
    { id: '2', user_id: 'staff_2', date: '23/06/2026', checkIn: '07:10', checkOut: '15:00', hours: 7.83 },
  ]);

  const [shifts, setShifts] = useState([
    { 
      id: 'shift_1', store_id: 1, opened_by: 'staff_1', opened_by_name: 'Nguyễn Văn A', opened_at: '22/06/2026 06:30', opening_cash: 450000, 
      status: 'CLOSED', closed_by: 'manager_1', closed_by_name: 'Quản Lý', closed_at: '22/06/2026 22:30', 
      rev_cash: 5605000, rev_momo: 1828000, rev_grab: 0, rev_shopee: 0, discount: 8000, expenses: 110000, expenses_note: 'Ly trà đá',
      closing_cash_actual: 3769000, discrepancy: 0,
      inventory_check: []
    },
    { 
      id: 'shift_2', store_id: 2, opened_by: 'staff_3', opened_by_name: 'Lê Văn C', opened_at: '23/06/2026 07:00', opening_cash: 1000000, 
      status: 'OPEN', closed_by: null, closed_by_name: null, closed_at: null, 
      rev_cash: 0, rev_momo: 0, rev_grab: 0, rev_shopee: 0, discount: 0, expenses: 0, expenses_note: '', closing_cash_actual: 0, discrepancy: 0,
      inventory_check: []
    }
  ]);

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
