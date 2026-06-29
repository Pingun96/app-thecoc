const fs = require('fs');

const path = 'd:\\APP Thecoc\\thecoc-mobile\\src\\screens\\StaffCheckinScreen.js';
let content = fs.readFileSync(path, 'utf8');

// 1. Add imports
content = content.replace(
  "import { Ionicons } from '@expo/vector-icons';",
  `import { Ionicons } from '@expo/vector-icons';
import * as Location from 'expo-location';
import { supabase } from '../services/supabaseClient';`
);

// 2. Add haversine & network time
const helpers = `
const getDistance = (lat1, lon1, lat2, lon2) => {
  if (lat1 == null || lon1 == null || lat2 == null || lon2 == null) return null;
  const R = 6371e3;
  const p1 = lat1 * Math.PI/180;
  const p2 = lat2 * Math.PI/180;
  const dp = (lat2-lat1) * Math.PI/180;
  const dl = (lon2-lon1) * Math.PI/180;
  const a = Math.sin(dp/2) * Math.sin(dp/2) +
            Math.cos(p1) * Math.cos(p2) *
            Math.sin(dl/2) * Math.sin(dl/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  return R * c;
};

const getNetworkTime = async () => {
  try {
    const res = await fetch('http://worldtimeapi.org/api/timezone/Asia/Ho_Chi_Minh');
    const data = await res.json();
    return new Date(data.datetime);
  } catch (e) {
    return new Date(); // fallback
  }
};
`;

content = content.replace(
  "export default function StaffCheckinScreen({ navigation }) {",
  helpers + "\nexport default function StaffCheckinScreen({ navigation }) {"
);

// 3. Destructure storeList and add Owner check
content = content.replace(
  "    shiftRegistrations,\n  } = useContext(AppContext);",
  "    shiftRegistrations,\n    storeList,\n    refreshData,\n  } = useContext(AppContext);"
);

// 4. Modify takePictureAndSubmit & add Owner update function
const oldLogic = content.substring(
  content.indexOf("  const requestAttendancePermissions = async () => {"),
  content.indexOf("  const latestRecord")
);

const newLogic = `
  const isOwner = currentUser?.role === 'OWNER';

  const handleUpdateStoreLocation = async () => {
    try {
      let { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Từ chối quyền', 'Cần quyền truy cập vị trí để cập nhật tọa độ.');
        return;
      }
      setIsSubmitting(true);
      let location = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
      const { latitude, longitude } = location.coords;
      
      const { error } = await supabase.from('stores').update({
        latitude,
        longitude,
        allowed_radius: 100
      }).eq('id', currentUser.store_id);
      
      if (error) throw error;
      Alert.alert('Thành công', 'Đã lưu tọa độ quán thành công. Nhân viên giờ đây phải đứng cách tối đa 100m mới được chấm công.');
      if (refreshData) await refreshData();
    } catch(e) {
      Alert.alert('Lỗi', e.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const validateLocation = async () => {
    const myStore = storeList.find(s => s.id === currentUser.store_id);
    if (!myStore?.latitude || !myStore?.longitude) {
      if (isOwner) {
         throw new Error('Chưa cấu hình Tọa độ. Vui lòng bấm Thiết lập tọa độ quán trước.');
      }
      throw new Error('Chủ cửa hàng chưa thiết lập Tọa độ Quán. Vui lòng báo quản lý.');
    }

    let { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== 'granted') {
      throw new Error('Bạn cần cấp quyền truy cập Vị trí (GPS) để chấm công.');
    }

    let location = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
    const dist = getDistance(location.coords.latitude, location.coords.longitude, myStore.latitude, myStore.longitude);
    
    if (dist === null) throw new Error('Không thể tính toán khoảng cách.');
    
    const allowed = myStore.allowed_radius || 100;
    if (dist > allowed) {
      throw new Error(\`Bạn đang cách cửa hàng \${Math.round(dist)}m. Bán kính cho phép là \${allowed}m. Vui lòng đến đúng cửa hàng để chấm công!\`);
    }

    return location.coords;
  };

  const handleAttendancePress = async (type) => {
    if (!currentUser?.id) {
      Alert.alert('Phiên đăng nhập không hợp lệ', 'Vui lòng đăng nhập lại.');
      return;
    }
    if (type === 'check-in' && currentRecord) {
      Alert.alert('Đã vào ca', 'Bạn cần kết thúc ca hiện tại trước khi chấm công mới.');
      return;
    }
    if (type === 'check-out' && !currentRecord) {
      Alert.alert('Không có ca đang mở', 'Không tìm thấy lượt check-in cần kết thúc.');
      return;
    }

    if (type === 'check-in') {
      const myApprovedShiftsToday = shiftRegistrations.filter(
        (r) => r.user_id === currentUser.id && r.date === today && r.status === 'APPROVED'
      );
      
      if (myApprovedShiftsToday.length === 0) {
        Alert.alert(
          'Không có lịch làm việc',
          'Quản lý chưa duyệt ca nào cho bạn trong ngày hôm nay.\\n\\nBạn có chắc chắn muốn Check-in làm ngoài ca không?',
          [
            { text: 'Hủy', style: 'cancel' },
            { 
              text: 'Vẫn Check-in', 
              onPress: () => {
                setActionType(type);
                takePictureAndSubmit('check-in');
              }
            }
          ]
        );
        return; 
      }
    }

    setActionType(type);
    takePictureAndSubmit(type);
  };

  const takePictureAndSubmit = async (currentAction) => {
    if (isSubmitting) return;
    setIsSubmitting(true);

    try {
      // 1. Location Validation
      let coords = { latitude: 0, longitude: 0 };
      if (!isOwner) { 
        // Owner can checkin anywhere, or maybe Owner doesn't need to check in.
        // Let's strictly enforce it for everyone to be safe, but give Owner a bypass if they want.
        // Actually, enforce for everyone!
      }
      coords = await validateLocation();

      // 2. Server Time Validation
      const now = await getNetworkTime();
      const time = getLocalTime(now);
      const timestamp = now.toISOString();
      const act = currentAction || actionType;

      if (act === 'check-in') {
        const recordId = \`att_\${Date.now()}\`;
        const savedRecord = await createAttendanceRecord({
          id: recordId,
          userId: currentUser.id,
          storeId: currentUser.store_id,
          date: today,
          time,
          timestamp,
          latitude: coords.latitude,
          longitude: coords.longitude,
          photoPath: '',
        });

        const normalizedRecord = normalizeAttendance({
          ...savedRecord,
          check_in_at: timestamp,
          check_in_lat: coords.latitude,
          check_in_lng: coords.longitude,
          check_in_photo_path: '',
        });
        setAttendanceHistory((current) => [...current, normalizedRecord]);

        Alert.alert(
          'Check-in thành công',
          \`\${time} • Đã lưu dữ liệu chấm công.\`,
        );
      } else {
        const workedHours = calculateWorkedHours({
          date: currentRecord.date,
          checkIn: currentRecord.checkIn || currentRecord.check_in,
          checkOut: time,
          checkInAt: currentRecord.check_in_at,
          checkOutAt: timestamp,
        });

        const savedFields = await checkoutAttendanceRecord({
          id: currentRecord.id,
          time,
          timestamp,
          hours: workedHours,
          latitude: coords.latitude,
          longitude: coords.longitude,
          photoPath: '',
        });

        setAttendanceHistory((current) => current.map((record) => (
          record.id === currentRecord.id
            ? normalizeAttendance({
                ...record,
                ...savedFields,
                check_out_at: timestamp,
                check_out_lat: coords.latitude,
                check_out_lng: coords.longitude,
                check_out_photo_path: '',
              })
            : record
        )));

        Alert.alert(
          'Check-out thành công',
          \`\${time} • Tổng thời gian: \${formatDuration(workedHours)}\`,
        );
      }
    } catch (error) {
      console.error('Lỗi chấm công:', error);
      Alert.alert(
        'Không thể chấm công',
        error?.message || 'Đã có lỗi khi lưu dữ liệu.',
      );
    } finally {
      setIsSubmitting(false);
    }
  };
`;

content = content.replace(oldLogic, newLogic);

// 5. Add Owner Button in JSX
const buttonJSX = `
        {isOwner && (
          <TouchableOpacity
            style={{backgroundColor: '#e2e8f0', padding: 15, borderRadius: 12, marginTop: 20, flexDirection: 'row', justifyContent: 'center', alignItems: 'center'}}
            onPress={handleUpdateStoreLocation}
          >
            <Ionicons name="location-outline" size={20} color="#475569" style={{marginRight: 8}}/>
            <Text style={{color: '#475569', fontWeight: 'bold'}}>Thiết lập tọa độ hiện tại cho Quán</Text>
          </TouchableOpacity>
        )}
      </ScrollView>
`;
content = content.replace("      </ScrollView>", buttonJSX);

fs.writeFileSync(path, content, 'utf8');
console.log('Script run successfully');
