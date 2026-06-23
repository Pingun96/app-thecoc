import React, { useState, useContext } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, TextInput, Modal, SafeAreaView, KeyboardAvoidingView, Platform } from 'react-native';
import { AppContext } from '../../App';
import { Ionicons } from '@expo/vector-icons';

export default function InventoryScreen({ navigation }) {
  const { currentUser, inventoryItems, setInventoryItems, inventoryLogs, setInventoryLogs, selectedStoreId, storeList } = useContext(AppContext);

  // === ROLE & PERMISSION LOGIC ===
  const isOwner = currentUser?.role === 'OWNER';
  const isManager = currentUser?.role === 'MANAGER';
  const isStaff = currentUser?.role === 'STAFF';
  
  const viewableStores = currentUser?.permissions?.viewable_stores || [];
  let storeIdToView = currentUser?.store_id;
  if (isOwner || viewableStores.includes(selectedStoreId)) {
    storeIdToView = selectedStoreId;
  }
  if (isOwner && selectedStoreId === 'ALL') {
    storeIdToView = 'ALL';
  }

  // Lọc items của chi nhánh đang xét
  const myItems = inventoryItems.filter(item => storeIdToView === 'ALL' || item.store_id === storeIdToView);
  
  // Tính toán Tồn Kho Hiện Tại
  const stockData = myItems.map(item => {
    const logs = inventoryLogs.filter(log => log.itemId === item.id && (storeIdToView === 'ALL' || log.store_id === storeIdToView));
    const imported = logs.filter(l => l.type === 'IMPORT' || l.type === 'ADJUST_UP').reduce((sum, l) => sum + l.amount, 0);
    const exported = logs.filter(l => l.type === 'EXPORT' || l.type === 'ADJUST_DOWN').reduce((sum, l) => sum + l.amount, 0);
    const currentStock = imported - exported;
    const isLowStock = currentStock < item.safeLevel;
    return { ...item, currentStock, isLowStock, logs };
  });

  // TABS STATE
  // Tab 1: Tổng quan (Overview), Tab 2: Thao tác (Action), Tab 3: Sổ Kho & Danh mục (Catalog/Logs)
  const defaultTab = isStaff ? 'ACTION' : 'OVERVIEW';
  const [activeTab, setActiveTab] = useState(defaultTab);

  // === TAB 2: THAO TÁC KHO ===
  const [selectedItemAction, setSelectedItemAction] = useState(myItems[0]?.id || '');
  const [actionType, setActionType] = useState('EXPORT'); // EXPORT, IMPORT, STOCKTAKE
  const [amountAction, setAmountAction] = useState('');

  const handleSubmitAction = () => {
    if (!selectedItemAction || !amountAction) {
      alert('Vui lòng nhập đủ thông tin!'); return;
    }
    const val = Number(amountAction);
    if (isNaN(val) || val <= 0) {
      alert('Số lượng không hợp lệ!'); return;
    }

    // Nếu là STOCKTAKE (Kiểm kê cân bằng kho)
    if (actionType === 'STOCKTAKE') {
      const itemData = stockData.find(i => i.id === selectedItemAction);
      const diff = val - itemData.currentStock;
      if (diff === 0) {
        alert('Số lượng khớp với phần mềm. Không cần cân bằng!'); return;
      }
      const type = diff > 0 ? 'ADJUST_UP' : 'ADJUST_DOWN';
      const newLog = {
        id: `log_${Date.now()}`,
        itemId: selectedItemAction,
        type: type,
        amount: Math.abs(diff),
        date: new Date().toLocaleDateString('vi-VN') + ' ' + new Date().toLocaleTimeString('vi-VN', {hour: '2-digit', minute:'2-digit'}),
        store_id: storeIdToView === 'ALL' ? itemData.store_id : storeIdToView,
        user_name: currentUser.name
      };
      setInventoryLogs([...inventoryLogs, newLog]);
      alert(`Đã kiểm kê! Chênh lệch: ${diff > 0 ? '+' : ''}${diff}. Đã tạo bút toán cân bằng kho.`);
      setAmountAction('');
      return;
    }

    // Nếu là EXPORT / IMPORT
    const newLog = {
      id: `log_${Date.now()}`,
      itemId: selectedItemAction,
      type: actionType,
      amount: val,
      date: new Date().toLocaleDateString('vi-VN') + ' ' + new Date().toLocaleTimeString('vi-VN', {hour: '2-digit', minute:'2-digit'}),
      store_id: storeIdToView === 'ALL' ? myItems.find(i=>i.id===selectedItemAction)?.store_id : storeIdToView,
      user_name: currentUser.name
    };
    setInventoryLogs([newLog, ...inventoryLogs]);
    alert('Đã ghi nhận giao dịch kho!');
    setAmountAction('');
  };

  // === TAB 3: DANH MỤC & SỔ KHO ===
  const [showCreateItemModal, setShowCreateItemModal] = useState(false);
  const [newItemName, setNewItemName] = useState('');
  const [newItemUnit, setNewItemUnit] = useState('kg');
  const [newItemSafeLevel, setNewItemSafeLevel] = useState('5');

  const handleCreateItem = () => {
    if (!newItemName || !newItemUnit || !newItemSafeLevel) {
      alert('Vui lòng điền đủ thông tin!'); return;
    }
    if (storeIdToView === 'ALL') {
      alert('Vui lòng chọn 1 chi nhánh cụ thể ở ngoài Dashboard để thêm nguyên liệu vào kho đó!');
      return;
    }
    const newItem = {
      id: `item_${Date.now()}`,
      name: newItemName,
      unit: newItemUnit,
      safeLevel: Number(newItemSafeLevel),
      store_id: storeIdToView
    };
    setInventoryItems([...inventoryItems, newItem]);
    alert('Đã thêm nguyên liệu mới!');
    setNewItemName(''); setShowCreateItemModal(false);
  };


  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{flex: 1}}>
        <View style={styles.headerRow}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={24} color="#1976d2" />
        </TouchableOpacity>
        <Text style={styles.header}>Quản Lý Kho Hàng</Text>
      </View>

      {/* TAB NAVIGATION */}
      <View style={styles.tabContainer}>
        {(!isStaff) && (
          <TouchableOpacity style={[styles.tabBtn, activeTab === 'OVERVIEW' && styles.tabBtnActive]} onPress={() => setActiveTab('OVERVIEW')}>
            <Text style={[styles.tabText, activeTab === 'OVERVIEW' && styles.tabTextActive]}>Tổng Quan</Text>
          </TouchableOpacity>
        )}
        <TouchableOpacity style={[styles.tabBtn, activeTab === 'ACTION' && styles.tabBtnActive]} onPress={() => setActiveTab('ACTION')}>
          <Text style={[styles.tabText, activeTab === 'ACTION' && styles.tabTextActive]}>Thao Tác</Text>
        </TouchableOpacity>
        {(!isStaff) && (
          <TouchableOpacity style={[styles.tabBtn, activeTab === 'LOGS' && styles.tabBtnActive]} onPress={() => setActiveTab('LOGS')}>
            <Text style={[styles.tabText, activeTab === 'LOGS' && styles.tabTextActive]}>Sổ Kho & Danh Mục</Text>
          </TouchableOpacity>
        )}
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 80 }} style={{ flex: 1 }}>
        
        {/* === TAB 1: OVERVIEW === */}
        {activeTab === 'OVERVIEW' && !isStaff && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Tình Trạng Tồn Kho {storeIdToView !== 'ALL' && `(CN ${storeIdToView})`}</Text>
            <View style={styles.gridContainer}>
              {stockData.length === 0 && <Text style={{color: '#888'}}>Chưa có mặt hàng nào.</Text>}
              {stockData.map(item => (
                <View key={item.id} style={[styles.stockCard, item.isLowStock && styles.lowStockCard]}>
                  <Text style={styles.itemName}>{item.name}</Text>
                  <Text style={styles.itemStock}>Tồn: {item.currentStock} {item.unit}</Text>
                  {item.isLowStock && (
                    <Text style={styles.warningText}>⚠️ Cần nhập thêm (An toàn: {item.safeLevel})</Text>
                  )}
                </View>
              ))}
            </View>
          </View>
        )}

        {/* === TAB 2: ACTION (NHẬP/XUẤT/KIỂM KÊ) === */}
        {activeTab === 'ACTION' && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Báo Cáo & Thao Tác Kho</Text>
            
            <Text style={styles.label}>Chọn Nguyên Liệu:</Text>
            <View style={styles.pickerSimulate}>
              {myItems.map(item => (
                <TouchableOpacity 
                  key={item.id} 
                  style={[styles.itemPill, selectedItemAction === item.id && styles.itemPillActive]}
                  onPress={() => setSelectedItemAction(item.id)}
                >
                  <Text style={[styles.itemPillText, selectedItemAction === item.id && styles.itemPillTextActive]}>{item.name}</Text>
                </TouchableOpacity>
              ))}
              {myItems.length === 0 && <Text style={{color: 'red'}}>Chưa có nguyên liệu nào trong kho này.</Text>}
            </View>

            <Text style={styles.label}>Hành động:</Text>
            <View style={styles.actionRow}>
              <TouchableOpacity 
                style={[styles.actionBtn, actionType === 'EXPORT' && styles.actionBtnActiveExport]}
                onPress={() => setActionType('EXPORT')}
              >
                <Text style={[styles.actionBtnText, actionType === 'EXPORT' && styles.actionBtnTextActive]}>XUẤT (Sử dụng)</Text>
              </TouchableOpacity>
              
              {(!isStaff || true) && ( /* Staff vẫn được nhập nếu hàng giao tới */
                <TouchableOpacity 
                  style={[styles.actionBtn, actionType === 'IMPORT' && styles.actionBtnActiveImport]}
                  onPress={() => setActionType('IMPORT')}
                >
                  <Text style={[styles.actionBtnText, actionType === 'IMPORT' && styles.actionBtnTextActive]}>NHẬP (Hàng về)</Text>
                </TouchableOpacity>
              )}
            </View>
            
            {!isStaff && (
              <TouchableOpacity 
                style={[styles.actionBtn, actionType === 'STOCKTAKE' && styles.actionBtnActiveStocktake, {marginTop: 5, marginBottom: 15}]}
                onPress={() => setActionType('STOCKTAKE')}
              >
                <Text style={[styles.actionBtnText, actionType === 'STOCKTAKE' && styles.actionBtnTextActive]}>KIỂM KÊ (Cân bằng kho thực tế)</Text>
              </TouchableOpacity>
            )}

            {actionType === 'STOCKTAKE' ? (
              <>
                <Text style={{color: '#e91e63', fontSize: 13, marginBottom: 10}}>*Nhập số lượng thực tế bạn đếm được ngoài đời. Hệ thống sẽ tự động tính chênh lệch so với sổ sách ({stockData.find(i=>i.id===selectedItemAction)?.currentStock || 0}) và tạo phiếu hao hụt.</Text>
                <Text style={styles.label}>Số lượng thực tế đang có ({myItems.find(i => i.id === selectedItemAction)?.unit || ''}):</Text>
              </>
            ) : (
              <Text style={styles.label}>Số lượng thao tác ({myItems.find(i => i.id === selectedItemAction)?.unit || ''}):</Text>
            )}
            
            <TextInput 
              style={styles.input}
              keyboardType="numeric"
              placeholder="VD: 5"
              value={amountAction}
              onChangeText={setAmountAction}
            />

            <TouchableOpacity style={styles.submitBtn} onPress={handleSubmitAction}>
              <Text style={styles.submitBtnText}>Xác Nhận</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* === TAB 3: LOGS & CATALOG === */}
        {activeTab === 'LOGS' && !isStaff && (
          <View>
            {/* DANH MỤC */}
            <View style={styles.section}>
              <View style={{flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 15}}>
                <Text style={styles.sectionTitle}>Danh Mục Nguyên Liệu</Text>
                <TouchableOpacity style={styles.addBtnSmall} onPress={()=>setShowCreateItemModal(true)}>
                  <Text style={{color: '#fff', fontWeight: 'bold'}}>+ Thêm Mới</Text>
                </TouchableOpacity>
              </View>
              {myItems.map(item => (
                <View key={item.id} style={styles.logCard}>
                  <Text style={{fontWeight: 'bold'}}>{item.name}</Text>
                  <Text style={{fontSize: 12, color: '#666'}}>Đơn vị: {item.unit} - Mức an toàn: {item.safeLevel}</Text>
                </View>
              ))}
            </View>

            {/* SỔ KHO */}
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Sổ Kho (Lịch sử giao dịch)</Text>
              {inventoryLogs.filter(log => storeIdToView === 'ALL' || log.store_id === storeIdToView).map(log => {
                const item = inventoryItems.find(i => i.id === log.itemId);
                let color = '#888'; let label = ''; let sign = '';
                if (log.type === 'IMPORT') { color = '#4caf50'; label = 'NHẬP KHO'; sign='+'; }
                if (log.type === 'EXPORT') { color = '#f44336'; label = 'XUẤT KHO'; sign='-'; }
                if (log.type === 'ADJUST_UP') { color = '#9c27b0'; label = 'KIỂM KÊ TĂNG'; sign='+'; }
                if (log.type === 'ADJUST_DOWN') { color = '#e91e63'; label = 'HAO HỤT'; sign='-'; }

                return (
                  <View key={log.id} style={styles.logCard}>
                    <View style={{flexDirection: 'row', justifyContent: 'space-between'}}>
                      <Text style={{fontWeight: 'bold', color: color}}>{label} {item?.name}</Text>
                      <Text style={{fontWeight: 'bold', color: color, fontSize: 16}}>{sign}{log.amount} {item?.unit}</Text>
                    </View>
                    <Text style={{fontSize: 12, color: '#666', marginTop: 4}}>Thời gian: {log.date}</Text>
                    <Text style={{fontSize: 12, color: '#666'}}>Người thực hiện: {log.user_name || 'Hệ thống'}</Text>
                  </View>
                );
              })}
            </View>
          </View>
        )}

      </ScrollView>

      {/* MODAL THÊM NGUYÊN LIỆU */}
      <Modal visible={showCreateItemModal} animationType="fade" transparent>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Thêm Nguyên Liệu Mới</Text>
            
            <Text style={styles.label}>Tên nguyên liệu:</Text>
            <TextInput style={styles.input} placeholder="VD: Bột Matcha" value={newItemName} onChangeText={setNewItemName} />
            
            <View style={{flexDirection: 'row', justifyContent: 'space-between'}}>
              <View style={{flex: 1, marginRight: 10}}>
                <Text style={styles.label}>Đơn vị tính:</Text>
                <TextInput style={styles.input} placeholder="kg, ly, hộp..." value={newItemUnit} onChangeText={setNewItemUnit} />
              </View>
              <View style={{flex: 1}}>
                <Text style={styles.label}>Mức an toàn:</Text>
                <TextInput style={styles.input} keyboardType="numeric" value={newItemSafeLevel} onChangeText={setNewItemSafeLevel} />
              </View>
            </View>
            <Text style={{fontSize: 12, color: '#888', marginBottom: 20}}>*Mức an toàn là số lượng tối thiểu, dưới mức này hệ thống sẽ báo đỏ.</Text>

            <View style={{flexDirection: 'row'}}>
              <TouchableOpacity style={[styles.submitBtn, {flex: 1, marginRight: 10, backgroundColor: '#f44336'}]} onPress={() => setShowCreateItemModal(false)}>
                <Text style={styles.submitBtnText}>Hủy</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.submitBtn, {flex: 1}]} onPress={handleCreateItem}>
                <Text style={styles.submitBtnText}>Tạo Mới</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f0f2f5', paddingHorizontal: 20 },
  headerRow: { flexDirection: 'row', alignItems: 'center', marginTop: 10, marginBottom: 10 },
  backBtn: { padding: 5, marginRight: 10 },
  header: { fontSize: 24, fontWeight: 'bold', color: '#1f2937' },
  
  tabContainer: { flexDirection: 'row', backgroundColor: '#e5e7eb', borderRadius: 8, padding: 4, marginBottom: 20 },
  tabBtn: { flex: 1, paddingVertical: 10, alignItems: 'center', borderRadius: 6 },
  tabBtnActive: { backgroundColor: '#fff', elevation: 2 },
  tabText: { fontWeight: 'bold', color: '#6b7280' },
  tabTextActive: { color: '#1976d2' },

  section: { backgroundColor: '#fff', padding: 20, borderRadius: 12, marginBottom: 20, elevation: 3 },
  sectionTitle: { fontSize: 18, fontWeight: '700', marginBottom: 15, color: '#374151' },
  
  gridContainer: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between' },
  stockCard: { backgroundColor: '#f9fafb', width: '48%', padding: 15, borderRadius: 10, marginBottom: 15, borderWidth: 1, borderColor: '#e5e7eb' },
  lowStockCard: { backgroundColor: '#ffebee', borderColor: '#ef5350' },
  itemName: { fontSize: 14, fontWeight: 'bold', color: '#374151', marginBottom: 5 },
  itemStock: { fontSize: 16, color: '#1976d2', fontWeight: 'bold' },
  warningText: { fontSize: 11, color: '#d32f2f', marginTop: 5, fontWeight: 'bold' },

  label: { fontSize: 14, fontWeight: 'bold', color: '#4b5563', marginBottom: 10, marginTop: 10 },
  pickerSimulate: { flexDirection: 'row', flexWrap: 'wrap', marginBottom: 10 },
  itemPill: { paddingHorizontal: 12, paddingVertical: 8, backgroundColor: '#e5e7eb', borderRadius: 20, marginRight: 10, marginBottom: 10 },
  itemPillActive: { backgroundColor: '#1976d2' },
  itemPillText: { fontSize: 12, color: '#4b5563', fontWeight: 'bold' },
  itemPillTextActive: { color: '#fff' },

  actionRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 10 },
  actionBtn: { flex: 0.48, padding: 12, borderWidth: 1, borderColor: '#d1d5db', borderRadius: 8, alignItems: 'center' },
  actionBtnActiveExport: { backgroundColor: '#f44336', borderColor: '#f44336' },
  actionBtnActiveImport: { backgroundColor: '#4caf50', borderColor: '#4caf50' },
  actionBtnActiveStocktake: { backgroundColor: '#9c27b0', borderColor: '#9c27b0' },
  actionBtnText: { fontWeight: 'bold', color: '#6b7280' },
  actionBtnTextActive: { color: '#fff' },

  input: { borderWidth: 1, borderColor: '#d1d5db', borderRadius: 8, padding: 12, fontSize: 16, backgroundColor: '#f9fafb', marginBottom: 10 },
  submitBtn: { backgroundColor: '#ff9800', padding: 15, borderRadius: 8, alignItems: 'center' },
  submitBtnText: { color: '#fff', fontSize: 16, fontWeight: 'bold' },

  logCard: { padding: 15, borderBottomWidth: 1, borderBottomColor: '#eee' },
  addBtnSmall: { backgroundColor: '#1976d2', paddingHorizontal: 15, paddingVertical: 8, borderRadius: 20 },
  
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', padding: 20 },
  modalContent: { backgroundColor: '#fff', borderRadius: 12, padding: 20 }
});
