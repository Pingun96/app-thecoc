import * as FileSystem from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { Platform } from 'react-native';
import * as XLSX from 'xlsx';

export const exportToExcel = async (data, fileName, sheetName = 'Sheet1') => {
  try {
    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, sheetName);
    
    // Xuất ra định dạng base64
    const base64 = XLSX.write(wb, { type: 'base64', bookType: 'xlsx' });
    const fileUri = `${FileSystem.documentDirectory}${fileName}.xlsx`;

    if (Platform.OS === 'web') {
      // Trên Web PWA, dùng kỹ thuật tải file qua thẻ a
      const byteCharacters = atob(base64);
      const byteNumbers = new Array(byteCharacters.length);
      for (let i = 0; i < byteCharacters.length; i++) {
        byteNumbers[i] = byteCharacters.charCodeAt(i);
      }
      const byteArray = new Uint8Array(byteNumbers);
      const blob = new Blob([byteArray], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${fileName}.xlsx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
    } else {
      // Trên Mobile (iOS/Android), lưu file và mở hộp thoại Share
      await FileSystem.writeAsStringAsync(fileUri, base64, {
        encoding: FileSystem.EncodingType.Base64
      });
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(fileUri, {
          mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          dialogTitle: 'Chia sẻ Báo cáo Excel',
          UTI: 'com.microsoft.excel.xls'
        });
      }
    }
    return true;
  } catch (error) {
    console.error('Error exporting excel:', error);
    throw error;
  }
};
