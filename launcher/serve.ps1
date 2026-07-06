# Anonimizator - minimalny lokalny serwer HTTP (bez instalacji, bez uprawnien administratora).
# Serwuje pliki z folderu skryptu na http://127.0.0.1:<port> i otwiera przegladarke.
#
# Po co: model AI (ONNX/WASM) nie moze byc ladowany z file:// - przegladarki blokuja
# fetch dla plikow otwartych z dysku. Ten serwer NICZEGO nie wystawia do internetu:
# nasluchuje wylacznie na petli lokalnej 127.0.0.1, a tekst i tak nie opuszcza przegladarki.
#
# Uwaga techniczna: uzywamy TcpListener (zwykly socket), a NIE HttpListener - ten drugi
# wymaga rezerwacji URL/uprawnien administratora, ktorych zwykly uzytkownik nie ma.
# Plik celowo bez polskich znakow diakrytycznych: PowerShell 5.1 czyta .ps1 bez BOM jako ANSI.

param([switch]$NoBrowser)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path

$mime = @{
  '.html' = 'text/html; charset=utf-8'
  '.js'   = 'text/javascript; charset=utf-8'
  '.mjs'  = 'text/javascript; charset=utf-8'
  '.css'  = 'text/css; charset=utf-8'
  '.json' = 'application/json'
  '.wasm' = 'application/wasm'
  '.onnx' = 'application/octet-stream'
  '.bin'  = 'application/octet-stream'
  '.png'  = 'image/png'
  '.jpg'  = 'image/jpeg'
  '.svg'  = 'image/svg+xml'
  '.ico'  = 'image/x-icon'
  '.txt'  = 'text/plain; charset=utf-8'
  '.map'  = 'application/json'
}

$listener = $null
$port = 0
foreach ($p in 8123..8143) {
  try {
    $cand = New-Object System.Net.Sockets.TcpListener ([System.Net.IPAddress]::Loopback, $p)
    $cand.Start()
    $listener = $cand
    $port = $p
    break
  } catch { }
}
if (-not $listener) {
  Write-Host 'Nie udalo sie otworzyc zadnego portu z zakresu 8123-8143.'
  Write-Host 'Zamknij inne kopie Anonimizatora i sprobuj ponownie.'
  exit 1
}

$url = "http://127.0.0.1:$port/"
Write-Host ''
Write-Host "  Anonimizator dziala pod adresem: $url"
Write-Host '  Nasluch tylko na tym komputerze (127.0.0.1) - nic nie wychodzi do sieci.'
Write-Host '  Zamknij to okno, aby zatrzymac aplikacje.'
Write-Host ''
if (-not $NoBrowser) { Start-Process $url }

function Send-Response {
  param($stream, [int]$code, [string]$codeText, [string]$type, [byte[]]$body, [bool]$headOnly)
  $len = if ($null -ne $body) { $body.Length } else { 0 }
  $header = "HTTP/1.1 $code $codeText`r`nContent-Type: $type`r`nContent-Length: $len`r`nCache-Control: no-cache`r`nConnection: close`r`n`r`n"
  $hb = [System.Text.Encoding]::ASCII.GetBytes($header)
  $stream.Write($hb, 0, $hb.Length)
  if (-not $headOnly -and $len -gt 0) { $stream.Write($body, 0, $len) }
}

function Send-File {
  param($stream, [string]$path, [string]$type, [bool]$headOnly)
  $fi = New-Object System.IO.FileInfo $path
  $header = "HTTP/1.1 200 OK`r`nContent-Type: $type`r`nContent-Length: $($fi.Length)`r`nCache-Control: no-cache`r`nConnection: close`r`n`r`n"
  $hb = [System.Text.Encoding]::ASCII.GetBytes($header)
  $stream.Write($hb, 0, $hb.Length)
  if ($headOnly) { return }
  $fs = [System.IO.File]::OpenRead($path)
  try {
    $buf = New-Object byte[] 1048576
    while (($n = $fs.Read($buf, 0, $buf.Length)) -gt 0) { $stream.Write($buf, 0, $n) }
  } finally { $fs.Close() }
}

$notFound = [System.Text.Encoding]::UTF8.GetBytes('404 - nie znaleziono pliku')

while ($true) {
  $client = $null
  try {
    $client = $listener.AcceptTcpClient()
    $client.ReceiveTimeout = 5000
    $stream = $client.GetStream()
    $reader = New-Object System.IO.StreamReader ($stream, [System.Text.Encoding]::ASCII, $false, 4096, $true)
    $requestLine = $reader.ReadLine()
    if ($requestLine) {
      while ($true) {
        $h = $reader.ReadLine()
        if ($null -eq $h -or $h -eq '') { break }
      }
      $parts = $requestLine -split ' '
      $method = $parts[0]
      $rawPath = $parts[1]
      $path = [Uri]::UnescapeDataString(($rawPath -split '\?')[0])
      if ($path -eq '/') { $path = '/index.html' }
      $headOnly = ($method -eq 'HEAD')

      $full = [System.IO.Path]::GetFullPath((Join-Path $root ($path -replace '/', '\')))
      $ext = [System.IO.Path]::GetExtension($full).ToLowerInvariant()
      $type = if ($mime.ContainsKey($ext)) { $mime[$ext] } else { 'application/octet-stream' }

      if (-not $full.StartsWith($root, [StringComparison]::OrdinalIgnoreCase)) {
        Send-Response $stream 403 'Forbidden' 'text/plain' $null $headOnly
      } elseif (Test-Path -LiteralPath $full -PathType Leaf) {
        Send-File $stream $full $type $headOnly
      } else {
        Send-Response $stream 404 'Not Found' 'text/plain; charset=utf-8' $notFound $headOnly
      }
    }
  } catch { }
  finally { if ($client) { $client.Close() } }
}
