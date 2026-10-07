# Instala o WarmUp Studio num aparelho novo (vai para o bucket publico "downloads" pelo npm run publicar).
# Mensagens sem acento: o PowerShell do Windows le o script baixado como ANSI.
# Uso, no PowerShell do aparelho novo:
#   irm https://cuuuudyjqjyeqvvfqtkl.supabase.co/storage/v1/object/public/downloads/instalar.ps1 | iex
# Baixa as partes do instalador, confere cada uma (SHA-256), junta e abre o instalador.
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$base = 'https://cuuuudyjqjyeqvvfqtkl.supabase.co/storage/v1/object/public/downloads'
$m = Invoke-RestMethod "$base/latest.json?t=$([DateTimeOffset]::Now.ToUnixTimeSeconds())"
Write-Host "WarmUp Studio $($m.version): baixando $([math]::Round($m.size / 1MB)) MB..."
$dir = Join-Path $env:TEMP 'warmup-studio-instalar'
New-Item -ItemType Directory -Force $dir | Out-Null
$exe = Join-Path $dir $m.file
$out = [IO.File]::Create($exe)
try {
  foreach ($p in $m.parts) {
    $tmp = Join-Path $dir $p.name
    Invoke-WebRequest "$base/$($p.name)" -OutFile $tmp -UseBasicParsing
    if ((Get-FileHash $tmp -Algorithm SHA256).Hash.ToLower() -ne $p.sha256) { throw "A parte $($p.name) chegou corrompida. Rode de novo." }
    $bytes = [IO.File]::ReadAllBytes($tmp)
    $out.Write($bytes, 0, $bytes.Length)
    Remove-Item $tmp
    Write-Host "  $($p.name) ok"
  }
} finally { $out.Close() }
if ((Get-FileHash $exe -Algorithm SHA256).Hash.ToLower() -ne $m.sha256) { throw 'O instalador baixado nao confere. Rode de novo.' }
Write-Host 'Abrindo o instalador. Se o Windows avisar "editor desconhecido": Mais informacoes > Executar assim mesmo.'
Start-Process $exe
