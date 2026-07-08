import { supabase } from './supabaseClient';
import { isMissingColumnError } from './dataMappers';

const ATTENDANCE_BUCKET = 'attendance-photos';

export const formatCoordinate = (latitude, longitude) => (
  `${Number(latitude).toFixed(6)}, ${Number(longitude).toFixed(6)}`
);

const isMissingRelationError = (error) => (
  error?.code === '42P01'
  || error?.code === 'PGRST205'
  || /relation .* does not exist|Could not find the table/i.test(error?.message || '')
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
  const parsedStoreId = (storeId === 'null' || storeId === 'undefined' || !storeId) ? null : Number(storeId);
  const enhancedPayload = {
    ...legacyPayload,
    store_id: parsedStoreId,
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

export const reopenAttendanceRecord = async ({ id }) => {
  const legacyPayload = {
    check_out: null,
    hours: 0,
    check_out_location: null,
  };
  const enhancedPayload = {
    ...legacyPayload,
    check_out_at: null,
    check_out_lat: null,
    check_out_lng: null,
    check_out_photo_path: null,
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

export const createAttendanceCorrection = async ({
  attendanceId,
  userId,
  storeId,
  date,
  action,
  previousCheckOut,
  previousCheckOutAt,
  previousHours,
  requestedBy,
  note,
}) => {
  const payload = {
    id: `corr_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    attendance_id: attendanceId,
    user_id: userId,
    store_id: storeId || null,
    date,
    action,
    previous_check_out: previousCheckOut || null,
    previous_check_out_at: previousCheckOutAt || null,
    previous_hours: Number(previousHours || 0),
    requested_by: requestedBy,
    note: note || '',
    status: 'PENDING',
    created_at: new Date().toISOString(),
  };

  const result = await supabase
    .from('attendance_corrections')
    .insert([payload])
    .select('*')
    .maybeSingle();

  if (result.error && isMissingRelationError(result.error)) {
    console.log('attendance_corrections table is not available yet.');
    return null;
  }

  if (result.error) throw result.error;
  return result.data || payload;
};

export const reviewAttendanceCorrection = async ({
  id,
  status,
  reviewedBy,
  reviewNote,
}) => {
  const payload = {
    status,
    reviewed_by: reviewedBy,
    reviewed_at: new Date().toISOString(),
    review_note: reviewNote || '',
  };

  const result = await supabase
    .from('attendance_corrections')
    .update(payload)
    .eq('id', id)
    .select('*')
    .maybeSingle();

  if (result.error && isMissingRelationError(result.error)) {
    console.log('attendance_corrections table is not available yet.');
    return null;
  }

  if (result.error) throw result.error;
  return result.data || { id, ...payload };
};
