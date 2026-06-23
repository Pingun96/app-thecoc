import React, { useState, useContext } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, TextInput } from 'react-native';
import { AppContext } from '../../App';

export default function ManagerDashboardScreen({ navigation }) {
  const { staffList, attendanceHistory, currentUser } = useContext(AppContext);

  // Lọc ra các nhân sự thuộc cửa hàng của quản lý này (hoặc toàn hệ thống nếu là owner, nhưng mock này cho manager)
  const myStaff = staffList.filter(s => s.store_id === currentUser?.store_id);

  // Tính lương tổng hợp cho các nhân sự thuộc chi nhánh
  const payrollData = myStaff.map(staff => {
    const history = attendanceHistory.filter(r => r.user_id === staff.id);
    const totalHours = history.reduce((sum, record) => sum + (record.hours || 0), 0);
    const totalSalary = totalHours * staff.wage;
    return { ...staff, totalHours, totalSalary };
  });

  const [reports, setReports] = useState([
    { id: 1, item: 'Cà phê hạt', imported: 0, exported: 2, ending: 8, status: 'PENDING' },
    { id: 2, item: 'Sữa tươi', imported: 10, exported: 5, ending: 15, status: 'PENDING' },
  ]);

  const approveReport = (id) => {
    setReports(reports.map(r => r.id === id ? { ...r, status: 'APPROVED' } : r));
    alert('Đã duyệt báo cáo thành công!');
  };

  return (
    <ScrollView style={styles.container}>
      <Text style={styles.header}>Bảng Điều Khiển - QUẢN LÝ</Text>

      {/* BẢNG TÍNH LƯƠNG TỔNG HỢP */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Bảng Lương Nhân Sự</Text>
        <View style={styles.tableHeader}>
          <Text style={[styles.th, {flex: 2}]}>Nhân viên</Text>
          <Text style={[styles.th, {flex: 1}]}>Giờ</Text>
          <Text style={[styles.th, {flex: 2, textAlign: 'right'}]}>Tổng Lương</Text>
        </View>
        {payrollData.length === 0 && <Text style={{color:'#888', marginTop:10}}>Chưa có nhân viên.</Text>}
        {payrollData.map(staff => (
          <View key={staff.id} style={styles.tableRow}>
            <Text style={[styles.td, {flex: 2, fontWeight: 'bold'}]}>{staff.name.split(' ')[0]}</Text>
            <Text style={[styles.td, {flex: 1}]}>{staff.totalHours.toFixed(1)}h</Text>
            <Text style={[styles.td, {flex: 2, textAlign: 'right', color: '#4CAF50', fontWeight: 'bold'}]}>{staff.totalSalary.toLocaleString()} đ</Text>
          </View>
        ))}
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Nhân Sự & Tiền Lương</Text>
        <Text style={{ color: '#666', marginBottom: 15 }}>Truy cập hệ thống HR để thêm nhân viên hoặc điều chỉnh mức lương theo giờ.</Text>
        <TouchableOpacity style={styles.hrBtn} onPress={() => navigation.navigate('StaffManagement')}>
          <Text style={styles.btnText}>Truy Cập Quản Lý Nhân Sự</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Nhân Viên Đang Trong Ca</Text>
        <View style={styles.staffCard}>
          <View style={styles.statusDot} />
          <Text style={styles.staffName}>Nguyễn Văn A (Barista)</Text>
          <Text style={styles.time}>Vào ca: 07:00 AM</Text>
        </View>
        <View style={styles.staffCard}>
          <View style={styles.statusDot} />
          <Text style={styles.staffName}>Trần Thị B (Thu ngân)</Text>
          <Text style={styles.time}>Vào ca: 07:15 AM</Text>
        </View>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Duyệt Báo Cáo Kho (Hôm nay)</Text>
        {reports.map((report) => (
          <View key={report.id} style={styles.reportCard}>
            <Text style={styles.reportItem}>{report.item}</Text>
            <Text>Nhập: {report.imported} | Xuất: {report.exported} | Tồn cuối: {report.ending}</Text>
            <View style={styles.row}>
              <Text style={{ marginTop: 5, fontWeight: 'bold', color: report.status === 'PENDING' ? 'orange' : 'green' }}>
                Trạng thái: {report.status === 'PENDING' ? 'CHỜ DUYỆT' : 'ĐÃ DUYỆT'}
              </Text>
              {report.status === 'PENDING' && (
                <TouchableOpacity style={styles.approveBtn} onPress={() => approveReport(report.id)}>
                  <Text style={styles.btnText}>Duyệt</Text>
                </TouchableOpacity>
              )}
            </View>
          </View>
        ))}
      </View>

      <TouchableOpacity style={styles.logoutBtn} onPress={() => navigation.replace('Login')}>
        <Text style={styles.btnText}>Đăng Xuất</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f5f5f5', padding: 20 },
  header: { fontSize: 24, fontWeight: 'bold', color: '#333', marginBottom: 20, marginTop: 40 },
  section: { backgroundColor: '#fff', padding: 20, borderRadius: 10, marginBottom: 20 },
  sectionTitle: { fontSize: 18, fontWeight: 'bold', marginBottom: 15, color: '#444' },
  staffCard: { flexDirection: 'row', alignItems: 'center', marginBottom: 10, padding: 10, backgroundColor: '#f9f9f9', borderRadius: 8 },
  statusDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: '#4CAF50', marginRight: 10 },
  staffName: { flex: 1, fontSize: 16, fontWeight: '500' },
  time: { color: '#888' },
  reportCard: { padding: 15, borderWidth: 1, borderColor: '#eee', borderRadius: 8, marginBottom: 10 },
  reportItem: { fontSize: 16, fontWeight: 'bold', color: '#2196F3', marginBottom: 5 },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 10 },
  approveBtn: { backgroundColor: '#4CAF50', paddingHorizontal: 15, paddingVertical: 8, borderRadius: 5 },
  btnText: { color: '#fff', fontWeight: 'bold' },
  logoutBtn: { backgroundColor: '#F44336', padding: 15, borderRadius: 10, alignItems: 'center', marginBottom: 40 },
  wageInput: { flex: 1, borderWidth: 1, borderColor: '#ccc', borderRadius: 5, paddingHorizontal: 10, height: 40, marginRight: 10 },
  updateBtn: { backgroundColor: '#2196F3', paddingHorizontal: 15, justifyContent: 'center', borderRadius: 5 },
  staffWageCard: { marginBottom: 15, paddingBottom: 15, borderBottomWidth: 1, borderBottomColor: '#eee' },
  hrBtn: { backgroundColor: '#FF9800', padding: 15, borderRadius: 8, alignItems: 'center', marginTop: 10 },
  tableHeader: { flexDirection: 'row', borderBottomWidth: 2, borderBottomColor: '#2196F3', paddingBottom: 10, marginBottom: 10 },
  th: { fontSize: 14, fontWeight: 'bold', color: '#1976d2' },
  tableRow: { flexDirection: 'row', paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#eee', alignItems: 'center' },
  td: { fontSize: 14, color: '#333' }
});
