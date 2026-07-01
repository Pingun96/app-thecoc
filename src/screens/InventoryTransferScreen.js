import React, { useState, useEffect, useContext, useMemo } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, Modal, TextInput, Alert, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AppContext } from '../context/AppContext';
import { getTransferTickets, createTransferTicket, updateTicketStatus, processCompletedTicket } from '../services/inventoryTransferService';
import { getInventoryItems } from '../services/inventoryService';

export default function InventoryTransferScreen({ navigation }) {
  const { currentUser, storeList, COLORS, isDarkMode } = useContext(AppContext);
  const styles = useMemo(() => getStyles(COLORS, isDarkMode), [COLORS, isDarkMode]);
  const insets = useSafeAreaInsets();
  const isOwner = currentUser?.role === 'OWNER';
  const isManager = currentUser?.role === 'MANAGER';
  const myStoreId = currentUser?.store_id;

  const [loading, setLoading] = useState(true);
  const [tickets, setTickets] = useState([]);
  const [itemsList, setItemsList] = useState([]);
  
  // Create Modal
  const [showModal, setShowModal] = useState(false);
  const [ticketType, setTicketType] = useState('TRANSFER'); // IMPORT, EXPORT, TRANSFER
  const [toStoreId, setToStoreId] = useState(null);
  const [fromStoreId, setFromStoreId] = useState(myStoreId);
  const [note, setNote] = useState('');
  const [cart, setCart] = useState([]);

  // Droplist
  const [showItemPicker, setShowItemPicker] = useState(false);

  const fetchAll = async () => {
    setLoading(true);
    try {
      const [tix, items] = await Promise.all([
        getTransferTickets(myStoreId, currentUser?.role),
        getInventoryItems(myStoreId) // Assuming we load our store items for droplist
      ]);
      setTickets(tix || []);
      setItemsList(items || []);
    } catch (e) {
      Alert.alert('Lỗi', e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchAll(); }, []);

  const handleAddItem = (item) => {
    const existing = cart.find(c => c.itemId === item.id);
    if (existing) {
      setCart(cart.map(c => c.itemId === item.id ? { ...c, amount: c.amount + 1 } : c));
    } else {
      setCart([...cart, { itemId: item.id, name: item.name, amount: 1 }]);
    }
    setShowItemPicker(false);
  };

  const submitTicket = async () => {
    if (cart.length === 0) return Alert.alert('Lỗi', 'Chưa chọn mặt hàng nào');
    if (ticketType === 'TRANSFER' && (!fromStoreId || !toStoreId)) return Alert.alert('Lỗi', 'Cần chọn cửa hàng xuất và nhập');

    try {
      setLoading(true);
      const payload = {
        id: `TICKET_${Date.now()}`,
        type: ticketType,
        from_store_id: ticketType === 'IMPORT' ? null : (ticketType === 'EXPORT' ? myStoreId : fromStoreId),
        to_store_id: ticketType === 'EXPORT' ? null : (ticketType === 'IMPORT' ? myStoreId : toStoreId),
        created_by: currentUser.id,
        status: ticketType === 'TRANSFER' ? 'PENDING_DEST_MANAGER' : 'COMPLETED',
        note
      };
      
      const newTicket = await createTransferTicket(payload, cart);
      
      if (payload.status === 'COMPLETED') {
        newTicket.transfer_items = cart.map(c => ({ item_id: c.itemId, amount: c.amount }));
        await processCompletedTicket(newTicket);
      }
      
      Alert.alert('Thành công', 'Đã tạo phiếu');
      setShowModal(false);
      setCart([]); setNote('');
      fetchAll();
    } catch (e) {
      Alert.alert('Lỗi', e.message);
    } finally {
      setLoading(false);
    }
  };

  const handleApprove = async (ticket) => {
    Alert.alert('Xác nhận', 'Bạn có đồng ý nhận đơn luân chuyển này?', [
      { text: 'Từ chối', onPress: () => updateStatus(ticket, 'REJECTED'), style: 'destructive' },
      { text: 'Đồng ý', onPress: () => updateStatus(ticket, 'COMPLETED') }
    ]);
  };

  const updateStatus = async (ticket, status) => {
    try {
      setLoading(true);
      await updateTicketStatus(ticket.id, status, currentUser.id);
      if (status === 'COMPLETED') {
        await processCompletedTicket(ticket);
      }
      Alert.alert('Thành công', 'Đã duyệt phiếu');
      fetchAll();
    } catch(e) {
      Alert.alert('Lỗi', e.message);
    } finally {
      setLoading(false);
    }
  };

  const getStoreName = (id) => storeList.find(s => s.id === id)?.name || 'Ngoài hệ thống';

  return (
    <View style={styles.container}>
      <View style={[styles.header, { paddingTop: Math.max(insets.top + 10, 20) }]}>
        <TouchableOpacity onPress={() => navigation.goBack()}><Ionicons name="arrow-back" size={24} color="#fff" /></TouchableOpacity>
        <Text style={styles.headerTitle}>Phiếu Luân Chuyển / Nhập Xuất</Text>
        <TouchableOpacity onPress={fetchAll}><Ionicons name="refresh" size={24} color="#fff" /></TouchableOpacity>
      </View>

      <TouchableOpacity style={styles.fab} onPress={() => { setTicketType('TRANSFER'); setShowModal(true); }}>
        <Ionicons name="add" size={24} color="#fff" />
        <Text style={{color: '#fff', fontWeight: 'bold', marginLeft: 5}}>Tạo Phiếu</Text>
      </TouchableOpacity>

      {loading ? <ActivityIndicator size="large" style={{marginTop: 50}} /> : (
        <ScrollView style={{padding: 15}}>
          {tickets.map(t => (
            <View key={t.id} style={styles.ticketCard}>
              <View style={{flexDirection: 'row', justifyContent: 'space-between'}}>
                <Text style={styles.ticketType}>{t.type === 'TRANSFER' ? 'Chuyển nội bộ' : t.type === 'IMPORT' ? 'Nhập kho' : 'Xuất hủy'}</Text>
                <Text style={[styles.status, t.status==='COMPLETED' && {color: 'green'}]}>{t.status}</Text>
              </View>
              {t.type === 'TRANSFER' && (
                <Text style={styles.route}>{getStoreName(t.from_store_id)} {'->'} {getStoreName(t.to_store_id)}</Text>
              )}
              <Text style={styles.note}>{t.note}</Text>
              <Text style={{marginTop: 10, fontWeight: 'bold'}}>Mặt hàng:</Text>
              {t.transfer_items?.map(it => (
                <Text key={it.id} style={styles.itemLine}>- {it.item_id} (SL: {it.amount})</Text>
              ))}
              
              {t.status === 'PENDING_DEST_MANAGER' && (isOwner || t.to_store_id === myStoreId) && (
                <TouchableOpacity style={styles.approveBtn} onPress={() => handleApprove(t)}>
                  <Text style={{color: '#fff', textAlign: 'center'}}>Duyệt Nhận Hàng</Text>
                </TouchableOpacity>
              )}
            </View>
          ))}
          <View style={{height: 100}}/>
        </ScrollView>
      )}

      {/* MODAL TẠO PHIẾU */}
      <Modal visible={showModal} animationType="slide">
        <View style={styles.modalContainer}>
          <Text style={styles.modalTitle}>Tạo Phiếu Mới</Text>
          
          <View style={styles.typeRow}>
            <TouchableOpacity style={[styles.typeBtn, ticketType === 'IMPORT' && styles.typeBtnActive]} onPress={() => setTicketType('IMPORT')}>
              <Text style={[styles.typeText, ticketType === 'IMPORT' && {color:'#fff'}]}>NHẬP KHO</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.typeBtn, ticketType === 'EXPORT' && styles.typeBtnActive]} onPress={() => setTicketType('EXPORT')}>
              <Text style={[styles.typeText, ticketType === 'EXPORT' && {color:'#fff'}]}>XUẤT HỦY</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.typeBtn, ticketType === 'TRANSFER' && styles.typeBtnActive]} onPress={() => setTicketType('TRANSFER')}>
              <Text style={[styles.typeText, ticketType === 'TRANSFER' && {color:'#fff'}]}>CHUYỂN KHO</Text>
            </TouchableOpacity>
          </View>

          {ticketType === 'TRANSFER' && (
            <View style={{marginBottom: 15}}>
              <Text style={styles.label}>Chi nhánh Nhận hàng:</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                {storeList.filter(s => s.id !== fromStoreId).map(s => (
                  <TouchableOpacity key={s.id} style={[styles.storeBtn, toStoreId === s.id && styles.storeBtnActive]} onPress={() => setToStoreId(s.id)}>
                    <Text style={{color: toStoreId === s.id ? '#fff' : '#333'}}>{s.name}</Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            </View>
          )}

          <Text style={styles.label}>Ghi chú:</Text>
          <TextInput style={styles.input} value={note} onChangeText={setNote} placeholder="Lý do xuất/nhập/chuyển..." />

          <View style={{flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 15}}>
            <Text style={styles.label}>Danh sách mặt hàng:</Text>
            <TouchableOpacity onPress={() => setShowItemPicker(true)} style={{backgroundColor: '#e0f2fe', padding: 5, borderRadius: 5}}>
              <Text style={{color: '#0284c7'}}>+ Thêm</Text>
            </TouchableOpacity>
          </View>

          <ScrollView style={styles.cartList}>
            {cart.map((c, i) => (
              <View key={i} style={styles.cartItem}>
                <Text style={styles.cartItemName}>{c.name}</Text>
                <TextInput style={styles.cartInput} keyboardType="numeric" value={String(c.amount)} onChangeText={v => {
                  const newCart = [...cart]; newCart[i].amount = Number(v); setCart(newCart);
                }} />
                <TouchableOpacity onPress={() => setCart(cart.filter((_, idx) => idx !== i))}>
                  <Ionicons name="trash" size={20} color="red" />
                </TouchableOpacity>
              </View>
            ))}
          </ScrollView>

          <View style={{flexDirection: 'row', justifyContent: 'space-between', marginTop: 15}}>
            <TouchableOpacity style={[styles.submitBtn, {backgroundColor: 'gray'}]} onPress={() => setShowModal(false)}>
              <Text style={{color: '#fff'}}>Hủy</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.submitBtn} onPress={submitTicket}>
              <Text style={{color: '#fff'}}>Tạo Phiếu</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* DROPLIST NGUYÊN LIỆU */}
        <Modal visible={showItemPicker} transparent>
          <View style={styles.pickerOverlay}>
            <View style={styles.pickerContent}>
              <Text style={styles.modalTitle}>Chọn Nguyên Liệu</Text>
              <ScrollView>
                {itemsList.map(it => (
                  <TouchableOpacity key={it.id} style={styles.pickerItem} onPress={() => handleAddItem(it)}>
                    <Text style={styles.pickerItemText}>{it.name}</Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
              <TouchableOpacity style={{marginTop: 15, alignItems: 'center'}} onPress={() => setShowItemPicker(false)}>
                <Text style={{color: 'red'}}>Đóng</Text>
              </TouchableOpacity>
            </View>
          </View>
        </Modal>

      </Modal>
    </View>
  );
}

const getStyles = (COLORS, isDarkMode) => StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.bg },
  header: { backgroundColor: '#1565c0', paddingBottom: 15, paddingHorizontal: 20, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  headerTitle: { color: '#fff', fontSize: 18, fontWeight: 'bold' },
  fab: { position: 'absolute', bottom: 30, right: 20, backgroundColor: '#1565c0', padding: 15, borderRadius: 30, flexDirection: 'row', zIndex: 10, elevation: 5 },
  ticketCard: { backgroundColor: COLORS.card, padding: 15, borderRadius: 10, marginBottom: 15, elevation: 2, borderWidth: 1, borderColor: COLORS.border },
  ticketType: { fontWeight: 'bold', color: COLORS.primary, fontSize: 16 },
  status: { color: '#f59e0b', fontWeight: 'bold' },
  route: { color: COLORS.textMuted, marginVertical: 5 },
  note: { fontStyle: 'italic', color: COLORS.textMuted },
  itemLine: { marginLeft: 10, color: COLORS.text },
  approveBtn: { backgroundColor: '#10b981', padding: 10, borderRadius: 8, marginTop: 15 },
  
  modalContainer: { flex: 1, padding: 20, backgroundColor: COLORS.bg, paddingTop: 50 },
  modalTitle: { fontSize: 20, fontWeight: 'bold', marginBottom: 15, color: COLORS.text },
  typeRow: { flexDirection: 'row', marginBottom: 15 },
  typeBtn: { flex: 1, padding: 10, borderWidth: 1, borderColor: '#1565c0', alignItems: 'center' },
  typeBtnActive: { backgroundColor: '#1565c0' },
  typeText: { color: '#1565c0', fontWeight: 'bold' },
  label: { fontWeight: 'bold', marginBottom: 5, color: COLORS.text },
  storeBtn: { padding: 10, backgroundColor: COLORS.inputBg, borderRadius: 8, marginRight: 10, borderWidth: 1, borderColor: COLORS.border },
  storeBtnActive: { backgroundColor: '#1565c0' },
  input: { borderWidth: 1, borderColor: COLORS.inputBorder, backgroundColor: COLORS.inputBg, color: COLORS.text, borderRadius: 8, padding: 10, marginBottom: 15 },
  cartList: { flex: 1, borderWidth: 1, borderColor: COLORS.border, borderRadius: 8, padding: 10, backgroundColor: COLORS.card },
  cartItem: { flexDirection: 'row', alignItems: 'center', marginBottom: 10, paddingBottom: 10, borderBottomWidth: 1, borderBottomColor: COLORS.border },
  cartItemName: { flex: 1, color: COLORS.text, fontWeight: '600' },
  cartInput: { borderWidth: 1, borderColor: COLORS.inputBorder, backgroundColor: COLORS.inputBg, color: COLORS.text, width: 50, textAlign: 'center', marginRight: 15, borderRadius: 5 },
  submitBtn: { flex: 0.48, backgroundColor: '#1565c0', padding: 15, borderRadius: 8, alignItems: 'center' },

  pickerOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', padding: 20 },
  pickerContent: { backgroundColor: COLORS.card, borderRadius: 10, padding: 20, maxHeight: '80%', borderWidth: 1, borderColor: COLORS.border },
  pickerItem: { paddingVertical: 15, borderBottomWidth: 1, borderBottomColor: COLORS.border },
  pickerItemText: { color: COLORS.text, fontWeight: '600' }
});
