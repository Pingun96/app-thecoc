import React, { useContext, useMemo, useState } from 'react';
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
  approveInventoryRequest,
  createInventoryItem,
  createInventoryLog,
  createInventoryRequest,
  updateInventoryRequestStatus,
} from '../services/inventoryService';
import {
  normalizeInventoryItem,
  normalizeInventoryLog,
  normalizeInventoryRequest,
} from '../services/dataMappers';
import { getLocalDateKey } from '../utils/dateTime';
import { sendPushNotification, getManagersPushTokens } from '../services/NotificationService';

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
  if (status === 'PENDING_MANAGER') return { label: 'Chờ quản lý', color: '#b45309', bg: '#fef3c7' };
  if (status === 'PENDING_OWNER') return { label: 'Chờ chủ cửa hàng', color: '#1d4ed8', bg: '#dbeafe' };
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
    setInventoryLogs,
    inventoryRequests,
    setInventoryRequests,
    selectedStoreId,
    storeList,
    refreshData,
  } = useContext(AppContext);

  const isOwner = currentUser?.role === 'OWNER';
  const isManager = currentUser?.role === 'MANAGER';
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

  const [activeTab, setActiveTab] = useState(isStaff ? 'ACTION' : 'OVERVIEW');
  const [selectedItemId, setSelectedItemId] = useState('');
  const [actionType, setActionType] = useState('EXPORT');
  const [amount, setAmount] = useState('');
  const [searchText, setSearchText] = useState('');
  const [busyKey, setBusyKey] = useState('');
  const [showCreateModal, setShowCreateModal] = useState(false);
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
  const pendingRequests = inventoryRequests.filter((request) => {
    if (storeIdToView !== 'ALL' && request.store_id !== storeIdToView) return false;
    if (isManager) return request.status === 'PENDING_MANAGER';
    return isOwner && ['PENDING_MANAGER', 'PENDING_OWNER'].includes(request.status);
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

  const handleSubmitAction = () => runOperation('submit-action', async () => {
    const numericAmount = Number(String(amount).replace(',', '.'));
    if (!selectedStock) throw new Error('Vui lòng chọn nguyên liệu.');
    if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
      throw new Error('Số lượng phải lớn hơn 0.');
    }
    if (storeIdToView === 'ALL') {
      throw new Error('Vui lòng chọn một chi nhánh cụ thể trước khi thao tác.');
    }

    let finalType = actionType;
    let finalAmount = numericAmount;

    if (actionType === 'STOCKTAKE') {
      const difference = Number((numericAmount - selectedStock.currentStock).toFixed(2));
      if (difference === 0) {
        Alert.alert('Kho đã khớp', 'Số lượng thực tế trùng với số liệu trên hệ thống.');
        return;
      }
      finalType = difference > 0 ? 'ADJUST_UP' : 'ADJUST_DOWN';
      finalAmount = Math.abs(difference);
    }

    const quantityLeaving = finalType === 'EXPORT' || finalType === 'ADJUST_DOWN';
    if (quantityLeaving && finalAmount > selectedStock.currentStock) {
      throw new Error(
        `Không thể xuất ${formatQuantity(finalAmount)} ${selectedStock.unit}. Tồn hiện tại chỉ còn ${formatQuantity(selectedStock.currentStock)} ${selectedStock.unit}.`,
      );
    }

    const date = getLocalDateKey();
    if (isOwner) {
      const log = {
        id: makeId('log'),
        itemid: selectedStock.id,
        type: finalType,
        amount: finalAmount,
        date,
        store_id: selectedStock.store_id,
      };
      await createInventoryLog(log);
      setInventoryLogs((current) => [normalizeInventoryLog(log), ...current]);
      Alert.alert('Đã cập nhật kho', `${ACTIONS[finalType].label}: ${formatQuantity(finalAmount)} ${selectedStock.unit}.`);
    } else {
      const request = {
        id: makeId('req'),
        itemid: selectedStock.id,
        type: finalType,
        amount: finalAmount,
        date,
        store_id: selectedStock.store_id,
        requested_by_name: currentUser?.name || 'Nhân viên',
        status: isManager ? 'PENDING_OWNER' : 'PENDING_MANAGER',
      };
      await createInventoryRequest(request);
      setInventoryRequests((current) => [normalizeInventoryRequest(request), ...current]);

      getManagersPushTokens(selectedStock.store_id).then(tokens => {
        tokens.forEach(token => sendPushNotification(token, 'Phiếu Kho Mới', `${request.requested_by_name} vừa tạo 1 phiếu ${ACTIONS[finalType].label}`));
      });

      Alert.alert('Đã gửi phiếu', 'Yêu cầu đã được lưu và chuyển đến cấp duyệt tiếp theo.');
    }
    setAmount('');
  });

  const handleReview = (request, decision) => runOperation(`review-${request.id}`, async () => {
    if (decision === 'REJECT') {
      await updateInventoryRequestStatus(request.id, request.status, 'REJECTED');
      setInventoryRequests((current) => current.map((item) => (
        item.id === request.id ? { ...item, status: 'REJECTED' } : item
      )));

      const creator = staffList?.find(s => s.name === request.requested_by_name);
      if (creator?.push_token) {
        sendPushNotification(creator.push_token, 'Phiếu Bị Từ Chối', `Phiếu ${ACTIONS[request.type]?.label || request.type} của bạn đã bị từ chối.`);
      }

      Alert.alert('Đã từ chối', 'Phiếu yêu cầu đã được đóng.');
      return;
    }

    if (isManager) {
      if (request.status !== 'PENDING_MANAGER') {
        throw new Error('Phiếu này không còn ở bước duyệt của quản lý.');
      }
      await updateInventoryRequestStatus(request.id, 'PENDING_MANAGER', 'PENDING_OWNER');
      setInventoryRequests((current) => current.map((item) => (
        item.id === request.id ? { ...item, status: 'PENDING_OWNER' } : item
      )));

      const creator = staffList?.find(s => s.name === request.requested_by_name);
      if (creator?.push_token) {
        sendPushNotification(creator.push_token, 'Đang Xử Lý Phiếu', `Phiếu ${ACTIONS[request.type]?.label || request.type} đã qua bước quản lý, chờ duyệt cuối.`);
      }

      Alert.alert('Đã duyệt bước 1', 'Phiếu đang chờ chủ cửa hàng phê duyệt cuối.');
      return;
    }

    const currentStock = stockByItemId[request.itemId]?.currentStock || 0;
    if (
      (request.type === 'EXPORT' || request.type === 'ADJUST_DOWN')
      && Number(request.amount) > currentStock
    ) {
      throw new Error(`Tồn kho hiện tại chỉ còn ${formatQuantity(currentStock)}. Không thể duyệt phiếu này.`);
    }

    const result = await approveInventoryRequest(request);
    setInventoryRequests((current) => current.map((item) => (
      item.id === request.id ? { ...item, status: 'APPROVED' } : item
    )));
    if (result.log) {
      setInventoryLogs((current) => [normalizeInventoryLog(result.log), ...current]);
    } else {
      await refreshData?.();
    }

    const creator = staffList?.find(s => s.name === request.requested_by_name);
    if (creator?.push_token) {
      sendPushNotification(creator.push_token, 'Phiếu Đã Duyệt ✅', `Phiếu ${ACTIONS[request.type]?.label || request.type} của bạn đã được duyệt thành công!`);
    }

    Alert.alert('Đã duyệt phiếu', 'Giao dịch đã được ghi vào sổ kho.');
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

  const renderStatusBadge = (status) => {
    const config = getRequestStatus(status);
    return (
      <View style={[styles.statusBadge, { backgroundColor: config.bg }]}>
        <Text style={[styles.statusBadgeText, { color: config.color }]}>{config.label}</Text>
      </View>
    );
  };

  const renderRequestCard = (request, reviewable = false) => {
    const item = itemById[request.itemId];
    const action = ACTIONS[request.type] || ACTIONS.IMPORT;
    const isBusy = busyKey === `review-${request.id}`;
    return (
      <View key={request.id} style={styles.requestCard}>
        <View style={styles.requestHeader}>
          <View style={{ flex: 1 }}>
            <Text style={[styles.requestType, { color: action.color }]}>{action.label}</Text>
            <Text style={styles.requestItem}>{item?.name || 'Nguyên liệu đã xóa'}</Text>
          </View>
          {renderStatusBadge(request.status)}
        </View>
        <Text style={styles.requestAmount}>
          {formatQuantity(request.amount)} {item?.unit || ''}
        </Text>
        <Text style={styles.requestMeta}>
          {request.requested_by_name || 'Không rõ người tạo'} • {formatTimestamp(request.date)}
        </Text>
        {reviewable && (
          <View style={styles.reviewRow}>
            <TouchableOpacity
              style={[styles.reviewButton, styles.rejectButton]}
              onPress={() => handleReview(request, 'REJECT')}
              disabled={isBusy}
            >
              <Text style={styles.reviewButtonText}>Từ chối</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.reviewButton, styles.approveButton]}
              onPress={() => handleReview(request, 'APPROVE')}
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
    ? [{ key: 'ACTION', label: 'Thao tác' }]
    : [
        { key: 'OVERVIEW', label: 'Tổng quan' },
        { key: 'ACTION', label: 'Thao tác' },
        { key: 'APPROVALS', label: `Duyệt${pendingRequests.length ? ` (${pendingRequests.length})` : ''}` },
        { key: 'LOGS', label: 'Sổ kho' },
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
              <Text style={styles.sectionTitle}>Tạo giao dịch kho</Text>
              <Text style={styles.fieldLabel}>Nguyên liệu</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.itemScroller}>
                {myItems.map((item) => (
                  <TouchableOpacity
                    key={item.id}
                    style={[styles.itemChip, effectiveSelectedItemId === item.id && styles.itemChipActive]}
                    onPress={() => setSelectedItemId(item.id)}
                  >
                    <Text style={[styles.itemChipText, effectiveSelectedItemId === item.id && styles.itemChipTextActive]}>
                      {item.name}
                    </Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>

              {selectedStock ? (
                <View style={styles.currentStockBox}>
                  <Text style={styles.currentStockLabel}>Tồn khả dụng</Text>
                  <Text style={styles.currentStockValue}>
                    {formatQuantity(selectedStock.currentStock)} {selectedStock.unit}
                  </Text>
                </View>
              ) : (
                <Text style={styles.emptyText}>Kho này chưa có nguyên liệu.</Text>
              )}

              <Text style={styles.fieldLabel}>Loại thao tác</Text>
              <View style={styles.actionGrid}>
                {['EXPORT', 'IMPORT'].map((type) => (
                  <TouchableOpacity
                    key={type}
                    style={[
                      styles.actionButton,
                      actionType === type && { backgroundColor: ACTIONS[type].color, borderColor: ACTIONS[type].color },
                    ]}
                    onPress={() => setActionType(type)}
                  >
                    <Ionicons
                      name={type === 'IMPORT' ? 'download-outline' : 'arrow-up-outline'}
                      size={19}
                      color={actionType === type ? '#fff' : '#475569'}
                    />
                    <Text style={[styles.actionButtonText, actionType === type && { color: '#fff' }]}>
                      {ACTIONS[type].label}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>

              {!isStaff && (
                <TouchableOpacity
                  style={[
                    styles.stocktakeButton,
                    actionType === 'STOCKTAKE' && styles.stocktakeButtonActive,
                  ]}
                  onPress={() => setActionType('STOCKTAKE')}
                >
                  <Ionicons
                    name="calculator-outline"
                    size={19}
                    color={actionType === 'STOCKTAKE' ? '#fff' : '#6d28d9'}
                  />
                  <Text style={[
                    styles.stocktakeButtonText,
                    actionType === 'STOCKTAKE' && { color: '#fff' },
                  ]}>
                    Kiểm kê số lượng thực tế
                  </Text>
                </TouchableOpacity>
              )}

              <Text style={styles.fieldLabel}>
                {actionType === 'STOCKTAKE'
                  ? `Số lượng đếm thực tế${selectedStock?.unit ? ` (${selectedStock.unit})` : ''}`
                  : `Số lượng${selectedStock?.unit ? ` (${selectedStock.unit})` : ''}`}
              </Text>
              <TextInput
                style={styles.input}
                keyboardType="decimal-pad"
                placeholder={actionType === 'STOCKTAKE' ? 'Nhập số đếm thực tế' : 'Ví dụ: 5'}
                placeholderTextColor="#94a3b8"
                value={amount}
                onChangeText={setAmount}
              />
              {actionType === 'STOCKTAKE' && selectedStock && (
                <Text style={styles.helperText}>
                  Hệ thống sẽ tự tính chênh lệch so với {formatQuantity(selectedStock.currentStock)} {selectedStock.unit}.
                </Text>
              )}

              <TouchableOpacity
                style={[styles.submitButton, (!selectedStock || busyKey) && styles.disabledButton]}
                onPress={handleSubmitAction}
                disabled={!selectedStock || Boolean(busyKey)}
              >
                {busyKey === 'submit-action'
                  ? <ActivityIndicator color="#fff" />
                  : (
                    <>
                      <Ionicons name="checkmark-circle-outline" size={21} color="#fff" />
                      <Text style={styles.submitButtonText}>
                        {isOwner ? 'Xác nhận & cập nhật kho' : 'Gửi phiếu yêu cầu'}
                      </Text>
                    </>
                  )}
              </TouchableOpacity>

              {isStaff && (
                <View style={styles.myRequests}>
                  <Text style={styles.sectionTitle}>Phiếu gần đây của tôi</Text>
                  {inventoryRequests
                    .filter((request) => request.requested_by_name === currentUser?.name)
                    .slice(0, 10)
                    .map((request) => renderRequestCard(request))}
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

          {activeTab === 'LOGS' && !isStaff && (
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
                      <Text style={styles.catalogStock}>
                        {formatQuantity(stockByItemId[item.id]?.currentStock)} {item.unit}
                      </Text>
                    </View>
                  ))}
              </View>

              <View style={styles.section}>
                <Text style={styles.sectionTitle}>Lịch sử giao dịch</Text>
                {inventoryLogs
                  .filter((log) => storeIdToView === 'ALL' || log.store_id === storeIdToView)
                  .sort((a, b) => String(b.date).localeCompare(String(a.date)))
                  .map((log) => {
                    const item = itemById[log.itemId];
                    const action = ACTIONS[log.type] || ACTIONS.IMPORT;
                    return (
                      <View key={log.id} style={styles.logRow}>
                        <View style={[styles.logIcon, { backgroundColor: `${action.color}18` }]}>
                          <Ionicons
                            name={action.sign === '+' ? 'add' : 'remove'}
                            size={20}
                            color={action.color}
                          />
                        </View>
                        <View style={{ flex: 1 }}>
                          <Text style={styles.logTitle}>{action.label} • {item?.name || 'Không rõ'}</Text>
                          <Text style={styles.logMeta}>{formatTimestamp(log.date)}</Text>
                        </View>
                        <Text style={[styles.logAmount, { color: action.color }]}>
                          {action.sign}{formatQuantity(log.amount)} {item?.unit || ''}
                        </Text>
                      </View>
                    );
                  })}
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

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f4f7fb' },
  headerRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingTop: 10, paddingBottom: 14 },
  backBtn: { padding: 8, marginRight: 8, marginLeft: -8 },
  header: { fontSize: 25, fontWeight: '800', color: '#172033' },
  headerCaption: { color: '#64748b', marginTop: 2 },
  refreshButton: { padding: 10, backgroundColor: '#e8f1ff', borderRadius: 12 },
  tabContainer: { flexDirection: 'row', marginHorizontal: 20, backgroundColor: '#e2e8f0', borderRadius: 12, padding: 4 },
  tabButton: { flex: 1, minHeight: 40, alignItems: 'center', justifyContent: 'center', borderRadius: 9, paddingHorizontal: 3 },
  tabButtonActive: { backgroundColor: '#fff', shadowColor: '#0f172a', shadowOpacity: 0.08, shadowRadius: 5, elevation: 2 },
  tabText: { color: '#64748b', fontWeight: '700', fontSize: 12 },
  tabTextActive: { color: '#1565c0' },
  scrollContent: { padding: 20, paddingBottom: 50 },
  summaryRow: { flexDirection: 'row', gap: 10, marginBottom: 16 },
  summaryCard: { flex: 1, backgroundColor: '#fff', borderRadius: 14, padding: 14, borderWidth: 1, borderColor: '#edf1f5' },
  summaryWarning: { backgroundColor: '#fff7ed', borderColor: '#fed7aa' },
  summaryValue: { color: '#172033', fontSize: 24, fontWeight: '900' },
  summaryLabel: { color: '#64748b', fontSize: 11, marginTop: 4 },
  section: { backgroundColor: '#fff', borderRadius: 18, padding: 18, marginBottom: 16, shadowColor: '#0f172a', shadowOpacity: 0.06, shadowRadius: 10, elevation: 2 },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  sectionTitle: { color: '#172033', fontSize: 18, fontWeight: '800', marginBottom: 14 },
  searchBox: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#f8fafc', borderWidth: 1, borderColor: '#e2e8f0', borderRadius: 12, paddingHorizontal: 12, marginBottom: 10 },
  searchInput: { flex: 1, minHeight: 44, paddingLeft: 8, color: '#172033' },
  stockRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 13, borderBottomWidth: 1, borderBottomColor: '#edf1f5' },
  stockIcon: { width: 38, height: 38, borderRadius: 12, backgroundColor: '#dcfce7', alignItems: 'center', justifyContent: 'center', marginRight: 11 },
  stockIconLow: { backgroundColor: '#fee2e2' },
  stockName: { color: '#172033', fontWeight: '800', fontSize: 14 },
  stockSafe: { color: '#64748b', fontSize: 11, marginTop: 3 },
  stockValue: { color: '#15803d', fontWeight: '900', fontSize: 18 },
  stockUnit: { color: '#64748b', fontSize: 11 },
  fieldLabel: { color: '#475569', fontWeight: '800', fontSize: 13, marginTop: 10, marginBottom: 8 },
  itemScroller: { marginBottom: 5 },
  itemChip: { backgroundColor: '#f1f5f9', borderRadius: 20, paddingHorizontal: 14, paddingVertical: 9, marginRight: 8, borderWidth: 1, borderColor: '#e2e8f0' },
  itemChipActive: { backgroundColor: '#1565c0', borderColor: '#1565c0' },
  itemChipText: { color: '#475569', fontWeight: '700', fontSize: 12 },
  itemChipTextActive: { color: '#fff' },
  currentStockBox: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: '#eff6ff', borderRadius: 12, padding: 13, marginTop: 12 },
  currentStockLabel: { color: '#475569', fontWeight: '600' },
  currentStockValue: { color: '#1d4ed8', fontWeight: '900', fontSize: 17 },
  actionGrid: { flexDirection: 'row', gap: 10 },
  actionButton: { flex: 1, minHeight: 48, borderWidth: 1, borderColor: '#cbd5e1', borderRadius: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'center' },
  actionButtonText: { color: '#475569', fontWeight: '800', marginLeft: 6 },
  stocktakeButton: { minHeight: 48, borderWidth: 1, borderColor: '#c4b5fd', backgroundColor: '#f5f3ff', borderRadius: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', marginTop: 10 },
  stocktakeButtonActive: { backgroundColor: '#7c3aed', borderColor: '#7c3aed' },
  stocktakeButtonText: { color: '#6d28d9', fontWeight: '800', marginLeft: 7 },
  input: { borderWidth: 1, borderColor: '#cbd5e1', backgroundColor: '#f8fafc', color: '#172033', borderRadius: 12, paddingHorizontal: 13, minHeight: 48, fontSize: 15 },
  helperText: { color: '#7c3aed', fontSize: 12, lineHeight: 18, marginTop: 7 },
  submitButton: { minHeight: 52, backgroundColor: '#ea580c', borderRadius: 13, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', marginTop: 18 },
  submitButtonText: { color: '#fff', fontWeight: '800', fontSize: 15, marginLeft: 7 },
  disabledButton: { opacity: 0.55 },
  myRequests: { marginTop: 28 },
  requestCard: { borderWidth: 1, borderColor: '#e2e8f0', borderRadius: 14, padding: 14, marginBottom: 11, backgroundColor: '#fff' },
  requestHeader: { flexDirection: 'row', alignItems: 'flex-start' },
  requestType: { fontSize: 12, fontWeight: '900', textTransform: 'uppercase' },
  requestItem: { color: '#172033', fontWeight: '800', fontSize: 15, marginTop: 3 },
  requestAmount: { color: '#172033', fontSize: 22, fontWeight: '900', marginTop: 12 },
  requestMeta: { color: '#64748b', fontSize: 11, marginTop: 5 },
  statusBadge: { borderRadius: 20, paddingHorizontal: 9, paddingVertical: 5 },
  statusBadgeText: { fontWeight: '800', fontSize: 10 },
  reviewRow: { flexDirection: 'row', gap: 10, marginTop: 14 },
  reviewButton: { flex: 1, minHeight: 42, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  rejectButton: { backgroundColor: '#ef4444' },
  approveButton: { backgroundColor: '#16a34a' },
  reviewButtonText: { color: '#fff', fontWeight: '800' },
  emptyState: { alignItems: 'center', paddingVertical: 28 },
  emptyTitle: { color: '#334155', fontWeight: '800', marginTop: 10, fontSize: 16 },
  emptyText: { color: '#64748b', textAlign: 'center', marginTop: 5, lineHeight: 20 },
  addButton: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#1565c0', borderRadius: 20, paddingHorizontal: 12, paddingVertical: 7, marginBottom: 14 },
  addButtonText: { color: '#fff', fontWeight: '800', fontSize: 12, marginLeft: 3 },
  catalogRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 13, borderBottomWidth: 1, borderBottomColor: '#edf1f5' },
  catalogName: { color: '#172033', fontWeight: '800' },
  catalogMeta: { color: '#64748b', fontSize: 11, marginTop: 4 },
  catalogStock: { color: '#1565c0', fontWeight: '900' },
  logRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#edf1f5' },
  logIcon: { width: 36, height: 36, borderRadius: 11, alignItems: 'center', justifyContent: 'center', marginRight: 10 },
  logTitle: { color: '#172033', fontWeight: '700', fontSize: 13 },
  logMeta: { color: '#64748b', fontSize: 11, marginTop: 3 },
  logAmount: { fontWeight: '900', fontSize: 14 },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(15,23,42,0.55)', justifyContent: 'center', padding: 20 },
  modalContent: { backgroundColor: '#fff', borderRadius: 18, padding: 20 },
  modalHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  modalTitle: { color: '#172033', fontSize: 21, fontWeight: '900' },
  modalStore: { color: '#64748b', marginTop: 3, marginBottom: 8 },
  modalFieldRow: { flexDirection: 'row', gap: 10 },
  modalField: { flex: 1 },
});
