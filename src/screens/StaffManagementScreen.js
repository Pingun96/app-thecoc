import React, { useState, useContext, useMemo } from 'react';
import { Alert, View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput, Switch, Modal, SafeAreaView, KeyboardAvoidingView, Platform, RefreshControl } from 'react-native';
import { AppContext } from '../context/AppContext';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../services/supabaseClient';
import { getBusinessStores } from '../utils/warehouse';

const MODULE_PERMISSIONS = [
  { key: 'cashier', icon: 'ðŸ’µ', title: 'Giao ca / Thu ngÃ¢n', desc: 'Má»Ÿ ca, kiá»ƒm kÃ©t, nháº­p doanh thu vÃ  chá»‘t ca.' },
  { key: 'inventory', icon: 'ðŸ“¦', title: 'Kho hÃ ng', desc: 'Xem tá»“n kho, nháº­p/xuáº¥t, kiá»ƒm kÃª vÃ  lá»‹ch sá»­ kho.' },
  { key: 'central_warehouse', icon: 'ðŸ¬', title: 'Kho tá»•ng', desc: 'Xem tá»“n kho tá»•ng, duyá»‡t xuáº¥t hÃ ng vÃ  Ä‘iá»u phá»‘i Ä‘Æ¡n vá» cá»­a hÃ ng.' },
  { key: 'hr', icon: 'ðŸ‘¥', title: 'NhÃ¢n sá»± / Cháº¥m cÃ´ng', desc: 'Xem nhÃ¢n sá»±, cháº¥m cÃ´ng vÃ  lá»‹ch sá»­ lÃ m viá»‡c.' },
  { key: 'payroll', icon: 'ðŸ’°', title: 'Báº£ng lÆ°Æ¡ng', desc: 'Xem lÆ°Æ¡ng, Ä‘iá»u chá»‰nh vÃ  duyá»‡t/chá»‘t lÆ°Æ¡ng theo quyá»n.' },
  { key: 'finance', icon: 'ðŸ“Š', title: 'TÃ i chÃ­nh / BÃ¡o cÃ¡o', desc: 'Xem doanh thu, bÃ¡o cÃ¡o tÃ i chÃ­nh vÃ  lá»£i nhuáº­n.' },
  { key: 'can_schedule_shift', icon: 'ðŸ—“ï¸', title: 'Xáº¿p lá»‹ch & Duyá»‡t ca', desc: 'Xáº¿p lá»‹ch, duyá»‡t Ä‘Äƒng kÃ½ ca vÃ  Ä‘iá»u Ä‘á»™ng nhÃ¢n sá»±.' },
  { key: 'is_primary_manager', icon: 'âœ…', title: 'Duyá»‡t bÃ¡o cÃ¡o chá»‘t ca', desc: 'Duyá»‡t, tá»« chá»‘i hoáº·c há»§y duyá»‡t bÃ¡o cÃ¡o giao ca.' },
  { key: 'manage_permissions', icon: 'ðŸ”', title: 'Cáº¥p quyá»n nhÃ¢n sá»±', desc: 'Táº¡o tÃ i khoáº£n, sá»­a thÃ´ng tin vÃ  phÃ¢n quyá»n á»©ng dá»¥ng.' },
];

const DEFAULT_STAFF_PERMISSIONS = {
  cashier: false,
  inventory: false,
  central_warehouse: false,
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
  central_warehouse: false,
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
  const businessStores = useMemo(() => getBusinessStores(storeList), [storeList]);

  // OWNER luÃ´n Ä‘Æ°á»£c tháº¥y ALL. Quáº£n lÃ½ thÃ¬ tÃ¹y thuá»™c viewable_stores
  let displayStoreId = currentUser?.store_id;
  if (currentUser?.role === 'OWNER' || currentUser?.permissions?.viewable_stores?.includes(selectedStoreId)) {
    displayStoreId = selectedStoreId;
  }
  if (currentUser?.role === 'OWNER' && selectedStoreId === 'ALL') {
    displayStoreId = 'ALL';
  }

  const [searchQuery, setSearchQuery] = useState('');
  const [localStoreFilter, setLocalStoreFilter] = useState('ALL');

  // Lá»c danh sÃ¡ch nhÃ¢n sá»± theo chi nhÃ¡nh Ä‘Æ°á»£c phÃ©p xem vÃ  chá»‰ láº¥y ngÆ°á»i cÃ²n hoáº¡t Ä‘á»™ng
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

  // === THÃŠM Má»šI NHÃ‚N VIÃŠN ===
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [wage, setWage] = useState('');
  const [storeId, setStoreId] = useState(businessStores[0]?.id || 1);
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
      Alert.alert('ThÃ´ng tin chÆ°a há»£p lá»‡', 'Vui lÃ²ng nháº­p Ä‘áº§y Ä‘á»§ há» tÃªn, sá»‘ Ä‘iá»‡n thoáº¡i vÃ  má»©c lÆ°Æ¡ng.');
      return;
    }
    if (staffList.some((staff) => staff.phone === cleanPhone)) {
      Alert.alert('Sá»‘ Ä‘iá»‡n thoáº¡i Ä‘Ã£ tá»“n táº¡i', 'Vui lÃ²ng dÃ¹ng sá»‘ Ä‘iá»‡n thoáº¡i khÃ¡c.');
      return;
    }

    // Máº·c Ä‘á»‹nh luÃ´n cÃ³ store_id gá»‘c trong viewable_stores
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
      Alert.alert('KhÃ´ng thá»ƒ táº¡o tÃ i khoáº£n', error.message);
      return;
    }

    setStaffList((current) => [...current, newStaff]);
    Alert.alert('ÄÃ£ táº¡o tÃ i khoáº£n', `${cleanName} cÃ³ thá»ƒ Ä‘Äƒng nháº­p báº±ng máº­t kháº©u táº¡m thá»i 123.`);
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
          TÃ i khoáº£n cá»§a báº¡n chÆ°a Ä‘Æ°á»£c cáº¥p quyá»n Ä‘á»ƒ phÃ¢n quyá»n module cho ngÆ°á»i khÃ¡c.
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

  // === CHá»ˆNH Sá»¬A NHÃ‚N VIÃŠN (MODAL) ===
  const [editingStaff, setEditingStaff] = useState(null);

  const openEditModal = (staff) => {
    setEditingStaff({
      ...staff,
      permissions: normalizePermissions(staff.permissions, staff.role, staff.store_id)
    });
  };

  const saveEditStaff = async () => {
    if (!editingStaff.name || !editingStaff.phone || !editingStaff.wage) {
      Alert.alert('Lá»—i', 'KhÃ´ng Ä‘Æ°á»£c Ä‘á»ƒ trá»‘ng thÃ´ng tin!');
      return;
    }
    const cleanPhone = editingStaff.phone.replace(/\s/g, '');
    if (staffList.some((s) => s.phone === cleanPhone && s.id !== editingStaff.id)) {
      Alert.alert('Lá»—i', 'Sá»‘ Ä‘iá»‡n thoáº¡i nÃ y Ä‘Ã£ Ä‘Æ°á»£c sá»­ dá»¥ng cho nhÃ¢n viÃªn khÃ¡c!');
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
      Alert.alert('Lá»—i', 'KhÃ´ng thá»ƒ cáº­p nháº­t nhÃ¢n viÃªn: ' + error.message);
      return;
    }

    setStaffList((current) => current.map(s => s.id === finalStaff.id ? finalStaff : s));
    Alert.alert('ThÃ nh cÃ´ng', 'ThÃ´ng tin nhÃ¢n viÃªn Ä‘Ã£ Ä‘Æ°á»£c lÆ°u.');
    setEditingStaff(null);
  };

  const handleDeleteStaff = (staffId, staffName) => {
    Alert.alert(
      'XÃ³a nhÃ¢n viÃªn',
      `Báº¡n cÃ³ cháº¯c cháº¯n muá»‘n xÃ³a nhÃ¢n viÃªn ${staffName}?\nLÆ°u Ã½: Náº¿u nhÃ¢n viÃªn Ä‘Ã£ cÃ³ lá»‹ch sá»­ lÃ m viá»‡c, báº¡n nÃªn KHÃ“A APP thay vÃ¬ xÃ³a Ä‘á»ƒ giá»¯ láº¡i bÃ¡o cÃ¡o cÅ©.`,
      [
        { text: 'Há»§y', style: 'cancel' },
        {
          text: 'XÃ³a vÄ©nh viá»…n',
          style: 'destructive',
          onPress: async () => {
            setIsLoading(true);
            try {
              const { error } = await supabase.from('users').delete().eq('id', staffId);
              if (error) {
                if (error.code === '23503') {
                  Alert.alert('KhÃ´ng thá»ƒ xÃ³a', 'NhÃ¢n viÃªn nÃ y Ä‘Ã£ cÃ³ dá»¯ liá»‡u lÃ m viá»‡c trong há»‡ thá»‘ng (chá»‘t ca, xáº¿p lá»‹ch, lÆ°Æ¡ng...). Vui lÃ²ng KHÃ“A APP thay vÃ¬ xÃ³a.');
                } else {
                  throw error;
                }
              } else {
                setStaffList(staffList.filter(s => s.id !== staffId));
                Alert.alert('ThÃ nh cÃ´ng', 'ÄÃ£ xÃ³a nhÃ¢n viÃªn.');
              }
            } catch (e) {
              Alert.alert('Lá»—i', e.message);
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
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.flexRoot}>
        <View style={styles.stickyTopBar}>
        <View style={styles.headerRow}>
          <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
            <Ionicons name="arrow-back" size={24} color="#1976d2" />
          </TouchableOpacity>
          <Text style={styles.header}>Quáº£n LÃ½ NhÃ¢n Sá»±</Text>
        </View>

        </View>

        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingBottom: 80 }}
          style={styles.flexRoot}
          refreshControl={
            <RefreshControl refreshing={isDataLoading} onRefresh={refreshData} />
          }
        >
          <View style={styles.section}>
            <View style={styles.searchBox}>
              <Ionicons name="search" size={20} color="#94a3b8" />
              <TextInput
                style={styles.searchInput}
                placeholder="TÃ¬m nhÃ¢n viÃªn theo tÃªn hoáº·c SÄT..."
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

            {displayStoreId === 'ALL' && businessStores.length > 0 && (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 15 }}>
                <TouchableOpacity
                  style={[styles.filterChip, localStoreFilter === 'ALL' && styles.filterChipActive]}
                  onPress={() => setLocalStoreFilter('ALL')}
                >
                  <Text style={[styles.filterChipText, localStoreFilter === 'ALL' && styles.filterChipTextActive]}>Táº¥t cáº£</Text>
                </TouchableOpacity>
                {businessStores.map(store => (
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
              DANH SÃCH NHÃ‚N Sá»° {displayStoreId === 'ALL' ? '(Táº¤T Cáº¢ CHI NHÃNH)' : `(CHI NHÃNH ${displayStoreId})`}
            </Text>
            {filteredStaffList.map(staff => (
              <View key={staff.id} style={styles.staffCard}>
                <View style={{flex: 1}}>
                  <Text style={styles.staffName}>
                    {staff.name} <Text style={{fontSize: 12, color: staff.role === 'MANAGER' ? '#e91e63' : '#1976d2'}}>({staff.role === 'MANAGER' ? 'QUáº¢N LÃ' : 'NHÃ‚N VIÃŠN'})</Text>
                  </Text>
                  <Text style={styles.staffDetail}>SÄT: {staff.phone} - LÆ°Æ¡ng: {staff.wage.toLocaleString()}Ä‘/h</Text>
                  <Text style={styles.staffDetail}>Loáº¡i: <Text style={{fontWeight: 'bold', color: staff.is_part_time ? '#ff9800' : '#4CAF50'}}>{staff.is_part_time ? 'Part-Time' : 'Full-Time'}</Text> - Gá»‘c: {storeList.find(s=>s.id === staff.store_id)?.name}</Text>

                  <View style={styles.statusRow}>
                    <Text style={{fontSize: 12, color: staff.hasAppAccess ? '#4CAF50' : '#F44336', fontWeight: 'bold'}}>
                      {staff.hasAppAccess ? 'ðŸŸ¢ App Má»Ÿ' : 'ðŸ”´ App KhÃ³a'}
                    </Text>
                    {staff.role === 'MANAGER' ? (
                       <Text style={{fontSize: 12, color: '#e91e63', marginLeft: 15, fontWeight: 'bold'}}>
                         Quáº£n lÃ½: {staff.permissions?.viewable_stores?.length || 1} cá»­a hÃ ng
                       </Text>
                    ) : (
                       <Text style={{fontSize: 12, color: '#1976d2', marginLeft: 15, fontWeight: 'bold'}}>
                         LÃ m viá»‡c: {staff.permissions?.viewable_stores?.length || 1} cá»­a hÃ ng
                       </Text>
                    )}
                  </View>
                </View>
                {canEditPermissions && (currentUser?.role === 'OWNER' || staff.role !== 'OWNER') && (
                  <View style={{flexDirection: 'row', gap: 10}}>
                    {currentUser?.role === 'OWNER' && staff.role !== 'OWNER' && (
                    <TouchableOpacity style={[styles.editBtn, {backgroundColor: '#ef4444'}]} onPress={() => handleDeleteStaff(staff.id, staff.name)}>
                      <Text style={[styles.editBtnText, {color: '#fff'}]}>XÃ³a</Text>
                    </TouchableOpacity>
                    )}
                    <TouchableOpacity style={styles.editBtn} onPress={() => openEditModal(staff)}>
                      <Text style={styles.editBtnText}>Sá»­a</Text>
                    </TouchableOpacity>
                  </View>
                )}
              </View>
            ))}
          </View>
        </ScrollView>

        {/* MODAL Táº O Má»šI */}
        <Modal visible={showCreateModal} animationType="slide" transparent>
          <View style={styles.modalOverlay}>
            <View style={styles.modalContent}>
              <Text style={styles.modalTitle}>Táº¡o TÃ i Khoáº£n Má»›i</Text>
              <ScrollView showsVerticalScrollIndicator={false}>

                <Text style={styles.label}>Há» vÃ  tÃªn:</Text>
                <TextInput style={styles.input} placeholder="VD: Nguyá»…n VÄƒn A" value={fullName} onChangeText={setFullName} />

                <View style={{flexDirection:'row', justifyContent:'space-between'}}>
                  <View style={{flex: 1, marginRight: 10}}>
                    <Text style={styles.label}>SÄT (ÄÄƒng nháº­p):</Text>
                    <TextInput style={styles.input} keyboardType="phone-pad" value={phone} onChangeText={setPhone} />
                  </View>
                  <View style={{flex: 1}}>
                    <View style={styles.passwordHint}>
                      <Ionicons name="key-outline" size={18} color="#1d4ed8" />
                      <Text style={styles.passwordHintText}>Máº­t kháº©u Ä‘Äƒng nháº­p táº¡m thá»i: 123</Text>
                    </View>
                  </View>
                </View>

                <Text style={styles.label}>Chá»©c vá»¥:</Text>
                <View style={styles.roleRow}>
                  <TouchableOpacity style={[styles.roleChip, role === 'STAFF' && styles.roleChipActive]} onPress={() => handleRoleChange('STAFF')}>
                    <Text style={[styles.roleText, role === 'STAFF' && {color:'#fff'}]}>NhÃ¢n ViÃªn</Text>
                  </TouchableOpacity>
                  {currentUser?.role === 'OWNER' && (
                  <TouchableOpacity style={[styles.roleChip, role === 'MANAGER' && styles.roleChipActive]} onPress={() => handleRoleChange('MANAGER')}>
                    <Text style={[styles.roleText, role === 'MANAGER' && {color:'#fff'}]}>Quáº£n LÃ½</Text>
                  </TouchableOpacity>
                  )}
                </View>

                <Text style={styles.label}>Má»©c lÆ°Æ¡ng (VNÄ/h):</Text>
                <TextInput style={styles.input} keyboardType="numeric" value={wage} onChangeText={setWage} />

                <Text style={styles.label}>Loáº¡i hÃ¬nh lÃ m viá»‡c:</Text>
                <View style={styles.roleRow}>
                  <TouchableOpacity style={[styles.roleChip, isPartTime && styles.roleChipActive]} onPress={() => setIsPartTime(true)}>
                    <Text style={[styles.roleText, isPartTime && {color:'#fff'}]}>Part-Time</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={[styles.roleChip, !isPartTime && styles.roleChipActive]} onPress={() => setIsPartTime(false)}>
                    <Text style={[styles.roleText, !isPartTime && {color:'#fff'}]}>Full-Time</Text>
                  </TouchableOpacity>
                </View>

                <Text style={styles.label}>Chi nhÃ¡nh gá»‘c (Trá»±c thuá»™c):</Text>
                <View style={styles.storeSelectRow}>
                  {businessStores.map(store => (
                    <TouchableOpacity key={store.id} style={[styles.storeChip, storeId === store.id && styles.storeChipActive]} onPress={() => setStoreId(store.id)}>
                      <Text style={[styles.storeChipText, storeId === store.id && styles.storeChipTextActive]}>{store.name}</Text>
                    </TouchableOpacity>
                  ))}
                </View>

                {(currentUser?.role === 'OWNER' || currentUser?.role === 'MANAGER') && (
                  <View style={[styles.permBox, {borderColor: role === 'MANAGER' ? '#e91e63' : '#1976d2'}]}>
                    <Text style={{fontWeight: 'bold', color: role === 'MANAGER' ? '#e91e63' : '#1976d2', marginBottom: 10}}>
                      {role === 'MANAGER' ? 'ðŸŒ Cáº¥p quyá»n xem dá»¯ liá»‡u chi nhÃ¡nh khÃ¡c:' : 'ðŸŒ Cáº¥p quyá»n lÃ m viá»‡c táº¡i chi nhÃ¡nh khÃ¡c:'}
                    </Text>
                    {businessStores.map(store => {
                      const isHomeStore = store.id === storeId;
                      return (
                        <View key={store.id} style={styles.permRow}>
                          <Text style={[styles.permRowText, isHomeStore && styles.permRowTextActive]}>{store.name} {isHomeStore && '(Chi nhÃ¡nh gá»‘c)'}</Text>
                          <Switch
                            value={isHomeStore ? true : perms.viewable_stores.includes(store.id)}
                            disabled={isHomeStore}
                            onValueChange={()=>toggleViewableStore(store.id)}
                            trackColor={{true: role === 'MANAGER' ? '#e91e63' : '#1976d2'}}
                          />
                        </View>
                      );
                    })}
                    <Text style={{fontSize: 12, color: COLORS.textMuted, marginTop: 10}}>*NhÃ¢n sá»± luÃ´n Ä‘Æ°á»£c gáº¯n quyá»n vá»›i chi nhÃ¡nh gá»‘c.</Text>
                  </View>
                )}

                <View style={styles.permBox}>
                  <Text style={[styles.label, {marginTop:0}]}>PhÃ¢n quyá»n theo nÃºt á»©ng dá»¥ng:</Text>
                  {renderPermissionRows(perms, togglePerm, role)}
                </View>

                {false && role === 'STAFF' && (
                  <View style={styles.permBox}>
                    <Text style={[styles.label, {marginTop:0}]}>Cáº¥p quyá»n sá»­ dá»¥ng tÃ­nh nÄƒng:</Text>
                    <View style={styles.permRow}><Text>ðŸ’µ Thu ngÃ¢n / BÃ¡n hÃ ng</Text><Switch value={perms.cashier} onValueChange={()=>togglePerm('cashier')} /></View>
                    <View style={styles.permRow}><Text>ðŸ“¦ Kiá»ƒm Kho / Nháº­p xuáº¥t</Text><Switch value={perms.inventory} onValueChange={()=>togglePerm('inventory')} /></View>
                    <View style={styles.permRow}><Text>â±ï¸ Cháº¥m cÃ´ng</Text><Switch value={perms.hr} onValueChange={()=>togglePerm('hr')} /></View>
                    <View style={styles.permRow}><Text>ðŸ’° Xem lÆ°Æ¡ng</Text><Switch value={perms.payroll} onValueChange={()=>togglePerm('payroll')} /></View>
                    <View style={styles.permRow}><Text>ðŸ“Š Xem BÃ¡o cÃ¡o</Text><Switch value={perms.reports} onValueChange={()=>togglePerm('reports')} /></View>
                  </View>
                )}

                {false && currentUser?.role === 'OWNER' && role === 'MANAGER' && (
                  <View style={{flexDirection: 'column', gap: 10, marginTop: 15}}>
                    <View style={{flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 15, backgroundColor: '#e0f2fe', borderRadius: 10, borderWidth: 1, borderColor: '#bae6fd'}}>
                      <View>
                        <Text style={{fontSize: 16, fontWeight: 'bold', color: '#0284c7'}}>Quyá»n Xáº¿p Lá»‹ch & Duyá»‡t Ca</Text>
                        <Text style={{fontSize: 12, color: '#38bdf8', marginTop: 4, maxWidth: 220}}>ÄÆ°á»£c xáº¿p lá»‹ch vÃ  duyá»‡t Ä‘Äƒng kÃ½ ca lÃ m viá»‡c cá»§a nhÃ¢n sá»±.</Text>
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
                    <Text style={styles.btnText}>Há»§y</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={[styles.createBtn, {flex: 1}]} onPress={handleCreateStaff}>
                    <Text style={styles.btnText}>Táº¡o Má»›i</Text>
                  </TouchableOpacity>
                </View>
              </ScrollView>
            </View>
          </View>
        </Modal>

        {/* MODAL CHá»ˆNH Sá»¬A */}
        <Modal visible={!!editingStaff} animationType="slide" transparent>
          {editingStaff && (
            <View style={styles.modalOverlay}>
              <View style={styles.modalContent}>
                <Text style={styles.modalTitle}>Chá»‰nh sá»­a thÃ´ng tin</Text>
                <ScrollView showsVerticalScrollIndicator={false}>

                  <Text style={styles.label}>TÃªn:</Text>
                  <TextInput style={styles.input} value={editingStaff.name} onChangeText={(t) => setEditingStaff({...editingStaff, name: t})} />

                  <Text style={styles.label}>Sá»‘ Ä‘iá»‡n thoáº¡i (SÄT Ä‘Äƒng nháº­p):</Text>
                  <TextInput style={styles.input} keyboardType="phone-pad" value={editingStaff.phone} onChangeText={(t) => setEditingStaff({...editingStaff, phone: t})} />

                  <Text style={styles.label}>LÆ°Æ¡ng (Ä‘/h):</Text>
                  <TextInput style={styles.input} keyboardType="numeric" value={String(editingStaff.wage || '')} onChangeText={(t) => setEditingStaff({...editingStaff, wage: Number(t)})} />

                  <Text style={styles.label}>Chá»©c vá»¥:</Text>
                  {editingStaff.role === 'OWNER' ? (
                    <View style={styles.roleRow}>
                      <View style={[styles.roleChip, styles.roleChipActive, {backgroundColor: '#9c27b0', borderColor: '#9c27b0'}]}>
                        <Text style={[styles.roleText, {color:'#fff'}]}>Chá»§ QuÃ¡n</Text>
                      </View>
                    </View>
                  ) : (
                    <View style={styles.roleRow}>
                      <TouchableOpacity style={[styles.roleChip, editingStaff.role === 'STAFF' && styles.roleChipActive]} onPress={() => setEditingRole('STAFF')}>
                        <Text style={[styles.roleText, editingStaff.role === 'STAFF' && {color:'#fff'}]}>NhÃ¢n ViÃªn</Text>
                      </TouchableOpacity>
                      {currentUser?.role === 'OWNER' && (
                      <TouchableOpacity style={[styles.roleChip, editingStaff.role === 'MANAGER' && styles.roleChipActive]} onPress={() => setEditingRole('MANAGER')}>
                        <Text style={[styles.roleText, editingStaff.role === 'MANAGER' && {color:'#fff'}]}>Quáº£n LÃ½</Text>
                      </TouchableOpacity>
                      )}
                    </View>
                  )}

                  <Text style={styles.label}>Chi nhÃ¡nh gá»‘c (Trá»±c thuá»™c):</Text>
                  <View style={styles.storeSelectRow}>
                    {businessStores.map(store => (
                      <TouchableOpacity key={store.id} style={[styles.storeChip, editingStaff.store_id === store.id && styles.storeChipActive]} onPress={() => setEditingStaff({...editingStaff, store_id: store.id})}>
                        <Text style={[styles.storeChipText, editingStaff.store_id === store.id && styles.storeChipTextActive]}>{store.name}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>

                  <Text style={styles.label}>Loáº¡i hÃ¬nh lÃ m viá»‡c:</Text>
                  <View style={styles.roleRow}>
                    <TouchableOpacity style={[styles.roleChip, editingStaff.is_part_time && styles.roleChipActive]} onPress={() => setEditingStaff({...editingStaff, is_part_time: true})}>
                      <Text style={[styles.roleText, editingStaff.is_part_time && {color:'#fff'}]}>Part-Time</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={[styles.roleChip, !editingStaff.is_part_time && styles.roleChipActive]} onPress={() => setEditingStaff({...editingStaff, is_part_time: false})}>
                      <Text style={[styles.roleText, !editingStaff.is_part_time && {color:'#fff'}]}>Full-Time</Text>
                    </TouchableOpacity>
                  </View>

                  <View style={styles.accessRow}>
                    <Text style={styles.label}>Tráº¡ng thÃ¡i Ä‘Äƒng nháº­p App:</Text>
                    <Switch value={editingStaff.hasAppAccess} onValueChange={(v) => setEditingStaff({...editingStaff, hasAppAccess: v})} />
                  </View>

                  {(currentUser?.role === 'OWNER' || currentUser?.role === 'MANAGER') && (
                    <View style={[styles.permBox, {borderColor: editingStaff.role === 'MANAGER' ? '#e91e63' : '#1976d2'}]}>
                      <Text style={{fontWeight: 'bold', color: editingStaff.role === 'MANAGER' ? '#e91e63' : '#1976d2', marginBottom: 10}}>
                        {editingStaff.role === 'MANAGER' ? 'ðŸŒ Cáº¥p quyá»n xem dá»¯ liá»‡u chi nhÃ¡nh khÃ¡c:' : 'ðŸŒ Cáº¥p quyá»n lÃ m viá»‡c táº¡i chi nhÃ¡nh khÃ¡c:'}
                      </Text>
                      {businessStores.map(store => {
                        const isHomeStore = store.id === editingStaff.store_id;
                        return (
                          <View key={store.id} style={styles.permRow}>
                            <Text style={[styles.permRowText, isHomeStore && styles.permRowTextActive]}>{store.name} {isHomeStore && '(Chi nhÃ¡nh gá»‘c)'}</Text>
                            <Switch
                              value={isHomeStore ? true : !!editingStaff.permissions?.viewable_stores?.includes(store.id)}
                              disabled={isHomeStore}
                              onValueChange={()=>toggleEditViewableStore(store.id)}
                              trackColor={{true: editingStaff.role === 'MANAGER' ? '#e91e63' : '#1976d2'}}
                            />
                          </View>
                        );
                      })}
                      <Text style={{fontSize: 12, color: COLORS.textMuted, marginTop: 10}}>*NhÃ¢n sá»± luÃ´n Ä‘Æ°á»£c gáº¯n quyá»n vá»›i chi nhÃ¡nh gá»‘c.</Text>
                    </View>
                  )}

                  {editingStaff.role !== 'OWNER' && editingStaff.permissions && (
                    <View style={styles.permBox}>
                      <Text style={[styles.label, {marginTop:0}]}>PhÃ¢n quyá»n theo nÃºt á»©ng dá»¥ng:</Text>
                      {renderPermissionRows(editingStaff.permissions, toggleEditPerm, editingStaff.role)}
                    </View>
                  )}

                  {false && editingStaff.role === 'STAFF' && editingStaff.permissions && (
                    <View style={styles.permBox}>
                      <Text style={[styles.label, {marginTop:0}]}>PhÃ¢n quyá»n hiá»ƒn thá»‹:</Text>
                  <View style={styles.permRow}><Text>ðŸ’µ Thu ngÃ¢n / BÃ¡n hÃ ng</Text><Switch value={!!editingStaff.permissions.cashier} onValueChange={()=>toggleEditPerm('cashier')} /></View>
                      <View style={styles.permRow}><Text>ðŸ“¦ Kiá»ƒm Kho / Nháº­p xuáº¥t</Text><Switch value={!!editingStaff.permissions.inventory} onValueChange={()=>toggleEditPerm('inventory')} /></View>
                      <View style={styles.permRow}><Text>â±ï¸ Cháº¥m cÃ´ng</Text><Switch value={!!editingStaff.permissions.hr} onValueChange={()=>toggleEditPerm('hr')} /></View>
                      <View style={styles.permRow}><Text>ðŸ’° Xem lÆ°Æ¡ng</Text><Switch value={!!editingStaff.permissions.payroll} onValueChange={()=>toggleEditPerm('payroll')} /></View>
                      <View style={styles.permRow}><Text>ðŸ“Š Xem BÃ¡o cÃ¡o</Text><Switch value={!!editingStaff.permissions.reports} onValueChange={()=>toggleEditPerm('reports')} /></View>
                    </View>
                  )}

                  {false && currentUser?.role === 'OWNER' && editingStaff?.role === 'MANAGER' && (
                    <View style={{flexDirection: 'column', gap: 10, marginTop: 15}}>
                      <View style={{flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 15, backgroundColor: '#fdf2f8', borderRadius: 10, borderWidth: 1, borderColor: '#fbcfe8'}}>
                        <View>
                          <Text style={{fontSize: 16, fontWeight: 'bold', color: '#db2777'}}>Quáº£n lÃ½ ChÃ­nh</Text>
                          <Text style={{fontSize: 12, color: '#ec4899', marginTop: 4, maxWidth: 220}}>Quáº£n lÃ½ chÃ­nh cÃ³ quyá»n duyá»‡t bÃ¡o cÃ¡o chá»‘t ca (doanh thu) cá»§a chi nhÃ¡nh.</Text>
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
                          <Text style={{fontSize: 16, fontWeight: 'bold', color: '#0284c7'}}>Quyá»n Xáº¿p Lá»‹ch & Duyá»‡t Ca</Text>
                          <Text style={{fontSize: 12, color: '#38bdf8', marginTop: 4, maxWidth: 220}}>ÄÆ°á»£c xáº¿p lá»‹ch vÃ  duyá»‡t Ä‘Äƒng kÃ½ ca lÃ m viá»‡c cá»§a nhÃ¢n sá»±.</Text>
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
                      <Text style={styles.btnText}>Há»§y</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={[styles.createBtn, {flex: 1}]} onPress={saveEditStaff}>
                      <Text style={styles.btnText}>LÆ°u Thay Äá»•i</Text>
                    </TouchableOpacity>
                  </View>

                  {currentUser?.role === 'OWNER' && (
                    <TouchableOpacity style={{ marginTop: 20, padding: 15, backgroundColor: '#fee2e2', borderRadius: 8, alignItems: 'center' }} onPress={handleDeleteStaff}>
                      <Text style={{ color: '#ef4444', fontWeight: 'bold' }}>XÃ³a NhÃ¢n ViÃªn NÃ y</Text>
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
  container: { flex: 1, minHeight: 0, overflow: Platform.OS === 'web' ? 'visible' : 'hidden', backgroundColor: COLORS.bg },
  flexRoot: { flex: 1, minHeight: 0 },
  stickyTopBar: { backgroundColor: COLORS.bg, ...(Platform.OS === 'web' ? { position: 'sticky', top: 0, zIndex: 40 } : null) },
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
