import { supabase } from './supabaseClient';
import { getLocalDateKey } from '../utils/dateTime';

const isMissingFunctionError = (error) => (
  error?.code === 'PGRST202'
  || /function .* does not exist|Could not find the function/i.test(error?.message || '')
);

export const createInventoryLog = async (payload) => {
  const { error } = await supabase.from('inventory_logs').insert([payload]);
  if (error) throw error;
  return payload;
};

export const createInventoryRequest = async (payload) => {
  const { error } = await supabase.from('inventory_requests').insert([payload]);
  if (error) throw error;
  return payload;
};

export const updateInventoryRequestStatus = async (requestId, currentStatus, nextStatus) => {
  const query = supabase
    .from('inventory_requests')
    .update({ status: nextStatus })
    .eq('id', requestId);

  if (currentStatus) query.eq('status', currentStatus);
  const { error } = await query;
  if (error) throw error;
};

export const approveInventoryRequest = async (request) => {
  const rpcResult = await supabase.rpc('approve_inventory_request', {
    p_request_id: request.id,
  });

  if (!rpcResult.error) {
    return {
      usedRpc: true,
      log: null,
    };
  }
  if (!isMissingFunctionError(rpcResult.error)) throw rpcResult.error;

  const { data: latestRequest, error: requestError } = await supabase
    .from('inventory_requests')
    .select('id,status')
    .eq('id', request.id)
    .single();
  if (requestError) throw requestError;
  if (!latestRequest || !['PENDING_MANAGER', 'PENDING_OWNER'].includes(latestRequest.status)) {
    throw new Error('Phiếu này đã được xử lý. Vui lòng tải lại dữ liệu.');
  }

  const log = {
    id: `log_${request.id}`,
    itemid: request.itemId,
    type: request.type,
    amount: Number(request.amount),
    date: getLocalDateKey(),
    store_id: request.store_id,
  };

  const insertResult = await supabase.from('inventory_logs').insert([log]);
  const insertedNow = !insertResult.error;
  if (insertResult.error && insertResult.error.code !== '23505') throw insertResult.error;

  const updateResult = await supabase
    .from('inventory_requests')
    .update({ status: 'APPROVED' })
    .eq('id', request.id)
    .eq('status', latestRequest.status);

  if (updateResult.error) {
    if (insertedNow) {
      await supabase.from('inventory_logs').delete().eq('id', log.id);
    }
    throw updateResult.error;
  }

  return {
    usedRpc: false,
    log,
  };
};

export const createInventoryItem = async (payload) => {
  const { error } = await supabase.from('inventory_items').insert([payload]);
  if (error) throw error;
  return payload;
};
