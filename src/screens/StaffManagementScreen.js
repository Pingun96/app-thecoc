import React, { useState, useContext, useMemo } from 'react';
import { Alert, View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput, Switch, Modal, SafeAreaView, KeyboardAvoidingView, Platform, RefreshControl } from 'react-native';
import { AppContext } from '../context/AppContext';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../services/supabaseClient';

const MODULE_PERMISSIONS = [
  { key: 'cashier', icon: '💵', title: 'Giao ca / Thu ngân', desc: 'Mở ca, kiểm két, nhập doanh thu và chốt ca.' },
  { key: 'inventory', icon: '📦', title: 'Kho hàng', desc: 'Xem tồn kho, nhập/xuất, kiểm kê và lịch sử kho.' },
  { key: 'hr', icon: '👥', title: 'Nhân sự / Chấm công', desc: 'Xem nhân sự, chấm công và lịch sử làm việc.' },
  { key: 'payroll', icon: '💰', title: 'Bảng lương', desc: 'Xem lương, điều chỉnh và duyệt/chốt lương theo quyền.' },
  { key: 'finance', icon: '📊', title: 'Tài chính / Báo cáo', desc: 'Xem doanh thu, báo cáo tài chính và lợi nhuận.' },
  { key: 'can_schedule_shift', icon: '🗓️', title: 'Xếp lịch & Duyệt ca', desc: 'Xếp lịch, duyệt đăng ký ca và điều động nhân sự.' },
  { key: 'is_primary_manager', icon: '✅', title: 'Duyệt báo cáo chốt ca', desc: 'Duyệt, từ chối hoặc hủy duyệt báo cáo giao ca.' },
  { key: 'manage_permissions', icon: '🔐', title: 'Cấp quyền nhân sự', desc: 'Tạo tài khoản, sửa thông tin và phân quyền ứng dụng.' },
];

const DEFAULT_STAFF_PERMISSIONS = {
  cashier: false,
  inventory: false,
  hr: true,
  payroll: true,
  finance: false,
  reports: false,
  can_schedule_shift: false,
  is_primary_manager: false,
  manage_permissions: false,
  viewable_stores: [],
};

const DEFAULT_MANAGER_PERMISSIONS = {
  cashier: true,
  inventory: true,
  hr: true,
  payroll: false,
  finance: false,
  reports: false,
  can_schedule_shift: true,
  is_primary_manager: false,
  manage_permissions: false,
  viewable_stores: [],
};

const buildDefaultPermissions = (role = 'STAFF') => ({
  ...(role === 'MANAGER' ? DEFAULT_MANAGER_PERMISSIONS : DEFAULT_STAFF_PERMISSIONS),
});

const normalizePermissions = (permissions = {}, role = 'STAFF', homeStoreId) => {
  const base = buildDefaultPermissions(role);
  const merged = {
    ...base,
    ...(permissions || {}),
  };

  if (merged.reports === true && merged.finance !== true) {
    merged.finance = true;
  }
  if (merged.finance === true) {
    merged.reports = true;
  }

  const viewableStores = Array.isArray(merged.viewable_stores) ? merged.viewable_stores : [];
  merged.viewable_stores = [...new Set([...(homeStoreId ? [homeStoreId] : []), ...viewableStores])];

  return merged;
};

export default function StaffManagementScreen({ navigation }) {
  const { staffList, setStaffList, storeList, currentUser, selectedStoreId, refreshData, isDataLoading, COLORS, isDarkMode } = useContext(AppContext);
  const styles = useMemo(() => getStyles(COLORS, isDarkMode), [COLORS, isDarkMode]);
  const currentPermissions = currentUser?.permissions || {};
  const canEditPermissions = currentUser?.role === 'OWNER' || currentPermissions.manage_permissions === true || currentPermissions.hr === true;

  // OWNER luôn được thấy ALL. Quản lý thì tùy thuộc viewable_stores
  let displayStoreId = currentUser?.store_id;
  if (currentUser?.role === 'OWNER' || currentUser?.permissions?.viewable_stores?.includes(selectedStoreId)) {
    displayStoreId = selectedStoreId;
  }
  if (currentUser?.role === 'OWNER' && selectedStoreId === 'ALL') {
    displayStoreId = 'ALL';
  }

  const [searchQuery, setSearchQuery] = useState('');
  const [localStoreFilter, setLocalStoreFilter] = useState('ALL');

  // Lọc danh sách nhân sự theo chi nhánh được phép xem và chỉ lấy người còn hoạt động
  const activeStaffList = staffList.filter(s => s.is_active !== false);
  let baseFilteredStaffList = activeStaffList.filter(s => displayStoreId === 'ALL' || s.store_id === displayStoreId || s.permissions?.viewable_stores?.includes(displayStoreId));
  
  if (localStoreFilter !== 'ALL') {
    baseFilteredStaffList = baseFilteredStaffList.filter(s => s.store_id === localStoreFilter || s.permissions?.viewable_stores?.includes(localStoreFilter));
  }

  if (searchQuery.trim() !== '') {
    const q = searchQuery.toLowerCase();
    baseFilteredStaffList = baseFilteredStaffList.filter(s => s.name.toLowerCase().includes(q) || s.phone.includes(q));
  }

  const filteredStaffList = baseFilteredStaffList;

  // === THÊM MỚI NHÂN VIÊN ===
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [wage, setWage] = useState('');
  const [storeId, setStoreId] = useState(storeList[0]?.id || 1);
  const [role, setRole] = useState('STAFF');
  const [isPartTime, setIsPartTime] = useState(true);
  const [, setIsLoading] = useState(false);
  const hasAccess = true;
  const [perms, setPerms] = useState(buildDefaultPermissions('STAFF'));

  const handleCreateStaff = async () => {
    const cleanName = fullName.trim();
    const cleanPhone = phone.replace(/\s/g, '');
    const numericWage = Number(wage);
    if (!cleanName || !cleanPhone || !Number.isFinite(numericWage) || numericWage <= 0) {
      Alert.alert('Thông tin chưa hợp lệ', 'Vui lòng nhập đầy đủ họ tên, số điện thoại và mức lương.');
      return;
    }
    if (staffList.some((staff) => staff.phone === cleanPhone)) {
      Alert.alert('Số điện thoại đã tồn tại', 'Vui lòng dùng số điện thoại khác.');
      return;
    }

    // Mặc định luôn có store_id gốc trong viewable_stores
    const finalPermissions = normalizePermissions(perms, role, storeId);

    const newStaff = {
      id: `staff_${Date.now()}`,
      name: cleanName,
      phone: cleanPhone,
      wage: numericWage,
      store_id: storeId,
      role: role,
      is_part_time: isPartTime,
      hasAppAccess: hasAccess,
      permissions: finalPermissions
    };

    const { error } = await supabase.from('users').insert([{
      id: newStaff.id,
      name: newStaff.name,
      phone: newStaff.phone,
      wage: newStaff.wage,
      store_id: newStaff.store_id,
      role: newStaff.role,
      is_part_time: newStaff.is_part_time,
      hasappaccess: newStaff.hasAppAccess,
      permissions: newStaff.permissions,
    }]);
    if (error) {
      Alert.alert('Không thể tạo tài khoản', error.message);
      return;
    }

    setStaffList((current) => [...current, newStaff]);
    Alert.alert('Đã tạo tài khoản', `${cleanName} có thể đăng nhập bằng mật khẩu tạm thời 123.`);
    setFullName(''); setPhone(''); setWage(''); setIsPartTime(true); setRole('STAFF'); setPerms(buildDefaultPermissions('STAFF'));
    setShowCreateModal(false);
  };

  const togglePerm = (key) => {
    const nextValue = !perms[key];
    setPerms({
      ...perms,
      [key]: nextValue,
      ...(key === 'finance' ? { reports: nextValue } : {}),
    });
  };

  const handleRoleChange = (nextRole) => {
    setRole(nextRole);
    setPerms((current) => ({
      ...buildDefaultPermissions(nextRole),
      viewable_stores: current.viewable_stores || [],
    }));
  };

  const toggleViewableStore = (id) => {
    if (perms.viewable_stores.includes(id)) {
      setPerms({...perms, viewable_stores: perms.viewable_stores.filter(s => s !== id)});
    } else {
      setPerms({...perms, viewable_stores: [...perms.viewable_stores, id]});
    }
  };

  const setEditingRole = (nextRole) => {
    setEditingStaff((prev) => ({
      ...prev,
      role: nextRole,
      permissions: normalizePermissions(prev.permissions, nextRole, prev.store_id),
    }));
  };

  const getGrantablePermissions = (targetRole) => {
    const roleOptions = targetRole === 'MANAGER'
      ? MODULE_PERMISSIONS
      : MODULE_PERMISSIONS.filter((item) => !['can_schedule_shift', 'is_primary_manager', 'manage_permissions'].includes(item.key));

    if (currentUser?.role === 'OWNER') return roleOptions;

    return roleOptions.filter((item) => {
      if (item.key === 'finance') return currentPermissions.finance === true || currentPermissions.reports === true;
      return currentPermissions[item.key] === true;
    });
  };

  const renderPermissionRows = (permissionState, onToggle, targetRole) => {
    const options = getGrantablePermissions(targetRole);
    if (!options.length) {
      return (
        <Text style={styles.permissionDesc}>
          Tài khoản của bạn chưa được cấp quyền để phân quyền module cho người khác.
        </Text>
      );
    }

    return options.map((item) => (
      <View key={item.key} style={styles.permissionRow}>
        <View style={styles.permissionTextBox}>
          <Text style={styles.permissionTitle}>{item.icon} {item.title}</Text>
          <Text style={styles.permissionDesc}>{item.desc}</Text>
        </View>
        <Switch
          value={item.key === 'finance'
            ? !!(permissionState?.finance || permissionState?.reports)
            : !!permissionState?.[item.key]}
          onValueChange={() => onToggle(item.key)}
        />
      </View>
    ));
  };

  // === CHỈNH SỬA NHÂN VIÊN (MODAL) ===
  const [editingStaff, setEditingStaff] = useState(null);

  const openEditModal = (staff) => {
    setEditingStaff({
      ...staff,
      permissions: normalizePermissions(staff.permissions, staff.role, staff.store_id)
    });
  };

  const saveEditStaff = async () => {
    if (!editingStaff.name || !editingStaff.phone || !editingStaff.wage) {
      Alert.alert('Lỗi', 'Không được để trống thông tin!');
      return;
    }
    const cleanPhone = editingStaff.phone.replace(/\s/g, '');
    if (staffList.some((s) => s.phone === cleanPhone && s.id !== editingStaff.id)) {
      Alert.alert('Lỗi', 'Số điện thoại này đã được sử dụng cho nhân viên khác!');
      return;
    }

    const finalStaff = {
      ...editingStaff,
      permissions: normalizePermissions(editingStaff.permissions, editingStaff.role, editingStaff.store_id)
    };

    const { error } = await supabase.from('users').update({
      name: finalStaff.name, phone: finalStaff.phone, wage: finalStaff.wage, store_id: finalStaff.store_id, role: finalStaff.role, is_part_time: finalStaff.is_part_time, hasappaccess: finalStaff.hasAppAccess, permissions: finalStaff.permissions
    }).eq('id', finalStaff.id);

    if (error) {
      Alert.alert('Lỗi', 'Không thể cập nhật nhân viên: ' + error.message);
      return;
    }

    setStaffList((current) => current.map(s => s.id === finalStaff.id ? finalStaff : s));
    Alert.alert('Thành công', 'Thông tin nhân viên đã được lưu.');
    setEditingStaff(null);
  };

  const handleDeleteStaff = (staffId, staffName) => {
    Alert.alert(
      'Xóa nhân viên',
      `Bạn có chắc chắn muốn xóa nhân viên ${staffName}?\nLưu ý: Nếu nhân viên đã có lịch sử làm việc, bạn nên KHÓA APP thay vì xóa để giữ lại báo cáo cũ.`,
      [
        { text: 'Hủy', style: 'cancel' },
        {
          text: 'Xóa vĩnh viễn',
          style: 'destructive',
          onPress: async () => {
            setIsLoading(true);
            try {
              const { error } = await supabase.from('users').delete().eq('id', staffId);
              if (error) {
                if (error.code === '23503') {
                  Alert.alert('Không thể xóa', 'Nhân viên này đã có dữ liệu làm việc trong hệ thống (chốt ca, xếp lịch, lương...). Vui lòng KHÓA APP thay vì xóa.');
                } else {
                  throw error;
                }
              } else {
                setStaffList(staffList.filter(s => s.id !== staffId));
                Alert.alert('Thành công', 'Đã xóa nhân viên.');
              }
            } catch (e) {
              Alert.alert('Lỗi', e.message);
            } finally {
              setIsLoading(false);
            }
          }
        }
      ]
    );
  };

  const toggleEditPerm = (key) => {
    setEditingStaff(prev => {
      const nextValue = !prev.permissions?.[key];
      return {
        ...prev,
        permissions: {
          ...prev.permissions,
          [key]: nextValue,
          ...(key === 'finance' ? { reports: nextValue } : {}),
        }
      };
    });
  };

  const toggleEditViewableStore = (id) => {
    setEditingStaff(prev => {
      const currentViewable = prev.permissions.viewable_stores || [];
      const newViewable = currentViewable.includes(id) ? currentViewable.filter(s => s !== id) : [...currentViewable, id];
      return { ...prev, permissions: { ...prev.permissions, viewable_stores: newViewable } };
    });
  };

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{flex: 1}}>
        <View style={styles.headerRow}>
          <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
            <Ionicons name="arrow-back" size={24} color="#1976d2" />
          </TouchableOpacity>
          <Text style={styles.header}>Quản Lý Nhân Sự</Text>
        </View>

        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingBottom: 80 }}
          style={{ flex: 1 }}
          refreshControl={
            <RefreshControl refreshing={isDataLoading} onRefresh={refreshData} />
          }
        >
          <View style={styles.section}>
            <View style={styles.searchBox}>
              <Ionicons name="search" size={20} color="#94a3b8" />
              <TextInput
                style={styles.searchInput}
                placeholder="Tìm nhân viên theo tên hoặc SĐT..."
                placeholderTextColor="#94a3b8"
                value={searchQuery}
                onChangeText={setSearchQuery}
              />
              {searchQuery !== '' && (
                <TouchableOpacity onPress={() => setSearchQuery('')}>
                  <Ionicons name="close-circle" size={20} color="#94a3b8" />
                </TouchableOpacity>
              )}
            </View>

            {displayStoreId === 'ALL' && storeList && storeList.length > 0 && (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 15 }}>
                <TouchableOpacity
                  style={[styles.filterChip, localStoreFilter === 'ALL' && styles.filterChipActive]}
                  onPress={() => setLocalStoreFilter('ALL')}
                >
                  <Text style={[styles.filterChipText, localStoreFilter === 'ALL' && styles.filterChipTextActive]}>Tất cả</Text>
                </TouchableOpacity>
                {storeList.map(store => (
                  <TouchableOpacity
                    key={store.id}
                    style={[styles.filterChip, localStoreFilter === store.id && styles.filterChipActive]}
                    onPress={() => setLocalStoreFilter(store.id)}
                  >
                    <Text style={[styles.filterChipText, localStoreFilter === store.id && styles.filterChipTextActive]}>{store.name}</Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            )}

            <Text style={styles.sectionTitle}>
              DANH SÁCH NHÂN SỰ {displayStoreId === 'ALL' ? '(TẤT CẢ CHI NHÁNH)' : `(CHI NHÁNH ${displayStoreId})`}
            </Text>
            {filteredStaffList.map(staff => (
              <View key={staff.id} style={styles.staffCard}>
                <View style={{flex: 1}}>
                  <Text style={styles.staffName}>
                    {staff.name} <Text style={{fontSize: 12, color: staff.role === 'MANAGER' ? '#e91e63' : '#1976d2'}}>({staff.role === 'MANAGER' ? 'QUẢN LÝ' : 'NHÂN VIÊN'})</Text>
                  </Text>
                  <Text style={styles.staffDetail}>SĐT: {staff.phone} - Lương: {staff.wage.toLocaleString()}đ/h</Text>
                  <Text style={styles.staffDetail}>Loại: <Text style={{fontWeight: 'bold', color: staff.is_part_time ? '#ff9800' : '#4CAF50'}}>{staff.is_part_time ? 'Part-Time' : 'Full-Time'}</Text> - Gốc: {storeList.find(s=>s.id === staff.store_id)?.name}</Text>

                  <View style={styles.statusRow}>
                    <Text style={{fontSize: 12, color: staff.hasAppAccess ? '#4CAF50' : '#F44336', fontWeight: 'bold'}}>
                      {staff.hasAppAccess ? '🟢 App Mở' : '🔴 App Khóa'}
                    </Text>
                    {staff.role === 'MANAGER' ? (
                       <Text style={{fontSize: 12, color: '#e91e63', marginLeft: 15, fontWeight: 'bold'}}>
                         Quản lý: {staff.permissions?.viewable_stores?.length || 1} cửa hàng
                       </Text>
                    ) : (
                       <Text style={{fontSize: 12, color: '#1976d2', marginLeft: 15, fontWeight: 'bold'}}>
                         Làm việc: {staff.permissions?.viewable_stores?.length || 1} cửa hàng
                       </Text>
                    )}
                  </View>
                </View>
                {canEditPermissions && (currentUser?.role === 'OWNER' || staff.role !== 'OWNER') && (
                  <View style={{flexDirection: 'row', gap: 10}}>
                    {currentUser?.role === 'OWNER' && staff.role !== 'OWNER' && (
                    <TouchableOpacity style={[styles.editBtn, {backgroundColor: '#ef4444'}]} onPress={() => handleDeleteStaff(staff.id, staff.name)}>
                      <Text style={[styles.editBtnText, {color: '#fff'}]}>Xóa</Text>
                    </TouchableOpacity>
                    )}
                    <TouchableOpacity style={styles.editBtn} onPress={() => openEditModal(staff)}>
                      <Text style={styles.editBtnText}>Sửa</Text>
                    </TouchableOpacity>
                  </View>
                )}
              </View>
            ))}
          </View>
        </ScrollView>

        {/* MODAL TẠO MỚI */}
        <Modal visible={showCreateModal} animationType="slide" transparent>
          <View style={styles.modalOverlay}>
            <View style={styles.modalContent}>
              <Text style={styles.modalTitle}>Tạo Tài Khoản Mới</Text>
              <ScrollView showsVerticalScrollIndicator={false}>

                <Text style={styles.label}>Họ và tên:</Text>
                <TextInput style={styles.input} placeholder="VD: Nguyễn Văn A" value={fullName} onChangeText={setFullName} />

                <View style={{flexDirection:'row', justifyContent:'space-between'}}>
                  <View style={{flex: 1, marginRight: 10}}>
                    <Text style={styles.label}>SĐT (Đăng nhập):</Text>
                    <TextInput style={styles.input} keyboardType="phone-pad" value={phone} onChangeText={setPhone} />
                  </View>
                  <View style={{flex: 1}}>
                    <View style={styles.passwordHint}>
                      <Ionicons name="key-outline" size={18} color="#1d4ed8" />
                      <Text style={styles.passwordHintText}>Mật khẩu đăng nhập tạm thời: 123</Text>
                    </View>
                  </View>
                </View>

                <Text style={styles.label}>Chức vụ:</Text>
                <View style={styles.roleRow}>
                  <TouchableOpacity style={[styles.roleChip, role === 'STAFF' && styles.roleChipActive]} onPress={() => handleRoleChange('STAFF')}>
                    <Text style={[styles.roleText, role === 'STAFF' && {color:'#fff'}]}>Nhân Viên</Text>
                  </TouchableOpacity>
                  {currentUser?.role === 'OWNER' && (
                  <TouchableOpacity style={[styles.roleChip, role === 'MANAGER' && styles.roleChipActive]} onPress={() => handleRoleChange('MANAGER')}>
                    <Text style={[styles.roleText, role === 'MANAGER' && {color:'#fff'}]}>Quản Lý</Text>
                  </TouchableOpacity>
                  )}
                </View>

                <Text style={styles.label}>Mức lương (VNĐ/h):</Text>
                <TextInput style={styles.input} keyboardType="numeric" value={wage} onChangeText={setWage} />

                <Text style={styles.label}>Loại hình làm việc:</Text>
                <View style={styles.roleRow}>
                  <TouchableOpacity style={[styles.roleChip, isPartTime && styles.roleChipActive]} onPress={() => setIsPartTime(true)}>
                    <Text style={[styles.roleText, isPartTime && {color:'#fff'}]}>Part-Time</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={[styles.roleChip, !isPartTime && styles.roleChipActive]} onPress={() => setIsPartTime(false)}>
                    <Text style={[styles.roleText, !isPartTime && {color:'#fff'}]}>Full-Time</Text>
                  </TouchableOpacity>
                </View>

                <Text style={styles.label}>Chi nhánh gốc (Trực thuộc):</Text>
                <View style={styles.storeSelectRow}>
                  {storeList.map(store => (
                    <TouchableOpacity key={store.id} style={[styles.storeChip, storeId === store.id && styles.storeChipActive]} onPress={() => setStoreId(store.id)}>
                      <Text style={[styles.storeChipText, storeId === store.id && styles.storeChipTextActive]}>{store.name}</Text>
                    </TouchableOpacity>
                  ))}
                </View>

                {(currentUser?.role === 'OWNER' || currentUser?.role === 'MANAGER') && (
                  <View style={[styles.permBox, {borderColor: role === 'MANAGER' ? '#e91e63' : '#1976d2'}]}>
                    <Text style={{fontWeight: 'bold', color: role === 'MANAGER' ? '#e91e63' : '#1976d2', marginBottom: 10}}>
                      {role === 'MANAGER' ? '🌐 Cấp quyền xem dữ liệu chi nhánh khác:' : '🌐 Cấp quyền làm việc tại chi nhánh khác:'}
                    </Text>
                    {storeList.map(store => {
                      const isHomeStore = store.id === storeId;
                      return (
                        <View key={store.id} style={styles.permRow}>
                          <Text style={[styles.permRowText, isHomeStore && styles.permRowTextActive]}>{store.name} {isHomeStore && '(Chi nhánh gốc)'}</Text>
                          <Switch
                            value={isHomeStore ? true : perms.viewable_stores.includes(store.id)}
                            disabled={isHomeStore}
                            onValueChange={()=>toggleViewableStore(store.id)}
                            trackColor={{true: role === 'MANAGER' ? '#e91e63' : '#1976d2'}}
                          />
                        </View>
                      );
                    })}
                    <Text style={{fontSize: 12, color: COLORS.textMuted, marginTop: 10}}>*Nhân sự luôn được gắn quyền với chi nhánh gốc.</Text>
                  </View>
                )}

                <View style={styles.permBox}>
                  <Text style={[styles.label, {marginTop:0}]}>Phân quyền theo nút ứng dụng:</Text>
                  {renderPermissionRows(perms, togglePerm, role)}
                </View>

                {false && role === 'STAFF' && (
                  <View style={styles.permBox}>
                    <Text style={[styles.label, {marginTop:0}]}>Cấp quyền sử dụng tính năng:</Text>
                    <View style={styles.permRow}><Text>💵 Thu ngân / Bán hàng</Text><Switch value={perms.cashier} onValueChange={()=>togglePerm('cashier')} /></View>
                    <View style={styles.permRow}><Text>📦 Kiểm Kho / Nhập xuất</Text><Switch value={perms.inventory} onValueChange={()=>togglePerm('inventory')} /></View>
                    <View style={styles.permRow}><Text>⏱️ Chấm công</Text><Switch value={perms.hr} onValueChange={()=>togglePerm('hr')} /></View>
                    <View style={styles.permRow}><Text>💰 Xem lương</Text><Switch value={perms.payroll} onValueChange={()=>togglePerm('payroll')} /></View>
                    <View style={styles.permRow}><Text>📊 Xem Báo cáo</Text><Switch value={perms.reports} onValueChange={()=>togglePerm('reports')} /></View>
                  </View>
                )}

                {false && currentUser?.role === 'OWNER' && role === 'MANAGER' && (
                  <View style={{flexDirection: 'column', gap: 10, marginTop: 15}}>
                    <View style={{flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 15, backgroundColor: '#e0f2fe', borderRadius: 10, borderWidth: 1, borderColor: '#bae6fd'}}>
                      <View>
                        <Text style={{fontSize: 16, fontWeight: 'bold', color: '#0284c7'}}>Quyền Xếp Lịch & Duyệt Ca</Text>
                        <Text style={{fontSize: 12, color: '#38bdf8', marginTop: 4, maxWidth: 220}}>Được xếp lịch và duyệt đăng ký ca làm việc của nhân sự.</Text>
                      </View>
                      <Switch
                        value={!!perms.can_schedule_shift}
                        onValueChange={() => togglePerm('can_schedule_shift')}
                      />
                    </View>
                  </View>
                )}

                <View style={{flexDirection: 'row', marginTop: 25}}>
                  <TouchableOpacity style={[styles.createBtn, {flex: 1, marginRight: 10, backgroundColor: '#F44336'}]} onPress={() => setShowCreateModal(false)}>
                    <Text style={styles.btnText}>Hủy</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={[styles.createBtn, {flex: 1}]} onPress={handleCreateStaff}>
                    <Text style={styles.btnText}>Tạo Mới</Text>
                  </TouchableOpacity>
                </View>
              </ScrollView>
            </View>
          </View>
        </Modal>

        {/* MODAL CHỈNH SỬA */}
        <Modal visible={!!editingStaff} animationType="slide" transparent>
          {editingStaff && (
            <View style={styles.modalOverlay}>
              <View style={styles.modalContent}>
                <Text style={styles.modalTitle}>Chỉnh sửa thông tin</Text>
                <ScrollView showsVerticalScrollIndicator={false}>

                  <Text style={styles.label}>Tên:</Text>
                  <TextInput style={styles.input} value={editingStaff.name} onChangeText={(t) => setEditingStaff({...editingStaff, name: t})} />

                  <Text style={styles.label}>Số điện thoại (SĐT đăng nhập):</Text>
                  <TextInput style={styles.input} keyboardType="phone-pad" value={editingStaff.phone} onChangeText={(t) => setEditingStaff({...editingStaff, phone: t})} />

                  <Text style={styles.label}>Lương (đ/h):</Text>
                  <TextInput style={styles.input} keyboardType="numeric" value={String(editingStaff.wage || '')} onChangeText={(t) => setEditingStaff({...editingStaff, wage: Number(t)})} />

                  <Text style={styles.label}>Chức vụ:</Text>
                  {editingStaff.role === 'OWNER' ? (
                    <View style={styles.roleRow}>
                      <View style={[styles.roleChip, styles.roleChipActive, {backgroundColor: '#9c27b0', borderColor: '#9c27b0'}]}>
                        <Text style={[styles.roleText, {color:'#fff'}]}>Chủ Quán</Text>
                      </View>
                    </View>
                  ) : (
                    <View style={styles.roleRow}>
                      <TouchableOpacity style={[styles.roleChip, editingStaff.role === 'STAFF' && styles.roleChipActive]} onPress={() => setEditingRole('STAFF')}>
                        <Text style={[styles.roleText, editingStaff.role === 'STAFF' && {color:'#fff'}]}>Nhân Viên</Text>
                      </TouchableOpacity>
                      {currentUser?.role === 'OWNER' && (
                      <TouchableOpacity style={[styles.roleChip, editingStaff.role === 'MANAGER' && styles.roleChipActive]} onPress={() => setEditingRole('MANAGER')}>
                        <Text style={[styles.roleText, editingStaff.role === 'MANAGER' && {color:'#fff'}]}>Quản Lý</Text>
                      </TouchableOpacity>
                      )}
                    </View>
                  )}

                  <Text style={styles.label}>Chi nhánh gốc (Trực thuộc):</Text>
                  <View style={styles.storeSelectRow}>
                    {storeList.map(store => (
                      <TouchableOpacity key={store.id} style={[styles.storeChip, editingStaff.store_id === store.id && styles.storeChipActive]} onPress={() => setEditingStaff({...editingStaff, store_id: store.id})}>
                        <Text style={[styles.storeChipText, editingStaff.store_id === store.id && styles.storeChipTextActive]}>{store.name}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>

                  <Text style={styles.label}>Loại hình làm việc:</Text>
                  <View style={styles.roleRow}>
                    <TouchableOpacity style={[styles.roleChip, editingStaff.is_part_time && styles.roleChipActive]} onPress={() => setEditingStaff({...editingStaff, is_part_time: true})}>
                      <Text style={[styles.roleText, editingStaff.is_part_time && {color:'#fff'}]}>Part-Time</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={[styles.roleChip, !editingStaff.is_part_time && styles.roleChipActive]} onPress={() => setEditingStaff({...editingStaff, is_part_time: false})}>
                      <Text style={[styles.roleText, !editingStaff.is_part_time && {color:'#fff'}]}>Full-Time</Text>
                    </TouchableOpacity>
                  </View>

                  <View style={styles.accessRow}>
                    <Text style={styles.label}>Trạng thái đăng nhập App:</Text>
                    <Switch value={editingStaff.hasAppAccess} onValueChange={(v) => setEditingStaff({...editingStaff, hasAppAccess: v})} />
                  </View>

                  {(currentUser?.role === 'OWNER' || currentUser?.role === 'MANAGER') && (
                    <View style={[styles.permBox, {borderColor: editingStaff.role === 'MANAGER' ? '#e91e63' : '#1976d2'}]}>
                      <Text style={{fontWeight: 'bold', color: editingStaff.role === 'MANAGER' ? '#e91e63' : '#1976d2', marginBottom: 10}}>
                        {editingStaff.role === 'MANAGER' ? '🌐 Cấp quyền xem dữ liệu chi nhánh khác:' : '🌐 Cấp quyền làm việc tại chi nhánh khác:'}
                      </Text>
                      {storeList.map(store => {
                        const isHomeStore = store.id === editingStaff.store_id;
                        return (
                          <View key={store.id} style={styles.permRow}>
                            <Text style={[styles.permRowText, isHomeStore && styles.permRowTextActive]}>{store.name} {isHomeStore && '(Chi nhánh gốc)'}</Text>
                            <Switch
                              value={isHomeStore ? true : !!editingStaff.permissions?.viewable_stores?.includes(store.id)}
                              disabled={isHomeStore}
                              onValueChange={()=>toggleEditViewableStore(store.id)}
                              trackColor={{true: editingStaff.role === 'MANAGER' ? '#e91e63' : '#1976d2'}}
                            />
                          </View>
                        );
                      })}
                      <Text style={{fontSize: 12, color: COLORS.textMuted, marginTop: 10}}>*Nhân sự luôn được gắn quyền với chi nhánh gốc.</Text>
                    </View>
                  )}

                  {editingStaff.role !== 'OWNER' && editingStaff.permissions && (
                    <View style={styles.permBox}>
                      <Text style={[styles.label, {marginTop:0}]}>Phân quyền theo nút ứng dụng:</Text>
                      {renderPermissionRows(editingStaff.permissions, toggleEditPerm, editingStaff.role)}
                    </View>
                  )}

                  {false && editingStaff.role === 'STAFF' && editingStaff.permissions && (
                    <View style={styles.permBox}>
                      <Text style={[styles.label, {marginTop:0}]}>Phân quyền hiển thị:</Text>
                  <View style={styles.permRow}><Text>💵 Thu ngân / Bán hàng</Text><Switch value={!!editingStaff.permissions.cashier} onValueChange={()=>toggleEditPerm('cashier')} /></View>
                      <View style={styles.permRow}><Text>📦 Kiểm Kho / Nhập xuất</Text><Switch value={!!editingStaff.permissions.inventory} onValueChange={()=>toggleEditPerm('inventory')} /></View>
                      <View style={styles.permRow}><Text>⏱️ Chấm công</Text><Switch value={!!editingStaff.permissions.hr} onValueChange={()=>toggleEditPerm('hr')} /></View>
                      <View style={styles.permRow}><Text>💰 Xem lương</Text><Switch value={!!editingStaff.permissions.payroll} onValueChange={()=>toggleEditPerm('payroll')} /></View>
                      <View style={styles.permRow}><Text>📊 Xem Báo cáo</Text><Switch value={!!editingStaff.permissions.reports} onValueChange={()=>toggleEditPerm('reports')} /></View>
                    </View>
                  )}

                  {false && currentUser?.role === 'OWNER' && editingStaff?.role === 'MANAGER' && (
                    <View style={{flexDirection: 'column', gap: 10, marginTop: 15}}>
                      <View style={{flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 15, backgroundColor: '#fdf2f8', borderRadius: 10, borderWidth: 1, borderColor: '#fbcfe8'}}>
                        <View>
                          <Text style={{fontSize: 16, fontWeight: 'bold', color: '#db2777'}}>Quản lý Chính</Text>
                          <Text style={{fontSize: 12, color: '#ec4899', marginTop: 4, maxWidth: 220}}>Quản lý chính có quyền duyệt báo cáo chốt ca (doanh thu) của chi nhánh.</Text>
                        </View>
                        <Switch
                          value={!!editingStaff.permissions?.is_primary_manager}
                          onValueChange={() => toggleEditPerm('is_primary_manager')}
                          trackColor={{false: '#e5e7eb', true: '#fbcfe8'}}
                          thumbColor={editingStaff.permissions?.is_primary_manager ? '#db2777' : '#f4f3f4'}
                        />
                      </View>
                      <View style={{flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 15, backgroundColor: '#e0f2fe', borderRadius: 10, borderWidth: 1, borderColor: '#bae6fd'}}>
                        <View>
                          <Text style={{fontSize: 16, fontWeight: 'bold', color: '#0284c7'}}>Quyền Xếp Lịch & Duyệt Ca</Text>
                          <Text style={{fontSize: 12, color: '#38bdf8', marginTop: 4, maxWidth: 220}}>Được xếp lịch và duyệt đăng ký ca làm việc của nhân sự.</Text>
                        </View>
                        <Switch
                          value={!!editingStaff.permissions?.can_schedule_shift}
                          onValueChange={() => toggleEditPerm('can_schedule_shift')}
                        />
                      </View>
                    </View>
                  )}

                  <View style={{flexDirection: 'row', marginTop: 20}}>
                    <TouchableOpacity style={[styles.createBtn, {flex: 1, marginRight: 10, backgroundColor: '#F44336'}]} onPress={() => setEditingStaff(null)}>
                      <Text style={styles.btnText}>Hủy</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={[styles.createBtn, {flex: 1}]} onPress={saveEditStaff}>
                      <Text style={styles.btnText}>Lưu Thay Đổi</Text>
                    </TouchableOpacity>
                  </View>

                  {currentUser?.role === 'OWNER' && (
                    <TouchableOpacity style={{ marginTop: 20, padding: 15, backgroundColor: '#fee2e2', borderRadius: 8, alignItems: 'center' }} onPress={handleDeleteStaff}>
                      <Text style={{ color: '#ef4444', fontWeight: 'bold' }}>Xóa Nhân Viên Này</Text>
                    </TouchableOpacity>
                  )}
                </ScrollView>
              </View>
            </View>
          )}
        </Modal>

        {canEditPermissions && (
          <TouchableOpacity style={styles.fab} onPress={() => setShowCreateModal(true)}>
            <Ionicons name="add" size={32} color="#fff" />
          </TouchableOpacity>
        )}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const getStyles = (COLORS, isDarkMode) => StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.bg },
  headerRow: { flexDirection: 'row', alignItems: 'center', padding: 20, paddingBottom: 10 },
  backBtn: { padding: 5, marginRight: 10 },
  header: { fontSize: 22, fontWeight: 'bold', color: COLORS.text },
  section: { backgroundColor: COLORS.card, padding: 20, borderRadius: 12, margin: 20, elevation: 2, borderWidth: 1, borderColor: COLORS.border },
  sectionTitle: { fontSize: 16, fontWeight: 'bold', color: COLORS.primary, marginBottom: 15 },
  searchBox: { flexDirection: 'row', alignItems: 'center', backgroundColor: COLORS.inputBg, borderWidth: 1, borderColor: COLORS.inputBorder, borderRadius: 12, paddingHorizontal: 12, marginBottom: 15 },
  searchInput: { flex: 1, minHeight: 44, paddingLeft: 8, color: COLORS.text },
  filterChip: { paddingHorizontal: 16, paddingVertical: 8, backgroundColor: COLORS.inputBg, borderRadius: 20, marginRight: 8, borderWidth: 1, borderColor: COLORS.border },
  filterChipActive: { backgroundColor: '#1976d2', borderColor: '#1976d2' },
  filterChipText: { color: COLORS.textMuted, fontWeight: 'bold' },
  filterChipTextActive: { color: '#fff' },
  label: { fontSize: 14, fontWeight: '600', color: COLORS.text, marginBottom: 5, marginTop: 10 },
  input: { borderWidth: 1, borderColor: COLORS.inputBorder, borderRadius: 8, padding: 12, backgroundColor: COLORS.inputBg, color: COLORS.text, height: 45 },
  passwordHint: { flexDirection: 'row', alignItems: 'center', backgroundColor: isDarkMode ? '#0f2a44' : '#eff6ff', borderRadius: 8, padding: 12, marginTop: 12 },
  passwordHintText: { color: '#1d4ed8', fontWeight: '700', marginLeft: 8 },
  roleRow: { flexDirection: 'row', marginBottom: 10 },
  roleChip: { flex: 1, padding: 10, borderWidth: 1, borderColor: COLORS.border, borderRadius: 8, alignItems: 'center', marginRight: 5 },
  roleChipActive: { backgroundColor: '#1976d2', borderColor: '#1976d2' },
  roleText: { fontWeight: 'bold', color: COLORS.textMuted },
  storeSelectRow: { flexDirection: 'row', marginTop: 5 },
  storeChip: { backgroundColor: COLORS.inputBg, paddingHorizontal: 15, paddingVertical: 8, borderRadius: 20, marginRight: 10, borderWidth: 1, borderColor: COLORS.border },
  storeChipActive: { backgroundColor: '#4CAF50' },
  storeChipText: { color: COLORS.textMuted, fontWeight: 'bold' },
  storeChipTextActive: { color: '#fff' },
  permBox: { backgroundColor: COLORS.inputBg, padding: 15, borderRadius: 8, marginTop: 15, borderWidth: 1, borderColor: COLORS.border },
  permRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 10 },
  permRowText: { color: COLORS.text, fontWeight: '600', flex: 1, paddingRight: 10 },
  permRowTextActive: { color: COLORS.primary, fontWeight: '900' },
  permissionRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: COLORS.border },
  permissionTextBox: { flex: 1, paddingRight: 12 },
  permissionTitle: { color: COLORS.text, fontSize: 14, fontWeight: '800' },
  permissionDesc: { color: COLORS.textMuted, fontSize: 12, lineHeight: 17, marginTop: 3 },
  accessRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 15 },
  createBtn: { backgroundColor: '#4CAF50', padding: 15, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  btnText: { color: '#fff', fontWeight: 'bold', fontSize: 16 },
  staffCard: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 15, borderBottomWidth: 1, borderBottomColor: COLORS.border },
  staffName: { fontSize: 16, fontWeight: 'bold', color: COLORS.text, marginBottom: 5 },
  staffDetail: { color: COLORS.textMuted, fontSize: 13, marginBottom: 2 },
  statusRow: { flexDirection: 'row', marginTop: 5, alignItems: 'center' },
  editBtn: { backgroundColor: isDarkMode ? '#0f2a44' : '#e3f2fd', paddingHorizontal: 15, paddingVertical: 8, borderRadius: 20 },
  editBtnText: { color: '#1976d2', fontWeight: 'bold' },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', padding: 20 },
  modalContent: { backgroundColor: COLORS.card, borderRadius: 12, padding: 20, maxHeight: '80%', borderWidth: 1, borderColor: COLORS.border },
  modalTitle: { fontSize: 20, fontWeight: 'bold', marginBottom: 15, color: COLORS.text, textAlign: 'center' },
  fab: { position: 'absolute', bottom: 30, right: 20, backgroundColor: '#1976d2', width: 60, height: 60, borderRadius: 30, alignItems: 'center', justifyContent: 'center', elevation: 5, shadowColor: '#000', shadowOpacity: 0.3, shadowOffset: { width: 0, height: 2 }, shadowRadius: 5 }
});
