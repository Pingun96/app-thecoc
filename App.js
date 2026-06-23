import React, { useState, createContext } from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createStackNavigator } from '@react-navigation/stack';
import LoginScreen from './src/screens/LoginScreen';
import StaffDashboardScreen from './src/screens/StaffDashboardScreen';
import ManagerDashboardScreen from './src/screens/ManagerDashboardScreen';
import OwnerDashboardScreen from './src/screens/OwnerDashboardScreen';
import StaffHistoryScreen from './src/screens/StaffHistoryScreen';
import StaffManagementScreen from './src/screens/StaffManagementScreen';

export const AppContext = createContext();

const Stack = createStackNavigator();

export default function App() {
  // Danh sách các chi nhánh
  const [storeList] = useState([
    { id: 1, name: 'The Cốc - Bình Khánh' },
    { id: 2, name: 'The Cốc - Quận 7' }
  ]);

  // Cửa hàng đang được chọn (Dành cho Owner xem tổng quát hoặc chi tiết)
  const [selectedStoreId, setSelectedStoreId] = useState(1);

  // Danh sách nhân viên (Bổ sung store_id để biết nhân viên thuộc cửa hàng nào)
  const [staffList, setStaffList] = useState([
    { id: 'staff_1', name: 'Nguyễn Văn A (Barista)', phone: '0901112223', wage: 25000, store_id: 1 },
    { id: 'staff_2', name: 'Trần Thị B (Thu ngân)', phone: '0901112224', wage: 22000, store_id: 1 },
    { id: 'staff_3', name: 'Lê Văn C (Pha chế)', phone: '0901112225', wage: 26000, store_id: 2 }
  ]);

  // Người dùng đang đăng nhập
  const [currentUser, setCurrentUser] = useState(null);

  // Lịch sử chấm công
  const [attendanceHistory, setAttendanceHistory] = useState([
    { id: '1', user_id: 'staff_1', date: '23/06/2026', checkIn: '07:00', checkOut: '15:15', hours: 8.25 },
    { id: '2', user_id: 'staff_2', date: '23/06/2026', checkIn: '07:10', checkOut: '15:00', hours: 7.83 },
  ]);

  return (
    <AppContext.Provider value={{ 
      staffList, setStaffList, 
      storeList, 
      selectedStoreId, setSelectedStoreId,
      currentUser, setCurrentUser,
      attendanceHistory, setAttendanceHistory
    }}>
      <NavigationContainer>
        <Stack.Navigator initialRouteName="Login" screenOptions={{ headerShown: false }}>
          <Stack.Screen name="Login" component={LoginScreen} />
          <Stack.Screen name="StaffDashboard" component={StaffDashboardScreen} />
          <Stack.Screen name="StaffHistory" component={StaffHistoryScreen} />
          <Stack.Screen name="StaffManagement" component={StaffManagementScreen} />
          <Stack.Screen name="ManagerDashboard" component={ManagerDashboardScreen} />
          <Stack.Screen name="OwnerDashboard" component={OwnerDashboardScreen} />
        </Stack.Navigator>
      </NavigationContainer>
    </AppContext.Provider>
  );
}
