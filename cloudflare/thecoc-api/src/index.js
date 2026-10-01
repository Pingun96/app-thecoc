import {
  AuthorizationError,
  authorizeMutation,
  filterReadableRecords,
  hasPermission,
  recordInScope,
  sanitizeManagerUserValues,
} from './authorization.mjs';

const ALLOWED_TABLES = new Set([
  'stores', 'users', 'inventory_items', 'inventory_logs', 'inventory_tickets',
  'shifts', 'attendance_logs', 'shift_registrations', 'payroll_adjustments',
  'payroll_approvals', 'shift_swaps', 'daily_revenue', 'notifications', 'push_tokens', 'attendance_correction_requests'
]);

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

const reply = (body, status = 200, headers = {}) => new Response(JSON.stringify(body), {
  status,
  headers: { ...cors, 'content-type': 'application/json; charset=utf-8', ...headers },
});

const now = () => new Date().toISOString();
const textEncoder = new TextEncoder();
const base64Url = (bytes) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
const base64UrlBytes = (value) => {
  const padded = String(value).replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((String(value).length + 3) % 4);
  return Uint8Array.from(atob(padded), (char) => char.charCodeAt(0));
};
const jsonBase64Url = (value) => base64Url(textEncoder.encode(JSON.stringify(value)));
const decodeJsonBase64Url = (value) => JSON.parse(new TextDecoder().decode(base64UrlBytes(value)));
const importHmacKey = (secret) => crypto.subtle.importKey('raw', textEncoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
const signSession = async (claims, secret) => {
  const header = jsonBase64Url({ alg: 'HS256', typ: 'JWT' });
  const payload = jsonBase64Url(claims);
  const key = await importHmacKey(secret);
  const signature = base64Url(new Uint8Array(await crypto.subtle.sign('HMAC', key, textEncoder.encode(`${header}.${payload}`))));
  return `${header}.${payload}.${signature}`;
};
const verifySession = async (token, secret) => {
  const [header, payload, signature] = String(token || '').split('.');
  if (!header || !payload || !signature) return null;
  const key = await importHmacKey(secret);
  const valid = await crypto.subtle.verify('HMAC', key, base64UrlBytes(signature), textEncoder.encode(`${header}.${payload}`));
  if (!valid) return null;
  const claims = decodeJsonBase64Url(payload);
  return Number(claims.exp || 0) > Math.floor(Date.now() / 1000) ? claims : null;
};
const hashPassword = async (password, secret, salt = crypto.getRandomValues(new Uint8Array(16))) => {
  const saltValue = base64Url(salt);
  const key = await importHmacKey(secret);
  const signature = new Uint8Array(await crypto.subtle.sign('HMAC', key, textEncoder.encode(`${saltValue}:${String(password)}`)));
  return `hmac$${saltValue}$${base64Url(signature)}`;
};
const verifyPassword = async (password, storedHash, secret) => {
  const [type, saltValue, hashValue] = String(storedHash || '').split('$');
  if (type !== 'hmac' || !saltValue || !hashValue) return false;
  return (await hashPassword(password, secret, base64UrlBytes(saltValue))) === storedHash;
};const writeRecord = async (db, table, record) => {
  const originalId = record.id ?? crypto.randomUUID();
  const payload = { ...record, id: originalId };
  await db.prepare('INSERT INTO app_records (table_name, record_id, payload, created_at, updated_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(table_name, record_id) DO UPDATE SET payload = excluded.payload, updated_at = excluded.updated_at')
    .bind(table, String(originalId), JSON.stringify(payload), now(), now()).run();
  return payload;
};
const publicUser = (user) => {
  const safeUser = { ...user };
  delete safeUser.password;
  delete safeUser.password_hash;
  delete safeUser.push_token;
  return safeUser;
};
const publicUserForViewer = (user, viewer) => {
  const safeUser = publicUser(user);
  if (String(user.id) === String(viewer.id) || viewer.role === 'OWNER') return safeUser;
  if (viewer.role === 'STAFF') {
    delete safeUser.wage;
    delete safeUser.phone;
    delete safeUser.permissions;
    return safeUser;
  }
  if (!hasPermission(viewer, 'payroll')) delete safeUser.wage;
  if (!hasPermission(viewer, 'hr') && !hasPermission(viewer, 'manage_permissions') && !hasPermission(viewer, 'can_schedule_shift')) {
    delete safeUser.phone;
    delete safeUser.permissions;
  }
  return safeUser;
};

async function authenticate(request, env) {
  const secret = env.AUTH_SESSION_SECRET;
  const authorization = request.headers.get('authorization') || '';
  const token = authorization.startsWith('Bearer ') ? authorization.slice(7) : '';
  if (!secret || !token) return null;
  const claims = await verifySession(token, secret);
  if (!claims?.sub) return null;
  const users = await readTable(env.DB, 'users');
  const user = users.find((item) => String(item.id) === String(claims.sub));
  if (!user || user.hasappaccess === false || user.hasAppAccess === false) return null;
  return { claims, user: publicUser(user) };
}
async function handleLogin(request, env) {
  const { phone, password } = await request.json();
  const normalizedPhone = String(phone || '').replace(/\s/g, '');
  if (!normalizedPhone || !password) return reply({ error: { message: 'Vui lòng nhập số điện thoại và mật khẩu.' } }, 400);
  const users = await readTable(env.DB, 'users');
  const user = users.find((item) => String(item.phone || '').replace(/\s/g, '') === normalizedPhone);
  if (!user || user.hasappaccess === false || user.hasAppAccess === false) return reply({ error: { message: 'Tài khoản không hợp lệ hoặc đã bị khóa.' } }, 401);
  const valid = user.password_hash ? await verifyPassword(password, user.password_hash, env.AUTH_SESSION_SECRET) : String(password) === String(user.password || '123');
  if (!valid) return reply({ error: { message: 'Số điện thoại hoặc mật khẩu không đúng.' } }, 401);
  if (!user.password_hash) {
    user.password_hash = await hashPassword(password, env.AUTH_SESSION_SECRET);
    delete user.password;
    await writeRecord(env.DB, 'users', user);
  }
  if (!env.AUTH_SESSION_SECRET) return reply({ error: { message: 'Máy chủ chưa cấu hình phiên đăng nhập.' } }, 503);
  const sessionUser = publicUser(user);
  const token = await signSession({ sub: sessionUser.id, role: sessionUser.role || 'STAFF', exp: Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 7 }, env.AUTH_SESSION_SECRET);
  return reply({ data: { token, user: sessionUser }, error: null });
}
async function handleProfileUpdate(request, env, auth) {
  const body = await request.json();
  const users = await readTable(env.DB, 'users');
  const user = users.find((item) => String(item.id) === String(auth.user.id));
  if (!user) return reply({ error: { message: 'Không tìm thấy tài khoản.' } }, 404);
  if (body.avatar_url != null) user.avatar_url = String(body.avatar_url).trim();
  if (body.password) {
    if (String(body.password).length < 6) return reply({ error: { message: 'Mật khẩu mới cần ít nhất 6 ký tự.' } }, 400);
    user.password_hash = await hashPassword(body.password, env.AUTH_SESSION_SECRET);
    delete user.password;
  }
  await writeRecord(env.DB, 'users', user);
  return reply({ data: publicUser(user), error: null });
}const normalize = (row, table) => {
  const payload = JSON.parse(row.payload);
  if (table === 'stores' && /^\d+$/.test(String(payload.id ?? ''))) payload.id = Number(payload.id);
  return { ...payload, id: payload.id ?? row.record_id };
};
const valueOf = (record, key) => record?.[key] == null ? null : String(record[key]);
const matches = (record, filters = []) => filters.every((filter) => {
  const value = valueOf(record, filter.key);
  if (filter.op === 'eq') return value === String(filter.value);
  if (filter.op === 'in') return (filter.value || []).map(String).includes(value);
  if (filter.op === 'like') return new RegExp(`^${String(filter.value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/%/g, '.*')}$`).test(value || '');
  if (filter.op === 'gte') return (value || '') >= String(filter.value);
  if (filter.op === 'lte') return (value || '') <= String(filter.value);
  return false;
});
async function readTable(db, table) {
  const { results = [] } = await db.prepare('SELECT record_id, payload FROM app_records WHERE table_name = ?').bind(table).all();
  return results.map((row) => normalize(row, table));
}

async function handleMigratePasswords(env, auth) {
  if (auth.user.role !== 'OWNER') return reply({ error: { message: 'Chỉ chủ cửa hàng được thực hiện thao tác này.' } }, 403);
  const users = await readTable(env.DB, 'users');
  let migrated = 0;
  for (const user of users) {
    if (user.password_hash) continue;
    user.password_hash = await hashPassword(String(user.password || '123'), env.AUTH_SESSION_SECRET);
    delete user.password;
    await writeRecord(env.DB, 'users', user);
    migrated += 1;
  }
  return reply({ data: { migrated }, error: null });
}
async function queryRecords(env, request, auth) {
  let { table, action = 'select', values, filters = [], order, onConflict, count, head, single, maybeSingle } = request;
  if (!ALLOWED_TABLES.has(table)) throw new Error('Bảng không hợp lệ.');
  if (auth?.user?.role === 'STAFF' && ['users', 'stores', 'payroll_adjustments', 'payroll_approvals', 'daily_revenue'].includes(table) && action !== 'select') {
    throw new Error('Bạn không có quyền thay đổi dữ liệu này.');
  }
  if (auth?.user?.role === 'MANAGER' && table === 'users' && action !== 'select' && values) {
    const sanitizeManagerUserValues = (input) => {
      const safeValues = { ...input };
      delete safeValues.wage;
      delete safeValues.password;
      delete safeValues.password_hash;
      if (safeValues.role === 'OWNER') delete safeValues.role;
      return safeValues;
    };
    values = Array.isArray(values) ? values.map(sanitizeManagerUserValues) : sanitizeManagerUserValues(values);
  }
  let records = await readTable(env.DB, table);
  if (auth?.user?.role === 'STAFF') {
    const currentUserId = String(auth.user.id);
    if (['attendance_logs', 'payroll_adjustments', 'payroll_approvals', 'push_tokens', 'attendance_correction_requests'].includes(table)) {
      records = records.filter((record) => String(record.user_id || '') === currentUserId);
    }
    if (table === 'users') {
      records = records.map((record) => {
        const safe = publicUser(record);
        if (String(safe.id) !== currentUserId) { delete safe.wage; delete safe.phone; delete safe.permissions; }
        return safe;
      });
    }
  } else if (table === 'users') {
    records = records.map(publicUser);
  }
  const filtered = records.filter((record) => matches(record, filters));
  const save = async (record) => {
    const originalId = record.id ?? crypto.randomUUID();
    const id = String(originalId);
    const payload = { ...record, id: originalId };
    await env.DB.prepare(
      'INSERT INTO app_records (table_name, record_id, payload, created_at, updated_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(table_name, record_id) DO UPDATE SET payload = excluded.payload, updated_at = excluded.updated_at'
    ).bind(table, id, JSON.stringify(payload), now(), now()).run();
    return payload;
  };

  if (action === 'select') {
    let data = filtered;
    if (order?.column) {
      data = [...data].sort((a, b) => String(a[order.column] ?? '').localeCompare(String(b[order.column] ?? '')) * (order.ascending === false ? -1 : 1));
    }
    if (head) return { data: null, count: count === 'exact' ? data.length : null, error: null };
    if (single || maybeSingle) return { data: data[0] || null, count: count === 'exact' ? data.length : null, error: single && !data[0] ? { message: 'Không tìm thấy bản ghi.' } : null };
    return { data, count: count === 'exact' ? data.length : null, error: null };
  }

  if (action === 'insert') {
    const data = [];
    for (const value of Array.isArray(values) ? values : [values]) data.push(await save(value));
    return { data: single || maybeSingle ? data[0] || null : data, error: null };
  }

  if (action === 'update') {
    const data = [];
    for (const record of filtered) data.push(await save({ ...record, ...values }));
    return { data: single || maybeSingle ? data[0] || null : data, error: null };
  }

  if (action === 'delete') {
    for (const record of filtered) await env.DB.prepare('DELETE FROM app_records WHERE table_name = ? AND record_id = ?').bind(table, String(record.id)).run();
    return { data: filtered, error: null };
  }

  if (action === 'upsert') {
    const keys = String(onConflict || 'id').split(',').map((key) => key.trim()).filter(Boolean);
    const data = [];
    for (const value of Array.isArray(values) ? values : [values]) {
      const existing = records.find((record) => keys.every((key) => String(record[key] ?? '') === String(value[key] ?? '')));
      data.push(await save(existing ? { ...existing, ...value, id: existing.id } : value));
    }
    return { data: single || maybeSingle ? data[0] || null : data, error: null };
  }

  throw new Error('Thao tác không hợp lệ.');
}

const calculateAttendanceHours = (date, checkIn, checkOut) => {
  if (!date || !checkIn || !checkOut) return 0;
  const start = new Date(`${date}T${String(checkIn).slice(0, 5)}:00`).getTime();
  let end = new Date(`${date}T${String(checkOut).slice(0, 5)}:00`).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end)) return 0;
  if (end < start) end += 24 * 60 * 60 * 1000;
  return Math.round(((end - start) / 3600000) * 100) / 100;
};

const optionalNonNegativeInteger = (value, fieldName) => {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) throw new AuthorizationError(`${fieldName} phải là số nguyên không âm.`, 400);
  return parsed;
};

const shiftPeriodOf = (shift = {}) => {
  const label = String(shift.period_name || shift.shift_name || shift.opened_at || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  if (label.includes('ca sang') || label.includes('morning')) return 'MORNING';
  if (label.includes('ca chieu') || label.includes('afternoon') || label.includes('evening')) return 'AFTERNOON';
  return null;
};

const shiftDateOf = (shift = {}) => {
  const text = String(shift.opened_at || shift.date || '');
  const iso = text.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const vi = text.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  return vi ? `${vi[3]}-${String(vi[2]).padStart(2, '0')}-${String(vi[1]).padStart(2, '0')}` : null;
};

const attachServerOchaCupMetrics = (input, target, context) => {
  const safe = { ...input };
  Object.keys(safe).forEach((key) => {
    if (key.startsWith('ocha_') || ['cup_vs_ocha_diff', 'sticker_vs_ocha_diff', 'sticker_vs_shop_diff'].includes(key)) delete safe[key];
  });

  const shopCups = optionalNonNegativeInteger(safe.shop_cup_count, 'Số ly tại quán');
  const stickers = optionalNonNegativeInteger(safe.sticker_count, 'Số tem');
  if (safe.shop_cup_count !== undefined) safe.shop_cup_count = shopCups;
  if (safe.sticker_count !== undefined) safe.sticker_count = stickers;

  const shift = { ...target, ...safe };
  if (shift.status !== 'PENDING_APPROVAL') return safe;
  const date = shiftDateOf(shift);
  const daily = (context.dailyRevenue || []).find((row) => (
    String(row.store_id) === String(shift.store_id) && row.date === date
  ));
  const cumulativeSold = optionalNonNegativeInteger(daily?.cup_count, 'Số ly Ocha');
  const cumulativeCancelledOrders = optionalNonNegativeInteger(daily?.cancelled_order_count, 'Số đơn hủy Ocha');
  const cumulativeCancelledCups = optionalNonNegativeInteger(daily?.cancelled_cup_count, 'Số ly trong đơn hủy Ocha');

  let sold = cumulativeSold;
  let cancelledOrders = cumulativeCancelledOrders;
  let cancelledCups = cumulativeCancelledCups;
  let basis = daily ? 'DAILY_CUMULATIVE' : 'MISSING';

  if (daily && shiftPeriodOf(shift) === 'MORNING') basis = 'MORNING_SNAPSHOT';
  if (daily && shiftPeriodOf(shift) === 'AFTERNOON') {
    const morning = (context.shifts || []).find((row) => (
      String(row.id) !== String(shift.id)
      && String(row.store_id) === String(shift.store_id)
      && shiftDateOf(row) === date
      && shiftPeriodOf(row) === 'MORNING'
      && row.ocha_cup_count_cumulative !== null
      && row.ocha_cup_count_cumulative !== undefined
    ));
    if (morning) {
      if (sold !== null) sold = Math.max(0, sold - Number(morning.ocha_cup_count_cumulative || 0));
      if (cancelledOrders !== null) cancelledOrders = Math.max(0, cancelledOrders - Number(morning.ocha_cancelled_order_count_cumulative || 0));
      if (cancelledCups !== null) cancelledCups = Math.max(0, cancelledCups - Number(morning.ocha_cancelled_cup_count_cumulative || 0));
      basis = 'AFTERNOON_DELTA';
    }
  }

  const accounted = sold === null ? null : sold + Number(cancelledCups || 0);
  return {
    ...safe,
    ocha_cup_count: sold,
    ocha_cancelled_order_count: cancelledOrders,
    ocha_cancelled_cup_count: cancelledCups,
    ocha_accounted_cup_count: accounted,
    ocha_cup_count_cumulative: cumulativeSold,
    ocha_cancelled_order_count_cumulative: cumulativeCancelledOrders,
    ocha_cancelled_cup_count_cumulative: cumulativeCancelledCups,
    ocha_metrics_basis: basis,
    cup_vs_ocha_diff: shopCups !== null && accounted !== null ? shopCups - accounted : null,
    sticker_vs_ocha_diff: stickers !== null && accounted !== null ? stickers - accounted : null,
    sticker_vs_shop_diff: stickers !== null && shopCups !== null ? stickers - shopCups : null,
  };
};

const sanitizeValuesForActor = (actor, table, action, values, targets = [], context = {}) => {
  const mapValues = (mapper) => Array.isArray(values) ? values.map(mapper) : mapper(values || {});
  if (table === 'shifts' && action === 'update') {
    const target = targets[0] || {};
    return mapValues((input) => attachServerOchaCupMetrics(input, target, context));
  }
  if (actor.role === 'MANAGER' && table === 'users') return mapValues(sanitizeManagerUserValues);

  if (actor.role === 'STAFF') {
    if (table === 'attendance_correction_requests') {
      return mapValues((input) => ({ ...input, user_id: actor.id, user_name: actor.name, store_id: actor.store_id, status: 'PENDING' }));
    }
    if (table === 'attendance_logs' && action === 'update') {
      const target = targets[0] || {};
      return {
        ...values,
        hours: calculateAttendanceHours(target.date, target.check_in || target.checkIn, values.check_out),
      };
    }
    if (table === 'shift_registrations') {
      return mapValues((input) => ({ ...input, user_id: actor.id, status: action === 'insert' ? 'PENDING' : input.status }));
    }
    if (table === 'shift_swaps') return mapValues((input) => ({ ...input, requester_id: actor.id, status: 'PENDING' }));
    if (table === 'inventory_tickets') return mapValues((input) => ({ ...input, requested_by: actor.id }));
    if (table === 'inventory_logs') return mapValues((input) => ({ ...input, created_by: actor.id }));
    if (table === 'push_tokens') return mapValues((input) => ({ ...input, user_id: actor.id }));
    if (table === 'payroll_approvals') {
      return mapValues((input) => ({
        id: input.id,
        user_id: actor.id,
        month: input.month,
        staff_confirmed: input.staff_confirmed === true,
        staff_confirmed_at: input.staff_confirmed_at || null,
        status: input.staff_confirmed === true ? 'STAFF_APPROVED' : 'DRAFT',
      }));
    }
  }

  if (actor.role === 'MANAGER' && table === 'payroll_approvals') {
    return mapValues((input) => ({
      id: input.id,
      user_id: input.user_id,
      month: input.month,
      manager_confirmed: input.manager_confirmed === true,
      manager_confirmed_by: actor.name,
      manager_confirmed_at: input.manager_confirmed_at || now(),
      status: input.manager_confirmed === true ? 'MANAGER_APPROVED' : 'DRAFT',
    }));
  }
  return values;
};

async function queryRecordsAuthorized(env, request, auth) {
  let { table, action = 'select', values, filters = [], order, onConflict, count, head, single, maybeSingle } = request;
  if (!ALLOWED_TABLES.has(table)) throw new Error('Bang du lieu khong hop le.');

  const actor = auth.user;
  const records = await readTable(env.DB, table);
  const context = {
    users: table === 'users' ? records : await readTable(env.DB, 'users'),
    stores: table === 'stores' ? records : await readTable(env.DB, 'stores'),
    shiftRegistrations: table === 'shift_swaps' ? await readTable(env.DB, 'shift_registrations') : [],
    shifts: table === 'shifts' ? records : [],
    dailyRevenue: table === 'shifts' ? await readTable(env.DB, 'daily_revenue') : [],
    now: new Date(),
  };

  if (action === 'select') {
    let data = filterReadableRecords(actor, table, records, context);
    if (table === 'users') data = data.map((record) => publicUserForViewer(record, actor));
    data = data.filter((record) => matches(record, filters));
    if (order?.column) {
      data = [...data].sort((a, b) => String(a[order.column] ?? '').localeCompare(String(b[order.column] ?? '')) * (order.ascending === false ? -1 : 1));
    }
    if (head) return { data: null, count: count === 'exact' ? data.length : null, error: null };
    if (single || maybeSingle) return { data: data[0] || null, count: count === 'exact' ? data.length : null, error: single && !data[0] ? { message: 'Khong tim thay ban ghi.' } : null };
    return { data, count: count === 'exact' ? data.length : null, error: null };
  }

  let targets = records.filter((record) => matches(record, filters));
  if (action === 'upsert') {
    const keys = String(onConflict || 'id').split(',').map((key) => key.trim()).filter(Boolean);
    targets = (Array.isArray(values) ? values : [values]).flatMap((value) => {
      const existing = records.find((record) => keys.every((key) => String(record[key] ?? '') === String(value?.[key] ?? '')));
      return existing ? [existing] : [];
    });
  }

  authorizeMutation({ user: actor, table, action, values, targets, context });
  values = sanitizeValuesForActor(actor, table, action, values, targets, context);

  const save = async (record) => writeRecord(env.DB, table, record);
  if (action === 'insert') {
    const data = [];
    for (const value of Array.isArray(values) ? values : [values]) data.push(await save(value));
    return { data: single || maybeSingle ? data[0] || null : data, error: null };
  }
  if (action === 'update') {
    const data = [];
    for (const record of targets) data.push(await save({ ...record, ...values }));
    const visibleData = table === 'shifts' && actor.role === 'STAFF'
      ? filterReadableRecords(actor, table, data, context)
      : data;
    return { data: single || maybeSingle ? visibleData[0] || null : visibleData, error: null };
  }
  if (action === 'delete') {
    for (const record of targets) {
      await env.DB.prepare('DELETE FROM app_records WHERE table_name = ? AND record_id = ?').bind(table, String(record.id)).run();
    }
    return { data: targets, error: null };
  }
  if (action === 'upsert') {
    const keys = String(onConflict || 'id').split(',').map((key) => key.trim()).filter(Boolean);
    const data = [];
    for (const value of Array.isArray(values) ? values : [values]) {
      const existing = records.find((record) => keys.every((key) => String(record[key] ?? '') === String(value[key] ?? '')));
      data.push(await save(existing ? { ...existing, ...value, id: existing.id } : value));
    }
    return { data: single || maybeSingle ? data[0] || null : data, error: null };
  }
  throw new Error('Thao tac khong hop le.');
}

async function handleAuthorizedQuery(request, env, auth) {
  try {
    return reply(await queryRecordsAuthorized(env, await request.json(), auth));
  } catch (error) {
    if (error instanceof AuthorizationError) {
      return reply({ data: null, error: { message: error.message } }, error.status);
    }
    throw error;
  }
}

async function handleOchaSync(request, env) {
  const expectedSecret = env.OCHA_SYNC_SECRET;
  const authorization = request.headers.get('authorization') || '';
  if (!expectedSecret || authorization !== `Bearer ${expectedSecret}`) {
    return reply({ error: { message: 'KhÃ´ng Ä‘á»§ quyá»�n Ä‘á»“ng bá»™ Ocha.' } }, 401);
  }

  const input = await request.json();
  const storeId = Number(input.store_id);
  const date = String(input.date || '');
  const totalAmount = Number(input.total_amount);
  const orderCount = Number(input.order_count);
  if (!Number.isInteger(storeId) || storeId < 1 || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(totalAmount) || !Number.isFinite(orderCount)) {
    return reply({ error: { message: 'Dá»¯ liá»‡u doanh thu Ocha khÃ´ng há»£p lá»‡.' } }, 400);
  }

  const record = {
    id: `${storeId}_${date}`,
    store_id: storeId,
    date,
    total_amount: totalAmount,
    order_count: orderCount,
    source: String(input.source || 'OCHA'),
    created_at: input.created_at || now(),
    updated_at: now(),
  };
  const optionalMetrics = [
    ['cup_count', input.cup_count ?? input.drink_count ?? input.total_drink_quantity],
    ['cancelled_order_count', input.cancelled_order_count ?? input.canceled_order_count],
    ['cancelled_cup_count', input.cancelled_cup_count ?? input.canceled_cup_count],
  ];
  for (const [key, value] of optionalMetrics) {
    if (value === null || value === undefined || value === '') continue;
    record[key] = optionalNonNegativeInteger(value, key);
  }
  const result = await queryRecords(env, { table: 'daily_revenue', action: 'upsert', values: record, onConflict: 'id', single: true });
  return reply({ data: result.data, error: null });
}
async function handleOneSignalPush(request, env, auth) {
  const appId = env.ONESIGNAL_APP_ID;
  const restApiKey = env.ONESIGNAL_REST_API_KEY;
  if (!appId || !restApiKey) {
    return reply({ error: { message: 'OneSignal chua duoc cau hinh tren Cloudflare.' } }, 503);
  }

  const body = await request.json();
  const externalUserIds = [...new Set((body.externalUserIds || [])
    .map((id) => String(id || '').trim())
    .filter(Boolean))];
  const subscriptionIds = [...new Set((body.subscriptionIds || [])
    .map((id) => String(id || '').trim())
    .filter(Boolean))];
  const playerIds = [...new Set((body.playerIds || [])
    .map((id) => String(id || '').trim())
    .filter(Boolean))];
  if (auth?.user?.role !== 'OWNER') {
    const users = await readTable(env.DB, 'users');
    const pushTokens = await readTable(env.DB, 'push_tokens');
    const playerTargetIds = playerIds.flatMap((playerId) => pushTokens
      .filter((token) => String(token.expo_push_token || '') === `web_push_${playerId}`)
      .map((token) => String(token.user_id)));
    const targetIds = [...new Set([...externalUserIds, ...playerTargetIds])];
    if (!targetIds.length || !targetIds.every((targetId) => {
      const target = users.find((user) => String(user.id) === String(targetId));
      return target && recordInScope(auth.user, target, 'users', { users, shiftRegistrations: [] });
    })) {
      throw new AuthorizationError('Không thể gửi push notification ngoài phạm vi chi nhánh.');
    }
  }
  if (!externalUserIds.length && !subscriptionIds.length && !playerIds.length) {
    return reply({ sent: 0, skipped: true, reason: 'No push targets' });
  }

  // Safari PWA subscriptions created by OneSignal's SafariPush bridge are
  // legacy player IDs. They only accept the legacy endpoint + Basic auth.
  if (playerIds.length) {
    const legacyResponse = await fetch('https://onesignal.com/api/v1/notifications', {
      method: 'POST',
      headers: {
        'content-type': 'application/json; charset=utf-8',
        authorization: `Basic ${restApiKey}`,
      },
      body: JSON.stringify({
        app_id: appId,
        include_player_ids: playerIds,
        headings: { en: body.title || 'The Coc', vi: body.title || 'The Coc' },
        contents: { en: body.body || '', vi: body.body || '' },
        data: body.data || {},
      }),
    });
    const legacyResult = await legacyResponse.json().catch(() => null);
    if (!legacyResponse.ok) {
      return reply({ error: { message: 'OneSignal khong gui duoc thong bao.', status: legacyResponse.status } }, 502);
    }
    return reply({ sent: Number(legacyResult?.recipients ?? playerIds.length), recipients: Number(legacyResult?.recipients ?? playerIds.length), id: legacyResult?.id || null, provider: 'onesignal' });
  }

  // User aliases survive browser/service-worker changes; only use a raw
  // subscription ID for compatibility with legacy calls that have no user ID.
  const targeting = externalUserIds.length
    ? { include_aliases: { external_id: externalUserIds }, target_channel: 'push' }
    : { include_subscription_ids: subscriptionIds };
  const response = await fetch('https://api.onesignal.com/notifications', {
    method: 'POST',
    headers: {
      'content-type': 'application/json; charset=utf-8',
      authorization: `Key ${restApiKey}`,
    },
    body: JSON.stringify({
      app_id: appId,
      ...targeting,
      headings: { en: body.title || 'The Coc', vi: body.title || 'The Coc' },
      contents: { en: body.body || '', vi: body.body || '' },
      data: body.data || {},
    }),
  });
  const result = await response.json().catch(() => null);
  if (!response.ok) {
    return reply({ error: { message: 'OneSignal khong gui duoc thong bao.', status: response.status } }, 502);
  }
  return reply({
    sent: Number(result?.recipients ?? 0),
    recipients: Number(result?.recipients ?? 0),
    id: result?.id || null,
    provider: 'onesignal',
  });
}
const mediaKey = (bucket, path) => `${bucket}/${path}`.replace(/^\/+/, '');

async function handleMedia(request, env, url, auth = null) {
  const [, , bucket, ...parts] = url.pathname.split('/');
  const path = parts.join('/');
  if (!bucket || !path) return reply({ error: { message: 'Thiếu đường dẫn ảnh.' } }, 400);
  const key = mediaKey(bucket, path);
  if (request.method === 'PUT') {
    if (!auth?.user) throw new AuthorizationError();
    const isOwnAttendancePhoto = bucket === 'attendance-photos' && String(path).split('/')[0] === String(auth.user.id);
    const canUploadShiftReport = bucket === 'shift_reports' && hasPermission(auth.user, 'cashier');
    if (auth.user.role !== 'OWNER' && !isOwnAttendancePhoto && !canUploadShiftReport) throw new AuthorizationError();
    await env.MEDIA.put(key, request.body, { httpMetadata: { contentType: request.headers.get('content-type') || 'application/octet-stream' } });
    return reply({ data: { path }, error: null });
  }
  if (request.method === 'DELETE') {
    if (!auth?.user || (auth.user.role !== 'OWNER' && !hasPermission(auth.user, 'is_primary_manager'))) throw new AuthorizationError();
    await env.MEDIA.delete(key);
    return reply({ data: null, error: null });
  }
  const object = await env.MEDIA.get(key);
  if (!object) return new Response('Không tìm thấy ảnh.', { status: 404, headers: cors });
  const headers = new Headers(cors);
  object.writeHttpMetadata(headers);
  headers.set('etag', object.httpEtag);
  headers.set('cache-control', 'public, max-age=31536000, immutable');
  return new Response(object.body, { headers });
}

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') return new Response(null, { headers: cors });
    const url = new URL(request.url);
    try {
      if (url.pathname === '/health') return reply({ ok: true, service: 'thecoc-api' });
      if (url.pathname === '/auth/login' && request.method === 'POST') return handleLogin(request, env);
      if (url.pathname === '/sync/ocha' && request.method === 'POST') return handleOchaSync(request, env);
      // Existing report images are rendered from their R2 URL. Keep reads public, but protect upload and deletion below.
      if (url.pathname.startsWith('/storage/') && request.method === 'GET') return handleMedia(request, env, url);
      const auth = await authenticate(request, env);
      if (!auth) return reply({ error: { message: 'Phiên đăng nhập không hợp lệ hoặc đã hết hạn.' } }, 401);
      if (url.pathname === '/auth/me' && request.method === 'GET') return reply({ data: auth.user, error: null });
      if (url.pathname === '/auth/profile' && request.method === 'POST') return handleProfileUpdate(request, env, auth);
      if (url.pathname === '/auth/migrate-passwords' && request.method === 'POST') return handleMigratePasswords(env, auth);
      if (url.pathname.startsWith('/storage/')) return handleMedia(request, env, url, auth);
      if (url.pathname === '/push/onesignal' && request.method === 'POST') return handleOneSignalPush(request, env, auth);
      if (url.pathname === '/query' && request.method === 'POST') return handleAuthorizedQuery(request, env, auth);
      return reply({ error: { message: 'Không tìm thấy API.' } }, 404);
    } catch (error) {
      const status = error instanceof AuthorizationError ? error.status : 500;
      return reply({ data: null, error: { message: error?.message || 'Lỗi máy chủ.' } }, status);
    }
  },
};
