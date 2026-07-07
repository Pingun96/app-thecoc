import { supabase } from './supabaseClient';
export const getInventoryItems = async (storeId) => {
  let query = supabase.from('inventory_items').select('*');
  if (storeId && storeId !== 'ALL') {
    query = query.eq('store_id', storeId);
  }
  const { data, error } = await query;
  if (error) throw error;
  return data;
};

export const createInventoryLog = async (payload) => {
  const { error } = await supabase.from('inventory_logs').insert([payload]);
  if (error) throw error;
  return payload;
};

export const createInventoryItem = async (payload) => {
  const { error } = await supabase.from('inventory_items').insert([payload]);
  if (error) throw error;
  return payload;
};

export const deleteInventoryItem = async (itemId) => {
  const { error } = await supabase.from('inventory_items').delete().eq('id', itemId);
  if (error) throw error;
};

export const createInventoryTicket = async (payload) => {
  const { error } = await supabase.from('inventory_tickets').insert([payload]);
  if (error) throw error;
  return payload;
};

export const rejectInventoryTicket = async (ticketId, userId) => {
  const { error } = await supabase
    .from('inventory_tickets')
    .update({ status: 'REJECTED', updated_at: new Date().toISOString() })
    .eq('id', ticketId);
  if (error) throw error;
};

export const approveInventoryTicket = async (ticket, userId, userStoreId) => {
  const isSourceManager = String(ticket.source_store_id) === String(userStoreId);
  const isDestManager = String(ticket.destination_store_id) === String(userStoreId);

  if (ticket.type === 'IMPORT' && isDestManager && ticket.status === 'PENDING_DEST') {
    // Nhập hàng -> Duyệt phát là xong
    await processApproval(ticket, 'APPROVED', userId, null, userId, 'IMPORT', userStoreId);
  } else if (ticket.type === 'EXPORT' && isSourceManager && ticket.status === 'PENDING_SOURCE') {
    // Xuất hàng -> Duyệt phát là xong
    await processApproval(ticket, 'APPROVED', userId, userId, null, 'EXPORT', userStoreId);
  } else if (ticket.type === 'TRANSFER') {
    if (isSourceManager && ticket.status === 'PENDING_SOURCE') {
      // Chi nhánh xuất duyệt trước
      await processApproval(ticket, 'PENDING_DEST', userId, userId, ticket.approved_by_dest, 'EXPORT', userStoreId);
    } else if (isDestManager && ticket.status === 'PENDING_DEST') {
      // Chi nhánh nhận duyệt sau cùng
      await processApproval(ticket, 'APPROVED', userId, ticket.approved_by_source, userId, 'IMPORT', userStoreId);
    } else {
      throw new Error('Bạn không có quyền duyệt phiếu này ở trạng thái hiện tại.');
    }
  } else {
    throw new Error('Phiếu này không hợp lệ hoặc bạn không có quyền duyệt.');
  }
};

async function processApproval(ticket, nextStatus, approverId, sourceApprover, destApprover, logType, storeId) {
  const items = ticket.items || [];

  if (logType === 'EXPORT') {
    for (const item of items) {
      const currentStock = await getCurrentStock(item.itemId, storeId);
      if (Number(item.amount || 0) > currentStock) {
        throw new Error(`Không đủ tồn kho để xuất ${item.name}. Tồn hiện tại: ${currentStock} ${item.unit || ''}.`);
      }
    }
  }

  // 1. Cập nhật trạng thái phiếu
  const updatePayload = { 
    status: nextStatus,
    updated_at: new Date().toISOString()
  };
  if (sourceApprover) updatePayload.approved_by_source = sourceApprover;
  if (destApprover) updatePayload.approved_by_dest = destApprover;

  const { error: updateError } = await supabase
    .from('inventory_tickets')
    .update(updatePayload)
    .eq('id', ticket.id)
    .eq('status', ticket.status); // Optimistic lock

  if (updateError) throw updateError;

  // 2. Xử lý ghi log kho (Nhập hoặc Xuất)
  // Nếu là IMPORT (đặc biệt khi TRANSFER sang chi nhánh mới), cần tìm hoặc tạo Item
  let destItemsMap = {};
  if (logType === 'IMPORT') {
    const { data: existingItems } = await supabase
      .from('inventory_items')
      .select('id, name')
      .eq('store_id', storeId);
      
    destItemsMap = (existingItems || []).reduce((acc, curr) => {
      acc[curr.name.toLowerCase()] = curr.id;
      return acc;
    }, {});
  }

  const logsToInsert = [];
  
  for (const item of items) {
    let finalItemId = item.itemId;

    // Nếu là chi nhánh nhận (IMPORT) và chuyển từ nơi khác sang, ID item có thể là của chi nhánh nguồn!
    // Cần match theo tên.
    if (logType === 'IMPORT' && ticket.type === 'TRANSFER') {
      const itemNameLower = item.name.toLowerCase();
      if (destItemsMap[itemNameLower]) {
        finalItemId = destItemsMap[itemNameLower];
      } else {
        // Chưa có mặt hàng này ở chi nhánh nhận -> Tạo mới
        const newItemId = `item_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
        await supabase.from('inventory_items').insert([{
          id: newItemId,
          name: item.name,
          unit: item.unit,
          safelevel: 0,
          store_id: storeId
        }]);
        finalItemId = newItemId;
        destItemsMap[itemNameLower] = newItemId;
      }
    }

    logsToInsert.push({
      id: `log_${ticket.id}_${finalItemId}_${logType}_${Date.now()}`,
      itemid: finalItemId,
      type: logType,
      amount: Number(item.amount),
      date: new Date().toISOString(),
      store_id: storeId,
      ticket_id: ticket.id,
      created_by: ticket.requested_by,
      approved_by: approverId,
      note: ticket.note || `Phiếu ${logType === 'IMPORT' ? 'Nhập kho' : 'Xuất kho'}`
    });
  }

  if (logsToInsert.length > 0) {
    const { error: logError } = await supabase.from('inventory_logs').insert(logsToInsert);
    if (logError) {
      console.error('Lỗi khi ghi logs:', logError);
      // rollback update if needed, but in simple flow we just throw
      throw logError;
    }
  }
}

async function getCurrentStock(itemId, storeId) {
  const { data, error } = await supabase
    .from('inventory_logs')
    .select('type, amount')
    .eq('itemid', itemId)
    .eq('store_id', storeId);

  if (error) throw error;

  return (data || []).reduce((total, log) => {
    const amount = Number(log.amount || 0);
    if (log.type === 'IMPORT' || log.type === 'ADJUST_UP') return total + amount;
    if (log.type === 'EXPORT' || log.type === 'ADJUST_DOWN') return total - amount;
    return total;
  }, 0);
}
