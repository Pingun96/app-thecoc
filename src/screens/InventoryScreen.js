import React, { useCallback, useContext, useMemo, useState } from 'react';
import {
  ActivityIndicator,
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
import { Alert } from '../utils/alert';
import { Ionicons } from '@expo/vector-icons';
import { AppContext } from '../context/AppContext';
import AsyncStorage from '@react-native-async-storage/async-storage';
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
import {
  buildInventoryStockRows,
  getBusinessStores,
  getCentralWarehouseStore,
  getStoreName,
  isCentralWarehouseStore,
} from '../utils/warehouse';

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

const getShiftTime = (shift) => {
  const rawValue = shift?.closed_at || shift?.updated_at || shift?.opened_at || shift?.created_at || '';
  const nativeDate = new Date(rawValue);
  if (!Number.isNaN(nativeDate.getTime())) return nativeDate.getTime();

  const match = String(rawValue).match(/(\d{1,2})\/(\d{1,2})\/(\d{4})(?:.*?(\d{1,2}):(\d{2}))?/);
  if (!match) return 0;
  const [, day, month, year, hour = '0', minute = '0'] = match;
  return new Date(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute)).getTime();
};

const getShiftInventoryItemId = (item) => item?.item_id ?? item?.itemId ?? item?.itemid ?? item?.id;

const getMonthKey = (date = new Date()) => {
  const parsed = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(parsed.getTime())) return getMonthKey(new Date());
  return `${parsed.getFullYear()}-${String(parsed.getMonth() + 1).padStart(2, '0')}`;
};

const addMonthsToKey = (monthKey, delta) => {
  const [year, month] = String(monthKey || getMonthKey()).split('-').map(Number);
  const date = new Date(year || new Date().getFullYear(), (month || 1) - 1 + delta, 1);
  return getMonthKey(date);
};

const getMonthLabel = (monthKey) => {
  const [year, month] = String(monthKey || getMonthKey()).split('-').map(Number);
  return new Date(year || new Date().getFullYear(), (month || 1) - 1, 1).toLocaleDateString('vi-VN', {
    month: 'long',
    year: 'numeric',
  });
};

const getMonthRange = (monthKey) => {
  const [year, month] = String(monthKey || getMonthKey()).split('-').map(Number);
  const start = new Date(year || new Date().getFullYear(), (month || 1) - 1, 1, 0, 0, 0, 0);
  const end = new Date(start.getFullYear(), start.getMonth() + 1, 1, 0, 0, 0, 0);
  return { start, end };
};

const getLogDate = (log) => {
  const rawValue = log?.created_at || log?.date || log?.updated_at || '';
  const parsed = new Date(rawValue);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const isLogInMonth = (log, monthKey) => {
  const parsed = getLogDate(log);
  if (!parsed) return false;
  const { start, end } = getMonthRange(monthKey);
  return parsed >= start && parsed < end;
};

const getSignedInventoryAmount = (log) => {
  const amount = Number(log?.amount || 0);
  if (log?.type === 'IMPORT' || log?.type === 'ADJUST_UP') return amount;
  if (log?.type === 'EXPORT' || log?.type === 'ADJUST_DOWN') return -amount;
  return 0;
};

const formatPercent = (value) => {
  if (!Number.isFinite(value)) return '--';
  return `${value > 0 ? '+' : ''}${value.toLocaleString('vi-VN', { maximumFractionDigits: 1 })}%`;
};

const makeId = (prefix) => `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

const getRequestStatus = (status, ticket = {}) => {
  const isWarehouseTransfer = ticket.type === 'TRANSFER' && ticket.source_is_warehouse;
  if (status === 'PENDING_SOURCE') {
    return {
      label: isWarehouseTransfer ? 'Chờ kho tổng xác nhận' : 'Chờ nơi xuất duyệt',
      color: '#b45309',
      bg: '#fef3c7',
    };
  }
  if (status === 'PENDING_DEST') {
    return {
      label: isWarehouseTransfer ? 'Đang giao về cửa hàng' : 'Chờ nơi nhận duyệt',
      color: '#1d4ed8',
      bg: '#dbeafe',
    };
  }
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
    shifts,
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
  const businessStores = useMemo(() => getBusinessStores(storeList), [storeList]);
  const centralWarehouse = useMemo(() => getCentralWarehouseStore(storeList), [storeList]);
  const centralWarehouseId = centralWarehouse?.id;

  let storeIdToView = currentUser?.store_id;
  if (isOwner || viewableStores.includes(selectedStoreId)) storeIdToView = selectedStoreId;
  if (isOwner && selectedStoreId === 'ALL') storeIdToView = 'ALL';

  const storeName = storeIdToView === 'ALL'
    ? 'Tất cả chi nhánh'
    : getStoreName(businessStores, storeIdToView);

  const myItems = useMemo(
    () => inventoryItems.filter(
      (item) => (storeIdToView === 'ALL' || item.store_id === storeIdToView)
        && String(item.store_id) !== String(centralWarehouseId || ''),
    ),
    [inventoryItems, storeIdToView, centralWarehouseId],
  );

  const warehouseItems = useMemo(
    () => inventoryItems.filter((item) => (
      centralWarehouseId && String(item.store_id) === String(centralWarehouseId)
    )),
    [inventoryItems, centralWarehouseId],
  );

  const stockData = useMemo(() => buildInventoryStockRows(myItems, inventoryLogs), [inventoryLogs, myItems]);
  const warehouseStockData = useMemo(() => buildInventoryStockRows(warehouseItems, inventoryLogs), [inventoryLogs, warehouseItems]);

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
  const [varianceFilter, setVarianceFilter] = useState('ALL');
  const [usageMonth, setUsageMonth] = useState(getMonthKey());
  const [usageFilter, setUsageFilter] = useState('ALL');
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

  const [activeTab, setActiveTab] = useState('KHO');
  const [actionType, setActionType] = useState('EXPORT');
  const [cartItems, setCartItems] = useState([]);
  const [amount, setAmount] = useState('');
  const [selectedItemId, setSelectedItemId] = useState('');
  const [searchText, setSearchText] = useState('');
  const [offlineTickets, setOfflineTickets] = useState([]);
  const [showActionModal, setShowActionModal] = useState(false);

  React.useEffect(() => {
    const loadOffline = async () => {
      try {
        const stored = await AsyncStorage.getItem('@offline_inventory_tickets');
        if (stored) setOfflineTickets(JSON.parse(stored));
      } catch(e) {}
    };
    loadOffline();
  }, []);

  const syncOfflineTickets = async () => {
    if (offlineTickets.length === 0) return;
    let successCount = 0;
    try {
      setBusyKey('sync-offline');
      for (const ticket of offlineTickets) {
        await createInventoryTicket(ticket);
        if (isOwner && ticket.type !== 'TRANSFER') {
          await approveInventoryTicket(ticket, currentUser.id, ticket.source_store_id || ticket.destination_store_id);
        }
        successCount++;
      }
      setOfflineTickets([]);
      await AsyncStorage.removeItem('@offline_inventory_tickets');
      await refreshData?.();
      Alert.alert('Đồng bộ thành công', `Đã tải lên ${successCount} phiếu kiểm kho ngoại tuyến.`);
    } catch (err) {
      const remaining = offlineTickets.slice(successCount);
      setOfflineTickets(remaining);
      await AsyncStorage.setItem('@offline_inventory_tickets', JSON.stringify(remaining));
      Alert.alert('Đồng bộ gián đoạn', 'Một số phiếu chưa thể gửi do lỗi mạng. Vui lòng thử lại sau.');
    } finally {
      setBusyKey('');
    }
  };
  const [busyKey, setBusyKey] = useState('');
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [isItemDropdownOpen, setIsItemDropdownOpen] = useState(false);
  const [newItemName, setNewItemName] = useState('');
  const [newItemUnit, setNewItemUnit] = useState('kg');
  const [newItemSafeLevel, setNewItemSafeLevel] = useState('5');

  const actionStockData = actionType === 'TRANSFER' ? warehouseStockData : stockData;
  const actionStockByItemId = useMemo(
    () => Object.fromEntries(actionStockData.map((item) => [item.id, item])),
    [actionStockData],
  );
  const effectiveSelectedItemId = actionStockData.some((item) => item.id === selectedItemId)
    ? selectedItemId
    : actionStockData[0]?.id || '';
  const filteredStock = stockData.filter((item) => (
    item.name.toLowerCase().includes(searchText.trim().toLowerCase())
  ));
  const lowStockCount = stockData.filter((item) => item.isLowStock).length;
  const selectedStock = actionStockByItemId[effectiveSelectedItemId];
  const warehouseStockByName = useMemo(() => (
    Object.fromEntries(warehouseStockData.map((item) => [String(item.name || '').trim().toLowerCase(), item]))
  ), [warehouseStockData]);
  const suggestedImportRows = useMemo(() => stockData
    .map((item) => {
      const targetStock = Number(item.safeLevel || 0);
      const suggestedAmount = Number(Math.max(targetStock - Number(item.currentStock || 0), 0).toFixed(2));
      const warehouseItem = warehouseStockByName[String(item.name || '').trim().toLowerCase()];
      return { ...item, suggestedAmount, warehouseItem };
    })
    .filter((item) => item.suggestedAmount > 0 && item.warehouseItem)
    .sort((a, b) => b.suggestedAmount - a.suggestedAmount),
  [stockData, warehouseStockByName]);
  const inventoryComparisonRows = useMemo(() => {
    const scopedShifts = (shifts || [])
      .filter((shift) => storeIdToView === 'ALL' || String(shift.store_id) === String(storeIdToView))
      .filter((shift) => Array.isArray(shift.inventory_check) && shift.inventory_check.length > 0)
      .sort((a, b) => getShiftTime(b) - getShiftTime(a));

    return stockData.map((item) => {
      const latestShift = scopedShifts.find((shift) => (
        (shift.inventory_check || []).some((check) => String(getShiftInventoryItemId(check)) === String(item.id))
      ));
      const latestCheck = latestShift?.inventory_check?.find(
        (check) => String(getShiftInventoryItemId(check)) === String(item.id),
      );
      const expectedStock = Number(latestCheck?.start ?? 0);
      const countedStock = Number(latestCheck?.end ?? 0);
      const hasCheck = Boolean(latestCheck);
      const variance = hasCheck ? Number((countedStock - expectedStock).toFixed(2)) : 0;
      const absVariance = Math.abs(variance);
      const severity = !hasCheck || absVariance < 0.005
        ? 'OK'
        : variance < 0
          ? 'SHORT'
          : 'SURPLUS';
      const shiftTime = getShiftTime(latestShift);

      return {
        ...item,
        hasCheck,
        expectedStock,
        countedStock,
        variance,
        absVariance,
        severity,
        shiftTime,
        shiftLabel: latestShift?.closed_at || latestShift?.opened_at || '',
        reporterName: latestShift?.closed_by_name || latestShift?.opened_by_name || 'Không rõ',
        shiftStatus: latestShift?.status || '',
      };
    }).sort((a, b) => {
      if (b.absVariance !== a.absVariance) return b.absVariance - a.absVariance;
      return (b.shiftTime || 0) - (a.shiftTime || 0);
    });
  }, [shifts, stockData, storeIdToView]);

  const filteredComparisonRows = useMemo(() => inventoryComparisonRows.filter((row) => {
    if (varianceFilter === 'DIFF') return row.hasCheck && row.absVariance >= 0.005;
    if (varianceFilter === 'SHORT') return row.severity === 'SHORT';
    if (varianceFilter === 'SURPLUS') return row.severity === 'SURPLUS';
    return true;
  }), [inventoryComparisonRows, varianceFilter]);

  const comparisonSummary = useMemo(() => {
    const checkedRows = inventoryComparisonRows.filter((row) => row.hasCheck);
    const diffRows = checkedRows.filter((row) => row.absVariance >= 0.005);
    return {
      checked: checkedRows.length,
      diff: diffRows.length,
      shortage: diffRows.filter((row) => row.severity === 'SHORT').length,
      surplus: diffRows.filter((row) => row.severity === 'SURPLUS').length,
      totalAbs: diffRows.reduce((sum, row) => sum + row.absVariance, 0),
    };
  }, [inventoryComparisonRows]);

  const monthlyUsageRows = useMemo(() => {
    const previousMonth = addMonthsToKey(usageMonth, -1);
    const monthRange = getMonthRange(usageMonth);

    return stockData.map((item) => {
      const itemLogs = inventoryLogs.filter(
        (log) => String(log.itemId ?? log.itemid ?? log.item_id) === String(item.id)
          && String(log.store_id) === String(item.store_id),
      );
      const openingStock = itemLogs
        .filter((log) => {
          const date = getLogDate(log);
          return date && date < monthRange.start;
        })
        .reduce((sum, log) => sum + getSignedInventoryAmount(log), 0);
      const monthLogs = itemLogs.filter((log) => isLogInMonth(log, usageMonth));
      const previousLogs = itemLogs.filter((log) => isLogInMonth(log, previousMonth));
      const imported = monthLogs
        .filter((log) => log.type === 'IMPORT')
        .reduce((sum, log) => sum + Number(log.amount || 0), 0);
      const adjustedUp = monthLogs
        .filter((log) => log.type === 'ADJUST_UP')
        .reduce((sum, log) => sum + Number(log.amount || 0), 0);
      const exported = monthLogs
        .filter((log) => log.type === 'EXPORT')
        .reduce((sum, log) => sum + Number(log.amount || 0), 0);
      const shrinkage = monthLogs
        .filter((log) => log.type === 'ADJUST_DOWN')
        .reduce((sum, log) => sum + Number(log.amount || 0), 0);
      const used = exported + shrinkage;
      const previousUsed = previousLogs
        .filter((log) => log.type === 'EXPORT' || log.type === 'ADJUST_DOWN')
        .reduce((sum, log) => sum + Number(log.amount || 0), 0);
      const delta = used - previousUsed;
      const deltaPercent = previousUsed > 0 ? (delta / previousUsed) * 100 : (used > 0 ? 100 : 0);
      const expectedEndStock = openingStock + imported + adjustedUp - used;

      const monthShifts = (shifts || [])
        .filter((shift) => String(shift.store_id) === String(item.store_id))
        .filter((shift) => {
          const time = getShiftTime(shift);
          return time >= monthRange.start.getTime() && time < monthRange.end.getTime();
        })
        .filter((shift) => Array.isArray(shift.inventory_check));
      const shiftChecks = monthShifts.flatMap((shift) => (
        (shift.inventory_check || [])
          .filter((check) => String(getShiftInventoryItemId(check)) === String(item.id))
          .map((check) => ({ shift, check }))
      )).sort((a, b) => getShiftTime(b.shift) - getShiftTime(a.shift));
      const latestCount = shiftChecks[0]?.check;
      const countVariance = shiftChecks.reduce((sum, row) => (
        sum + (Number(row.check?.end || 0) - Number(row.check?.start || 0))
      ), 0);
      const hasCount = Boolean(latestCount);
      const warningLevel = !hasCount && used > 0
        ? 'NO_COUNT'
        : countVariance < -0.005
          ? 'SHORTAGE'
          : deltaPercent >= 30 && used > 0
            ? 'SPIKE'
            : deltaPercent <= -30 && previousUsed > 0
              ? 'DROP'
              : 'NORMAL';

      return {
        ...item,
        openingStock: Number(openingStock.toFixed(2)),
        imported: Number(imported.toFixed(2)),
        adjustedUp: Number(adjustedUp.toFixed(2)),
        exported: Number(exported.toFixed(2)),
        shrinkage: Number(shrinkage.toFixed(2)),
        used: Number(used.toFixed(2)),
        previousUsed: Number(previousUsed.toFixed(2)),
        delta: Number(delta.toFixed(2)),
        deltaPercent,
        expectedEndStock: Number(expectedEndStock.toFixed(2)),
        countedEndStock: hasCount ? Number(latestCount.end || 0) : null,
        countVariance: Number(countVariance.toFixed(2)),
        hasCount,
        warningLevel,
        latestCountTime: shiftChecks[0]?.shift?.closed_at || shiftChecks[0]?.shift?.opened_at || '',
      };
    }).sort((a, b) => {
      const score = (row) => {
        if (row.warningLevel === 'SHORTAGE') return 4;
        if (row.warningLevel === 'SPIKE') return 3;
        if (row.warningLevel === 'NO_COUNT') return 2;
        if (row.warningLevel === 'DROP') return 1;
        return 0;
      };
      if (score(b) !== score(a)) return score(b) - score(a);
      return b.used - a.used;
    });
  }, [inventoryLogs, shifts, stockData, usageMonth]);

  const filteredMonthlyUsageRows = useMemo(() => monthlyUsageRows.filter((row) => {
    if (usageFilter === 'SPIKE') return row.warningLevel === 'SPIKE';
    if (usageFilter === 'SHORTAGE') return row.warningLevel === 'SHORTAGE';
    if (usageFilter === 'NO_COUNT') return row.warningLevel === 'NO_COUNT';
    if (usageFilter === 'USED') return row.used > 0;
    return true;
  }), [monthlyUsageRows, usageFilter]);

  const usageSummary = useMemo(() => {
    const usedRows = monthlyUsageRows.filter((row) => row.used > 0);
    return {
      totalUsed: usedRows.reduce((sum, row) => sum + row.used, 0),
      usedItems: usedRows.length,
      spikeItems: monthlyUsageRows.filter((row) => row.warningLevel === 'SPIKE').length,
      shortageItems: monthlyUsageRows.filter((row) => row.warningLevel === 'SHORTAGE').length,
      noCountItems: monthlyUsageRows.filter((row) => row.warningLevel === 'NO_COUNT').length,
      totalVariance: monthlyUsageRows.reduce((sum, row) => sum + Math.abs(row.countVariance || 0), 0),
    };
  }, [monthlyUsageRows]);

  const pendingRequests = inventoryTickets.filter((ticket) => {
    if (
      storeIdToView !== 'ALL'
      && String(ticket.source_store_id) !== String(storeIdToView)
      && String(ticket.destination_store_id) !== String(storeIdToView)
    ) return false;
    
    const isSourceManager = String(ticket.source_store_id) === String(currentUser?.store_id);
    const isDestManager = String(ticket.destination_store_id) === String(currentUser?.store_id);

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
    if (actionType === 'TRANSFER' && !centralWarehouseId) {
      return Alert.alert('Chưa có Kho tổng', 'Vui lòng tạo một kho tên "Kho Tổng" hoặc bật is_warehouse cho kho tổng trong dữ liệu.');
    }
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
        currentStock: selectedStock.currentStock,
        source_store_id: actionType === 'TRANSFER' ? centralWarehouseId : undefined,
      }]);
    }
    setAmount('');
  };

  const handleRemoveFromCart = (itemId) => setCartItems(cartItems.filter(i => i.itemId !== itemId));

  const handleCreateSuggestedTransfer = () => {
    if (!centralWarehouseId) {
      Alert.alert('Chưa có Kho tổng', 'Vui lòng tạo một kho tên "Kho Tổng" hoặc bật is_warehouse cho kho tổng trong dữ liệu.');
      return;
    }
    if (storeIdToView === 'ALL') {
      Alert.alert('Chọn chi nhánh', 'Vui lòng chọn một chi nhánh cụ thể trước khi tạo đề xuất nhập.');
      return;
    }
    if (suggestedImportRows.length === 0) {
      Alert.alert('Chưa có gợi ý', 'Các mặt hàng hiện chưa thấp hơn mức tồn an toàn hoặc chưa có mặt hàng trùng tên trong Kho tổng.');
      return;
    }

    const nextCart = suggestedImportRows.map((item) => ({
      itemId: item.warehouseItem.id,
      name: item.warehouseItem.name,
      unit: item.warehouseItem.unit,
      amount: item.suggestedAmount,
      currentStock: item.warehouseItem.currentStock,
      source_store_id: centralWarehouseId,
      suggested_for_store_item_id: item.id,
    }));

    setActionType('TRANSFER');
    setCartItems(nextCart);
    setSelectedItemId(nextCart[0]?.itemId || '');
    setAmount('');
    setShowActionModal(true);
  };

  const openActionModal = () => {
    setCartItems([]);
    setAmount('');
    setSelectedItemId('');
    setIsItemDropdownOpen(false);
    setShowActionModal(true);
  };

  const handleSubmitAction = () => runOperation('submit-action', async () => {
    if (cartItems.length === 0) throw new Error('Giỏ hàng trống. Vui lòng thêm ít nhất 1 mặt hàng.');
    if (storeIdToView === 'ALL') throw new Error('Vui lòng chọn một chi nhánh cụ thể.');
    if (isCentralWarehouseStore({ id: storeIdToView, name: storeName })) throw new Error('Kho tổng dùng màn riêng để duyệt và xuất hàng.');
    if (actionType === 'TRANSFER' && !centralWarehouseId) throw new Error('Chưa tìm thấy Kho tổng trong hệ thống.');

    if (actionType === 'EXPORT' || actionType === 'TRANSFER') {
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
      source_store_id: actionType === 'TRANSFER' ? centralWarehouseId : (actionType === 'EXPORT' ? storeIdToView : null),
      destination_store_id: actionType === 'TRANSFER' || actionType === 'IMPORT' ? storeIdToView : null,
      items: cartItems,
      status: initialStatus,
      requested_by: currentUser?.id,
      requested_by_name: currentUser?.name || 'Nhân viên',
      created_at: new Date().toISOString()
    };

    try {
      await createInventoryTicket(ticket);
      if (isOwner && actionType !== 'TRANSFER') {
         await approveInventoryTicket(ticket, currentUser.id, storeIdToView);
         Alert.alert('Thành công', 'Phiếu đã được tạo và tự động duyệt vì bạn là Chủ Cửa Hàng.');
      } else if (actionType === 'TRANSFER') {
         Alert.alert('Đã gửi đề xuất', 'Đơn đề xuất nhập hàng đã gửi sang Kho tổng để xác nhận xuất.');
      } else {
         Alert.alert('Đã gửi phiếu', 'Yêu cầu đã được gửi đến quản lý để phê duyệt.');
      }
    } catch (e) {
      if (e.message?.toLowerCase().includes('network') || e.message?.toLowerCase().includes('fetch')) {
        const newOffline = [...offlineTickets, ticket];
        setOfflineTickets(newOffline);
        await AsyncStorage.setItem('@offline_inventory_tickets', JSON.stringify(newOffline));
        Alert.alert('Lưu ngoại tuyến', 'Mất kết nối mạng. Phiếu đã được lưu tạm, vui lòng đồng bộ khi có mạng.');
      } else {
        throw e;
      }
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

  const renderStatusBadge = (ticket) => {
    const config = getRequestStatus(ticket.status, ticket);
    return (
      <View style={[styles.statusBadge, { backgroundColor: config.bg }]}>
        <Text style={[styles.statusBadgeText, { color: config.color }]}>{config.label}</Text>
      </View>
    );
  };

  const renderRequestCard = (ticket, reviewable = false) => {
    const sourceIsWarehouse = ticket.type === 'TRANSFER'
      && centralWarehouseId
      && String(ticket.source_store_id) === String(centralWarehouseId);
    const displayTicket = { ...ticket, source_is_warehouse: sourceIsWarehouse };
    let actionLabel = ticket.type;
    let actionColor = '#475569';
    if (ticket.type === 'IMPORT') { actionLabel = 'Nhập kho'; actionColor = '#16a34a'; }
    if (ticket.type === 'EXPORT') { actionLabel = 'Xuất kho'; actionColor = '#dc2626'; }
    if (ticket.type === 'TRANSFER') { actionLabel = sourceIsWarehouse ? 'Đề xuất nhập từ Kho tổng' : 'Chuyển kho'; actionColor = '#7c3aed'; }

    const isBusy = busyKey === `review-${ticket.id}`;
    
    return (
      <View key={ticket.id} style={styles.requestCard}>
        <View style={styles.requestHeader}>
          <View style={{ flex: 1 }}>
            <Text style={[styles.requestType, { color: actionColor }]}>{actionLabel}</Text>
            {ticket.type === 'TRANSFER' && (
              <Text style={{ fontSize: 12, color: '#64748b', marginTop: 2 }}>
                Từ: {getStoreName(storeList, ticket.source_store_id, 'Kho')} ➔ Đến: {getStoreName(storeList, ticket.destination_store_id)}
              </Text>
            )}
          </View>
          {renderStatusBadge(displayTicket)}
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
    ? [{ key: 'KHO', label: '📦 Kho' }, { key: 'DUYET_LS', label: '📋 Lịch sử' }]
    : [
        { key: 'KHO', label: '📦 Kho' },
        { key: 'DUYET_LS', label: `✅ Duyệt${pendingRequests.length ? ` (${pendingRequests.length})` : ''} & LS` },
        { key: 'ITEMS', label: '🗂 Danh mục' },
      ];

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={{ flex: 1 }}
      >
        <View style={styles.stickyTopBar}>
        <View style={styles.headerRow}>
          <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
            <Ionicons name="arrow-back" size={24} color="#1565c0" />
          </TouchableOpacity>
          <View style={{ flex: 1 }}>
            <Text style={styles.header}>Quản lý kho</Text>
            <Text style={styles.headerCaption}>{storeName}</Text>
          </View>
          <View style={styles.headerActions}>
            {!isStaff && (
              <TouchableOpacity onPress={openActionModal} style={styles.createTicketButton}>
                <Ionicons name="add-circle-outline" size={18} color="#fff" />
                <Text style={styles.createTicketText}>Phiếu</Text>
              </TouchableOpacity>
            )}
            {!isStaff && (
              <TouchableOpacity onPress={() => refreshData?.()} style={styles.refreshButton}>
                <Ionicons name="refresh" size={21} color="#1565c0" />
              </TouchableOpacity>
            )}
          </View>
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
        </View>

        <ScrollView
          style={{ flex: 1 }}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={styles.scrollContent}
        >
          {/* ===== TAB KHO: TỒN KHO + THAO TÁC ===== */}
          {activeTab === 'KHO' && (
            <>
              {/* Tóm tắt nhanh */}
              {!isStaff && (
                <View style={styles.summaryRow}>
                  <View style={[styles.summaryCard, lowStockCount > 0 && styles.summaryWarning]}>
                    <Text style={[styles.summaryValue, lowStockCount > 0 && { color: '#b91c1c' }]}>{lowStockCount}</Text>
                    <Text style={styles.summaryLabel}>⚠️ Sắp hết</Text>
                  </View>
                  <View style={styles.summaryCard}>
                    <Text style={styles.summaryValue}>{stockData.length}</Text>
                    <Text style={styles.summaryLabel}>Mặt hàng</Text>
                  </View>
                  <View style={styles.summaryCard}>
                    <Text style={styles.summaryValue}>{pendingRequests.length}</Text>
                    <Text style={styles.summaryLabel}>Chờ duyệt</Text>
                  </View>
                </View>
              )}

              {!isStaff && storeIdToView !== 'ALL' && (
                <View style={[styles.section, styles.suggestionBox]}>
                  <View style={styles.sectionHeader}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.sectionTitle}>Gợi ý nhập từ Kho tổng</Text>
                      <Text style={styles.suggestionHint}>
                        Dựa trên tồn an toàn của cửa hàng và tồn khả dụng tại Kho tổng.
                      </Text>
                    </View>
                    <TouchableOpacity
                      style={[styles.addButton, suggestedImportRows.length === 0 && styles.disabledButton]}
                      onPress={handleCreateSuggestedTransfer}
                      disabled={suggestedImportRows.length === 0}
                    >
                      <Ionicons name="paper-plane-outline" size={16} color="#fff" />
                      <Text style={styles.addButtonText}>Tạo đề xuất</Text>
                    </TouchableOpacity>
                  </View>

                  {!centralWarehouseId ? (
                    <Text style={styles.emptyText}>Chưa cấu hình Kho tổng. Tạo kho tên Kho Tổng hoặc bật is_warehouse trong bảng stores.</Text>
                  ) : suggestedImportRows.length === 0 ? (
                    <Text style={styles.emptyText}>Chưa có mặt hàng nào cần đề xuất nhập.</Text>
                  ) : suggestedImportRows.slice(0, 4).map((item) => (
                    <View key={item.id} style={styles.suggestionRow}>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.stockName}>{item.name}</Text>
                        <Text style={styles.stockSafe}>
                          Cửa hàng còn {formatQuantity(item.currentStock)} / an toàn {formatQuantity(item.safeLevel)} {item.unit}
                        </Text>
                      </View>
                      <Text style={styles.suggestionQty}>+{formatQuantity(item.suggestedAmount)} {item.unit}</Text>
                    </View>
                  ))}
                </View>
              )}

              {/* Tồn kho */}
              {!isStaff && (
                <View style={styles.section}>
                  <Text style={styles.sectionTitle}>Tồn kho</Text>
                  {offlineTickets.length > 0 && (
                    <TouchableOpacity onPress={syncOfflineTickets} style={[styles.addButton, { marginBottom: 12, backgroundColor: '#ea580c' }]}>
                      <Ionicons name="cloud-upload-outline" size={18} color="#fff" />
                      <Text style={styles.addButtonText}>Đồng bộ {offlineTickets.length} phiếu offline</Text>
                    </TouchableOpacity>
                  )}
                  <View style={styles.searchBox}>
                    <Ionicons name="search" size={17} color="#94a3b8" />
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
                          size={20}
                          color={item.isLowStock ? '#dc2626' : '#16a34a'}
                        />
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.stockName}>{item.name}</Text>
                        <Text style={styles.stockSafe}>An toàn ≥ {formatQuantity(item.safeLevel)} {item.unit}</Text>
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
              )}
            </>
          )}

          {/* ===== TAB DUYỆT & LỊCH SỬ ===== */}
          {activeTab === 'DUYET_LS' && (
            <>
              {/* Phiếu chờ duyệt */}
              {!isStaff && (
                <View style={styles.section}>
                  <Text style={styles.sectionTitle}>Phiếu chờ duyệt{pendingRequests.length > 0 ? ` (${pendingRequests.length})` : ''}</Text>
                  {pendingRequests.length === 0
                    ? (
                      <View style={styles.emptyState}>
                        <Ionicons name="checkmark-done-circle-outline" size={36} color="#16a34a" />
                        <Text style={styles.emptyTitle}>Không có phiếu tồn đọng</Text>
                      </View>
                    )
                    : pendingRequests.map((request) => renderRequestCard(request, true))}
                </View>
              )}

              {/* Lịch sử giao dịch */}
              <View style={styles.section}>
                <View style={styles.sectionHeader}>
                  <Text style={styles.sectionTitle}>Lịch sử Nhập/Xuất</Text>
                  <Text style={styles.historyCount}>{filteredHistoryLogs.length} giao dịch</Text>
                </View>

                <View style={styles.searchBox}>
                  <Ionicons name="search" size={17} color="#94a3b8" />
                  <TextInput
                    value={historySearchText}
                    onChangeText={setHistorySearchText}
                    placeholder="Tìm theo món, người tạo..."
                    placeholderTextColor="#94a3b8"
                    style={styles.searchInput}
                  />
                </View>

                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.filterScroller}>
                  {[
                    { key: 'ALL', label: 'Tất cả' },
                    { key: 'IMPORT', label: 'Nhập' },
                    { key: 'EXPORT', label: 'Xuất' },
                    { key: 'ADJUST_UP', label: '+' },
                    { key: 'ADJUST_DOWN', label: '-' },
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

                {filteredHistoryLogs.length === 0 ? (
                  <View style={styles.emptyState}>
                    <Ionicons name="file-tray-outline" size={36} color={COLORS.textMuted} />
                    <Text style={styles.emptyTitle}>Chưa có lịch sử</Text>
                  </View>
                ) : filteredHistoryLogs.map((log) => {
                  const item = getLogItem(log);
                  const action = ACTIONS[log.type] || ACTIONS.IMPORT;
                  const creatorName = staffList.find(s => s.id === log.created_by)?.name || 'Hệ thống';
                  const approverName = staffList.find(s => s.id === log.approved_by)?.name || '';

                  return (
                    <View key={log.id} style={styles.logCard}>
                      <View style={styles.logCardHeader}>
                        <View style={[styles.logIcon, { backgroundColor: `${action.color}18` }]}>
                          <Ionicons name={action.sign === '+' ? 'add' : 'remove'} size={20} color={action.color} />
                        </View>
                        <View style={{ flex: 1 }}>
                          <Text style={styles.logTitle}>{item?.name || 'Không rõ'}</Text>
                          <Text style={styles.logMeta}>{action.label} • {formatTimestamp(log.created_at || log.date)}</Text>
                          <Text style={styles.logMeta}>👤 {creatorName}{approverName ? ` • ✅ ${approverName}` : ''}</Text>
                          {log.note ? <Text style={styles.logNote}>📝 {log.note}</Text> : null}
                        </View>
                        <Text style={[styles.logAmount, { color: action.color }]}>
                          {action.sign}{formatQuantity(log.amount)} {item?.unit || ''}
                        </Text>
                      </View>
                    </View>
                  );
                })}
              </View>
            </>
          )}

          {/* ===== TAB DANH MỤC ===== */}
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
                          {item.unit} • An toàn: {formatQuantity(item.safeLevel)}
                        </Text>
                      </View>
                      <View style={{ alignItems: 'flex-end' }}>
                        <Text style={styles.catalogStock}>
                          {formatQuantity(stockByItemId[item.id]?.currentStock)} {item.unit}
                        </Text>
                        {isOwner && (
                          <TouchableOpacity onPress={() => handleDeleteItem(item)} style={{ marginTop: 8 }}>
                            <Ionicons name="trash-outline" size={18} color="#dc2626" />
                          </TouchableOpacity>
                        )}
                      </View>
                    </View>
                  ))}
              </View>
            </>
          )}
        </ScrollView>

        {/* ===== MODAL TẠO PHIẾU KHO ===== */}
        <Modal visible={showActionModal} transparent animationType="slide">
          <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
            <View style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.5)' }}>
              <View style={[styles.actionSheet, { backgroundColor: COLORS.card }]}>
                <View style={styles.modalHeader}>
                  <Text style={styles.modalTitle}>Tạo phiếu kho</Text>
                  <TouchableOpacity onPress={() => setShowActionModal(false)}>
                    <Ionicons name="close" size={24} color="#475569" />
                  </TouchableOpacity>
                </View>

                <View style={styles.actionGrid}>
                  {[
                    { key: 'TRANSFER', label: 'Đề xuất nhập', color: '#7c3aed' },
                    { key: 'IMPORT', label: 'Nhập tay', color: '#16a34a' },
                    { key: 'EXPORT', label: 'Xuất hủy', color: '#dc2626' },
                  ].map((action) => (
                    <TouchableOpacity
                      key={action.key}
                      style={[
                        styles.actionButton,
                        actionType === action.key && { backgroundColor: action.color, borderColor: action.color },
                      ]}
                      onPress={() => { setActionType(action.key); setCartItems([]); setSelectedItemId(''); }}
                    >
                      <Text style={[styles.actionButtonText, actionType === action.key && { color: '#fff' }]}>
                        {action.label}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
                <View style={{ height: 1, backgroundColor: COLORS.border, marginVertical: 10 }} />

                <Text style={styles.fieldLabel}>Chọn nguyên liệu</Text>
                <TouchableOpacity
                  style={styles.dropdownButton}
                  onPress={() => setIsItemDropdownOpen(!isItemDropdownOpen)}
                >
                  <Text style={styles.dropdownButtonText}>
                    {selectedStock ? selectedStock.name : (actionType === 'TRANSFER' ? 'Chọn hàng từ Kho tổng...' : 'Vui lòng chọn...')}
                  </Text>
                  <Ionicons name={isItemDropdownOpen ? 'chevron-up' : 'chevron-down'} size={20} color="#475569" />
                </TouchableOpacity>

                {isItemDropdownOpen && (
                  <View style={styles.dropdownList}>
                    <ScrollView style={{ maxHeight: 160 }} nestedScrollEnabled>
                      {actionStockData.map((item) => (
                        <TouchableOpacity
                          key={item.id}
                          style={[styles.dropdownItem, effectiveSelectedItemId === item.id && styles.dropdownItemActive]}
                          onPress={() => { setSelectedItemId(item.id); setIsItemDropdownOpen(false); }}
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
                    <Text style={styles.currentStockLabel}>{actionType === 'TRANSFER' ? 'Tồn Kho tổng khả dụng' : 'Tồn khả dụng'}</Text>
                    <Text style={styles.currentStockValue}>
                      {formatQuantity(selectedStock.currentStock)} {selectedStock.unit}
                    </Text>
                  </View>
                )}

                <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 10, gap: 10 }}>
                  <View style={{ flex: 1 }}>
                    <TextInput
                      style={styles.input}
                      keyboardType="decimal-pad"
                      placeholder="Số lượng..."
                      placeholderTextColor="#94a3b8"
                      value={amount}
                      onChangeText={setAmount}
                    />
                  </View>
                  <TouchableOpacity style={{ backgroundColor: '#1565c0', padding: 13, borderRadius: 12 }} onPress={handleAddToCart}>
                    <Ionicons name="add" size={20} color="#fff" />
                  </TouchableOpacity>
                </View>

                {cartItems.length > 0 && (
                  <View style={{ marginTop: 12 }}>
                    <Text style={[styles.fieldLabel, { marginBottom: 6 }]}>Đã chọn ({cartItems.length} mặt hàng)</Text>
                    {cartItems.map((item, idx) => (
                      <View key={idx} style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: COLORS.inputBg, padding: 9, borderRadius: 8, marginBottom: 5, borderWidth: 1, borderColor: COLORS.border }}>
                        <View>
                          <Text style={{ fontWeight: '700', color: COLORS.text, fontSize: 13 }}>{item.name}</Text>
                          <Text style={{ color: COLORS.textMuted, fontSize: 11 }}>{formatQuantity(item.amount)} {item.unit}</Text>
                        </View>
                        <TouchableOpacity hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }} onPress={() => handleRemoveFromCart(item.itemId)}>
                          <Ionicons name="trash-outline" size={18} color="#ef4444" />
                        </TouchableOpacity>
                      </View>
                    ))}
                    <TouchableOpacity
                      style={[styles.submitButton, Boolean(busyKey) && styles.disabledButton]}
                      onPress={async () => { await handleSubmitAction(); if (!busyKey) setShowActionModal(false); }}
                      disabled={Boolean(busyKey)}
                    >
                      {busyKey === 'submit-action'
                        ? <ActivityIndicator color="#fff" />
                        : (
                          <>
                            <Ionicons name="paper-plane-outline" size={19} color="#fff" />
                            <Text style={styles.submitButtonText}>{actionType === 'TRANSFER' ? 'Gửi đề xuất nhập' : 'Tạo Phiếu Kho'}</Text>
                          </>
                        )}
                    </TouchableOpacity>
                  </View>
                )}
              </View>
            </View>
          </KeyboardAvoidingView>
        </Modal>

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
  stickyTopBar: { backgroundColor: COLORS.bg, paddingBottom: 10, ...(Platform.OS === 'web' ? { position: 'sticky', top: 0, zIndex: 40 } : null) },
  headerRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingTop: 10, paddingBottom: 14 },
  backBtn: { padding: 8, marginRight: 8, marginLeft: -8 },
  header: { fontSize: 20, fontWeight: '800', color: COLORS.text },
  headerCaption: { color: COLORS.textMuted, marginTop: 1, fontSize: 12 },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  createTicketButton: { minHeight: 42, borderRadius: 13, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, backgroundColor: '#1565c0' },
  createTicketText: { color: '#fff', fontSize: 12, fontWeight: '900' },
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
  scrollContent: { padding: 10, paddingBottom: 32 },
  summaryRow: { flexDirection: 'row', gap: 7, marginBottom: 9 },
  summaryCard: { flex: 1, backgroundColor: COLORS.card, borderRadius: 12, padding: 9, borderWidth: 1, borderColor: COLORS.border },
  summaryWarning: { backgroundColor: '#fff7ed', borderColor: '#fed7aa' },
  summaryValue: { color: COLORS.text, fontSize: 20, fontWeight: '900' },
  summaryLabel: { color: COLORS.textMuted, fontSize: 10, marginTop: 2 },
  section: { backgroundColor: COLORS.card, borderRadius: 14, padding: 10, marginBottom: 10, shadowColor: '#000', shadowOpacity: isDarkMode ? 0.18 : 0.04, shadowRadius: 6, elevation: 1, borderWidth: 1, borderColor: COLORS.border },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  sectionTitle: { color: COLORS.text, fontSize: 15, fontWeight: '800', marginBottom: 8 },
  suggestionBox: { backgroundColor: isDarkMode ? '#1e1b4b' : '#f5f3ff', borderColor: isDarkMode ? '#6d28d9' : '#ddd6fe' },
  suggestionHint: { color: COLORS.textMuted, fontSize: 11, lineHeight: 16, marginTop: -4, marginBottom: 6 },
  suggestionRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 8, borderTopWidth: 1, borderTopColor: isDarkMode ? '#3730a3' : '#ddd6fe' },
  suggestionQty: { color: '#7c3aed', fontWeight: '900', fontSize: 13, marginLeft: 8 },
  searchBox: { flexDirection: 'row', alignItems: 'center', backgroundColor: COLORS.inputBg, borderWidth: 1, borderColor: COLORS.inputBorder, borderRadius: 12, paddingHorizontal: 10, marginBottom: 8 },
  searchInput: { flex: 1, minHeight: 40, paddingLeft: 8, color: COLORS.text },
  stockRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 9, borderBottomWidth: 1, borderBottomColor: COLORS.border },
  stockIcon: { width: 34, height: 34, borderRadius: 11, backgroundColor: '#dcfce7', alignItems: 'center', justifyContent: 'center', marginRight: 10 },
  stockIconLow: { backgroundColor: '#fee2e2' },
  stockName: { color: COLORS.text, fontWeight: '800', fontSize: 13 },
  stockSafe: { color: COLORS.textMuted, fontSize: 11, marginTop: 1 },
  stockValue: { color: '#15803d', fontWeight: '900', fontSize: 18 },
  stockUnit: { color: COLORS.textMuted, fontSize: 11 },
  fieldLabel: { color: COLORS.text, fontWeight: '800', fontSize: 13, marginTop: 7, marginBottom: 5 },
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
  input: { borderWidth: 1, borderColor: COLORS.inputBorder, backgroundColor: COLORS.inputBg, color: COLORS.text, borderRadius: 12, paddingHorizontal: 12, minHeight: 42, fontSize: 15 },
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
  addButton: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#1565c0', borderRadius: 20, paddingHorizontal: 12, paddingVertical: 7, marginBottom: 10 },
  addButtonText: { color: '#fff', fontWeight: '800', fontSize: 12, marginLeft: 3 },
  catalogRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 9, borderBottomWidth: 1, borderBottomColor: COLORS.border },
  catalogName: { color: COLORS.text, fontWeight: '800' },
  catalogMeta: { color: COLORS.textMuted, fontSize: 11, marginTop: 4 },
  catalogStock: { color: '#1565c0', fontWeight: '900' },
  historyCount: { color: COLORS.textMuted, fontSize: 12, marginTop: -8, marginBottom: 12 },
  filterScroller: { marginTop: 8, marginBottom: 8 },
  filterChip: { backgroundColor: COLORS.inputBg, borderWidth: 1, borderColor: COLORS.border, borderRadius: 999, paddingHorizontal: 13, paddingVertical: 9, marginRight: 8 },
  filterChipActive: { backgroundColor: '#1565c0', borderColor: '#1565c0' },
  filterChipText: { color: COLORS.textMuted, fontWeight: '800', fontSize: 12 },
  filterChipTextActive: { color: '#fff' },
  logCard: { borderWidth: 1, borderColor: COLORS.border, backgroundColor: COLORS.inputBg, borderRadius: 14, padding: 10, marginTop: 8 },
  logCardHeader: { flexDirection: 'row', alignItems: 'flex-start' },
  logIcon: { width: 36, height: 36, borderRadius: 12, alignItems: 'center', justifyContent: 'center', marginRight: 10 },
  logTitle: { color: COLORS.text, fontWeight: '900', fontSize: 14 },
  logMeta: { color: COLORS.textMuted, fontSize: 12, marginTop: 2, lineHeight: 15 },
  logAmount: { fontWeight: '900', fontSize: 16, marginLeft: 8, textAlign: 'right', maxWidth: 115 },
  logDetailBox: { backgroundColor: COLORS.card, borderRadius: 12, borderWidth: 1, borderColor: COLORS.border, padding: 10, marginTop: 12 },
  logDetailText: { color: COLORS.textMuted, fontSize: 13, lineHeight: 20 },
  logDetailStrong: { color: COLORS.text, fontWeight: '900' },
  logNote: { color: COLORS.text, fontSize: 13, lineHeight: 20, marginTop: 4, fontStyle: 'italic' },
  compareSubtitle: { color: COLORS.textMuted, fontSize: 12, lineHeight: 18, marginTop: -8, marginBottom: 12 },
  compareSummaryGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 9, marginBottom: 12 },
  compareSummaryCard: { flexBasis: '48%', flexGrow: 1, backgroundColor: COLORS.inputBg, borderRadius: 13, borderWidth: 1, borderColor: COLORS.border, padding: 12 },
  compareSummaryWarn: { backgroundColor: isDarkMode ? '#431407' : '#fff7ed', borderColor: '#fed7aa' },
  compareSummaryValue: { color: COLORS.text, fontSize: 20, fontWeight: '900' },
  compareSummaryLabel: { color: COLORS.textMuted, fontSize: 11, fontWeight: '800', marginTop: 3 },
  compareTotalBox: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: isDarkMode ? '#2e1065' : '#f5f3ff', borderWidth: 1, borderColor: isDarkMode ? '#6d28d9' : '#ddd6fe', borderRadius: 13, padding: 11, marginBottom: 8 },
  compareTotalText: { color: isDarkMode ? '#ddd6fe' : '#5b21b6', fontSize: 12, fontWeight: '700', flex: 1 },
  compareTotalStrong: { fontWeight: '900' },
  compareRow: { borderWidth: 1, borderColor: COLORS.border, backgroundColor: COLORS.inputBg, borderRadius: 15, padding: 13, marginTop: 10 },
  compareRowHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  compareMeta: { color: COLORS.textMuted, fontSize: 11, lineHeight: 16, marginTop: 4 },
  compareBadge: { borderRadius: 999, paddingHorizontal: 10, paddingVertical: 6 },
  compareBadgeText: { fontSize: 10, fontWeight: '900' },
  compareMetricGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 12 },
  compareMetric: { flexBasis: '48%', flexGrow: 1, backgroundColor: COLORS.card, borderRadius: 12, borderWidth: 1, borderColor: COLORS.border, padding: 10 },
  compareMetricLabel: { color: COLORS.textMuted, fontSize: 10, fontWeight: '800', textTransform: 'uppercase' },
  compareMetricValue: { color: COLORS.text, fontSize: 15, fontWeight: '900', marginTop: 4 },
  compareUnitNote: { color: COLORS.textMuted, fontSize: 11, marginTop: 9, fontStyle: 'italic' },
  monthPicker: { flexDirection: 'row', alignItems: 'center', backgroundColor: COLORS.inputBg, borderWidth: 1, borderColor: COLORS.border, borderRadius: 14, padding: 8, marginBottom: 10 },
  monthArrow: { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: COLORS.card, borderWidth: 1, borderColor: COLORS.border },
  monthCenter: { flex: 1, alignItems: 'center', paddingHorizontal: 10 },
  monthLabel: { color: COLORS.text, fontSize: 16, fontWeight: '900', textTransform: 'capitalize' },
  monthSubLabel: { color: COLORS.textMuted, fontSize: 11, marginTop: 2 },
  quickMonthRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 12 },
  quickMonthChip: { backgroundColor: COLORS.inputBg, borderWidth: 1, borderColor: COLORS.border, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 8 },
  quickMonthChipActive: { backgroundColor: '#1565c0', borderColor: '#1565c0' },
  quickMonthText: { color: COLORS.textMuted, fontSize: 12, fontWeight: '800' },
  quickMonthTextActive: { color: '#fff' },
  usageCard: { borderWidth: 1, borderColor: COLORS.border, backgroundColor: COLORS.inputBg, borderRadius: 16, padding: 13, marginTop: 10 },
  usageMainRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 12, marginTop: 14, paddingTop: 12, borderTopWidth: 1, borderTopColor: COLORS.border },
  usageBigLabel: { color: COLORS.textMuted, fontSize: 11, fontWeight: '800' },
  usageBigValue: { color: COLORS.text, fontSize: 20, fontWeight: '900', marginTop: 4 },
  usageDelta: { fontSize: 15, fontWeight: '900', marginTop: 4, textAlign: 'right' },
  usageFooter: { backgroundColor: COLORS.card, borderRadius: 12, borderWidth: 1, borderColor: COLORS.border, padding: 10, marginTop: 10, gap: 4 },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', padding: 20 },
  actionSheet: { borderTopLeftRadius: 22, borderTopRightRadius: 22, padding: 20, paddingBottom: 36, maxHeight: '88%' },
  modalContent: { backgroundColor: COLORS.card, borderRadius: 18, padding: 20, borderWidth: 1, borderColor: COLORS.border },
  modalHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  modalTitle: { color: COLORS.text, fontSize: 21, fontWeight: '900' },
  modalStore: { color: COLORS.textMuted, marginTop: 3, marginBottom: 8 },
  modalFieldRow: { flexDirection: 'row', gap: 10 },
  modalField: { flex: 1 },
});
