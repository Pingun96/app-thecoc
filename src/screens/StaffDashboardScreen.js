import React, { useState, useRef, useContext } from 'react';
import { View, Text, TouchableOpacity, TextInput, StyleSheet, Alert, Modal, ActivityIndicator, ScrollView } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera'; 
import * as Location from 'expo-location';
import { AppContext } from '../../App';

export default function StaffDashboardScreen({ navigation }) {
  const { currentUser, attendanceHistory, setAttendanceHistory } = useContext(AppContext);

  // Khởi tạo quyền Camera và GPS
  const [cameraPermission, requestCameraPermission] = useCameraPermissions();
  const [locationPermission, requestLocationPermission] = Location.useForegroundPermissions();
  
  // States điều khiển giao diện
  const [showCamera, setShowCamera] = useState(false);
  const [actionType, setActionType] = useState(''); // 'check-in' hoặc 'check-out'
  const [isLoading, setIsLoading] = useState(false);
  const cameraRef = useRef(null);

  // Tìm kiếm xem nhân viên hôm nay đã check-in chưa
  const today = new Date().toLocaleDateString('vi-VN');
  const currentRecord = attendanceHistory.find(r => r.user_id === currentUser?.id && r.date === today && !r.checkOut);
  const isCheckedIn = !!currentRecord;

  // State Form Báo cáo kho
  const [reportData, setReportData] = useState({
    itemId: '', 
    imported: '',
    exported: '',
    ending: '',
  });

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
      // 1. Chụp ảnh selfie
      const photo = await cameraRef.current.takePictureAsync({ quality: 0.5 });
      
      // 2. Lấy tọa độ GPS
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
        // Check-out
        // Tính toán số giờ mô phỏng (giả lập random từ 4 đến 8 tiếng)
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

  const submitDailyReport = async () => {
    if (!reportData.itemId || !reportData.ending) {
      alert('Vui lòng điền mã NL và tồn cuối.');
      return;
    }

    setIsLoading(true);
    setTimeout(() => {
      alert('Đã nộp báo cáo nguyên vật liệu cho hôm nay.');
      setReportData({ itemId: '', imported: '', exported: '', ending: '' });
      setIsLoading(false);
    }, 1000);
  };

  return (
    <ScrollView style={styles.container} keyboardShouldPersistTaps="handled">
      <View style={styles.headerProfile}>
        <Text style={styles.header}>The Cốc Bình Khánh</Text>
        <Text style={styles.staffName}>Nhân viên: {currentUser?.name}</Text>
      </View>
      
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Chấm Công (Selfie & GPS)</Text>
        <View style={styles.buttonRow}>
          {!isCheckedIn ? (
            <TouchableOpacity style={[styles.button, styles.btnCheckIn, { flex: 1 }]} onPress={() => handleAttendancePress('check-in')}>
              <Text style={styles.buttonText}>CHECK-IN</Text>
            </TouchableOpacity>
          ) : (
            <TouchableOpacity style={[styles.button, styles.btnCheckOut, { flex: 1 }]} onPress={() => handleAttendancePress('check-out')}>
              <Text style={styles.buttonText}>CHECK-OUT</Text>
              <Text style={{color:'#fff', marginTop: 5, fontSize: 12}}>Đã vào ca lúc: {currentRecord.checkIn}</Text>
            </TouchableOpacity>
          )}
        </View>
        <TouchableOpacity style={styles.historyBtn} onPress={() => navigation.navigate('StaffHistory')}>
          <Text style={styles.historyBtnText}>Xem Lịch Sử Điểm Danh & Lương</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Báo Cáo Kho / Nguyên Liệu</Text>
        <TextInput 
          style={styles.input} 
          placeholder="Mã Nguyên Liệu (VD: 1, 2)" 
          value={reportData.itemId}
          onChangeText={(txt) => setReportData({...reportData, itemId: txt})}
        />
        <TextInput 
          style={styles.input} 
          placeholder="Số lượng NHẬP thêm (nếu có)" 
          keyboardType="numeric"
          value={reportData.imported}
          onChangeText={(txt) => setReportData({...reportData, imported: txt})}
        />
        <TextInput 
          style={styles.input} 
          placeholder="Số lượng XUẤT ra" 
          keyboardType="numeric"
          value={reportData.exported}
          onChangeText={(txt) => setReportData({...reportData, exported: txt})}
        />
        <TextInput 
          style={styles.input} 
          placeholder="Số lượng TỒN CUỐI (Bắt buộc)" 
          keyboardType="numeric"
          value={reportData.ending}
          onChangeText={(txt) => setReportData({...reportData, ending: txt})}
        />
        <TouchableOpacity style={styles.submitBtn} onPress={submitDailyReport}>
          <Text style={styles.buttonText}>GỬI BÁO CÁO</Text>
        </TouchableOpacity>
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
      
      <TouchableOpacity style={styles.logoutBtn} onPress={() => navigation.replace('Login')}>
        <Text style={styles.buttonText}>Đăng Xuất</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f0f2f5', padding: 20 },
  headerProfile: { alignItems: 'center', marginTop: 40, marginBottom: 20 },
  header: { fontSize: 24, fontWeight: 'bold', color: '#1f2937' },
  staffName: { fontSize: 16, color: '#555', marginTop: 5 },
  section: { backgroundColor: '#fff', padding: 20, borderRadius: 12, marginBottom: 20, elevation: 3 },
  sectionTitle: { fontSize: 16, fontWeight: '700', marginBottom: 15, color: '#444' },
  buttonRow: { flexDirection: 'row', justifyContent: 'space-between' },
  button: { padding: 15, borderRadius: 8, alignItems: 'center' },
  btnCheckIn: { backgroundColor: '#4CAF50' },
  btnCheckOut: { backgroundColor: '#F44336' },
  buttonText: { color: '#fff', fontWeight: 'bold', fontSize: 15 },
  input: { borderWidth: 1, borderColor: '#e0e0e0', padding: 12, borderRadius: 8, marginBottom: 12, backgroundColor: '#fafafa' },
  submitBtn: { backgroundColor: '#2196F3', padding: 15, borderRadius: 8, alignItems: 'center', marginTop: 5 },
  cameraOverlay: { flex: 1, justifyContent: 'flex-end', alignItems: 'center', paddingBottom: 50 },
  captureBtn: { backgroundColor: '#4CAF50', padding: 18, borderRadius: 30, marginBottom: 15, width: 250, alignItems: 'center', elevation: 5 },
  cancelBtn: { backgroundColor: '#F44336', padding: 15, borderRadius: 30, width: 250, alignItems: 'center' },
  historyBtn: { marginTop: 15, backgroundColor: '#e3f2fd', padding: 12, borderRadius: 8, alignItems: 'center', borderWidth: 1, borderColor: '#bbdefb' },
  historyBtnText: { color: '#1976d2', fontWeight: 'bold' },
  logoutBtn: { backgroundColor: '#9e9e9e', padding: 15, borderRadius: 10, alignItems: 'center', marginBottom: 40 },
});
