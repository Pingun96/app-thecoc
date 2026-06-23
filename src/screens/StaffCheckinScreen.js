import React, { useState, useRef, useContext } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Modal, ActivityIndicator, ScrollView, SafeAreaView } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera'; 
import * as Location from 'expo-location';
import { Ionicons } from '@expo/vector-icons';
import { AppContext } from '../../App';

export default function StaffCheckinScreen({ navigation }) {
  const { currentUser, attendanceHistory, setAttendanceHistory } = useContext(AppContext);

  const [cameraPermission, requestCameraPermission] = useCameraPermissions();
  const [locationPermission, requestLocationPermission] = Location.useForegroundPermissions();
  
  const [showCamera, setShowCamera] = useState(false);
  const [actionType, setActionType] = useState(''); // 'check-in' hoặc 'check-out'
  const [isLoading, setIsLoading] = useState(false);
  const cameraRef = useRef(null);

  const today = new Date().toLocaleDateString('vi-VN');
  const currentRecord = attendanceHistory.find(r => r.user_id === currentUser?.id && r.date === today && !r.checkOut);
  const isCheckedIn = !!currentRecord;

  const handleAttendancePress = async (type) => {
    if (!cameraPermission?.granted) await requestCameraPermission();
    if (!locationPermission?.granted) await requestLocationPermission();
    
    if (cameraPermission?.granted && locationPermission?.granted) {
      setActionType(type);
      setShowCamera(true);
    } else {
      alert('Cần cấp quyền Camera và Vị trí để tiếp tục.');
    }
  };

  const takePictureAndSubmit = async () => {
    if (!cameraRef.current) return;
    setIsLoading(true);
    
    try {
      const photo = await cameraRef.current.takePictureAsync({ quality: 0.5 });
      const currentLocation = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      const { latitude, longitude } = currentLocation.coords;

      const time = new Date().toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });

      if (actionType === 'check-in') {
        const newRecord = {
          id: `att_${Date.now()}`,
          user_id: currentUser.id,
          date: today,
          checkIn: time,
          checkOut: null,
          hours: 0
        };
        setAttendanceHistory([...attendanceHistory, newRecord]);
        alert(`Đã CHECK-IN lúc ${time}\nTọa độ: ${latitude.toFixed(4)}, ${longitude.toFixed(4)}`);
      } else {
        const simulatedHours = Number((Math.random() * 4 + 4).toFixed(2));
        
        const updatedHistory = attendanceHistory.map(r => {
          if (r.id === currentRecord.id) {
            return { ...r, checkOut: time, hours: simulatedHours };
          }
          return r;
        });

        setAttendanceHistory(updatedHistory);
        alert(`Đã CHECK-OUT lúc ${time}.\nGhi nhận làm được ${simulatedHours} giờ.\nTọa độ: ${latitude.toFixed(4)}, ${longitude.toFixed(4)}`);
      }

      setShowCamera(false);
    } catch (error) {
      alert('Lỗi chụp ảnh/GPS: Hãy chắc chắn bạn đã cho phép quyền vị trí trên trình duyệt.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: 80 }} style={{ flex: 1 }}>
        <View style={styles.headerRow}>
          <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
            <Ionicons name="arrow-back" size={24} color="#1976d2" />
          </TouchableOpacity>
          <Text style={styles.header}>Chấm Công (GPS & Camera)</Text>
        </View>
        
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Hôm nay: {today}</Text>
          <Text style={{color: '#666', marginBottom: 15}}>Vui lòng cho phép ứng dụng truy cập Định vị và Camera để xác thực chấm công.</Text>
          <View style={styles.buttonRow}>
            {!isCheckedIn ? (
              <TouchableOpacity style={[styles.button, styles.btnCheckIn, { flex: 1 }]} onPress={() => handleAttendancePress('check-in')}>
                <Text style={styles.buttonText}>CHECK-IN VÀO CA</Text>
              </TouchableOpacity>
            ) : (
              <TouchableOpacity style={[styles.button, styles.btnCheckOut, { flex: 1 }]} onPress={() => handleAttendancePress('check-out')}>
                <Text style={styles.buttonText}>CHECK-OUT KẾT THÚC</Text>
                <Text style={{color:'#fff', marginTop: 5, fontSize: 12}}>Đã vào ca lúc: {currentRecord.checkIn}</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>

        <Modal visible={showCamera} animationType="slide">
          <View style={{ flex: 1 }}>
            {cameraPermission?.granted && (
              <CameraView style={{ flex: 1 }} facing="front" ref={cameraRef}>
                <View style={styles.cameraOverlay}>
                  {isLoading ? (
                    <ActivityIndicator size="large" color="#4CAF50" />
                  ) : (
                    <>
                      <TouchableOpacity style={styles.captureBtn} onPress={takePictureAndSubmit}>
                        <Text style={styles.buttonText}>Chụp Ảnh & {actionType === 'check-in' ? 'Vào ca' : 'Kết thúc ca'}</Text>
                      </TouchableOpacity>
                      <TouchableOpacity style={styles.cancelBtn} onPress={() => setShowCamera(false)}>
                        <Text style={styles.buttonText}>Hủy thao tác</Text>
                      </TouchableOpacity>
                    </>
                  )}
                </View>
              </CameraView>
            )}
          </View>
        </Modal>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f0f2f5', paddingHorizontal: 20 },
  headerRow: { flexDirection: 'row', alignItems: 'center', marginTop: 10, marginBottom: 20 },
  backBtn: { padding: 5, marginRight: 10 },
  header: { fontSize: 24, fontWeight: 'bold', color: '#1f2937' },
  section: { backgroundColor: '#fff', padding: 20, borderRadius: 12, marginBottom: 20, elevation: 3 },
  sectionTitle: { fontSize: 16, fontWeight: '700', marginBottom: 15, color: '#444' },
  buttonRow: { flexDirection: 'row', justifyContent: 'space-between' },
  button: { padding: 15, borderRadius: 8, alignItems: 'center' },
  btnCheckIn: { backgroundColor: '#4CAF50' },
  btnCheckOut: { backgroundColor: '#F44336' },
  buttonText: { color: '#fff', fontWeight: 'bold', fontSize: 15 },
  cameraOverlay: { flex: 1, justifyContent: 'flex-end', alignItems: 'center', paddingBottom: 50 },
  captureBtn: { backgroundColor: '#4CAF50', padding: 18, borderRadius: 30, marginBottom: 15, width: 250, alignItems: 'center', elevation: 5 },
  cancelBtn: { backgroundColor: '#F44336', padding: 15, borderRadius: 30, width: 250, alignItems: 'center' }
});
