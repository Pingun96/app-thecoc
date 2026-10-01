const STAFF_DEFAULTS = {
  cashier: false,
  inventory: false,
  central_warehouse: false,
  hr: true,
  payroll: true,
  finance: false,
  reports: false,
  can_schedule_shift: false,
  is_primary_manager: false,
  manage_permissions: false,
};

const MANAGER_DEFAULTS = {
  cashier: true,
  inventory: true,
  central_warehouse: false,
  hr: true,
  payroll: false,
  finance: false,
  reports: false,
  can_schedule_shift: true,
  is_primary_manager: false,
  manage_permissions: false,
};

export const getEffectivePermissions = (user) => {
  if (!user) return {};
  if (user.role === 'OWNER') return new Proxy({}, { get: () => true });

  const defaults = user.role === 'MANAGER' ? MANAGER_DEFAULTS : STAFF_DEFAULTS;
  const explicit = user.permissions && typeof user.permissions === 'object'
    ? user.permissions
    : {};
  const merged = { ...defaults, ...explicit };

  // Keep old records compatible while all users are moved to the permissions object.
  if (user.is_primary_manager === true && explicit.is_primary_manager == null) {
    merged.is_primary_manager = true;
  }
  if (merged.finance === true || merged.reports === true) {
    merged.finance = true;
    merged.reports = true;
  }
  if (merged.is_primary_manager === true) merged.cashier = true;

  return merged;
};

export const hasPermission = (user, permission) => {
  if (!user) return false;
  if (user.role === 'OWNER') return true;
  return getEffectivePermissions(user)[permission] === true;
};

export const getAllowedStoreIds = (user) => {
  if (!user) return [];
  const viewable = Array.isArray(user.permissions?.viewable_stores)
    ? user.permissions.viewable_stores
    : [];
  return [...new Set([user.store_id, ...viewable]
    .filter((value) => value !== null && value !== undefined && value !== '')
    .map(String))];
};

export const canAccessStore = (user, storeId) => (
  user?.role === 'OWNER'
  || getAllowedStoreIds(user).includes(String(storeId))
);

const ROUTE_PERMISSIONS = {
  Finance: 'finance',
  Inventory: 'inventory',
  CentralWarehouse: 'central_warehouse',
  Payroll: 'payroll',
  Shifts: 'cashier',
};

export const canAccessRoute = (user, routeName) => {
  if (routeName === 'Login') return true;
  if (!user) return false;
  const requiredPermission = ROUTE_PERMISSIONS[routeName];
  if (requiredPermission && !hasPermission(user, requiredPermission)) return false;
  if (routeName === 'StaffManagement') {
    return user.role !== 'STAFF' && (hasPermission(user, 'hr') || hasPermission(user, 'manage_permissions'));
  }
  if (routeName === 'AttendanceReview' || routeName === 'StaffHistory') {
    return user.role !== 'STAFF' && hasPermission(user, 'hr');
  }
  if (routeName === 'AttendanceCorrection' && user.role !== 'STAFF') {
    return hasPermission(user, 'hr');
  }
  return true;
};

export const permissionDefaults = {
  STAFF: STAFF_DEFAULTS,
  MANAGER: MANAGER_DEFAULTS,
};
