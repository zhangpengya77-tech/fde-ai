// 參數下載狀態機：PARAM_REQUEST_LIST → 收 PARAM_VALUE → 安靜一段時間後，以 PARAM_REQUEST_READ 依索引補讀缺漏。
// 時間由呼叫端以 tick(now) 推進，方便測試；本模組不會送出 PARAM_SET（寫入在 writer.js）。

export const PARAM_TYPE_NAMES = {
  1: 'UINT8', 2: 'INT8', 3: 'UINT16', 4: 'INT16', 5: 'UINT32', 6: 'INT32', 7: 'UINT64', 8: 'INT64', 9: 'REAL32', 10: 'REAL64',
};
const INTEGER_TYPES = new Set([1, 2, 3, 4, 5, 6, 7, 8]);

// ArduPilot 以 C 轉型（C-cast）方式把參數值放進 float 欄位；整數型別取最接近的整數。
export function normalizeParamValue(value, type) {
  return INTEGER_TYPES.has(type) ? Math.round(value) : value;
}

export class ParamDownloader {
  constructor(send, { quietMs = 1000, listTimeoutMs = 5000, listRetries = 2, readRetries = 3, batchSize = 10 } = {}) {
    this.send = send;
    this.options = { quietMs, listTimeoutMs, listRetries, readRetries, batchSize };
    this.reset();
  }

  reset() {
    this.params = new Map();
    this.byIndex = new Map();
    this.total = null;
    this.duplicates = 0;
    this.readAttempts = new Map();
    this.listAttempts = 0;
    this.state = 'idle';
    this.error = '';
  }

  start(target, now) {
    this.reset();
    this.target = target;
    this.state = 'downloading';
    this.startedAt = now;
    this.lastRx = now;
    this.requestList();
  }

  requestList() {
    this.listAttempts += 1;
    this.send('PARAM_REQUEST_LIST', { target_system: this.target.sysid, target_component: this.target.compid });
  }

  onParamValue(fields, now) {
    const { param_id: name, param_value: raw, param_type: type, param_count: count, param_index: index } = fields;
    if (!name) return;
    if (this.state !== 'downloading') {
      // 下載結束後收到的 PARAM_VALUE（例如寫入後的回覆）只更新已知參數的目前值。
      const known = this.params.get(name);
      if (known) known.value = normalizeParamValue(raw, type);
      return;
    }
    if (count > 0 && count !== 0xffff) this.total = count;
    this.lastRx = now;
    const entry = { name, value: normalizeParamValue(raw, type), type, typeName: PARAM_TYPE_NAMES[type] || `TYPE_${type}`, index };
    if (this.params.has(name)) this.duplicates += 1;
    this.params.set(name, entry);
    if (index !== 0xffff) this.byIndex.set(index, name);
    this.checkDone();
  }

  missingIndexes() {
    if (this.total === null) return [];
    const missing = [];
    for (let i = 0; i < this.total; i += 1) {
      if (!this.byIndex.has(i)) missing.push(i);
    }
    return missing;
  }

  checkDone() {
    if (this.total !== null && this.byIndex.size >= this.total) {
      this.state = 'complete';
    }
  }

  tick(now) {
    if (this.state !== 'downloading') return;
    if (now - this.lastRx < this.options.quietMs) return;
    if (this.total === null) {
      if (now - this.lastRx < this.options.listTimeoutMs) return;
      if (this.listAttempts > this.options.listRetries) {
        this.state = 'failed';
        this.error = '飛控沒有回應參數清單請求。';
        return;
      }
      this.lastRx = now;
      this.requestList();
      return;
    }
    const pending = this.missingIndexes().filter((i) => (this.readAttempts.get(i) || 0) < this.options.readRetries);
    if (pending.length === 0) {
      this.state = this.missingIndexes().length === 0 ? 'complete' : 'incomplete';
      return;
    }
    for (const index of pending.slice(0, this.options.batchSize)) {
      this.readAttempts.set(index, (this.readAttempts.get(index) || 0) + 1);
      this.send('PARAM_REQUEST_READ', {
        target_system: this.target.sysid,
        target_component: this.target.compid,
        param_id: '',
        param_index: index,
      });
    }
    this.lastRx = now;
  }

  summary() {
    return {
      state: this.state,
      received: this.byIndex.size,
      total: this.total,
      missing: this.state === 'downloading' ? [] : this.missingIndexes(),
      duplicates: this.duplicates,
      error: this.error,
    };
  }
}
