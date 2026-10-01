import AsyncStorage from '@react-native-async-storage/async-storage';

const API_URL = process.env.EXPO_PUBLIC_THECOC_API_URL || 'https://thecoc-api.phamthaihiep1996.workers.dev';
const SESSION_KEY = 'thecocAuthSession';
let authToken = null;
let authFailureHandler = null;

export const setAuthFailureHandler = (handler) => {
  authFailureHandler = typeof handler === 'function' ? handler : null;
};

const getHeaders = (headers = {}) => ({
  ...headers,
  ...(authToken ? { authorization: `Bearer ${authToken}` } : {}),
});

const requestJson = async (path, options = {}) => {
  const response = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: getHeaders(options.headers || {}),
  });
  const result = await response.json().catch(() => ({}));
  if (response.status === 401 && path !== '/auth/login') {
    const hadActiveSession = Boolean(authToken);
    authToken = null;
    await AsyncStorage.removeItem(SESSION_KEY);
    if (hadActiveSession) authFailureHandler?.();
  }
  return { response, result };
};

export const signInWithPassword = async (phone, password) => {
  try {
    const { response, result } = await requestJson('/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ phone, password }),
    });
    if (!response.ok || result.error || !result.data?.token || !result.data?.user) {
      return { data: null, error: new Error(result.error?.message || 'Không thể đăng nhập.') };
    }
    authToken = result.data.token;
    await AsyncStorage.setItem(SESSION_KEY, authToken);
    return { data: result.data.user, error: null };
  } catch (error) {
    return { data: null, error };
  }
};

export const restoreAuthSession = async () => {
  try {
    const savedToken = await AsyncStorage.getItem(SESSION_KEY);
    if (!savedToken) return { data: null, error: null };
    authToken = savedToken;
    const { response, result } = await requestJson('/auth/me');
    if (!response.ok || result.error || !result.data) {
      authToken = null;
      await AsyncStorage.removeItem(SESSION_KEY);
      return { data: null, error: null };
    }
    return { data: result.data, error: null };
  } catch (error) {
    authToken = null;
    await AsyncStorage.removeItem(SESSION_KEY);
    return { data: null, error };
  }
};

export const clearAuthSession = async () => {
  authToken = null;
  await AsyncStorage.removeItem(SESSION_KEY);
};

export const updateMyProfile = async (updates = {}) => {
  try {
    const { response, result } = await requestJson('/auth/profile', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(updates),
    });
    return {
      data: result.data ?? null,
      error: response.ok && !result.error ? null : new Error(result.error?.message || 'Không thể cập nhật hồ sơ.'),
    };
  } catch (error) {
    return { data: null, error };
  }
};

class QueryBuilder {
  constructor(table, action = 'select', values = null, options = {}) {
    this.table = table;
    this.action = action;
    this.values = values;
    this.options = options;
    this.filters = [];
    this.orderBy = null;
    this.singleMode = false;
    this.maybeSingleMode = false;
  }

  select(_columns = '*', options = {}) { if (this.action === 'select') this.options = { ...this.options, ...options }; return this; }
  insert(values) { this.action = 'insert'; this.values = values; return this; }
  update(values) { this.action = 'update'; this.values = values; return this; }
  delete() { this.action = 'delete'; return this; }
  upsert(values, options = {}) { this.action = 'upsert'; this.values = values; this.options = { ...this.options, ...options }; return this; }
  eq(key, value) { this.filters.push({ op: 'eq', key, value }); return this; }
  in(key, value) { this.filters.push({ op: 'in', key, value }); return this; }
  like(key, value) { this.filters.push({ op: 'like', key, value }); return this; }
  gte(key, value) { this.filters.push({ op: 'gte', key, value }); return this; }
  lte(key, value) { this.filters.push({ op: 'lte', key, value }); return this; }
  order(column, options = {}) { this.orderBy = { column, ascending: options.ascending !== false }; return this; }
  single() { this.singleMode = true; return this; }
  maybeSingle() { this.maybeSingleMode = true; return this; }

  async execute() {
    try {
      const { response, result } = await requestJson('/query', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ table: this.table, action: this.action, values: this.values, filters: this.filters, order: this.orderBy, onConflict: this.options.onConflict, count: this.options.count, head: this.options.head, single: this.singleMode, maybeSingle: this.maybeSingleMode }),
      });
      return { data: result.data ?? null, count: result.count ?? null, error: response.ok && !result.error ? null : new Error(result.error?.message || 'Lỗi Cloudflare.') };
    } catch (error) { return { data: null, count: null, error }; }
  }

  then(resolve, reject) { return this.execute().then(resolve, reject); }
}

const storageBucket = (bucket) => ({
  upload: async (path, body, options = {}) => {
    try {
      const { response, result } = await requestJson(`/storage/${bucket}/${path}`, { method: 'PUT', headers: { 'content-type': options.contentType || 'application/octet-stream' }, body });
      return { data: result.data ?? null, error: response.ok && !result.error ? null : new Error(result.error?.message || 'Không thể tải ảnh lên.') };
    } catch (error) { return { data: null, error }; }
  },
  download: async (path) => {
    try {
      const response = await fetch(`${API_URL}/storage/${bucket}/${path}`, { headers: getHeaders() });
      if (!response.ok) throw new Error('Không thể tải ảnh.');
      return { data: await response.blob(), error: null };
    } catch (error) { return { data: null, error }; }
  },
  list: async () => ({ data: [], error: null }),
  remove: async (paths) => {
    const values = await Promise.all((paths || []).map(async (path) => {
      const { response } = await requestJson(`/storage/${bucket}/${path}`, { method: 'DELETE' });
      return response.ok;
    }));
    return { data: values, error: null };
  },
  getPublicUrl: (path) => ({ data: { publicUrl: `${API_URL}/storage/${bucket}/${path}` } }),
});

const invokeWorkerFunction = async (name, options = {}) => {
  if (name !== 'send-onesignal-push') return { data: null, error: new Error('Hàm Cloudflare không được hỗ trợ.') };
  try {
    const { response, result } = await requestJson('/push/onesignal', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(options.body || {}) });
    return { data: result, error: response.ok && !result.error ? null : new Error(result.error?.message || 'Không thể gửi push.') };
  } catch (error) { return { data: null, error }; }
};

export const supabase = {
  from: (table) => new QueryBuilder(table),
  storage: { from: storageBucket },
  functions: { invoke: invokeWorkerFunction },
  channel: () => ({ on() { return this; }, subscribe() { return this; } }),
  removeChannel: () => {},
};
