export const SHIFT_WINDOWS = {
  MORNING: {
    key: 'MORNING',
    label: 'Ca sáng',
    shortLabel: 'Sáng',
    start: '06:30',
    end: '14:00',
    checkInFrom: '06:00',
  },
  AFTERNOON: {
    key: 'AFTERNOON',
    label: 'Ca chiều',
    shortLabel: 'Chiều',
    start: '14:00',
    end: '22:00',
    checkInFrom: '13:30',
  },
};

export const GRACE_MINUTES = 5;

export const timeToMinutes = (timeValue) => {
  const match = String(timeValue || '').match(/^(\d{1,2}):(\d{2})/);
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
};

export const minutesToTime = (minutes) => {
  const safe = Math.max(0, Number(minutes) || 0);
  const hh = Math.floor(safe / 60);
  const mm = safe % 60;
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
};

export const getShiftWindow = (shiftType) => SHIFT_WINDOWS[shiftType] || null;

export const getShiftLabel = (shiftType) => getShiftWindow(shiftType)?.label || 'Ngoài lịch';

export const inferShiftTypeFromTime = (timeValue) => {
  const minutes = timeToMinutes(timeValue);
  if (minutes == null) return null;
  return minutes < timeToMinutes(SHIFT_WINDOWS.AFTERNOON.checkInFrom) ? 'MORNING' : 'AFTERNOON';
};

export const getAttendanceShiftType = (record = {}) => (
  record.scheduled_shift_type
  || record.shift_type
  || record.shiftType
  || inferShiftTypeFromTime(record.checkIn || record.check_in)
);

export const getShiftStatusFromTimes = ({
  shiftType,
  checkIn,
  checkOut,
}) => {
  const window = getShiftWindow(shiftType);
  if (!window) {
    return {
      isLate: false,
      isEarlyLeave: false,
      overtimeMinutes: 0,
      lateMinutes: 0,
      earlyLeaveMinutes: 0,
    };
  }

  const inMinutes = timeToMinutes(checkIn);
  const outMinutes = timeToMinutes(checkOut);
  const startMinutes = timeToMinutes(window.start);
  const endMinutes = timeToMinutes(window.end);

  const lateMinutes = inMinutes == null ? 0 : Math.max(0, inMinutes - startMinutes);
  const earlyLeaveMinutes = outMinutes == null ? 0 : Math.max(0, endMinutes - outMinutes);
  const overtimeMinutes = outMinutes == null ? 0 : Math.max(0, outMinutes - endMinutes);

  return {
    lateMinutes,
    earlyLeaveMinutes,
    overtimeMinutes,
    scheduledMinutes: Math.max(0, endMinutes - startMinutes),
    isLate: lateMinutes > GRACE_MINUTES,
    isEarlyLeave: earlyLeaveMinutes > GRACE_MINUTES,
  };
};

const formatMinutes = (minutes = 0) => {
  const safe = Math.max(0, Number(minutes) || 0);
  const hours = Math.floor(safe / 60);
  const mins = safe % 60;
  if (hours > 0 && mins > 0) return `${hours}g ${mins}p`;
  if (hours > 0) return `${hours}g`;
  return `${mins}p`;
};

const buildPayrollImpact = (type, minutes = 0) => {
  if (type === 'missing_checkin') return 'Không có lượt chấm công cho ca đã duyệt. Cần xác minh trước khi tính lương.';
  if (type === 'outside_schedule') return 'Có giờ công ngoài lịch/sai chi nhánh. Cần duyệt vào lịch hoặc loại khỏi bảng lương.';
  if (type === 'missing_checkout') return 'Thiếu checkout nên giờ công chưa minh bạch. Cần nhân viên/quản lý bổ sung trước khi chốt lương.';
  if (type === 'late') return `Đi trễ ${formatMinutes(minutes)}. Cần áp dụng quy định trừ công/phạt nếu có.`;
  if (type === 'early_leave') return `Về sớm ${formatMinutes(minutes)}. Cần áp dụng quy định trừ công/phạt nếu có.`;
  if (type === 'overtime') return `Tăng ca ${formatMinutes(minutes)}. Cần duyệt nếu được cộng giờ/thưởng.`;
  if (type === 'attendance_correction') return 'Nhân viên đã mở lại ca sau khi check-out nhầm. Quản lý cần duyệt để lưu vết trước khi chốt lương.';
  return 'Cần kiểm tra trước khi chốt lương.';
};

export const findApprovedShiftForAttendance = ({
  shiftRegistrations = [],
  userId,
  date,
  storeId,
  shiftType,
}) => shiftRegistrations.find((shift) => (
  String(shift.user_id) === String(userId)
  && shift.date === date
  && shift.status === 'APPROVED'
  && (!shiftType || shift.shift_type === shiftType)
  && (storeId == null || String(shift.store_id) === String(storeId))
));

export const findBestShiftForCheckIn = ({
  shiftRegistrations = [],
  userId,
  date,
  currentTime,
}) => {
  const approvedToday = shiftRegistrations.filter((shift) => (
    String(shift.user_id) === String(userId)
    && shift.date === date
    && shift.status === 'APPROVED'
  ));

  if (!approvedToday.length) {
    return { shift: null, approvedToday, preferredShiftType: inferShiftTypeFromTime(currentTime) };
  }

  const preferredShiftType = inferShiftTypeFromTime(currentTime);
  const exactShift = approvedToday.find((shift) => shift.shift_type === preferredShiftType);
  if (exactShift) return { shift: exactShift, approvedToday, preferredShiftType };

  return { shift: null, approvedToday, preferredShiftType };
};

export const buildAttendanceReview = ({
  attendanceHistory = [],
  attendanceCorrectionLogs = [],
  shiftRegistrations = [],
  staffList = [],
  storeList = [],
  date,
  storeId = 'ALL',
}) => {
  const approvedShifts = shiftRegistrations.filter((shift) => (
    shift.date === date
    && shift.status === 'APPROVED'
    && (storeId === 'ALL' || String(shift.store_id) === String(storeId))
  ));

  const records = attendanceHistory.filter((record) => (
    record.date === date
    && (storeId === 'ALL' || String(record.store_id) === String(storeId))
  ));

  const getStaff = (userId) => staffList.find((staff) => String(staff.id) === String(userId));
  const getStore = (id) => storeList.find((store) => String(store.id) === String(id));

  const rows = [];

  attendanceCorrectionLogs
    .filter((correction) => (
      correction.date === date
      && correction.status === 'PENDING'
      && (storeId === 'ALL' || String(correction.store_id) === String(storeId))
    ))
    .forEach((correction) => {
      const record = records.find((item) => String(item.id) === String(correction.attendance_id));
      rows.push({
        id: `correction_${correction.id}`,
        type: 'attendance_correction',
        category: 'approval',
        severity: 'warning',
        title: 'Chờ duyệt chỉnh công',
        payrollImpact: buildPayrollImpact('attendance_correction'),
        impactMinutes: 0,
        staff: getStaff(correction.user_id),
        store: getStore(correction.store_id),
        correction,
        record,
        shiftType: getAttendanceShiftType(record) || inferShiftTypeFromTime(record?.checkIn || record?.check_in || correction.previous_check_out),
      });
    });

  approvedShifts.forEach((shift) => {
    const matchedRecord = records.find((record) => {
      const recordShiftType = getAttendanceShiftType(record);
      return String(record.user_id) === String(shift.user_id)
        && String(record.store_id) === String(shift.store_id)
        && recordShiftType === shift.shift_type;
    });

    if (!matchedRecord) {
      rows.push({
        id: `missing_${shift.id}`,
        type: 'missing_checkin',
        category: 'absence',
        severity: 'danger',
        title: 'Có lịch nhưng chưa check-in',
        payrollImpact: buildPayrollImpact('missing_checkin'),
        impactMinutes: timeToMinutes(getShiftWindow(shift.shift_type)?.end) - timeToMinutes(getShiftWindow(shift.shift_type)?.start),
        staff: getStaff(shift.user_id),
        store: getStore(shift.store_id),
        shift,
        shiftType: shift.shift_type,
      });
      return;
    }

    const timeStatus = getShiftStatusFromTimes({
      shiftType: shift.shift_type,
      checkIn: matchedRecord.checkIn || matchedRecord.check_in,
      checkOut: matchedRecord.checkOut || matchedRecord.check_out,
    });

    if (timeStatus.isLate) {
      rows.push({
        id: `late_${matchedRecord.id}`,
        type: 'late',
        category: 'time',
        severity: 'warning',
        title: `Đi trễ ${timeStatus.lateMinutes} phút`,
        payrollImpact: buildPayrollImpact('late', timeStatus.lateMinutes),
        impactMinutes: timeStatus.lateMinutes,
        timeStatus,
        staff: getStaff(shift.user_id),
        store: getStore(shift.store_id),
        shift,
        record: matchedRecord,
        shiftType: shift.shift_type,
      });
    }

    if (!matchedRecord.checkOut && !matchedRecord.check_out) {
      rows.push({
        id: `open_${matchedRecord.id}`,
        type: 'missing_checkout',
        category: 'missing_data',
        severity: 'danger',
        title: 'Chưa checkout',
        payrollImpact: buildPayrollImpact('missing_checkout'),
        impactMinutes: 0,
        timeStatus,
        staff: getStaff(shift.user_id),
        store: getStore(shift.store_id),
        shift,
        record: matchedRecord,
        shiftType: shift.shift_type,
      });
    } else if (timeStatus.isEarlyLeave) {
      rows.push({
        id: `early_${matchedRecord.id}`,
        type: 'early_leave',
        category: 'time',
        severity: 'warning',
        title: `Về sớm ${timeStatus.earlyLeaveMinutes} phút`,
        payrollImpact: buildPayrollImpact('early_leave', timeStatus.earlyLeaveMinutes),
        impactMinutes: timeStatus.earlyLeaveMinutes,
        timeStatus,
        staff: getStaff(shift.user_id),
        store: getStore(shift.store_id),
        shift,
        record: matchedRecord,
        shiftType: shift.shift_type,
      });
    } else if (timeStatus.overtimeMinutes > GRACE_MINUTES) {
      rows.push({
        id: `overtime_${matchedRecord.id}`,
        type: 'overtime',
        category: 'overtime',
        severity: 'info',
        title: `Tăng ca ${timeStatus.overtimeMinutes} phút`,
        payrollImpact: buildPayrollImpact('overtime', timeStatus.overtimeMinutes),
        impactMinutes: timeStatus.overtimeMinutes,
        timeStatus,
        staff: getStaff(shift.user_id),
        store: getStore(shift.store_id),
        shift,
        record: matchedRecord,
        shiftType: shift.shift_type,
      });
    }
  });

  records.forEach((record) => {
    const recordShiftType = getAttendanceShiftType(record);
    const matchedShift = findApprovedShiftForAttendance({
      shiftRegistrations,
      userId: record.user_id,
      date: record.date,
      storeId: record.store_id,
      shiftType: recordShiftType,
    });

    if (!matchedShift) {
      rows.push({
        id: `outside_${record.id}`,
        type: 'outside_schedule',
        category: 'schedule',
        severity: 'danger',
        title: 'Check-in ngoài lịch hoặc sai chi nhánh',
        payrollImpact: buildPayrollImpact('outside_schedule'),
        impactMinutes: Math.round(Number(record.hours || 0) * 60),
        staff: getStaff(record.user_id),
        store: getStore(record.store_id),
        record,
        shiftType: recordShiftType,
      });
    }
  });

  return rows;
};
