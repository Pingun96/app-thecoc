import React, { useContext, useState, useMemo } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, SafeAreaView, RefreshControl } from 'react-native';
import { AppContext } from '../context/AppContext';
import { Ionicons } from '@expo/vector-icons';

export default function PayrollScreen({ navigation }) {
  const { currentUser, attendanceHistory, staffList, refreshData, isDataLoading } = useContext(AppContext);
  
  const isOwner = currentUser?.role === 'OWNER';
  const isManager = currentUser?.role === 'MANAGER';
  const isStaff = currentUser?.role === 'STAFF';

  // State chọn tháng
  const [monthOffset, setMonthOffset] = useState(0);

  // Lấy thông tin tháng được chọn
  const getSelectedMonthInfo = () => {
    const d = new Date();
    d.setMonth(d.getMonth() + monthOffset);
    return {
      year: d.getFullYear(),
      month: d.getMonth() + 1, // 1-12
      label: `Tháng ${d.getMonth() + 1} / ${d.getFullYear()}`
    };
  };

  const selectedMonth = getSelectedMonthInfo();

  // Gom nhóm dữ liệu chấm công theo nhân viên cho tháng được chọn
  const payrollData = useMemo(() => {
    // 1. Lọc các record trong tháng được chọn (dựa trên chuỗi date "YYYY-MM-DD")
    const targetMonthStr = `${selectedMonth.year}-${String(selectedMonth.month).padStart(2, '0')}`;
    const monthlyRecords = attendanceHistory.filter(r => r.date && r.date.startsWith(targetMonthStr) && r.hours > 0);

    // 2. Gom nhóm theo user_id
    const grouped = {};
    monthlyRecords.forEach(record => {
      if (!grouped[record.user_id]) {
        grouped[record.user_id] = {
          totalHours: 0,
          records: []
        };
      }
      grouped[record.user_id].totalHours += Number(record.hours || 0);
      grouped[record.user_id].records.push(record);
    });

    // 3. Kết hợp với danh sách nhân viên để lấy lương cơ bản (wage)
    const result = [];
    staffList.forEach(staff => {
      // Nếu là STAFF, chỉ tính cho chính họ
      if (isStaff && staff.id !== currentUser.id) return;

      const data = grouped[staff.id] || { totalHours: 0, records: [] };
      const wage = staff.wage || 0; // Lương cơ bản / giờ
      const totalSalary = data.totalHours * wage;

      result.push({
        ...staff,
        totalHours: data.totalHours,
        totalSalary: totalSalary,
        recordsCount: data.records.length,
        records: data.records.sort((a, b) => a.date.localeCompare(b.date))
      });
    });

    // Sắp xếp: Ai lương cao xếp trên
    return result.sort((a, b) => b.totalSalary - a.totalSalary);

  }, [attendanceHistory, staffList, selectedMonth, isStaff, currentUser.id]);

  // Expand detail
  const [expandedUser, setExpandedUser] = useState(null);

  const formatMoney = (amount) => {
    return Math.round(amount).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.headerRow}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={24} color="#1976d2" />
        </TouchableOpacity>
        <Text style={styles.header}>Bảng Lương</Text>
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

      <ScrollView 
        contentContainerStyle={{padding: 20, paddingBottom: 100}}
        refreshControl={<RefreshControl refreshing={isDataLoading} onRefresh={refreshData} />}
      >
        {isManager || isOwner ? (
          <View style={styles.summaryCard}>
            <Text style={styles.summaryTitle}>Tổng quỹ lương tháng</Text>
            <Text style={styles.summaryAmount}>
              {formatMoney(payrollData.reduce((sum, item) => sum + item.totalSalary, 0))} đ
            </Text>
          </View>
        ) : null}

        <Text style={styles.sectionTitle}>Chi tiết nhân sự</Text>
        
        {payrollData.length === 0 ? (
          <Text style={{textAlign: 'center', color: '#666', marginTop: 20}}>Chưa có dữ liệu chấm công tháng này</Text>
        ) : (
          payrollData.map(item => (
            <View key={item.id} style={styles.staffCard}>
              <TouchableOpacity 
                style={styles.staffHeader} 
                onPress={() => setExpandedUser(expandedUser === item.id ? null : item.id)}
                activeOpacity={0.7}
              >
                <View style={{flex: 1}}>
                  <Text style={styles.staffName}>{item.name}</Text>
                  <Text style={styles.staffRole}>{item.role === 'MANAGER' ? 'Quản Lý' : 'Nhân Viên'} • {item.wage ? `${formatMoney(item.wage)}đ/h` : 'Chưa nhập lương'}</Text>
                </View>
                <View style={{alignItems: 'flex-end'}}>
                  <Text style={styles.staffTotal}>{formatMoney(item.totalSalary)} đ</Text>
                  <Text style={styles.staffHours}>{item.totalHours.toFixed(1)} giờ ({item.recordsCount} ca)</Text>
                </View>
              </TouchableOpacity>

              {expandedUser === item.id && (
                <View style={styles.staffDetails}>
                  <View style={styles.divider} />
                  <Text style={{fontWeight: 'bold', marginBottom: 10, color: '#555'}}>Chi tiết các ngày làm việc:</Text>
                  {item.records.length === 0 ? (
                    <Text style={{color: '#999', fontStyle: 'italic'}}>Không có dữ liệu</Text>
                  ) : (
                    item.records.map((r, idx) => (
                      <View key={idx} style={styles.recordRow}>
                        <Text style={styles.recordDate}>{r.date}</Text>
                        <Text style={styles.recordTime}>{r.check_in || r.checkIn} - {r.check_out || r.checkOut}</Text>
                        <Text style={styles.recordHours}>{Number(r.hours).toFixed(1)}h</Text>
                      </View>
                    ))
                  )}
                  {(!isOwner && !isManager) && (
                     <Text style={{marginTop: 15, fontStyle: 'italic', color: '#e91e63', fontSize: 12}}>
                       * Lưu ý: Đây là lương cơ bản tạm tính. Tiền thưởng/phạt hoặc lệch két sẽ được quản lý đối chiếu vào cuối tháng.
                     </Text>
                  )}
                </View>
              )}
            </View>
          ))
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f0f2f5' },
  headerRow: { flexDirection: 'row', alignItems: 'center', padding: 20, paddingBottom: 10 },
  backBtn: { padding: 5, marginRight: 10 },
  header: { fontSize: 22, fontWeight: 'bold', color: '#1f2937' },
  
  monthSelector: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: '#e3f2fd', marginHorizontal: 20, padding: 10, borderRadius: 8, marginTop: 10 },
  monthBtn: { padding: 5 },
  monthText: { fontSize: 18, fontWeight: 'bold', color: '#1976d2' },
  
  summaryCard: { backgroundColor: '#1976d2', padding: 20, borderRadius: 12, marginBottom: 20, alignItems: 'center', elevation: 4 },
  summaryTitle: { color: '#e3f2fd', fontSize: 16, marginBottom: 5 },
  summaryAmount: { color: '#fff', fontSize: 32, fontWeight: 'bold' },
  
  sectionTitle: { fontSize: 18, fontWeight: 'bold', color: '#333', marginBottom: 15 },
  
  staffCard: { backgroundColor: '#fff', borderRadius: 10, marginBottom: 12, elevation: 2, overflow: 'hidden' },
  staffHeader: { flexDirection: 'row', justifyContent: 'space-between', padding: 15, alignItems: 'center' },
  staffName: { fontSize: 16, fontWeight: 'bold', color: '#333' },
  staffRole: { fontSize: 13, color: '#666', marginTop: 4 },
  staffTotal: { fontSize: 16, fontWeight: 'bold', color: '#4CAF50' },
  staffHours: { fontSize: 13, color: '#888', marginTop: 4 },
  
  staffDetails: { padding: 15, backgroundColor: '#f9fafb' },
  divider: { height: 1, backgroundColor: '#e5e7eb', marginBottom: 15, marginTop: -5 },
  recordRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: '#eee' },
  recordDate: { width: 90, color: '#555', fontWeight: 'bold' },
  recordTime: { flex: 1, color: '#666', textAlign: 'center' },
  recordHours: { width: 50, color: '#1976d2', fontWeight: 'bold', textAlign: 'right' }
});
