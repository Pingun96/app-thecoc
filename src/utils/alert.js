import { Platform, Alert as RNAlert } from 'react-native';

export const Alert = {
  alert: (title, message, buttons, options) => {
    if (Platform.OS === 'web') {
      if (buttons && buttons.length > 0) {
        // Tìm nút có action (không phải Hủy)
        const confirmButton = buttons.find(b => b.style !== 'cancel' && b.text !== 'Hủy' && b.text !== 'Huỷ');
        const cancelButton = buttons.find(b => b.style === 'cancel' || b.text === 'Hủy' || b.text === 'Huỷ');
        
        const text = `${title ? `${title}\n\n` : ''}${message || ''}`;
        const confirmed = window.confirm(text);
        
        if (confirmed) {
          if (confirmButton && confirmButton.onPress) {
            confirmButton.onPress();
          }
        } else {
          if (cancelButton && cancelButton.onPress) {
            cancelButton.onPress();
          }
        }
      } else {
        const text = `${title ? `${title}\n\n` : ''}${message || ''}`;
        window.alert(text);
      }
    } else {
      RNAlert.alert(title, message, buttons, options);
    }
  }
};
