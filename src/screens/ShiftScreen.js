import React, { useState, useContext, useEffect } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, TextInput, Alert, SafeAreaView, KeyboardAvoidingView, Platform } from 'react-native';
import { AppContext } from '../../App';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { supabase } from '../services/supabaseClient';

export default function ShiftScreen({ navigation }) {
  const { currentUser, shifts, setShifts, selectedStoreId, storeList, inventoryItems, setInventoryItems, attendanceHistory } = useContext(AppContext);

  const formatMoneyInput = (val) => {
    if (!val) return '';
    const num = val.replace(/\D/g, '');
    if (!num) return '';
    return num.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  };

  const parseMoneyInput = (val) => {
    if (!val) return 0;
    return Number(val.replace(/\D/g, ''));
  };

  const isOwner = currentUser?.role === 'OWNER';
  const isManager = currentUser?.role === 'MANAGER';
  const isStaff = currentUser?.role === 'STAFF';
  const hasCashierPerm = !isStaff || currentUser?.permissions?.cashier;

  const viewableStores = currentUser?.permissions?.viewable_stores || [];
  let storeIdToView = currentUser?.store_id;
  if (isOwner || viewableStores.includes(selectedStoreId)) {
    storeIdToView = selectedStoreId;
  }
  if (isOwner && selectedStoreId === 'ALL') {
    storeIdToView = 'ALL';
  }

  const [activeTab, setActiveTab] = useState('ACTION');
  const currentOpenShift = shifts.find(s => s.status === 'OPEN' && s.store_id === storeIdToView);

  // === MỞ CA ===
  const [openingCash, setOpeningCash] = useState('');
  const handleOpenShift = async () => {
    if (storeIdToView === 'ALL') { alert('Vui lòng chọn 1 chi nhánh!'); return; }
    if (!openingCash) { alert('Nhập tiền đầu ca!'); return; }
    const newShift = {
      id: `shift_${Date.now()}`, store_id: storeIdToView,
      opened_by: currentUser.id, opened_by_name: currentUser.name,
      opened_at: new Date().toLocaleDateString('vi-VN') + ' ' + new Date().toLocaleTimeString('vi-VN', {hour: '2-digit', minute:'2-digit'}),
      opening_cash: parseMoneyInput(openingCash), status: 'OPEN',
      rev_cash: 0, rev_momo: 0, rev_grab: 0, rev_shopee: 0, discount: 0, expenses: 0, expenses_note: '', closing_cash_actual: 0, discrepancy: 0,
      inventory_check: []
    };
    await supabase.from('shifts').insert([newShift]);
    setShifts([...shifts, newShift]);
    alert('Mở ca thành công!');
  };

  // === CHỐT CA (MẪU 16) ===
  const [inventoryCheck, setInventoryCheck] = useState({}); // { itemId: endStock }
  const [revCash, setRevCash] = useState('');
  const [revMomo, setRevMomo] = useState('');
  const [revGrab, setRevGrab] = useState('');
  const [revShopee, setRevShopee] = useState('');
  const [discount, setDiscount] = useState('');
  const [expenses, setExpenses] = useState('');
  const [expensesNote, setExpensesNote] = useState('');
  const [actualCash, setActualCash] = useState('');

  const storeInventory = inventoryItems.filter(i => i.store_id === storeIdToView);
  const todayStr = new Date().toLocaleDateString('vi-VN');
  const todayAttendance = attendanceHistory.filter(a => a.date === todayStr); // Giả lập chấm công hôm nay

  const handleCloseShift = async () => {
    const rCash = parseMoneyInput(revCash);
    const rMomo = parseMoneyInput(revMomo);
    const rGrab = parseMoneyInput(revGrab);
    const rShopee = parseMoneyInput(revShopee);
    const disc = parseMoneyInput(discount);
    const exp = parseMoneyInput(expenses);
    const aCash = parseMoneyInput(actualCash);

    if (!revCash && !actualCash) {
      alert('Vui lòng nhập ít nhất Doanh thu tiền mặt và Tiền đếm trong két!'); return;
    }

    // Tính Lệch Két
    // Tổng tiền két lý thuyết = Tiền đầu giờ + Tiền mặt - Tiền chi
    const expectedCash = currentOpenShift.opening_cash + rCash - exp;
    const discrepancy = aCash - expectedCash;

    // Build inventory check data
    const finalInvCheck = storeInventory.map(item => {
      const endStock = inventoryCheck[item.id] !== undefined ? Number(inventoryCheck[item.id]) : 0;
      return { item_id: item.id, name: item.name, unit: item.unit, end: endStock };
    });

    if (discrepancy !== 0) {
      alert(`⚠️ CẢNH BÁO LỆCH KÉT!\nTiền lý thuyết: ${expectedCash.toLocaleString()}đ\nTiền thực đếm: ${aCash.toLocaleString()}đ\nLệch: ${discrepancy.toLocaleString()}đ`);
    }

    const updatedShift = {
      ...currentOpenShift,
      status: 'CLOSED',
      closed_by: currentUser.id, closed_by_name: currentUser.name,
      closed_at: todayStr + ' ' + new Date().toLocaleTimeString('vi-VN', {hour: '2-digit', minute:'2-digit'}),
      rev_cash: rCash, rev_momo: rMomo, rev_grab: rGrab, rev_shopee: rShopee,
      discount: disc, expenses: exp, expenses_note: expensesNote,
      closing_cash_actual: aCash, discrepancy: discrepancy,
      inventory_check: finalInvCheck
    };

    // Update to Supabase
    await supabase.from('shifts').update(updatedShift).eq('id', currentOpenShift.id);

    // Update global shifts
    setShifts(shifts.map(s => s.id === currentOpenShift.id ? updatedShift : s));
    
    // Update global inventory stock based on inventory check
    const updatedInventoryItems = inventoryItems.map(item => {
      if (item.store_id === storeIdToView && inventoryCheck[item.id] !== undefined) {
        return { ...item, quantity: Number(inventoryCheck[item.id]) };
      }
      return item;
    });
    setInventoryItems(updatedInventoryItems);

    alert('Đã nộp Báo Cáo Chốt Ca (Mẫu 16)!');
    // Reset form
    setRevCash(''); setRevMomo(''); setRevGrab(''); setRevShopee(''); setDiscount(''); setExpenses(''); setExpensesNote(''); setActualCash(''); setInventoryCheck({});
  };

  const historyShifts = shifts.filter(s => s.status === 'CLOSED' && (storeIdToView === 'ALL' || s.store_id === storeIdToView)).reverse();

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{flex: 1}}>
        <View style={styles.headerRow}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}><Ionicons name="arrow-back" size={24} color="#1f2937" /></TouchableOpacity>
        <Text style={styles.header}>Báo Cáo Mẫu 16</Text>
      </View>

      <View style={styles.tabContainer}>
        <TouchableOpacity style={[styles.tabBtn, activeTab === 'ACTION' && styles.tabBtnActive]} onPress={() => setActiveTab('ACTION')}>
          <Text style={[styles.tabText, activeTab === 'ACTION' && styles.tabTextActive]}>Phiếu Chốt Ca</Text>
        </TouchableOpacity>
        {(!isStaff) && (
          <TouchableOpacity style={[styles.tabBtn, activeTab === 'HISTORY' && styles.tabBtnActive]} onPress={() => setActiveTab('HISTORY')}>
            <Text style={[styles.tabText, activeTab === 'HISTORY' && styles.tabTextActive]}>Lịch Sử Báo Cáo</Text>
          </TouchableOpacity>
        )}
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 80 }} style={{ flex: 1 }}>
        {!hasCashierPerm ? (
          <View style={{padding: 20, alignItems: 'center', marginTop: 50}}>
            <Ionicons name="lock-closed" size={60} color="#ccc" />
            <Text style={{fontSize: 18, color: '#888', marginTop: 15, textAlign: 'center'}}>Bạn không được cấp quyền Thu Ngân / Bán Hàng để thực hiện chức năng này.</Text>
          </View>
        ) : activeTab === 'ACTION' && (
          <View>
            {storeIdToView === 'ALL' ? (
              <View style={styles.section}><Text style={{textAlign:'center', color:'#f44336'}}>Vui lòng chọn 1 chi nhánh để Giao Ca!</Text></View>
            ) : !currentOpenShift ? (
              <View style={styles.section}>
                <View style={{alignItems: 'center', marginBottom: 20}}><MaterialCommunityIcons name="cash-register" size={60} color="#9ca3af" /><Text style={styles.sectionTitle}>CHƯA MỞ CA LÀM VIỆC</Text></View>
                <Text style={styles.label}>Tiền mặt đầu ca có trong két (VNĐ):</Text>
                <TextInput style={styles.input} keyboardType="numeric" placeholder="Nhập số tiền..." value={openingCash} onChangeText={(v) => setOpeningCash(formatMoneyInput(v))} />
                <TouchableOpacity style={styles.openBtn} onPress={handleOpenShift}><Text style={styles.btnText}>KHỞI TẠO CA MỚI</Text></TouchableOpacity>
              </View>
            ) : (
              <View>
                <View style={[styles.section, {backgroundColor: '#e8f5e9'}]}>
                  <Text style={{color: '#2e7d32', fontWeight: 'bold'}}>🟢 ĐANG TRONG CA: {storeList.find(s=>s.id===storeIdToView)?.name}</Text>
                  <Text style={{color: '#555'}}>Mở lúc: {currentOpenShift.opened_at} bởi {currentOpenShift.opened_by_name}</Text>
                </View>

                {/* PHẦN 1: KIỂM KHO */}
                <View style={styles.section}>
                  <Text style={styles.sectionTitle}>PHẦN 1: KIỂM KÊ KHO HÀNG</Text>
                  <View style={styles.tableHeader}>
                    <Text style={[styles.cell, {flex: 2}]}>Tên Hàng</Text>
                    <Text style={[styles.cell, {flex: 1}]}>Tồn Đầu</Text>
                    <Text style={[styles.cell, {flex: 1.5}]}>Tồn Cuối</Text>
                  </View>
                  {storeInventory.map(item => (
                    <View key={item.id} style={styles.tableRow}>
                      <Text style={[styles.cell, {flex: 2}]} numberOfLines={1}>{item.name}</Text>
                      <Text style={[styles.cell, {flex: 1}]}>--</Text>
                      <View style={{flex: 1.5, paddingHorizontal: 5}}>
                        <TextInput 
                          style={styles.smallInput} keyboardType="numeric" placeholder="Nhập"
                          value={inventoryCheck[item.id] !== undefined ? String(inventoryCheck[item.id]) : ''}
                          onChangeText={(val) => setInventoryCheck({...inventoryCheck, [item.id]: val})}
                        />
                      </View>
                    </View>
                  ))}
                </View>

                {/* PHẦN 2: DOANH THU & KÉT */}
                <View style={styles.section}>
                  <Text style={styles.sectionTitle}>PHẦN 2: DOANH THU & KÉT TIỀN</Text>
                  <Text style={styles.infoText}>Tiền đầu giờ (1): {currentOpenShift.opening_cash.toLocaleString()}đ</Text>
                  
                  <Text style={styles.label}>Doanh thu Tiền Mặt (3):</Text>
                  <TextInput style={styles.input} keyboardType="numeric" value={revCash} onChangeText={(v) => setRevCash(formatMoneyInput(v))} />

                  <Text style={styles.label}>Tổng tiền giảm bill (4):</Text>
                  <TextInput style={styles.input} keyboardType="numeric" value={discount} onChangeText={(v) => setDiscount(formatMoneyInput(v))} />

                  <Text style={styles.label}>Tổng tiền MOMO:</Text>
                  <TextInput style={styles.input} keyboardType="numeric" value={revMomo} onChangeText={(v) => setRevMomo(formatMoneyInput(v))} />

                  <Text style={styles.label}>Tổng tiền GRAB:</Text>
                  <TextInput style={styles.input} keyboardType="numeric" value={revGrab} onChangeText={(v) => setRevGrab(formatMoneyInput(v))} />

                  <Text style={styles.label}>Tổng tiền SHOPEE FOOD:</Text>
                  <TextInput style={styles.input} keyboardType="numeric" value={revShopee} onChangeText={(v) => setRevShopee(formatMoneyInput(v))} />

                  <View style={{flexDirection: 'row', gap: 10}}>
                    <View style={{flex: 1}}>
                      <Text style={styles.label}>Tiền chi trong ngày (5):</Text>
                      <TextInput style={styles.input} keyboardType="numeric" value={expenses} onChangeText={(v) => setExpenses(formatMoneyInput(v))} />
                    </View>
                    <View style={{flex: 2}}>
                      <Text style={styles.label}>Ghi chú chi:</Text>
                      <TextInput style={styles.input} placeholder="Mua đá, trà..." value={expensesNote} onChangeText={setExpensesNote} />
                    </View>
                  </View>

                  <Text style={[styles.label, {color: '#f44336'}]}>TIỀN TRONG KÉT THỰC ĐẾM (2):</Text>
                  <TextInput style={[styles.input, {borderColor: '#f44336', borderWidth: 2}]} keyboardType="numeric" placeholder="Đếm két..." value={actualCash} onChangeText={(v) => setActualCash(formatMoneyInput(v))} />

                  {/* Auto Preview */}
                  <View style={styles.previewBox}>
                    <Text style={{fontWeight: 'bold', marginBottom: 5}}>Xem Trước Báo Cáo:</Text>
                    <Text>Doanh thu tổng: {(parseMoneyInput(revCash) + parseMoneyInput(revMomo) + parseMoneyInput(revGrab) + parseMoneyInput(revShopee) - parseMoneyInput(discount)).toLocaleString()}đ</Text>
                    <Text>Lệch két: {(parseMoneyInput(actualCash) - (currentOpenShift.opening_cash + parseMoneyInput(revCash) - parseMoneyInput(expenses))).toLocaleString()}đ</Text>
                  </View>
                </View>

                {/* PHẦN 3: CHẤM CÔNG */}
                <View style={styles.section}>
                  <Text style={styles.sectionTitle}>PHẦN 3: CHẤM CÔNG CA</Text>
                  {todayAttendance.length > 0 ? todayAttendance.map(a => (
                    <Text key={a.id} style={{marginBottom: 5}}>• Nhân viên {a.user_id}: Vào {a.checkIn} - Ra {a.checkOut || 'Chưa ra'}</Text>
                  )) : <Text style={{color: '#888'}}>Chưa có dữ liệu chấm công hôm nay.</Text>}
                </View>
              </View>
            )}
          </View>
        )}

        {activeTab === 'HISTORY' && !isStaff && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Lịch Sử Báo Cáo Chốt Ca</Text>
            {historyShifts.length === 0 && <Text style={{color: '#888'}}>Chưa có báo cáo nào.</Text>}
            {historyShifts.map(shift => {
              const totalRev = shift.rev_cash + shift.rev_momo + shift.rev_grab + shift.rev_shopee - shift.discount;
              return (
                <View key={shift.id} style={styles.historyCard}>
                  <View style={{flexDirection: 'row', justifyContent: 'space-between', marginBottom: 10}}>
                    <Text style={{fontWeight: 'bold', fontSize: 16}}>{shift.opened_at.split(' ')[0]}</Text>
                    <Text style={{color: '#1976d2', fontWeight: 'bold'}}>{storeList.find(s=>s.id===shift.store_id)?.name}</Text>
                  </View>
                  <Text style={styles.hText}>Ca mở: {shift.opened_at.split(' ')[1]} ({shift.opened_by_name})</Text>
                  <Text style={styles.hText}>Ca đóng: {shift.closed_at.split(' ')[1]} ({shift.closed_by_name})</Text>
                  
                  <View style={{backgroundColor: '#f5f5f5', padding: 10, borderRadius: 8, marginTop: 10}}>
                    <Text style={{fontWeight: 'bold'}}>TỔNG DOANH THU: {totalRev.toLocaleString()}đ</Text>
                    <Text style={styles.hText}>- Tiền mặt: {shift.rev_cash.toLocaleString()}đ</Text>
                    <Text style={styles.hText}>- Momo/Grab/Shopee: {(shift.rev_momo+shift.rev_grab+shift.rev_shopee).toLocaleString()}đ</Text>
                    <Text style={styles.hText}>- Chi phí: {shift.expenses.toLocaleString()}đ ({shift.expenses_note})</Text>
                    
                    <View style={{height: 1, backgroundColor: '#ddd', marginVertical: 8}}/>
                    <Text style={styles.hText}>Tiền đầu giờ: {shift.opening_cash.toLocaleString()}đ</Text>
                    <Text style={styles.hText}>Tiền trong két: {shift.closing_cash_actual.toLocaleString()}đ</Text>
                    <Text style={{fontWeight: 'bold', color: shift.discrepancy===0?'#4caf50':'#f44336'}}>
                      Lệch két: {shift.discrepancy.toLocaleString()}đ
                    </Text>
                  </View>
                </View>
              );
            })}
          </View>
        )}
      </ScrollView>

      {/* FIXED BOTTOM BUTTON FOR CLOSING SHIFT */}
      {activeTab === 'ACTION' && currentOpenShift && storeIdToView !== 'ALL' && (
        <View style={styles.fixedBottomBar}>
          <TouchableOpacity style={styles.closeBtnFixed} onPress={handleCloseShift}>
            <Text style={styles.btnText}>XÁC NHẬN NỘP BÁO CÁO (CHỐT CA)</Text>
          </TouchableOpacity>
        </View>
      )}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f0f2f5', paddingHorizontal: 20 },
  headerRow: { flexDirection: 'row', alignItems: 'center', marginTop: 10, marginBottom: 15 },
  backBtn: { padding: 5, marginRight: 10 },
  header: { fontSize: 24, fontWeight: 'bold', color: '#1f2937' },
  tabContainer: { flexDirection: 'row', backgroundColor: '#e5e7eb', borderRadius: 8, padding: 4, marginBottom: 20 },
  tabBtn: { flex: 1, paddingVertical: 10, alignItems: 'center', borderRadius: 6 },
  tabBtnActive: { backgroundColor: '#fff', elevation: 2 },
  tabText: { fontWeight: 'bold', color: '#6b7280' },
  tabTextActive: { color: '#1976d2' },
  section: { backgroundColor: '#fff', padding: 20, borderRadius: 12, marginBottom: 20, elevation: 3 },
  sectionTitle: { fontSize: 16, fontWeight: '900', marginBottom: 15, color: '#1976d2' },
  label: { fontSize: 13, fontWeight: 'bold', color: '#4b5563', marginBottom: 5, marginTop: 10 },
  input: { borderWidth: 1, borderColor: '#d1d5db', borderRadius: 8, padding: 10, fontSize: 14, backgroundColor: '#f9fafb', marginBottom: 5 },
  smallInput: { borderWidth: 1, borderColor: '#ccc', borderRadius: 4, padding: 5, fontSize: 13, textAlign: 'center' },
  openBtn: { backgroundColor: '#4caf50', padding: 15, borderRadius: 8, alignItems: 'center', marginTop: 10 },
  fixedBottomBar: { position: 'absolute', bottom: 0, left: 0, right: 0, padding: 15, paddingHorizontal: 20, backgroundColor: '#fff', borderTopWidth: 1, borderTopColor: '#eee', elevation: 10, shadowColor: '#000', shadowOpacity: 0.1, shadowRadius: 5 },
  closeBtnFixed: { backgroundColor: '#f44336', padding: 15, borderRadius: 8, alignItems: 'center' },
  btnText: { color: '#fff', fontSize: 16, fontWeight: 'bold' },
  historyCard: { backgroundColor: '#fff', borderWidth: 1, borderColor: '#eee', padding: 15, borderRadius: 10, marginBottom: 15 },
  hText: { color: '#555', marginBottom: 3, fontSize: 13 },
  infoText: { fontSize: 14, fontWeight: 'bold', marginBottom: 10, color: '#333' },
  previewBox: { backgroundColor: '#fff3e0', padding: 10, borderRadius: 8, marginTop: 15 },
  tableHeader: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: '#eee', paddingBottom: 5, marginBottom: 5 },
  tableRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: '#f5f5f5' },
  cell: { fontSize: 13, color: '#333' }
});
