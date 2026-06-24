import { supabase } from './supabaseClient';
import { isMissingColumnError } from './dataMappers';

const ATTENDANCE_BUCKET = 'attendance-photos';

export const formatCoordinate = (latitude, longitude) => (
  `${Number(latitude).toFixed(6)}, ${Number(longitude).toFixed(6)}`
);

export const uploadAttendancePhoto = async ({
  photoUri,
  userId,
  recordId,
  action,
}) => {
  if (!photoUri) return { path: null, error: 'Không tìm thấy ảnh chấm công.' };

  try {
    const response = await fetch(photoUri);
    const body = await response.arrayBuffer();
    const path = `${userId}/${recordId}/${action}.jpg`;
    const { error } = await supabase.storage
      .from(ATTENDANCE_BUCKET)
      .upload(path, body, {
        contentType: 'image/jpeg',
        upsert: true,
      });

    return error ? { path: null, error: error.message } : { path, error: null };
  } catch (error) {
    return { path: null, error: error?.message || 'Không thể tải ảnh lên.' };
  }
};

export const createAttendanceRecord = async ({
  id,
  userId,
  storeId,
  date,
  time,
  timestamp,
  latitude,
  longitude,
  photoPath,
}) => {
  const location = formatCoordinate(latitude, longitude);
  const legacyPayload = {
    id,
    user_id: userId,
    date,
    check_in: time,
    check_out: null,
    hours: 0,
    check_in_location: location,
  };
  const enhancedPayload = {
    ...legacyPayload,
    store_id: storeId || null,
    check_in_at: timestamp,
    check_in_lat: latitude,
    check_in_lng: longitude,
    check_in_photo_path: photoPath,
  };

  let result = await supabase.from('attendance_logs').insert([enhancedPayload]);
  if (result.error && isMissingColumnError(result.error)) {
    result = await supabase.from('attendance_logs').insert([legacyPayload]);
  }

  if (result.error) throw result.error;
  return legacyPayload;
};

export const checkoutAttendanceRecord = async ({
  id,
  time,
  timestamp,
  hours,
  latitude,
  longitude,
  photoPath,
}) => {
  const location = formatCoordinate(latitude, longitude);
  const legacyPayload = {
    check_out: time,
    hours,
    check_out_location: location,
  };
  const enhancedPayload = {
    ...legacyPayload,
    check_out_at: timestamp,
    check_out_lat: latitude,
    check_out_lng: longitude,
    check_out_photo_path: photoPath,
  };

  let result = await supabase
    .from('attendance_logs')
    .update(enhancedPayload)
    .eq('id', id);

  if (result.error && isMissingColumnError(result.error)) {
    result = await supabase
      .from('attendance_logs')
      .update(legacyPayload)
      .eq('id', id);
  }

  if (result.error) throw result.error;
  return legacyPayload;
};
