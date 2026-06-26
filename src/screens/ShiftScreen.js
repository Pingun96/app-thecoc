import React, { useState, useContext } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, TextInput, SafeAreaView, KeyboardAvoidingView, Platform } from 'react-native';
import { AppContext } from '../context/AppContext';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { supabase } from '../services/supabaseClient';
import { sendPushNotification } from '../services/NotificationService';

export default function ShiftScreen({ navigation }) {
  const { currentUser, staffList, shifts, setShifts, selectedStoreId, storeList, inventoryItems, setInventoryItems, attendanceHistory } = useContext(AppContext);

  const formatMoneyInput = (val) => {
    if (!val) return '';
    // Allow digits and basic operators +, -, *, /
    const sanitized = String(val).replace(/[^\d+\-*/]/g, '');

    // Split by operators, format each chunk, then join back
    return sanitized.replace(/\d+/g, (match) => {
      return match.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
    });
  };

  const parseMoneyInput = (val) => {
    if (!val) return 0;
    try {
      // Remove anything that is not digit or operator
      const sanitized = String(val).replace(/[^\d+\-*/]/g, '');
      if (!sanitized) return 0;

      // Prevent eval error if it ends with an operator
      if (/[\+\-\*\/]$/.test(sanitized)) return 0;

      // Expand shorthands (e.g. 33 -> 33000) for any number token < 1000
      const expandedMath = sanitized.replace(/\d+/g, (match) => {
        const n = parseInt(match, 10);
        if (n > 0 && n < 1000) {
          return (n * 1000).toString();
        }
        return match;
      });

      const result = new Function('return ' + expandedMath)();
      return isNaN(result) || !isFinite(result) ? 0 : result;
    } catch(e) {
      return 0;
    }
  };

  const isOwner = currentUser?.role === 'OWNER';
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
      status: 'PENDING_APPROVAL',
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
  const pendingShifts = shifts.filter(s => s.status === 'PENDING_APPROVAL' && (storeIdToView === 'ALL' || s.store_id === storeIdToView)).reverse();

  const handleApproveShiftReport = async (shift) => {
    try {
      const { error } = await supabase.from('shifts').update({ status: 'CLOSED' }).eq('id', shift.id);
      if (error) throw error;
      setShifts(shifts.map(s => s.id === shift.id ? { ...s, status: 'CLOSED' } : s));
      alert('Đã duyệt chốt ca thành công!');

      // Notify the person who closed the shift
      if (shift.closed_by) {
        const targetStaff = staffList.find(s => s.id === shift.closed_by);
        if (targetStaff) {
          sendPushNotification(targetStaff.push_token, 'Duyệt chốt ca', `Quản lý đã duyệt báo cáo chốt ca ngày ${shift.opened_at.split(' ')[0]} của bạn.`, {}, targetStaff.id);
        }
      }
    } catch (e) {
      alert('Lỗi: ' + e.message);
    }
  };

  const renderMoneyInput = (label, value, setter, isHighlight = false, placeholder = "") => (
    <View style={{marginBottom: 10}}>
      <Text style={[styles.label, isHighlight && {color: '#f44336'}]}>{label}</Text>
      <TextInput
        style={[styles.input, isHighlight && {borderColor: '#f44336', borderWidth: 2}]}
        keyboardType="numeric"
        placeholder={placeholder}
        value={value}
        onChangeText={(v) => setter(formatMoneyInput(v))}
      />
    </View>
  );

  const renderHistoryTab = (data) => (
    <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 80 }}>
      {data.map(item => (
        <View key={item.id} style={styles.historyCard}>
          <View style={{flexDirection: 'row', justifyContent: 'space-between', marginBottom: 10}}>
            <Text style={{fontWeight: 'bold', fontSize: 16}}>{item.opened_at.split(' ')[0]}</Text>
            <Text style={{color: '#1976d2', fontWeight: 'bold'}}>{storeList.find(s=>s.id===item.store_id)?.name}</Text>
          </View>
          <Text style={styles.hText}>Ca mở: {item.opened_at.split(' ')[1]} ({item.opened_by_name})</Text>
          <Text style={styles.hText}>Ca đóng: {item.closed_at.split(' ')[1]} ({item.closed_by_name})</Text>
          <View style={{backgroundColor: '#f5f5f5', padding: 10, borderRadius: 8, marginTop: 10}}>
            <Text style={{fontWeight: 'bold'}}>TỔNG DOANH THU: {(item.rev_cash + item.rev_momo + item.rev_grab + item.rev_shopee - item.discount).toLocaleString()}đ</Text>
            <Text style={styles.hText}>- Tiền mặt: {item.rev_cash.toLocaleString()}đ</Text>
            <Text style={styles.hText}>- Momo/Grab/Shopee: {(item.rev_momo+item.rev_grab+item.rev_shopee).toLocaleString()}đ</Text>
            <Text style={styles.hText}>- Chi phí: {item.expenses.toLocaleString()}đ ({item.expenses_note})</Text>
            <View style={{height: 1, backgroundColor: '#ddd', marginVertical: 8}}/>
            <Text style={styles.hText}>Tiền đầu giờ: {item.opening_cash.toLocaleString()}đ</Text>
            <Text style={styles.hText}>Tiền trong két: {item.closing_cash_actual.toLocaleString()}đ</Text>
            <View style={{flexDirection: 'row', justifyContent: 'space-between', marginTop: 10, paddingTop: 10, borderTopWidth: 1, borderColor: '#eee'}}>
              <Text style={{fontSize: 16, fontWeight: 'bold'}}>Chênh Lệch:</Text>
              <Text style={{fontSize: 16, fontWeight: 'bold', color: item.discrepancy < 0 ? '#f44336' : (item.discrepancy > 0 ? '#4caf50' : '#333')}}>
                {item.discrepancy > 0 ? '+' : ''}{item.discrepancy.toLocaleString()}đ
              </Text>
            </View>
            {activeTab === 'PENDING' && (isOwner || currentUser?.permissions?.is_primary_manager) && (
              <TouchableOpacity
                style={{ marginTop: 15, backgroundColor: '#4caf50', padding: 10, borderRadius: 8, alignItems: 'center' }}
                onPress={() => handleApproveShiftReport(item)}
              >
                <Text style={{ color: '#fff', fontWeight: 'bold' }}>Duyệt Chốt Ca</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>
      ))}
    </ScrollView>
  );

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
            <TouchableOpacity style={[styles.tabBtn, activeTab === 'PENDING' && styles.tabBtnActive]} onPress={() => setActiveTab('PENDING')}>
              <Text style={[styles.tabText, activeTab === 'PENDING' && styles.tabTextActive]}>Chờ Duyệt</Text>
            </TouchableOpacity>
          )}
          {(!isStaff) && (
            <TouchableOpacity style={[styles.tabBtn, activeTab === 'HISTORY' && styles.tabBtnActive]} onPress={() => setActiveTab('HISTORY')}>
              <Text style={[styles.tabText, activeTab === 'HISTORY' && styles.tabTextActive]}>Lịch Sử</Text>
            </TouchableOpacity>
          )}
        </View>

        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 80 }} style={{ flex: 1, paddingHorizontal: 20 }}>
          {activeTab === 'PENDING' && renderHistoryTab(pendingShifts)}
          {activeTab === 'HISTORY' && renderHistoryTab(historyShifts)}

          {activeTab === 'ACTION' && (!hasCashierPerm ? (
            <View style={{padding: 20, alignItems: 'center', marginTop: 50}}>
              <Ionicons name="lock-closed" size={60} color="#ccc" />
              <Text style={{fontSize: 18, color: '#888', marginTop: 15, textAlign: 'center'}}>Bạn không được cấp quyền Thu Ngân / Bán Hàng để thực hiện chức năng này.</Text>
            </View>
          ) : (
            <View>
              {storeIdToView === 'ALL' ? (
                <View style={styles.section}><Text style={{textAlign:'center', color:'#f44336'}}>Vui lòng chọn 1 chi nhánh để Giao Ca!</Text></View>
              ) : !currentOpenShift ? (
                <View style={styles.section}>
                  <View style={{alignItems: 'center', marginBottom: 20}}><MaterialCommunityIcons name="cash-register" size={60} color="#9ca3af" /><Text style={styles.sectionTitle}>CHƯA MỞ CA LÀM VIỆC</Text></View>
                  {renderMoneyInput('Tiền mặt đầu ca có trong két (VNĐ):', openingCash, setOpeningCash, false, 'Nhập số tiền...')}
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
                            style={styles.smallInput} keyboardType="numbers-and-punctuation" placeholder="Nhập"
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

                    {renderMoneyInput('Doanh thu Tiền Mặt (3):', revCash, setRevCash)}
                    {renderMoneyInput('Tổng tiền giảm bill (4):', discount, setDiscount)}
                    {renderMoneyInput('Tổng tiền MOMO:', revMomo, setRevMomo)}
                    {renderMoneyInput('Tổng tiền GRAB:', revGrab, setRevGrab)}
                    {renderMoneyInput('Tổng tiền SHOPEE FOOD:', revShopee, setRevShopee)}

                    <View style={{flexDirection: 'column', marginBottom: 10}}>
                      {renderMoneyInput('Tiền chi trong ngày (5):', expenses, setExpenses)}
                      <Text style={styles.label}>Ghi chú chi:</Text>
                      <TextInput style={styles.input} placeholder="Mua đá, trà, linh tinh..." value={expensesNote} onChangeText={setExpensesNote} />
                    </View>

                    {renderMoneyInput('TIỀN TRONG KÉT THỰC ĐẾM (2):', actualCash, setActualCash, true, 'Đếm két...')}

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
          ))}
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
  mathBtn: { backgroundColor: '#e0e0e0', paddingVertical: 10, paddingHorizontal: 15, marginLeft: 8, borderRadius: 8, justifyContent: 'center', alignItems: 'center' },
  mathBtnText: { fontSize: 20, fontWeight: 'bold', color: '#333' },
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
