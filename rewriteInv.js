const fs = require('fs');

const path = 'd:\\APP Thecoc\\thecoc-mobile\\src\\screens\\InventoryScreen.js';
let content = fs.readFileSync(path, 'utf8');

// 1. Update State variables
content = content.replace(
  "  const [selectedItemId, setSelectedItemId] = useState('');\n  const [actionType, setActionType] = useState('EXPORT');\n  const [amount, setAmount] = useState('');",
  `  const [actionType, setActionType] = useState('EXPORT');
  const [destStoreId, setDestStoreId] = useState('');
  const [cartItems, setCartItems] = useState([]);
  const [amount, setAmount] = useState('');
  const [selectedItemId, setSelectedItemId] = useState('');`
);

// 2. Update handleSubmitAction
const oldHandleSubmit = `  const handleSubmitAction = () => runOperation('submit-action', async () => {
    const numericAmount = Number(String(amount).replace(',', '.'));
    if (!selectedStock) throw new Error('Vui lòng chọn nguyên liệu.');
    if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
      throw new Error('Số lượng phải lớn hơn 0.');
    }
    if (storeIdToView === 'ALL') {
      throw new Error('Vui lòng chọn một chi nhánh cụ thể trước khi thao tác.');
    }

    let finalType = actionType;
    let finalAmount = numericAmount;

    if (actionType === 'STOCKTAKE') {
      const difference = Number((numericAmount - selectedStock.currentStock).toFixed(2));
      if (difference === 0) {
        Alert.alert('Kho đã khớp', 'Số lượng thực tế trùng với số liệu trên hệ thống.');
        return;
      }
      finalType = difference > 0 ? 'ADJUST_UP' : 'ADJUST_DOWN';
      finalAmount = Math.abs(difference);
    }

    const quantityLeaving = finalType === 'EXPORT' || finalType === 'ADJUST_DOWN';
    if (quantityLeaving && finalAmount > selectedStock.currentStock) {
      throw new Error(
        \`Không thể xuất \${formatQuantity(finalAmount)} \${selectedStock.unit}. Tồn hiện tại chỉ còn \${formatQuantity(selectedStock.currentStock)} \${selectedStock.unit}.\`,
      );
    }

    const date = getLocalDateKey();
    if (isOwner) {
      const log = {
        id: makeId('log'),
        itemid: selectedStock.id,
        type: finalType,
        amount: finalAmount,
        date,
        store_id: selectedStock.store_id,
      };
      await createInventoryLog(log);
      setInventoryLogs((current) => [normalizeInventoryLog(log), ...current]);
      Alert.alert('Đã cập nhật kho', \`\${ACTIONS[finalType].label}: \${formatQuantity(finalAmount)} \${selectedStock.unit}.\`);
    } else {
      const request = {
        id: makeId('req'),
        itemid: selectedStock.id,
        type: finalType,
        amount: finalAmount,
        date,
        store_id: selectedStock.store_id,
        requested_by_name: currentUser?.name || 'Nhân viên',
        status: isManager ? 'PENDING_OWNER' : 'PENDING_MANAGER',
      };
      await createInventoryRequest(request);
      setInventoryRequests((current) => [normalizeInventoryRequest(request), ...current]);

      await notifyInventoryApprovers(request, finalType);

      Alert.alert('Đã gửi phiếu', 'Yêu cầu đã được lưu và chuyển đến cấp duyệt tiếp theo.');
    }
    setAmount('');
  });`;

const newHandleSubmit = `
  const handleAddToCart = () => {
    if (!selectedStock) return Alert.alert('Lỗi', 'Vui lòng chọn nguyên liệu');
    const numericAmount = Number(String(amount).replace(',', '.'));
    if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
      return Alert.alert('Lỗi', 'Số lượng phải lớn hơn 0.');
    }
    
    // Check if item already in cart
    const existingIndex = cartItems.findIndex(i => i.itemId === selectedStock.id);
    if (existingIndex > -1) {
      const newCart = [...cartItems];
      newCart[existingIndex].amount += numericAmount;
      setCartItems(newCart);
    } else {
      setCartItems([...cartItems, {
        itemId: selectedStock.id,
        name: selectedStock.name,
        unit: selectedStock.unit,
        amount: numericAmount,
        currentStock: selectedStock.currentStock
      }]);
    }
    setAmount('');
  };

  const handleRemoveFromCart = (itemId) => {
    setCartItems(cartItems.filter(i => i.itemId !== itemId));
  };

  const handleSubmitAction = () => runOperation('submit-action', async () => {
    if (cartItems.length === 0) throw new Error('Giỏ hàng trống. Vui lòng thêm ít nhất 1 mặt hàng.');
    if (storeIdToView === 'ALL') throw new Error('Vui lòng chọn một chi nhánh cụ thể trước khi thao tác.');
    if (actionType === 'TRANSFER' && !destStoreId) throw new Error('Vui lòng chọn chi nhánh nhận.');
    if (actionType === 'TRANSFER' && destStoreId === storeIdToView) throw new Error('Chi nhánh nhận phải khác chi nhánh xuất.');

    // Validate export stock
    if (actionType === 'EXPORT' || actionType === 'TRANSFER') {
      for (const item of cartItems) {
        if (item.amount > item.currentStock) {
          throw new Error(\`Không thể xuất \${item.name}. Vượt quá tồn kho hiện tại (\${item.currentStock} \${item.unit}).\`);
        }
      }
    }

    let initialStatus = 'PENDING_SOURCE';
    if (actionType === 'IMPORT') initialStatus = 'PENDING_DEST';

    const ticket = {
      id: makeId('ticket'),
      type: actionType,
      source_store_id: (actionType === 'EXPORT' || actionType === 'TRANSFER') ? storeIdToView : null,
      destination_store_id: (actionType === 'IMPORT' || actionType === 'TRANSFER') ? (actionType === 'TRANSFER' ? destStoreId : storeIdToView) : null,
      items: cartItems,
      status: initialStatus,
      requested_by: currentUser?.id,
      requested_by_name: currentUser?.name || 'Nhân viên',
    };

    await createInventoryTicket(ticket);
    
    // Auto-approve if Owner is creating the ticket!
    if (isOwner) {
       await approveInventoryTicket(ticket, currentUser.id, storeIdToView);
       Alert.alert('Thành công', 'Phiếu đã được tạo và tự động duyệt vì bạn là Chủ Cửa Hàng.');
    } else {
       Alert.alert('Đã gửi phiếu', 'Yêu cầu đã được gửi đến quản lý để phê duyệt.');
    }
    
    setCartItems([]);
    await refreshData?.();
  });
`;

content = content.replace(oldHandleSubmit, newHandleSubmit);

// 3. Update the UI for ACTION tab
const oldJSXStart = "{activeTab === 'ACTION' && (";
const oldJSXEnd = "          {activeTab === 'APPROVALS' && !isStaff && (";

const jsxToReplace = content.substring(content.indexOf(oldJSXStart), content.indexOf(oldJSXEnd));

const newJSX = \`{activeTab === 'ACTION' && (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Tạo phiếu kho đa mặt hàng</Text>
              
              <Text style={styles.fieldLabel}>Loại phiếu</Text>
              <View style={styles.actionGrid}>
                {['IMPORT', 'EXPORT', 'TRANSFER'].map((type) => (
                  <TouchableOpacity
                    key={type}
                    style={[
                      styles.actionButton,
                      actionType === type && { backgroundColor: type==='IMPORT'?'#16a34a':type==='EXPORT'?'#dc2626':'#7c3aed', borderColor: type==='IMPORT'?'#16a34a':type==='EXPORT'?'#dc2626':'#7c3aed' },
                    ]}
                    onPress={() => { setActionType(type); setCartItems([]); }}
                  >
                    <Text style={[styles.actionButtonText, actionType === type && { color: '#fff' }]}>
                      {type === 'IMPORT' ? 'Nhập Hàng' : type === 'EXPORT' ? 'Xuất Hủy' : 'Chuyển Kho'}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>

              {actionType === 'TRANSFER' && (
                <View style={{ marginTop: 15 }}>
                  <Text style={styles.fieldLabel}>Chuyển đến Chi nhánh</Text>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.itemScroller}>
                    {storeList.filter(s => s.id !== storeIdToView).map((store) => (
                      <TouchableOpacity
                        key={store.id}
                        style={[styles.itemChip, destStoreId === store.id && styles.itemChipActive]}
                        onPress={() => setDestStoreId(store.id)}
                      >
                        <Text style={[styles.itemChipText, destStoreId === store.id && styles.itemChipTextActive]}>
                          {store.name}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </ScrollView>
                </View>
              )}

              <View style={{ height: 1, backgroundColor: '#e2e8f0', marginVertical: 15 }} />

              <Text style={styles.fieldLabel}>Chọn nguyên liệu</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.itemScroller}>
                {myItems.map((item) => (
                  <TouchableOpacity
                    key={item.id}
                    style={[styles.itemChip, effectiveSelectedItemId === item.id && styles.itemChipActive]}
                    onPress={() => setSelectedItemId(item.id)}
                  >
                    <Text style={[styles.itemChipText, effectiveSelectedItemId === item.id && styles.itemChipTextActive]}>
                      {item.name}
                    </Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>

              {selectedStock && (
                <View style={styles.currentStockBox}>
                  <Text style={styles.currentStockLabel}>Tồn khả dụng</Text>
                  <Text style={styles.currentStockValue}>
                    {formatQuantity(selectedStock.currentStock)} {selectedStock.unit}
                  </Text>
                </View>
              )}

              <View style={{flexDirection: 'row', alignItems: 'center', marginTop: 10, gap: 10}}>
                <View style={{flex: 1}}>
                  <TextInput
                    style={styles.input}
                    keyboardType="decimal-pad"
                    placeholder="Nhập số lượng..."
                    placeholderTextColor="#94a3b8"
                    value={amount}
                    onChangeText={setAmount}
                  />
                </View>
                <TouchableOpacity style={{backgroundColor: '#1565c0', padding: 14, borderRadius: 12}} onPress={handleAddToCart}>
                  <Ionicons name="add" size={20} color="#fff" />
                </TouchableOpacity>
              </View>

              {cartItems.length > 0 && (
                <View style={{marginTop: 20}}>
                  <Text style={styles.sectionTitle}>Danh sách đã chọn ({cartItems.length})</Text>
                  {cartItems.map((item, idx) => (
                    <View key={idx} style={{flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: '#f8fafc', padding: 12, borderRadius: 8, marginBottom: 8, borderWidth: 1, borderColor: '#e2e8f0'}}>
                      <View>
                        <Text style={{fontWeight: '700', color: '#1e293b'}}>{item.name}</Text>
                        <Text style={{color: '#64748b', fontSize: 12}}>Số lượng: {formatQuantity(item.amount)} {item.unit}</Text>
                      </View>
                      <TouchableOpacity onPress={() => handleRemoveFromCart(item.itemId)}>
                        <Ionicons name="trash-outline" size={20} color="#ef4444" />
                      </TouchableOpacity>
                    </View>
                  ))}

                  <TouchableOpacity
                    style={[styles.submitButton, busyKey && styles.disabledButton]}
                    onPress={handleSubmitAction}
                    disabled={Boolean(busyKey)}
                  >
                    {busyKey === 'submit-action'
                      ? <ActivityIndicator color="#fff" />
                      : (
                        <>
                          <Ionicons name="paper-plane-outline" size={21} color="#fff" />
                          <Text style={styles.submitButtonText}>Tạo Phiếu Kho</Text>
                        </>
                      )}
                  </TouchableOpacity>
                </View>
              )}
            </View>
          )}

`;

content = content.replace(jsxToReplace, newJSX);

fs.writeFileSync(path, content, 'utf8');
console.log('Done rewriting InventoryScreen.js');
