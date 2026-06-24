import React, { useContext, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, Image, Dimensions, ActivityIndicator, Alert } from 'react-native';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { AppContext } from '../context/AppContext';
import * as Updates from 'expo-updates';
import { getLocalDateKey, isDateInCurrentMonth } from '../utils/dateTime';

const { width } = Dimensions.get('window');

export default function DashboardScreen({ navigation }) {
  const {
    currentUser,
    setCurrentUser,
    staffList,
    attendanceHistory,
    storeList,
    selectedStoreId,
    setSelectedStoreId,
  } = useContext(AppContext);
  const [isCheckingUpdate, setIsCheckingUpdate] = useState(false);

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

  const filteredStaff = staffList.filter(s => displayStoreId === 'ALL' || s.store_id === displayStoreId);
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
    if (currentUser?.role === 'OWNER' || currentUser?.role === 'MANAGER') return true;
    return currentUser?.permissions?.[featureKey] === true;
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
      <View style={styles.headerContainer}>
        <View style={styles.headerProfile}>
          <Image 
            source={{ uri: currentUser?.role === 'STAFF' ? 'https://i.pravatar.cc/100?img=33' : 'https://i.pravatar.cc/100?img=12' }} 
            style={styles.avatar} 
          />
          <View style={styles.headerTextContainer}>
            <Text style={styles.greetingText}>Xin chào,</Text>
            <Text style={styles.nameText} numberOfLines={1}>
              {currentUser?.name || 'Thành viên The Cốc'}
            </Text>
            <Text style={styles.roleText}>
              {currentUser?.role === 'OWNER'
                ? 'Chủ cửa hàng'
                : currentUser?.role === 'MANAGER'
                  ? 'Quản lý'
                  : 'Nhân viên'}
            </Text>
          </View>
        </View>

        <TouchableOpacity
          style={styles.logoutBtn}
          onPress={() => {
            setCurrentUser(null);
            navigation.replace('Login');
          }}
        >
          <MaterialCommunityIcons name="logout" size={24} color="#ff5252" />
        </TouchableOpacity>
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

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scrollContent}>
        <TouchableOpacity
          style={styles.updateButton}
          onPress={handleManualUpdate}
          disabled={isCheckingUpdate}
        >
          {isCheckingUpdate
            ? <ActivityIndicator color="#1565c0" />
            : <Ionicons name="cloud-download-outline" size={20} color="#1565c0" />}
          <Text style={styles.updateButtonText}>
            {isCheckingUpdate ? 'Đang kiểm tra...' : 'Kiểm tra cập nhật ứng dụng'}
          </Text>
        </TouchableOpacity>
        
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
          {renderGridItem('Kho Hàng', 'Kiểm kê & Xuất nhập', 'warehouse', 'Material', '#fce4ec', 'inventory', 'Inventory')}
          {renderGridItem(currentUser?.role === 'STAFF' ? 'Chấm Công' : 'Nhân Sự', currentUser?.role === 'STAFF' ? 'Định vị GPS / Camera' : 'Hồ sơ & Phân quyền', currentUser?.role === 'STAFF' ? "scan-circle" : "id-card", 'Ionicons', '#e0f7fa', 'hr', 'StaffManagement', 'StaffCheckin')}
          {renderGridItem(currentUser?.role === 'STAFF' ? 'Lịch Sử Lương' : 'Tính Lương', currentUser?.role === 'STAFF' ? 'Bảng lương cá nhân' : 'Bảng lương tổng hợp', 'wallet-outline', 'Material', '#fff8e1', 'payroll', 'ALERT', 'StaffHistory', () => alert('Chi tiết bảng lương nằm trong Nhân Sự'))}
        </View>

      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f5f7fa' },
  headerContainer: { backgroundColor: '#1f2937', paddingTop: 50, paddingBottom: 25, paddingHorizontal: 20, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', borderBottomLeftRadius: 25, borderBottomRightRadius: 25, elevation: 5, shadowColor: '#000', shadowOpacity: 0.15, shadowRadius: 10 },
  headerProfile: { flexDirection: 'row', alignItems: 'center' },
  avatar: { width: 50, height: 50, borderRadius: 25, borderWidth: 2, borderColor: '#fff' },
  headerTextContainer: { marginLeft: 13, maxWidth: width - 135 },
  greetingText: { color: '#9ca3af', fontSize: 14 },
  nameText: { color: '#fff', fontSize: 18, fontWeight: 'bold' },
  roleText: { color: '#86efac', fontSize: 12, fontWeight: '700', marginTop: 2 },
  logoutBtn: { padding: 10, backgroundColor: 'rgba(255,255,255,0.1)', borderRadius: 20 },
  storeSelector: { flexDirection: 'row' },
  storeChip: { backgroundColor: '#e5e7eb', paddingHorizontal: 16, paddingVertical: 8, borderRadius: 20, marginRight: 10, height: 36, justifyContent: 'center' },
  storeChipActive: { backgroundColor: '#1976d2' },
  storeChipText: { color: '#4b5563', fontWeight: 'bold', fontSize: 13 },
  storeChipTextActive: { color: '#fff' },
  scrollContent: { padding: 20, paddingBottom: 40 },
  updateButton: { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-end', backgroundColor: '#e8f1ff', borderRadius: 20, paddingHorizontal: 13, paddingVertical: 9, marginBottom: 16 },
  updateButtonText: { color: '#1565c0', fontWeight: '800', fontSize: 12, marginLeft: 7 },
  sectionTitle: { fontSize: 18, fontWeight: 'bold', color: '#374151', marginBottom: 15, marginTop: 5 },
  statsRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 25 },
  statCard: { backgroundColor: '#fff', width: (width - 55) / 2, padding: 15, borderRadius: 16, elevation: 2, shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 5 },
  iconBox: { width: 40, height: 40, borderRadius: 10, justifyContent: 'center', alignItems: 'center', marginBottom: 10 },
  statValue: { fontSize: 22, fontWeight: 'bold', color: '#1f2937' },
  statLabel: { fontSize: 13, color: '#6b7280', marginTop: 5 },
  gridContainer: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between' },
  gridItem: { backgroundColor: '#fff', width: (width - 55) / 2, padding: 20, borderRadius: 16, marginBottom: 15, alignItems: 'center', elevation: 2, shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 5 },
  gridItemDisabled: { backgroundColor: '#f9fafb', opacity: 0.8 },
  gridIconBox: { width: 60, height: 60, borderRadius: 20, justifyContent: 'center', alignItems: 'center', marginBottom: 15 },
  gridItemTitle: { fontSize: 16, fontWeight: 'bold', color: '#1f2937', marginBottom: 5 },
  gridItemSub: { fontSize: 12, color: '#9ca3af', textAlign: 'center' },
  lockIcon: { position: 'absolute', top: 10, right: 10 }
});
