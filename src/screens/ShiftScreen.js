import React, { useState, useContext, useEffect, useMemo, useCallback } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, TextInput, SafeAreaView, KeyboardAvoidingView, Platform, Alert, Modal, Image, ActivityIndicator, Linking } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as ImagePicker from 'expo-image-picker';
import { AppContext } from '../context/AppContext';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { supabase } from '../services/supabaseClient';
import { sendPushNotification } from '../services/NotificationService';
import { getDailyRevenue } from '../services/financeService';
import { getLocalDateKey } from '../utils/dateTime';
import DateRangePickerModal from '../components/DateRangePickerModal';

export default function ShiftScreen({ navigation }) {
  const { currentUser, staffList, shifts, setShifts, selectedStoreId, storeList, inventoryItems, setInventoryItems, inventoryLogs, setInventoryLogs, attendanceHistory, payrollAdjustments, setPayrollAdjustments, COLORS, isDarkMode } = useContext(AppContext);
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

  // === MỞ CA ===
  const [openingCash, setOpeningCash] = useState('');
  const handleOpenShift = async (periodName) => {
    if (storeIdToView === 'ALL') { alert('Vui lòng chọn 1 chi nhánh!'); return; }
    if (!openingCash) { alert('Nhập tiền đầu ca!'); return; }
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
    alert(`Mở ${periodName} thành công!`);
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
  const [reportImages, setReportImages] = useState([]);
  const [isUploading, setIsUploading] = useState(false);
  const [ochaRevenue, setOchaRevenue] = useState(null);
  const [isLoadingOcha, setIsLoadingOcha] = useState(false);
  const [detailReportImageUrls, setDetailReportImageUrls] = useState([]);
  const [isResolvingReportImage, setIsResolvingReportImage] = useState(false);
  const [reportImageLoadState, setReportImageLoadState] = useState({});

  const CACHE_KEY = `SHIFT_DRAFT_${storeIdToView}`;
  const ochaDateKey = getLocalDateKey();

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
      Alert.alert('Chưa có ảnh', 'App chưa lấy được link ảnh báo cáo để mở.');
      return;
    }
    try {
      await Linking.openURL(url);
    } catch (error) {
      Alert.alert('Không mở được ảnh', error?.message || 'Vui lòng thử lại sau.');
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
          if (data.revCash !== undefined) setRevCash(data.revCash);
          if (data.revMomo !== undefined) setRevMomo(data.revMomo);
          if (data.revGrab !== undefined) setRevGrab(data.revGrab);
          if (data.revShopee !== undefined) setRevShopee(data.revShopee);
          if (data.discount !== undefined) setDiscount(data.discount);
          if (data.expenses !== undefined) setExpenses(data.expenses);
          if (data.expensesNote !== undefined) setExpensesNote(data.expensesNote);
          if (data.actualCash !== undefined) setActualCash(data.actualCash);
        } else if (currentOpenShift) {
          // Fallback to database values if no cache
          const initInv = {};
          (currentOpenShift.inventory_check || []).forEach(ic => {
            initInv[ic.item_id] = String(ic.end);
          });
          setInventoryCheck(initInv);
          setRevCash(currentOpenShift.rev_cash ? String(currentOpenShift.rev_cash) : '');
          setRevMomo(currentOpenShift.rev_momo ? String(currentOpenShift.rev_momo) : '');
          setRevGrab(currentOpenShift.rev_grab ? String(currentOpenShift.rev_grab) : '');
          setRevShopee(currentOpenShift.rev_shopee ? String(currentOpenShift.rev_shopee) : '');
          setDiscount(currentOpenShift.discount ? String(currentOpenShift.discount) : '');
          setExpenses(currentOpenShift.expenses ? String(currentOpenShift.expenses) : '');
          setExpensesNote(currentOpenShift.expenses_note || '');
          setActualCash(currentOpenShift.closing_cash_actual ? String(currentOpenShift.closing_cash_actual) : '');
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

  const todayStr = new Date().toLocaleDateString('vi-VN');
  const todayAttendance = attendanceHistory.filter(a => a.date === todayStr); // Giả lập chấm công hôm nay
  const ochaAmount = Number(ochaRevenue?.total_amount || ochaRevenue?.amount || 0);
  const ochaOrders = Number(ochaRevenue?.order_count || ochaRevenue?.orders || 0);
  const manualCash = parseMoneyInput(revCash);
  const manualMomo = parseMoneyInput(revMomo);
  const manualGrab = parseMoneyInput(revGrab);
  const manualShopee = parseMoneyInput(revShopee);
  const manualNonCash = manualMomo + manualGrab + manualShopee;
  const manualDiscount = parseMoneyInput(discount);
  const manualExpenses = parseMoneyInput(expenses);
  const manualActualCash = parseMoneyInput(actualCash);
  const manualTotalRevenue = manualCash + manualNonCash - manualDiscount;
  const revenueDiffVsOcha = ochaAmount > 0 ? manualTotalRevenue - ochaAmount : 0;
  const suggestedCashFromOcha = ochaAmount > 0 ? Math.max(0, ochaAmount + manualDiscount - manualNonCash) : 0;
  const currentExpectedCash = currentOpenShift ? currentOpenShift.opening_cash + manualCash - manualExpenses : 0;
  const currentCashDiff = currentOpenShift ? manualActualCash - currentExpectedCash : 0;
  const formatCurrency = (value) => `${Math.round(Number(value) || 0).toLocaleString('vi-VN')}đ`;
  const formatSyncTime = (value) => {
    if (!value) return 'Chưa có giờ đồng bộ';
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return String(value);
    return parsed.toLocaleString('vi-VN', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' });
  };
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
      return `${formatDateKey(historyRange.start) || '...'} → ${formatDateKey(historyRange.end) || '...'}`;
    }
    return {
      all: 'Tất cả',
      today: 'Hôm nay',
      yesterday: 'Hôm qua',
      month: 'Tháng này',
      lastMonth: 'Tháng trước',
    }[historyPeriod] || 'Tất cả';
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
        note: `Kiểm kho báo cáo ca ${shift.opened_at || shift.id} bởi ${currentUser?.name || 'Nhân viên'}: ${formatQuantity(startStock)} → ${formatQuantity(endStock)} ${inv.unit || ''}`,
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
  const syncCashToOcha = () => {
    if (!ochaAmount) {
      Alert.alert('Chưa có doanh thu Ocha', 'App chưa lấy được doanh thu Ocha của quán hôm nay nên chưa thể tự cân tiền mặt.');
      return;
    }
    setRevCash(String(Math.round(suggestedCashFromOcha)));
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
        Alert.alert('Lỗi mạng', 'Không thể lưu lên máy chủ: ' + error.message);
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

      Alert.alert('Thành công', 'Đã lưu phiếu kiểm kho và cập nhật log kho!');
    } catch(e) {
      Alert.alert('Lỗi ứng dụng', 'Chi tiết: ' + e.message);
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
        if (status !== 'granted') return Alert.alert('Lỗi', 'Cần quyền truy cập camera để chụp ảnh.');
        result = await ImagePicker.launchCameraAsync(compatibleImageOptions);
      } else {
        const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (status !== 'granted') return Alert.alert('Lỗi', 'Cần quyền truy cập thư viện ảnh.');
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
            Alert.alert('Giới hạn ảnh', 'Mỗi phiếu chốt ca nên tối đa 6 ảnh để tránh đầy dung lượng.');
          }
          return merged.slice(0, 6);
        });
      }
    } catch(e) {
      Alert.alert('Lỗi', 'Không thể chọn ảnh: ' + e.message);
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
            reject(new Error('Ảnh đọc được nhưng dung lượng bằng 0 byte.'));
          }
        };
        reader.onerror = () => reject(new Error('Không thể đọc dữ liệu ảnh.'));
        reader.readAsArrayBuffer(xhr.response);
      };
      xhr.onerror = () => reject(new Error('Không thể mở file ảnh trên thiết bị.'));
      xhr.responseType = 'blob';
      xhr.open('GET', uri, true);
      xhr.send(null);
    });
  };

  const uploadReportImage = async (uri) => {
    try {
      const imageBuffer = await readImageAsArrayBuffer(uri);
      if (!imageBuffer?.byteLength) {
        throw new Error('Ảnh đang bị rỗng 0 byte, vui lòng chụp/chọn lại ảnh.');
      }

      const uriWithoutQuery = String(uri).split('?')[0];
      const rawExt = uriWithoutQuery.includes('.') ? uriWithoutQuery.split('.').pop() : 'jpg';
      const normalizedExt = String(rawExt).toLowerCase();
      if (['heic', 'heif'].includes(normalizedExt)) {
        throw new Error('Ảnh HEIC của iPhone chưa upload được. App đã chuyển sang chế độ lấy ảnh JPG; vui lòng chọn/chụp lại ảnh sau khi cập nhật.');
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
      Alert.alert('Lỗi', 'Vui lòng đếm két và nhập "TIỀN TRONG KÉT THỰC ĐẾM" (nhập 0 nếu két trống)!');
      return;
    }

    const rCash = parseMoneyInput(revCash);
    const rMomo = parseMoneyInput(revMomo);
    const rGrab = parseMoneyInput(revGrab);
    const rShopee = parseMoneyInput(revShopee);
    const disc = parseMoneyInput(discount);
    const exp = parseMoneyInput(expenses);
    const aCash = parseMoneyInput(actualCash);

    const expectedCash = currentOpenShift.opening_cash + rCash - exp;
    const discrepancy = aCash - expectedCash;
    const closeManualTotal = rCash + rMomo + rGrab + rShopee - disc;
    const closeRevenueDiff = ochaAmount > 0 ? closeManualTotal - ochaAmount : 0;
    const hasWarning = discrepancy !== 0 || closeRevenueDiff !== 0;

    const confirmMessage = hasWarning
      ? `⚠️ Báo cáo cần kiểm tra lại trước khi nộp\n\nDoanh thu nhân viên nhập: ${formatCurrency(closeManualTotal)}${ochaAmount > 0 ? `\nDoanh thu Ocha: ${formatCurrency(ochaAmount)}\nLệch Ocha: ${formatCurrency(closeRevenueDiff)}` : '\nDoanh thu Ocha: chưa có dữ liệu'}\n\nKét lý thuyết: ${formatCurrency(expectedCash)}\nKét thực đếm: ${formatCurrency(aCash)}\nLệch két: ${formatCurrency(discrepancy)}\n\nBạn vẫn muốn nộp báo cáo không?`
      : `Doanh thu và két đang khớp.\n\nDoanh thu: ${formatCurrency(closeManualTotal)}\nKét thực đếm: ${formatCurrency(aCash)}\n\nBạn có chắc chắn muốn nộp báo cáo doanh thu và chốt két không?`;

    Alert.alert(
      'Xác nhận Chốt Két',
      confirmMessage,
      [
        { text: 'Hủy', style: 'cancel' },
        { text: 'Chốt', style: 'destructive', onPress: async () => {
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
                Alert.alert('Lỗi mạng', 'Không thể lưu dữ liệu: ' + error.message);
                return;
              }

              await syncInventoryCountLogs(finalInvCheck, currentOpenShift);

              setShifts(shifts.map(s => s.id === currentOpenShift.id ? updatedShift : s));

              Alert.alert('Thành công', 'Đã nộp Báo Cáo Doanh Thu (Chốt Ca)!');
              setRevCash(''); setRevMomo(''); setRevGrab(''); setRevShopee(''); setDiscount(''); setExpenses(''); setExpensesNote(''); setActualCash(''); setInventoryCheck({}); setReportImages([]);
              setIsUploading(false);
              try { await AsyncStorage.removeItem(CACHE_KEY); } catch(e){}
            } catch(e) {
              setIsUploading(false);
              const message = e?.message || 'Không thể nộp báo cáo.';
              Alert.alert(message.includes('HEIC') ? 'Ảnh chưa đúng định dạng' : 'Lỗi nộp báo cáo', message);
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
      const updateData = { status: 'CLOSED', approved_by_name: currentUser.name, approved_at: nowStr };
      const { error } = await supabase.from('shifts').update(updateData).eq('id', shift.id);
      if (error) throw error;
      setShifts(shifts.map(s => s.id === shift.id ? { ...s, ...updateData } : s));
      setSelectedShiftForDetail(null);
      
      // Kho đã được đồng bộ khi nhân viên lưu/nộp báo cáo ca bằng log điều chỉnh cố định theo ca.
      
      // Tự động ghi log trừ tiền nếu lệch két âm
      if (shift.discrepancy < 0 && shift.closed_by) {
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
              penalty_money: Math.abs(shift.discrepancy),
              note: `Hệ thống tự trừ tiền do lệch két âm ${Math.abs(shift.discrepancy).toLocaleString('vi-VN')}đ (ca ${shift.opened_at.split(' ')[0]})`
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
          console.log('Lỗi auto log penalty:', err);
        }
      }

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

  const handleRecallShiftReport = async (shift) => {
    Alert.alert(
      'Thu hồi báo cáo',
      'Bạn có chắc chắn muốn thu hồi báo cáo chốt ca này để chỉnh sửa lại không?',
      [
        { text: 'Hủy', style: 'cancel' },
        { 
          text: 'Thu hồi', 
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
              alert('Đã thu hồi báo cáo thành công. Bạn có thể chỉnh sửa lại ở mục Kiểm Kho và Doanh Thu.');
            } catch (e) {
              alert('Lỗi: ' + e.message);
            }
          }
        }
      ]
    );
  };

  const handleRejectShiftReport = async (shift) => {
    Alert.alert(
      'Từ chối báo cáo',
      'Bạn có chắc chắn muốn HỦY chốt ca này và yêu cầu nhân viên làm lại không?',
      [
        { text: 'Bỏ qua', style: 'cancel' },
        { 
          text: 'Từ chối', 
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
              alert('Đã từ chối báo cáo và chuyển lại trạng thái ĐANG MỞ!');
              
              if (shift.closed_by) {
                const targetStaff = staffList.find(s => s.id === shift.closed_by);
                if (targetStaff) {
                  sendPushNotification(targetStaff.push_token, 'Báo cáo bị từ chối', `Quản lý đã yêu cầu làm lại báo cáo chốt ca ngày ${shift.opened_at.split(' ')[0]}.`, {}, targetStaff.id);
                }
              }
            } catch (e) {
              alert('Lỗi: ' + e.message);
            }
          }
        }
      ]
    );
  };

  const handleUndoApproveShiftReport = async (shift) => {
    Alert.alert(
      'Hủy duyệt báo cáo',
      'Bạn có chắc chắn muốn HỦY DUYỆT phiếu chốt ca này? Báo cáo sẽ bị trả về trạng thái ĐANG MỞ để nhân viên làm lại, và khoản phạt lệch két (nếu có) sẽ bị xóa.',
      [
        { text: 'Bỏ qua', style: 'cancel' },
        { 
          text: 'Hủy duyệt', 
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
              alert('Đã hủy duyệt! Phiếu chốt ca đã trở lại trạng thái ĐANG MỞ.');
              
              if (shift.closed_by) {
                const targetStaff = staffList.find(s => s.id === shift.closed_by);
                if (targetStaff) {
                  sendPushNotification(targetStaff.push_token, 'Báo cáo bị hủy duyệt', `Quản lý đã hủy duyệt báo cáo chốt ca ngày ${shift.opened_at.split(' ')[0]} và yêu cầu làm lại.`, {}, targetStaff.id);
                }
              }
            } catch (e) {
              alert('Lỗi: ' + e.message);
            }
          }
        }
      ]
    );
  };

  const renderMoneyInput = (label, value, setter, isHighlight = false, placeholder = '0') => (
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

  const renderHistoryFilter = () => (
    <View style={styles.historyFilterCard}>
      <View style={styles.historyFilterHeader}>
        <View>
          <Text style={styles.historyFilterTitle}>Lọc báo cáo theo ngày nộp</Text>
          <Text style={styles.historyFilterSubtitle}>Đang xem: {historyPeriodLabel()}</Text>
        </View>
        <TouchableOpacity style={styles.historyCalendarBtn} onPress={() => setShowHistoryDateModal(true)}>
          <Ionicons name="calendar-outline" size={18} color={COLORS.primary} />
          <Text style={styles.historyCalendarText}>Tùy chọn</Text>
        </TouchableOpacity>
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.historyQuickRow}>
        {[
          ['all', 'Tất cả'],
          ['today', 'Hôm nay'],
          ['yesterday', 'Hôm qua'],
          ['month', 'Tháng này'],
          ['lastMonth', 'Tháng trước'],
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
          <Text style={styles.emptyHistoryText}>Không có báo cáo trong khoảng thời gian này.</Text>
        </View>
      )}
      {data.map(item => {
        let dateStr = item.opened_at.split(' ')[0];
        let periodStr = item.opened_at.includes('Sáng') ? 'Ca Sáng' : (item.opened_at.includes('Chiều') ? 'Ca Chiều' : '');
        let openTimeStr = item.opened_at.split(' ').pop();
        let closeTimeStr = item.closed_at ? item.closed_at.split(' ').pop() : '';
        let submittedDateStr = getShiftSubmittedDateKey(item);

        let isDiscrepancy = item.discrepancy && item.discrepancy !== 0;

        return (
          <TouchableOpacity key={item.id} style={[styles.historyCard, isDiscrepancy && {borderColor: '#f44336', borderWidth: 2}]} onPress={() => setSelectedShiftForDetail(item)}>
            <View style={{flexDirection: 'row', justifyContent: 'space-between', marginBottom: 10, borderBottomWidth: 1, borderBottomColor: '#eee', paddingBottom: 8}}>
              <Text style={{fontWeight: 'bold', fontSize: 16, color: isDiscrepancy ? '#f44336' : '#1976d2'}}>{dateStr} {periodStr ? `- ${periodStr}` : ''} {isDiscrepancy ? '(Lệch)' : ''}</Text>
              <Text style={{color: COLORS.text, fontWeight: 'bold'}}>{storeList.find(s=>s.id===item.store_id)?.name}</Text>
            </View>
            <Text style={styles.hText}>Mở ca lúc: {openTimeStr} ({item.opened_by_name})</Text>
            <Text style={styles.hText}>Chốt ca lúc: {closeTimeStr} ({item.closed_by_name})</Text>
            <Text style={styles.hText}>Ngày nộp: {formatDateKey(submittedDateStr)}</Text>
            <View style={{backgroundColor: '#f5f5f5', padding: 10, borderRadius: 8, marginTop: 10}}>
              <Text style={{fontWeight: 'bold'}}>TỔNG DOANH THU: {(item.rev_cash + item.rev_momo + item.rev_grab + item.rev_shopee - item.discount).toLocaleString()}đ</Text>
              <Text style={styles.hText}>- Tiền mặt: {item.rev_cash.toLocaleString()}đ</Text>
              <Text style={styles.hText}>- Momo/Grab/Shopee: {(item.rev_momo+item.rev_grab+item.rev_shopee).toLocaleString()}đ</Text>
              <Text style={styles.hText}>- Chi phí: {item.expenses.toLocaleString()}đ ({item.expenses_note || 'Trống'})</Text>
              <View style={{height: 1, backgroundColor: '#ddd', marginVertical: 8}}/>
              <Text style={styles.hText}>Tiền đầu giờ: {item.opening_cash.toLocaleString()}đ</Text>
              <Text style={styles.hText}>Tiền trong két: {item.closing_cash_actual.toLocaleString()}đ</Text>
              <View style={{flexDirection: 'row', justifyContent: 'space-between', marginTop: 10, paddingTop: 10, borderTopWidth: 1, borderColor: COLORS.border}}>
                <Text style={{fontSize: 16, fontWeight: 'bold'}}>Chênh Lệch:</Text>
                <Text style={{fontSize: 16, fontWeight: 'bold', color: item.discrepancy < 0 ? '#f44336' : (item.discrepancy > 0 ? '#4caf50' : '#333')}}>
                  {item.discrepancy > 0 ? '+' : ''}{item.discrepancy.toLocaleString()}đ
                </Text>
              </View>
              {activeTab === 'PENDING' && (
                <Text style={{textAlign: 'center', color: '#f59e0b', fontWeight: 'bold', marginTop: 15, fontSize: 14}}>Trạng thái: Đang chờ duyệt</Text>
              )}
              <Text style={{textAlign: 'center', color: '#1976d2', marginTop: 10, fontSize: 12, fontStyle: 'italic'}}>Chạm để xem chi tiết & thao tác</Text>
            </View>
          </TouchableOpacity>
        );
      })}
    </View>
  );

  const renderDetailModal = () => {
    if (!selectedShiftForDetail) return null;
    const item = selectedShiftForDetail;
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
              <Text style={{fontSize: 18, fontWeight: 'bold', color: '#1976d2'}}>Chi Tiết Báo Cáo Chốt Ca</Text>
              <TouchableOpacity onPress={() => setSelectedShiftForDetail(null)}>
                <Ionicons name="close" size={24} color={isDarkMode ? '#0f172a' : COLORS.text} />
              </TouchableOpacity>
            </View>

            <ScrollView showsVerticalScrollIndicator={false}>
              <View style={{marginBottom: 15}}>
                <Text style={{fontWeight: 'bold'}}>Chi nhánh: {storeList.find(s=>s.id===item.store_id)?.name}</Text>
                <Text>Người mở ca: {item.opened_by_name} lúc {item.opened_at}</Text>
                <Text>Người nộp báo cáo: {item.closed_by_name} lúc {item.closed_at}</Text>
                {item.status === 'CLOSED' && item.approved_by_name && (
                  <Text style={{color: '#4caf50', fontWeight: 'bold'}}>Người duyệt báo cáo: {item.approved_by_name} lúc {item.approved_at}</Text>
                )}
                <Text style={{fontWeight: 'bold', color: item.status === 'CLOSED' ? '#4caf50' : '#f59e0b', marginTop: 5}}>Trạng thái: {item.status === 'CLOSED' ? 'Đã duyệt' : 'Chờ duyệt'}</Text>
              </View>

              <Text style={[styles.sectionTitle, {fontSize: 14}]}>KIỂM KÊ KHO HÀNG</Text>
              {invCheck.length > 0 ? (
                <View style={styles.detailBox}>
                  <View style={{flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: '#eee', paddingBottom: 5, marginBottom: 5}}>
                    <Text style={{flex: 2, fontWeight: 'bold'}}>Mặt hàng</Text>
                    <Text style={{flex: 1, fontWeight: 'bold', textAlign: 'right'}}>Tồn đầu</Text>
                    <Text style={{flex: 1, fontWeight: 'bold', textAlign: 'right'}}>Tồn cuối</Text>
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
                <Text style={[styles.emptyText, {fontStyle: 'italic', marginBottom: 15}]}>Không có dữ liệu kiểm kho</Text>
              )}

              <Text style={[styles.sectionTitle, {fontSize: 14}]}>DOANH THU & KÉT TIỀN</Text>
              <View style={styles.detailBox}>
                <View style={{flexDirection: 'row', justifyContent: 'space-between', marginBottom: 5}}><Text>Tiền mặt (Đầu ca):</Text><Text style={{fontWeight: 'bold'}}>{item.opening_cash.toLocaleString()}đ</Text></View>
                <View style={{flexDirection: 'row', justifyContent: 'space-between', marginBottom: 5}}><Text>Doanh thu Tiền Mặt:</Text><Text style={{fontWeight: 'bold', color: '#1976d2'}}>{item.rev_cash.toLocaleString()}đ</Text></View>
                <View style={{flexDirection: 'row', justifyContent: 'space-between', marginBottom: 5}}><Text>Doanh thu Momo:</Text><Text style={{fontWeight: 'bold', color: '#d82d8b'}}>{item.rev_momo.toLocaleString()}đ</Text></View>
                <View style={{flexDirection: 'row', justifyContent: 'space-between', marginBottom: 5}}><Text>Doanh thu Grab:</Text><Text style={{fontWeight: 'bold', color: '#00a5cf'}}>{item.rev_grab.toLocaleString()}đ</Text></View>
                <View style={{flexDirection: 'row', justifyContent: 'space-between', marginBottom: 5}}><Text>Doanh thu Shopee:</Text><Text style={{fontWeight: 'bold', color: '#ee4d2d'}}>{item.rev_shopee.toLocaleString()}đ</Text></View>
                <View style={{flexDirection: 'row', justifyContent: 'space-between', marginBottom: 5}}><Text>Giảm Bill:</Text><Text style={{fontWeight: 'bold', color: '#f59e0b'}}>-{item.discount.toLocaleString()}đ</Text></View>
                <View style={{flexDirection: 'row', justifyContent: 'space-between', marginBottom: 5}}><Text>Chi phí ({item.expenses_note || 'Trống'}):</Text><Text style={{fontWeight: 'bold', color: '#f44336'}}>-{item.expenses.toLocaleString()}đ</Text></View>
                
                <View style={{height: 1, backgroundColor: '#ddd', marginVertical: 8}}/>
                <View style={{flexDirection: 'row', justifyContent: 'space-between', marginBottom: 5}}><Text>Tiền thực đếm (Két):</Text><Text style={{fontWeight: 'bold', color: '#15803d'}}>{item.closing_cash_actual.toLocaleString()}đ</Text></View>
                <View style={{flexDirection: 'row', justifyContent: 'space-between', marginBottom: 5}}>
                  <Text style={{fontWeight: 'bold'}}>Lệch két:</Text>
                  <Text style={{fontWeight: 'bold', color: item.discrepancy < 0 ? '#f44336' : (item.discrepancy > 0 ? '#4caf50' : '#333')}}>
                    {item.discrepancy > 0 ? '+' : ''}{item.discrepancy.toLocaleString()}đ
                  </Text>
                </View>
              </View>

              {hasReportImages ? (
                <>
                  <Text style={[styles.sectionTitle, {fontSize: 14, marginTop: 10}]}>HÌNH ẢNH BÁO CÁO ({detailReportImageUrls.length || parseReportImages(item.report_image).length})</Text>
                  {isResolvingReportImage ? (
                    <View style={styles.reportImageLoading}>
                      <ActivityIndicator color={COLORS.primary} />
                      <Text style={styles.reportImageLoadingText}>Đang tải ảnh báo cáo...</Text>
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
                              <Text style={styles.detailImageIndex}>Ảnh {index + 1}/{detailReportImageUrls.length}</Text>
                              <TouchableOpacity style={styles.openImageInlineBtn} onPress={() => openReportImageExternally(url)}>
                                <Ionicons name="open-outline" size={16} color={COLORS.primary} style={{marginRight: 6}} />
                                <Text style={styles.openImageInlineText}>Mở ảnh lớn</Text>
                              </TouchableOpacity>
                            </View>
                            {loadState === 'failed' && (
                              <View style={styles.reportImageError}>
                                <Ionicons name="alert-circle-outline" size={28} color="#991b1b" />
                                <Text style={styles.reportImageErrorText}>Ảnh {index + 1} có link nhưng app chưa tải được. Người duyệt không nên duyệt khi chưa xem đủ ảnh.</Text>
                                <TouchableOpacity style={styles.openImageBtn} onPress={() => openReportImageExternally(url)}>
                                  <Text style={styles.openImageBtnText}>Mở ảnh ngoài app</Text>
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
                      <Text style={styles.reportImageErrorText}>Không thể mở ảnh báo cáo. Vui lòng thử tải lại hoặc kiểm tra quyền bucket shift_reports.</Text>
                    </View>
                  )}
                </>
              ) : (
                <View style={styles.reportImageError}>
                  <Ionicons name="image-outline" size={28} color="#991b1b" />
                  <Text style={styles.reportImageErrorText}>Phiếu này chưa có hình ảnh báo cáo. Người duyệt không nên duyệt khi thiếu ảnh.</Text>
                </View>
              )}

            </ScrollView>

            {item.status === 'PENDING_APPROVAL' && (isOwner || currentUser?.permissions?.is_primary_manager) && (
              <>
                <TouchableOpacity style={{backgroundColor: canApproveWithImage ? '#4caf50' : '#9ca3af', padding: 12, borderRadius: 8, alignItems: 'center', marginTop: 10}} onPress={() => {
                  if (!canApproveWithImage) {
                    Alert.alert('Chưa thể duyệt', 'Cần mở và thấy hình ảnh báo cáo trước khi duyệt phiếu chốt ca.');
                    return;
                  }
                  handleApproveShiftReport(item);
                }}>
                  <Text style={{color: '#fff', fontWeight: 'bold'}}>{canApproveWithImage ? 'Duyệt Chốt Ca' : 'Chưa thấy ảnh - chưa thể duyệt'}</Text>
                </TouchableOpacity>
                <TouchableOpacity style={{backgroundColor: '#f59e0b', padding: 12, borderRadius: 8, alignItems: 'center', marginTop: 10}} onPress={() => {
                  handleRejectShiftReport(item);
                }}>
                  <Text style={{color: '#fff', fontWeight: 'bold'}}>Từ Chối (Yêu cầu làm lại)</Text>
                </TouchableOpacity>
              </>
            )}

            {item.status === 'PENDING_APPROVAL' && item.closed_by === currentUser.id && (
              <TouchableOpacity style={{backgroundColor: '#f44336', padding: 12, borderRadius: 8, alignItems: 'center', marginTop: 10}} onPress={() => {
                handleRecallShiftReport(item);
              }}>
                <Text style={{color: '#fff', fontWeight: 'bold'}}>Thu Hồi Báo Cáo</Text>
              </TouchableOpacity>
            )}

            {item.status === 'CLOSED' && (isOwner || currentUser?.permissions?.is_primary_manager) && (
              <TouchableOpacity style={{backgroundColor: '#ef4444', padding: 12, borderRadius: 8, alignItems: 'center', marginTop: 10}} onPress={() => {
                handleUndoApproveShiftReport(item);
              }}>
                <Text style={{color: '#fff', fontWeight: 'bold'}}>Hủy Duyệt (Yêu cầu làm lại)</Text>
              </TouchableOpacity>
            )}

            <TouchableOpacity style={{backgroundColor: '#1976d2', padding: 12, borderRadius: 8, alignItems: 'center', marginTop: 10}} onPress={() => setSelectedShiftForDetail(null)}>
              <Text style={{color: '#fff', fontWeight: 'bold'}}>Đóng</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    );
  };

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{flex: 1}}>
        <View style={styles.headerRow}>
          <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}><Ionicons name="arrow-back" size={24} color={COLORS.text} /></TouchableOpacity>
          <Text style={styles.header}>Báo Cáo Mẫu 16</Text>
        </View>

        <View style={styles.tabContainer}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            <TouchableOpacity style={[styles.tabBtn, activeTab === 'INVENTORY' && styles.tabBtnActive, {paddingHorizontal: 15}]} onPress={() => setActiveTab('INVENTORY')}>
              <Text style={[styles.tabText, activeTab === 'INVENTORY' && styles.tabTextActive]}>Kiểm Kho</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.tabBtn, activeTab === 'CASH' && styles.tabBtnActive, {paddingHorizontal: 15}]} onPress={() => setActiveTab('CASH')}>
              <Text style={[styles.tabText, activeTab === 'CASH' && styles.tabTextActive]}>Két & Doanh Thu</Text>
            </TouchableOpacity>
          {(!isStaff) && (
            <TouchableOpacity style={[styles.tabBtn, activeTab === 'PENDING' && styles.tabBtnActive]} onPress={() => setActiveTab('PENDING')}>
              <Text style={[styles.tabText, activeTab === 'PENDING' && styles.tabTextActive]}>Chờ Duyệt</Text>
            </TouchableOpacity>
          )}
          {(!isStaff) && (
            <TouchableOpacity style={[styles.tabBtn, activeTab === 'HISTORY' && styles.tabBtnActive, {paddingHorizontal: 15}]} onPress={() => setActiveTab('HISTORY')}>
              <Text style={[styles.tabText, activeTab === 'HISTORY' && styles.tabTextActive]}>Lịch Sử</Text>
            </TouchableOpacity>
          )}
          </ScrollView>
        </View>

        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 80 }} style={{ flex: 1, paddingHorizontal: 20 }}>
          {activeTab === 'PENDING' && renderHistoryTab(pendingShifts)}
          {activeTab === 'HISTORY' && renderHistoryTab(historyShifts)}

          {(activeTab === 'INVENTORY' || activeTab === 'CASH') && (!hasCashierPerm ? (
            <View style={{padding: 20, alignItems: 'center', marginTop: 50}}>
              <Ionicons name="lock-closed" size={60} color={COLORS.textMuted} />
              <Text style={{fontSize: 18, color: COLORS.textMuted, marginTop: 15, textAlign: 'center'}}>Bạn không được cấp quyền Thu Ngân / Bán Hàng để thực hiện chức năng này.</Text>
            </View>
          ) : (
            <View>
              {storeIdToView === 'ALL' ? (
                <View style={styles.section}><Text style={{textAlign:'center', color:'#f44336'}}>Vui lòng chọn 1 chi nhánh để Giao Ca!</Text></View>
              ) : !currentOpenShift ? (
                <View style={styles.section}>
                  <View style={{alignItems: 'center', marginBottom: 20}}><MaterialCommunityIcons name="cash-register" size={60} color="#9ca3af" /><Text style={styles.sectionTitle}>CHƯA MỞ CA LÀM VIỆC</Text></View>
                  {renderMoneyInput('Tiền mặt đầu ca có trong két (VNĐ):', openingCash, setOpeningCash, false, 'Nhập số tiền...')}
                  
                  {(() => {
                    const todaysShifts = shifts.filter(s => s.store_id === storeIdToView && s.opened_at.startsWith(todayStr));
                    const hasMorning = todaysShifts.some(s => s.opened_at.includes('(Ca Sáng)'));
                    const hasAfternoon = todaysShifts.some(s => s.opened_at.includes('(Ca Chiều)'));
                    
                    if (hasMorning && hasAfternoon) {
                      return <Text style={{color: '#f44336', textAlign: 'center', marginTop: 15, fontWeight: 'bold'}}>Hôm nay đã mở đủ 2 ca (Sáng & Chiều).</Text>;
                    }

                    const currentHour = new Date().getHours();
                    const isMorningTime = currentHour < 12;

                    return (
                      <View style={{marginTop: 15}}>
                        {isMorningTime ? (
                          !hasMorning ? (
                            <TouchableOpacity style={styles.openBtn} onPress={() => handleOpenShift('Ca Sáng')}>
                              <Text style={styles.btnText}>MỞ CA SÁNG (Trước 12h)</Text>
                            </TouchableOpacity>
                          ) : (
                            <Text style={{color: '#f59e0b', textAlign: 'center', fontStyle: 'italic'}}>Ca Sáng đã được mở. Vui lòng chờ đến sau 12h trưa để mở Ca Chiều.</Text>
                          )
                        ) : (
                          !hasAfternoon ? (
                            <TouchableOpacity style={[styles.openBtn, {backgroundColor: '#f59e0b'}]} onPress={() => handleOpenShift('Ca Chiều')}>
                              <Text style={styles.btnText}>MỞ CA CHIỀU (Sau 12h)</Text>
                            </TouchableOpacity>
                          ) : (
                            <Text style={{color: '#f59e0b', textAlign: 'center', fontStyle: 'italic'}}>Ca Chiều đã được mở.</Text>
                          )
                        )}
                      </View>
                    );
                  })()}
                </View>
              ) : (
                <View>
                  <View style={[styles.section, styles.openShiftBanner]}>
                    <Text style={styles.openShiftTitle}>🟢 ĐANG TRONG CA: {storeList.find(s=>s.id===storeIdToView)?.name}</Text>
                    <Text style={styles.openShiftMeta}>Mở lúc: {currentOpenShift.opened_at} bởi {currentOpenShift.opened_by_name}</Text>
                  </View>

                  {/* PHẦN 1: KIỂM KHO */}
                  {activeTab === 'INVENTORY' && (
                  <View style={styles.section}>
                    <Text style={styles.sectionTitle}>PHẦN 1: KIỂM KÊ KHO HÀNG</Text>
                    <View style={styles.tableHeader}>
                      <Text style={[styles.cell, {flex: 2}]}>Tên Hàng</Text>
                      <Text style={[styles.cell, {flex: 1}]}>Tồn Đầu</Text>
                      <Text style={[styles.cell, {flex: 1.5}]}>Tồn Cuối</Text>
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

                  {/* PHẦN 2: DOANH THU & KÉT */}
                  {activeTab === 'CASH' && (
                  <View style={styles.section}>
                    <Text style={styles.sectionTitle}>PHẦN 2: DOANH THU & KÉT TIỀN</Text>
                    <Text style={styles.infoText}>Tiền đầu giờ (1): {currentOpenShift.opening_cash.toLocaleString()}đ</Text>

                    <View style={styles.ochaCard}>
                      <View style={styles.ochaHeader}>
                        <View>
                          <Text style={styles.ochaTitle}>Đối chiếu Ocha hôm nay</Text>
                          <Text style={styles.ochaMeta}>{storeList.find(s=>s.id===storeIdToView)?.name || 'Chi nhánh'} · {ochaDateKey}</Text>
                        </View>
                        {isLoadingOcha ? <ActivityIndicator color={COLORS.primary} /> : <Ionicons name={ochaAmount > 0 ? 'checkmark-circle' : 'alert-circle'} size={24} color={ochaAmount > 0 ? '#16a34a' : '#f59e0b'} />}
                      </View>

                      {isLoadingOcha ? (
                        <Text style={styles.ochaHint}>Đang tải doanh thu Ocha...</Text>
                      ) : ochaAmount > 0 ? (
                        <>
                          <View style={styles.ochaGrid}>
                            <View style={styles.ochaMetric}>
                              <Text style={styles.ochaMetricLabel}>Ocha</Text>
                              <Text style={styles.ochaMetricValue}>{formatCurrency(ochaAmount)}</Text>
                              <Text style={styles.ochaMetricSub}>{ochaOrders.toLocaleString('vi-VN')} đơn · {formatSyncTime(ochaRevenue?.updated_at || ochaRevenue?.synced_at || ochaRevenue?.created_at)}</Text>
                            </View>
                            <View style={styles.ochaMetric}>
                              <Text style={styles.ochaMetricLabel}>Nhân viên nhập</Text>
                              <Text style={styles.ochaMetricValue}>{formatCurrency(manualTotalRevenue)}</Text>
                              <Text style={[styles.ochaMetricSub, revenueDiffVsOcha === 0 ? styles.okText : styles.dangerText]}>
                                Lệch Ocha: {formatCurrency(revenueDiffVsOcha)}
                              </Text>
                            </View>
                          </View>
                          <View style={styles.ochaSuggestion}>
                            <View style={{flex: 1}}>
                              <Text style={styles.ochaMetricLabel}>Tiền mặt gợi ý theo Ocha</Text>
                              <Text style={styles.ochaMetricValue}>{formatCurrency(suggestedCashFromOcha)}</Text>
                              <Text style={styles.ochaMetricSub}>Ocha + giảm bill - Momo/Grab/Shopee</Text>
                            </View>
                            <TouchableOpacity style={styles.ochaSyncBtn} onPress={syncCashToOcha}>
                              <Ionicons name="sync" size={16} color="#fff" style={{marginRight: 6}} />
                              <Text style={styles.ochaSyncBtnText}>Cân tiền mặt</Text>
                            </TouchableOpacity>
                          </View>
                          <View style={styles.ochaDrawerLine}>
                            <Text style={styles.ochaDrawerText}>Két lý thuyết: {formatCurrency(currentExpectedCash)}</Text>
                            <Text style={[styles.ochaDrawerText, currentCashDiff === 0 ? styles.okText : styles.dangerText]}>Lệch két hiện tại: {formatCurrency(currentCashDiff)}</Text>
                          </View>
                        </>
                      ) : (
                        <View style={styles.ochaWarning}>
                          <Ionicons name="warning-outline" size={20} color="#b45309" style={{marginRight: 8}} />
                          <Text style={styles.ochaWarningText}>Chưa có dữ liệu Ocha của quán hôm nay. Vẫn có thể chốt ca, nhưng nên kiểm tra lại phần đồng bộ Ocha trước khi duyệt.</Text>
                        </View>
                      )}
                    </View>

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

                    <View style={styles.previewBox}>
                      <Text style={styles.previewTitle}>Xem Trước Báo Cáo:</Text>
                      <Text style={styles.previewText}>Doanh thu tổng: {formatCurrency(manualTotalRevenue)}</Text>
                      {ochaAmount > 0 && <Text style={[styles.previewText, revenueDiffVsOcha === 0 ? styles.okText : styles.dangerText]}>Lệch so với Ocha: {formatCurrency(revenueDiffVsOcha)}</Text>}
                      <Text style={styles.previewText}>Két lý thuyết: {formatCurrency(currentExpectedCash)}</Text>
                      <Text style={[styles.previewText, currentCashDiff === 0 ? styles.okText : styles.dangerText]}>Lệch két: {formatCurrency(currentCashDiff)}</Text>
                    </View>

                    <View style={{marginTop: 15, marginBottom: 10}}>
                      <Text style={[styles.label, {marginTop: 0}]}>Hình ảnh báo cáo (Tùy chọn):</Text>
                      {reportImages.length > 0 && (
                        <View style={styles.selectedImagesGrid}>
                          {reportImages.map((uri, index) => (
                            <View key={`${uri}_${index}`} style={styles.selectedImageWrap}>
                              <Image source={{uri}} style={styles.selectedReportImage} />
                              <Text style={styles.selectedImageLabel}>Ảnh {index + 1}/{reportImages.length}</Text>
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
                          <Text style={styles.mediaBtnText}>{reportImages.length > 0 ? 'Chụp thêm' : 'Chụp ảnh'}</Text>
                        </TouchableOpacity>
                        <TouchableOpacity style={styles.mediaBtn} onPress={() => handlePickImage(false)}>
                          <Ionicons name="image" size={20} color="#4f46e5" style={{marginRight: 5}}/>
                          <Text style={styles.mediaBtnText}>{reportImages.length > 0 ? 'Thêm từ thư viện' : 'Thư viện'}</Text>
                        </TouchableOpacity>
                      </View>
                      <Text style={styles.imageHelperText}>Tối đa 6 ảnh/phiếu. Ảnh sẽ giữ nguyên khung, không crop nội dung.</Text>
                    </View>
                  </View>
                  )}

                  {/* PHẦN 3: CHẤM CÔNG */}
                  {activeTab === 'CASH' && (
                  <View style={styles.section}>
                    <Text style={styles.sectionTitle}>PHẦN 3: CHẤM CÔNG CA</Text>
                    {todayAttendance.length > 0 ? todayAttendance.map(a => (
                      <Text key={a.id} style={styles.attendanceText}>• Nhân viên {a.user_id}: Vào {a.checkIn} - Ra {a.checkOut || 'Chưa ra'}</Text>
                    )) : <Text style={styles.emptyText}>Chưa có dữ liệu chấm công hôm nay.</Text>}
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
              <Text style={styles.btnText}>LƯU PHIẾU KIỂM KHO</Text>
            </TouchableOpacity>
          </View>
        )}

        {activeTab === 'CASH' && currentOpenShift && storeIdToView !== 'ALL' && (
          <View style={styles.fixedBottomBar}>
            <TouchableOpacity style={[styles.closeBtnFixed, isUploading && {backgroundColor: '#9e9e9e'}]} onPress={handleCloseShift} disabled={isUploading}>
              {isUploading ? (
                <View style={{flexDirection: 'row', alignItems: 'center'}}>
                  <ActivityIndicator size="small" color="#fff" style={{marginRight: 10}} />
                  <Text style={styles.btnText}>ĐANG XỬ LÝ...</Text>
                </View>
              ) : (
                <Text style={styles.btnText}>XÁC NHẬN NỘP DOANH THU (CHỐT CA)</Text>
              )}
            </TouchableOpacity>
          </View>
        )}
      </KeyboardAvoidingView>
      {renderDetailModal()}
      <DateRangePickerModal
        visible={showHistoryDateModal}
        onClose={() => setShowHistoryDateModal(false)}
        onApply={applyHistoryRange}
        initialStartDate={historyRange.start}
        initialEndDate={historyRange.end}
        COLORS={COLORS}
        isDarkMode={isDarkMode}
        title="Chọn ngày xem lịch sử chốt ca"
      />
    </SafeAreaView>
  );
}

const getStyles = (COLORS, isDarkMode) => StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.bg, paddingHorizontal: 20 },
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
  section: { backgroundColor: COLORS.card, padding: 20, borderRadius: 12, marginBottom: 20, elevation: 3, borderWidth: 1, borderColor: COLORS.border },
  sectionTitle: { fontSize: 16, fontWeight: '900', marginBottom: 15, color: COLORS.primary },
  label: { fontSize: 13, fontWeight: 'bold', color: COLORS.text, marginBottom: 5, marginTop: 10 },
  input: { borderWidth: 1, borderColor: COLORS.inputBorder, borderRadius: 8, padding: 10, fontSize: 14, backgroundColor: COLORS.inputBg, color: COLORS.text, marginBottom: 5 },
  smallInput: { borderWidth: 1, borderColor: COLORS.inputBorder, backgroundColor: COLORS.inputBg, color: COLORS.text, borderRadius: 4, padding: 5, fontSize: 13, textAlign: 'center' },
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
  infoText: { fontSize: 14, fontWeight: 'bold', marginBottom: 10, color: COLORS.text },
  ochaCard: { backgroundColor: isDarkMode ? '#0f172a' : '#f8fafc', borderWidth: 1, borderColor: isDarkMode ? '#334155' : '#e2e8f0', padding: 12, borderRadius: 12, marginBottom: 14 },
  ochaHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
  ochaTitle: { color: COLORS.text, fontWeight: '900', fontSize: 15 },
  ochaMeta: { color: COLORS.textMuted, marginTop: 3, fontSize: 12 },
  ochaHint: { color: COLORS.textMuted, fontStyle: 'italic' },
  ochaGrid: { flexDirection: 'row', gap: 10 },
  ochaMetric: { flex: 1, backgroundColor: isDarkMode ? '#111827' : '#fff', borderWidth: 1, borderColor: COLORS.border, borderRadius: 10, padding: 10 },
  ochaMetricLabel: { color: COLORS.textMuted, fontSize: 12, fontWeight: '700' },
  ochaMetricValue: { color: COLORS.text, fontSize: 18, fontWeight: '900', marginTop: 3 },
  ochaMetricSub: { color: COLORS.textMuted, fontSize: 11, marginTop: 3 },
  ochaSuggestion: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: isDarkMode ? '#052e16' : '#ecfdf5', borderWidth: 1, borderColor: isDarkMode ? '#166534' : '#bbf7d0', borderRadius: 10, padding: 10, marginTop: 10 },
  ochaSyncBtn: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#16a34a', paddingVertical: 10, paddingHorizontal: 12, borderRadius: 9 },
  ochaSyncBtnText: { color: '#fff', fontWeight: '900', fontSize: 12 },
  ochaDrawerLine: { borderTopWidth: 1, borderTopColor: COLORS.border, marginTop: 10, paddingTop: 10, gap: 4 },
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
  tableHeader: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: COLORS.border, paddingBottom: 5, marginBottom: 5 },
  tableRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: COLORS.border },
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
  modalContainer: { width: '100%', maxHeight: '80%', backgroundColor: isDarkMode ? '#f8fafc' : COLORS.card, borderRadius: 12, padding: 20, elevation: 5, borderWidth: 1, borderColor: COLORS.border }
});
