import React, { useCallback, useContext, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { AppContext } from '../context/AppContext';
import {
  createInventoryItem,
  createInventoryTicket,
  approveInventoryTicket,
  rejectInventoryTicket,
  deleteInventoryItem,
} from '../services/inventoryService';
import {
  normalizeInventoryItem,
} from '../services/dataMappers';

const ACTIONS = {
  IMPORT: { label: 'Nhập kho', shortLabel: 'NHẬP', color: '#16a34a', sign: '+' },
  EXPORT: { label: 'Xuất kho', shortLabel: 'XUẤT', color: '#dc2626', sign: '-' },
  ADJUST_UP: { label: 'Kiểm kê tăng', shortLabel: 'ĐIỀU CHỈNH +', color: '#7c3aed', sign: '+' },
  ADJUST_DOWN: { label: 'Hao hụt', shortLabel: 'ĐIỀU CHỈNH -', color: '#db2777', sign: '-' },
};

const formatQuantity = (value) => Number(value || 0).toLocaleString('vi-VN', {
  maximumFractionDigits: 2,
});

const formatTimestamp = (value) => {
  if (!value) return '--';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString('vi-VN', {
    hour: '2-digit',
    minute: '2-digit',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
};

const makeId = (prefix) => `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

const getRequestStatus = (status) => {
  if (status === 'PENDING_SOURCE') return { label: 'Chờ chi nhánh chuyển duyệt', color: '#b45309', bg: '#fef3c7' };
  if (status === 'PENDING_DEST') return { label: 'Chờ chi nhánh nhận duyệt', color: '#1d4ed8', bg: '#dbeafe' };
  if (status === 'APPROVED') return { label: 'Đã duyệt', color: '#15803d', bg: '#dcfce7' };
  if (status === 'REJECTED') return { label: 'Đã từ chối', color: '#b91c1c', bg: '#fee2e2' };
  return { label: status || 'Không rõ', color: '#475569', bg: '#e2e8f0' };
};

export default function InventoryScreen({ navigation }) {
  const {
    currentUser,
    staffList,
    inventoryItems,
    setInventoryItems,
    inventoryLogs,
    inventoryTickets,
    setInventoryTickets,
    selectedStoreId,
    storeList,
    refreshData,
    COLORS,
    isDarkMode,
  } = useContext(AppContext);
  const styles = useMemo(() => getStyles(COLORS, isDarkMode), [COLORS, isDarkMode]);

  const isOwner = currentUser?.role === 'OWNER';
  const isStaff = currentUser?.role === 'STAFF';
  const viewableStores = currentUser?.permissions?.viewable_stores || [];

  let storeIdToView = currentUser?.store_id;
  if (isOwner || viewableStores.includes(selectedStoreId)) storeIdToView = selectedStoreId;
  if (isOwner && selectedStoreId === 'ALL') storeIdToView = 'ALL';

  const storeName = storeIdToView === 'ALL'
    ? 'Tất cả chi nhánh'
    : storeList.find((store) => store.id === storeIdToView)?.name || `Chi nhánh ${storeIdToView || '--'}`;

  const myItems = useMemo(
    () => inventoryItems.filter(
      (item) => storeIdToView === 'ALL' || item.store_id === storeIdToView,
    ),
    [inventoryItems, storeIdToView],
  );

  const stockData = useMemo(() => myItems.map((item) => {
    const logs = inventoryLogs.filter(
      (log) => log.itemId === item.id && log.store_id === item.store_id,
    );
    const imported = logs
      .filter((log) => log.type === 'IMPORT' || log.type === 'ADJUST_UP')
      .reduce((sum, log) => sum + Number(log.amount || 0), 0);
    const exported = logs
      .filter((log) => log.type === 'EXPORT' || log.type === 'ADJUST_DOWN')
      .reduce((sum, log) => sum + Number(log.amount || 0), 0);
    const currentStock = Number((imported - exported).toFixed(2));
    return {
      ...item,
      logs,
      currentStock,
      isLowStock: currentStock <= Number(item.safeLevel || 0),
    };
  }), [inventoryLogs, myItems]);

  const stockByItemId = useMemo(
    () => Object.fromEntries(stockData.map((item) => [item.id, item])),
    [stockData],
  );
  const itemById = useMemo(
    () => Object.fromEntries(inventoryItems.map((item) => [item.id, item])),
    [inventoryItems],
  );
  const [historySearchText, setHistorySearchText] = useState('');
  const [historyTypeFilter, setHistoryTypeFilter] = useState('ALL');
  const [historyItemFilter, setHistoryItemFilter] = useState('ALL');
  const getLogTime = useCallback((log) => {
    const rawValue = log.created_at || log.date || log.updated_at || '';
    const parsed = new Date(rawValue);
    return Number.isNaN(parsed.getTime()) ? 0 : parsed.getTime();
  }, []);
  const getLogItem = useCallback((log) => itemById[log.itemId] || itemById[log.itemid] || itemById[log.item_id], [itemById]);
  const filteredHistoryLogs = useMemo(() => {
    const search = historySearchText.trim().toLowerCase();
    return inventoryLogs
      .filter((log) => storeIdToView === 'ALL' || String(log.store_id) === String(storeIdToView))
      .filter((log) => historyTypeFilter === 'ALL' || log.type === historyTypeFilter)
      .filter((log) => historyItemFilter === 'ALL' || String(log.itemId ?? log.itemid ?? log.item_id) === String(historyItemFilter))
      .filter((log) => {
        if (!search) return true;
        const item = getLogItem(log);
        const creatorName = staffList.find(s => s.id === log.created_by)?.name || '';
        const approverName = staffList.find(s => s.id === log.approved_by)?.name || '';
        return [
          item?.name,
          log.note,
          log.type,
          creatorName,
          approverName,
        ].some((value) => String(value || '').toLowerCase().includes(search));
      })
      .sort((a, b) => getLogTime(b) - getLogTime(a) || String(b.date || '').localeCompare(String(a.date || '')));
  }, [inventoryLogs, storeIdToView, historyTypeFilter, historyItemFilter, historySearchText, getLogItem, getLogTime, staffList]);

  const [activeTab, setActiveTab] = useState(isStaff ? 'ACTION' : 'OVERVIEW');
  const [actionType, setActionType] = useState('EXPORT');
  const [cartItems, setCartItems] = useState([]);
  const [amount, setAmount] = useState('');
  const [selectedItemId, setSelectedItemId] = useState('');
  const [searchText, setSearchText] = useState('');
  const [busyKey, setBusyKey] = useState('');
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [isItemDropdownOpen, setIsItemDropdownOpen] = useState(false);
  const [newItemName, setNewItemName] = useState('');
  const [newItemUnit, setNewItemUnit] = useState('kg');
  const [newItemSafeLevel, setNewItemSafeLevel] = useState('5');

  const effectiveSelectedItemId = myItems.some((item) => item.id === selectedItemId)
    ? selectedItemId
    : myItems[0]?.id || '';
  const filteredStock = stockData.filter((item) => (
    item.name.toLowerCase().includes(searchText.trim().toLowerCase())
  ));
  const lowStockCount = stockData.filter((item) => item.isLowStock).length;
  const selectedStock = stockByItemId[effectiveSelectedItemId];
  const pendingRequests = inventoryTickets.filter((ticket) => {
    if (storeIdToView !== 'ALL' && ticket.source_store_id !== storeIdToView && ticket.destination_store_id !== storeIdToView) return false;
    
    const isSourceManager = ticket.source_store_id === currentUser?.store_id;
    const isDestManager = ticket.destination_store_id === currentUser?.store_id;

    if (isOwner) {
      return ['PENDING_SOURCE', 'PENDING_DEST'].includes(ticket.status);
    }
    
    if (ticket.status === 'PENDING_SOURCE' && isSourceManager) return true;
    if (ticket.status === 'PENDING_DEST' && isDestManager) return true;
    
    return false;
  });

  const runOperation = async (key, operation) => {
    setBusyKey(key);
    try {
      await operation();
    } catch (error) {
      console.error('Lỗi quản lý kho:', error);
      Alert.alert('Không thể hoàn tất', error?.message || 'Đã có lỗi khi lưu dữ liệu kho.');
    } finally {
      setBusyKey('');
    }
  };

  const handleAddToCart = () => {
    if (!selectedStock) return Alert.alert('Lỗi', 'Vui lòng chọn nguyên liệu');
    const numericAmount = Number(String(amount).replace(',', '.'));
    if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
      return Alert.alert('Lỗi', 'Số lượng phải lớn hơn 0.');
    }
    
    const existingIndex = cartItems.findIndex(i => i.itemId === selectedStock.id);
    if (existingIndex > -1) {
      const newCart = [...cartItems];
      newCart[existingIndex].amount += numericAmount;
      setCartItems(newCart);
    } else {
      setCartItems([...cartItems, {
        itemId: selectedStock.id,
        name: selectedStock.name,
        unit: selectedStock.unit,
        amount: numericAmount,
        currentStock: selectedStock.currentStock
      }]);
    }
    setAmount('');
  };

  const handleRemoveFromCart = (itemId) => setCartItems(cartItems.filter(i => i.itemId !== itemId));

  const handleSubmitAction = () => runOperation('submit-action', async () => {
    if (cartItems.length === 0) throw new Error('Giỏ hàng trống. Vui lòng thêm ít nhất 1 mặt hàng.');
    if (storeIdToView === 'ALL') throw new Error('Vui lòng chọn một chi nhánh cụ thể.');

    if (actionType === 'EXPORT') {
      for (const item of cartItems) {
        if (item.amount > item.currentStock) {
          throw new Error(`Không thể xuất ${item.name}. Tồn kho hiện tại chỉ còn ${formatQuantity(item.currentStock)} ${item.unit}.`);
        }
      }
    }

    let initialStatus = 'PENDING_SOURCE';
    if (actionType === 'IMPORT') initialStatus = 'PENDING_DEST';

    const ticket = {
      id: makeId('ticket'),
      type: actionType,
      source_store_id: actionType === 'EXPORT' ? storeIdToView : null,
      destination_store_id: actionType === 'IMPORT' ? storeIdToView : null,
      items: cartItems,
      status: initialStatus,
      requested_by: currentUser?.id,
      requested_by_name: currentUser?.name || 'Nhân viên',
    };

    await createInventoryTicket(ticket);
    
    if (isOwner) {
       await approveInventoryTicket(ticket, currentUser.id, storeIdToView);
       Alert.alert('Thành công', 'Phiếu đã được tạo và tự động duyệt vì bạn là Chủ Cửa Hàng.');
    } else {
       Alert.alert('Đã gửi phiếu', 'Yêu cầu đã được gửi đến quản lý để phê duyệt.');
    }
    
    setCartItems([]);
    await refreshData?.();
  });

  const handleReview = (ticket, decision) => runOperation(`review-${ticket.id}`, async () => {
    if (decision === 'REJECT') {
      await rejectInventoryTicket(ticket.id, currentUser?.id);
      setInventoryTickets((current) => current.map((item) => (
        item.id === ticket.id ? { ...item, status: 'REJECTED' } : item
      )));
      Alert.alert('Đã từ chối', 'Phiếu yêu cầu đã bị hủy.');
      return;
    }

    await approveInventoryTicket(ticket, currentUser?.id, currentUser?.store_id);
    
    // We should refresh data because we might have generated new logs or items
    await refreshData?.();
    Alert.alert('Thành công', 'Đã duyệt phiếu. Kho đã được cập nhật!');
  });

  const handleCreateItem = () => runOperation('create-item', async () => {
    const cleanName = newItemName.trim();
    const cleanUnit = newItemUnit.trim();
    const safeLevel = Number(String(newItemSafeLevel).replace(',', '.'));

    if (!cleanName || !cleanUnit) throw new Error('Vui lòng nhập tên và đơn vị tính.');
    if (!Number.isFinite(safeLevel) || safeLevel < 0) {
      throw new Error('Mức tồn an toàn phải là số từ 0 trở lên.');
    }
    if (storeIdToView === 'ALL' || !storeIdToView) {
      throw new Error('Vui lòng chọn một chi nhánh cụ thể trước khi thêm nguyên liệu.');
    }
    const duplicated = myItems.some(
      (item) => item.name.trim().toLowerCase() === cleanName.toLowerCase(),
    );
    if (duplicated) throw new Error('Nguyên liệu này đã tồn tại trong chi nhánh.');

    const item = {
      id: makeId('item'),
      name: cleanName,
      unit: cleanUnit,
      safelevel: safeLevel,
      store_id: storeIdToView,
    };
    await createInventoryItem(item);
    setInventoryItems((current) => [...current, normalizeInventoryItem(item)]);
    setNewItemName('');
    setNewItemUnit('kg');
    setNewItemSafeLevel('5');
    setShowCreateModal(false);
    Alert.alert('Đã thêm nguyên liệu', `${cleanName} đã được thêm vào ${storeName}.`);
  });

  const handleDeleteItem = (item) => {
    Alert.alert(
      'Xác nhận xoá',
      `Bạn có chắc chắn muốn xoá nguyên liệu "${item.name}" không? Toàn bộ dữ liệu tồn kho hiện tại sẽ bị xoá và không thể phục hồi.`,
      [
        { text: 'Huỷ', style: 'cancel' },
        {
          text: 'Xoá',
          style: 'destructive',
          onPress: () => runOperation(`delete-item-${item.id}`, async () => {
            await deleteInventoryItem(item.id);
            setInventoryItems((current) => current.filter(i => i.id !== item.id));
            Alert.alert('Thành công', 'Đã xoá nguyên liệu.');
          })
        }
      ]
    );
  };

  const renderStatusBadge = (status) => {
    const config = getRequestStatus(status);
    return (
      <View style={[styles.statusBadge, { backgroundColor: config.bg }]}>
        <Text style={[styles.statusBadgeText, { color: config.color }]}>{config.label}</Text>
      </View>
    );
  };

  const renderRequestCard = (ticket, reviewable = false) => {
    let actionLabel = ticket.type;
    let actionColor = '#475569';
    if (ticket.type === 'IMPORT') { actionLabel = 'Nhập kho'; actionColor = '#16a34a'; }
    if (ticket.type === 'EXPORT') { actionLabel = 'Xuất kho'; actionColor = '#dc2626'; }
    if (ticket.type === 'TRANSFER') { actionLabel = 'Chuyển kho'; actionColor = '#7c3aed'; }

    const isBusy = busyKey === `review-${ticket.id}`;
    
    return (
      <View key={ticket.id} style={styles.requestCard}>
        <View style={styles.requestHeader}>
          <View style={{ flex: 1 }}>
            <Text style={[styles.requestType, { color: actionColor }]}>{actionLabel}</Text>
            {ticket.type === 'TRANSFER' && (
              <Text style={{ fontSize: 12, color: '#64748b', marginTop: 2 }}>
                Từ: CN {ticket.source_store_id} ➔ Đến: CN {ticket.destination_store_id}
              </Text>
            )}
          </View>
          {renderStatusBadge(ticket.status)}
        </View>
        
        <View style={{ marginTop: 10, backgroundColor: '#f8fafc', padding: 8, borderRadius: 8 }}>
          {(ticket.items || []).map((it, idx) => (
            <View key={idx} style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 }}>
              <Text style={{ color: '#334155', fontWeight: '600' }}>• {it.name}</Text>
              <Text style={{ color: '#0f172a', fontWeight: '700' }}>{formatQuantity(it.amount)} {it.unit}</Text>
            </View>
          ))}
        </View>

        <Text style={styles.requestMeta}>
          Người tạo: {ticket.requested_by_name || 'Không rõ'} • {formatTimestamp(ticket.created_at)}
        </Text>
        
        {reviewable && (
          <View style={styles.reviewRow}>
            <TouchableOpacity
              style={[styles.reviewButton, styles.rejectButton]}
              onPress={() => handleReview(ticket, 'REJECT')}
              disabled={isBusy}
            >
              <Text style={styles.reviewButtonText}>Từ chối</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.reviewButton, styles.approveButton]}
              onPress={() => handleReview(ticket, 'APPROVE')}
              disabled={isBusy}
            >
              {isBusy
                ? <ActivityIndicator color="#fff" />
                : <Text style={styles.reviewButtonText}>Duyệt phiếu</Text>}
            </TouchableOpacity>
          </View>
        )}
      </View>
    );
  };

  const tabs = isStaff
    ? [{ key: 'ACTION', label: 'Thao tác' }, { key: 'HISTORY', label: 'Lịch sử' }]
    : [
        { key: 'OVERVIEW', label: 'Tổng quan' },
        { key: 'ACTION', label: 'Thao tác' },
        { key: 'APPROVALS', label: `Duyệt${pendingRequests.length ? ` (${pendingRequests.length})` : ''}` },
        { key: 'HISTORY', label: 'Lịch sử' },
        { key: 'ITEMS', label: 'Danh mục' },
      ];

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={{ flex: 1 }}
      >
        <View style={styles.headerRow}>
          <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
            <Ionicons name="arrow-back" size={24} color="#1565c0" />
          </TouchableOpacity>
          <View style={{ flex: 1 }}>
            <Text style={styles.header}>Quản lý kho</Text>
            <Text style={styles.headerCaption}>{storeName}</Text>
          </View>
          {!isStaff && (
            <TouchableOpacity onPress={() => refreshData?.()} style={styles.refreshButton}>
              <Ionicons name="refresh" size={21} color="#1565c0" />
            </TouchableOpacity>
          )}
        </View>

        <View style={styles.tabContainer}>
          {tabs.map((tab) => (
            <TouchableOpacity
              key={tab.key}
              style={[styles.tabButton, activeTab === tab.key && styles.tabButtonActive]}
              onPress={() => setActiveTab(tab.key)}
            >
              <Text
                numberOfLines={1}
                style={[styles.tabText, activeTab === tab.key && styles.tabTextActive]}
              >
                {tab.label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        <ScrollView
          style={{ flex: 1 }}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={styles.scrollContent}
        >
          {activeTab === 'OVERVIEW' && !isStaff && (
            <>
              <View style={styles.summaryRow}>
                <View style={styles.summaryCard}>
                  <Text style={styles.summaryValue}>{stockData.length}</Text>
                  <Text style={styles.summaryLabel}>Mặt hàng</Text>
                </View>
                <View style={[styles.summaryCard, lowStockCount > 0 && styles.summaryWarning]}>
                  <Text style={[styles.summaryValue, lowStockCount > 0 && { color: '#b91c1c' }]}>
                    {lowStockCount}
                  </Text>
                  <Text style={styles.summaryLabel}>Sắp hết hàng</Text>
                </View>
                <View style={styles.summaryCard}>
                  <Text style={styles.summaryValue}>{pendingRequests.length}</Text>
                  <Text style={styles.summaryLabel}>Chờ duyệt</Text>
                </View>
              </View>

              <View style={styles.section}>
                <View style={styles.sectionHeader}>
                  <Text style={styles.sectionTitle}>Tồn kho hiện tại</Text>
                  <Ionicons name="cube-outline" size={21} color="#64748b" />
                </View>
                <View style={styles.searchBox}>
                  <Ionicons name="search" size={19} color="#94a3b8" />
                  <TextInput
                    value={searchText}
                    onChangeText={setSearchText}
                    placeholder="Tìm nguyên liệu..."
                    placeholderTextColor="#94a3b8"
                    style={styles.searchInput}
                  />
                </View>

                {filteredStock.length === 0 ? (
                  <Text style={styles.emptyText}>Chưa có nguyên liệu phù hợp.</Text>
                ) : filteredStock.map((item) => (
                  <View key={item.id} style={styles.stockRow}>
                    <View style={[styles.stockIcon, item.isLowStock && styles.stockIconLow]}>
                      <Ionicons
                        name={item.isLowStock ? 'warning-outline' : 'checkmark-circle-outline'}
                        size={21}
                        color={item.isLowStock ? '#dc2626' : '#16a34a'}
                      />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.stockName}>{item.name}</Text>
                      <Text style={styles.stockSafe}>An toàn từ {formatQuantity(item.safeLevel)} {item.unit}</Text>
                    </View>
                    <View style={{ alignItems: 'flex-end' }}>
                      <Text style={[styles.stockValue, item.isLowStock && { color: '#dc2626' }]}>
                        {formatQuantity(item.currentStock)}
                      </Text>
                      <Text style={styles.stockUnit}>{item.unit}</Text>
                    </View>
                  </View>
                ))}
              </View>
            </>
          )}

          {activeTab === 'ACTION' && (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Tạo phiếu kho đa mặt hàng</Text>
              
              <Text style={styles.fieldLabel}>Loại phiếu</Text>
              <View style={styles.actionGrid}>
                {['IMPORT', 'EXPORT'].map((type) => (
                  <TouchableOpacity
                    key={type}
                    style={[
                      styles.actionButton,
                      actionType === type && { backgroundColor: type==='IMPORT'?'#16a34a':type==='EXPORT'?'#dc2626':'#7c3aed', borderColor: type==='IMPORT'?'#16a34a':type==='EXPORT'?'#dc2626':'#7c3aed' },
                    ]}
                    onPress={() => { setActionType(type); setCartItems([]); }}
                  >
                    <Text style={[styles.actionButtonText, actionType === type && { color: '#fff' }]}>
                      {type === 'IMPORT' ? 'Nhập Hàng' : 'Xuất Hủy'}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
              <View style={{ height: 1, backgroundColor: '#e2e8f0', marginVertical: 15 }} />

              <Text style={styles.fieldLabel}>Chọn nguyên liệu</Text>
              <TouchableOpacity
                style={styles.dropdownButton}
                onPress={() => setIsItemDropdownOpen(!isItemDropdownOpen)}
              >
                <Text style={styles.dropdownButtonText}>
                  {selectedStock ? selectedStock.name : 'Vui lòng chọn...'}
                </Text>
                <Ionicons name={isItemDropdownOpen ? "chevron-up" : "chevron-down"} size={20} color="#475569" />
              </TouchableOpacity>

              {isItemDropdownOpen && (
                <View style={styles.dropdownList}>
                  <ScrollView style={{ maxHeight: 200 }} nestedScrollEnabled>
                    {myItems.map((item) => (
                      <TouchableOpacity
                        key={item.id}
                        style={[styles.dropdownItem, effectiveSelectedItemId === item.id && styles.dropdownItemActive]}
                        onPress={() => {
                          setSelectedItemId(item.id);
                          setIsItemDropdownOpen(false);
                        }}
                      >
                        <Text style={[styles.dropdownItemText, effectiveSelectedItemId === item.id && styles.dropdownItemTextActive]}>
                          {item.name}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </ScrollView>
                </View>
              )}

              {selectedStock && (
                <View style={styles.currentStockBox}>
                  <Text style={styles.currentStockLabel}>Tồn khả dụng</Text>
                  <Text style={styles.currentStockValue}>
                    {formatQuantity(selectedStock.currentStock)} {selectedStock.unit}
                  </Text>
                </View>
              )}

              <View style={{flexDirection: 'row', alignItems: 'center', marginTop: 10, gap: 10}}>
                <View style={{flex: 1}}>
                  <TextInput
                    style={styles.input}
                    keyboardType="decimal-pad"
                    placeholder="Nhập số lượng..."
                    placeholderTextColor="#94a3b8"
                    value={amount}
                    onChangeText={setAmount}
                  />
                </View>
                <TouchableOpacity style={{backgroundColor: '#1565c0', padding: 14, borderRadius: 12}} onPress={handleAddToCart}>
                  <Ionicons name="add" size={20} color="#fff" />
                </TouchableOpacity>
              </View>

              {cartItems.length > 0 && (
                <View style={{marginTop: 20}}>
                  <Text style={styles.sectionTitle}>Danh sách đã chọn ({cartItems.length})</Text>
                  {cartItems.map((item, idx) => (
                    <View key={idx} style={{flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: '#f8fafc', padding: 12, borderRadius: 8, marginBottom: 8, borderWidth: 1, borderColor: '#e2e8f0'}}>
                      <View>
                        <Text style={{fontWeight: '700', color: '#1e293b'}}>{item.name}</Text>
                        <Text style={{color: '#64748b', fontSize: 12}}>Số lượng: {formatQuantity(item.amount)} {item.unit}</Text>
                      </View>
                      <TouchableOpacity onPress={() => handleRemoveFromCart(item.itemId)}>
                        <Ionicons name="trash-outline" size={20} color="#ef4444" />
                      </TouchableOpacity>
                    </View>
                  ))}

                  <TouchableOpacity
                    style={[styles.submitButton, Boolean(busyKey) && styles.disabledButton]}
                    onPress={handleSubmitAction}
                    disabled={Boolean(busyKey)}
                  >
                    {busyKey === 'submit-action'
                      ? <ActivityIndicator color="#fff" />
                      : (
                        <>
                          <Ionicons name="paper-plane-outline" size={21} color="#fff" />
                          <Text style={styles.submitButtonText}>Tạo Phiếu Kho</Text>
                        </>
                      )}
                  </TouchableOpacity>
                </View>
              )}
            </View>
          )}

          {activeTab === 'APPROVALS' && !isStaff && (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Phiếu chờ duyệt</Text>
              {pendingRequests.length === 0
                ? (
                  <View style={styles.emptyState}>
                    <Ionicons name="checkmark-done-circle-outline" size={40} color="#16a34a" />
                    <Text style={styles.emptyTitle}>Không có phiếu tồn đọng</Text>
                    <Text style={styles.emptyText}>Các yêu cầu mới sẽ xuất hiện tại đây.</Text>
                  </View>
                )
                : pendingRequests.map((request) => renderRequestCard(request, true))}
            </View>
          )}

          {activeTab === 'HISTORY' && (
            <View style={styles.section}>
              <View style={styles.sectionHeader}>
                <View>
                  <Text style={styles.sectionTitle}>Lịch sử Nhập/Xuất kho</Text>
                  <Text style={styles.historyCount}>{filteredHistoryLogs.length} giao dịch mới nhất lên đầu</Text>
                </View>
                <Ionicons name="time-outline" size={22} color={COLORS.textMuted} />
              </View>

              <View style={styles.searchBox}>
                <Ionicons name="search" size={19} color="#94a3b8" />
                <TextInput
                  value={historySearchText}
                  onChangeText={setHistorySearchText}
                  placeholder="Tìm theo món, người tạo, ghi chú..."
                  placeholderTextColor="#94a3b8"
                  style={styles.searchInput}
                />
              </View>

              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.filterScroller}>
                {[
                  { key: 'ALL', label: 'Tất cả' },
                  { key: 'IMPORT', label: 'Nhập' },
                  { key: 'EXPORT', label: 'Xuất' },
                  { key: 'ADJUST_UP', label: 'Điều chỉnh +' },
                  { key: 'ADJUST_DOWN', label: 'Điều chỉnh -' },
                ].map((filter) => (
                  <TouchableOpacity
                    key={filter.key}
                    style={[styles.filterChip, historyTypeFilter === filter.key && styles.filterChipActive]}
                    onPress={() => setHistoryTypeFilter(filter.key)}
                  >
                    <Text style={[styles.filterChipText, historyTypeFilter === filter.key && styles.filterChipTextActive]}>
                      {filter.label}
                    </Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>

              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.filterScroller}>
                <TouchableOpacity
                  style={[styles.filterChip, historyItemFilter === 'ALL' && styles.filterChipActive]}
                  onPress={() => setHistoryItemFilter('ALL')}
                >
                  <Text style={[styles.filterChipText, historyItemFilter === 'ALL' && styles.filterChipTextActive]}>
                    Tất cả nguyên liệu
                  </Text>
                </TouchableOpacity>
                {myItems.map((item) => (
                  <TouchableOpacity
                    key={item.id}
                    style={[styles.filterChip, historyItemFilter === item.id && styles.filterChipActive]}
                    onPress={() => setHistoryItemFilter(item.id)}
                  >
                    <Text style={[styles.filterChipText, historyItemFilter === item.id && styles.filterChipTextActive]}>
                      {item.name}
                    </Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>

              {filteredHistoryLogs.length === 0 ? (
                <View style={styles.emptyState}>
                  <Ionicons name="file-tray-outline" size={40} color={COLORS.textMuted} />
                  <Text style={styles.emptyTitle}>Không có lịch sử phù hợp</Text>
                  <Text style={styles.emptyText}>Thử đổi bộ lọc hoặc từ khoá tìm kiếm.</Text>
                </View>
              ) : filteredHistoryLogs.map((log) => {
                  const item = getLogItem(log);
                  const action = ACTIONS[log.type] || ACTIONS.IMPORT;
                  const creatorName = staffList.find(s => s.id === log.created_by)?.name || 'Hệ thống';
                  const approverName = staffList.find(s => s.id === log.approved_by)?.name || '';
                  const store = storeList.find((storeItem) => String(storeItem.id) === String(log.store_id));

                  return (
                    <View key={log.id} style={styles.logCard}>
                      <View style={styles.logCardHeader}>
                        <View style={[styles.logIcon, { backgroundColor: `${action.color}18` }]}>
                          <Ionicons
                            name={action.sign === '+' ? 'add' : 'remove'}
                            size={22}
                            color={action.color}
                          />
                        </View>
                        <View style={{ flex: 1 }}>
                          <Text style={styles.logTitle}>{item?.name || 'Không rõ nguyên liệu'}</Text>
                          <Text style={styles.logMeta}>
                            {action.label} • {formatTimestamp(log.created_at || log.date)}
                          </Text>
                          {store?.name ? <Text style={styles.logMeta}>{store.name}</Text> : null}
                        </View>
                        <Text style={[styles.logAmount, { color: action.color }]}>
                          {action.sign}{formatQuantity(log.amount)} {item?.unit || ''}
                        </Text>
                      </View>

                      <View style={styles.logDetailBox}>
                        <Text style={styles.logDetailText}>
                          👤 Tạo bởi: <Text style={styles.logDetailStrong}>{creatorName}</Text>
                        </Text>
                        {approverName ? (
                          <Text style={styles.logDetailText}>
                            ✅ Duyệt bởi: <Text style={[styles.logDetailStrong, { color: '#16a34a' }]}>{approverName}</Text>
                          </Text>
                        ) : null}
                        {log.note ? (
                          <Text style={styles.logNote}>📝 {log.note}</Text>
                        ) : null}
                      </View>
                    </View>
                  );
                })}
            </View>
          )}

          {activeTab === 'ITEMS' && !isStaff && (
            <>
              <View style={styles.section}>
                <View style={styles.sectionHeader}>
                  <Text style={styles.sectionTitle}>Danh mục nguyên liệu</Text>
                  <TouchableOpacity style={styles.addButton} onPress={() => setShowCreateModal(true)}>
                    <Ionicons name="add" size={18} color="#fff" />
                    <Text style={styles.addButtonText}>Thêm</Text>
                  </TouchableOpacity>
                </View>
                {myItems.length === 0
                  ? <Text style={styles.emptyText}>Chưa có nguyên liệu.</Text>
                  : myItems.map((item) => (
                    <View key={item.id} style={styles.catalogRow}>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.catalogName}>{item.name}</Text>
                        <Text style={styles.catalogMeta}>
                          Đơn vị: {item.unit} • Tồn an toàn: {formatQuantity(item.safeLevel)}
                        </Text>
                      </View>
                      <View style={{ alignItems: 'flex-end' }}>
                        <Text style={styles.catalogStock}>
                          {formatQuantity(stockByItemId[item.id]?.currentStock)} {item.unit}
                        </Text>
                        {isOwner && (
                          <TouchableOpacity onPress={() => handleDeleteItem(item)} style={{ marginTop: 8 }}>
                            <Ionicons name="trash-outline" size={20} color="#dc2626" />
                          </TouchableOpacity>
                        )}
                      </View>
                    </View>
                  ))}
              </View>
            </>
          )}
        </ScrollView>

        <Modal visible={showCreateModal} transparent animationType="fade">
          <View style={styles.modalOverlay}>
            <View style={styles.modalContent}>
              <View style={styles.modalHeader}>
                <Text style={styles.modalTitle}>Thêm nguyên liệu</Text>
                <TouchableOpacity onPress={() => setShowCreateModal(false)}>
                  <Ionicons name="close" size={25} color="#475569" />
                </TouchableOpacity>
              </View>
              <Text style={styles.modalStore}>{storeName}</Text>
              <Text style={styles.fieldLabel}>Tên nguyên liệu</Text>
              <TextInput
                style={styles.input}
                placeholder="Ví dụ: Bột matcha"
                placeholderTextColor="#94a3b8"
                value={newItemName}
                onChangeText={setNewItemName}
              />
              <View style={styles.modalFieldRow}>
                <View style={styles.modalField}>
                  <Text style={styles.fieldLabel}>Đơn vị</Text>
                  <TextInput style={styles.input} value={newItemUnit} onChangeText={setNewItemUnit} />
                </View>
                <View style={styles.modalField}>
                  <Text style={styles.fieldLabel}>Tồn an toàn</Text>
                  <TextInput
                    style={styles.input}
                    keyboardType="decimal-pad"
                    value={newItemSafeLevel}
                    onChangeText={setNewItemSafeLevel}
                  />
                </View>
              </View>
              <TouchableOpacity
                style={[styles.submitButton, busyKey === 'create-item' && styles.disabledButton]}
                onPress={handleCreateItem}
                disabled={busyKey === 'create-item'}
              >
                {busyKey === 'create-item'
                  ? <ActivityIndicator color="#fff" />
                  : <Text style={styles.submitButtonText}>Thêm vào danh mục</Text>}
              </TouchableOpacity>
            </View>
          </View>
        </Modal>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const getStyles = (COLORS, isDarkMode) => StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.bg },
  headerRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingTop: 10, paddingBottom: 14 },
  backBtn: { padding: 8, marginRight: 8, marginLeft: -8 },
  header: { fontSize: 25, fontWeight: '800', color: COLORS.text },
  headerCaption: { color: COLORS.textMuted, marginTop: 2 },
  refreshButton: { padding: 10, backgroundColor: COLORS.inputBg, borderRadius: 12, borderWidth: 1, borderColor: COLORS.border },
  tabContainer: { flexDirection: 'row', marginHorizontal: 20, backgroundColor: COLORS.inputBg, borderRadius: 12, padding: 4, borderWidth: 1, borderColor: COLORS.border },
  tabButton: { flex: 1, minHeight: 40, alignItems: 'center', justifyContent: 'center', borderRadius: 9, paddingHorizontal: 3 },
  tabButtonActive: { backgroundColor: COLORS.card, shadowColor: '#000', shadowOpacity: isDarkMode ? 0.25 : 0.08, shadowRadius: 5, elevation: 2 },
  tabText: { color: COLORS.textMuted, fontWeight: '700', fontSize: 12 },
  tabTextActive: { color: COLORS.primary },
  dropdownButton: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: COLORS.inputBg, borderWidth: 1, borderColor: COLORS.inputBorder, borderRadius: 12, paddingHorizontal: 14, minHeight: 48 },
  dropdownButtonText: { color: COLORS.text, fontSize: 15, fontWeight: '600' },
  dropdownList: { backgroundColor: COLORS.card, borderWidth: 1, borderColor: COLORS.border, borderRadius: 12, marginTop: 4, overflow: 'hidden' },
  dropdownItem: { paddingVertical: 14, paddingHorizontal: 14, borderBottomWidth: 1, borderBottomColor: COLORS.border },
  dropdownItemActive: { backgroundColor: isDarkMode ? '#0f2a44' : '#eff6ff' },
  dropdownItemText: { color: COLORS.text, fontSize: 15 },
  dropdownItemTextActive: { color: '#1d4ed8', fontWeight: '700' },
  scrollContent: { padding: 20, paddingBottom: 50 },
  summaryRow: { flexDirection: 'row', gap: 10, marginBottom: 16 },
  summaryCard: { flex: 1, backgroundColor: COLORS.card, borderRadius: 14, padding: 14, borderWidth: 1, borderColor: COLORS.border },
  summaryWarning: { backgroundColor: '#fff7ed', borderColor: '#fed7aa' },
  summaryValue: { color: COLORS.text, fontSize: 24, fontWeight: '900' },
  summaryLabel: { color: COLORS.textMuted, fontSize: 11, marginTop: 4 },
  section: { backgroundColor: COLORS.card, borderRadius: 18, padding: 18, marginBottom: 16, shadowColor: '#000', shadowOpacity: isDarkMode ? 0.22 : 0.06, shadowRadius: 10, elevation: 2, borderWidth: 1, borderColor: COLORS.border },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  sectionTitle: { color: COLORS.text, fontSize: 18, fontWeight: '800', marginBottom: 14 },
  searchBox: { flexDirection: 'row', alignItems: 'center', backgroundColor: COLORS.inputBg, borderWidth: 1, borderColor: COLORS.inputBorder, borderRadius: 12, paddingHorizontal: 12, marginBottom: 10 },
  searchInput: { flex: 1, minHeight: 44, paddingLeft: 8, color: COLORS.text },
  stockRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 13, borderBottomWidth: 1, borderBottomColor: COLORS.border },
  stockIcon: { width: 38, height: 38, borderRadius: 12, backgroundColor: '#dcfce7', alignItems: 'center', justifyContent: 'center', marginRight: 11 },
  stockIconLow: { backgroundColor: '#fee2e2' },
  stockName: { color: COLORS.text, fontWeight: '800', fontSize: 14 },
  stockSafe: { color: COLORS.textMuted, fontSize: 11, marginTop: 3 },
  stockValue: { color: '#15803d', fontWeight: '900', fontSize: 18 },
  stockUnit: { color: COLORS.textMuted, fontSize: 11 },
  fieldLabel: { color: COLORS.text, fontWeight: '800', fontSize: 13, marginTop: 10, marginBottom: 8 },
  itemScroller: { marginBottom: 5 },
  itemChip: { backgroundColor: COLORS.inputBg, borderRadius: 20, paddingHorizontal: 14, paddingVertical: 9, marginRight: 8, borderWidth: 1, borderColor: COLORS.border },
  itemChipActive: { backgroundColor: '#1565c0', borderColor: '#1565c0' },
  itemChipText: { color: COLORS.textMuted, fontWeight: '700', fontSize: 12 },
  itemChipTextActive: { color: '#fff' },
  currentStockBox: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: isDarkMode ? '#0f2a44' : '#eff6ff', borderRadius: 12, padding: 13, marginTop: 12 },
  currentStockLabel: { color: COLORS.textMuted, fontWeight: '600' },
  currentStockValue: { color: '#1d4ed8', fontWeight: '900', fontSize: 17 },
  actionGrid: { flexDirection: 'row', gap: 10 },
  actionButton: { flex: 1, minHeight: 48, borderWidth: 1, borderColor: COLORS.inputBorder, borderRadius: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'center' },
  actionButtonText: { color: COLORS.textMuted, fontWeight: '800', marginLeft: 6 },
  stocktakeButton: { minHeight: 48, borderWidth: 1, borderColor: '#c4b5fd', backgroundColor: '#f5f3ff', borderRadius: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', marginTop: 10 },
  stocktakeButtonActive: { backgroundColor: '#7c3aed', borderColor: '#7c3aed' },
  stocktakeButtonText: { color: '#6d28d9', fontWeight: '800', marginLeft: 7 },
  input: { borderWidth: 1, borderColor: COLORS.inputBorder, backgroundColor: COLORS.inputBg, color: COLORS.text, borderRadius: 12, paddingHorizontal: 13, minHeight: 48, fontSize: 15 },
  helperText: { color: '#7c3aed', fontSize: 12, lineHeight: 18, marginTop: 7 },
  submitButton: { minHeight: 52, backgroundColor: '#ea580c', borderRadius: 13, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', marginTop: 18 },
  submitButtonText: { color: '#fff', fontWeight: '800', fontSize: 15, marginLeft: 7 },
  disabledButton: { opacity: 0.55 },
  myRequests: { marginTop: 28 },
  requestCard: { borderWidth: 1, borderColor: COLORS.border, borderRadius: 14, padding: 14, marginBottom: 11, backgroundColor: COLORS.card },
  requestHeader: { flexDirection: 'row', alignItems: 'flex-start' },
  requestType: { fontSize: 12, fontWeight: '900', textTransform: 'uppercase' },
  requestItem: { color: COLORS.text, fontWeight: '800', fontSize: 15, marginTop: 3 },
  requestAmount: { color: COLORS.text, fontSize: 22, fontWeight: '900', marginTop: 12 },
  requestMeta: { color: COLORS.textMuted, fontSize: 11, marginTop: 5 },
  statusBadge: { borderRadius: 20, paddingHorizontal: 9, paddingVertical: 5 },
  statusBadgeText: { fontWeight: '800', fontSize: 10 },
  reviewRow: { flexDirection: 'row', gap: 10, marginTop: 14 },
  reviewButton: { flex: 1, minHeight: 42, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  rejectButton: { backgroundColor: '#ef4444' },
  approveButton: { backgroundColor: '#16a34a' },
  reviewButtonText: { color: '#fff', fontWeight: '800' },
  emptyState: { alignItems: 'center', paddingVertical: 28 },
  emptyTitle: { color: COLORS.text, fontWeight: '800', marginTop: 10, fontSize: 16 },
  emptyText: { color: COLORS.textMuted, textAlign: 'center', marginTop: 5, lineHeight: 20 },
  addButton: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#1565c0', borderRadius: 20, paddingHorizontal: 12, paddingVertical: 7, marginBottom: 14 },
  addButtonText: { color: '#fff', fontWeight: '800', fontSize: 12, marginLeft: 3 },
  catalogRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 13, borderBottomWidth: 1, borderBottomColor: COLORS.border },
  catalogName: { color: COLORS.text, fontWeight: '800' },
  catalogMeta: { color: COLORS.textMuted, fontSize: 11, marginTop: 4 },
  catalogStock: { color: '#1565c0', fontWeight: '900' },
  historyCount: { color: COLORS.textMuted, fontSize: 12, marginTop: -8, marginBottom: 12 },
  filterScroller: { marginTop: 8, marginBottom: 8 },
  filterChip: { backgroundColor: COLORS.inputBg, borderWidth: 1, borderColor: COLORS.border, borderRadius: 999, paddingHorizontal: 13, paddingVertical: 9, marginRight: 8 },
  filterChipActive: { backgroundColor: '#1565c0', borderColor: '#1565c0' },
  filterChipText: { color: COLORS.textMuted, fontWeight: '800', fontSize: 12 },
  filterChipTextActive: { color: '#fff' },
  logCard: { borderWidth: 1, borderColor: COLORS.border, backgroundColor: COLORS.inputBg, borderRadius: 15, padding: 13, marginTop: 10 },
  logCardHeader: { flexDirection: 'row', alignItems: 'flex-start' },
  logIcon: { width: 42, height: 42, borderRadius: 13, alignItems: 'center', justifyContent: 'center', marginRight: 11 },
  logTitle: { color: COLORS.text, fontWeight: '900', fontSize: 16 },
  logMeta: { color: COLORS.textMuted, fontSize: 12, marginTop: 4, lineHeight: 17 },
  logAmount: { fontWeight: '900', fontSize: 16, marginLeft: 8, textAlign: 'right', maxWidth: 115 },
  logDetailBox: { backgroundColor: COLORS.card, borderRadius: 12, borderWidth: 1, borderColor: COLORS.border, padding: 10, marginTop: 12 },
  logDetailText: { color: COLORS.textMuted, fontSize: 13, lineHeight: 20 },
  logDetailStrong: { color: COLORS.text, fontWeight: '900' },
  logNote: { color: COLORS.text, fontSize: 13, lineHeight: 20, marginTop: 4, fontStyle: 'italic' },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(15,23,42,0.55)', justifyContent: 'center', padding: 20 },
  modalContent: { backgroundColor: COLORS.card, borderRadius: 18, padding: 20, borderWidth: 1, borderColor: COLORS.border },
  modalHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  modalTitle: { color: COLORS.text, fontSize: 21, fontWeight: '900' },
  modalStore: { color: COLORS.textMuted, marginTop: 3, marginBottom: 8 },
  modalFieldRow: { flexDirection: 'row', gap: 10 },
  modalField: { flex: 1 },
});
