import React, { useContext, useState, useMemo } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, SafeAreaView, RefreshControl, Modal, TextInput, Alert, KeyboardAvoidingView, Platform, Dimensions } from 'react-native';
import { AppContext } from '../context/AppContext';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../services/supabaseClient';
import { sendPushNotification } from '../services/NotificationService';
import { exportToExcel } from '../utils/exportExcel';

const IS_COMPACT_WEB = Platform.OS === 'web' && Dimensions.get('window').width <= 430;

export default function PayrollScreen({ navigation }) {
  const { currentUser, attendanceHistory, staffList, payrollAdjustments, setPayrollAdjustments, payrollApprovals, setPayrollApprovals, refreshData, isDataLoading, COLORS, isDarkMode } = useContext(AppContext);
  const styles = useMemo(() => getStyles(COLORS, isDarkMode), [COLORS, isDarkMode]);
  
  const isOwner = currentUser?.role === 'OWNER';
  const isManager = currentUser?.role === 'MANAGER';
  const isStaff = currentUser?.role === 'STAFF';

  // State chá»n thÃ¡ng
  const [monthOffset, setMonthOffset] = useState(0);

  // Láº¥y thÃ´ng tin thÃ¡ng Ä‘Æ°á»£c chá»n
  const getSelectedMonthInfo = () => {
    const d = new Date();
    d.setMonth(d.getMonth() + monthOffset);
    return {
      year: d.getFullYear(),
      month: d.getMonth() + 1, // 1-12
      label: `ThÃ¡ng ${d.getMonth() + 1} / ${d.getFullYear()}`
    };
  };

  const selectedMonth = getSelectedMonthInfo();
  const targetMonthStr = `${selectedMonth.year}-${String(selectedMonth.month).padStart(2, '0')}`;

  // Gom nhÃ³m dá»¯ liá»‡u cháº¥m cÃ´ng theo nhÃ¢n viÃªn cho thÃ¡ng Ä‘Æ°á»£c chá»n
  const payrollData = useMemo(() => {
    const monthlyRecords = attendanceHistory.filter(r => r.date && r.date.startsWith(targetMonthStr) && r.hours > 0);

    const grouped = {};
    monthlyRecords.forEach(record => {
      if (!grouped[record.user_id]) {
        grouped[record.user_id] = { totalHours: 0, records: [] };
      }
      grouped[record.user_id].totalHours += Number(record.hours || 0);
      grouped[record.user_id].records.push(record);
    });

    const result = [];
    staffList.forEach(staff => {
      if (isStaff && staff.id !== currentUser.id) return;

      const data = grouped[staff.id] || { totalHours: 0, records: [] };
      const wage = staff.wage || 0; 
      
      const allAdjs = payrollAdjustments?.filter(a => a.user_id === staff.id && a.month === targetMonthStr) || [];
      const manualAdj = allAdjs.find(a => a.id.startsWith('adj_manual_')) || { bonus_hours: 0, bonus_money: 0, penalty_money: 0, note: '' };
      
      const autoAdjs = allAdjs.filter(a => !a.id.startsWith('adj_manual_'));
      const autoPenaltyTotal = autoAdjs.reduce((sum, a) => sum + Number(a.penalty_money || 0), 0);
      const autoNotes = autoAdjs.filter(a => a.note).map(a => '- ' + a.note).join('\n');
      
      const combinedAdj = {
        bonus_hours: Number(manualAdj.bonus_hours || 0),
        bonus_money: Number(manualAdj.bonus_money || 0),
        penalty_money: Number(manualAdj.penalty_money || 0) + autoPenaltyTotal,
        manual_penalty: Number(manualAdj.penalty_money || 0),
        auto_penalty: autoPenaltyTotal,
        note: manualAdj.note || '',
        auto_note: autoNotes
      };
      
      const apprv = payrollApprovals?.find(a => a.user_id === staff.id && a.month === targetMonthStr) || {
        staff_confirmed: false, manager_confirmed: false, owner_confirmed: false, status: 'DRAFT'
      };

      const bonusHours = Number(combinedAdj.bonus_hours || 0);
      const bonusMoney = Number(combinedAdj.bonus_money || 0);
      const manualPenalty = Number(combinedAdj.manual_penalty || 0);
      const autoPenalty = Number(combinedAdj.auto_penalty || 0);
      const totalPenalty = manualPenalty + autoPenalty;
      const finalHours = data.totalHours + bonusHours;
      const baseSalary = data.totalHours * wage;
      const bonusHoursSalary = bonusHours * wage;
      const grossSalary = baseSalary + bonusHoursSalary + bonusMoney;
      const netSalary = grossSalary - totalPenalty;

      result.push({
        ...staff,
        totalHours: data.totalHours,
        finalHours: finalHours,
        baseSalary,
        bonusHoursSalary,
        grossSalary,
        bonusMoney,
        manualPenalty,
        autoPenalty,
        totalPenalty,
        totalSalary: netSalary > 0 ? netSalary : 0,
        recordsCount: data.records.length,
        records: data.records.sort((a, b) => a.date.localeCompare(b.date)),
        adjustment: combinedAdj,
        approval: apprv
      });
    });

    return result.sort((a, b) => b.totalSalary - a.totalSalary);

  }, [attendanceHistory, staffList, payrollAdjustments, payrollApprovals, targetMonthStr, isStaff, currentUser.id]);

  const payrollSummary = useMemo(() => {
    return payrollData.reduce((summary, item) => ({
      totalNet: summary.totalNet + Number(item.totalSalary || 0),
      totalGross: summary.totalGross + Number(item.grossSalary || 0),
      totalPenalty: summary.totalPenalty + Number(item.totalPenalty || 0),
      totalHours: summary.totalHours + Number(item.finalHours || 0),
      totalStaff: summary.totalStaff + 1,
      finalized: summary.finalized + (item.approval?.owner_confirmed ? 1 : 0),
    }), { totalNet: 0, totalGross: 0, totalPenalty: 0, totalHours: 0, totalStaff: 0, finalized: 0 });
  }, [payrollData]);

  // Expand detail
  const [expandedUser, setExpandedUser] = useState(null);

  // Modal Äiá»u Chá»‰nh ThÆ°á»Ÿng Pháº¡t
  const [showAdjModal, setShowAdjModal] = useState(false);
  const [adjTarget, setAdjTarget] = useState(null); 
  const [editBonusHours, setEditBonusHours] = useState('0');
  const [editBonusMoney, setEditBonusMoney] = useState('0');
  const [editPenaltyMoney, setEditPenaltyMoney] = useState('0');
  const [editNote, setEditNote] = useState('');
  const [isSavingAdj, setIsSavingAdj] = useState(false);

  const openAdjustmentModal = (staffItem) => {
    setAdjTarget(staffItem);
    setEditBonusHours(String(staffItem.adjustment?.bonus_hours || 0));
    setEditBonusMoney(String(staffItem.adjustment?.bonus_money || 0));
    setEditPenaltyMoney(String(staffItem.adjustment?.manual_penalty || 0));
    setEditNote(staffItem.adjustment?.note || '');
    setShowAdjModal(true);
  };

  const handleSaveAdjustment = async () => {
    setIsSavingAdj(true);
    const newAdj = {
      id: `adj_manual_${Date.now()}`,
      user_id: adjTarget.id,
      month: targetMonthStr,
      bonus_hours: Number(editBonusHours) || 0,
      bonus_money: Number(editBonusMoney) || 0,
      penalty_money: Number(editPenaltyMoney) || 0,
      note: editNote.trim()
    };

    try {
      // Chá»‰ xÃ³a khoáº£n pháº¡t/thÆ°á»Ÿng thá»§ cÃ´ng cÅ©
      await supabase.from('payroll_adjustments').delete().like('id', 'adj_manual_%').eq('user_id', adjTarget.id).eq('month', targetMonthStr);
      // ThÃªm khoáº£n thÆ°á»Ÿng pháº¡t má»›i ghi Ä‘Ã¨ tá»•ng
      const { error } = await supabase.from('payroll_adjustments').insert([newAdj]);
      if (error) throw error;
      
      const newAdjustments = [...(payrollAdjustments || []).filter(a => !(a.id.startsWith('adj_manual_') && a.user_id === adjTarget.id && a.month === targetMonthStr)), newAdj];
      setPayrollAdjustments(newAdjustments);
      setShowAdjModal(false);
      Alert.alert('ThÃ nh cÃ´ng', 'ÄÃ£ lÆ°u Ä‘iá»u chá»‰nh thÆ°á»Ÿng/pháº¡t!');
    } catch (e) {
      Alert.alert('Lá»—i', e.message || 'KhÃ´ng thá»ƒ lÆ°u. Kiá»ƒm tra káº¿t ná»‘i máº¡ng!');
    } finally {
      setIsSavingAdj(false);
    }
  };

  // Logic Duyá»‡t 3 bÆ°á»›c
  const handleApprove = async (staffItem, roleType) => {
    const currentApproval = staffItem.approval || {};
    
    let updates = {
      id: currentApproval.id || `apprv_${Date.now()}`,
      user_id: staffItem.id,
      month: targetMonthStr,
      staff_confirmed: currentApproval.staff_confirmed || false,
      manager_confirmed: currentApproval.manager_confirmed || false,
      owner_confirmed: currentApproval.owner_confirmed || false,
      status: currentApproval.status || 'DRAFT'
    };
    
    const nowStr = new Date().toLocaleTimeString('vi-VN', {hour: '2-digit', minute:'2-digit'}) + ' ' + new Date().toLocaleDateString('vi-VN');

    if (roleType === 'STAFF') {
      updates.staff_confirmed = true;
      updates.status = 'STAFF_APPROVED';
      updates.staff_confirmed_at = nowStr;
    } else if (roleType === 'MANAGER') {
      updates.manager_confirmed = true;
      updates.status = 'MANAGER_APPROVED';
      updates.manager_confirmed_by = currentUser.name;
      updates.manager_confirmed_at = nowStr;
    } else if (roleType === 'OWNER') {
      updates.owner_confirmed = true;
      updates.status = 'FINALIZED';
      updates.owner_confirmed_by = currentUser.name;
      updates.owner_confirmed_at = nowStr;
    }
    
    try {
      const { error } = await supabase.from('payroll_approvals').upsert([updates]);
      if (error) throw error;
      
      const newApprovals = [...(payrollApprovals || []).filter(a => a.id !== updates.id), updates];
      setPayrollApprovals(newApprovals);
      Alert.alert('ThÃ nh cÃ´ng', 'ÄÃ£ xÃ¡c nháº­n phiáº¿u lÆ°Æ¡ng!');

      // Send notification
      const targetStaff = staffList.find(s => s.id === staffItem.id);
      if (targetStaff) {
        if (roleType === 'MANAGER') {
          sendPushNotification(targetStaff.push_token, 'Duyá»‡t lÆ°Æ¡ng (Quáº£n lÃ½) ðŸŸ¢', `Quáº£n lÃ½ Ä‘Ã£ xÃ¡c nháº­n phiáº¿u lÆ°Æ¡ng thÃ¡ng ${targetMonthStr} cá»§a báº¡n.`, {}, targetStaff.id);
        } else if (roleType === 'OWNER') {
          sendPushNotification(targetStaff.push_token, 'Chá»‘t lÆ°Æ¡ng (Chá»§ cá»­a hÃ ng) âœ…', `Chá»§ cá»­a hÃ ng Ä‘Ã£ chá»‘t phiáº¿u lÆ°Æ¡ng thÃ¡ng ${targetMonthStr} cá»§a báº¡n.`, {}, targetStaff.id);
        }
      }
    } catch (e) {
      Alert.alert('Lá»—i xÃ¡c nháº­n', e.message);
    }
  };

  const handleCancelApprove = async (staffItem) => {
    const currentApproval = staffItem.approval || {};
    if (!currentApproval.id) return;

    let updates = {
      id: currentApproval.id,
      user_id: staffItem.id,
      month: targetMonthStr,
      staff_confirmed: false,
      manager_confirmed: false,
      owner_confirmed: false,
      status: 'DRAFT',
      staff_confirmed_at: null,
      manager_confirmed_by: null,
      manager_confirmed_at: null,
      owner_confirmed_by: null,
      owner_confirmed_at: null
    };

    try {
      const { error } = await supabase.from('payroll_approvals').upsert([updates]);
      if (error) throw error;
      const newApprovals = [...(payrollApprovals || []).filter(a => a.id !== updates.id), updates];
      setPayrollApprovals(newApprovals);
      Alert.alert('ThÃ nh cÃ´ng', 'ÄÃ£ há»§y duyá»‡t phiáº¿u lÆ°Æ¡ng!');
    } catch (e) {
      Alert.alert('Lá»—i', e.message);
    }
  };

  const formatMoney = (amount) => {
    return Math.round(amount).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  };

  const renderApprovalProgress = (item) => {
    const { staff_confirmed, manager_confirmed, owner_confirmed, staff_confirmed_at, manager_confirmed_by, manager_confirmed_at, owner_confirmed_by, owner_confirmed_at } = item.approval || {};
    
    return (
      <View style={styles.progressBlock}>
        <View style={{flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10}}>
          <Text style={styles.progressTitle}>Tiáº¿n trÃ¬nh duyá»‡t lÆ°Æ¡ng:</Text>
          {(isOwner || (isManager && !owner_confirmed)) && (staff_confirmed || manager_confirmed || owner_confirmed) && (
            <TouchableOpacity onPress={() => handleCancelApprove(item)}>
              <Text style={{color: '#d32f2f', fontSize: 12, fontWeight: 'bold'}}>Há»§y duyá»‡t (Má»Ÿ khÃ³a)</Text>
            </TouchableOpacity>
          )}
        </View>

        <View style={styles.stepRow}>
          <Ionicons name={staff_confirmed ? "checkmark-circle" : "ellipse-outline"} size={20} color={staff_confirmed ? "#4CAF50" : "#ccc"} />
          <View>
            <Text style={[styles.stepText, staff_confirmed && styles.stepTextActive]}>1. NhÃ¢n viÃªn xÃ¡c nháº­n giá» & lÆ°Æ¡ng</Text>
            {staff_confirmed && staff_confirmed_at && <Text style={styles.stepMeta}>LÃºc: {staff_confirmed_at}</Text>}
          </View>
        </View>
        <View style={styles.stepRow}>
          <Ionicons name={manager_confirmed ? "checkmark-circle" : "ellipse-outline"} size={20} color={manager_confirmed ? "#4CAF50" : "#ccc"} />
          <View>
            <Text style={[styles.stepText, manager_confirmed && styles.stepTextActive]}>2. Quáº£n lÃ½ duyá»‡t phiáº¿u lÆ°Æ¡ng</Text>
            {manager_confirmed && manager_confirmed_by && <Text style={styles.stepMeta}>Duyá»‡t bá»Ÿi: {manager_confirmed_by} - {manager_confirmed_at}</Text>}
          </View>
        </View>
        <View style={styles.stepRow}>
          <Ionicons name={owner_confirmed ? "checkmark-circle" : "ellipse-outline"} size={20} color={owner_confirmed ? "#4CAF50" : "#ccc"} />
          <View>
            <Text style={[styles.stepText, owner_confirmed && styles.stepTextActive]}>3. Chá»§ quÃ¡n chá»‘t (HoÃ n táº¥t)</Text>
            {owner_confirmed && owner_confirmed_by && <Text style={styles.stepMeta}>Duyá»‡t bá»Ÿi: {owner_confirmed_by} - {owner_confirmed_at}</Text>}
          </View>
        </View>

        {/* NÃºt thao tÃ¡c */}
        {isStaff && item.id === currentUser.id && !staff_confirmed && (
          <TouchableOpacity style={[styles.approveBtn, {backgroundColor: '#1976d2'}]} onPress={() => handleApprove(item, 'STAFF')}>
            <Text style={styles.approveBtnText}>TÃ”I XÃC NHáº¬N GIá»œ & LÆ¯Æ NG ÄÃšNG</Text>
          </TouchableOpacity>
        )}
        
        {isManager && staff_confirmed && !manager_confirmed && (
          <TouchableOpacity style={[styles.approveBtn, {backgroundColor: '#1976d2'}]} onPress={() => handleApprove(item, 'MANAGER')}>
            <Text style={styles.approveBtnText}>QUáº¢N LÃ XÃC NHáº¬N PHIáº¾U LÆ¯Æ NG</Text>
          </TouchableOpacity>
        )}

        {isOwner && manager_confirmed && !owner_confirmed && (
          <TouchableOpacity style={[styles.approveBtn, {backgroundColor: '#ff9800'}]} onPress={() => handleApprove(item, 'OWNER')}>
            <Text style={styles.approveBtnText}>CHá»T PHIáº¾U LÆ¯Æ NG CUá»I CÃ™NG</Text>
          </TouchableOpacity>
        )}
        
        {owner_confirmed && (
          <View style={styles.finalizedBadge}>
            <Ionicons name="shield-checkmark" size={16} color="#fff" />
            <Text style={styles.finalizedText}>ÄÃƒ CHá»T PHIáº¾U LÆ¯Æ NG</Text>
          </View>
        )}
      </View>
    );
  };

  const getApprovalLabel = (item) => {
    const approval = item.approval || {};
    if (approval.owner_confirmed) return 'ÄÃ£ chá»‘t';
    if (approval.manager_confirmed) return 'Quáº£n lÃ½ Ä‘Ã£ duyá»‡t';
    if (approval.staff_confirmed) return 'NhÃ¢n viÃªn Ä‘Ã£ xÃ¡c nháº­n';
    return 'NhÃ¡p';
  };

  const getSalaryModeLabel = (item) => item.wage ? `LÆ°Æ¡ng giá» ${formatMoney(item.wage)}Ä‘/h` : 'ChÆ°a cáº¥u hÃ¬nh má»©c lÆ°Æ¡ng';

  const escapeHtml = (value) => String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');

  const buildPayslipHtml = (item) => {
    const rows = item.records.length ? item.records.map((r, idx) => `
      <tr>
        <td>${idx + 1}</td>
        <td>${escapeHtml(r.date)}</td>
        <td>${escapeHtml(r.check_in || r.checkIn || '-')}</td>
        <td>${escapeHtml(r.check_out || r.checkOut || '-')}</td>
        <td class="right">${Number(r.hours || 0).toFixed(1)}</td>
      </tr>
    `).join('') : '<tr><td colspan="5" class="muted center">KhÃ´ng cÃ³ dá»¯ liá»‡u ngÃ y cÃ´ng</td></tr>';

    const approval = item.approval || {};
    const autoNote = item.adjustment?.auto_note ? `<p class="note"><b>Ghi chÃº tá»± Ä‘á»™ng:</b><br/>${escapeHtml(item.adjustment.auto_note).replace(/\n/g, '<br/>')}</p>` : '';
    const manualNote = item.adjustment?.note ? `<p class="note"><b>Ghi chÃº thÆ°á»Ÿng/pháº¡t:</b> ${escapeHtml(item.adjustment.note)}</p>` : '';

    return `<!doctype html>
<html lang="vi">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Phiáº¿u lÆ°Æ¡ng - ${escapeHtml(item.name)} - ${escapeHtml(selectedMonth.label)}</title>
  <style>
    @page { size: A4; margin: 14mm; }
    * { box-sizing: border-box; }
    body { font-family: Arial, sans-serif; color: #172033; margin: 0; background: #fff; }
    .sheet { max-width: 800px; margin: 0 auto; padding: 4px; }
    .top { display: flex; justify-content: space-between; gap: 24px; border-bottom: 3px solid #0f766e; padding-bottom: 14px; margin-bottom: 18px; }
    .brand { font-size: 22px; font-weight: 800; letter-spacing: .4px; color: #0f766e; }
    .subtitle { color: #64748b; margin-top: 4px; font-size: 13px; }
    h1 { text-align: center; margin: 18px 0 8px; font-size: 24px; }
    .period { text-align: center; color: #475569; margin-bottom: 20px; }
    .info { display: grid; grid-template-columns: 1fr 1fr; gap: 10px 18px; margin-bottom: 18px; }
    .box { border: 1px solid #dbe3ef; border-radius: 10px; padding: 12px; background: #f8fafc; }
    .label { color: #64748b; font-size: 12px; margin-bottom: 4px; }
    .value { font-weight: 700; font-size: 15px; }
    table { width: 100%; border-collapse: collapse; margin-top: 10px; }
    th, td { border: 1px solid #dbe3ef; padding: 9px 10px; font-size: 13px; }
    th { background: #eef7f5; text-align: left; color: #0f766e; }
    .right { text-align: right; }
    .center { text-align: center; }
    .muted { color: #64748b; }
    .total { background: #ecfdf5; font-weight: 800; color: #047857; font-size: 16px; }
    .deduct { color: #dc2626; }
    .earn { color: #047857; }
    .section-title { margin-top: 18px; font-size: 16px; font-weight: 800; color: #172033; }
    .note { background: #fff7ed; border: 1px solid #fed7aa; border-radius: 8px; padding: 10px; color: #9a3412; font-size: 13px; }
    .signatures { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; margin-top: 34px; text-align: center; }
    .sig { min-height: 90px; border-top: 1px dashed #94a3b8; padding-top: 8px; color: #475569; font-size: 13px; }
    @media print { .no-print { display: none; } body { print-color-adjust: exact; -webkit-print-color-adjust: exact; } }
    .toolbar { position: fixed; top: 12px; right: 12px; left: 12px; z-index: 20; display: flex; justify-content: flex-end; gap: 8px; pointer-events: none; }
    .toolbar button, .toolbar a { pointer-events: auto; border: 0; border-radius: 10px; color: white; padding: 10px 14px; font-weight: 700; cursor: pointer; text-decoration: none; font-size: 14px; box-shadow: 0 8px 20px rgba(15,23,42,.16); }
    .print-btn { background: #0f766e; }
    .back-btn { background: #2563eb; }
    .close-btn { background: #475569; }
    @media (max-width: 640px) { .toolbar { top: auto; bottom: 14px; justify-content: center; flex-wrap: wrap; } .toolbar button, .toolbar a { flex: 1; text-align: center; padding: 12px 10px; } .sheet { padding-bottom: 92px; } }
  </style>
</head>
<body>
  <script>
    function closePayslip() {
      try { window.close(); } catch (e) {}
      setTimeout(function () {
        if (!window.closed) window.location.href = '/';
      }, 120);
    }
  </script>
  <div class="toolbar no-print">
    <button class="print-btn" onclick="window.print()">In phiáº¿u</button>
    <a class="back-btn" href="/">Quay láº¡i app</a>
    <button class="close-btn" onclick="closePayslip()">ÄÃ³ng phiáº¿u</button>
  </div>
  <main class="sheet">
    <div class="top">
      <div>
        <div class="brand">THE Cá»C</div>
        <div class="subtitle">Phiáº¿u lÆ°Æ¡ng ná»™i bá»™ - dÃ¹ng Ä‘á»ƒ Ä‘á»‘i chiáº¿u vÃ  kÃ½ nháº­n</div>
      </div>
      <div class="subtitle right">NgÃ y in: ${escapeHtml(new Date().toLocaleString('vi-VN'))}</div>
    </div>

    <h1>PHIáº¾U LÆ¯Æ NG NHÃ‚N VIÃŠN</h1>
    <div class="period">Ká»³ lÆ°Æ¡ng: ${escapeHtml(selectedMonth.label)}</div>

    <section class="info">
      <div class="box"><div class="label">NhÃ¢n viÃªn</div><div class="value">${escapeHtml(item.name)}</div></div>
      <div class="box"><div class="label">Vai trÃ²</div><div class="value">${escapeHtml(item.role === 'MANAGER' ? 'Quáº£n lÃ½' : 'NhÃ¢n viÃªn')}</div></div>
      <div class="box"><div class="label">Cháº¿ Ä‘á»™ lÆ°Æ¡ng</div><div class="value">${escapeHtml(getSalaryModeLabel(item))}</div></div>
      <div class="box"><div class="label">Tráº¡ng thÃ¡i duyá»‡t</div><div class="value">${escapeHtml(getApprovalLabel(item))}</div></div>
    </section>

    <div class="section-title">Tá»•ng há»£p lÆ°Æ¡ng</div>
    <table>
      <tbody>
        <tr><td>Giá» cÃ´ng thá»±c táº¿</td><td class="right">${item.totalHours.toFixed(1)} giá» / ${item.recordsCount} ca</td></tr>
        <tr><td>LÆ°Æ¡ng cÃ´ng</td><td class="right earn">${formatMoney(item.baseSalary)}Ä‘</td></tr>
        <tr><td>ThÆ°á»Ÿng giá» (${Number(item.adjustment?.bonus_hours || 0).toFixed(1)} giá»)</td><td class="right earn">${formatMoney(item.bonusHoursSalary)}Ä‘</td></tr>
        <tr><td>ThÆ°á»Ÿng tiá»n</td><td class="right earn">${formatMoney(item.bonusMoney)}Ä‘</td></tr>
        <tr><td>Pháº¡t thá»§ cÃ´ng</td><td class="right deduct">-${formatMoney(item.manualPenalty)}Ä‘</td></tr>
        <tr><td>Pháº¡t/lá»‡ch kÃ©t tá»± Ä‘á»™ng</td><td class="right deduct">-${formatMoney(item.autoPenalty)}Ä‘</td></tr>
        <tr class="total"><td>Thá»±c nháº­n</td><td class="right">${formatMoney(item.totalSalary)}Ä‘</td></tr>
      </tbody>
    </table>

    ${manualNote}
    ${autoNote}

    <div class="section-title">Chi tiáº¿t ngÃ y cÃ´ng</div>
    <table>
      <thead><tr><th>#</th><th>NgÃ y</th><th>Check-in</th><th>Check-out</th><th class="right">Giá»</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>

    <div class="section-title">Luá»“ng xÃ¡c nháº­n</div>
    <table>
      <tbody>
        <tr><td>NhÃ¢n viÃªn xÃ¡c nháº­n</td><td>${approval.staff_confirmed ? 'ÄÃ£ xÃ¡c nháº­n' : 'ChÆ°a xÃ¡c nháº­n'} ${approval.staff_confirmed_at ? `- ${escapeHtml(approval.staff_confirmed_at)}` : ''}</td></tr>
        <tr><td>Quáº£n lÃ½ duyá»‡t</td><td>${approval.manager_confirmed ? `ÄÃ£ duyá»‡t bá»Ÿi ${escapeHtml(approval.manager_confirmed_by || '')}` : 'ChÆ°a duyá»‡t'} ${approval.manager_confirmed_at ? `- ${escapeHtml(approval.manager_confirmed_at)}` : ''}</td></tr>
        <tr><td>Chá»§ quÃ¡n chá»‘t</td><td>${approval.owner_confirmed ? `ÄÃ£ chá»‘t bá»Ÿi ${escapeHtml(approval.owner_confirmed_by || '')}` : 'ChÆ°a chá»‘t'} ${approval.owner_confirmed_at ? `- ${escapeHtml(approval.owner_confirmed_at)}` : ''}</td></tr>
      </tbody>
    </table>

    <section class="signatures">
      <div class="sig">NhÃ¢n viÃªn kÃ½ nháº­n</div>
      <div class="sig">Quáº£n lÃ½</div>
      <div class="sig">Chá»§ quÃ¡n</div>
    </section>
  </main>
</body>
</html>`;
  };

  const handlePrintPayslip = (item) => {
    if (Platform.OS !== 'web' || typeof window === 'undefined') {
      Alert.alert('In phiáº¿u lÆ°Æ¡ng', 'Vui lÃ²ng má»Ÿ báº£n PWA/Web Ä‘á»ƒ in trá»±c tiáº¿p phiáº¿u lÆ°Æ¡ng A4.');
      return;
    }

    const printWindow = window.open('', '_blank', 'width=900,height=1100');
    if (!printWindow) {
      Alert.alert('TrÃ¬nh duyá»‡t cháº·n cá»­a sá»• in', 'HÃ£y cho phÃ©p popup cho app rá»“i báº¥m In phiáº¿u lÆ°Æ¡ng láº¡i.');
      return;
    }

    printWindow.document.open();
    printWindow.document.write(buildPayslipHtml(item));
    printWindow.document.close();
    printWindow.focus();
    setTimeout(() => printWindow.print(), 450);
  };

  const handleExportExcel = async () => {
    try {
      const exportData = payrollData.map(item => ({
        'TÃªn nhÃ¢n viÃªn': item.name,
        'Vai trÃ²': item.role === 'MANAGER' ? 'Quáº£n lÃ½' : 'NhÃ¢n viÃªn',
        'Cháº¿ Ä‘á»™ lÆ°Æ¡ng': getSalaryModeLabel(item),
        'Sá»‘ ca': item.recordsCount,
        'Giá» cÃ´ng': Number(item.totalHours || 0).toFixed(1),
        'Giá» thÆ°á»Ÿng': Number(item.adjustment?.bonus_hours || 0).toFixed(1),
        'Giá» tÃ­nh lÆ°Æ¡ng': Number(item.finalHours || 0).toFixed(1),
        'LÆ°Æ¡ng giá»': item.wage || 0,
        'LÆ°Æ¡ng cÃ´ng': Math.round(item.baseSalary || 0),
        'ThÆ°á»Ÿng giá» quy tiá»n': Math.round(item.bonusHoursSalary || 0),
        'ThÆ°á»Ÿng tiá»n': Math.round(item.bonusMoney || 0),
        'Pháº¡t thá»§ cÃ´ng': Math.round(item.manualPenalty || 0),
        'Pháº¡t/lá»‡ch kÃ©t tá»± Ä‘á»™ng': Math.round(item.autoPenalty || 0),
        'Tá»•ng pháº¡t': Math.round(item.totalPenalty || 0),
        'Thá»±c nháº­n': Math.round(item.totalSalary || 0),
        'Tráº¡ng thÃ¡i duyá»‡t': getApprovalLabel(item),
        'Ghi chÃº thá»§ cÃ´ng': item.adjustment?.note || '',
        'Ghi chÃº tá»± Ä‘á»™ng': item.adjustment?.auto_note || ''
      }));
      
      const fileName = `Bang_Luong_Thang_${selectedMonth.month}_${selectedMonth.year}`;
      await exportToExcel(exportData, fileName, 'Báº£ng LÆ°Æ¡ng');
      Alert.alert('ThÃ nh cÃ´ng', 'ÄÃ£ xuáº¥t file Excel báº£ng lÆ°Æ¡ng!');
    } catch (e) {
      Alert.alert('Lá»—i', 'KhÃ´ng thá»ƒ xuáº¥t bÃ¡o cÃ¡o: ' + e.message);
    }
  };
  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.stickyTopBar}>
      <View style={styles.headerRow}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={24} color="#1976d2" />
        </TouchableOpacity>
        <Text style={styles.header}>Báº£ng LÆ°Æ¡ng</Text>
      </View>

      <View style={styles.monthSelector}>
        <TouchableOpacity style={styles.monthBtn} onPress={() => setMonthOffset(monthOffset - 1)}>
          <Ionicons name="chevron-back" size={24} color="#1976d2" />
        </TouchableOpacity>
        <Text style={styles.monthText}>{selectedMonth.label}</Text>
        <TouchableOpacity style={styles.monthBtn} onPress={() => setMonthOffset(monthOffset + 1)} disabled={monthOffset >= 0}>
          <Ionicons name="chevron-forward" size={24} color={monthOffset >= 0 ? "#ccc" : "#1976d2"} />
        </TouchableOpacity>
      </View>
      </View>

      <ScrollView 
        style={styles.flexRoot}
        contentContainerStyle={styles.scrollContent}
        refreshControl={<RefreshControl refreshing={isDataLoading} onRefresh={refreshData} />}
      >
        {isManager || isOwner ? (
          <View style={styles.summaryCard}>
            <View style={styles.summaryHeaderRow}>
              <View>
                <Text style={styles.summaryTitle}>Tá»•ng quá»¹ lÆ°Æ¡ng thá»±c nháº­n</Text>
                <Text style={styles.summaryAmount}>{formatMoney(payrollSummary.totalNet)} Ä‘</Text>
              </View>
              <TouchableOpacity style={styles.exportBtn} onPress={handleExportExcel}>
                <Ionicons name="download-outline" size={18} color="#fff" />
                <Text style={styles.exportBtnText}>Xuáº¥t Excel</Text>
              </TouchableOpacity>
            </View>
            <View style={styles.summaryGrid}>
              <View style={styles.summaryMiniBox}>
                <Text style={styles.summaryMiniValue}>{payrollSummary.totalStaff}</Text>
                <Text style={styles.summaryMiniLabel}>NhÃ¢n viÃªn</Text>
              </View>
              <View style={styles.summaryMiniBox}>
                <Text style={styles.summaryMiniValue}>{payrollSummary.totalHours.toFixed(1)}h</Text>
                <Text style={styles.summaryMiniLabel}>Giá» tÃ­nh lÆ°Æ¡ng</Text>
              </View>
              <View style={styles.summaryMiniBox}>
                <Text style={styles.summaryMiniValue}>{formatMoney(payrollSummary.totalPenalty)}Ä‘</Text>
                <Text style={styles.summaryMiniLabel}>Tá»•ng pháº¡t</Text>
              </View>
              <View style={styles.summaryMiniBox}>
                <Text style={styles.summaryMiniValue}>{payrollSummary.finalized}/{payrollSummary.totalStaff}</Text>
                <Text style={styles.summaryMiniLabel}>ÄÃ£ chá»‘t</Text>
              </View>
            </View>
          </View>
        ) : null}

        <Text style={styles.sectionTitle}>Chi tiáº¿t nhÃ¢n sá»±</Text>
        
        {payrollData.length === 0 ? (
          <Text style={{textAlign: 'center', color: COLORS.textMuted, marginTop: 20}}>ChÆ°a cÃ³ dá»¯ liá»‡u cháº¥m cÃ´ng thÃ¡ng nÃ y</Text>
        ) : (
          payrollData.map(item => (
            <View key={item.id} style={styles.staffCard}>
              <TouchableOpacity 
                style={[styles.staffHeader, item.approval.owner_confirmed && styles.staffHeaderFinalized]} 
                onPress={() => setExpandedUser(expandedUser === item.id ? null : item.id)}
                activeOpacity={0.7}
              >
                <View style={{flex: 1}}>
                  <Text style={styles.staffName}>{item.name}</Text>
                  <Text style={styles.staffRole}>{item.role === 'MANAGER' ? 'Quáº£n LÃ½' : 'NhÃ¢n ViÃªn'} â€¢ {item.wage ? `${formatMoney(item.wage)}Ä‘/h` : 'ChÆ°a nháº­p lÆ°Æ¡ng'}</Text>
                  {item.approval.owner_confirmed && <Text style={{color: '#388e3c', fontSize: 12, fontWeight: 'bold', marginTop: 2}}>âœ“ ÄÃ£ chá»‘t lÆ°Æ¡ng</Text>}
                </View>
                <View style={{alignItems: 'flex-end'}}>
                  <Text style={styles.staffTotal}>{formatMoney(item.totalSalary)} Ä‘</Text>
                  <Text style={styles.staffHours}>Thá»±c táº¿: {item.finalHours.toFixed(1)} giá»</Text>
                </View>
              </TouchableOpacity>

              {expandedUser === item.id && (
                <View style={styles.staffDetails}>
                  <View style={styles.divider} />
                  
                  <View style={styles.salaryBreakdownCard}>
                    <View style={styles.salaryBreakdownHeader}>
                      <View style={{flex: 1}}>
                        <Text style={styles.salaryBreakdownTitle}>Tá»•ng há»£p phiáº¿u lÆ°Æ¡ng</Text>
                        <Text style={styles.salaryModeText}>{getSalaryModeLabel(item)} â€¢ {getApprovalLabel(item)}</Text>
                      </View>
                      <TouchableOpacity style={styles.printBtn} onPress={() => handlePrintPayslip(item)}>
                        <Ionicons name="print-outline" size={16} color={COLORS.primary} />
                        <Text style={styles.printBtnText}>In phiáº¿u</Text>
                      </TouchableOpacity>
                    </View>

                    <View style={styles.salaryGrid}>
                      <View style={styles.salaryCell}>
                        <Text style={styles.salaryCellLabel}>LÆ°Æ¡ng cÃ´ng</Text>
                        <Text style={styles.salaryCellValue}>{formatMoney(item.baseSalary)}Ä‘</Text>
                        <Text style={styles.salaryCellMeta}>{item.totalHours.toFixed(1)}h Ã— {formatMoney(item.wage || 0)}Ä‘</Text>
                      </View>
                      <View style={styles.salaryCell}>
                        <Text style={styles.salaryCellLabel}>ThÆ°á»Ÿng</Text>
                        <Text style={[styles.salaryCellValue, styles.positiveText]}>{formatMoney(item.bonusHoursSalary + item.bonusMoney)}Ä‘</Text>
                        <Text style={styles.salaryCellMeta}>Giá» + tiá»n</Text>
                      </View>
                      <View style={styles.salaryCell}>
                        <Text style={styles.salaryCellLabel}>Pháº¡t/trá»«</Text>
                        <Text style={[styles.salaryCellValue, styles.negativeText]}>-{formatMoney(item.totalPenalty)}Ä‘</Text>
                        <Text style={styles.salaryCellMeta}>Thá»§ cÃ´ng + tá»± Ä‘á»™ng</Text>
                      </View>
                      <View style={[styles.salaryCell, styles.salaryNetCell]}>
                        <Text style={styles.salaryCellLabel}>Thá»±c nháº­n</Text>
                        <Text style={styles.salaryNetValue}>{formatMoney(item.totalSalary)}Ä‘</Text>
                        <Text style={styles.salaryCellMeta}>Sau Ä‘á»‘i chiáº¿u</Text>
                      </View>
                    </View>
                  </View>

                  {/* Khá»‘i ThÆ°á»Ÿng Pháº¡t */}
                  <View style={styles.adjBlock}>
                    <View style={{flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center'}}>
                      <Text style={styles.adjTitle}>LÆ°Æ¡ng & ThÆ°á»Ÿng / Pháº¡t</Text>
                      {isOwner && !item.approval.owner_confirmed && (
                        <TouchableOpacity style={styles.adjEditBtn} onPress={() => openAdjustmentModal(item)}>
                          <Ionicons name="pencil" size={14} color="#1976d2" />
                          <Text style={styles.adjEditText}>Äiá»u chá»‰nh</Text>
                        </TouchableOpacity>
                      )}
                    </View>
                    <View style={{marginTop: 8, gap: 4}}>
                      <Text style={styles.adjText}>â€¢ Giá» lÃ m gá»‘c: {item.totalHours.toFixed(1)}h ({item.recordsCount} ca)</Text>
                      {item.adjustment?.bonus_hours > 0 && <Text style={[styles.adjText, {color: '#388e3c'}]}>â€¢ ThÆ°á»Ÿng thÃªm giá»: +{item.adjustment.bonus_hours}h</Text>}
                      {item.adjustment?.bonus_money > 0 && <Text style={[styles.adjText, {color: '#388e3c'}]}>â€¢ Tiá»n thÆ°á»Ÿng (Quy Ä‘á»‹nh quÃ¡n): +{formatMoney(item.adjustment.bonus_money)}Ä‘</Text>}
                      {item.adjustment?.manual_penalty > 0 && <Text style={[styles.adjText, {color: 'red'}]}>â€¢ Tiá»n pháº¡t (Quy Ä‘á»‹nh quÃ¡n): -{formatMoney(item.adjustment.manual_penalty)}Ä‘</Text>}
                      {item.adjustment?.note ? <Text style={[styles.adjText, {fontStyle: 'italic', color: COLORS.textMuted, marginLeft: 10}]}>LÃ½ do: {item.adjustment.note}</Text> : null}
                      
                      {item.adjustment?.auto_penalty > 0 && (
                        <>
                          <Text style={[styles.adjText, {color: 'red', marginTop: 4}]}>â€¢ Lá»‡ch kÃ©t (Há»‡ thá»‘ng tá»± trá»«): -{formatMoney(item.adjustment.auto_penalty)}Ä‘</Text>
                          {item.adjustment?.auto_note ? <Text style={[styles.adjText, {fontStyle: 'italic', color: COLORS.textMuted, marginLeft: 10}]}>{item.adjustment.auto_note}</Text> : null}
                        </>
                      )}
                    </View>
                  </View>

                  {/* Khá»‘i Tiáº¿n trÃ¬nh Duyá»‡t LÆ°Æ¡ng */}
                  {renderApprovalProgress(item)}

                  <Text style={{fontWeight: 'bold', marginBottom: 10, color: COLORS.text, marginTop: 15}}>Chi tiáº¿t cÃ¡c ngÃ y lÃ m viá»‡c:</Text>
                  {item.records.length === 0 ? (
                    <Text style={styles.emptyText}>KhÃ´ng cÃ³ dá»¯ liá»‡u</Text>
                  ) : (
                    item.records.map((r, idx) => (
                      <View key={idx} style={styles.recordRow}>
                        <Text style={styles.recordDate}>{r.date}</Text>
                        <Text style={styles.recordTime}>{r.check_in || r.checkIn} - {r.check_out || r.checkOut}</Text>
                        <Text style={styles.recordHours}>{Number(r.hours).toFixed(1)}h</Text>
                      </View>
                    ))
                  )}
                </View>
              )}
            </View>
          ))
        )}
      </ScrollView>

      {/* MODAL ÄIá»€U CHá»ˆNH THÆ¯á»žNG PHáº T */}
      <Modal visible={showAdjModal} transparent animationType="fade">
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>ThÆ°á»Ÿng / Pháº¡t</Text>
              <TouchableOpacity onPress={() => setShowAdjModal(false)}>
                <Ionicons name="close" size={24} color={COLORS.textMuted} />
              </TouchableOpacity>
            </View>
            <Text style={styles.modalSubtitle}>NhÃ¢n viÃªn: {adjTarget?.name}</Text>
            
            <ScrollView showsVerticalScrollIndicator={false}>
              <Text style={styles.label}>Sá»‘ giá» thÆ°á»Ÿng thÃªm (vd: 2.5):</Text>
              <TextInput style={styles.input} keyboardType="numeric" value={editBonusHours} onChangeText={setEditBonusHours} />
              
              <Text style={styles.label}>Sá»‘ tiá»n thÆ°á»Ÿng thÃªm (VNÄ):</Text>
              <TextInput style={styles.input} keyboardType="numeric" value={editBonusMoney} onChangeText={setEditBonusMoney} />
              
              <Text style={styles.label}>Sá»‘ tiá»n pháº¡t / trá»« lá»‡ch kÃ©t (VNÄ):</Text>
              <TextInput style={styles.input} keyboardType="numeric" value={editPenaltyMoney} onChangeText={setEditPenaltyMoney} />
              
              <Text style={styles.label}>Ghi chÃº lÃ½ do:</Text>
              <TextInput style={[styles.input, {height: 60}]} multiline value={editNote} onChangeText={setEditNote} placeholder="Vd: ThÆ°á»Ÿng lá»…, Ä‘i trá»…, lÃ m vá»¡ ly..." />
              
              <TouchableOpacity style={styles.saveBtn} onPress={handleSaveAdjustment} disabled={isSavingAdj}>
                <Text style={styles.saveBtnText}>{isSavingAdj ? 'Äang lÆ°u...' : 'LÆ°u Äiá»u Chá»‰nh'}</Text>
              </TouchableOpacity>
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>

    </SafeAreaView>
  );
}

const getStyles = (COLORS, isDarkMode) => StyleSheet.create({
  container: { flex: 1, minHeight: 0, overflow: Platform.OS === 'web' ? 'visible' : 'hidden', backgroundColor: COLORS.bg },
  flexRoot: { flex: 1, minHeight: 0 },
  stickyTopBar: { backgroundColor: COLORS.bg, ...(Platform.OS === 'web' ? { position: 'sticky', top: 0, zIndex: 40 } : null) },
  headerRow: { flexDirection: 'row', alignItems: 'center', padding: IS_COMPACT_WEB ? 16 : 20, paddingBottom: IS_COMPACT_WEB ? 8 : 10 },
  backBtn: { padding: 5, marginRight: 10 },
  header: { fontSize: IS_COMPACT_WEB ? 19 : 22, fontWeight: 'bold', color: COLORS.text },
  
  monthSelector: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: isDarkMode ? '#0f2a44' : '#e3f2fd', marginHorizontal: IS_COMPACT_WEB ? 16 : 20, padding: IS_COMPACT_WEB ? 8 : 10, borderRadius: 8, marginTop: IS_COMPACT_WEB ? 6 : 10, borderWidth: 1, borderColor: COLORS.border },
  monthBtn: { padding: 5 },
  monthText: { fontSize: IS_COMPACT_WEB ? 16 : 18, fontWeight: 'bold', color: COLORS.primary },
  
  scrollContent: { padding: IS_COMPACT_WEB ? 16 : 20, paddingBottom: 100 },
  summaryCard: { backgroundColor: '#1976d2', padding: IS_COMPACT_WEB ? 16 : 20, borderRadius: 12, marginBottom: IS_COMPACT_WEB ? 16 : 20, elevation: 4 },
  summaryHeaderRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 },
  summaryTitle: { color: '#e3f2fd', fontSize: IS_COMPACT_WEB ? 13 : 16, marginBottom: 5 },
  summaryAmount: { color: '#fff', fontSize: IS_COMPACT_WEB ? 24 : 30, fontWeight: 'bold' },
  exportBtn: { flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(255,255,255,0.18)', paddingHorizontal: 12, paddingVertical: 9, borderRadius: 10, gap: 6 },
  exportBtnText: { color: '#fff', fontWeight: 'bold', fontSize: 13 },
  summaryGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 16 },
  summaryMiniBox: { flexGrow: 1, flexBasis: '47%', backgroundColor: 'rgba(255,255,255,0.14)', borderRadius: 10, padding: 10 },
  summaryMiniValue: { color: '#fff', fontSize: 16, fontWeight: 'bold' },
  summaryMiniLabel: { color: '#dbeafe', fontSize: 12, marginTop: 3 },
  
  sectionTitle: { fontSize: IS_COMPACT_WEB ? 16 : 18, fontWeight: 'bold', color: COLORS.text, marginBottom: IS_COMPACT_WEB ? 12 : 15 },
  
  staffCard: { backgroundColor: COLORS.card, borderRadius: 10, marginBottom: 12, elevation: 2, overflow: 'hidden', borderWidth: 1, borderColor: COLORS.border },
  staffHeader: { flexDirection: 'row', justifyContent: 'space-between', padding: IS_COMPACT_WEB ? 12 : 15, alignItems: 'center' },
  staffHeaderFinalized: { backgroundColor: isDarkMode ? '#0f2a1d' : '#f1f8e9' },
  staffName: { fontSize: IS_COMPACT_WEB ? 14 : 16, fontWeight: 'bold', color: COLORS.text },
  staffRole: { fontSize: 13, color: COLORS.textMuted, marginTop: 4 },
  staffTotal: { fontSize: 16, fontWeight: 'bold', color: '#4CAF50' },
  staffHours: { fontSize: 13, color: COLORS.textMuted, marginTop: 4 },
  
  staffDetails: { padding: 15, backgroundColor: COLORS.inputBg },
  divider: { height: 1, backgroundColor: COLORS.border, marginBottom: 15, marginTop: -5 },
  salaryBreakdownCard: { backgroundColor: COLORS.card, borderWidth: 1, borderColor: COLORS.border, borderRadius: 12, padding: 14, marginBottom: 15 },
  salaryBreakdownHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, gap: 10 },
  salaryBreakdownTitle: { color: COLORS.text, fontSize: 16, fontWeight: 'bold' },
  salaryModeText: { color: COLORS.textMuted, fontSize: 12, marginTop: 3 },
  printBtn: { flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: COLORS.primary, paddingHorizontal: 10, paddingVertical: 8, borderRadius: 10, gap: 5, backgroundColor: isDarkMode ? 'rgba(96,165,250,0.1)' : '#eff6ff' },
  printBtnText: { color: COLORS.primary, fontSize: 12, fontWeight: 'bold' },
  salaryGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  salaryCell: { flexGrow: 1, flexBasis: '47%', backgroundColor: isDarkMode ? '#0b1220' : '#f8fafc', borderWidth: 1, borderColor: COLORS.border, borderRadius: 10, padding: 10 },
  salaryNetCell: { backgroundColor: isDarkMode ? '#052e1b' : '#ecfdf5', borderColor: isDarkMode ? '#14532d' : '#bbf7d0' },
  salaryCellLabel: { color: COLORS.textMuted, fontSize: 12, marginBottom: 4 },
  salaryCellValue: { color: COLORS.text, fontSize: 15, fontWeight: 'bold' },
  salaryNetValue: { color: '#16a34a', fontSize: 18, fontWeight: 'bold' },
  salaryCellMeta: { color: COLORS.textMuted, fontSize: 11, marginTop: 4 },
  positiveText: { color: '#16a34a' },
  negativeText: { color: '#dc2626' },
  
  adjBlock: { backgroundColor: isDarkMode ? '#0f2a44' : '#e3f2fd', padding: 12, borderRadius: 8, marginBottom: 15 },
  adjTitle: { fontWeight: 'bold', color: isDarkMode ? '#93c5fd' : '#1976d2' },
  adjEditBtn: { flexDirection: 'row', alignItems: 'center', backgroundColor: isDarkMode ? '#1e3a8a' : '#bbdefb', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 15 },
  adjEditText: { color: isDarkMode ? '#bfdbfe' : '#1976d2', fontSize: 12, marginLeft: 4, fontWeight: '700' },
  adjText: { fontSize: 13, color: COLORS.text },

  progressBlock: { backgroundColor: COLORS.card, padding: 15, borderRadius: 8, borderWidth: 1, borderColor: COLORS.border, marginBottom: 15 },
  progressTitle: { fontWeight: 'bold', color: isDarkMode ? '#93c5fd' : '#1976d2' },
  stepRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 8 },
  stepText: { fontSize: 14, color: COLORS.textMuted, marginLeft: 8 },
  stepTextActive: { color: COLORS.text, fontWeight: 'bold' },
  stepMeta: { fontSize: 11, color: COLORS.textMuted, marginTop: 2, marginLeft: 5 },
  approveBtn: { padding: 12, borderRadius: 8, alignItems: 'center', marginTop: 10 },
  approveBtnText: { color: '#fff', fontWeight: 'bold', fontSize: 13 },
  finalizedBadge: { flexDirection: 'row', backgroundColor: '#4CAF50', padding: 12, borderRadius: 8, alignItems: 'center', justifyContent: 'center', marginTop: 10 },
  finalizedText: { color: '#fff', fontWeight: 'bold', fontSize: 13, marginLeft: 6 },

  recordRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: COLORS.border },
  recordDate: { width: 90, color: COLORS.text, fontWeight: 'bold' },
  recordTime: { flex: 1, color: COLORS.textMuted, textAlign: 'center' },
  recordHours: { width: 50, color: '#1976d2', fontWeight: 'bold', textAlign: 'right' },
  emptyText: { color: COLORS.textMuted, fontStyle: 'italic' },

  // Modal Styles
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', padding: 20 },
  modalContent: { backgroundColor: COLORS.card, borderRadius: 12, padding: 20, maxHeight: '90%', borderWidth: 1, borderColor: COLORS.border },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
  modalTitle: { fontSize: 20, fontWeight: 'bold', color: COLORS.text },
  modalSubtitle: { fontSize: 14, color: COLORS.textMuted, marginBottom: 20 },
  label: { fontSize: 14, fontWeight: 'bold', color: COLORS.text, marginBottom: 5 },
  input: { backgroundColor: COLORS.inputBg, color: COLORS.text, padding: 12, borderRadius: 8, marginBottom: 15, borderWidth: 1, borderColor: COLORS.inputBorder },
  saveBtn: { backgroundColor: '#4CAF50', padding: 15, borderRadius: 8, alignItems: 'center', marginTop: 10 },
  saveBtnText: { color: '#fff', fontWeight: 'bold', fontSize: 16 }
});
