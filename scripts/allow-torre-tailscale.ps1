# A TORRE - regra de firewall: permite entrada TCP 7777 SOMENTE da rede
# Tailscale (100.64.0.0/10), perfil Any (interface Tailscale e Private).
# Idempotente: remove regra anterior de mesmo nome antes de recriar.
# Rodar elevado. Kill-switch: Remove-NetFirewallRule -DisplayName "A TORRE (7777) via Tailscale"
$name = "A TORRE (7777) via Tailscale"
Remove-NetFirewallRule -DisplayName $name -ErrorAction SilentlyContinue
New-NetFirewallRule -DisplayName $name `
  -Direction Inbound -Action Allow -Protocol TCP -LocalPort 7777 `
  -RemoteAddress 100.64.0.0/10 -Profile Any `
  -Program "C:\program files\nodejs\node.exe" | Out-Null
$ok = Get-NetFirewallRule -DisplayName $name -ErrorAction SilentlyContinue
if ($ok) { Write-Output "OK: regra '$name' criada" } else { Write-Output "FALHA ao criar regra"; exit 1 }
