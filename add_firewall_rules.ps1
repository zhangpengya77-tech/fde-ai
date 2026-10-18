# FDE-AI-UAS 手機預覽防火牆規則
# 此腳本需要管理員權限執行（由 start_fde_mobile_preview.bat 自動提權呼叫）

$ErrorActionPreference = "SilentlyContinue"

$rules = @(
  @{ Name = "FDE-AI-UAS 主站 TCP 8080"; Port = 8080 },
  @{ Name = "FDE Flight Health API TCP 8040"; Port = 8040 }
)

foreach ($rule in $rules) {
  $existing = Get-NetFirewallRule -DisplayName $rule.Name 2>$null
  if ($existing) {
    Write-Host "[已存在] $($rule.Name)" -ForegroundColor Cyan
  } else {
    try {
      New-NetFirewallRule `
        -DisplayName $rule.Name `
        -Direction Inbound `
        -Protocol TCP `
        -LocalPort $rule.Port `
        -Action Allow `
        -Profile Any `
        -Description "FDE-AI-UAS 手機 LAN 預覽開發用途，可手動刪除" | Out-Null
      Write-Host "[已新增] $($rule.Name) - Port $($rule.Port)" -ForegroundColor Green
    } catch {
      Write-Host "[失敗] 無法新增規則 $($rule.Name)：$_" -ForegroundColor Red
      Write-Host "請以系統管理員身份執行此腳本。" -ForegroundColor Yellow
    }
  }
}

Write-Host ""
Write-Host "防火牆設定完成。" -ForegroundColor Green
Start-Sleep -Seconds 2
