// 真機參數寫入（P3）。這是整個 FDE-GCS 唯一能送出 PARAM_SET 的地方。
// 寫入前必須全部通過：已上鎖、連線正常、白名單與範圍、拆槳斷電聲明、教師批准（未過期、同一台飛控、原值未變）、二次確認。
// 寫入後一定讀回比對；沒有回覆時以 PARAM_REQUEST_READ 依名稱補讀一次；不會自動重送 PARAM_SET。
import { PARAM_WRITE_CAPABILITY, encodeMessage } from './codec.js';

const GCS_SYSID = 255;
const GCS_COMPID = 190;

export class WriteBlockedError extends Error {
  constructor(checks) {
    super(`寫入條件未通過：${checks.filter((c) => !c.ok).map((c) => c.label).join('、')}`);
    this.checks = checks;
  }
}

// 與伺服器 allowlist.py 相同的規則（伺服器在建立申請時也會檢查一次）。
// isRevert：改回某筆已寫入申請的原值，只檢查白名單與範圍，不套用單次幅度限制（伺服器規則相同）。
export function validateChange(allowlist, name, oldValue, newValue, isRevert = false) {
  const rule = allowlist && allowlist.params[name];
  if (!rule) return [`${name} 不在可修改的白名單內。`];
  if (![oldValue, newValue].every((v) => typeof v === 'number' && Number.isFinite(v))) return ['數值不是有效數字。'];
  const errors = [];
  if (newValue < rule.min || newValue > rule.max) errors.push(`新值必須在 ${rule.min}～${rule.max} 之間。`);
  if (newValue === oldValue) errors.push('新值和原值相同，不需要寫入。');
  const reference = Math.max(Math.abs(oldValue), rule.max * 0.1);
  if (!isRevert && Math.abs(newValue - oldValue) > reference * allowlist.max_step_ratio + 1e-12) {
    errors.push(`單次修改幅度不得超過 ${Math.round(allowlist.max_step_ratio * 100)}%。`);
  }
  return errors;
}

export function readbackMatches(expected, actual) {
  return typeof actual === 'number' && Number.isFinite(actual)
    && Math.abs(actual - expected) <= Math.max(1e-6, Math.abs(expected) * 1e-5);
}

export function evaluateWriteChecks({ link, request, allowlist, safetyAckNow, confirmed, now = Date.now() }) {
  const vehicle = link && link.telemetry.vehicle;
  const state = link ? link.linkState() : 'disconnected';
  const entry = link && request ? link.params.params.get(request.param_name) : null;
  const expires = request && request.approval_expires_at ? Date.parse(request.approval_expires_at) : 0;
  const ruleErrors = request
    ? validateChange(allowlist, request.param_name, request.old_value, request.new_value, Boolean(request.revert_of))
    : ['沒有申請'];
  return [
    { key: 'disarmed', label: '飛控已上鎖（Disarmed）', ok: Boolean(vehicle) && state === 'ok' && link.telemetry.armed === false },
    { key: 'link', label: 'USB 連線正常', ok: state === 'ok' },
    { key: 'allowlist', label: '參數在白名單與安全範圍內', ok: ruleErrors.length === 0, detail: ruleErrors.join(' ') },
    { key: 'safety', label: '已拆下螺旋槳、已斷開動力電池', ok: safetyAckNow === true && Boolean(request && request.safety_ack) },
    {
      key: 'approval',
      label: '教師已批准（10 分鐘內有效、同一台飛控、原值未變）',
      ok: Boolean(request) && request.status === 'APPROVED' && expires > now
        && Boolean(vehicle) && request.vehicle_sysid === vehicle.sysid
        && Boolean(entry) && readbackMatches(request.old_value, entry.value),
    },
    { key: 'confirmed', label: '已再次確認原值與新值', ok: confirmed === true },
  ];
}

function waitForParam(link, name, timeoutMs, timers) {
  return new Promise((resolve) => {
    const listener = (fields) => {
      if (fields.param_id !== name) return;
      link.paramListeners.delete(listener);
      timers.clearTimeout(timer);
      resolve(fields);
    };
    const timer = timers.setTimeout(() => {
      link.paramListeners.delete(listener);
      resolve(null);
    }, timeoutMs);
    link.paramListeners.add(listener);
  });
}

export async function writeApprovedParam({ link, request, allowlist, safetyAckNow, confirmed, now = Date.now(), timeoutMs = 3000, timers = globalThis }) {
  const checks = evaluateWriteChecks({ link, request, allowlist, safetyAckNow, confirmed, now });
  if (!checks.every((c) => c.ok)) throw new WriteBlockedError(checks);
  const { sysid, compid } = link.telemetry.vehicle;
  const entry = link.params.params.get(request.param_name);
  const frame = encodeMessage(
    'PARAM_SET',
    { target_system: sysid, target_component: compid, param_id: request.param_name, param_value: request.new_value, param_type: entry.type },
    { seq: link.nextSeq(), sysid: GCS_SYSID, compid: GCS_COMPID },
    PARAM_WRITE_CAPABILITY,
  );
  let reply = waitForParam(link, request.param_name, timeoutMs, timers);
  await link.writeFrame(frame, 'PARAM_SET');
  let fields = await reply;
  if (!fields && link.connected) {
    reply = waitForParam(link, request.param_name, timeoutMs, timers);
    link.send('PARAM_REQUEST_READ', { target_system: sysid, target_component: compid, param_id: request.param_name, param_index: -1 });
    fields = await reply;
  }
  if (!fields) {
    return { success: false, readback: null, message: '飛控沒有回覆，無法確認寫入結果；請重新讀取參數確認。' };
  }
  const readback = fields.param_value;
  const success = readbackMatches(request.new_value, readback);
  return {
    success,
    readback,
    message: success ? '寫入成功，讀回值一致。' : `讀回值 ${readback} 與新值 ${request.new_value} 不一致。`,
  };
}
