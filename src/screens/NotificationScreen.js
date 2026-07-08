import React, { useState, useEffect, useContext, useMemo } from 'react';
import { View, Text, StyleSheet, FlatList, TouchableOpacity, SafeAreaView, ActivityIndicator, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../services/supabaseClient';
import { AppContext } from '../context/AppContext';

export default function NotificationScreen({ navigation }) {
  const { currentUser, COLORS, isDarkMode } = useContext(AppContext);
  const styles = useMemo(() => getStyles(COLORS, isDarkMode), [COLORS, isDarkMode]);
  const [notifications, setNotifications] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchNotifications();
  }, []);

  const fetchNotifications = async () => {
    if (!currentUser) return;
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from('notifications')
        .select('*')
        .eq('user_id', currentUser.id)
        .order('created_at', { ascending: false });

      if (error) throw error;
      setNotifications(data || []);
    } catch (err) {
      console.error('Error fetching notifications:', err);
    } finally {
      setLoading(false);
    }
  };

  const markAsRead = async (id, isRead) => {
    if (isRead) return; // Đã đọc rồi thì bỏ qua
    try {
      const { error } = await supabase
        .from('notifications')
        .update({ is_read: true })
        .eq('id', id);
      
      if (error) throw error;
      
      // Update local state
      setNotifications(notifications.map(n => n.id === id ? { ...n, is_read: true } : n));
    } catch (err) {
      console.error('Error marking as read:', err);
    }
  };

  const markAllAsRead = async () => {
    try {
      const { error } = await supabase
        .from('notifications')
        .update({ is_read: true })
        .eq('user_id', currentUser.id)
        .eq('is_read', false);
      
      if (error) throw error;
      
      setNotifications(notifications.map(n => ({ ...n, is_read: true })));
    } catch (err) {
      console.error('Error marking all as read:', err);
    }
  };

  const handlePressNotification = (item) => {
    markAsRead(item.id, item.is_read);

    const title = item.title.toLowerCase();
    
    if (title.includes('lương')) {
      navigation.navigate('Payroll');
    } else if (title.includes('chốt ca')) {
      navigation.navigate('Shifts');
    } else if (title.includes('lịch') || title.includes('ca') || title.includes('điều động')) {
      navigation.navigate('Dashboard', { screen: 'ScheduleTab' });
    }
  };

  const renderItem = ({ item }) => (
    <TouchableOpacity 
      style={[styles.notificationCard, item.is_read ? styles.readCard : styles.unreadCard]}
      onPress={() => handlePressNotification(item)}
    >
      <View style={styles.iconContainer}>
        <Ionicons name={item.is_read ? "notifications-outline" : "notifications"} size={24} color={item.is_read ? COLORS.textMuted : COLORS.primary} />
      </View>
      <View style={styles.contentContainer}>
        <Text style={[styles.title, !item.is_read && styles.unreadText]}>{item.title}</Text>
        <Text style={styles.body}>{item.body}</Text>
        <Text style={styles.time}>{new Date(item.created_at).toLocaleString('vi-VN')}</Text>
      </View>
      {!item.is_read && <View style={styles.unreadDot} />}
    </TouchableOpacity>
  );

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={24} color={COLORS.primary} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Thông báo</Text>
        <View style={styles.headerActions}>
          <TouchableOpacity onPress={markAllAsRead} style={styles.markAllBtn}>
            <Ionicons name="checkmark-done-circle-outline" size={24} color={COLORS.primary} />
          </TouchableOpacity>
        </View>
      </View>

      {loading ? (
        <ActivityIndicator size="large" color={COLORS.primary} style={{ marginTop: 50 }} />
      ) : notifications.length === 0 ? (
        <View style={styles.emptyContainer}>
          <Ionicons name="notifications-off-outline" size={60} color={COLORS.textMuted} />
          <Text style={styles.emptyText}>Bạn không có thông báo nào</Text>
        </View>
      ) : (
        <FlatList
          style={styles.flexRoot}
          data={notifications}
          keyExtractor={(item) => item.id}
          renderItem={renderItem}
          contentContainerStyle={{ padding: 15 }}
        />
      )}
    </SafeAreaView>
  );
}

const getStyles = (COLORS, isDarkMode) => StyleSheet.create({
  container: { flex: 1, minHeight: 0, overflow: Platform.OS === 'web' ? 'visible' : 'hidden', backgroundColor: COLORS.bg },
  flexRoot: { flex: 1, minHeight: 0 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 15,
    backgroundColor: COLORS.card,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  backBtn: { padding: 5 },
  headerTitle: { fontSize: 18, fontWeight: 'bold', color: COLORS.text },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  markAllBtn: { padding: 5 },
  emptyContainer: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  emptyText: { marginTop: 10, fontSize: 16, color: COLORS.textMuted },
  notificationCard: {
    flexDirection: 'row',
    padding: 15,
    backgroundColor: COLORS.card,
    borderRadius: 8,
    marginBottom: 10,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: COLORS.border,
    shadowColor: '#000',
    shadowOpacity: isDarkMode ? 0.25 : 0.05,
    shadowOffset: { width: 0, height: 2 },
    shadowRadius: 4,
    elevation: 2,
  },
  readCard: { opacity: 0.7 },
  unreadCard: { backgroundColor: isDarkMode ? '#0f2a44' : '#e3f2fd' },
  iconContainer: { marginRight: 15 },
  contentContainer: { flex: 1 },
  title: { fontSize: 15, color: COLORS.text, marginBottom: 5 },
  unreadText: { fontWeight: 'bold' },
  body: { fontSize: 14, color: COLORS.textMuted, marginBottom: 5 },
  time: { fontSize: 12, color: COLORS.textMuted },
  unreadDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: '#1976d2', marginLeft: 10 },
});
