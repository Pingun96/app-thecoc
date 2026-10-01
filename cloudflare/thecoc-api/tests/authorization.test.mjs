import assert from 'node:assert/strict';
import {
  AuthorizationError,
  authorizeMutation,
  filterReadableRecords,
  getStaffRevenueWindow,
  hasPermission,
} from '../src/authorization.mjs';

const owner = { id: 'owner', role: 'OWNER' };
const manager = { id: 'manager', role: 'MANAGER', store_id: 1, permissions: { viewable_stores: [1] } };
const permissionManager = {
  ...manager,
  permissions: { ...manager.permissions, manage_permissions: true, hr: true },
};
const staff = { id: 'staff-1', role: 'STAFF', store_id: 1, permissions: { payroll: true, viewable_stores: [1] } };
const cashier = { ...staff, permissions: { ...staff.permissions, cashier: true } };
const primaryManager = { ...manager, permissions: { ...manager.permissions, cashier: true, is_primary_manager: true } };
const otherStaff = { id: 'staff-2', role: 'STAFF', store_id: 2, permissions: { viewable_stores: [2] } };
const context = {
  users: [owner, manager, staff, otherStaff],
  stores: [{ id: 1, name: 'Chi nhánh 1' }, { id: 2, name: 'Chi nhánh 2' }, { id: 99, name: 'Kho tổng', is_warehouse: true }],
  shiftRegistrations: [],
};

const expectDenied = (fn) => assert.throws(fn, (error) => error instanceof AuthorizationError && error.status === 403);
const mutate = (user, table, action, values, targets = []) => authorizeMutation({ user, table, action, values, targets, context });

assert.equal(hasPermission(manager, 'cashier'), true, 'legacy manager keeps cashier default');
assert.equal(hasPermission(manager, 'can_schedule_shift'), true, 'legacy manager keeps scheduling default');
assert.equal(hasPermission(manager, 'payroll'), false, 'legacy manager does not gain payroll');
assert.equal(hasPermission({ ...manager, permissions: { cashier: false } }, 'cashier'), false, 'explicit deny wins');

const scopedUsers = filterReadableRecords(manager, 'users', [staff, otherStaff], context);
assert.deepEqual(scopedUsers.map((user) => user.id), ['staff-1'], 'manager only reads assigned stores');
assert.deepEqual(filterReadableRecords(staff, 'notifications', [
  { id: 1, user_id: staff.id },
  { id: 2, user_id: otherStaff.id },
], context).map((item) => item.id), [1], 'staff only reads own notifications');

const revenueRows = [
  { id: 'today-store-1', store_id: 1, date: '2026-07-14', total_amount: 100 },
  { id: 'old-store-1', store_id: 1, date: '2026-07-13', total_amount: 200 },
  { id: 'today-store-2', store_id: 2, date: '2026-07-14', total_amount: 300 },
];
const morningWindow = new Date('2026-07-14T06:45:00.000Z');
const afternoonWindow = new Date('2026-07-14T14:30:00.000Z');
const outsideWindow = new Date('2026-07-14T07:01:00.000Z');
assert.equal(getStaffRevenueWindow(new Date('2026-07-14T06:29:00.000Z')), null, '13:29 is locked');
assert.equal(getStaffRevenueWindow(new Date('2026-07-14T06:30:00.000Z')), 'MORNING', '13:30 opens morning reconciliation');
assert.equal(getStaffRevenueWindow(new Date('2026-07-14T07:00:00.000Z')), null, '14:00 closes morning reconciliation');
assert.equal(getStaffRevenueWindow(new Date('2026-07-14T14:00:00.000Z')), 'AFTERNOON', '21:00 opens afternoon reconciliation');
assert.equal(getStaffRevenueWindow(new Date('2026-07-14T15:00:00.000Z')), null, '22:00 closes afternoon reconciliation');
assert.equal(getStaffRevenueWindow(morningWindow), 'MORNING');
assert.equal(getStaffRevenueWindow(afternoonWindow), 'AFTERNOON');
assert.equal(getStaffRevenueWindow(outsideWindow), null);
assert.deepEqual(
  filterReadableRecords(cashier, 'daily_revenue', revenueRows, { ...context, now: morningWindow }).map((item) => item.id),
  ['today-store-1'],
  'staff cashier only reads current-day revenue in their store during an allowed window',
);
assert.deepEqual(
  filterReadableRecords(cashier, 'daily_revenue', revenueRows, { ...context, now: outsideWindow }),
  [],
  'staff cashier cannot read revenue outside reconciliation windows',
);
assert.deepEqual(
  filterReadableRecords(manager, 'daily_revenue', revenueRows, { ...context, now: outsideWindow }).map((item) => item.id),
  ['today-store-1', 'old-store-1'],
  'manager cashier access is not time-limited but remains store-scoped',
);
const shiftWithOchaAudit = {
  id: 'shift-audit', store_id: 1, status: 'PENDING_APPROVAL',
  shop_cup_count: 105, sticker_count: 106,
  ocha_cup_count: 100, ocha_cancelled_order_count: 2, ocha_cancelled_cup_count: 3,
  cup_vs_ocha_diff: 2, sticker_vs_ocha_diff: 3,
};
const staffShiftView = filterReadableRecords(cashier, 'shifts', [shiftWithOchaAudit], { ...context, now: morningWindow })[0];
assert.equal(staffShiftView.shop_cup_count, 105, 'staff keeps their own shop cup input');
assert.equal(staffShiftView.ocha_cup_count, undefined, 'staff cannot read stored Ocha audit metrics from shift records');
assert.equal(staffShiftView.ocha_cancelled_order_count, undefined, 'staff cannot read stored cancelled-order audit metrics');
const managerShiftView = filterReadableRecords(manager, 'shifts', [shiftWithOchaAudit], { ...context, now: outsideWindow })[0];
assert.equal(managerShiftView.ocha_cancelled_order_count, 2, 'manager can review cancelled Ocha orders');

expectDenied(() => mutate(manager, 'users', 'update', { name: 'Changed' }, [staff]));
assert.doesNotThrow(() => mutate(permissionManager, 'users', 'update', { name: 'Changed' }, [staff]));
expectDenied(() => mutate(permissionManager, 'users', 'update', { store_id: 2 }, [staff]));
expectDenied(() => mutate(permissionManager, 'users', 'update', { permissions: { finance: true, viewable_stores: [1] } }, [staff]));
expectDenied(() => mutate(permissionManager, 'users', 'delete', null, [owner]));

assert.doesNotThrow(() => mutate(staff, 'attendance_correction_requests', 'insert', {
  id: 'request-1', user_id: staff.id, store_id: 1, status: 'PENDING',
}));
expectDenied(() => mutate(staff, 'attendance_correction_requests', 'update', { status: 'APPROVED' }, [
  { id: 'request-1', user_id: staff.id, store_id: 1, status: 'PENDING' },
]));

assert.doesNotThrow(() => mutate(staff, 'shift_registrations', 'insert', {
  id: 'shift-reg-1', user_id: staff.id, store_id: 1, status: 'PENDING',
}));
expectDenied(() => mutate(staff, 'shift_registrations', 'insert', {
  id: 'shift-reg-2', user_id: otherStaff.id, store_id: 2, status: 'APPROVED',
}));

const openAttendance = { id: 'attendance-1', user_id: staff.id, store_id: 1, check_out: null };
assert.doesNotThrow(() => mutate(staff, 'attendance_logs', 'update', { check_out: '17:00', hours: 8 }, [openAttendance]));
expectDenied(() => mutate(staff, 'attendance_logs', 'update', { check_in: '01:00', hours: 16 }, [openAttendance]));

const pendingShift = { id: 'shift-1', store_id: 1, status: 'PENDING_APPROVAL' };
expectDenied(() => mutate(cashier, 'shifts', 'update', { status: 'CLOSED', approved_at: 'now' }, [pendingShift]));
assert.doesNotThrow(() => mutate(primaryManager, 'shifts', 'update', { status: 'CLOSED', approved_at: 'now' }, [pendingShift]));

assert.doesNotThrow(() => mutate(owner, 'daily_revenue', 'upsert', { id: '1_2026-07-14', store_id: 1 }));
expectDenied(() => mutate(manager, 'daily_revenue', 'upsert', { id: '1_2026-07-14', store_id: 1 }));

console.log('Permission matrix: all checks passed.');
