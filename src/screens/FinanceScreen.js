import React, { useContext, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { AppContext } from '../context/AppContext';
import { getDailyRevenue } from '../services/financeService';

export default function FinanceScreen({ navigation }) {
  const { currentUser, storeList } = useContext(AppContext);
  const isOwner = currentUser?.role === 'OWNER';
  const [loading, setLoading] = useState(true);
  const [revenues, setRevenues] = useState([]);
  const [storeIdToView, setStoreIdToView] = useState(isOwner ? 'ALL' : currentUser?.store_id);

  const fetchRevenues = async () => {
    setLoading(true);
    try {
      const data = await getDailyRevenue(storeIdToView);
      setRevenues(data || []);
    } catch (e) {
      Alert.alert('Lỗi', 'Không thể lấy dữ liệu doanh thu: ' + e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchRevenues();
  }, [storeIdToView]);

  const totalRevenue = revenues.reduce((sum, item) => sum + Number(item.total_amount), 0);
  const storeName = storeIdToView === 'ALL' 
    ? 'Tất cả chi nhánh' 
    : storeList.find((s) => String(s.id) === String(storeIdToView))?.name || 'Chi nhánh';

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.headerRow}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={24} color="#1565c0" />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={styles.header}>Báo Cáo Doanh Thu</Text>
          <Text style={styles.headerCaption}>{storeName}</Text>
        </View>
        <TouchableOpacity onPress={fetchRevenues} style={styles.refreshBtn}>
          <Ionicons name="refresh" size={24} color="#1565c0" />
        </TouchableOpacity>
      </View>

      {isOwner && (
        <View style={styles.filterRow}>
          <TouchableOpacity
            style={[styles.filterBtn, storeIdToView === 'ALL' && styles.filterBtnActive]}
            onPress={() => setStoreIdToView('ALL')}
          >
            <Text style={[styles.filterBtnText, storeIdToView === 'ALL' && styles.filterBtnTextActive]}>Tất cả</Text>
          </TouchableOpacity>
          {storeList.map(s => (
            <TouchableOpacity
              key={s.id}
              style={[styles.filterBtn, storeIdToView === s.id && styles.filterBtnActive]}
              onPress={() => setStoreIdToView(s.id)}
            >
              <Text style={[styles.filterBtnText, storeIdToView === s.id && styles.filterBtnTextActive]}>{s.name}</Text>
            </TouchableOpacity>
          ))}
        </View>
      )}

      {loading ? (
        <View style={{ flex: 1, justifyContent: 'center' }}><ActivityIndicator size="large" color="#1565c0" /></View>
      ) : (
        <ScrollView style={styles.scrollContent}>
          <View style={styles.summaryCard}>
            <Text style={styles.summaryLabel}>Tổng Doanh Thu Ocha</Text>
            <Text style={styles.summaryValue}>{totalRevenue.toLocaleString('vi-VN')} đ</Text>
            <Text style={styles.summarySub}>Đồng bộ tự động từ NAS</Text>
          </View>

          <Text style={styles.sectionTitle}>Chi tiết theo ngày</Text>
          {revenues.length === 0 ? (
            <Text style={styles.emptyText}>Chưa có dữ liệu đồng bộ</Text>
          ) : (
            revenues.sort((a,b) => b.date.localeCompare(a.date)).map(item => (
              <View key={item.id} style={styles.row}>
                <View>
                  <Text style={styles.rowDate}>{item.date}</Text>
                  <Text style={styles.rowMeta}>{item.order_count} đơn hàng</Text>
                </View>
                <Text style={styles.rowAmount}>{Number(item.total_amount).toLocaleString('vi-VN')} đ</Text>
              </View>
            ))
          )}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f4f7fb' },
  headerRow: { flexDirection: 'row', alignItems: 'center', padding: 20 },
  backBtn: { marginRight: 15 },
  header: { fontSize: 24, fontWeight: 'bold', color: '#172033' },
  headerCaption: { fontSize: 14, color: '#64748b' },
  refreshBtn: { padding: 10 },
  filterRow: { flexDirection: 'row', paddingHorizontal: 20, marginBottom: 10 },
  filterBtn: { paddingHorizontal: 16, paddingVertical: 8, borderRadius: 20, backgroundColor: '#e2e8f0', marginRight: 10 },
  filterBtnActive: { backgroundColor: '#1565c0' },
  filterBtnText: { color: '#475569', fontWeight: '600' },
  filterBtnTextActive: { color: '#fff' },
  scrollContent: { padding: 20 },
  summaryCard: { backgroundColor: '#1565c0', padding: 20, borderRadius: 16, marginBottom: 20 },
  summaryLabel: { color: '#93c5fd', fontSize: 14, marginBottom: 5 },
  summaryValue: { color: '#fff', fontSize: 32, fontWeight: 'bold' },
  summarySub: { color: '#bfdbfe', fontSize: 12, marginTop: 5 },
  sectionTitle: { fontSize: 18, fontWeight: 'bold', color: '#334155', marginBottom: 15 },
  row: { flexDirection: 'row', justifyContent: 'space-between', backgroundColor: '#fff', padding: 15, borderRadius: 12, marginBottom: 10 },
  rowDate: { fontSize: 16, fontWeight: 'bold', color: '#1e293b' },
  rowMeta: { fontSize: 13, color: '#64748b', marginTop: 4 },
  rowAmount: { fontSize: 18, fontWeight: 'bold', color: '#16a34a' },
  emptyText: { textAlign: 'center', color: '#94a3b8', marginTop: 20 }
});
