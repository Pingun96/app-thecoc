import { supabase } from './supabaseClient';

export const getDailyRevenue = async (storeId, startDate, endDate) => {
  let query = supabase.from('daily_revenue').select('*');
  
  if (storeId && storeId !== 'ALL') {
    query = query.eq('store_id', storeId);
  }
  if (startDate) query = query.gte('date', startDate);
  if (endDate) query = query.lte('date', endDate);

  const { data, error } = await query;
  if (error) throw error;
  return data;
};

// Hàm dành riêng cho Script của NAS Synology (chỉ để minh hoạ)
// Hoặc cho phép Owner nhập thủ công trên app nếu rớt mạng Ocha
export const upsertDailyRevenue = async (payload) => {
  const { error } = await supabase.from('daily_revenue').upsert([payload], {
    onConflict: 'store_id, date'
  });
  if (error) throw error;
  return payload;
};
