import React, { useState, useContext } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, TextInput, Alert } from 'react-native';
import { AppContext } from '../../App';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';

export default function ShiftScreen({ navigation }) {
  const { currentUser, shifts, setShifts, selectedStoreId, storeList } = useContext(AppContext);

  // === ROLE & STORE LOGIC ===
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

  // TABS: ACTION (Current Shift), HISTORY (Past Shifts)
  const [activeTab, setActiveTab] = useState('ACTION');

  // === CURRENT SHIFT LOGIC ===
  // Tìm ca đang mở của chi nhánh hiện tại (nếu đang ở ALL thì báo lỗi không cho giao ca)
  const currentOpenShift = shifts.find(s => s.status === 'OPEN' && s.store_id === storeIdToView);

  // Form Mở Ca
  const [openingCash, setOpeningCash] = useState('');
  
  // Form Đóng Ca
  const [revCash, setRevCash] = useState('');
  const [revTransfer, setRevTransfer] = useState('');
  const [actualCash, setActualCash] = useState('');

  const handleOpenShift = () => {
    if (storeIdToView === 'ALL') {
      alert('Vui lòng chọn 1 chi nhánh cụ thể ở màn hình chính để Mở ca!');
      return;
    }
    if (!openingCash) {
      alert('Vui lòng nhập số tiền mặt có sẵn trong két!');
      return;
    }
    const val = Number(openingCash);
    if (isNaN(val) || val < 0) {
      alert('Số tiền không hợp lệ!'); return;
    }

    const newShift = {
      id: `shift_${Date.now()}`,
      store_id: storeIdToView,
      opened_by: currentUser.id,
      opened_by_name: currentUser.name,
      opened_at: new Date().toLocaleDateString('vi-VN') + ' ' + new Date().toLocaleTimeString('vi-VN', {hour: '2-digit', minute:'2-digit'}),
      opening_cash: val,
      status: 'OPEN',
      closed_by: null, closed_by_name: null, closed_at: null,
      revenue_cash: 0, revenue_transfer: 0, closing_cash_actual: 0, discrepancy: 0
    };
    setShifts([...shifts, newShift]);
    alert('Mở ca thành công! Chúc bạn một ca làm việc thuận lợi.');
    setOpeningCash('');
  };

  const handleCloseShift = () => {
    if (!revCash || !revTransfer || !actualCash) {
      alert('Vui lòng điền đủ 3 thông số chốt ca!'); return;
    }
    const rCash = Number(revCash);
    const rTrans = Number(revTransfer);
    const aCash = Number(actualCash);

    if (isNaN(rCash) || isNaN(rTrans) || isNaN(aCash)) {
      alert('Số tiền nhập vào phải là số!'); return;
    }

    // Tiền mặt đúng ra phải có = Tiền đầu ca + Doanh thu tiền mặt
    const expectedCash = currentOpenShift.opening_cash + rCash;
    const discrepancy = aCash - expectedCash;

    if (discrepancy !== 0) {
      // Nếu lệch, cảnh báo bằng Alert thật (nhưng trên web sẽ dùng alert của trình duyệt)
      alert(`⚠️ CẢNH BÁO LỆCH KÉT!\n\nTiền lẽ ra phải có: ${expectedCash.toLocaleString()}đ\nTiền thực tế bạn đếm: ${aCash.toLocaleString()}đ\nĐộ lệch: ${discrepancy > 0 ? '+' : ''}${discrepancy.toLocaleString()}đ\n\nHệ thống sẽ ghi nhận khoản chênh lệch này vào báo cáo.`);
    }

    const updatedShift = {
      ...currentOpenShift,
      status: 'CLOSED',
      closed_by: currentUser.id,
      closed_by_name: currentUser.name,
      closed_at: new Date().toLocaleDateString('vi-VN') + ' ' + new Date().toLocaleTimeString('vi-VN', {hour: '2-digit', minute:'2-digit'}),
      revenue_cash: rCash,
      revenue_transfer: rTrans,
      closing_cash_actual: aCash,
      discrepancy: discrepancy
    };

    setShifts(shifts.map(s => s.id === currentOpenShift.id ? updatedShift : s));
    alert('Đã chốt ca thành công! Báo cáo đã được gửi tới Quản lý.');
    setRevCash(''); setRevTransfer(''); setActualCash('');
  };

  // === HISTORY LOGIC ===
  const historyShifts = shifts.filter(s => s.status === 'CLOSED' && (storeIdToView === 'ALL' || s.store_id === storeIdToView)).reverse();

  return (
    <View style={styles.container}>
      <View style={styles.headerRow}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={24} color="#1f2937" />
        </TouchableOpacity>
        <Text style={styles.header}>Quản Lý Ca & Két Tiền</Text>
      </View>

      <View style={styles.tabContainer}>
        <TouchableOpacity style={[styles.tabBtn, activeTab === 'ACTION' && styles.tabBtnActive]} onPress={() => setActiveTab('ACTION')}>
          <Text style={[styles.tabText, activeTab === 'ACTION' && styles.tabTextActive]}>Giao Ca Hiện Tại</Text>
        </TouchableOpacity>
        {(!isStaff) && (
          <TouchableOpacity style={[styles.tabBtn, activeTab === 'HISTORY' && styles.tabBtnActive]} onPress={() => setActiveTab('HISTORY')}>
            <Text style={[styles.tabText, activeTab === 'HISTORY' && styles.tabTextActive]}>Báo Cáo Doanh Thu</Text>
          </TouchableOpacity>
        )}
      </View>

      <ScrollView showsVerticalScrollIndicator={false}>
        
        {/* === TAB 1: ACTION === */}
        {activeTab === 'ACTION' && (
          <View>
            {storeIdToView === 'ALL' ? (
              <View style={styles.section}>
                <Text style={{textAlign: 'center', color: '#f44336', fontWeight: 'bold'}}>Bạn đang ở chế độ "Tất cả chi nhánh". Hãy quay ra Dashboard và chọn 1 chi nhánh cụ thể để Giao Ca!</Text>
              </View>
            ) : (
              !currentOpenShift ? (
                // CHƯA MỞ CA
                <View style={styles.section}>
                  <View style={{alignItems: 'center', marginBottom: 20}}>
                    <MaterialCommunityIcons name="cash-register" size={60} color="#9ca3af" />
                    <Text style={styles.sectionTitle}>CHƯA MỞ CA LÀM VIỆC</Text>
                    <Text style={{color: '#666'}}>Chi nhánh: {storeList.find(s=>s.id===storeIdToView)?.name}</Text>
                  </View>
                  
                  <Text style={styles.label}>Tiền mặt đầu ca có trong két (VNĐ):</Text>
                  <TextInput 
                    style={styles.input} 
                    keyboardType="numeric" 
                    placeholder="Nhập số tiền lẻ có sẵn..." 
                    value={openingCash} 
                    onChangeText={setOpeningCash} 
                  />
                  
                  <TouchableOpacity style={styles.openBtn} onPress={handleOpenShift}>
                    <Text style={styles.btnText}>KHỞI TẠO CA MỚI</Text>
                  </TouchableOpacity>
                </View>
              ) : (
                // ĐANG TRONG CA -> CHỐT CA
                <View style={styles.section}>
                  <View style={{backgroundColor: '#e8f5e9', padding: 15, borderRadius: 10, marginBottom: 20}}>
                    <Text style={{color: '#2e7d32', fontWeight: 'bold', fontSize: 16, marginBottom: 5}}>🟢 ĐANG TRONG CA</Text>
                    <Text style={{color: '#555'}}>Chi nhánh: {storeList.find(s=>s.id===currentOpenShift.store_id)?.name}</Text>
                    <Text style={{color: '#555'}}>Mở lúc: {currentOpenShift.opened_at} bởi {currentOpenShift.opened_by_name}</Text>
                    <Text style={{color: '#555', fontWeight: 'bold', marginTop: 5}}>Tiền đầu ca: {currentOpenShift.opening_cash.toLocaleString()}đ</Text>
                  </View>

                  <Text style={[styles.sectionTitle, {color: '#f44336'}]}>BÁO CÁO & CHỐT CA</Text>
                  
                  <Text style={styles.label}>1. Doanh thu Tiền Mặt (VNĐ):</Text>
                  <TextInput style={styles.input} keyboardType="numeric" placeholder="Tiền khách đưa mặt..." value={revCash} onChangeText={setRevCash} />
                  
                  <Text style={styles.label}>2. Doanh thu Chuyển Khoản (VNĐ):</Text>
                  <TextInput style={styles.input} keyboardType="numeric" placeholder="Momo, VNPay, Banking..." value={revTransfer} onChangeText={setRevTransfer} />
                  
                  <View style={{height: 1, backgroundColor: '#eee', marginVertical: 15}} />

                  <Text style={styles.label}>3. Tiền Thực Tế Đếm Được Trong Két (VNĐ):</Text>
                  <TextInput style={[styles.input, {borderColor: '#f44336', borderWidth: 2}]} keyboardType="numeric" placeholder="Đếm két và nhập số chính xác..." value={actualCash} onChangeText={setActualCash} />
                  <Text style={{fontSize: 12, color: '#f44336', marginTop: -5, marginBottom: 20}}>*Hệ thống sẽ đối soát tự động tiền bạn đếm với số tiền lý thuyết.</Text>

                  <TouchableOpacity style={styles.closeBtn} onPress={handleCloseShift}>
                    <Text style={styles.btnText}>ĐÓNG CA & CHỐT KÉT</Text>
                  </TouchableOpacity>
                </View>
              )
            )}
          </View>
        )}

        {/* === TAB 2: HISTORY === */}
        {activeTab === 'HISTORY' && !isStaff && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Lịch Sử Doanh Thu & Đối Soát Két</Text>
            {historyShifts.length === 0 && <Text style={{color: '#888'}}>Chưa có dữ liệu ca làm việc nào.</Text>}
            {historyShifts.map(shift => {
              const totalRev = shift.revenue_cash + shift.revenue_transfer;
              return (
                <View key={shift.id} style={styles.historyCard}>
                  <View style={{flexDirection: 'row', justifyContent: 'space-between', marginBottom: 10}}>
                    <Text style={{fontWeight: 'bold', fontSize: 16, color: '#1f2937'}}>{shift.opened_at.split(' ')[0]}</Text>
                    <Text style={{color: '#1976d2', fontWeight: 'bold'}}>{storeList.find(s=>s.id===shift.store_id)?.name}</Text>
                  </View>
                  
                  <Text style={styles.hText}>Ca mở: {shift.opened_at.split(' ')[1]} ({shift.opened_by_name})</Text>
                  <Text style={styles.hText}>Ca đóng: {shift.closed_at.split(' ')[1]} ({shift.closed_by_name})</Text>
                  
                  <View style={{flexDirection: 'row', justifyContent: 'space-between', marginTop: 10}}>
                    <Text style={{fontWeight: 'bold'}}>Tổng doanh thu:</Text>
                    <Text style={{fontWeight: 'bold', color: '#4caf50', fontSize: 16}}>{totalRev.toLocaleString()}đ</Text>
                  </View>
                  <Text style={{fontSize: 12, color: '#666', textAlign: 'right'}}>(TM: {shift.revenue_cash.toLocaleString()} - CK: {shift.revenue_transfer.toLocaleString()})</Text>

                  <View style={{backgroundColor: '#f5f5f5', padding: 10, borderRadius: 8, marginTop: 10}}>
                    <Text style={styles.hText}>Tiền đầu ca: {shift.opening_cash.toLocaleString()}đ</Text>
                    <Text style={styles.hText}>Tiền két thực tế: {shift.closing_cash_actual.toLocaleString()}đ</Text>
                    <View style={{flexDirection: 'row', justifyContent: 'space-between', marginTop: 5}}>
                      <Text style={{fontWeight: 'bold', color: '#333'}}>Kết quả đối soát:</Text>
                      {shift.discrepancy === 0 ? (
                        <Text style={{fontWeight: 'bold', color: '#4caf50'}}>Khớp 100%</Text>
                      ) : (
                        <Text style={{fontWeight: 'bold', color: '#f44336'}}>
                          Lệch {shift.discrepancy > 0 ? '+' : ''}{shift.discrepancy.toLocaleString()}đ
                        </Text>
                      )}
                    </View>
                  </View>
                </View>
              );
            })}
          </View>
        )}

      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f0f2f5', padding: 20 },
  headerRow: { flexDirection: 'row', alignItems: 'center', marginTop: 30, marginBottom: 15 },
  backBtn: { padding: 5, marginRight: 10 },
  header: { fontSize: 24, fontWeight: 'bold', color: '#1f2937' },
  tabContainer: { flexDirection: 'row', backgroundColor: '#e5e7eb', borderRadius: 8, padding: 4, marginBottom: 20 },
  tabBtn: { flex: 1, paddingVertical: 10, alignItems: 'center', borderRadius: 6 },
  tabBtnActive: { backgroundColor: '#fff', elevation: 2 },
  tabText: { fontWeight: 'bold', color: '#6b7280' },
  tabTextActive: { color: '#1976d2' },
  section: { backgroundColor: '#fff', padding: 20, borderRadius: 12, marginBottom: 20, elevation: 3 },
  sectionTitle: { fontSize: 18, fontWeight: '900', marginBottom: 15, color: '#374151', textAlign: 'center' },
  label: { fontSize: 14, fontWeight: 'bold', color: '#4b5563', marginBottom: 8, marginTop: 10 },
  input: { borderWidth: 1, borderColor: '#d1d5db', borderRadius: 8, padding: 15, fontSize: 16, backgroundColor: '#f9fafb', marginBottom: 10 },
  openBtn: { backgroundColor: '#4caf50', padding: 15, borderRadius: 8, alignItems: 'center', marginTop: 10 },
  closeBtn: { backgroundColor: '#f44336', padding: 15, borderRadius: 8, alignItems: 'center', marginTop: 10 },
  btnText: { color: '#fff', fontSize: 16, fontWeight: 'bold' },
  historyCard: { backgroundColor: '#fff', borderWidth: 1, borderColor: '#eee', padding: 15, borderRadius: 10, marginBottom: 15 },
  hText: { color: '#555', marginBottom: 3 }
});
