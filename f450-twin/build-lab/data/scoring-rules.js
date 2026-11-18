// 組裝實訓室｜考試計分規則（P4）
//
// 分數只依「確定性規則判定的錯誤」扣分，AI 不參與計分。扣分與及格線是教學草案，
// 狀態 PENDING_MANUAL：教師確認後才可作為正式成績；正式 PASS／NG 仍以教師覆核為準。
export const SCORING_RULES = Object.freeze({
  version: 'BL-SCORE-v1',
  status: 'PENDING_MANUAL',
  full: 100,
  passScore: 80,
  // 組裝錯誤（assembly-engine 的錯誤代碼）
  assembly: {
    MISSING_DEPENDENCY: 2,   // 順序錯誤
    POSITION: 1,             // 拖放位置不準
    HAS_DEPENDENTS: 1,       // 拆卸順序錯誤
  },
  // 接線錯誤依嚴重度扣分（wiring-rules 的 severity）
  wiringSeverity: {
    warn: 3,
    danger: 8,
    critical: 15,
  },
  // 只要犯過一次「嚴重危險」（例如主電池直接接飛控），不論分數一律不及格
  criticalFails: true,
});
