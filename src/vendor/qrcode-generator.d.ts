// qrcode-generator 1.4.4 最小型別宣告（只列出本專案用到的部分）
export interface QRCode {
  addData(data: string, mode?: 'Byte' | 'Numeric' | 'Alphanumeric' | 'Kanji'): void;
  make(): void;
  getModuleCount(): number;
  isDark(row: number, col: number): boolean;
}
declare function qrcode(typeNumber: number, errorCorrectionLevel: 'L' | 'M' | 'Q' | 'H'): QRCode;
export default qrcode;
