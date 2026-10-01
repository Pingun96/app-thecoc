export class AuthorizationError extends Error {
  constructor(message = 'Bạn không có quyền thực hiện thao tác này.', status = 403) {
    super(message);
    this.name = 'AuthorizationError';
    this.status = status;
  }
}

const DEFAULTS = {
  STAFF: {
    cashier: false, inventory: false, central_warehouse: false, hr: true,
    payroll: true, finance: false, reports: false, can_schedule_shift: false,
    is_primary_manager: false, manage_permissions: false,
  },
  MANAGER: {
    cashier: true, inventory: true, central_warehouse: false, hr: true,
    payroll: false, finance: false, reports: false, can_schedule_shift: true,
    is_primary_manager: false, manage_permissions: false,
  },
};

export const effectivePermissions = (user = {}) => {
  const explicit = user.permissions && typeof user.permissions === 'object' ? user.permissions : {};
  const merged = { ...(DEFAULTS[user.role] || DEFAULTS.STAFF), ...explicit };
  if (user.is_primary_manager === true && explicit.is_primary_manager == null) merged.is_primary_manager = true;
  if (merged.finance === true || merged.reports === true) merged.finance = merged.reports = true;
  if (merged.is_primary_manager === true) merged.cashier = true;
  return merged;
};

export const hasPermission = (user, key) => (
  user?.role === 'OWNER' || effectivePermissions(user)[key] === true
);

export const allowedStoreIds = (user = {}) => [...new Set([
  user.store_id,
  ...(Array.isArray(user.permissions?.viewable_stores) ? user.permissions.viewable_stores : []),
].filter((value) => value !== null && value !== undefined && value !== '').map(String))];

export const canAccessStore = (user, storeId) => (
  user?.role === 'OWNER'
  || (storeId !== null && storeId !== undefined && allowedStoreIds(user).includes(String(storeId)))
);

const businessDateTimeParts = (date = new Date()) => {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Ho_Chi_Minh',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(date);
  const value = (type) => parts.find((part) => part.type === type)?.value;
  return {
    dateKey: `${value('year')}-${value('month')}-${value('day')}`,
    minutes: Number(value('hour')) * 60 + Number(value('minute')),
  };
};

export const getStaffRevenueWindow = (date = new Date()) => {
  const { minutes } = businessDateTimeParts(date);
  if (minutes >= 13 * 60 + 30 && minutes < 14 * 60) return 'MORNING';
  if (minutes >= 21 * 60 && minutes < 22 * 60) return 'AFTERNOON';
  return null;
};

export const userForId = (users, userId) => users.find((item) => String(item.id) === String(userId));

const relatedStoreIds = (record, table, context) => {
  if (table === 'stores' && record?.id != null) return [String(record.id)];
  const direct = [
    record?.store_id,
    record?.source_store_id,
    record?.destination_store_id,
    ...(table === 'users' && Array.isArray(record?.permissions?.viewable_stores) ? record.permissions.viewable_stores : []),
  ]
    .filter((value) => value !== null && value !== undefined && value !== '')
    .map(String);
  if (direct.length) return direct;

  if (record?.user_id) {
    const relatedUser = userForId(context.users, record.user_id);
    if (relatedUser?.store_id != null) return [String(relatedUser.store_id)];
  }
  if (table === 'users' && record?.id) {
    return [record.store_id].filter((value) => value != null).map(String);
  }
  if (table === 'shift_swaps' && record?.shift_id) {
    const shift = context.shiftRegistrations?.find((item) => String(item.id) === String(record.shift_id));
    if (shift?.store_id != null) return [String(shift.store_id)];
  }
  return [];
};

export const recordInScope = (user, record, table, context) => {
  if (user?.role === 'OWNER') return true;
  if (table === 'users' && record?.role === 'OWNER') return true;
  if (record?.user_id && userForId(context.users, record.user_id)?.role === 'OWNER') return true;
  const stores = relatedStoreIds(record, table, context);
  if (hasPermission(user, 'central_warehouse') && stores.some((storeId) => {
    const store = context.stores?.find((item) => String(item.id) === String(storeId));
    const name = String(store?.name || store?.store_name || '').toLowerCase();
    return store?.is_warehouse === true || store?.is_central_warehouse === true || name.includes('kho tổng') || name.includes('kho tong');
  })) return true;
  if (stores.length) return stores.some((storeId) => canAccessStore(user, storeId));
  return String(record?.user_id || '') === String(user?.id || '');
};

const canReadTable = (user, table, context) => {
  if (user.role === 'OWNER') return true;
  if (['stores', 'users', 'shift_registrations', 'shift_swaps', 'notifications', 'push_tokens'].includes(table)) return true;
  if (['inventory_items', 'inventory_logs', 'inventory_tickets'].includes(table)) {
    return hasPermission(user, 'inventory') || hasPermission(user, 'cashier') || hasPermission(user, 'central_warehouse');
  }
  if (table === 'shifts') return hasPermission(user, 'cashier');
  if (table === 'attendance_logs') return user.role === 'STAFF' || hasPermission(user, 'hr') || hasPermission(user, 'payroll');
  if (['payroll_adjustments', 'payroll_approvals'].includes(table)) return hasPermission(user, 'payroll');
  if (table === 'daily_revenue') {
    if (hasPermission(user, 'finance')) return true;
    if (!hasPermission(user, 'cashier')) return false;
    return user.role !== 'STAFF' || getStaffRevenueWindow(context.now) !== null;
  }
  if (table === 'attendance_correction_requests') return user.role === 'STAFF' || hasPermission(user, 'hr');
  return false;
};

export const filterReadableRecords = (user, table, records, context) => {
  if (!canReadTable(user, table, context)) return [];
  if (user.role === 'OWNER') return records;
  if (table === 'stores') return records;

  if (table === 'daily_revenue' && user.role === 'STAFF') {
    const { dateKey } = businessDateTimeParts(context.now);
    return records.filter((record) => record.date === dateKey && recordInScope(user, record, table, context));
  }

  if (table === 'shifts' && user.role === 'STAFF') {
    return records
      .filter((record) => recordInScope(user, record, table, context))
      .map((record) => {
        const safe = { ...record };
        Object.keys(safe).forEach((key) => {
          if (key.startsWith('ocha_') || ['cup_vs_ocha_diff', 'sticker_vs_ocha_diff', 'sticker_vs_shop_diff'].includes(key)) delete safe[key];
        });
        return safe;
      });
  }

  if (table === 'notifications') {
    return records.filter((record) => String(record.user_id) === String(user.id));
  }
  if (table === 'push_tokens') return records.filter((record) => recordInScope(user, record, table, context));
  if (user.role === 'STAFF' && ['attendance_logs', 'payroll_adjustments', 'payroll_approvals', 'attendance_correction_requests'].includes(table)) {
    return records.filter((record) => String(record.user_id) === String(user.id));
  }
  return records.filter((record) => recordInScope(user, record, table, context));
};

const assertAllInScope = (user, records, table, context) => {
  if (!records.every((record) => recordInScope(user, record, table, context))) {
    throw new AuthorizationError('Dữ liệu nằm ngoài phạm vi chi nhánh được cấp.');
  }
};

const canOperateStore = (user, storeId, context) => {
  if (canAccessStore(user, storeId)) return true;
  if (!hasPermission(user, 'central_warehouse')) return false;
  const store = context.stores?.find((item) => String(item.id) === String(storeId));
  const name = String(store?.name || store?.store_name || '').toLowerCase();
  return store?.is_warehouse === true || store?.is_central_warehouse === true || name.includes('kho tổng') || name.includes('kho tong');
};

const valuesArray = (values) => Array.isArray(values) ? values : [values];

export const authorizeMutation = ({ user, table, action, values, targets, context }) => {
  const incoming = valuesArray(values || {}).filter(Boolean);
  const affected = action === 'insert'
    ? incoming
    : action === 'update'
      ? targets.map((target) => ({ ...target, ...(incoming[0] || {}) }))
      : action === 'upsert'
        ? [...targets, ...incoming]
        : targets;

  if (user.role === 'OWNER') {
    if (table === 'users' && action === 'delete' && targets.some((target) => String(target.id) === String(user.id))) {
      throw new AuthorizationError('Không thể xóa chính tài khoản Chủ quán đang đăng nhập.');
    }
    return;
  }

  if (table === 'users') {
    if (user.role !== 'MANAGER' || !hasPermission(user, 'manage_permissions')) throw new AuthorizationError();
    assertAllInScope(user, affected, table, context);
    if (affected.some((target) => target.role && target.role !== 'STAFF')) {
      throw new AuthorizationError('Chỉ Chủ quán được quản lý tài khoản Quản lý hoặc Chủ quán.');
    }
    const elevatedStaffKeys = ['can_schedule_shift', 'is_primary_manager', 'manage_permissions'];
    for (const value of incoming) {
      if (value.store_id != null && !canAccessStore(user, value.store_id)) {
        throw new AuthorizationError('Không thể chuyển nhân sự sang chi nhánh ngoài phạm vi của bạn.');
      }
      const permissions = value.permissions && typeof value.permissions === 'object' ? value.permissions : null;
      if (!permissions) continue;
      if (elevatedStaffKeys.some((key) => permissions[key] === true)) {
        throw new AuthorizationError('Chỉ Chủ quán được cấp quyền quản trị nâng cao.');
      }
      const grantableKeys = ['cashier', 'inventory', 'central_warehouse', 'finance', 'reports'];
      if (grantableKeys.some((key) => permissions[key] === true && !hasPermission(user, key === 'reports' ? 'finance' : key))) {
        throw new AuthorizationError('Không thể cấp quyền cao hơn quyền của chính bạn.');
      }
      const requestedStores = Array.isArray(permissions.viewable_stores) ? permissions.viewable_stores : [];
      if (requestedStores.some((storeId) => !canAccessStore(user, storeId))) {
        throw new AuthorizationError('Không thể cấp chi nhánh ngoài phạm vi của bạn.');
      }
    }
    return;
  }

  if (table === 'stores') {
    const onlyStaffingTargets = incoming.every((value) => Object.keys(value).every((key) => key === 'staffing_targets'));
    if (user.role !== 'MANAGER' || !hasPermission(user, 'can_schedule_shift') || !onlyStaffingTargets) throw new AuthorizationError();
    assertAllInScope(user, targets, table, context);
    return;
  }

  if (['notifications', 'push_tokens'].includes(table)) {
    if (table === 'push_tokens' || action !== 'insert') {
      const ownRecords = affected.every((record) => String(record.user_id) === String(user.id));
      if (!ownRecords) throw new AuthorizationError();
      return;
    }
    const targetsAreScoped = incoming.every((record) => {
      const target = userForId(context.users, record.user_id);
      return target && recordInScope(user, target, 'users', context);
    });
    if (!targetsAreScoped) throw new AuthorizationError('Không thể gửi thông báo ngoài phạm vi chi nhánh.');
    return;
  }

  if (table === 'attendance_logs') {
    if (user.role === 'STAFF') {
      const allowedCheckoutFields = new Set(['check_out', 'hours', 'check_out_location', 'check_out_at', 'check_out_lat', 'check_out_lng', 'check_out_photo_path']);
      const validInsert = action === 'insert' && incoming.every((record) => (
        String(record.user_id) === String(user.id)
        && canAccessStore(user, record.store_id)
        && Number(record.hours || 0) === 0
        && !record.check_out
      ));
      const validCheckout = action === 'update'
        && targets.length === 1
        && targets.every((record) => String(record.user_id) === String(user.id) && !record.check_out)
        && incoming.every((record) => Object.keys(record).every((key) => allowedCheckoutFields.has(key)));
      if (!validInsert && !validCheckout) throw new AuthorizationError();
      return;
    }
    if (!hasPermission(user, 'hr')) throw new AuthorizationError();
    assertAllInScope(user, affected, table, context);
    return;
  }

  if (table === 'attendance_correction_requests') {
    if (user.role === 'STAFF') {
      const valid = action === 'insert' && incoming.every((record) => String(record.user_id) === String(user.id) && record.status === 'PENDING');
      if (!valid) throw new AuthorizationError();
      return;
    }
    if (!hasPermission(user, 'hr')) throw new AuthorizationError();
    assertAllInScope(user, affected, table, context);
    return;
  }

  if (['inventory_items', 'inventory_logs', 'inventory_tickets'].includes(table)) {
    const operationalAccess = hasPermission(user, 'inventory') || hasPermission(user, 'central_warehouse') || (table === 'inventory_logs' && hasPermission(user, 'cashier'));
    if (!operationalAccess) throw new AuthorizationError();
    if (user.role === 'STAFF') {
      if (!hasPermission(user, 'central_warehouse')) {
        const validTicket = table === 'inventory_tickets' && action === 'insert'
          && incoming.every((record) => String(record.requested_by) === String(user.id));
        const validCashierLog = table === 'inventory_logs' && hasPermission(user, 'cashier') && (
          (action === 'insert' && incoming.every((record) => String(record.id || '').startsWith('log_shift_') && ['ADJUST_UP', 'ADJUST_DOWN'].includes(record.type)))
          || (action === 'delete' && targets.every((record) => String(record.id || '').startsWith('log_shift_') && String(record.created_by) === String(user.id)))
        );
        if (!validTicket && !validCashierLog) throw new AuthorizationError();
      }
    }
    if (table === 'inventory_tickets' && action === 'update') {
      const validReviewScope = targets.every((ticket) => {
        const requiredStoreId = ticket.status === 'PENDING_SOURCE'
          ? ticket.source_store_id
          : ticket.status === 'PENDING_DEST'
            ? ticket.destination_store_id
            : null;
        return requiredStoreId != null && canOperateStore(user, requiredStoreId, context);
      });
      if (!validReviewScope) throw new AuthorizationError('Bạn không thể duyệt phiếu thay cho chi nhánh khác.');
    }
    assertAllInScope(user, affected, table, context);
    return;
  }

  if (table === 'shifts') {
    if (!hasPermission(user, 'cashier')) throw new AuthorizationError();
    assertAllInScope(user, affected, table, context);
    const isApproval = incoming.some((value) => value.status === 'CLOSED' || value.approved_at || value.approved_by_name);
    const isUndoApproval = targets.some((target) => target.status === 'CLOSED') && incoming.some((value) => value.status === 'OPEN');
    if ((isApproval || isUndoApproval) && !hasPermission(user, 'is_primary_manager')) throw new AuthorizationError('Bạn chưa có quyền duyệt báo cáo chốt ca.');
    if (user.role === 'STAFF' && incoming.some((value) => !['OPEN', 'PENDING_APPROVAL', undefined].includes(value.status))) throw new AuthorizationError();
    return;
  }

  if (table === 'shift_registrations') {
    if (user.role === 'STAFF') {
      const validInsert = action === 'insert' && incoming.every((record) => String(record.user_id) === String(user.id) && record.status === 'PENDING' && canAccessStore(user, record.store_id));
      const validOwnChange = ['update', 'delete'].includes(action) && targets.every((record) => String(record.user_id) === String(user.id) && record.status === 'PENDING');
      if (!validInsert && !validOwnChange) throw new AuthorizationError();
      return;
    }
    if (!hasPermission(user, 'can_schedule_shift')) throw new AuthorizationError();
    assertAllInScope(user, affected, table, context);
    return;
  }

  if (table === 'shift_swaps') {
    if (user.role === 'STAFF') {
      const valid = action === 'insert' && incoming.every((record) => String(record.requester_id) === String(user.id) && record.status === 'PENDING');
      if (!valid) throw new AuthorizationError();
      return;
    }
    if (!hasPermission(user, 'can_schedule_shift')) throw new AuthorizationError();
    assertAllInScope(user, affected, table, context);
    return;
  }

  if (['payroll_adjustments', 'payroll_approvals'].includes(table)) {
    if (!hasPermission(user, 'payroll') && !(table === 'payroll_adjustments' && hasPermission(user, 'is_primary_manager'))) throw new AuthorizationError();
    if (user.role === 'STAFF') {
      const valid = table === 'payroll_approvals' && action === 'upsert'
        && incoming.every((record) => String(record.user_id) === String(user.id));
      if (!valid) throw new AuthorizationError();
      return;
    }
    assertAllInScope(user, affected, table, context);
    return;
  }

  if (table === 'daily_revenue') throw new AuthorizationError('Doanh thu chỉ được đồng bộ bởi hệ thống hoặc Chủ quán.');
  throw new AuthorizationError();
};

export const sanitizeManagerUserValues = (input = {}) => {
  const safe = { ...input };
  delete safe.wage;
  delete safe.password;
  delete safe.password_hash;
  delete safe.role;
  return safe;
};
