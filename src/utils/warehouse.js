export const isCentralWarehouseStore = (store = {}) => {
  const name = String(store.name || store.store_name || '').toLowerCase();
  return store.is_warehouse === true
    || store.is_central_warehouse === true
    || name.includes('kho tổng')
    || name.includes('kho tong');
};

export const getCentralWarehouseStore = (storeList = []) => (
  (storeList || []).find(isCentralWarehouseStore) || null
);

export const getBusinessStores = (storeList = []) => (
  (storeList || []).filter((store) => !isCentralWarehouseStore(store))
);

export const getStoreName = (storeList = [], storeId, fallback = 'Chi nhánh') => (
  (storeList || []).find((store) => String(store.id) === String(storeId))?.name
  || `${fallback} ${storeId || '--'}`
);

export const buildInventoryStockRows = (items = [], logs = []) => (
  (items || []).map((item) => {
    const itemLogs = (logs || []).filter(
      (log) => String(log.itemId ?? log.itemid ?? log.item_id) === String(item.id)
        && String(log.store_id) === String(item.store_id),
    );
    const imported = itemLogs
      .filter((log) => log.type === 'IMPORT' || log.type === 'ADJUST_UP')
      .reduce((sum, log) => sum + Number(log.amount || 0), 0);
    const exported = itemLogs
      .filter((log) => log.type === 'EXPORT' || log.type === 'ADJUST_DOWN')
      .reduce((sum, log) => sum + Number(log.amount || 0), 0);
    const currentStock = Number((imported - exported).toFixed(2));

    return {
      ...item,
      logs: itemLogs,
      currentStock,
      isLowStock: currentStock <= Number(item.safeLevel || 0),
    };
  })
);
