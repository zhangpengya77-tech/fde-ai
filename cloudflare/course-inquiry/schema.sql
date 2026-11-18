-- FDE-AI 課程報名諮詢（V4.1）D1 資料表。與學員資料庫完全分開，只存必要欄位。
CREATE TABLE IF NOT EXISTS inquiries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at TEXT NOT NULL,              -- ISO 8601（UTC）
  name TEXT NOT NULL,
  email TEXT NOT NULL DEFAULT '',
  contact TEXT NOT NULL DEFAULT '',      -- 手機或 LINE ID
  course TEXT NOT NULL,
  format TEXT NOT NULL DEFAULT '',
  message TEXT NOT NULL DEFAULT '',
  is_minor INTEGER NOT NULL DEFAULT 0,
  guardian_consent INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'new',    -- new／contacted／done／closed
  note TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_inquiries_created ON inquiries (created_at);

-- 限流：只存 IP 的加鹽雜湊與時間，不存 IP 原文
CREATE TABLE IF NOT EXISTS rate_hits (
  ip_hash TEXT NOT NULL,
  at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_rate_hits ON rate_hits (ip_hash, at);

-- 後台操作紀錄
CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at TEXT NOT NULL,
  actor TEXT NOT NULL,                   -- Cloudflare Access 驗證過的 Email
  action TEXT NOT NULL,                  -- view／update／purge
  inquiry_id INTEGER,
  detail TEXT NOT NULL DEFAULT ''
);
