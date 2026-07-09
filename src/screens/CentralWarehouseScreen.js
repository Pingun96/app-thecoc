import React, { useContext, useMemo, useState } from 'react';
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
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { AppContext } from '../context/AppContext';
import { Alert } from '../utils/alert';
import { supabase } from '../services/supabaseClient';
import {
  normalizeInventoryItem,
  normalizeInventoryLog,
} from '../services/dataMappers';
import {
  approveInventoryTicket,
  rejectInventoryTicket,
} from '../services/inventoryService';
import {
  buildInventoryStockRows,
  getCentralWarehouseStore,
  getStoreName,
} from '../utils/warehouse';

const formatQuantity = (value) => Number(value || 0).toLocaleString('vi-VN', {
  maximumFractionDigits: 2,
});

const makeId = (prefix) => `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

const parseQuantityInput = (value) => {
  const text = String(value || '').trim().replace(/\s/g, '');
  if (!text) return Number.NaN;
  if (text.includes(',')) return Number(text.replace(/\./g, '').replace(',', '.'));
  const dotCount = (text.match(/\./g) || []).length;
  if (dotCount > 1 || /\.\d{3}(\D|$)/.test(text)) return Number(text.replace(/\./g, ''));
  return Number(text);
};

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

export default function CentralWarehouseScreen({ navigation }) {
  const {
    currentUser,
    storeList,
    setStoreList,
    inventoryItems,
    setInventoryItems,
    inventoryLogs,
    setInventoryLogs,
    inventoryTickets,
    setInventoryTickets,
    refreshData,
    COLORS,
    isDarkMode,
  } = useContext(AppContext);
  const styles = useMemo(() => getStyles(COLORS, isDarkMode), [COLORS, isDarkMode]);
  const [busyKey, setBusyKey] = useState('');
  const [activeTab, setActiveTab] = useState('PENDING');
  const [showStockModal, setShowStockModal] = useState(false);
  const [selectedStockItem, setSelectedStockItem] = useState(null);
  const [stockForm, setStockForm] = useState({
    name: '',
    unit: 'kg',
    safeLevel: '0',
    amount: '',
  });

  const canAccess = currentUser?.role === 'OWNER' || currentUser?.permissions?.central_warehouse === true;
  const warehouse = useMemo(() => getCentralWarehouseStore(storeList), [storeList]);
  const warehouseId = warehouse?.id;

  const warehouseItems = useMemo(() => inventoryItems.filter((item) => (
    warehouseId && String(item.store_id) === String(warehouseId)
  )), [inventoryItems, warehouseId]);

  const stockRows = useMemo(
    () => buildInventoryStockRows(warehouseItems, inventoryLogs),
    [warehouseItems, inventoryLogs],
  );

  const requestRows = useMemo(() => (
    inventoryTickets
      .filter((ticket) => (
        ticket.type === 'TRANSFER'
        && warehouseId
        && String(ticket.source_store_id) === String(warehouseId)
      ))
      .sort((a, b) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime())
  ), [inventoryTickets, warehouseId]);

  const pendingRequests = requestRows.filter((ticket) => ticket.status === 'PENDING_SOURCE');
  const inTransitRequests = requestRows.filter((ticket) => ticket.status === 'PENDING_DEST');
  const completedRequests = requestRows.filter((ticket) => ['APPROVED', 'REJECTED'].includes(ticket.status));
  const doneRequests = completedRequests.slice(0, 20);

  const stockById = useMemo(() => Object.fromEntries(stockRows.map((item) => [item.id, item])), [stockRows]);
  const tabs = useMemo(() => [
    { key: 'PENDING', label: 'Chá» duyá»‡t', count: pendingRequests.length },
    { key: 'TRANSIT', label: 'Äang giao', count: inTransitRequests.length },
    { key: 'STOCK', label: 'Tá»“n kho', count: stockRows.length },
    { key: 'HISTORY', label: 'Lá»‹ch sá»­', count: completedRequests.length },
  ], [completedRequests.length, inTransitRequests.length, pendingRequests.length, stockRows.length]);

  const resetStockForm = () => {
    setSelectedStockItem(null);
    setStockForm({
      name: '',
      unit: 'kg',
      safeLevel: '0',
      amount: '',
    });
  };

  const openStockModal = (item = null) => {
    setSelectedStockItem(item);
    setStockForm({
      name: item?.name || '',
      unit: item?.unit || 'kg',
      safeLevel: String(item?.safeLevel ?? 0),
      amount: '',
    });
    setShowStockModal(true);
  };

  const closeStockModal = () => {
    setShowStockModal(false);
    resetStockForm();
  };

  const handleCreateWarehouse = async () => {
    setBusyKey('create-warehouse');
    try {
      const numericIds = storeList
        .map((store) => Number(store.id))
        .filter((id) => Number.isFinite(id));
      const fallbackId = numericIds.length > 0
        ? Math.max(...numericIds) + 1
        : makeId('store');
      const attempts = [
        { name: 'Kho Tá»•ng', is_warehouse: true },
        { id: fallbackId, name: 'Kho Tá»•ng', is_warehouse: true },
        { name: 'Kho Tá»•ng' },
        { id: fallbackId, name: 'Kho Tá»•ng' },
      ];
      let data = null;
      let lastError = null;

      for (const payload of attempts) {
        const result = await supabase
          .from('stores')
          .insert([payload])
          .select('*')
          .single();
        if (!result.error) {
          data = result.data;
          break;
        }
        lastError = result.error;
      }

      if (!data && lastError) throw lastError;

      if (data) {
        setStoreList((current) => {
          const exists = current.some((store) => String(store.id) === String(data.id));
          return exists ? current : [...current, data];
        });
      }
      await refreshData?.();
      Alert.alert('ÄÃ£ táº¡o Kho tá»•ng', 'Báº¡n cÃ³ thá»ƒ báº¯t Ä‘áº§u thÃªm máº·t hÃ ng vÃ  nháº­p tá»“n cho Kho tá»•ng.');
    } catch (error) {
      Alert.alert('KhÃ´ng thá»ƒ táº¡o Kho tá»•ng', error?.message || 'Vui lÃ²ng kiá»ƒm tra láº¡i quyá»n hoáº·c cáº¥u trÃºc báº£ng stores.');
    } finally {
      setBusyKey('');
    }
  };

  const handleSubmitStock = async () => {
    const cleanName = stockForm.name.trim();
    const cleanUnit = stockForm.unit.trim();
    const safeLevel = parseQuantityInput(stockForm.safeLevel);
    const amount = parseQuantityInput(stockForm.amount);

    if (!warehouseId) {
      Alert.alert('ChÆ°a cÃ³ Kho tá»•ng', 'Vui lÃ²ng táº¡o Kho tá»•ng trÆ°á»›c khi nháº­p tá»“n.');
      return;
    }
    if (!cleanName || !cleanUnit) {
      Alert.alert('Thiáº¿u thÃ´ng tin', 'Vui lÃ²ng nháº­p tÃªn máº·t hÃ ng vÃ  Ä‘Æ¡n vá»‹ tÃ­nh.');
      return;
    }
    if (!Number.isFinite(safeLevel) || safeLevel < 0) {
      Alert.alert('Sai má»©c an toÃ n', 'Má»©c tá»“n an toÃ n pháº£i lÃ  sá»‘ tá»« 0 trá»Ÿ lÃªn.');
      return;
    }
    if (!Number.isFinite(amount) || amount <= 0) {
      Alert.alert('Sai sá»‘ lÆ°á»£ng', 'Sá»‘ lÆ°á»£ng nháº­p tá»“n pháº£i lá»›n hÆ¡n 0.');
      return;
    }

    setBusyKey('save-stock');
    try {
      const matchedItem = selectedStockItem || warehouseItems.find(
        (item) => String(item.name || '').trim().toLowerCase() === cleanName.toLowerCase(),
      );
      let finalItem = matchedItem;

      if (!finalItem) {
        const itemPayload = {
          id: makeId('item'),
          name: cleanName,
          unit: cleanUnit,
          safelevel: safeLevel,
          store_id: warehouseId,
        };
        const { error: itemError } = await supabase.from('inventory_items').insert([itemPayload]);
        if (itemError) throw itemError;
        finalItem = normalizeInventoryItem(itemPayload);
        setInventoryItems((current) => [...current, finalItem]);
      } else if (finalItem.unit !== cleanUnit || Number(finalItem.safeLevel || 0) !== safeLevel) {
        const { error: updateError } = await supabase
          .from('inventory_items')
          .update({ unit: cleanUnit, safelevel: safeLevel })
          .eq('id', finalItem.id);
        if (updateError) throw updateError;
        finalItem = { ...finalItem, unit: cleanUnit, safelevel: safeLevel, safeLevel };
        setInventoryItems((current) => current.map((item) => (
          item.id === finalItem.id ? finalItem : item
        )));
      }

      const logPayload = {
        id: makeId('log'),
        itemid: finalItem.id,
        type: 'IMPORT',
        amount,
        date: new Date().toISOString(),
        store_id: warehouseId,
        created_by: currentUser?.id,
        approved_by: currentUser?.id,
        note: selectedStockItem ? 'Nháº­p thÃªm tá»“n Kho tá»•ng' : 'Nháº­p tá»“n Kho tá»•ng',
      };
      const { error: logError } = await supabase.from('inventory_logs').insert([logPayload]);
      if (logError) throw logError;

      setInventoryLogs((current) => [...current, normalizeInventoryLog(logPayload)]);
      closeStockModal();
      await refreshData?.();
      Alert.alert('ÄÃ£ nháº­p tá»“n', `${cleanName}: +${formatQuantity(amount)} ${cleanUnit}`);
    } catch (error) {
      Alert.alert('KhÃ´ng thá»ƒ nháº­p tá»“n', error?.message || 'ÄÃ£ cÃ³ lá»—i khi lÆ°u tá»“n Kho tá»•ng.');
    } finally {
      setBusyKey('');
    }
  };

  const handleReview = async (ticket, decision) => {
    setBusyKey(`${decision}-${ticket.id}`);
    try {
      if (decision === 'REJECT') {
        await rejectInventoryTicket(ticket.id, currentUser?.id);
        setInventoryTickets((current) => current.map((item) => (
          item.id === ticket.id ? { ...item, status: 'REJECTED' } : item
        )));
        Alert.alert('ÄÃ£ tá»« chá»‘i', 'ÄÆ¡n Ä‘á» xuáº¥t Ä‘Ã£ bá»‹ há»§y.');
      } else {
        await approveInventoryTicket(ticket, currentUser?.id, warehouseId);
        await refreshData?.();
        Alert.alert('ÄÃ£ xÃ¡c nháº­n xuáº¥t', 'Kho tá»•ng Ä‘Ã£ ghi xuáº¥t hÃ ng. ÄÆ¡n Ä‘ang chá» cá»­a hÃ ng xÃ¡c nháº­n nháº­n hÃ ng.');
      }
    } catch (error) {
      Alert.alert('KhÃ´ng thá»ƒ xá»­ lÃ½', error?.message || 'ÄÃ£ cÃ³ lá»—i khi duyá»‡t Ä‘Æ¡n.');
    } finally {
      setBusyKey('');
    }
  };

  const renderTicket = (ticket, reviewable = false) => {
    const isBusy = busyKey.endsWith(ticket.id);
    return (
      <View key={ticket.id} style={styles.ticketCard}>
        <View style={styles.ticketHeader}>
          <View style={{ flex: 1 }}>
            <Text style={styles.ticketTitle}>Äá» xuáº¥t nháº­p hÃ ng</Text>
            <Text style={styles.ticketMeta}>
              Vá»: {getStoreName(storeList, ticket.destination_store_id)} â€¢ {formatTimestamp(ticket.created_at)}
            </Text>
            <Text style={styles.ticketMeta}>NgÆ°á»i táº¡o: {ticket.requested_by_name || 'KhÃ´ng rÃµ'}</Text>
          </View>
          <View style={[styles.statusBadge, ticket.status === 'PENDING_SOURCE' ? styles.statusPending : ticket.status === 'PENDING_DEST' ? styles.statusTransit : styles.statusDone]}>
            <Text style={styles.statusText}>
              {ticket.status === 'PENDING_SOURCE' ? 'Chá» xÃ¡c nháº­n' : ticket.status === 'PENDING_DEST' ? 'Äang giao' : ticket.status === 'APPROVED' ? 'HoÃ n táº¥t' : 'ÄÃ£ há»§y'}
            </Text>
          </View>
        </View>

        <View style={styles.itemBox}>
          {(ticket.items || []).map((item, index) => {
            const stock = stockById[item.itemId];
            return (
              <View key={`${item.itemId}_${index}`} style={styles.itemRow}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.itemName}>{item.name}</Text>
                  <Text style={styles.itemMeta}>Kho tá»•ng cÃ²n {formatQuantity(stock?.currentStock)} {item.unit}</Text>
                </View>
                <Text style={styles.itemAmount}>{formatQuantity(item.amount)} {item.unit}</Text>
              </View>
            );
          })}
        </View>

        {reviewable && (
          <View style={styles.reviewRow}>
            <TouchableOpacity
              style={[styles.reviewButton, styles.rejectButton]}
              onPress={() => handleReview(ticket, 'REJECT')}
              disabled={isBusy}
            >
              <Text style={styles.reviewText}>Tá»« chá»‘i</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.reviewButton, styles.approveButton]}
              onPress={() => handleReview(ticket, 'APPROVE')}
              disabled={isBusy}
            >
              {isBusy ? <ActivityIndicator color="#fff" /> : <Text style={styles.reviewText}>XÃ¡c nháº­n xuáº¥t</Text>}
            </TouchableOpacity>
          </View>
        )}
      </View>
    );
  };

  if (!canAccess) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.emptyScreen}>
          <Ionicons name="lock-closed-outline" size={42} color="#ef4444" />
          <Text style={styles.emptyTitle}>Báº¡n chÆ°a cÃ³ quyá»n Kho tá»•ng</Text>
          <Text style={styles.emptyText}>Chá»§ quÃ¡n hoáº·c ngÆ°á»i cÃ³ quyá»n phÃ¢n quyá»n cáº§n báº­t quyá»n Kho tá»•ng cho tÃ i khoáº£n nÃ y.</Text>
          <TouchableOpacity style={styles.backAction} onPress={() => navigation.goBack()}>
            <Text style={styles.backActionText}>Quay láº¡i</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.stickyTopBar}>
        <View style={styles.headerRow}>
          <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
            <Ionicons name="arrow-back" size={24} color={COLORS.primary} />
          </TouchableOpacity>
          <View style={{ flex: 1 }}>
            <Text style={styles.header}>Kho tá»•ng</Text>
            <Text style={styles.headerCaption}>{warehouse?.name || 'ChÆ°a cáº¥u hÃ¬nh kho tá»•ng'}</Text>
          </View>
          <TouchableOpacity onPress={() => refreshData?.()} style={styles.refreshButton}>
            <Ionicons name="refresh" size={20} color={COLORS.primary} />
          </TouchableOpacity>
          {warehouseId && (
            <TouchableOpacity onPress={() => openStockModal()} style={styles.addStockButton}>
              <Ionicons name="add" size={19} color="#fff" />
              <Text style={styles.addStockText}>Nháº­p tá»“n</Text>
            </TouchableOpacity>
          )}
        </View>

        {warehouseId && (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.tabScroller}
          >
            {tabs.map((tab) => (
              <TouchableOpacity
                key={tab.key}
                style={[styles.tabButton, activeTab === tab.key && styles.tabButtonActive]}
                onPress={() => setActiveTab(tab.key)}
              >
                <Text style={[styles.tabText, activeTab === tab.key && styles.tabTextActive]}>
                  {tab.label}
                </Text>
                <View style={[styles.tabCount, activeTab === tab.key && styles.tabCountActive]}>
                  <Text style={[styles.tabCountText, activeTab === tab.key && styles.tabCountTextActive]}>
                    {tab.count}
                  </Text>
                </View>
              </TouchableOpacity>
            ))}
          </ScrollView>
        )}
      </View>

      <ScrollView style={styles.flexScroll} contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        {!warehouseId ? (
          <View style={styles.emptyScreen}>
            <MaterialCommunityIcons name="package-variant-closed" size={50} color="#7c3aed" />
            <Text style={styles.emptyTitle}>ChÆ°a cÃ³ Kho tá»•ng</Text>
            <Text style={styles.emptyText}>Táº¡o Kho tá»•ng Ä‘á»ƒ quáº£n lÃ½ hÃ ng trung tÃ¢m, duyá»‡t Ä‘Æ¡n Ä‘á» xuáº¥t vÃ  nháº­p tá»“n minh báº¡ch.</Text>
            <TouchableOpacity
              style={[styles.primaryAction, busyKey === 'create-warehouse' && styles.disabledButton]}
              onPress={handleCreateWarehouse}
              disabled={busyKey === 'create-warehouse'}
            >
              {busyKey === 'create-warehouse'
                ? <ActivityIndicator color="#fff" />
                : <Text style={styles.primaryActionText}>Táº¡o Kho tá»•ng</Text>}
            </TouchableOpacity>
          </View>
        ) : (
          <>
            <View style={styles.summaryRow}>
              <View style={styles.summaryCard}>
                <Text style={styles.summaryValue}>{stockRows.length}</Text>
                <Text style={styles.summaryLabel}>Máº·t hÃ ng</Text>
              </View>
              <View style={styles.summaryCard}>
                <Text style={styles.summaryValue}>{pendingRequests.length}</Text>
                <Text style={styles.summaryLabel}>Chá» xÃ¡c nháº­n</Text>
              </View>
              <View style={styles.summaryCard}>
                <Text style={styles.summaryValue}>{inTransitRequests.length}</Text>
                <Text style={styles.summaryLabel}>Äang giao</Text>
              </View>
            </View>

            {activeTab === 'PENDING' && (
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>ÄÆ¡n cá»­a hÃ ng Ä‘á» xuáº¥t</Text>
                {pendingRequests.length === 0 ? (
                  <Text style={styles.emptyText}>KhÃ´ng cÃ³ Ä‘Æ¡n nÃ o Ä‘ang chá» Kho tá»•ng xÃ¡c nháº­n.</Text>
                ) : pendingRequests.map((ticket) => renderTicket(ticket, true))}
              </View>
            )}

            {activeTab === 'TRANSIT' && (
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>Äang chá» cá»­a hÃ ng nháº­n</Text>
                {inTransitRequests.length === 0 ? (
                  <Text style={styles.emptyText}>KhÃ´ng cÃ³ Ä‘Æ¡n Ä‘ang giao.</Text>
                ) : inTransitRequests.map((ticket) => renderTicket(ticket))}
              </View>
            )}

            {activeTab === 'STOCK' && (
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>Tá»“n Kho tá»•ng</Text>
                {stockRows.length === 0 ? (
                  <View style={styles.emptyStockBox}>
                    <Text style={styles.emptyText}>Kho tá»•ng chÆ°a cÃ³ máº·t hÃ ng. Nháº­p tá»“n ban Ä‘áº§u Ä‘á»ƒ cá»­a hÃ ng cÃ³ thá»ƒ Ä‘á» xuáº¥t láº¥y hÃ ng.</Text>
                    <TouchableOpacity style={styles.secondaryAction} onPress={() => openStockModal()}>
                      <Ionicons name="add-circle-outline" size={18} color="#7c3aed" />
                      <Text style={styles.secondaryActionText}>ThÃªm hÃ ng Kho tá»•ng</Text>
                    </TouchableOpacity>
                  </View>
                ) : stockRows.map((item) => (
                  <View key={item.id} style={styles.stockRow}>
                    <View style={styles.stockIcon}>
                      <MaterialCommunityIcons name="package-variant-closed" size={20} color="#7c3aed" />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.itemName}>{item.name}</Text>
                      <Text style={styles.itemMeta}>An toÃ n â‰¥ {formatQuantity(item.safeLevel)} {item.unit}</Text>
                    </View>
                    <Text style={styles.stockValue}>{formatQuantity(item.currentStock)} {item.unit}</Text>
                    <TouchableOpacity style={styles.inlineStockButton} onPress={() => openStockModal(item)}>
                      <Ionicons name="add" size={16} color="#7c3aed" />
                    </TouchableOpacity>
                  </View>
                ))}
              </View>
            )}

            {activeTab === 'HISTORY' && (
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>
                  Lá»‹ch sá»­ gáº§n Ä‘Ã¢y{completedRequests.length > doneRequests.length ? ' (20 gáº§n nháº¥t)' : ''}
                </Text>
                {doneRequests.length === 0 ? (
                  <Text style={styles.emptyText}>ChÆ°a cÃ³ Ä‘Æ¡n hoÃ n táº¥t hoáº·c bá»‹ há»§y.</Text>
                ) : doneRequests.map((ticket) => renderTicket(ticket))}
              </View>
            )}
          </>
        )}
      </ScrollView>

      <Modal
        transparent
        visible={showStockModal}
        animationType="fade"
        onRequestClose={closeStockModal}
      >
        <KeyboardAvoidingView
          style={styles.modalOverlay}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <View>
                <Text style={styles.modalTitle}>{selectedStockItem ? 'Nháº­p thÃªm tá»“n' : 'ThÃªm hÃ ng Kho tá»•ng'}</Text>
                <Text style={styles.modalCaption}>Sá»‘ lÆ°á»£ng sáº½ Ä‘Æ°á»£c ghi log nháº­p kho ngay.</Text>
              </View>
              <TouchableOpacity onPress={closeStockModal} style={styles.modalClose}>
                <Ionicons name="close" size={20} color={COLORS.textMuted} />
              </TouchableOpacity>
            </View>

            <Text style={styles.inputLabel}>TÃªn máº·t hÃ ng</Text>
            <TextInput
              style={[styles.input, selectedStockItem && styles.inputDisabled]}
              value={stockForm.name}
              onChangeText={(name) => setStockForm((current) => ({ ...current, name }))}
              placeholder="VD: TrÃ¢n chÃ¢u Ä‘en"
              placeholderTextColor={COLORS.textMuted}
              editable={!selectedStockItem}
            />

            <View style={styles.modalFieldRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.inputLabel}>ÄÆ¡n vá»‹</Text>
                <TextInput
                  style={styles.input}
                  value={stockForm.unit}
                  onChangeText={(unit) => setStockForm((current) => ({ ...current, unit }))}
                  placeholder="kg, há»™p..."
                  placeholderTextColor={COLORS.textMuted}
                />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.inputLabel}>Tá»“n an toÃ n</Text>
                <TextInput
                  style={styles.input}
                  value={stockForm.safeLevel}
                  onChangeText={(safeLevel) => setStockForm((current) => ({ ...current, safeLevel }))}
                  keyboardType="decimal-pad"
                  placeholder="0"
                  placeholderTextColor={COLORS.textMuted}
                />
              </View>
            </View>

            <Text style={styles.inputLabel}>Sá»‘ lÆ°á»£ng nháº­p</Text>
            <TextInput
              style={[styles.input, styles.amountInput]}
              value={stockForm.amount}
              onChangeText={(amount) => setStockForm((current) => ({ ...current, amount }))}
              keyboardType="decimal-pad"
              placeholder="VD: 1.500"
              placeholderTextColor={COLORS.textMuted}
            />

            <View style={styles.modalActions}>
              <TouchableOpacity style={styles.cancelButton} onPress={closeStockModal}>
                <Text style={styles.cancelButtonText}>Há»§y</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.saveButton, busyKey === 'save-stock' && styles.disabledButton]}
                onPress={handleSubmitStock}
                disabled={busyKey === 'save-stock'}
              >
                {busyKey === 'save-stock'
                  ? <ActivityIndicator color="#fff" />
                  : <Text style={styles.saveButtonText}>LÆ°u nháº­p tá»“n</Text>}
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </SafeAreaView>
  );
}

const getStyles = (COLORS, isDarkMode) => StyleSheet.create({
  container: { flex: 1, minHeight: 0, overflow: Platform.OS === 'web' ? 'visible' : 'hidden', backgroundColor: COLORS.bg },
  flexScroll: { flex: 1, minHeight: 0 },
  stickyTopBar: { backgroundColor: COLORS.bg, paddingBottom: 8, borderBottomWidth: 1, borderBottomColor: COLORS.border, ...(Platform.OS === 'web' ? { position: 'sticky', top: 0, zIndex: 40 } : null) },
  headerRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingTop: 10, paddingBottom: 10, backgroundColor: COLORS.bg },
  backBtn: { padding: 8, marginLeft: -8, marginRight: 6 },
  header: { color: COLORS.text, fontSize: 22, fontWeight: '900' },
  headerCaption: { color: COLORS.textMuted, marginTop: 2, fontSize: 12 },
  refreshButton: { width: 42, height: 42, borderRadius: 13, alignItems: 'center', justifyContent: 'center', backgroundColor: COLORS.inputBg, borderWidth: 1, borderColor: COLORS.border },
  addStockButton: { height: 42, borderRadius: 13, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 4, backgroundColor: '#7c3aed', paddingHorizontal: 10, marginLeft: 8 },
  addStockText: { color: '#fff', fontSize: 12, fontWeight: '900' },
  tabScroller: { paddingHorizontal: 12, gap: 8 },
  tabButton: { minHeight: 36, borderRadius: 12, paddingHorizontal: 11, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: COLORS.inputBg, borderWidth: 1, borderColor: COLORS.border },
  tabButtonActive: { backgroundColor: '#7c3aed', borderColor: '#7c3aed' },
  tabText: { color: COLORS.textMuted, fontSize: 12, fontWeight: '900' },
  tabTextActive: { color: '#fff' },
  tabCount: { minWidth: 22, height: 22, borderRadius: 999, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6, backgroundColor: COLORS.card, borderWidth: 1, borderColor: COLORS.border },
  tabCountActive: { backgroundColor: 'rgba(255,255,255,0.18)', borderColor: 'rgba(255,255,255,0.35)' },
  tabCountText: { color: COLORS.textMuted, fontSize: 11, fontWeight: '900' },
  tabCountTextActive: { color: '#fff' },
  scrollContent: { padding: 10, paddingBottom: 30 },
  summaryRow: { flexDirection: 'row', gap: 8, marginBottom: 10 },
  summaryCard: { flex: 1, backgroundColor: COLORS.card, borderRadius: 14, padding: 12, borderWidth: 1, borderColor: COLORS.border },
  summaryValue: { color: COLORS.text, fontSize: 22, fontWeight: '900' },
  summaryLabel: { color: COLORS.textMuted, fontSize: 11, marginTop: 3, fontWeight: '700' },
  section: { backgroundColor: COLORS.card, borderRadius: 15, padding: 12, borderWidth: 1, borderColor: COLORS.border, marginBottom: 10, shadowColor: '#000', shadowOpacity: isDarkMode ? 0.2 : 0.04, shadowRadius: 8, elevation: 1 },
  sectionTitle: { color: COLORS.text, fontSize: 16, fontWeight: '900', marginBottom: 10 },
  ticketCard: { borderWidth: 1, borderColor: COLORS.border, borderRadius: 14, padding: 12, marginBottom: 10, backgroundColor: COLORS.inputBg },
  ticketHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  ticketTitle: { color: '#7c3aed', fontWeight: '900', fontSize: 13, textTransform: 'uppercase' },
  ticketMeta: { color: COLORS.textMuted, fontSize: 12, marginTop: 3, lineHeight: 16 },
  statusBadge: { borderRadius: 999, paddingHorizontal: 9, paddingVertical: 6 },
  statusPending: { backgroundColor: '#fef3c7' },
  statusTransit: { backgroundColor: '#dbeafe' },
  statusDone: { backgroundColor: '#dcfce7' },
  statusText: { color: '#334155', fontSize: 10, fontWeight: '900' },
  itemBox: { backgroundColor: COLORS.card, borderRadius: 12, borderWidth: 1, borderColor: COLORS.border, padding: 9, marginTop: 10 },
  itemRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: COLORS.border },
  itemName: { color: COLORS.text, fontWeight: '900', fontSize: 13 },
  itemMeta: { color: COLORS.textMuted, fontSize: 11, marginTop: 2 },
  itemAmount: { color: COLORS.text, fontWeight: '900', marginLeft: 10 },
  reviewRow: { flexDirection: 'row', gap: 10, marginTop: 12 },
  reviewButton: { flex: 1, minHeight: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  rejectButton: { backgroundColor: '#ef4444' },
  approveButton: { backgroundColor: '#16a34a' },
  reviewText: { color: '#fff', fontWeight: '900' },
  stockRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 9, borderBottomWidth: 1, borderBottomColor: COLORS.border },
  stockIcon: { width: 34, height: 34, borderRadius: 11, backgroundColor: '#ede9fe', alignItems: 'center', justifyContent: 'center', marginRight: 9 },
  stockValue: { color: '#15803d', fontSize: 15, fontWeight: '900', marginLeft: 8 },
  inlineStockButton: { width: 30, height: 30, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: '#f5f3ff', marginLeft: 6, borderWidth: 1, borderColor: '#ddd6fe' },
  emptyStockBox: { alignItems: 'center', gap: 10, paddingVertical: 6 },
  primaryAction: { marginTop: 16, backgroundColor: '#7c3aed', paddingVertical: 12, paddingHorizontal: 18, borderRadius: 13, minWidth: 150, alignItems: 'center' },
  primaryActionText: { color: '#fff', fontWeight: '900' },
  secondaryAction: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, borderRadius: 12, borderWidth: 1, borderColor: '#ddd6fe', backgroundColor: '#f5f3ff', paddingVertical: 10, paddingHorizontal: 13 },
  secondaryActionText: { color: '#7c3aed', fontWeight: '900', fontSize: 12 },
  disabledButton: { opacity: 0.65 },
  emptyScreen: { flex: 1, minHeight: 280, alignItems: 'center', justifyContent: 'center', padding: 24 },
  emptyTitle: { color: COLORS.text, fontSize: 18, fontWeight: '900', marginTop: 12, textAlign: 'center' },
  emptyText: { color: COLORS.textMuted, fontSize: 13, lineHeight: 19, textAlign: 'center' },
  backAction: { marginTop: 18, backgroundColor: COLORS.primary, paddingVertical: 12, paddingHorizontal: 18, borderRadius: 12 },
  backActionText: { color: '#fff', fontWeight: '900' },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(15, 23, 42, 0.38)', justifyContent: 'flex-end' },
  modalCard: { backgroundColor: COLORS.card, borderTopLeftRadius: 22, borderTopRightRadius: 22, padding: 16, borderWidth: 1, borderColor: COLORS.border },
  modalHeader: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, marginBottom: 14 },
  modalTitle: { color: COLORS.text, fontSize: 18, fontWeight: '900' },
  modalCaption: { color: COLORS.textMuted, fontSize: 12, marginTop: 3 },
  modalClose: { width: 34, height: 34, borderRadius: 11, alignItems: 'center', justifyContent: 'center', backgroundColor: COLORS.inputBg },
  inputLabel: { color: COLORS.text, fontSize: 12, fontWeight: '900', marginBottom: 6, marginTop: 10 },
  input: { minHeight: 46, borderRadius: 13, borderWidth: 1, borderColor: COLORS.border, backgroundColor: COLORS.inputBg, color: COLORS.text, paddingHorizontal: 12, fontSize: 15, fontWeight: '700' },
  inputDisabled: { opacity: 0.72 },
  amountInput: { fontSize: 20, fontWeight: '900' },
  modalFieldRow: { flexDirection: 'row', gap: 10 },
  modalActions: { flexDirection: 'row', gap: 10, marginTop: 16 },
  cancelButton: { flex: 1, minHeight: 46, borderRadius: 13, alignItems: 'center', justifyContent: 'center', backgroundColor: COLORS.inputBg, borderWidth: 1, borderColor: COLORS.border },
  cancelButtonText: { color: COLORS.textMuted, fontWeight: '900' },
  saveButton: { flex: 1.4, minHeight: 46, borderRadius: 13, alignItems: 'center', justifyContent: 'center', backgroundColor: '#7c3aed' },
  saveButtonText: { color: '#fff', fontWeight: '900' },
});
