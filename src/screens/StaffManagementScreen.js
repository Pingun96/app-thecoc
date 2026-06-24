import React, { useState, useContext } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput, Switch, Modal, SafeAreaView, KeyboardAvoidingView, Platform } from 'react-native';
import { AppContext } from '../../App';
import { Ionicons } from '@expo/vector-icons';

export default function StaffManagementScreen({ navigation }) {
  const { staffList, setStaffList, storeList, currentUser, selectedStoreId } = useContext(AppContext);

  // OWNER luôn được thấy ALL. Quản lý thì tùy thuộc viewable_stores
  let displayStoreId = currentUser?.store_id;
  if (currentUser?.role === 'OWNER' || currentUser?.permissions?.viewable_stores?.includes(selectedStoreId)) {
    displayStoreId = selectedStoreId;
  }
  if (currentUser?.role === 'OWNER' && selectedStoreId === 'ALL') {
    displayStoreId = 'ALL';
  }

  // Lọc danh sách nhân sự theo chi nhánh được phép xem
  const filteredStaffList = staffList.filter(s => displayStoreId === 'ALL' || s.store_id === displayStoreId);

  // === THÊM MỚI NHÂN VIÊN ===
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [wage, setWage] = useState('');
  const [storeId, setStoreId] = useState(storeList[0]?.id || 1);
  const [role, setRole] = useState('STAFF');
  const [hasAccess, setHasAccess] = useState(true);
  const [perms, setPerms] = useState({ reports: false, inventory: true, cashier: true, hr: true, payroll: true, viewable_stores: [] });

  const handleCreateStaff = () => {
    if (!fullName || !phone || !password || !wage) {
      alert('Vui lòng điền đầy đủ thông tin!'); return;
    }
    
    // Mặc định luôn có store_id gốc trong viewable_stores
    let finalViewableStores = role === 'MANAGER' ? [...new Set([...perms.viewable_stores, storeId])] : [storeId];

    const newStaff = {
      id: `staff_${Date.now()}`,
      name: fullName,
      phone: phone,
      wage: Number(wage),
      store_id: storeId,
      role: role,
      hasAppAccess: hasAccess,
      permissions: role === 'MANAGER' 
        ? { reports: true, inventory: true, cashier: true, hr: true, payroll: true, viewable_stores: finalViewableStores } 
        : { ...perms, viewable_stores: [storeId] }
    };
    setStaffList([...staffList, newStaff]);
    alert(`Đã tạo tài khoản cho ${fullName}`);
    setFullName(''); setPhone(''); setPassword(''); setWage(''); setPerms({...perms, viewable_stores: []});
    setShowCreateModal(false);
  };

  const togglePerm = (key) => setPerms({ ...perms, [key]: !perms[key] });
  
  const toggleViewableStore = (id) => {
    if (perms.viewable_stores.includes(id)) {
      setPerms({...perms, viewable_stores: perms.viewable_stores.filter(s => s !== id)});
    } else {
      setPerms({...perms, viewable_stores: [...perms.viewable_stores, id]});
    }
  };

  // === CHỈNH SỬA NHÂN VIÊN (MODAL) ===
  const [editingStaff, setEditingStaff] = useState(null);

  const openEditModal = (staff) => {
    setEditingStaff({ 
      ...staff,
      permissions: staff.permissions || { reports: false, inventory: true, cashier: true, hr: true, payroll: true, viewable_stores: [staff.store_id] }
    });
  };

  const saveEditStaff = () => {
    if (!editingStaff.name || !editingStaff.phone || !editingStaff.wage) {
      alert('Không được để trống thông tin!'); return;
    }
    
    let finalViewableStores = editingStaff.role === 'MANAGER' 
      ? [...new Set([...(editingStaff.permissions.viewable_stores || []), editingStaff.store_id])] 
      : [editingStaff.store_id];

    const finalStaff = {
      ...editingStaff,
      permissions: editingStaff.role === 'MANAGER' 
        ? { reports: true, inventory: true, cashier: true, hr: true, payroll: true, viewable_stores: finalViewableStores } 
        : { ...editingStaff.permissions, viewable_stores: finalViewableStores }
    };

    setStaffList(staffList.map(s => s.id === finalStaff.id ? finalStaff : s));
    alert('Đã cập nhật thông tin thành công!');
    setEditingStaff(null);
  };

  const toggleEditPerm = (key) => {
    setEditingStaff(prev => ({ ...prev, permissions: { ...prev.permissions, [key]: !prev.permissions[key] } }));
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

        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 80 }} style={{ flex: 1 }}>
          <View style={styles.section}>
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
                  <Text style={styles.staffDetail}>Chi nhánh gốc: {storeList.find(s=>s.id === staff.store_id)?.name}</Text>
                  
                  <View style={styles.statusRow}>
                    <Text style={{fontSize: 12, color: staff.hasAppAccess ? '#4CAF50' : '#F44336', fontWeight: 'bold'}}>
                      {staff.hasAppAccess ? '🟢 App Mở' : '🔴 App Khóa'}
                    </Text>
                    {staff.role === 'MANAGER' && (
                       <Text style={{fontSize: 12, color: '#e91e63', marginLeft: 15, fontWeight: 'bold'}}>
                         Quản lý: {staff.permissions?.viewable_stores?.length || 1} cửa hàng
                       </Text>
                    )}
                  </View>
                </View>
                <TouchableOpacity style={styles.editBtn} onPress={() => openEditModal(staff)}>
                  <Text style={styles.editBtnText}>Sửa</Text>
                </TouchableOpacity>
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
                    <Text style={styles.label}>Mật khẩu:</Text>
                    <TextInput style={styles.input} secureTextEntry value={password} onChangeText={setPassword} />
                  </View>
                </View>

                <Text style={styles.label}>Chức vụ:</Text>
                <View style={styles.roleRow}>
                  <TouchableOpacity style={[styles.roleChip, role === 'STAFF' && styles.roleChipActive]} onPress={() => setRole('STAFF')}>
                    <Text style={[styles.roleText, role === 'STAFF' && {color:'#fff'}]}>Nhân Viên</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={[styles.roleChip, role === 'MANAGER' && styles.roleChipActive]} onPress={() => setRole('MANAGER')}>
                    <Text style={[styles.roleText, role === 'MANAGER' && {color:'#fff'}]}>Quản Lý</Text>
                  </TouchableOpacity>
                </View>

                <Text style={styles.label}>Mức lương (VNĐ/h):</Text>
                <TextInput style={styles.input} keyboardType="numeric" value={wage} onChangeText={setWage} />

                <Text style={styles.label}>Chi nhánh gốc (Trực thuộc):</Text>
                <View style={styles.storeSelectRow}>
                  {storeList.map(store => (
                    <TouchableOpacity key={store.id} style={[styles.storeChip, storeId === store.id && styles.storeChipActive]} onPress={() => setStoreId(store.id)}>
                      <Text style={[styles.storeChipText, storeId === store.id && styles.storeChipTextActive]}>{store.name}</Text>
                    </TouchableOpacity>
                  ))}
                </View>

                {role === 'MANAGER' && (currentUser?.role === 'OWNER') && (
                  <View style={[styles.permBox, {borderColor: '#e91e63'}]}>
                    <Text style={{fontWeight: 'bold', color: '#e91e63', marginBottom: 10}}>🌐 Cấp quyền xem chi nhánh khác:</Text>
                    {storeList.map(store => {
                      const isHomeStore = store.id === storeId;
                      return (
                        <View key={store.id} style={styles.permRow}>
                          <Text style={isHomeStore ? {fontWeight: 'bold', color: '#1976d2'} : {}}>{store.name} {isHomeStore && '(Chi nhánh gốc)'}</Text>
                          <Switch 
                            value={isHomeStore ? true : perms.viewable_stores.includes(store.id)} 
                            disabled={isHomeStore}
                            onValueChange={()=>toggleViewableStore(store.id)} 
                            trackColor={{true: '#e91e63'}} 
                          />
                        </View>
                      );
                    })}
                    <Text style={{fontSize: 12, color: '#666', marginTop: 10}}>*Quản lý luôn được xem dữ liệu của chi nhánh gốc.</Text>
                  </View>
                )}

                {role === 'STAFF' && (
                  <View style={styles.permBox}>
                    <Text style={[styles.label, {marginTop:0}]}>Cấp quyền sử dụng tính năng:</Text>
                    <View style={styles.permRow}><Text>💵 Thu ngân / Bán hàng</Text><Switch value={perms.cashier} onValueChange={()=>togglePerm('cashier')} /></View>
                    <View style={styles.permRow}><Text>📦 Kiểm Kho / Nhập xuất</Text><Switch value={perms.inventory} onValueChange={()=>togglePerm('inventory')} /></View>
                    <View style={styles.permRow}><Text>⏱️ Chấm công</Text><Switch value={perms.hr} onValueChange={()=>togglePerm('hr')} /></View>
                    <View style={styles.permRow}><Text>💰 Xem lương</Text><Switch value={perms.payroll} onValueChange={()=>togglePerm('payroll')} /></View>
                    <View style={styles.permRow}><Text>📊 Xem Báo cáo</Text><Switch value={perms.reports} onValueChange={()=>togglePerm('reports')} /></View>
                  </View>
                )}

                <View style={{flexDirection: 'row', marginTop: 25}}>
                  <TouchableOpacity style={[styles.createBtn, {flex: 1, marginRight: 10, backgroundColor: '#F44336'}]} onPress={() => setShowCreateModal(false)}>
                    <Text style={styles.btnText}>Hủy</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={[styles.createBtn, {flex: 1, marginTop: 0}]} onPress={handleCreateStaff}>
                    <Text style={styles.btnText}>Tạo Mới</Text>
                  </TouchableOpacity>
                </View>
              </ScrollView>
            </View>
          </View>
        </Modal>

        {/* MODAL CHỈNH SỬA */}
        <Modal visible={!!editingStaff} animationType="slide" transparent>
          <View style={styles.modalOverlay}>
            <View style={styles.modalContent}>
              <Text style={styles.modalTitle}>Chỉnh sửa thông tin</Text>
              <ScrollView showsVerticalScrollIndicator={false}>
                
                <Text style={styles.label}>Tên:</Text>
                <TextInput style={styles.input} value={editingStaff?.name} onChangeText={(t) => setEditingStaff({...editingStaff, name: t})} />

                <Text style={styles.label}>Lương (đ/h):</Text>
                <TextInput style={styles.input} keyboardType="numeric" value={String(editingStaff?.wage || '')} onChangeText={(t) => setEditingStaff({...editingStaff, wage: Number(t)})} />
                
                <Text style={styles.label}>Chức vụ:</Text>
                <View style={styles.roleRow}>
                  <TouchableOpacity style={[styles.roleChip, editingStaff?.role === 'STAFF' && styles.roleChipActive]} onPress={() => setEditingStaff({...editingStaff, role: 'STAFF'})}>
                    <Text style={[styles.roleText, editingStaff?.role === 'STAFF' && {color:'#fff'}]}>Nhân Viên</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={[styles.roleChip, editingStaff?.role === 'MANAGER' && styles.roleChipActive]} onPress={() => setEditingStaff({...editingStaff, role: 'MANAGER'})}>
                    <Text style={[styles.roleText, editingStaff?.role === 'MANAGER' && {color:'#fff'}]}>Quản Lý</Text>
                  </TouchableOpacity>
                </View>

                <View style={styles.accessRow}>
                  <Text style={styles.label}>Trạng thái đăng nhập App:</Text>
                  <Switch value={editingStaff?.hasAppAccess} onValueChange={(v) => setEditingStaff({...editingStaff, hasAppAccess: v})} />
                </View>

                {editingStaff?.role === 'MANAGER' && (currentUser?.role === 'OWNER') && (
                  <View style={[styles.permBox, {borderColor: '#e91e63'}]}>
                    <Text style={{fontWeight: 'bold', color: '#e91e63', marginBottom: 10}}>🌐 Cấp quyền xem chi nhánh khác:</Text>
                    {storeList.map(store => {
                      const isHomeStore = store.id === editingStaff.store_id;
                      return (
                        <View key={store.id} style={styles.permRow}>
                          <Text style={isHomeStore ? {fontWeight: 'bold', color: '#1976d2'} : {}}>{store.name} {isHomeStore && '(Chi nhánh gốc)'}</Text>
                          <Switch 
                            value={isHomeStore ? true : editingStaff.permissions?.viewable_stores?.includes(store.id)} 
                            disabled={isHomeStore}
                            onValueChange={()=>toggleEditViewableStore(store.id)} 
                            trackColor={{true: '#e91e63'}} 
                          />
                        </View>
                      );
                    })}
                    <Text style={{fontSize: 12, color: '#666', marginTop: 10}}>*Quản lý luôn được xem dữ liệu của chi nhánh gốc.</Text>
                  </View>
                )}

                {editingStaff?.role === 'STAFF' && editingStaff?.permissions && (
                  <View style={styles.permBox}>
                    <Text style={[styles.label, {marginTop:0}]}>Phân quyền hiển thị:</Text>
                    <View style={styles.permRow}><Text>💵 Thu ngân / Bán hàng</Text><Switch value={editingStaff.permissions.cashier} onValueChange={()=>toggleEditPerm('cashier')} /></View>
                    <View style={styles.permRow}><Text>📦 Kiểm Kho / Nhập xuất</Text><Switch value={editingStaff.permissions.inventory} onValueChange={()=>toggleEditPerm('inventory')} /></View>
                    <View style={styles.permRow}><Text>⏱️ Chấm công</Text><Switch value={editingStaff.permissions.hr} onValueChange={()=>toggleEditPerm('hr')} /></View>
                    <View style={styles.permRow}><Text>💰 Xem lương</Text><Switch value={editingStaff.permissions.payroll} onValueChange={()=>toggleEditPerm('payroll')} /></View>
                    <View style={styles.permRow}><Text>📊 Xem Báo cáo</Text><Switch value={editingStaff.permissions.reports} onValueChange={()=>toggleEditPerm('reports')} /></View>
                  </View>
                )}

                <View style={{flexDirection: 'row', marginTop: 20}}>
                  <TouchableOpacity style={[styles.createBtn, {flex: 1, marginRight: 10, backgroundColor: '#F44336'}]} onPress={() => setEditingStaff(null)}>
                    <Text style={styles.btnText}>Hủy</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={[styles.createBtn, {flex: 1, marginTop: 0}]} onPress={saveEditStaff}>
                    <Text style={styles.btnText}>Lưu Thay Đổi</Text>
                  </TouchableOpacity>
                </View>
              </ScrollView>
            </View>
          </View>
        </Modal>

        <TouchableOpacity style={styles.fab} onPress={() => setShowCreateModal(true)}>
          <Ionicons name="add" size={32} color="#fff" />
        </TouchableOpacity>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f0f2f5' },
  headerRow: { flexDirection: 'row', alignItems: 'center', padding: 20, paddingBottom: 10 },
  backBtn: { padding: 5, marginRight: 10 },
  header: { fontSize: 22, fontWeight: 'bold', color: '#1f2937' },
  section: { backgroundColor: '#fff', padding: 20, borderRadius: 12, margin: 20, elevation: 2 },
  sectionTitle: { fontSize: 16, fontWeight: 'bold', color: '#1976d2', marginBottom: 15 },
  label: { fontSize: 14, fontWeight: '600', color: '#555', marginBottom: 5, marginTop: 10 },
  input: { borderWidth: 1, borderColor: '#ccc', borderRadius: 8, padding: 12, backgroundColor: '#fafafa', height: 45 },
  roleRow: { flexDirection: 'row', marginBottom: 10 },
  roleChip: { flex: 1, padding: 10, borderWidth: 1, borderColor: '#ccc', borderRadius: 8, alignItems: 'center', marginRight: 5 },
  roleChipActive: { backgroundColor: '#1976d2', borderColor: '#1976d2' },
  roleText: { fontWeight: 'bold', color: '#555' },
  storeSelectRow: { flexDirection: 'row', marginTop: 5 },
  storeChip: { backgroundColor: '#e0e0e0', paddingHorizontal: 15, paddingVertical: 8, borderRadius: 20, marginRight: 10 },
  storeChipActive: { backgroundColor: '#4CAF50' },
  storeChipText: { color: '#555', fontWeight: 'bold' },
  storeChipTextActive: { color: '#fff' },
  permBox: { backgroundColor: '#f9fafb', padding: 15, borderRadius: 8, marginTop: 15, borderWidth: 1, borderColor: '#eee' },
  permRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 10 },
  accessRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 15 },
  createBtn: { backgroundColor: '#4CAF50', padding: 15, borderRadius: 8, alignItems: 'center', marginTop: 25 },
  btnText: { color: '#fff', fontWeight: 'bold', fontSize: 16 },
  staffCard: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 15, borderBottomWidth: 1, borderBottomColor: '#eee' },
  staffName: { fontSize: 16, fontWeight: 'bold', color: '#333', marginBottom: 5 },
  staffDetail: { color: '#666', fontSize: 13, marginBottom: 2 },
  statusRow: { flexDirection: 'row', marginTop: 5, alignItems: 'center' },
  editBtn: { backgroundColor: '#e3f2fd', paddingHorizontal: 15, paddingVertical: 8, borderRadius: 20 },
  editBtnText: { color: '#1976d2', fontWeight: 'bold' },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', padding: 20 },
  modalContent: { backgroundColor: '#fff', borderRadius: 12, padding: 20, maxHeight: '80%' },
  modalTitle: { fontSize: 20, fontWeight: 'bold', marginBottom: 15, color: '#1f2937', textAlign: 'center' },
  fab: { position: 'absolute', bottom: 30, right: 20, backgroundColor: '#1976d2', width: 60, height: 60, borderRadius: 30, alignItems: 'center', justifyContent: 'center', elevation: 5, shadowColor: '#000', shadowOpacity: 0.3, shadowOffset: { width: 0, height: 2 }, shadowRadius: 5 }
});
