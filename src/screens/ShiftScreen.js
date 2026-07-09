import React, { useState, useContext, useEffect, useMemo, useCallback } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, TextInput, SafeAreaView, KeyboardAvoidingView, Platform, Modal, Image, ActivityIndicator, Linking, RefreshControl } from 'react-native';
import { Alert } from '../utils/alert';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as ImagePicker from 'expo-image-picker';
import { AppContext } from '../context/AppContext';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { supabase } from '../services/supabaseClient';
import { sendPushNotification } from '../services/NotificationService';
import { getDailyRevenue } from '../services/financeService';
import { getLocalDateKey } from '../utils/dateTime';
import DateRangePickerModal from '../components/DateRangePickerModal';

const toMoneyNumber = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const calculateShiftTotals = ({
  openingCash = 0,
  grossRevenue = 0,
  momo = 0,
  grab = 0,
  shopee = 0,
  discount = 0,
  expenses = 0,
  actualCash = 0,
} = {}) => {
  const safeOpeningCash = toMoneyNumber(openingCash);
  const safeGrossRevenue = toMoneyNumber(grossRevenue);
  const safeMomo = toMoneyNumber(momo);
  const safeGrab = toMoneyNumber(grab);
  const safeShopee = toMoneyNumber(shopee);
  const safeDiscount = toMoneyNumber(discount);
  const safeExpenses = toMoneyNumber(expenses);
  const safeActualCash = toMoneyNumber(actualCash);
  const nonCash = safeMomo + safeGrab + safeShopee;
  const cashRevenue = safeGrossRevenue - nonCash - safeDiscount;
  const totalRevenue = safeGrossRevenue - safeDiscount;
  const expectedCash = safeOpeningCash + cashRevenue - safeExpenses;

  return {
    nonCash,
    cashRevenue,
    grossRevenue: safeGrossRevenue,
    totalRevenue,
    expectedCash,
    discrepancy: safeActualCash - expectedCash,
  };
};

const getShiftTotals = (shift = {}) => calculateShiftTotals({
  openingCash: shift.opening_cash,
  grossRevenue: shift.rev_cash,
  momo: shift.rev_momo,
  grab: shift.rev_grab,
  shopee: shift.rev_shopee,
  discount: shift.discount,
  expenses: shift.expenses,
  actualCash: shift.closing_cash_actual,
});

export default function ShiftScreen({ navigation }) {
  const { currentUser, staffList, shifts, setShifts, selectedStoreId, storeList, inventoryItems, setInventoryItems, inventoryLogs, setInventoryLogs, payrollAdjustments, setPayrollAdjustments, COLORS, isDarkMode, isDataLoading, refreshData } = useContext(AppContext);
  const styles = useMemo(() => getStyles(COLORS, isDarkMode), [COLORS, isDarkMode]);

  const formatMoneyInput = (val) => {
    if (!val) return '';
    // Allow digits and basic operators +, -, *, /
    const sanitized = String(val).replace(/[^\d+\-*/]/g, '');

    // Split by operators, format each chunk, then join back
    return sanitized.replace(/\d+/g, (match) => {
      return match.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
    });
  };

  const setMoneyValue = (setter) => (value) => setter(formatMoneyInput(value));

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

  const [activeTab, setActiveTab] = useState('INVENTORY');
  const [selectedShiftForDetail, setSelectedShiftForDetail] = useState(null);
  const [historyPeriod, setHistoryPeriod] = useState('all');
  const [historyRange, setHistoryRange] = useState({ start: null, end: null });
  const [showHistoryDateModal, setShowHistoryDateModal] = useState(false);
  const currentOpenShift = shifts.find(s => s.status === 'OPEN' && s.store_id === storeIdToView);

  // === Má»ž CA ===
  const [openingCash, setOpeningCash] = useState('');
  const handleOpenShift = async (periodName) => {
    if (storeIdToView === 'ALL') { alert('Vui lÃ²ng chá»n 1 chi nhÃ¡nh!'); return; }
    if (!openingCash) { alert('Nháº­p tiá»n Ä‘áº§u ca!'); return; }
    const newShift = {
      id: `shift_${Date.now()}`, store_id: storeIdToView,
      opened_by: currentUser.id, opened_by_name: currentUser.name,
      opened_at: new Date().toLocaleDateString('vi-VN') + ` (${periodName}) ` + new Date().toLocaleTimeString('vi-VN', {hour: '2-digit', minute:'2-digit'}),
      opening_cash: parseMoneyInput(openingCash), status: 'OPEN',
      rev_cash: 0, rev_momo: 0, rev_grab: 0, rev_shopee: 0, discount: 0, expenses: 0, expenses_note: '', closing_cash_actual: 0, discrepancy: 0,
      inventory_check: []
    };
    await supabase.from('shifts').insert([newShift]);
    setShifts([...shifts, newShift]);
    alert(`Má»Ÿ ${periodName} thÃ nh cÃ´ng!`);
  };

  // === CHá»T CA (MáºªU 16) ===
  const [inventoryCheck, setInventoryCheck] = useState({}); // { itemId: endStock }
  const [revCash, setRevCash] = useState('');
  const [revMomo, setRevMomo] = useState('');
  const [revGrab, setRevGrab] = useState('');
  const [revShopee, setRevShopee] = useState('');
  const [discount, setDiscount] = useState('');
  const [expenses, setExpenses] = useState('');
  const [expensesNote, setExpensesNote] = useState('');
  const [actualCash, setActualCash] = useState('');
  const [reportImages, setReportImages] = useState([]);
  const [isUploading, setIsUploading] = useState(false);
  const [ochaRevenue, setOchaRevenue] = useState(null);
  const [isLoadingOcha, setIsLoadingOcha] = useState(false);
  const [detailReportImageUrls, setDetailReportImageUrls] = useState([]);
  const [isResolvingReportImage, setIsResolvingReportImage] = useState(false);
  const [reportImageLoadState, setReportImageLoadState] = useState({});
  const [calculatorTarget, setCalculatorTarget] = useState(null);
  const [calculatorExpression, setCalculatorExpression] = useState('');

  const CACHE_KEY = `SHIFT_DRAFT_${storeIdToView}`;
  const ochaDateKey = getLocalDateKey();
  const todayStr = new Date().toLocaleDateString('vi-VN');

  const getReportImagePath = (value) => {
    if (!value) return null;
    const text = String(value);
    if (!/^https?:\/\//i.test(text)) return text;
    const marker = '/shift_reports/';
    const markerIndex = text.indexOf(marker);
    if (markerIndex >= 0) {
      return decodeURIComponent(text.slice(markerIndex + marker.length).split('?')[0]);
    }
    const publicMarker = '/object/public/shift_reports/';
    const publicIndex = text.indexOf(publicMarker);
    if (publicIndex >= 0) {
      return decodeURIComponent(text.slice(publicIndex + publicMarker.length).split('?')[0]);
    }
    return null;
  };

  const resolveReportImageUrl = async (value) => {
    if (!value) return null;
    const text = String(value);
    const fallbackUrl = /^https?:\/\//i.test(text) ? text : null;
    if (fallbackUrl && fallbackUrl.includes('/object/public/shift_reports/')) return fallbackUrl;
    const path = getReportImagePath(value);
    if (!path) return fallbackUrl;
    const { data: publicData } = supabase.storage
      .from('shift_reports')
      .getPublicUrl(path);
    const publicUrl = publicData?.publicUrl || fallbackUrl;
    if (publicUrl) return publicUrl;

    const { data, error } = await supabase.storage
      .from('shift_reports')
      .createSignedUrl(path, 60 * 60);

    if (error) {
      console.log('Cannot create signed report image URL:', error.message);
      return publicUrl;
    }

    return data?.signedUrl || publicUrl;
  };

  const parseReportImages = (value) => {
    if (!value) return [];
    if (Array.isArray(value)) return value.filter(Boolean);
    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (!trimmed) return [];
      if (trimmed.startsWith('[')) {
        try {
          const parsed = JSON.parse(trimmed);
          return Array.isArray(parsed) ? parsed.filter(Boolean) : [];
        } catch (error) {
          console.log('Cannot parse report images JSON:', error?.message || error);
        }
      }
      return [trimmed];
    }
    return [];
  };

  const encodeReportImages = (urls) => {
    const safeUrls = (urls || []).filter(Boolean);
    if (safeUrls.length === 0) return null;
    if (safeUrls.length === 1) return safeUrls[0];
    return JSON.stringify(safeUrls);
  };

  const openReportImageExternally = async (url) => {
    if (!url) {
      Alert.alert('ChÆ°a cÃ³ áº£nh', 'App chÆ°a láº¥y Ä‘Æ°á»£c link áº£nh bÃ¡o cÃ¡o Ä‘á»ƒ má»Ÿ.');
      return;
    }
    try {
      await Linking.openURL(url);
    } catch (error) {
      Alert.alert('KhÃ´ng má»Ÿ Ä‘Æ°á»£c áº£nh', error?.message || 'Vui lÃ²ng thá»­ láº¡i sau.');
    }
  };

  // Load cache on mount or store change
  useEffect(() => {
    const loadCache = async () => {
      try {
        const cached = await AsyncStorage.getItem(CACHE_KEY);
        if (cached) {
          const data = JSON.parse(cached);
          if (data.inventoryCheck) setInventoryCheck(data.inventoryCheck);
          if (data.revCash !== undefined) setRevCash(formatMoneyInput(data.revCash));
          if (data.revMomo !== undefined) setRevMomo(formatMoneyInput(data.revMomo));
          if (data.revGrab !== undefined) setRevGrab(formatMoneyInput(data.revGrab));
          if (data.revShopee !== undefined) setRevShopee(formatMoneyInput(data.revShopee));
          if (data.discount !== undefined) setDiscount(formatMoneyInput(data.discount));
          if (data.expenses !== undefined) setExpenses(formatMoneyInput(data.expenses));
          if (data.expensesNote !== undefined) setExpensesNote(data.expensesNote);
          if (data.actualCash !== undefined) setActualCash(formatMoneyInput(data.actualCash));
        } else if (currentOpenShift) {
          // Fallback to database values if no cache
          const initInv = {};
          (currentOpenShift.inventory_check || []).forEach(ic => {
            initInv[ic.item_id] = String(ic.end);
          });
          setInventoryCheck(initInv);
          setRevCash(currentOpenShift.rev_cash ? formatMoneyInput(currentOpenShift.rev_cash) : '');
          setRevMomo(currentOpenShift.rev_momo ? formatMoneyInput(currentOpenShift.rev_momo) : '');
          setRevGrab(currentOpenShift.rev_grab ? formatMoneyInput(currentOpenShift.rev_grab) : '');
          setRevShopee(currentOpenShift.rev_shopee ? formatMoneyInput(currentOpenShift.rev_shopee) : '');
          setDiscount(currentOpenShift.discount ? formatMoneyInput(currentOpenShift.discount) : '');
          setExpenses(currentOpenShift.expenses ? formatMoneyInput(currentOpenShift.expenses) : '');
          setExpensesNote(currentOpenShift.expenses_note || '');
          setActualCash(currentOpenShift.closing_cash_actual ? formatMoneyInput(currentOpenShift.closing_cash_actual) : '');
        } else {
          setInventoryCheck({}); setRevCash(''); setRevMomo(''); setRevGrab(''); setRevShopee(''); setDiscount(''); setExpenses(''); setExpensesNote(''); setActualCash('');
        }
      } catch(e) {
        console.log('Error loading cache', e);
      }
    };
    if (storeIdToView && storeIdToView !== 'ALL') {
      loadCache();
    }
  }, [storeIdToView, currentOpenShift?.id]);

  // Save cache on data change
  useEffect(() => {
    if (!storeIdToView || storeIdToView === 'ALL') return;
    const saveCache = async () => {
      const data = {
        inventoryCheck, revCash, revMomo, revGrab, revShopee, discount, expenses, expensesNote, actualCash
      };
      try {
        await AsyncStorage.setItem(CACHE_KEY, JSON.stringify(data));
      } catch(e) {
        console.log('Error saving cache', e);
      }
    };
    const timeoutId = setTimeout(saveCache, 500);
    return () => clearTimeout(timeoutId);
  }, [inventoryCheck, revCash, revMomo, revGrab, revShopee, discount, expenses, expensesNote, actualCash, storeIdToView]);

  useEffect(() => {
    if (!storeIdToView || storeIdToView === 'ALL') {
      setOchaRevenue(null);
      return;
    }

    let isMounted = true;
    const fetchOchaRevenue = async () => {
      try {
        setIsLoadingOcha(true);
        const rows = await getDailyRevenue(storeIdToView, ochaDateKey, ochaDateKey);
        if (!isMounted) return;
        const row = (rows || []).find((item) => String(item.store_id) === String(storeIdToView) && item.date === ochaDateKey);
        setOchaRevenue(row || null);
      } catch (error) {
        console.log('Error loading Ocha revenue for shift:', error);
        if (isMounted) setOchaRevenue(null);
      } finally {
        if (isMounted) setIsLoadingOcha(false);
      }
    };

    fetchOchaRevenue();
    return () => { isMounted = false; };
  }, [storeIdToView, ochaDateKey]);

  useEffect(() => {
    let isMounted = true;
    const loadReportImage = async () => {
      const imageValues = parseReportImages(selectedShiftForDetail?.report_image);
      setReportImageLoadState({});
      if (imageValues.length === 0) {
        setDetailReportImageUrls([]);
        return;
      }

      try {
        setIsResolvingReportImage(true);
        const urls = (await Promise.all(imageValues.map(resolveReportImageUrl))).filter(Boolean);
        if (isMounted) setDetailReportImageUrls(urls);
      } catch (error) {
        console.log('Error resolving report image:', error);
        if (isMounted) {
          setDetailReportImageUrls(imageValues.filter((imageValue) => /^https?:\/\//i.test(String(imageValue))));
        }
      } finally {
        if (isMounted) setIsResolvingReportImage(false);
      }
    };

    loadReportImage();
    return () => { isMounted = false; };
  }, [selectedShiftForDetail?.report_image]);

  const ochaAmount = Number(ochaRevenue?.total_amount || ochaRevenue?.amount || 0);
  const manualCash = parseMoneyInput(revCash);
  const manualMomo = parseMoneyInput(revMomo);
  const manualGrab = parseMoneyInput(revGrab);
  const manualShopee = parseMoneyInput(revShopee);
  const manualDiscount = parseMoneyInput(discount);
  const manualExpenses = parseMoneyInput(expenses);
  const manualActualCash = parseMoneyInput(actualCash);
  const sourceRevenue = ochaAmount > 0 ? ochaAmount : manualCash;
  const currentTotals = calculateShiftTotals({
    openingCash: currentOpenShift?.opening_cash,
    grossRevenue: sourceRevenue,
    momo: manualMomo,
    grab: manualGrab,
    shopee: manualShopee,
    discount: manualDiscount,
    expenses: manualExpenses,
    actualCash: manualActualCash,
  });
  const currentExpectedCash = currentOpenShift ? currentTotals.expectedCash : 0;
  const currentCashDiff = currentOpenShift ? currentTotals.discrepancy : 0;
  const formatCurrency = (value) => `${Math.round(Number(value) || 0).toLocaleString('vi-VN')}Ä‘`;
  const ochaUpdatedAt = ochaRevenue?.updated_at
    || ochaRevenue?.updatedAt
    || ochaRevenue?.synced_at
    || ochaRevenue?.syncedAt
    || ochaRevenue?.last_synced_at
    || ochaRevenue?.last_updated_at
    || ochaRevenue?.imported_at
    || ochaRevenue?.created_at
    || ochaRevenue?.createdAt;
  const formatOchaSyncTime = (value) => {
    if (!value) return 'ChÆ°a cÃ³ giá» cáº­p nháº­t';
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return String(value);
    return parsed.toLocaleString('vi-VN', {
      hour: '2-digit',
      minute: '2-digit',
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    });
  };
  const ochaSyncLabel = formatOchaSyncTime(ochaUpdatedAt);
  const padDatePart = (value) => String(value).padStart(2, '0');
  const toDateKey = (date = new Date()) => {
    const local = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    return `${local.getFullYear()}-${padDatePart(local.getMonth() + 1)}-${padDatePart(local.getDate())}`;
  };
  const formatDateKey = (dateKey) => {
    if (!dateKey) return '';
    const [year, month, day] = String(dateKey).split('-');
    return `${day}/${month}/${year}`;
  };
  const parseViDateKey = (value) => {
    if (!value) return null;
    const text = String(value);
    const isoMatch = text.match(/(\d{4})-(\d{2})-(\d{2})/);
    if (isoMatch) return `${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}`;
    const viMatch = text.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
    if (!viMatch) return null;
    return `${viMatch[3]}-${padDatePart(viMatch[2])}-${padDatePart(viMatch[1])}`;
  };
  const getShiftSubmittedDateKey = (shift) => parseViDateKey(shift?.closed_at) || parseViDateKey(shift?.opened_at);
  const getShiftSortTime = (shift) => {
    const dateKey = getShiftSubmittedDateKey(shift);
    const idTime = Number(String(shift?.id || '').replace(/\D/g, '')) || 0;
    if (!dateKey) return idTime;
    const timeMatch = String(shift?.closed_at || shift?.opened_at || '').match(/(\d{1,2}):(\d{2})/);
    const hour = Number(timeMatch?.[1] || 0);
    const minute = Number(timeMatch?.[2] || 0);
    return new Date(`${dateKey}T${padDatePart(hour)}:${padDatePart(minute)}:00`).getTime() || idTime;
  };
  const getHistoryRangeForPeriod = (period = historyPeriod, range = historyRange) => {
    const now = new Date();
    if (period === 'today') {
      const key = toDateKey(now);
      return { start: key, end: key };
    }
    if (period === 'yesterday') {
      const d = new Date(now);
      d.setDate(now.getDate() - 1);
      const key = toDateKey(d);
      return { start: key, end: key };
    }
    if (period === 'month') {
      return { start: toDateKey(new Date(now.getFullYear(), now.getMonth(), 1)), end: toDateKey(now) };
    }
    if (period === 'lastMonth') {
      return {
        start: toDateKey(new Date(now.getFullYear(), now.getMonth() - 1, 1)),
        end: toDateKey(new Date(now.getFullYear(), now.getMonth(), 0)),
      };
    }
    if (period === 'custom') return range;
    return { start: null, end: null };
  };
  const filterAndSortShiftReports = (rows) => {
    const { start, end } = getHistoryRangeForPeriod();
    return [...rows]
      .filter((shift) => {
        if (!start || !end) return true;
        const dateKey = getShiftSubmittedDateKey(shift);
        return dateKey && dateKey >= start && dateKey <= end;
      })
      .sort((a, b) => getShiftSortTime(b) - getShiftSortTime(a));
  };
  const historyPeriodLabel = () => {
    if (historyPeriod === 'custom') {
      return `${formatDateKey(historyRange.start) || '...'} â†’ ${formatDateKey(historyRange.end) || '...'}`;
    }
    return {
      all: 'Táº¥t cáº£',
      today: 'HÃ´m nay',
      yesterday: 'HÃ´m qua',
      month: 'ThÃ¡ng nÃ y',
      lastMonth: 'ThÃ¡ng trÆ°á»›c',
    }[historyPeriod] || 'Táº¥t cáº£';
  };
  const applyHistoryRange = (start, end) => {
    setHistoryRange({ start, end });
    setHistoryPeriod('custom');
    setShowHistoryDateModal(false);
  };
  const formatQuantity = (value) => Number(value || 0).toLocaleString('vi-VN', {
    maximumFractionDigits: 2,
  });
  const getShiftInventoryLogId = (shiftId, itemId) => `log_shift_${shiftId}_${itemId}_stock_count`;
  const getInventoryStock = useCallback((itemId, storeId, excludedShiftId = currentOpenShift?.id) => {
    const excludedLogId = excludedShiftId ? getShiftInventoryLogId(excludedShiftId, itemId) : null;
    return Number(inventoryLogs
      .filter((log) => (
        String(log.itemId ?? log.itemid ?? log.item_id) === String(itemId)
        && String(log.store_id) === String(storeId)
        && String(log.id) !== String(excludedLogId)
      ))
      .reduce((total, log) => {
        const amount = Number(log.amount || 0);
        if (log.type === 'IMPORT' || log.type === 'ADJUST_UP') return total + amount;
        if (log.type === 'EXPORT' || log.type === 'ADJUST_DOWN') return total - amount;
        return total;
      }, 0)
      .toFixed(2));
  }, [inventoryLogs, currentOpenShift?.id]);
  const storeInventoryWithStock = useMemo(() => (
    inventoryItems
      .filter(i => i.store_id === storeIdToView)
      .map((item) => ({
        ...item,
        currentStock: getInventoryStock(item.id, item.store_id),
      }))
  ), [inventoryItems, storeIdToView, getInventoryStock]);
  const buildFinalInventoryCheck = () => storeInventoryWithStock.map((item) => {
    const rawEnd = inventoryCheck[item.id];
    const hasInput = rawEnd !== undefined && String(rawEnd).trim() !== '';
    const endStock = hasInput ? Number(String(rawEnd).replace(',', '.')) : Number(item.currentStock || 0);
    return {
      item_id: item.id,
      name: item.name,
      unit: item.unit,
      start: Number(item.currentStock || 0),
      end: Number.isFinite(endStock) ? endStock : Number(item.currentStock || 0),
    };
  });
  const syncInventoryCountLogs = async (finalInvCheck, shift = currentOpenShift) => {
    if (!shift?.id || !finalInvCheck?.length) return [];

    const nowIso = new Date().toISOString();
    const adjustmentLogs = [];
    const allLogIds = finalInvCheck.map((inv) => getShiftInventoryLogId(shift.id, inv.item_id));

    for (const inv of finalInvCheck) {
      const startStock = Number(inv.start || 0);
      const endStock = Number(inv.end || 0);
      const diff = Number((endStock - startStock).toFixed(2));
      if (diff === 0) continue;

      const logId = getShiftInventoryLogId(shift.id, inv.item_id);
      adjustmentLogs.push({
        id: logId,
        itemid: inv.item_id,
        type: diff > 0 ? 'ADJUST_UP' : 'ADJUST_DOWN',
        amount: Math.abs(diff),
        date: nowIso,
        store_id: shift.store_id,
        created_by: currentUser?.id,
        approved_by: currentUser?.id,
        note: `Kiá»ƒm kho bÃ¡o cÃ¡o ca ${shift.opened_at || shift.id} bá»Ÿi ${currentUser?.name || 'NhÃ¢n viÃªn'}: ${formatQuantity(startStock)} â†’ ${formatQuantity(endStock)} ${inv.unit || ''}`,
      });
    }

    const { error: deleteError } = await supabase.from('inventory_logs').delete().in('id', allLogIds);
    if (deleteError) throw deleteError;
    if (adjustmentLogs.length > 0) {
      const { error } = await supabase.from('inventory_logs').insert(adjustmentLogs);
      if (error) throw error;
    }

    setInventoryLogs?.((current = []) => {
      const filtered = current.filter((log) => !allLogIds.includes(log.id));
      const normalized = adjustmentLogs.map((log) => ({
        ...log,
        itemId: log.itemid,
      }));
      return [...filtered, ...normalized];
    });

    return adjustmentLogs;
  };
  const handleSaveInventory = async () => {
    try {
      const finalInvCheck = buildFinalInventoryCheck();

      const updatedShift = {
        ...currentOpenShift,
        inventory_check: finalInvCheck
      };

      // Update to Supabase
      const { error } = await supabase.from('shifts').update({ inventory_check: finalInvCheck }).eq('id', currentOpenShift.id);
      if (error) {
        Alert.alert('Lá»—i máº¡ng', 'KhÃ´ng thá»ƒ lÆ°u lÃªn mÃ¡y chá»§: ' + error.message);
        return;
      }

      // Update global shifts
      setShifts(shifts.map(s => s.id === currentOpenShift.id ? updatedShift : s));

      await syncInventoryCountLogs(finalInvCheck, currentOpenShift);

      // Keep item.quantity roughly in sync for older screens/data exports. Main stock source is inventory_logs.
      const updatedInventoryItems = inventoryItems.map(item => {
        const counted = finalInvCheck.find((inv) => String(inv.item_id) === String(item.id));
        if (item.store_id === storeIdToView && counted) {
          return { ...item, quantity: Number(counted.end || 0) };
        }
        return item;
      });
      setInventoryItems(updatedInventoryItems);

      Alert.alert('ThÃ nh cÃ´ng', 'ÄÃ£ lÆ°u phiáº¿u kiá»ƒm kho vÃ  cáº­p nháº­t log kho!');
    } catch(e) {
      Alert.alert('Lá»—i á»©ng dá»¥ng', 'Chi tiáº¿t: ' + e.message);
    }
  };

  const handlePickImage = async (useCamera) => {
    try {
      let result;
      const compatibleImageOptions = {
        allowsEditing: false,
        quality: 0.35,
        mediaTypes: ['images'],
        preferredAssetRepresentationMode: ImagePicker.UIImagePickerPreferredAssetRepresentationMode?.Compatible,
      };
      if (useCamera) {
        const { status } = await ImagePicker.requestCameraPermissionsAsync();
        if (status !== 'granted') return Alert.alert('Lá»—i', 'Cáº§n quyá»n truy cáº­p camera Ä‘á»ƒ chá»¥p áº£nh.');
        result = await ImagePicker.launchCameraAsync(compatibleImageOptions);
      } else {
        const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (status !== 'granted') return Alert.alert('Lá»—i', 'Cáº§n quyá»n truy cáº­p thÆ° viá»‡n áº£nh.');
        result = await ImagePicker.launchImageLibraryAsync({
          ...compatibleImageOptions,
          allowsMultipleSelection: true,
          selectionLimit: 6,
          orderedSelection: true,
        });
      }
      
      if (!result.canceled && result.assets && result.assets.length > 0) {
        const newUris = result.assets.map((asset) => asset.uri).filter(Boolean);
        setReportImages((prev) => {
          const merged = [...prev, ...newUris].filter((uri, index, arr) => arr.indexOf(uri) === index);
          if (merged.length > 6) {
            Alert.alert('Giá»›i háº¡n áº£nh', 'Má»—i phiáº¿u chá»‘t ca nÃªn tá»‘i Ä‘a 6 áº£nh Ä‘á»ƒ trÃ¡nh Ä‘áº§y dung lÆ°á»£ng.');
          }
          return merged.slice(0, 6);
        });
      }
    } catch(e) {
      Alert.alert('Lá»—i', 'KhÃ´ng thá»ƒ chá»n áº£nh: ' + e.message);
    }
  };

  const readImageAsArrayBuffer = async (uri) => {
    try {
      const response = await fetch(uri);
      const arrayBuffer = await response.arrayBuffer();
      if (arrayBuffer?.byteLength > 0) return arrayBuffer;
    } catch (error) {
      console.log('Fetch image as ArrayBuffer failed, trying XHR:', error?.message || error);
    }

    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.onload = () => {
        const reader = new FileReader();
        reader.onloadend = () => {
          if (reader.result && reader.result.byteLength > 0) {
            resolve(reader.result);
          } else {
            reject(new Error('áº¢nh Ä‘á»c Ä‘Æ°á»£c nhÆ°ng dung lÆ°á»£ng báº±ng 0 byte.'));
          }
        };
        reader.onerror = () => reject(new Error('KhÃ´ng thá»ƒ Ä‘á»c dá»¯ liá»‡u áº£nh.'));
        reader.readAsArrayBuffer(xhr.response);
      };
      xhr.onerror = () => reject(new Error('KhÃ´ng thá»ƒ má»Ÿ file áº£nh trÃªn thiáº¿t bá»‹.'));
      xhr.responseType = 'blob';
      xhr.open('GET', uri, true);
      xhr.send(null);
    });
  };

  const uploadReportImage = async (uri) => {
    try {
      const imageBuffer = await readImageAsArrayBuffer(uri);
      if (!imageBuffer?.byteLength) {
        throw new Error('áº¢nh Ä‘ang bá»‹ rá»—ng 0 byte, vui lÃ²ng chá»¥p/chá»n láº¡i áº£nh.');
      }

      const uriWithoutQuery = String(uri).split('?')[0];
      const rawExt = uriWithoutQuery.includes('.') ? uriWithoutQuery.split('.').pop() : 'jpg';
      const normalizedExt = String(rawExt).toLowerCase();
      if (['heic', 'heif'].includes(normalizedExt)) {
        throw new Error('áº¢nh HEIC cá»§a iPhone chÆ°a upload Ä‘Æ°á»£c. App Ä‘Ã£ chuyá»ƒn sang cháº¿ Ä‘á»™ láº¥y áº£nh JPG; vui lÃ²ng chá»n/chá»¥p láº¡i áº£nh sau khi cáº­p nháº­t.');
      }
      const fileExt = ['jpg', 'jpeg', 'png', 'webp'].includes(normalizedExt) ? normalizedExt : 'jpg';
      const contentType = fileExt === 'png'
        ? 'image/png'
        : fileExt === 'webp'
          ? 'image/webp'
          : 'image/jpeg';
      const fileName = `${Date.now()}_${Math.floor(Math.random()*1000)}.${fileExt}`;
      const filePath = `${storeIdToView}/${fileName}`;

      const { error } = await supabase.storage.from('shift_reports').upload(filePath, imageBuffer, {
        contentType,
      });
      if (error) throw error;

      const { data } = supabase.storage.from('shift_reports').getPublicUrl(filePath);
      return data?.publicUrl || filePath;
    } catch (error) {
      console.log('Error uploading image:', error);
      throw error;
    }
  };

  const handleCloseShift = () => {
    const aCashStr = String(actualCash).trim();
    if (aCashStr === '') {
      Alert.alert('Lá»—i', 'Vui lÃ²ng Ä‘áº¿m kÃ©t vÃ  nháº­p "TIá»€N TRONG KÃ‰T THá»°C Äáº¾M" (nháº­p 0 náº¿u kÃ©t trá»‘ng)!');
      return;
    }

    const rCash = ochaAmount > 0 ? ochaAmount : parseMoneyInput(revCash);
    const rMomo = parseMoneyInput(revMomo);
    const rGrab = parseMoneyInput(revGrab);
    const rShopee = parseMoneyInput(revShopee);
    const disc = parseMoneyInput(discount);
    const exp = parseMoneyInput(expenses);
    const aCash = parseMoneyInput(actualCash);

    const closeTotals = calculateShiftTotals({
      openingCash: currentOpenShift.opening_cash,
      grossRevenue: rCash,
      momo: rMomo,
      grab: rGrab,
      shopee: rShopee,
      discount: disc,
      expenses: exp,
      actualCash: aCash,
    });
    const expectedCash = closeTotals.expectedCash;
    const discrepancy = closeTotals.discrepancy;
    const hasWarning = discrepancy !== 0;

    const confirmMessage = hasWarning
      ? `âš ï¸ KÃ©t Ä‘ang lá»‡ch, cáº§n kiá»ƒm tra láº¡i trÆ°á»›c khi ná»™p\n\nTiá»n Ä‘áº§u giá» (1): ${formatCurrency(currentOpenShift.opening_cash)}\nDoanh thu Ocha/tá»•ng (3): ${formatCurrency(closeTotals.grossRevenue)}\nOnline: -${formatCurrency(closeTotals.nonCash)}\nGiáº£m bill (4): -${formatCurrency(disc)}\nTiá»n chi (5): -${formatCurrency(exp)}\n\nKÃ©t pháº£i cÃ³: ${formatCurrency(expectedCash)}\nKÃ©t thá»±c Ä‘áº¿m (2): ${formatCurrency(aCash)}\nLá»‡ch kÃ©t: ${formatCurrency(discrepancy)}\n\nBáº¡n váº«n muá»‘n ná»™p bÃ¡o cÃ¡o khÃ´ng?`
      : `Doanh thu vÃ  kÃ©t Ä‘ang khá»›p.\n\nKÃ©t pháº£i cÃ³: ${formatCurrency(expectedCash)}\nKÃ©t thá»±c Ä‘áº¿m (2): ${formatCurrency(aCash)}\n\nBáº¡n cÃ³ cháº¯c cháº¯n muá»‘n ná»™p bÃ¡o cÃ¡o doanh thu vÃ  chá»‘t kÃ©t khÃ´ng?`;

    Alert.alert(
      'XÃ¡c nháº­n Chá»‘t KÃ©t',
      confirmMessage,
      [
        { text: 'Há»§y', style: 'cancel' },
        { text: 'Chá»‘t', style: 'destructive', onPress: async () => {
            try {
              setIsUploading(true);
              let imageUrl = null;
              if (reportImages.length > 0) {
                const uploadedUrls = await Promise.all(reportImages.map(uploadReportImage));
                imageUrl = encodeReportImages(uploadedUrls);
              }

              const finalInvCheck = buildFinalInventoryCheck();

              const updatedShift = {
                ...currentOpenShift,
                status: 'PENDING_APPROVAL',
                closed_by: currentUser.id, closed_by_name: currentUser.name,
                closed_at: todayStr + ' ' + new Date().toLocaleTimeString('vi-VN', {hour: '2-digit', minute:'2-digit'}),
                rev_cash: rCash, rev_momo: rMomo, rev_grab: rGrab, rev_shopee: rShopee,
                discount: disc, expenses: exp, expenses_note: expensesNote,
                closing_cash_actual: aCash, discrepancy: discrepancy,
                inventory_check: finalInvCheck,
                report_image: imageUrl
              };

              const { error } = await supabase.from('shifts').update(updatedShift).eq('id', currentOpenShift.id);
              if (error) {
                Alert.alert('Lá»—i máº¡ng', 'KhÃ´ng thá»ƒ lÆ°u dá»¯ liá»‡u: ' + error.message);
                return;
              }

              await syncInventoryCountLogs(finalInvCheck, currentOpenShift);

              setShifts(shifts.map(s => s.id === currentOpenShift.id ? updatedShift : s));

              Alert.alert('ThÃ nh cÃ´ng', 'ÄÃ£ ná»™p BÃ¡o CÃ¡o Doanh Thu (Chá»‘t Ca)!');
              setRevCash(''); setRevMomo(''); setRevGrab(''); setRevShopee(''); setDiscount(''); setExpenses(''); setExpensesNote(''); setActualCash(''); setInventoryCheck({}); setReportImages([]);
              setIsUploading(false);
              try { await AsyncStorage.removeItem(CACHE_KEY); } catch(e){}
            } catch(e) {
              setIsUploading(false);
              const message = e?.message || 'KhÃ´ng thá»ƒ ná»™p bÃ¡o cÃ¡o.';
              Alert.alert(message.includes('HEIC') ? 'áº¢nh chÆ°a Ä‘Ãºng Ä‘á»‹nh dáº¡ng' : 'Lá»—i ná»™p bÃ¡o cÃ¡o', message);
            }
          }
        }
      ]
    );
  };

  const historyShifts = filterAndSortShiftReports(
    shifts.filter(s => s.status === 'CLOSED' && (storeIdToView === 'ALL' || s.store_id === storeIdToView))
  );
  const pendingShifts = filterAndSortShiftReports(
    shifts.filter(s => s.status === 'PENDING_APPROVAL' && (storeIdToView === 'ALL' || s.store_id === storeIdToView))
  );

  const handleApproveShiftReport = async (shift) => {
    try {
      const nowStr = new Date().toLocaleTimeString('vi-VN', {hour: '2-digit', minute:'2-digit'}) + ' ' + new Date().toLocaleDateString('vi-VN');
      const approvedTotals = getShiftTotals(shift);
      const updateData = {
        status: 'CLOSED',
        approved_by_name: currentUser.name,
        approved_at: nowStr,
        discrepancy: approvedTotals.discrepancy,
      };
      const { error } = await supabase.from('shifts').update(updateData).eq('id', shift.id);
      if (error) throw error;
      setShifts(shifts.map(s => s.id === shift.id ? { ...s, ...updateData } : s));
      setSelectedShiftForDetail(null);
      
      // Kho Ä‘Ã£ Ä‘Æ°á»£c Ä‘á»“ng bá»™ khi nhÃ¢n viÃªn lÆ°u/ná»™p bÃ¡o cÃ¡o ca báº±ng log Ä‘iá»u chá»‰nh cá»‘ Ä‘á»‹nh theo ca.
      
      // Tá»± Ä‘á»™ng ghi log trá»« tiá»n náº¿u lá»‡ch kÃ©t Ã¢m
      if (approvedTotals.discrepancy < 0 && shift.closed_by) {
        try {
          const dateParts = shift.opened_at.split(' ')[0].split('/'); // [DD, MM, YYYY]
          if (dateParts.length === 3) {
            const isoMonth = `${dateParts[2]}-${String(dateParts[1]).padStart(2, '0')}`;
            const penaltyId = `adj_${shift.id}`;
            const newAdj = {
              id: penaltyId,
              user_id: shift.closed_by,
              month: isoMonth,
              bonus_hours: 0,
              bonus_money: 0,
              penalty_money: Math.abs(approvedTotals.discrepancy),
              note: `Há»‡ thá»‘ng tá»± trá»« tiá»n do lá»‡ch kÃ©t Ã¢m ${Math.abs(approvedTotals.discrepancy).toLocaleString('vi-VN')}Ä‘ (ca ${shift.opened_at.split(' ')[0]})`
            };
            await supabase.from('payroll_adjustments').upsert([newAdj]);
            
            if (setPayrollAdjustments) {
              setPayrollAdjustments(prev => {
                const current = prev || [];
                const filtered = current.filter(a => a.id !== penaltyId);
                return [...filtered, newAdj];
              });
            }
          }
        } catch (err) {
          console.log('Lá»—i auto log penalty:', err);
        }
      }

      alert('ÄÃ£ duyá»‡t chá»‘t ca thÃ nh cÃ´ng!');

      // Notify the person who closed the shift
      if (shift.closed_by) {
        const targetStaff = staffList.find(s => s.id === shift.closed_by);
        if (targetStaff) {
          sendPushNotification(targetStaff.push_token, 'Duyá»‡t chá»‘t ca', `Quáº£n lÃ½ Ä‘Ã£ duyá»‡t bÃ¡o cÃ¡o chá»‘t ca ngÃ y ${shift.opened_at.split(' ')[0]} cá»§a báº¡n.`, {}, targetStaff.id);
        }
      }
    } catch (e) {
      alert('Lá»—i: ' + e.message);
    }
  };

  const handleRecallShiftReport = async (shift) => {
    Alert.alert(
      'Thu há»“i bÃ¡o cÃ¡o',
      'Báº¡n cÃ³ cháº¯c cháº¯n muá»‘n thu há»“i bÃ¡o cÃ¡o chá»‘t ca nÃ y Ä‘á»ƒ chá»‰nh sá»­a láº¡i khÃ´ng?',
      [
        { text: 'Há»§y', style: 'cancel' },
        { 
          text: 'Thu há»“i', 
          style: 'destructive',
          onPress: async () => {
            try {
              const updateData = { 
                status: 'OPEN',
                closed_at: null,
                closed_by: null,
                closed_by_name: null
              };
              const { error } = await supabase.from('shifts').update(updateData).eq('id', shift.id);
              if (error) throw error;
              setShifts(shifts.map(s => s.id === shift.id ? { ...s, ...updateData } : s));
              setSelectedShiftForDetail(null);
              alert('ÄÃ£ thu há»“i bÃ¡o cÃ¡o thÃ nh cÃ´ng. Báº¡n cÃ³ thá»ƒ chá»‰nh sá»­a láº¡i á»Ÿ má»¥c Kiá»ƒm Kho vÃ  Doanh Thu.');
            } catch (e) {
              alert('Lá»—i: ' + e.message);
            }
          }
        }
      ]
    );
  };

  const handleRejectShiftReport = async (shift) => {
    Alert.alert(
      'Tá»« chá»‘i bÃ¡o cÃ¡o',
      'Báº¡n cÃ³ cháº¯c cháº¯n muá»‘n Há»¦Y chá»‘t ca nÃ y vÃ  yÃªu cáº§u nhÃ¢n viÃªn lÃ m láº¡i khÃ´ng?',
      [
        { text: 'Bá» qua', style: 'cancel' },
        { 
          text: 'Tá»« chá»‘i', 
          style: 'destructive',
          onPress: async () => {
            try {
              const updateData = { 
                status: 'OPEN',
                closed_at: null,
                closed_by: null,
                closed_by_name: null
              };
              const { error } = await supabase.from('shifts').update(updateData).eq('id', shift.id);
              if (error) throw error;
              
              setShifts(shifts.map(s => s.id === shift.id ? { ...s, ...updateData } : s));
              setSelectedShiftForDetail(null);
              alert('ÄÃ£ tá»« chá»‘i bÃ¡o cÃ¡o vÃ  chuyá»ƒn láº¡i tráº¡ng thÃ¡i ÄANG Má»ž!');
              
              if (shift.closed_by) {
                const targetStaff = staffList.find(s => s.id === shift.closed_by);
                if (targetStaff) {
                  sendPushNotification(targetStaff.push_token, 'BÃ¡o cÃ¡o bá»‹ tá»« chá»‘i', `Quáº£n lÃ½ Ä‘Ã£ yÃªu cáº§u lÃ m láº¡i bÃ¡o cÃ¡o chá»‘t ca ngÃ y ${shift.opened_at.split(' ')[0]}.`, {}, targetStaff.id);
                }
              }
            } catch (e) {
              alert('Lá»—i: ' + e.message);
            }
          }
        }
      ]
    );
  };

  const handleUndoApproveShiftReport = async (shift) => {
    Alert.alert(
      'Há»§y duyá»‡t bÃ¡o cÃ¡o',
      'Báº¡n cÃ³ cháº¯c cháº¯n muá»‘n Há»¦Y DUYá»†T phiáº¿u chá»‘t ca nÃ y? BÃ¡o cÃ¡o sáº½ bá»‹ tráº£ vá» tráº¡ng thÃ¡i ÄANG Má»ž Ä‘á»ƒ nhÃ¢n viÃªn lÃ m láº¡i, vÃ  khoáº£n pháº¡t lá»‡ch kÃ©t (náº¿u cÃ³) sáº½ bá»‹ xÃ³a.',
      [
        { text: 'Bá» qua', style: 'cancel' },
        { 
          text: 'Há»§y duyá»‡t', 
          style: 'destructive',
          onPress: async () => {
            try {
              const updateData = { 
                status: 'OPEN',
                closed_at: null,
                closed_by: null,
                closed_by_name: null,
                approved_at: null,
                approved_by_name: null
              };
              const { error } = await supabase.from('shifts').update(updateData).eq('id', shift.id);
              if (error) throw error;
              
              const penaltyId = `adj_${shift.id}`;
              await supabase.from('payroll_adjustments').delete().eq('id', penaltyId);
              if (setPayrollAdjustments) {
                setPayrollAdjustments(prev => (prev || []).filter(a => a.id !== penaltyId));
              }

              setShifts(shifts.map(s => s.id === shift.id ? { ...s, ...updateData } : s));
              setSelectedShiftForDetail(null);
              alert('ÄÃ£ há»§y duyá»‡t! Phiáº¿u chá»‘t ca Ä‘Ã£ trá»Ÿ láº¡i tráº¡ng thÃ¡i ÄANG Má»ž.');
              
              if (shift.closed_by) {
                const targetStaff = staffList.find(s => s.id === shift.closed_by);
                if (targetStaff) {
                  sendPushNotification(targetStaff.push_token, 'BÃ¡o cÃ¡o bá»‹ há»§y duyá»‡t', `Quáº£n lÃ½ Ä‘Ã£ há»§y duyá»‡t bÃ¡o cÃ¡o chá»‘t ca ngÃ y ${shift.opened_at.split(' ')[0]} vÃ  yÃªu cáº§u lÃ m láº¡i.`, {}, targetStaff.id);
                }
              }
            } catch (e) {
              alert('Lá»—i: ' + e.message);
            }
          }
        }
      ]
    );
  };

  const openMoneyCalculator = (label, value, setter) => {
    setCalculatorTarget({ label, setter });
    setCalculatorExpression(String(value || '').replace(/[^\d+\-]/g, ''));
  };

  const closeMoneyCalculator = () => {
    setCalculatorTarget(null);
    setCalculatorExpression('');
  };

  const updateCalculatorExpression = (key) => {
    setCalculatorExpression((current) => {
      if (key === 'clear') return '';
      if (key === 'back') return current.slice(0, -1);
      if (key === '+' || key === '-') {
        if (!current) return '';
        return /[+\-]$/.test(current) ? `${current.slice(0, -1)}${key}` : `${current}${key}`;
      }
      return `${current}${key}`;
    });
  };

  const applyMoneyCalculator = () => {
    if (!calculatorTarget?.setter) return;
    const result = parseMoneyInput(calculatorExpression);
    calculatorTarget.setter(formatMoneyInput(result));
    closeMoneyCalculator();
  };

  const renderMoneyCalculator = () => {
    const previewValue = parseMoneyInput(calculatorExpression);
    const formattedExpression = formatMoneyInput(calculatorExpression) || '0';

    return (
      <Modal visible={Boolean(calculatorTarget)} transparent animationType="fade" onRequestClose={closeMoneyCalculator}>
        <View style={styles.calculatorOverlay}>
          <View style={styles.calculatorModal}>
            <View style={styles.calculatorHeader}>
              <View style={{ flex: 1 }}>
                <Text style={styles.calculatorTitle}>MÃ¡y tÃ­nh nhanh</Text>
                <Text style={styles.calculatorSubtitle} numberOfLines={1}>{calculatorTarget?.label}</Text>
              </View>
              <TouchableOpacity onPress={closeMoneyCalculator} style={styles.calculatorCloseBtn}>
                <Ionicons name="close" size={22} color={COLORS.text} />
              </TouchableOpacity>
            </View>

            <View style={styles.calculatorDisplay}>
              <Text style={styles.calculatorExpression} numberOfLines={1}>{formattedExpression}</Text>
              <Text style={styles.calculatorResult}>= {formatCurrency(previewValue)}</Text>
            </View>

            <View style={styles.calculatorGrid}>
              {['7', '8', '9', '+', '4', '5', '6', '-', '1', '2', '3', 'back', '0', '000', 'clear', 'apply'].map((key) => {
                const isApply = key === 'apply';
                const isAction = ['+', '-', 'back', 'clear'].includes(key);
                const label = key === 'back'
                  ? 'âŒ«'
                  : key === 'clear'
                    ? 'C'
                    : key === 'apply'
                      ? 'OK'
                      : key;

                return (
                  <TouchableOpacity
                    key={key}
                    style={[
                      styles.calculatorKey,
                      isAction && styles.calculatorActionKey,
                      isApply && styles.calculatorApplyKey,
                    ]}
                    onPress={() => (isApply ? applyMoneyCalculator() : updateCalculatorExpression(key))}
                  >
                    <Text style={[styles.calculatorKeyText, isApply && styles.calculatorApplyText]}>{label}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>
        </View>
      </Modal>
    );
  };

  const renderMoneyInput = (label, value, setter, isHighlight = false, placeholder = '0') => (
    <View style={styles.moneyInputGroup}>
      <Text style={[styles.label, isHighlight && {color: '#f44336'}]}>{label}</Text>
      <View style={styles.moneyInputRow}>
        <TextInput
          style={[styles.input, styles.moneyInputField, isHighlight && {borderColor: '#f44336', borderWidth: 2}]}
          keyboardType="numbers-and-punctuation"
          placeholder={placeholder}
          value={value}
          onChangeText={setMoneyValue(setter)}
        />
        <TouchableOpacity
          style={[styles.moneyCalculatorBtn, isHighlight && {borderColor: '#f44336'}]}
          onPress={() => openMoneyCalculator(label, value, setter)}
          accessibilityLabel={`Má»Ÿ mÃ¡y tÃ­nh cho ${label}`}
        >
          <Ionicons name="calculator-outline" size={20} color={isHighlight ? '#f44336' : COLORS.primary} />
        </TouchableOpacity>
      </View>
    </View>
  );

  const renderHistoryFilter = () => (
    <View style={styles.historyFilterCard}>
      <View style={styles.historyFilterHeader}>
        <View>
          <Text style={styles.historyFilterTitle}>Lá»c bÃ¡o cÃ¡o theo ngÃ y ná»™p</Text>
          <Text style={styles.historyFilterSubtitle}>Äang xem: {historyPeriodLabel()}</Text>
        </View>
        <TouchableOpacity style={styles.historyCalendarBtn} onPress={() => setShowHistoryDateModal(true)}>
          <Ionicons name="calendar-outline" size={18} color={COLORS.primary} />
          <Text style={styles.historyCalendarText}>TÃ¹y chá»n</Text>
        </TouchableOpacity>
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.historyQuickRow}>
        {[
          ['all', 'Táº¥t cáº£'],
          ['today', 'HÃ´m nay'],
          ['yesterday', 'HÃ´m qua'],
          ['month', 'ThÃ¡ng nÃ y'],
          ['lastMonth', 'ThÃ¡ng trÆ°á»›c'],
        ].map(([value, label]) => (
          <TouchableOpacity
            key={value}
            style={[styles.historyQuickBtn, historyPeriod === value && styles.historyQuickBtnActive]}
            onPress={() => setHistoryPeriod(value)}
          >
            <Text style={[styles.historyQuickText, historyPeriod === value && styles.historyQuickTextActive]}>{label}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>
    </View>
  );

  const renderHistoryTab = (data) => (
    <View style={{ paddingBottom: 80 }}>
      {renderHistoryFilter()}
      {data.length === 0 && (
        <View style={styles.emptyHistoryBox}>
          <Ionicons name="receipt-outline" size={42} color={COLORS.textMuted} />
          <Text style={styles.emptyHistoryText}>KhÃ´ng cÃ³ bÃ¡o cÃ¡o trong khoáº£ng thá»i gian nÃ y.</Text>
        </View>
      )}
      {data.map(item => {
        let dateStr = item.opened_at.split(' ')[0];
        let periodStr = item.opened_at.includes('SÃ¡ng') ? 'Ca SÃ¡ng' : (item.opened_at.includes('Chiá»u') ? 'Ca Chiá»u' : '');
        let openTimeStr = item.opened_at.split(' ').pop();
        let closeTimeStr = item.closed_at ? item.closed_at.split(' ').pop() : '';
        let submittedDateStr = getShiftSubmittedDateKey(item);
        const itemTotals = getShiftTotals(item);

        let isDiscrepancy = itemTotals.discrepancy !== 0;

        return (
          <TouchableOpacity key={item.id} style={[styles.historyCard, isDiscrepancy && {borderColor: '#f44336', borderWidth: 2}]} onPress={() => setSelectedShiftForDetail(item)}>
            <View style={{flexDirection: 'row', justifyContent: 'space-between', marginBottom: 10, borderBottomWidth: 1, borderBottomColor: '#eee', paddingBottom: 8}}>
              <Text style={{fontWeight: 'bold', fontSize: 16, color: isDiscrepancy ? '#f44336' : '#1976d2'}}>{dateStr} {periodStr ? `- ${periodStr}` : ''} {isDiscrepancy ? '(Lá»‡ch)' : ''}</Text>
              <Text style={{color: COLORS.text, fontWeight: 'bold'}}>{storeList.find(s=>s.id===item.store_id)?.name}</Text>
            </View>
            <Text style={styles.hText}>Má»Ÿ ca lÃºc: {openTimeStr} ({item.opened_by_name})</Text>
            <Text style={styles.hText}>Chá»‘t ca lÃºc: {closeTimeStr} ({item.closed_by_name})</Text>
            <Text style={styles.hText}>NgÃ y ná»™p: {formatDateKey(submittedDateStr)}</Text>
            <View style={{backgroundColor: '#f5f5f5', padding: 10, borderRadius: 8, marginTop: 10}}>
              <Text style={{fontWeight: 'bold'}}>DOANH THU OCHA/Tá»”NG: {formatCurrency(itemTotals.grossRevenue)}</Text>
              <Text style={styles.hText}>- Momo/Grab/Shopee: -{formatCurrency(itemTotals.nonCash)}</Text>
              <Text style={styles.hText}>- Giáº£m bill: -{formatCurrency(item.discount)}</Text>
              <Text style={styles.hText}>- Chi phÃ­: -{item.expenses.toLocaleString()}Ä‘ ({item.expenses_note || 'Trá»‘ng'})</Text>
              <View style={{height: 1, backgroundColor: '#ddd', marginVertical: 8}}/>
              <Text style={styles.hText}>Doanh thu tiá»n máº·t trong ca: {formatCurrency(itemTotals.cashRevenue)}</Text>
              <Text style={styles.hText}>Tiá»n Ä‘áº§u giá»: {item.opening_cash.toLocaleString()}Ä‘</Text>
              <Text style={styles.hText}>KÃ©t pháº£i cÃ³: {formatCurrency(itemTotals.expectedCash)}</Text>
              <Text style={styles.hText}>KÃ©t thá»±c Ä‘áº¿m: {item.closing_cash_actual.toLocaleString()}Ä‘</Text>
              <View style={{flexDirection: 'row', justifyContent: 'space-between', marginTop: 10, paddingTop: 10, borderTopWidth: 1, borderColor: COLORS.border}}>
                <Text style={{fontSize: 16, fontWeight: 'bold'}}>ChÃªnh Lá»‡ch:</Text>
                <Text style={{fontSize: 16, fontWeight: 'bold', color: itemTotals.discrepancy < 0 ? '#f44336' : (itemTotals.discrepancy > 0 ? '#4caf50' : '#333')}}>
                  {itemTotals.discrepancy > 0 ? '+' : ''}{formatCurrency(itemTotals.discrepancy)}
                </Text>
              </View>
              {activeTab === 'PENDING' && (
                <Text style={{textAlign: 'center', color: '#f59e0b', fontWeight: 'bold', marginTop: 15, fontSize: 14}}>Tráº¡ng thÃ¡i: Äang chá» duyá»‡t</Text>
              )}
              <Text style={{textAlign: 'center', color: '#1976d2', marginTop: 10, fontSize: 12, fontStyle: 'italic'}}>Cháº¡m Ä‘á»ƒ xem chi tiáº¿t & thao tÃ¡c</Text>
            </View>
          </TouchableOpacity>
        );
      })}
    </View>
  );

  const renderDetailModal = () => {
    if (!selectedShiftForDetail) return null;
    const item = selectedShiftForDetail;
    const detailTotals = getShiftTotals(item);
    const invCheck = item.inventory_check || [];
    const hasReportImages = parseReportImages(item.report_image).length > 0;
    const canApproveWithImage = hasReportImages
      && detailReportImageUrls.length > 0
      && detailReportImageUrls.every((url) => reportImageLoadState[url] === 'loaded');

    return (
      <Modal visible={true} transparent={true} animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={styles.modalContainer}>
            <View style={{flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 15, borderBottomWidth: 1, borderBottomColor: '#eee', paddingBottom: 10}}>
              <Text style={{fontSize: 18, fontWeight: 'bold', color: '#1976d2'}}>Chi Tiáº¿t BÃ¡o CÃ¡o Chá»‘t Ca</Text>
              <TouchableOpacity onPress={() => setSelectedShiftForDetail(null)}>
                <Ionicons name="close" size={24} color={isDarkMode ? '#0f172a' : COLORS.text} />
              </TouchableOpacity>
            </View>

            <ScrollView showsVerticalScrollIndicator={false}>
              <View style={{marginBottom: 15}}>
                <Text style={{fontWeight: 'bold'}}>Chi nhÃ¡nh: {storeList.find(s=>s.id===item.store_id)?.name}</Text>
                <Text>NgÆ°á»i má»Ÿ ca: {item.opened_by_name} lÃºc {item.opened_at}</Text>
                <Text>NgÆ°á»i ná»™p bÃ¡o cÃ¡o: {item.closed_by_name} lÃºc {item.closed_at}</Text>
                {item.status === 'CLOSED' && item.approved_by_name && (
                  <Text style={{color: '#4caf50', fontWeight: 'bold'}}>NgÆ°á»i duyá»‡t bÃ¡o cÃ¡o: {item.approved_by_name} lÃºc {item.approved_at}</Text>
                )}
                <Text style={{fontWeight: 'bold', color: item.status === 'CLOSED' ? '#4caf50' : '#f59e0b', marginTop: 5}}>Tráº¡ng thÃ¡i: {item.status === 'CLOSED' ? 'ÄÃ£ duyá»‡t' : 'Chá» duyá»‡t'}</Text>
              </View>

              <Text style={[styles.sectionTitle, {fontSize: 14}]}>KIá»‚M KÃŠ KHO HÃ€NG</Text>
              {invCheck.length > 0 ? (
                <View style={styles.detailBox}>
                  <View style={{flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: '#eee', paddingBottom: 5, marginBottom: 5}}>
                    <Text style={{flex: 2, fontWeight: 'bold'}}>Máº·t hÃ ng</Text>
                    <Text style={{flex: 1, fontWeight: 'bold', textAlign: 'right'}}>Tá»“n Ä‘áº§u</Text>
                    <Text style={{flex: 1, fontWeight: 'bold', textAlign: 'right'}}>Tá»“n cuá»‘i</Text>
                  </View>
                  {invCheck.map((inv, idx) => (
                    <View key={idx} style={{flexDirection: 'row', paddingVertical: 5, borderBottomWidth: 1, borderBottomColor: '#f3f4f6'}}>
                      <Text style={{flex: 2}}>{inv.name}</Text>
                      <Text style={{flex: 1, textAlign: 'right', fontWeight: 'bold'}}>{formatQuantity(inv.start)} {inv.unit}</Text>
                      <Text style={{flex: 1, textAlign: 'right', fontWeight: 'bold'}}>{formatQuantity(inv.end)} {inv.unit}</Text>
                    </View>
                  ))}
                </View>
              ) : (
                <Text style={[styles.emptyText, {fontStyle: 'italic', marginBottom: 15}]}>KhÃ´ng cÃ³ dá»¯ liá»‡u kiá»ƒm kho</Text>
              )}

              <Text style={[styles.sectionTitle, {fontSize: 14}]}>DOANH THU & KÃ‰T TIá»€N</Text>
              <View style={styles.detailBox}>
                <View style={{flexDirection: 'row', justifyContent: 'space-between', marginBottom: 5}}><Text>Tiá»n máº·t (Äáº§u ca):</Text><Text style={{fontWeight: 'bold'}}>{item.opening_cash.toLocaleString()}Ä‘</Text></View>
                <View style={{flexDirection: 'row', justifyContent: 'space-between', marginBottom: 5}}><Text>Doanh thu Ocha/Tá»•ng:</Text><Text style={{fontWeight: 'bold', color: '#1976d2'}}>{formatCurrency(detailTotals.grossRevenue)}</Text></View>
                <View style={{flexDirection: 'row', justifyContent: 'space-between', marginBottom: 5}}><Text>Doanh thu Momo:</Text><Text style={{fontWeight: 'bold', color: '#d82d8b'}}>{item.rev_momo.toLocaleString()}Ä‘</Text></View>
                <View style={{flexDirection: 'row', justifyContent: 'space-between', marginBottom: 5}}><Text>Doanh thu Grab:</Text><Text style={{fontWeight: 'bold', color: '#00a5cf'}}>{item.rev_grab.toLocaleString()}Ä‘</Text></View>
                <View style={{flexDirection: 'row', justifyContent: 'space-between', marginBottom: 5}}><Text>Doanh thu Shopee:</Text><Text style={{fontWeight: 'bold', color: '#ee4d2d'}}>{item.rev_shopee.toLocaleString()}Ä‘</Text></View>
                <View style={{flexDirection: 'row', justifyContent: 'space-between', marginBottom: 5}}><Text>Giáº£m Bill:</Text><Text style={{fontWeight: 'bold', color: '#f59e0b'}}>-{item.discount.toLocaleString()}Ä‘</Text></View>
                <View style={{flexDirection: 'row', justifyContent: 'space-between', marginBottom: 5}}><Text>Chi phÃ­ ({item.expenses_note || 'Trá»‘ng'}):</Text><Text style={{fontWeight: 'bold', color: '#f44336'}}>-{item.expenses.toLocaleString()}Ä‘</Text></View>
                
                <View style={{height: 1, backgroundColor: '#ddd', marginVertical: 8}}/>
                <View style={{flexDirection: 'row', justifyContent: 'space-between', marginBottom: 5}}><Text style={{fontWeight: 'bold'}}>Doanh thu tiá»n máº·t trong ca:</Text><Text style={{fontWeight: 'bold'}}>{formatCurrency(detailTotals.cashRevenue)}</Text></View>
                <View style={{flexDirection: 'row', justifyContent: 'space-between', marginBottom: 5}}><Text style={{fontWeight: 'bold'}}>KÃ©t pháº£i cÃ³:</Text><Text style={{fontWeight: 'bold'}}>{formatCurrency(detailTotals.expectedCash)}</Text></View>
                <View style={{flexDirection: 'row', justifyContent: 'space-between', marginBottom: 5}}><Text>KÃ©t thá»±c Ä‘áº¿m:</Text><Text style={{fontWeight: 'bold', color: '#15803d'}}>{item.closing_cash_actual.toLocaleString()}Ä‘</Text></View>
                <View style={{flexDirection: 'row', justifyContent: 'space-between', marginBottom: 5}}>
                  <Text style={{fontWeight: 'bold'}}>Lá»‡ch kÃ©t:</Text>
                  <Text style={{fontWeight: 'bold', color: detailTotals.discrepancy < 0 ? '#f44336' : (detailTotals.discrepancy > 0 ? '#4caf50' : '#333')}}>
                    {detailTotals.discrepancy > 0 ? '+' : ''}{formatCurrency(detailTotals.discrepancy)}
                  </Text>
                </View>
              </View>

              {hasReportImages ? (
                <>
                  <Text style={[styles.sectionTitle, {fontSize: 14, marginTop: 10}]}>HÃŒNH áº¢NH BÃO CÃO ({detailReportImageUrls.length || parseReportImages(item.report_image).length})</Text>
                  {isResolvingReportImage ? (
                    <View style={styles.reportImageLoading}>
                      <ActivityIndicator color={COLORS.primary} />
                      <Text style={styles.reportImageLoadingText}>Äang táº£i áº£nh bÃ¡o cÃ¡o...</Text>
                    </View>
                  ) : detailReportImageUrls.length > 0 ? (
                    <>
                      {detailReportImageUrls.map((url, index) => {
                        const loadState = reportImageLoadState[url];
                        return (
                          <View key={`${url}_${index}`} style={styles.detailImageWrap}>
                            <Image
                              source={{uri: url}}
                              style={styles.detailReportImage}
                              onLoad={() => setReportImageLoadState((prev) => ({...prev, [url]: 'loaded'}))}
                              onError={() => setReportImageLoadState((prev) => ({...prev, [url]: 'failed'}))}
                            />
                            <View style={styles.detailImageFooter}>
                              <Text style={styles.detailImageIndex}>áº¢nh {index + 1}/{detailReportImageUrls.length}</Text>
                              <TouchableOpacity style={styles.openImageInlineBtn} onPress={() => openReportImageExternally(url)}>
                                <Ionicons name="open-outline" size={16} color={COLORS.primary} style={{marginRight: 6}} />
                                <Text style={styles.openImageInlineText}>Má»Ÿ áº£nh lá»›n</Text>
                              </TouchableOpacity>
                            </View>
                            {loadState === 'failed' && (
                              <View style={styles.reportImageError}>
                                <Ionicons name="alert-circle-outline" size={28} color="#991b1b" />
                                <Text style={styles.reportImageErrorText}>áº¢nh {index + 1} cÃ³ link nhÆ°ng app chÆ°a táº£i Ä‘Æ°á»£c. NgÆ°á»i duyá»‡t khÃ´ng nÃªn duyá»‡t khi chÆ°a xem Ä‘á»§ áº£nh.</Text>
                                <TouchableOpacity style={styles.openImageBtn} onPress={() => openReportImageExternally(url)}>
                                  <Text style={styles.openImageBtnText}>Má»Ÿ áº£nh ngoÃ i app</Text>
                                </TouchableOpacity>
                              </View>
                            )}
                          </View>
                        );
                      })}
                    </>
                  ) : (
                    <View style={styles.reportImageError}>
                      <Ionicons name="image-outline" size={28} color="#991b1b" />
                      <Text style={styles.reportImageErrorText}>KhÃ´ng thá»ƒ má»Ÿ áº£nh bÃ¡o cÃ¡o. Vui lÃ²ng thá»­ táº£i láº¡i hoáº·c kiá»ƒm tra quyá»n bucket shift_reports.</Text>
                    </View>
                  )}
                </>
              ) : (
                <View style={styles.reportImageError}>
                  <Ionicons name="image-outline" size={28} color="#991b1b" />
                  <Text style={styles.reportImageErrorText}>Phiáº¿u nÃ y chÆ°a cÃ³ hÃ¬nh áº£nh bÃ¡o cÃ¡o. NgÆ°á»i duyá»‡t khÃ´ng nÃªn duyá»‡t khi thiáº¿u áº£nh.</Text>
                </View>
              )}

            </ScrollView>

            {item.status === 'PENDING_APPROVAL' && (isOwner || currentUser?.permissions?.is_primary_manager) && (
              <>
                <TouchableOpacity style={{backgroundColor: canApproveWithImage ? '#4caf50' : '#9ca3af', padding: 12, borderRadius: 8, alignItems: 'center', marginTop: 10}} onPress={() => {
                  if (!canApproveWithImage) {
                    Alert.alert('ChÆ°a thá»ƒ duyá»‡t', 'Cáº§n má»Ÿ vÃ  tháº¥y hÃ¬nh áº£nh bÃ¡o cÃ¡o trÆ°á»›c khi duyá»‡t phiáº¿u chá»‘t ca.');
                    return;
                  }
                  handleApproveShiftReport(item);
                }}>
                  <Text style={{color: '#fff', fontWeight: 'bold'}}>{canApproveWithImage ? 'Duyá»‡t Chá»‘t Ca' : 'ChÆ°a tháº¥y áº£nh - chÆ°a thá»ƒ duyá»‡t'}</Text>
                </TouchableOpacity>
                <TouchableOpacity style={{backgroundColor: '#f59e0b', padding: 12, borderRadius: 8, alignItems: 'center', marginTop: 10}} onPress={() => {
                  handleRejectShiftReport(item);
                }}>
                  <Text style={{color: '#fff', fontWeight: 'bold'}}>Tá»« Chá»‘i (YÃªu cáº§u lÃ m láº¡i)</Text>
                </TouchableOpacity>
              </>
            )}

            {item.status === 'PENDING_APPROVAL' && item.closed_by === currentUser.id && (
              <TouchableOpacity style={{backgroundColor: '#f44336', padding: 12, borderRadius: 8, alignItems: 'center', marginTop: 10}} onPress={() => {
                handleRecallShiftReport(item);
              }}>
                <Text style={{color: '#fff', fontWeight: 'bold'}}>Thu Há»“i BÃ¡o CÃ¡o</Text>
              </TouchableOpacity>
            )}

            {item.status === 'CLOSED' && (isOwner || currentUser?.permissions?.is_primary_manager) && (
              <TouchableOpacity style={{backgroundColor: '#ef4444', padding: 12, borderRadius: 8, alignItems: 'center', marginTop: 10}} onPress={() => {
                handleUndoApproveShiftReport(item);
              }}>
                <Text style={{color: '#fff', fontWeight: 'bold'}}>Há»§y Duyá»‡t (YÃªu cáº§u lÃ m láº¡i)</Text>
              </TouchableOpacity>
            )}

            <TouchableOpacity style={{backgroundColor: '#1976d2', padding: 12, borderRadius: 8, alignItems: 'center', marginTop: 10}} onPress={() => setSelectedShiftForDetail(null)}>
              <Text style={{color: '#fff', fontWeight: 'bold'}}>ÄÃ³ng</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    );
  };

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.flexRoot}>
        <View style={styles.stickyTopBar}>
        <View style={styles.headerRow}>
          <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}><Ionicons name="arrow-back" size={24} color={COLORS.text} /></TouchableOpacity>
          <Text style={styles.header}>BÃ¡o CÃ¡o Máº«u 16</Text>
        </View>

        <View style={styles.tabContainer}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            <TouchableOpacity style={[styles.tabBtn, activeTab === 'INVENTORY' && styles.tabBtnActive, {paddingHorizontal: 15}]} onPress={() => setActiveTab('INVENTORY')}>
              <Text style={[styles.tabText, activeTab === 'INVENTORY' && styles.tabTextActive]}>Kiá»ƒm Kho</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.tabBtn, activeTab === 'CASH' && styles.tabBtnActive, {paddingHorizontal: 15}]} onPress={() => setActiveTab('CASH')}>
              <Text style={[styles.tabText, activeTab === 'CASH' && styles.tabTextActive]}>KÃ©t & Doanh Thu</Text>
            </TouchableOpacity>
          {(!isStaff) && (
            <TouchableOpacity style={[styles.tabBtn, activeTab === 'PENDING' && styles.tabBtnActive]} onPress={() => setActiveTab('PENDING')}>
              <Text style={[styles.tabText, activeTab === 'PENDING' && styles.tabTextActive]}>Chá» Duyá»‡t</Text>
            </TouchableOpacity>
          )}
          {(!isStaff) && (
            <TouchableOpacity style={[styles.tabBtn, activeTab === 'HISTORY' && styles.tabBtnActive, {paddingHorizontal: 15}]} onPress={() => setActiveTab('HISTORY')}>
              <Text style={[styles.tabText, activeTab === 'HISTORY' && styles.tabTextActive]}>Lá»‹ch Sá»­</Text>
            </TouchableOpacity>
          )}
          </ScrollView>
        </View>

        </View>

        <ScrollView 
          showsVerticalScrollIndicator={false} 
          contentContainerStyle={{ paddingBottom: 80 }} 
          style={styles.mainScroll}
          refreshControl={<RefreshControl refreshing={isDataLoading || false} onRefresh={refreshData} />}
        >
          {activeTab === 'PENDING' && renderHistoryTab(pendingShifts)}
          {activeTab === 'HISTORY' && renderHistoryTab(historyShifts)}

          {(activeTab === 'INVENTORY' || activeTab === 'CASH') && (!hasCashierPerm ? (
            <View style={{padding: 20, alignItems: 'center', marginTop: 50}}>
              <Ionicons name="lock-closed" size={60} color={COLORS.textMuted} />
              <Text style={{fontSize: 18, color: COLORS.textMuted, marginTop: 15, textAlign: 'center'}}>Báº¡n khÃ´ng Ä‘Æ°á»£c cáº¥p quyá»n Thu NgÃ¢n / BÃ¡n HÃ ng Ä‘á»ƒ thá»±c hiá»‡n chá»©c nÄƒng nÃ y.</Text>
            </View>
          ) : (
            <View>
              {storeIdToView === 'ALL' ? (
                <View style={styles.section}><Text style={{textAlign:'center', color:'#f44336'}}>Vui lÃ²ng chá»n 1 chi nhÃ¡nh Ä‘á»ƒ Giao Ca!</Text></View>
              ) : !currentOpenShift ? (
                <View style={styles.section}>
                  <View style={{alignItems: 'center', marginBottom: 20}}><MaterialCommunityIcons name="cash-register" size={60} color="#9ca3af" /><Text style={styles.sectionTitle}>CHÆ¯A Má»ž CA LÃ€M VIá»†C</Text></View>
                  {renderMoneyInput('Tiá»n máº·t Ä‘áº§u ca cÃ³ trong kÃ©t (VNÄ):', openingCash, setOpeningCash, false, 'Nháº­p sá»‘ tiá»n...')}
                  
                  {(() => {
                    const todaysShifts = shifts.filter(s => s.store_id === storeIdToView && s.opened_at.startsWith(todayStr));
                    const hasMorning = todaysShifts.some(s => s.opened_at.includes('(Ca SÃ¡ng)'));
                    const hasAfternoon = todaysShifts.some(s => s.opened_at.includes('(Ca Chiá»u)'));
                    
                    if (hasMorning && hasAfternoon) {
                      return <Text style={{color: '#f44336', textAlign: 'center', marginTop: 15, fontWeight: 'bold'}}>HÃ´m nay Ä‘Ã£ má»Ÿ Ä‘á»§ 2 ca (SÃ¡ng & Chiá»u).</Text>;
                    }

                    const currentHour = new Date().getHours();
                    const isMorningTime = currentHour < 12;

                    return (
                      <View style={{marginTop: 15}}>
                        {isMorningTime ? (
                          !hasMorning ? (
                            <TouchableOpacity style={styles.openBtn} onPress={() => handleOpenShift('Ca SÃ¡ng')}>
                              <Text style={styles.btnText}>Má»ž CA SÃNG (TrÆ°á»›c 12h)</Text>
                            </TouchableOpacity>
                          ) : (
                            <Text style={{color: '#f59e0b', textAlign: 'center', fontStyle: 'italic'}}>Ca SÃ¡ng Ä‘Ã£ Ä‘Æ°á»£c má»Ÿ. Vui lÃ²ng chá» Ä‘áº¿n sau 12h trÆ°a Ä‘á»ƒ má»Ÿ Ca Chiá»u.</Text>
                          )
                        ) : (
                          !hasAfternoon ? (
                            <TouchableOpacity style={[styles.openBtn, {backgroundColor: '#f59e0b'}]} onPress={() => handleOpenShift('Ca Chiá»u')}>
                              <Text style={styles.btnText}>Má»ž CA CHIá»€U (Sau 12h)</Text>
                            </TouchableOpacity>
                          ) : (
                            <Text style={{color: '#f59e0b', textAlign: 'center', fontStyle: 'italic'}}>Ca Chiá»u Ä‘Ã£ Ä‘Æ°á»£c má»Ÿ.</Text>
                          )
                        )}
                      </View>
                    );
                  })()}
                </View>
              ) : (
                <View>
                  <View style={[styles.section, styles.openShiftBanner]}>
                    <Text style={styles.openShiftTitle}>ðŸŸ¢ ÄANG TRONG CA: {storeList.find(s=>s.id===storeIdToView)?.name}</Text>
                    <Text style={styles.openShiftMeta}>Má»Ÿ lÃºc: {currentOpenShift.opened_at} bá»Ÿi {currentOpenShift.opened_by_name}</Text>
                  </View>

                  {/* PHáº¦N 1: KIá»‚M KHO */}
                  {activeTab === 'INVENTORY' && (
                  <View style={styles.section}>
                    <Text style={styles.sectionTitle}>PHáº¦N 1: KIá»‚M KÃŠ KHO HÃ€NG</Text>
                    <View style={styles.tableHeader}>
                      <Text style={[styles.cell, {flex: 2}]}>TÃªn HÃ ng</Text>
                      <Text style={[styles.cell, {flex: 1}]}>Tá»“n Äáº§u</Text>
                      <Text style={[styles.cell, {flex: 1.5}]}>Tá»“n Cuá»‘i</Text>
                    </View>
                    {storeInventoryWithStock.map(item => (
                      <View key={item.id} style={styles.tableRow}>
                        <Text style={[styles.cell, {flex: 2}]} numberOfLines={1}>{item.name}</Text>
                        <Text style={[styles.cell, {flex: 1}]}>{formatQuantity(item.currentStock)}</Text>
                        <View style={{flex: 1.5, paddingHorizontal: 5}}>
                          <TextInput
                            style={styles.smallInput} keyboardType="numbers-and-punctuation" placeholder={formatQuantity(item.currentStock)}
                            value={inventoryCheck[item.id] !== undefined ? String(inventoryCheck[item.id]) : ''}
                            onChangeText={(val) => setInventoryCheck({...inventoryCheck, [item.id]: val})}
                          />
                        </View>
                      </View>
                    ))}
                  </View>
                  )}

                  {/* PHáº¦N 2: DOANH THU & KÃ‰T */}
                  {activeTab === 'CASH' && (
                  <View style={styles.section}>
                    <Text style={styles.sectionTitle}>PHáº¦N 2: DOANH THU & KÃ‰T TIá»€N</Text>
                    <Text style={styles.infoText}>Tiá»n Ä‘áº§u giá» (1): {currentOpenShift.opening_cash.toLocaleString()}Ä‘</Text>

                    {isLoadingOcha ? (
                      <View style={styles.revenueSourceBox}>
                        <View style={styles.ochaInlineLoading}>
                          <ActivityIndicator color={COLORS.primary} style={{marginRight: 8}} />
                          <Text style={styles.ochaManualHint}>Äang táº£i doanh thu Ocha...</Text>
                        </View>
                      </View>
                    ) : ochaAmount > 0 ? (
                      <View style={styles.revenueSourceBox}>
                        <Text style={styles.ochaAmountLabel}>Doanh thu Ocha/Tá»•ng doanh thu (3)</Text>
                        <Text style={styles.ochaAmountValue}>{formatCurrency(sourceRevenue)}</Text>
                        <Text style={styles.ochaSyncText}>Cáº­p nháº­t lÃºc: {ochaSyncLabel}</Text>
                        <Text style={styles.ochaManualHint}>Chá»‰ chá»‘t khi Ocha Ä‘Ã£ Ä‘á»“ng bá»™ háº¿t bill cuá»‘i ca.</Text>
                      </View>
                    ) : renderMoneyInput('Doanh thu Ocha/Tá»•ng doanh thu (3):', revCash, setRevCash)}
                    {renderMoneyInput('Tá»•ng tiá»n giáº£m bill (4):', discount, setDiscount)}
                    {renderMoneyInput('Tá»•ng tiá»n MOMO:', revMomo, setRevMomo)}
                    {renderMoneyInput('Tá»•ng tiá»n GRAB:', revGrab, setRevGrab)}
                    {renderMoneyInput('Tá»•ng tiá»n SHOPEE FOOD:', revShopee, setRevShopee)}

                    <View style={{flexDirection: 'column', marginBottom: 4}}>
                      {renderMoneyInput('Tiá»n chi trong ngÃ y (5):', expenses, setExpenses)}
                      <Text style={styles.label}>Ghi chÃº chi:</Text>
                      <TextInput style={styles.input} placeholder="Mua Ä‘Ã¡, trÃ , linh tinh..." value={expensesNote} onChangeText={setExpensesNote} />
                    </View>

                    {renderMoneyInput('TIá»€N TRONG KÃ‰T THá»°C Äáº¾M (2):', actualCash, setActualCash, true, 'Äáº¿m kÃ©t...')}

                    <View style={styles.previewBox}>
                      <Text style={styles.previewTitle}>Xem TrÆ°á»›c BÃ¡o CÃ¡o:</Text>
                      <Text style={styles.previewText}>Tiá»n Ä‘áº§u giá» (1): {formatCurrency(currentOpenShift.opening_cash)}</Text>
                      <Text style={styles.previewText}>Doanh thu Ocha/tá»•ng (3): {formatCurrency(sourceRevenue)}</Text>
                      <Text style={styles.previewText}>Online: -{formatCurrency(currentTotals.nonCash)}</Text>
                      <Text style={styles.previewText}>Giáº£m bill (4): -{formatCurrency(manualDiscount)}</Text>
                      <Text style={styles.previewText}>Tiá»n chi (5): -{formatCurrency(manualExpenses)}</Text>
                      <Text style={styles.previewText}>KÃ©t pháº£i cÃ³: {formatCurrency(currentExpectedCash)}</Text>
                      <Text style={styles.previewText}>KÃ©t thá»±c Ä‘áº¿m (2): {formatCurrency(manualActualCash)}</Text>
                      <Text style={styles.previewFormula}>KÃ©t pháº£i cÃ³ = (1) + (3) - Online - (4) - (5)</Text>
                      <Text style={[styles.previewText, currentCashDiff === 0 ? styles.okText : styles.dangerText]}>Lá»‡ch kÃ©t: {formatCurrency(currentCashDiff)}</Text>
                    </View>

                    <View style={{marginTop: 15, marginBottom: 10}}>
                      <Text style={[styles.label, {marginTop: 0}]}>HÃ¬nh áº£nh bÃ¡o cÃ¡o (TÃ¹y chá»n):</Text>
                      {reportImages.length > 0 && (
                        <View style={styles.selectedImagesGrid}>
                          {reportImages.map((uri, index) => (
                            <View key={`${uri}_${index}`} style={styles.selectedImageWrap}>
                              <Image source={{uri}} style={styles.selectedReportImage} />
                              <Text style={styles.selectedImageLabel}>áº¢nh {index + 1}/{reportImages.length}</Text>
                              <TouchableOpacity
                                style={styles.removeImageBtn}
                                onPress={() => setReportImages((prev) => prev.filter((_, idx) => idx !== index))}
                              >
                                <Ionicons name="close" size={18} color="#fff" />
                              </TouchableOpacity>
                            </View>
                          ))}
                        </View>
                      )}
                      <View style={{flexDirection: 'row', gap: 10, marginTop: 5}}>
                        <TouchableOpacity style={styles.mediaBtn} onPress={() => handlePickImage(true)}>
                          <Ionicons name="camera" size={20} color="#4f46e5" style={{marginRight: 5}}/>
                          <Text style={styles.mediaBtnText}>{reportImages.length > 0 ? 'Chá»¥p thÃªm' : 'Chá»¥p áº£nh'}</Text>
                        </TouchableOpacity>
                        <TouchableOpacity style={styles.mediaBtn} onPress={() => handlePickImage(false)}>
                          <Ionicons name="image" size={20} color="#4f46e5" style={{marginRight: 5}}/>
                          <Text style={styles.mediaBtnText}>{reportImages.length > 0 ? 'ThÃªm tá»« thÆ° viá»‡n' : 'ThÆ° viá»‡n'}</Text>
                        </TouchableOpacity>
                      </View>
                      <Text style={styles.imageHelperText}>Tá»‘i Ä‘a 6 áº£nh/phiáº¿u. áº¢nh sáº½ giá»¯ nguyÃªn khung, khÃ´ng crop ná»™i dung.</Text>
                    </View>
                  </View>
                  )}
                </View>
              )}
            </View>
          ))}
        </ScrollView>

        {/* FIXED BOTTOM BUTTON FOR CLOSING SHIFT */}
        {activeTab === 'INVENTORY' && currentOpenShift && storeIdToView !== 'ALL' && (
          <View style={styles.fixedBottomBar}>
            <TouchableOpacity style={[styles.closeBtnFixed, {backgroundColor: '#1976d2'}]} onPress={handleSaveInventory}>
              <Text style={styles.btnText}>LÆ¯U PHIáº¾U KIá»‚M KHO</Text>
            </TouchableOpacity>
          </View>
        )}

        {activeTab === 'CASH' && currentOpenShift && storeIdToView !== 'ALL' && (
          <View style={styles.fixedBottomBar}>
            <TouchableOpacity style={[styles.closeBtnFixed, isUploading && {backgroundColor: '#9e9e9e'}]} onPress={handleCloseShift} disabled={isUploading}>
              {isUploading ? (
                <View style={{flexDirection: 'row', alignItems: 'center'}}>
                  <ActivityIndicator size="small" color="#fff" style={{marginRight: 10}} />
                  <Text style={styles.btnText}>ÄANG Xá»¬ LÃ...</Text>
                </View>
              ) : (
                <Text style={styles.btnText}>XÃC NHáº¬N Ná»˜P DOANH THU (CHá»T CA)</Text>
              )}
            </TouchableOpacity>
          </View>
        )}
      </KeyboardAvoidingView>
      {renderDetailModal()}
      {renderMoneyCalculator()}
      <DateRangePickerModal
        visible={showHistoryDateModal}
        onClose={() => setShowHistoryDateModal(false)}
        onApply={applyHistoryRange}
        initialStartDate={historyRange.start}
        initialEndDate={historyRange.end}
        COLORS={COLORS}
        isDarkMode={isDarkMode}
        title="Chá»n ngÃ y xem lá»‹ch sá»­ chá»‘t ca"
      />
    </SafeAreaView>
  );
}

const getStyles = (COLORS, isDarkMode) => StyleSheet.create({
  container: { flex: 1, minHeight: 0, overflow: Platform.OS === 'web' ? 'visible' : 'hidden', backgroundColor: COLORS.bg, paddingHorizontal: 6 },
  flexRoot: { flex: 1, minHeight: 0 },
  mainScroll: { flex: 1, minHeight: 0, paddingHorizontal: 6 },
  stickyTopBar: { backgroundColor: COLORS.bg, ...(Platform.OS === 'web' ? { position: 'sticky', top: 0, zIndex: 40 } : null) },
  mathBtn: { backgroundColor: COLORS.inputBg, paddingVertical: 10, paddingHorizontal: 15, marginLeft: 8, borderRadius: 8, justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderColor: COLORS.border },
  mathBtnText: { fontSize: 20, fontWeight: 'bold', color: COLORS.text },
  headerRow: { flexDirection: 'row', alignItems: 'center', marginTop: 10, marginBottom: 15 },
  backBtn: { padding: 5, marginRight: 10 },
  header: { fontSize: 24, fontWeight: 'bold', color: COLORS.text },
  tabContainer: { flexDirection: 'row', backgroundColor: COLORS.inputBg, borderRadius: 8, padding: 4, marginBottom: 20, borderWidth: 1, borderColor: COLORS.border },
  tabBtn: { flex: 1, paddingVertical: 10, alignItems: 'center', borderRadius: 6 },
  tabBtnActive: { backgroundColor: COLORS.card, elevation: 2 },
  tabText: { fontWeight: 'bold', color: COLORS.textMuted },
  tabTextActive: { color: COLORS.primary },
  section: { backgroundColor: COLORS.card, padding: 8, borderRadius: 12, marginBottom: 10, elevation: 2, borderWidth: 1, borderColor: COLORS.border },
  sectionTitle: { fontSize: 16, fontWeight: '900', marginBottom: 10, color: COLORS.primary },
  moneyInputGroup: { marginBottom: 5 },
  label: { fontSize: 13, fontWeight: 'bold', color: COLORS.text, marginBottom: 4, marginTop: 5 },
  input: { borderWidth: 1, borderColor: COLORS.inputBorder, borderRadius: 8, paddingVertical: 8, paddingHorizontal: 10, minHeight: 40, fontSize: 14, backgroundColor: COLORS.inputBg, color: COLORS.text, marginBottom: 2 },
  moneyInputRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  moneyInputField: { flex: 1, marginBottom: 0 },
  moneyCalculatorBtn: { width: 42, height: 40, borderRadius: 10, borderWidth: 1, borderColor: COLORS.inputBorder, backgroundColor: COLORS.inputBg, alignItems: 'center', justifyContent: 'center' },
  smallInput: { borderWidth: 1, borderColor: COLORS.inputBorder, backgroundColor: COLORS.inputBg, color: COLORS.text, borderRadius: 4, paddingVertical: 4, paddingHorizontal: 5, fontSize: 13, textAlign: 'center' },
  openBtn: { backgroundColor: '#4caf50', padding: 15, borderRadius: 8, alignItems: 'center', marginTop: 10 },
  fixedBottomBar: { position: 'absolute', bottom: 0, left: 0, right: 0, padding: 15, paddingHorizontal: 20, backgroundColor: COLORS.card, borderTopWidth: 1, borderTopColor: COLORS.border, elevation: 10, shadowColor: '#000', shadowOpacity: isDarkMode ? 0.25 : 0.1, shadowRadius: 5 },
  closeBtnFixed: { backgroundColor: '#f44336', padding: 15, borderRadius: 8, alignItems: 'center' },
  btnText: { color: '#fff', fontSize: 16, fontWeight: 'bold' },
  historyFilterCard: { backgroundColor: COLORS.card, borderWidth: 1, borderColor: COLORS.border, padding: 12, borderRadius: 12, marginBottom: 14 },
  historyFilterHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 10 },
  historyFilterTitle: { color: COLORS.text, fontWeight: '900', fontSize: 14 },
  historyFilterSubtitle: { color: COLORS.textMuted, marginTop: 3, fontSize: 12 },
  historyCalendarBtn: { flexDirection: 'row', alignItems: 'center', backgroundColor: isDarkMode ? '#1e1b4b' : '#eef2ff', borderWidth: 1, borderColor: isDarkMode ? '#3730a3' : '#c7d2fe', paddingVertical: 8, paddingHorizontal: 10, borderRadius: 10 },
  historyCalendarText: { color: COLORS.primary, fontWeight: '900', marginLeft: 6, fontSize: 12 },
  historyQuickRow: { paddingTop: 12, gap: 8 },
  historyQuickBtn: { paddingVertical: 8, paddingHorizontal: 12, borderRadius: 18, backgroundColor: COLORS.inputBg, borderWidth: 1, borderColor: COLORS.border },
  historyQuickBtnActive: { backgroundColor: isDarkMode ? '#14532d' : '#dcfce7', borderColor: isDarkMode ? '#22c55e' : '#86efac' },
  historyQuickText: { color: COLORS.textMuted, fontWeight: '800', fontSize: 12 },
  historyQuickTextActive: { color: isDarkMode ? '#bbf7d0' : '#166534' },
  emptyHistoryBox: { alignItems: 'center', justifyContent: 'center', padding: 28, backgroundColor: COLORS.card, borderWidth: 1, borderColor: COLORS.border, borderRadius: 12, marginBottom: 15 },
  emptyHistoryText: { color: COLORS.textMuted, marginTop: 10, fontWeight: '700', textAlign: 'center' },
  historyCard: { backgroundColor: COLORS.card, borderWidth: 1, borderColor: COLORS.border, padding: 15, borderRadius: 10, marginBottom: 15 },
  hText: { color: COLORS.textMuted, marginBottom: 3, fontSize: 13 },
  infoText: { fontSize: 14, fontWeight: 'bold', marginBottom: 8, color: COLORS.text },
  ochaCard: { backgroundColor: isDarkMode ? '#0f172a' : '#f8fafc', borderWidth: 1, borderColor: isDarkMode ? '#334155' : '#e2e8f0', padding: 10, borderRadius: 12, marginBottom: 10 },
  ochaHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  ochaTitle: { color: COLORS.text, fontWeight: '900', fontSize: 15 },
  ochaMeta: { color: COLORS.textMuted, marginTop: 3, fontSize: 12 },
  ochaHint: { color: COLORS.textMuted, fontStyle: 'italic' },
  ochaAmountBox: { backgroundColor: isDarkMode ? '#111827' : '#fff', borderWidth: 1, borderColor: COLORS.border, borderRadius: 10, padding: 10 },
  revenueSourceBox: { backgroundColor: isDarkMode ? '#052e16' : '#ecfdf5', borderWidth: 1, borderColor: isDarkMode ? '#166534' : '#bbf7d0', borderRadius: 10, padding: 10, marginBottom: 8 },
  ochaAmountLabel: { color: COLORS.textMuted, fontSize: 12, fontWeight: '800' },
  ochaAmountValue: { color: COLORS.text, fontSize: 22, fontWeight: '900', marginTop: 3 },
  ochaSyncText: { color: COLORS.primary, fontSize: 12, fontWeight: '900', marginTop: 4 },
  ochaManualHint: { color: COLORS.textMuted, fontSize: 12, marginTop: 4, lineHeight: 17 },
  ochaInlineLoading: { flexDirection: 'row', alignItems: 'center' },
  ochaGrid: { flexDirection: 'row', gap: 8 },
  ochaMetric: { flex: 1, backgroundColor: isDarkMode ? '#111827' : '#fff', borderWidth: 1, borderColor: COLORS.border, borderRadius: 10, padding: 8 },
  ochaMetricLabel: { color: COLORS.textMuted, fontSize: 12, fontWeight: '700' },
  ochaMetricValue: { color: COLORS.text, fontSize: 18, fontWeight: '900', marginTop: 3 },
  ochaMetricSub: { color: COLORS.textMuted, fontSize: 11, marginTop: 3 },
  ochaSuggestion: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: isDarkMode ? '#052e16' : '#ecfdf5', borderWidth: 1, borderColor: isDarkMode ? '#166534' : '#bbf7d0', borderRadius: 10, padding: 8, marginTop: 8 },
  ochaSyncBtn: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#16a34a', paddingVertical: 8, paddingHorizontal: 11, borderRadius: 9 },
  ochaSyncBtnText: { color: '#fff', fontWeight: '900', fontSize: 12 },
  ochaDrawerLine: { borderTopWidth: 1, borderTopColor: COLORS.border, marginTop: 8, paddingTop: 8, gap: 3 },
  ochaDrawerText: { color: COLORS.text, fontWeight: '700' },
  ochaWarning: { flexDirection: 'row', alignItems: 'flex-start', backgroundColor: isDarkMode ? '#451a03' : '#fffbeb', borderWidth: 1, borderColor: isDarkMode ? '#92400e' : '#fde68a', borderRadius: 10, padding: 10 },
  ochaWarningText: { flex: 1, color: isDarkMode ? '#fde68a' : '#92400e', fontWeight: '700', lineHeight: 18 },
  okText: { color: '#16a34a' },
  dangerText: { color: '#dc2626' },
  openShiftBanner: { backgroundColor: isDarkMode ? '#0f2a1d' : '#e8f5e9', borderColor: isDarkMode ? '#166534' : '#bbf7d0' },
  openShiftTitle: { color: isDarkMode ? '#86efac' : '#2e7d32', fontWeight: 'bold' },
  openShiftMeta: { color: COLORS.textMuted, marginTop: 4 },
  previewBox: { backgroundColor: isDarkMode ? '#3b2a11' : '#fff3e0', padding: 10, borderRadius: 8, marginTop: 15 },
  previewTitle: { fontWeight: 'bold', marginBottom: 5, color: COLORS.text },
  previewText: { color: COLORS.text, marginTop: 2 },
  previewFormula: { color: COLORS.textMuted, marginTop: 2, fontSize: 12, fontStyle: 'italic' },
  mediaBtn: { flex: 1, backgroundColor: isDarkMode ? '#1e1b4b' : '#e0e7ff', padding: 12, borderRadius: 8, alignItems: 'center', flexDirection: 'row', justifyContent: 'center', borderWidth: 1, borderColor: isDarkMode ? '#3730a3' : '#c7d2fe' },
  mediaBtnText: { color: isDarkMode ? '#c7d2fe' : '#4f46e5', fontWeight: 'bold' },
  selectedImagesGrid: { gap: 12, marginTop: 10, marginBottom: 10 },
  selectedImageWrap: { position: 'relative', borderRadius: 10, overflow: 'hidden', borderWidth: 1, borderColor: COLORS.border, backgroundColor: isDarkMode ? '#111827' : '#f8fafc' },
  selectedReportImage: { width: '100%', height: 220, resizeMode: 'contain', backgroundColor: isDarkMode ? '#111827' : '#f8fafc' },
  selectedImageLabel: { position: 'absolute', left: 8, bottom: 8, backgroundColor: 'rgba(0,0,0,0.55)', color: '#fff', fontWeight: '900', paddingVertical: 4, paddingHorizontal: 8, borderRadius: 8, overflow: 'hidden' },
  removeImageBtn: { position: 'absolute', top: 8, right: 8, backgroundColor: 'rgba(0,0,0,0.6)', padding: 8, borderRadius: 20 },
  imageHelperText: { color: COLORS.textMuted, fontSize: 12, marginTop: 8, fontStyle: 'italic' },
  attendanceText: { marginBottom: 5, color: COLORS.text },
  emptyText: { color: COLORS.textMuted },
  tableHeader: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: COLORS.border, paddingBottom: 4, marginBottom: 3 },
  tableRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: COLORS.border },
  cell: { fontSize: 13, color: COLORS.text },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center', padding: 20 },
  detailBox: { backgroundColor: isDarkMode ? '#f8fafc' : '#f9fafb', padding: 10, borderRadius: 8, marginBottom: 15 },
  reportImageLoading: { height: 160, borderRadius: 8, marginBottom: 15, alignItems: 'center', justifyContent: 'center', backgroundColor: isDarkMode ? '#e2e8f0' : '#f1f5f9' },
  reportImageLoadingText: { marginTop: 10, color: '#334155', fontWeight: '700' },
  reportImageError: { minHeight: 140, borderRadius: 8, marginBottom: 15, alignItems: 'center', justifyContent: 'center', padding: 14, backgroundColor: '#fee2e2', borderWidth: 1, borderColor: '#fecaca' },
  reportImageErrorText: { marginTop: 8, color: '#991b1b', fontWeight: '700', textAlign: 'center' },
  detailImageWrap: { marginBottom: 14 },
  detailReportImage: { width: '100%', height: 320, borderRadius: 8, marginBottom: 8, resizeMode: 'contain', backgroundColor: '#e5e7eb' },
  detailImageFooter: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 5 },
  detailImageIndex: { color: '#334155', fontWeight: '900' },
  openImageBtn: { marginTop: 12, backgroundColor: '#991b1b', paddingVertical: 10, paddingHorizontal: 14, borderRadius: 8 },
  openImageBtnText: { color: '#fff', fontWeight: '900' },
  openImageInlineBtn: { marginBottom: 15, alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', paddingVertical: 8, paddingHorizontal: 10, borderRadius: 8, backgroundColor: isDarkMode ? '#e0e7ff' : '#eef2ff' },
  openImageInlineText: { color: COLORS.primary, fontWeight: '900' },
  calculatorOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end', padding: 12 },
  calculatorModal: { backgroundColor: COLORS.card, borderRadius: 18, padding: 12, borderWidth: 1, borderColor: COLORS.border, shadowColor: '#000', shadowOpacity: 0.18, shadowRadius: 14, elevation: 8 },
  calculatorHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: 10 },
  calculatorTitle: { color: COLORS.text, fontSize: 17, fontWeight: '900' },
  calculatorSubtitle: { color: COLORS.textMuted, fontSize: 12, marginTop: 2, fontWeight: '700' },
  calculatorCloseBtn: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: COLORS.inputBg },
  calculatorDisplay: { backgroundColor: COLORS.inputBg, borderRadius: 12, borderWidth: 1, borderColor: COLORS.inputBorder, padding: 10, marginBottom: 10 },
  calculatorExpression: { color: COLORS.text, fontSize: 22, fontWeight: '900', textAlign: 'right' },
  calculatorResult: { color: COLORS.primary, fontSize: 14, fontWeight: '900', textAlign: 'right', marginTop: 4 },
  calculatorGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  calculatorKey: { width: '23%', minHeight: 48, borderRadius: 13, alignItems: 'center', justifyContent: 'center', backgroundColor: COLORS.inputBg, borderWidth: 1, borderColor: COLORS.border },
  calculatorActionKey: { backgroundColor: isDarkMode ? '#14352a' : '#e8f5ee', borderColor: isDarkMode ? '#166534' : '#bbf7d0' },
  calculatorApplyKey: { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
  calculatorKeyText: { color: COLORS.text, fontSize: 18, fontWeight: '900' },
  calculatorApplyText: { color: '#fff' },
  modalContainer: { width: '100%', maxHeight: '80%', backgroundColor: isDarkMode ? '#f8fafc' : COLORS.card, borderRadius: 12, padding: 20, elevation: 5, borderWidth: 1, borderColor: COLORS.border }
});
