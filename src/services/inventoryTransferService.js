import { supabase } from './supabaseClient';
import { getInventoryItems } from './inventoryService';

export const getTransferTickets = async (storeId, role) => {
  let query = supabase
    .from('transfer_tickets')
    .select(`
      *,
      transfer_items (
        id, amount, item_id
      )
    `)
    .order('created_at', { ascending: false });

  if (role !== 'OWNER' && storeId) {
    query = query.or(`from_store_id.eq.${storeId},to_store_id.eq.${storeId}`);
  }

  const { data, error } = await query;
  if (error) throw error;
  return data;
};

export const createTransferTicket = async (payload, items) => {
  // 1. Tạo ticket
  const { data: ticket, error: ticketErr } = await supabase
    .from('transfer_tickets')
    .insert([payload])
    .select()
    .single();

  if (ticketErr) throw ticketErr;

  // 2. Tạo items
  const itemsPayload = items.map(it => ({
    ticket_id: ticket.id,
    item_id: it.itemId,
    amount: it.amount
  }));

  const { error: itemsErr } = await supabase
    .from('transfer_items')
    .insert(itemsPayload);

  if (itemsErr) {
    // Rollback (bỏ qua bước này nếu làm đơn giản)
    throw itemsErr;
  }

  return ticket;
};

export const updateTicketStatus = async (ticketId, status, approverId) => {
  const { error } = await supabase
    .from('transfer_tickets')
    .update({ status, approved_by: approverId })
    .eq('id', ticketId);
  if (error) throw error;
};

export const processCompletedTicket = async (ticket) => {
  // Khi duyệt xong, tạo log nhập xuất tương ứng
  const dateStr = new Date().toISOString().split('T')[0];
  const logs = [];

  for (const item of ticket.transfer_items) {
    if (ticket.type === 'IMPORT' || ticket.type === 'TRANSFER') {
      // Đầu nhận
      logs.push({
        id: `log_${Date.now()}_in_${item.item_id}`,
        itemId: item.item_id,
        type: 'IMPORT',
        amount: item.amount,
        date: dateStr,
        store_id: ticket.to_store_id
      });
    }
    
    if (ticket.type === 'EXPORT' || ticket.type === 'TRANSFER') {
      // Đầu xuất
      logs.push({
        id: `log_${Date.now()}_out_${item.item_id}`,
        itemId: item.item_id,
        type: 'EXPORT',
        amount: item.amount,
        date: dateStr,
        store_id: ticket.from_store_id
      });
    }
  }

  if (logs.length > 0) {
    const { error } = await supabase.from('inventory_logs').insert(logs);
    if (error) throw error;
  }
};
