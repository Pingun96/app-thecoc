import React, { useContext } from 'react';
import { View, Text, StyleSheet, FlatList, TouchableOpacity, SafeAreaView } from 'react-native';
import { AppContext } from '../../App';

export default function StaffHistoryScreen({ navigation }) {
  const { currentUser, attendanceHistory } = useContext(AppContext);
  
  // Lọc lịch sử chấm công chỉ lấy của người đang đăng nhập
  const myHistory = attendanceHistory.filter(r => r.user_id === currentUser?.id);

  // Mức lương theo giờ của người này
  const myWage = currentUser?.wage || 0;

  // Tính tổng số giờ làm việc trong lịch sử và lương
  const totalHours = myHistory.reduce((sum, record) => sum + (record.hours || 0), 0);
  const estimatedSalary = totalHours * myWage;

  const renderItem = ({ item }) => (
    <View style={styles.historyCard}>
      <Text style={styles.dateText}>{item.date}</Text>
      <View style={styles.timeRow}>
        <Text style={styles.timeLabel}>In: {item.checkIn}</Text>
        <Text style={styles.timeLabel}>Out: {item.checkOut || 'Đang ca'}</Text>
      </View>
      <Text style={styles.hoursText}>Tổng: {item.hours ? item.hours + ' giờ' : '...'}</Text>
    </View>
  );

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.headerRow}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
          <Text style={styles.backText}>{'< Trở lại'}</Text>
        </TouchableOpacity>
        <Text style={styles.header}>Phiếu Lương Cá Nhân</Text>
      </View>

      <View style={styles.salaryCard}>
        <Text style={styles.salaryTitle}>THÁNG NÀY</Text>
        
        <View style={styles.salaryRow}>
          <Text style={styles.salaryLabel}>Tổng số giờ làm:</Text>
          <Text style={styles.salaryValue}>{totalHours.toFixed(2)} giờ</Text>
        </View>
        <View style={styles.salaryRow}>
          <Text style={styles.salaryLabel}>Mức lương (h):</Text>
          <Text style={styles.salaryValue}>{myWage.toLocaleString()} đ</Text>
        </View>
        <View style={styles.divider} />
        <View style={styles.salaryRow}>
          <Text style={styles.salaryLabelTotal}>Dự Kiến Lương:</Text>
          <Text style={styles.salaryTotalValue}>{estimatedSalary.toLocaleString()} VNĐ</Text>
        </View>
      </View>

      <Text style={styles.sectionTitle}>Lịch Sử Điểm Danh</Text>
      
      {myHistory.length === 0 ? (
        <Text style={{textAlign: 'center', color: '#888', marginTop: 20}}>Chưa có dữ liệu chấm công</Text>
      ) : (
        <FlatList
          data={myHistory}
          keyExtractor={(item) => item.id}
          renderItem={renderItem}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingBottom: 80 }}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f0f2f5', paddingHorizontal: 20 },
  headerRow: { flexDirection: 'row', alignItems: 'center', marginTop: 10, marginBottom: 20 },
  backBtn: { padding: 10, marginRight: 10 },
  backText: { color: '#2196F3', fontSize: 16, fontWeight: 'bold' },
  header: { fontSize: 22, fontWeight: 'bold', color: '#333' },
  
  salaryCard: { backgroundColor: '#4CAF50', padding: 20, borderRadius: 12, marginBottom: 25, elevation: 4 },
  salaryTitle: { color: '#e8f5e9', fontSize: 14, fontWeight: 'bold', marginBottom: 15 },
  salaryRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 10 },
  salaryLabel: { color: '#fff', fontSize: 16 },
  salaryValue: { color: '#fff', fontSize: 16, fontWeight: 'bold' },
  divider: { height: 1, backgroundColor: '#81c784', marginVertical: 10 },
  salaryLabelTotal: { color: '#fff', fontSize: 18, fontWeight: 'bold' },
  salaryTotalValue: { color: '#fff', fontSize: 24, fontWeight: '900' },

  sectionTitle: { fontSize: 18, fontWeight: 'bold', color: '#444', marginBottom: 15 },
  
  historyCard: { backgroundColor: '#fff', padding: 15, borderRadius: 10, marginBottom: 15, elevation: 2 },
  dateText: { fontSize: 16, fontWeight: 'bold', color: '#2196F3', marginBottom: 5 },
  timeRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 5 },
  timeLabel: { fontSize: 14, color: '#555' },
  hoursText: { fontSize: 14, fontWeight: 'bold', color: '#ff9800', textAlign: 'right' }
});
