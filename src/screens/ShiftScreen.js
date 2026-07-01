import React, { useState, useContext, useEffect, useMemo } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, TextInput, SafeAreaView, KeyboardAvoidingView, Platform, Alert, Modal, Image, ActivityIndicator } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as ImagePicker from 'expo-image-picker';
import { AppContext } from '../context/AppContext';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { supabase } from '../services/supabaseClient';
import { sendPushNotification } from '../services/NotificationService';

export default function ShiftScreen({ navigation }) {
  const { currentUser, staffList, shifts, setShifts, selectedStoreId, storeList, inventoryItems, setInventoryItems, attendanceHistory, payrollAdjustments, setPayrollAdjustments, inventoryLogs, COLORS, isDarkMode } = useContext(AppContext);
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
  const [reportImage, setReportImage] = useState(null);
  const [isUploading, setIsUploading] = useState(false);

  const CACHE_KEY = `SHIFT_DRAFT_${storeIdToView}`;

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

  const storeInventory = inventoryItems.filter(i => i.store_id === storeIdToView);
  const todayStr = new Date().toLocaleDateString('vi-VN');
  const todayAttendance = attendanceHistory.filter(a => a.date === todayStr); // Giả lập chấm công hôm nay

  const handleSaveInventory = async () => {
    try {
      // Build inventory check data
      const finalInvCheck = storeInventory.map(item => {
        const endStock = inventoryCheck[item.id] !== undefined && inventoryCheck[item.id] !== '' ? Number(inventoryCheck[item.id]) : 0;
        return { item_id: item.id, name: item.name, unit: item.unit, end: endStock };
      });

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

      // Update global inventory stock based on inventory check
      const updatedInventoryItems = inventoryItems.map(item => {
        if (item.store_id === storeIdToView && inventoryCheck[item.id] !== undefined && inventoryCheck[item.id] !== '') {
          return { ...item, quantity: Number(inventoryCheck[item.id]) };
        }
        return item;
      });
      setInventoryItems(updatedInventoryItems);

      Alert.alert('Thành công', 'Đã lưu phiếu kiểm kho!');
    } catch(e) {
      Alert.alert('Lỗi ứng dụng', 'Chi tiết: ' + e.message);
    }
  };

  const handlePickImage = async (useCamera) => {
    try {
      let result;
      if (useCamera) {
        const { status } = await ImagePicker.requestCameraPermissionsAsync();
        if (status !== 'granted') return Alert.alert('Lỗi', 'Cần quyền truy cập camera để chụp ảnh.');
        result = await ImagePicker.launchCameraAsync({ allowsEditing: true, quality: 0.5 });
      } else {
        const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (status !== 'granted') return Alert.alert('Lỗi', 'Cần quyền truy cập thư viện ảnh.');
        result = await ImagePicker.launchImageLibraryAsync({ allowsEditing: true, quality: 0.5 });
      }
      
      if (!result.canceled && result.assets && result.assets.length > 0) {
        setReportImage(result.assets[0].uri);
      }
    } catch(e) {
      Alert.alert('Lỗi', 'Không thể chọn ảnh: ' + e.message);
    }
  };

  const uploadReportImage = async (uri) => {
    try {
      const response = await fetch(uri);
      const blob = await response.blob();
      const fileExt = uri.split('.').pop() || 'jpg';
      const fileName = `${Date.now()}_${Math.floor(Math.random()*1000)}.${fileExt}`;
      const filePath = `${storeIdToView}/${fileName}`;

      const { data, error } = await supabase.storage.from('shift_reports').upload(filePath, blob, {
        contentType: 'image/jpeg',
      });
      if (error) throw error;
      
      const { data: { publicUrl } } = supabase.storage.from('shift_reports').getPublicUrl(filePath);
      return publicUrl;
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

    const confirmMessage = discrepancy !== 0 
      ? `⚠️ CA CỦA BẠN ĐANG LỆCH KÉT!\n\nTiền lý thuyết: ${expectedCash.toLocaleString()}đ\nTiền thực đếm: ${aCash.toLocaleString()}đ\nLệch: ${discrepancy.toLocaleString()}đ\n\nBạn có chắc chắn muốn nộp báo cáo không?`
      : 'Bạn có chắc chắn muốn nộp báo cáo doanh thu và chốt két không?';

    Alert.alert(
      'Xác nhận Chốt Két',
      confirmMessage,
      [
        { text: 'Hủy', style: 'cancel' },
        { text: 'Chốt', style: 'destructive', onPress: async () => {
            try {
              setIsUploading(true);
              let imageUrl = null;
              if (reportImage) {
                imageUrl = await uploadReportImage(reportImage);
              }

              const finalInvCheck = currentOpenShift.inventory_check || [];

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

              setShifts(shifts.map(s => s.id === currentOpenShift.id ? updatedShift : s));

              Alert.alert('Thành công', 'Đã nộp Báo Cáo Doanh Thu (Chốt Ca)!');
              setRevCash(''); setRevMomo(''); setRevGrab(''); setRevShopee(''); setDiscount(''); setExpenses(''); setExpensesNote(''); setActualCash(''); setInventoryCheck({}); setReportImage(null);
              setIsUploading(false);
              try { await AsyncStorage.removeItem(CACHE_KEY); } catch(e){}
            } catch(e) {
              setIsUploading(false);
              Alert.alert('Lỗi ứng dụng', 'Chi tiết: ' + e.message);
            }
          }
        }
      ]
    );
  };

  const historyShifts = shifts.filter(s => s.status === 'CLOSED' && (storeIdToView === 'ALL' || s.store_id === storeIdToView)).reverse();
  const pendingShifts = shifts.filter(s => s.status === 'PENDING_APPROVAL' && (storeIdToView === 'ALL' || s.store_id === storeIdToView)).reverse();

  const handleApproveShiftReport = async (shift) => {
    try {
      const nowStr = new Date().toLocaleTimeString('vi-VN', {hour: '2-digit', minute:'2-digit'}) + ' ' + new Date().toLocaleDateString('vi-VN');
      const updateData = { status: 'CLOSED', approved_by_name: currentUser.name, approved_at: nowStr };
      const { error } = await supabase.from('shifts').update(updateData).eq('id', shift.id);
      if (error) throw error;
      setShifts(shifts.map(s => s.id === shift.id ? { ...s, ...updateData } : s));
      setSelectedShiftForDetail(null);
      
      // Tự động ghi log trừ kho
      if (shift.inventory_check && shift.inventory_check.length > 0) {
        try {
          const logsToInsert = [];
          const d = new Date();
          const localDateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
          
          for (const inv of shift.inventory_check) {
            const itemLogs = inventoryLogs.filter(l => l.itemId === inv.id && l.store_id === shift.store_id);
            const currentStock = itemLogs.reduce((acc, curr) => {
              if (curr.type === 'IMPORT' || curr.type === 'ADJUST_UP') return acc + curr.amount;
              if (curr.type === 'EXPORT' || curr.type === 'ADJUST_DOWN') return acc - curr.amount;
              return acc;
            }, 0);

            const difference = currentStock - inv.end;
            if (difference > 0) {
              logsToInsert.push({
                id: `log_shift_${shift.id}_${inv.id}_exp_${Date.now()}`,
                itemId: inv.id,
                type: 'EXPORT',
                amount: difference,
                date: localDateStr,
                store_id: shift.store_id
              });
            } else if (difference < 0) {
              logsToInsert.push({
                id: `log_shift_${shift.id}_${inv.id}_adj_${Date.now()}`,
                itemId: inv.id,
                type: 'ADJUST_UP',
                amount: Math.abs(difference),
                date: localDateStr,
                store_id: shift.store_id
              });
            }
          }
          if (logsToInsert.length > 0) {
            await supabase.from('inventory_logs').insert(logsToInsert);
          }
        } catch(e) {
          console.error("Lỗi khi đồng bộ kho:", e);
        }
      }
      
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

  const renderHistoryTab = (data) => (
    <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 80 }}>
      {data.map(item => {
        let dateStr = item.opened_at.split(' ')[0];
        let periodStr = item.opened_at.includes('Sáng') ? 'Ca Sáng' : (item.opened_at.includes('Chiều') ? 'Ca Chiều' : '');
        let openTimeStr = item.opened_at.split(' ').pop();
        let closeTimeStr = item.closed_at ? item.closed_at.split(' ').pop() : '';

        let isDiscrepancy = item.discrepancy && item.discrepancy !== 0;

        return (
          <TouchableOpacity key={item.id} style={[styles.historyCard, isDiscrepancy && {borderColor: '#f44336', borderWidth: 2}]} onPress={() => setSelectedShiftForDetail(item)}>
            <View style={{flexDirection: 'row', justifyContent: 'space-between', marginBottom: 10, borderBottomWidth: 1, borderBottomColor: '#eee', paddingBottom: 8}}>
              <Text style={{fontWeight: 'bold', fontSize: 16, color: isDiscrepancy ? '#f44336' : '#1976d2'}}>{dateStr} {periodStr ? `- ${periodStr}` : ''} {isDiscrepancy ? '(Lệch)' : ''}</Text>
              <Text style={{color: COLORS.text, fontWeight: 'bold'}}>{storeList.find(s=>s.id===item.store_id)?.name}</Text>
            </View>
            <Text style={styles.hText}>Mở ca lúc: {openTimeStr} ({item.opened_by_name})</Text>
            <Text style={styles.hText}>Chốt ca lúc: {closeTimeStr} ({item.closed_by_name})</Text>
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
    </ScrollView>
  );

  const renderDetailModal = () => {
    if (!selectedShiftForDetail) return null;
    const item = selectedShiftForDetail;
    const invCheck = item.inventory_check || [];

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
                    <Text style={{flex: 1, fontWeight: 'bold', textAlign: 'right'}}>Tồn Cuối</Text>
                  </View>
                  {invCheck.map((inv, idx) => (
                    <View key={idx} style={{flexDirection: 'row', paddingVertical: 5, borderBottomWidth: 1, borderBottomColor: '#f3f4f6'}}>
                      <Text style={{flex: 2}}>{inv.name}</Text>
                      <Text style={{flex: 1, textAlign: 'right', fontWeight: 'bold'}}>{inv.end} {inv.unit}</Text>
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

              {item.report_image ? (
                <>
                  <Text style={[styles.sectionTitle, {fontSize: 14, marginTop: 10}]}>HÌNH ẢNH BÁO CÁO</Text>
                  <Image source={{uri: item.report_image}} style={{width: '100%', height: 250, borderRadius: 8, marginBottom: 15, resizeMode: 'cover'}} />
                </>
              ) : null}

            </ScrollView>

            {item.status === 'PENDING_APPROVAL' && (isOwner || currentUser?.permissions?.is_primary_manager) && (
              <>
                <TouchableOpacity style={{backgroundColor: '#4caf50', padding: 12, borderRadius: 8, alignItems: 'center', marginTop: 10}} onPress={() => {
                  handleApproveShiftReport(item);
                }}>
                  <Text style={{color: '#fff', fontWeight: 'bold'}}>Duyệt Chốt Ca</Text>
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
                  )}

                  {/* PHẦN 2: DOANH THU & KÉT */}
                  {activeTab === 'CASH' && (
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

                    <View style={styles.previewBox}>
                      <Text style={styles.previewTitle}>Xem Trước Báo Cáo:</Text>
                      <Text style={styles.previewText}>Doanh thu tổng: {(parseMoneyInput(revCash) + parseMoneyInput(revMomo) + parseMoneyInput(revGrab) + parseMoneyInput(revShopee) - parseMoneyInput(discount)).toLocaleString()}đ</Text>
                      <Text style={styles.previewText}>Lệch két: {(parseMoneyInput(actualCash) - (currentOpenShift.opening_cash + parseMoneyInput(revCash) - parseMoneyInput(expenses))).toLocaleString()}đ</Text>
                    </View>

                    <View style={{marginTop: 15, marginBottom: 10}}>
                      <Text style={[styles.label, {marginTop: 0}]}>Hình ảnh báo cáo (Tùy chọn):</Text>
                      {reportImage ? (
                        <View style={{position: 'relative', marginTop: 10}}>
                          <Image source={{uri: reportImage}} style={{width: '100%', height: 200, borderRadius: 8, resizeMode: 'cover'}} />
                          <TouchableOpacity style={{position: 'absolute', top: 10, right: 10, backgroundColor: 'rgba(0,0,0,0.5)', padding: 8, borderRadius: 20}} onPress={() => setReportImage(null)}>
                            <Ionicons name="close" size={20} color="#fff" />
                          </TouchableOpacity>
                        </View>
                      ) : (
                        <View style={{flexDirection: 'row', gap: 10, marginTop: 5}}>
                          <TouchableOpacity style={styles.mediaBtn} onPress={() => handlePickImage(true)}>
                            <Ionicons name="camera" size={20} color="#4f46e5" style={{marginRight: 5}}/>
                            <Text style={styles.mediaBtnText}>Chụp ảnh</Text>
                          </TouchableOpacity>
                          <TouchableOpacity style={styles.mediaBtn} onPress={() => handlePickImage(false)}>
                            <Ionicons name="image" size={20} color="#4f46e5" style={{marginRight: 5}}/>
                            <Text style={styles.mediaBtnText}>Thư viện</Text>
                          </TouchableOpacity>
                        </View>
                      )}
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
  historyCard: { backgroundColor: COLORS.card, borderWidth: 1, borderColor: COLORS.border, padding: 15, borderRadius: 10, marginBottom: 15 },
  hText: { color: COLORS.textMuted, marginBottom: 3, fontSize: 13 },
  infoText: { fontSize: 14, fontWeight: 'bold', marginBottom: 10, color: COLORS.text },
  openShiftBanner: { backgroundColor: isDarkMode ? '#0f2a1d' : '#e8f5e9', borderColor: isDarkMode ? '#166534' : '#bbf7d0' },
  openShiftTitle: { color: isDarkMode ? '#86efac' : '#2e7d32', fontWeight: 'bold' },
  openShiftMeta: { color: COLORS.textMuted, marginTop: 4 },
  previewBox: { backgroundColor: isDarkMode ? '#3b2a11' : '#fff3e0', padding: 10, borderRadius: 8, marginTop: 15 },
  previewTitle: { fontWeight: 'bold', marginBottom: 5, color: COLORS.text },
  previewText: { color: COLORS.text, marginTop: 2 },
  mediaBtn: { flex: 1, backgroundColor: isDarkMode ? '#1e1b4b' : '#e0e7ff', padding: 12, borderRadius: 8, alignItems: 'center', flexDirection: 'row', justifyContent: 'center', borderWidth: 1, borderColor: isDarkMode ? '#3730a3' : '#c7d2fe' },
  mediaBtnText: { color: isDarkMode ? '#c7d2fe' : '#4f46e5', fontWeight: 'bold' },
  attendanceText: { marginBottom: 5, color: COLORS.text },
  emptyText: { color: COLORS.textMuted },
  tableHeader: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: COLORS.border, paddingBottom: 5, marginBottom: 5 },
  tableRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: COLORS.border },
  cell: { fontSize: 13, color: COLORS.text },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center', padding: 20 },
  detailBox: { backgroundColor: isDarkMode ? '#f8fafc' : '#f9fafb', padding: 10, borderRadius: 8, marginBottom: 15 },
  modalContainer: { width: '100%', maxHeight: '80%', backgroundColor: isDarkMode ? '#f8fafc' : COLORS.card, borderRadius: 12, padding: 20, elevation: 5, borderWidth: 1, borderColor: COLORS.border }
});
