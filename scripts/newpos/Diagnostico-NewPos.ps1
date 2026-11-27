<#
  Diagnostico-NewPos.ps1
  ----------------------
  Recoge en la PC de caja todo lo necesario para saber POR QUE falla NewPos
  (NewHotel POS) sin tener que esperar a soporte.

  Modos:
    .\Diagnostico-NewPos.ps1                 -> foto completa (logs, eventos, red) + ZIP en el Escritorio
    .\Diagnostico-NewPos.ps1 -Monitor        -> vigila la conexion cada 60 s y anota cada caida en un CSV
    .\Diagnostico-NewPos.ps1 -Horas 48       -> mira 48 horas hacia atras (por defecto 24)

  Envio al panel (gestor de proyectos):
    -EnviarA https://gestor-proyectos-weld.vercel.app/api/newpos/reportes  -Token XXXX  -Local "Restaurante Centro"
    Cada medicion del monitor (y el resumen de la foto completa) se envia como JSON por POST.
    Si no hay internet, se guarda en una cola local y se reenvia cuando vuelva.
    Tambien se puede dejar configurado en newpos-config.json junto al script:
      { "EnviarA": "https://...", "Token": "XXXX", "Local": "Restaurante Centro" }

  Solo LEE informacion: no cambia nada de NewPos ni de Windows.
#>
param(
    [int]$Horas = 24,
    [switch]$Monitor,
    [int]$Intervalo = 60,
    [string[]]$HostsExtra = @(),
    [string]$EnviarA = '',
    [string]$Token = '',
    [string]$Local = ''
)

# Config por archivo (para no escribir el token en el .bat)
$cfgFile = Join-Path $PSScriptRoot 'newpos-config.json'
if (Test-Path $cfgFile) {
    try {
        $cfg = Get-Content $cfgFile -Raw | ConvertFrom-Json
        if (-not $EnviarA -and $cfg.EnviarA) { $EnviarA = $cfg.EnviarA }
        if (-not $Token   -and $cfg.Token)   { $Token   = $cfg.Token }
        if (-not $Local   -and $cfg.Local)   { $Local   = $cfg.Local }
    } catch { Write-Host "newpos-config.json no es JSON valido: $_" -ForegroundColor Yellow }
}
if (-not $Local) { $Local = $env:COMPUTERNAME }

$ErrorActionPreference = 'Continue'
try { [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12 } catch {}

$Desde   = (Get-Date).AddHours(-$Horas)
$Stamp   = Get-Date -Format 'yyyyMMdd-HHmmss'
$Escrit  = [Environment]::GetFolderPath('Desktop')
$Salida  = Join-Path $Escrit "Diagnostico-NewPos-$Stamp"
$Patron  = 'NewPos|NewHotel|NHPos|NH\.'

function Titulo($t) { Write-Host ""; Write-Host "=== $t ===" -ForegroundColor Cyan }

# ---------------------------------------------------------------- 1. Donde esta NewPos
function Buscar-Carpetas {
    $raices = @($env:ProgramFiles, ${env:ProgramFiles(x86)}, $env:ProgramData,
                $env:LOCALAPPDATA, $env:APPDATA, 'C:\') | Where-Object { $_ -and (Test-Path $_) } | Select-Object -Unique
    $encontradas = @()
    foreach ($r in $raices) {
        $encontradas += Get-ChildItem -Path $r -Directory -ErrorAction SilentlyContinue |
            Where-Object { $_.Name -match $Patron }
        # un nivel mas abajo (ej. Program Files\NewHotel\NewPos)
        $encontradas += Get-ChildItem -Path $r -Directory -ErrorAction SilentlyContinue |
            Where-Object { $_.Name -match $Patron } |
            ForEach-Object { Get-ChildItem $_.FullName -Directory -ErrorAction SilentlyContinue }
    }
    $rutas = @($encontradas | Select-Object -ExpandProperty FullName)
    # Si NewPos esta abierto, su carpeta real sale del proceso (aunque tenga otro nombre)
    Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.ProcessName -match $Patron -and $_.Path } | ForEach-Object {
        $dir = Split-Path $_.Path -Parent
        $rutas += $dir
        $padre = Split-Path $dir -Parent
        if ($padre -and $padre.Length -gt 3 -and $padre -notmatch '\\(Program Files( \(x86\))?|Windows)$') { $rutas += $padre }
    }
    # Excluir la carpeta de este mismo script (C:\NewPosMonitor tambien contiene "NewPos" en el nombre)
    $propia = (Resolve-Path $PSScriptRoot -ErrorAction SilentlyContinue).Path
    $rutas | Where-Object { $_ -and $_ -ne $propia -and -not ($propia -and $_.StartsWith($propia + '\')) } | Select-Object -Unique
}

# ---------------------------------------------------------------- 2. Servidores que usa NewPos
function Buscar-Servidores($carpetas) {
    $urls = @()
    foreach ($c in $carpetas) {
        Get-ChildItem $c -Recurse -Include *.config,*.json,*.xml,*.ini,*.settings -File -ErrorAction SilentlyContinue |
            Where-Object { $_.Length -lt 5MB } | ForEach-Object {
                $txt = Get-Content $_.FullName -Raw -ErrorAction SilentlyContinue
                if ($txt) {
                    [regex]::Matches($txt, 'https?://[A-Za-z0-9\.\-]+(:\d+)?') | ForEach-Object { $urls += $_.Value }
                }
            }
    }
    $hostPanel = ''; if ($EnviarA) { try { $hostPanel = ([Uri]$EnviarA).Host } catch {} }
    $urls | Where-Object { $_ -notmatch 'schemas\.|w3\.org|microsoft\.com|xmlsoap|localhost/schema' -and
                           -not ($hostPanel -and $_ -match [regex]::Escape($hostPanel)) } | Select-Object -Unique
}

# ---------------------------------------------------------------- 3. Probar un servidor
function Probar-Url([string]$url) {
    $r = [ordered]@{ Hora = (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'); Url = $url; DNS = ''; Estado = ''; ms = ''
                     CfRay = ''; AzureRef = ''; Mensaje = ''; Veredicto = '' }
    try {
        $uri = [Uri]$url
        $r.DNS = (([Net.Dns]::GetHostAddresses($uri.Host) | Select-Object -First 1).IPAddressToString)
    } catch {
        $r.DNS = 'FALLA'; $r.Veredicto = 'SIN DNS: problema de internet/red local (no reportar a NewHotel)'
        return [pscustomobject]$r
    }
    $sw = [Diagnostics.Stopwatch]::StartNew()
    $resp = $null
    try {
        $resp = Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 20 -Method Get
    } catch {
        # PowerShell 5.1 lanza WebException; PowerShell 7 lanza HttpResponseException. Ambos traen .Response
        if ($_.Exception.Response) { $resp = $_.Exception.Response }
        else { $r.Mensaje = $_.Exception.Message }
    }
    $sw.Stop(); $r.ms = $sw.ElapsedMilliseconds

    if ($resp) {
        $code = [int]$resp.StatusCode
        $r.Estado = $code
        foreach ($par in @(@('CfRay','Cf-Ray'), @('AzureRef','X-Azure-Ref'))) {
            try { $v = $resp.Headers[$par[1]] } catch { $v = $null }
            if (-not $v) { try { $v = ($resp.Headers.GetValues($par[1]) -join ',') } catch {} }
            $r[$par[0]] = [string]$v
        }
        if (-not $r.Mensaje -and $resp -is [System.Net.HttpWebResponse]) {
            try { $sr = New-Object IO.StreamReader($resp.GetResponseStream()); $r.Mensaje = $sr.ReadToEnd() } catch {}
        } elseif ($resp.Content) { $r.Mensaje = [string]$resp.Content }
        if ($r.Mensaje.Length -gt 300) { $r.Mensaje = $r.Mensaje.Substring(0,300) }
        $r.Veredicto = switch ($code) {
            { $_ -lt 400 }            { 'OK, el servidor responde' }
            { $_ -in 401,403 }        { 'Responde, pide login/permisos (normal si se prueba sin usuario)' }
            404                       { 'Responde (404 = ruta no existe, pero el servidor ESTA vivo)' }
            { $_ -in 502,503,504,520,521,522,523,524 } { 'CAIDO DEL LADO DE NEWHOTEL -> reportar con CfRay/AzureRef' }
            { $_ -ge 500 }            { 'ERROR INTERNO DE NEWHOTEL -> reportar con CfRay/AzureRef y Mensaje' }
            default                   { 'Responde con error de peticion' }
        }
    } else {
        $r.Estado = 'SIN RESPUESTA'
        $r.Veredicto = if ($r.Mensaje -match 'tiempo|timed out|timeout') { 'TIMEOUT: lento/caido o internet saturado' }
                       else { 'NO CONECTA: revisar internet/firewall/antivirus antes de reportar' }
    }
    [pscustomobject]$r
}

# ---------------------------------------------------------------- 3b. Limpiar datos sensibles
# El log de NewPos guarda usuario/contrasena en texto plano: NUNCA se copia ni se envia sin limpiar.
function Limpiar([string]$s, [int]$max = 300) {
    if (-not $s) { return '' }
    $s = [regex]::Replace($s, '(?i)("?(password|pwd|passwd|username|contrase\w*|token|access_token|refresh_token|authorization|publicKey|apikey|secret)"?\s*[:=]\s*"?)[^",\s}]*', '$1***')
    if ($s.Length -gt $max) { $s = $s.Substring(0, $max) + '...' }
    $s
}

# ---------------------------------------------------------------- 3c. Aperturas de NewPos (CloudLog)
# Cada vez que NewPOS arranca hace login en la nube de NewHotel (TWSCloud.Create -> respuesta).
# Convertimos el log en una lista de "aperturas" con su resultado: ok / error_autenticacion / error / sin_respuesta.
function Buscar-CloudLog($carpetas) {
    $c = foreach ($d in $carpetas) { Get-ChildItem $d -Recurse -Filter '*CloudLog*.txt' -File -ErrorAction SilentlyContinue }
    $c | Sort-Object LastWriteTime -Descending | Select-Object -First 1 -ExpandProperty FullName
}
function Cerrar-Apertura($ses) {
    $ses.emitido = $true
    [pscustomobject]@{ hora = $ses.t.ToUniversalTime().ToString('o'); hora_local = $ses.t.ToString('yyyy-MM-dd HH:mm:ss')
                       resultado = $ses.resultado; segundos = $ses.segundos; detalle = $ses.detalle }
}
function Procesar-CloudLog([string[]]$lineas, $estado) {
    $inv = [Globalization.CultureInfo]::InvariantCulture
    $salida = New-Object System.Collections.Generic.List[object]
    foreach ($l in $lineas) {
        $m = [regex]::Match($l, '^(\d{4}/\d\d/\d\d-\d\d:\d\d:\d\d)-\d+ (.*)$')
        if (-not $m.Success) { continue }
        $t = [datetime]::ParseExact($m.Groups[1].Value, 'yyyy/MM/dd-HH:mm:ss', $inv)
        $msg = $m.Groups[2].Value
        if ($msg -match '^TWSCloud\.Create\s*$') {
            if ($estado.ses -and -not $estado.ses.emitido) { $estado.ses.resultado = 'sin_respuesta'; $salida.Add((Cerrar-Apertura $estado.ses)) }
            $estado.ses = @{ t = $t; emitido = $false; resultado = ''; segundos = $null; detalle = '' }
            continue
        }
        $ses = $estado.ses
        if (-not $ses -or $ses.emitido) { continue }
        $res = $null
        if ($msg -match 'autenticaci') {
            $res = 'error_autenticacion'; $ses.detalle = Limpiar $msg 200
        } else {
            $c = [regex]::Match($msg, '^\{"code":(\d+)')
            if ($c.Success) {
                $e = [regex]::Match($msg, '"ElapsedTime":"(\d+):(\d+):([\d\.]+)"')
                if ($e.Success) { $ses.segundos = [math]::Round([int]$e.Groups[1].Value * 3600 + [int]$e.Groups[2].Value * 60 + [double]::Parse($e.Groups[3].Value, $inv), 1) }
                if ($c.Groups[1].Value -eq '200') { $res = 'ok' } else { $res = 'error_http_' + $c.Groups[1].Value; $ses.detalle = Limpiar $msg 300 }
            } else {
                $x = [regex]::Match($msg, '\.Execute\. (.+)$')
                if ($x.Success) { $res = 'error'; $ses.detalle = Limpiar $x.Groups[1].Value 200 }
            }
        }
        if ($res) { $ses.resultado = $res; $salida.Add((Cerrar-Apertura $ses)) }
    }
    $salida
}
# Lee solo lo nuevo del log desde la ultima vez (para el monitor)
function Leer-NuevoCloudLog([string]$ruta, $estado) {
    $fi = Get-Item -LiteralPath $ruta -ErrorAction SilentlyContinue
    if (-not $fi) { return @() }
    if ($null -eq $estado.offset) { $estado.offset = $fi.Length; return @() }   # al arrancar no reenviamos historia
    if ($fi.Length -lt $estado.offset) { $estado.offset = 0; $estado.resto = '' }  # log rotado/borrado
    if ($fi.Length -eq $estado.offset) { return @() }
    $fs = $null
    try {
        $fs = [IO.File]::Open($ruta, 'Open', 'Read', 'ReadWrite')
        [void]$fs.Seek($estado.offset, 'Begin')
        $sr = New-Object IO.StreamReader($fs, [Text.Encoding]::Default)
        $txt = $sr.ReadToEnd()
        $estado.offset = $fs.Position
    } catch { return @() } finally { if ($fs) { $fs.Close() } }
    $partes = ($estado.resto + $txt) -split "`r?`n"
    $estado.resto = $partes[-1]
    if ($partes.Count -le 1) { return @() }
    @(Procesar-CloudLog $partes[0..($partes.Count - 2)] $estado)
}

# ---------------------------------------------------------------- 4. Enviar al panel
$Cola = Join-Path $env:LOCALAPPDATA 'NewPosMonitor\cola.jsonl'
function Enviar-Panel([string]$tipo, $datos) {
    if (-not $EnviarA) { return }
    $obj = [ordered]@{ tipo = $tipo; local = $Local; equipo = $env:COMPUTERNAME
                       enviado = (Get-Date).ToUniversalTime().ToString('o'); datos = $datos }
    $linea = $obj | ConvertTo-Json -Depth 6 -Compress
    $pend = @()
    if (Test-Path $Cola) { $pend = @(Get-Content $Cola -ErrorAction SilentlyContinue | Where-Object { $_ }) }
    $pend += $linea
    $headers = @{}; if ($Token) { $headers['Authorization'] = "Bearer $Token" }
    $quedan = @()
    foreach ($l in $pend) {
        if ($l.Length -gt 240000) { Write-Host '  envio demasiado grande, se descarta' -ForegroundColor DarkYellow; continue }
        try {
            $bytes = [Text.Encoding]::UTF8.GetBytes($l)
            Invoke-RestMethod -Uri $EnviarA -Method Post -Body $bytes -ContentType 'application/json; charset=utf-8' `
                              -Headers $headers -TimeoutSec 15 -UseBasicParsing | Out-Null
        } catch {
            $st = 0; try { $st = [int]$_.Exception.Response.StatusCode } catch {}
            # 4xx = el panel lo rechaza (datos malos/token): reintentar no sirve. 408/429 si se reintentan.
            if ($st -ge 400 -and $st -lt 500 -and $st -notin 408, 429) { Write-Host "  envio rechazado por el panel (HTTP $st), se descarta" -ForegroundColor DarkYellow }
            else { $quedan += $l }
        }
    }
    New-Item -ItemType Directory (Split-Path $Cola) -Force | Out-Null
    # maximo 5000 pendientes para no llenar el disco
    $quedan | Select-Object -Last 5000 | Set-Content $Cola -Encoding UTF8
    if ($quedan.Count) { Write-Host "  ($($quedan.Count) envios en cola, se reintentan)" -ForegroundColor DarkYellow }
}

# ================================================================ MODO MONITOR
if ($Monitor) {
    # Evita dos monitores a la vez (por ejemplo, el oculto + uno abierto a mano)
    $mtx = New-Object System.Threading.Mutex($false, 'Local\NewPosMonitor')
    if (-not $mtx.WaitOne(0)) { Write-Host 'El monitor ya esta corriendo en esta PC. Para pararlo: Detener-Monitor.bat' -ForegroundColor Yellow; Start-Sleep 5; exit }
    $carpetas = Buscar-Carpetas
    $hosts = @(Buscar-Servidores $carpetas) + $HostsExtra + @('https://api-am.newhotelcloud.com/', 'https://www.google.com/') |
             Where-Object { $_ } | Select-Object -Unique
    $csv = Join-Path $Escrit 'Monitor-NewPos.csv'
    Write-Host "Vigilando cada $Intervalo s. Registro en: $csv  (Ctrl+C para parar)" -ForegroundColor Green
    if ($EnviarA) { Write-Host "Enviando al panel: $EnviarA  (local: $Local)" -ForegroundColor Green }
    $hosts | ForEach-Object { Write-Host "  - $_" }
    $cloudLog = Buscar-CloudLog $carpetas
    $estadoLog = @{ offset = $null; resto = ''; ses = $null }
    if ($cloudLog) { Write-Host "Leyendo aperturas de NewPOS en: $cloudLog" -ForegroundColor Green; [void](Leer-NuevoCloudLog $cloudLog $estadoLog) }
    while ($true) {
        $ronda = @()
        foreach ($h in $hosts) {
            $p = Probar-Url $h
            $p | Export-Csv $csv -Append -NoTypeInformation -Encoding UTF8
            $color = if ($p.Veredicto -match 'CAIDO|ERROR|NO CONECTA|TIMEOUT|SIN DNS') { 'Red' } else { 'DarkGray' }
            Write-Host ("{0}  {1,-45} {2,-14} {3,6}ms  {4}" -f $p.Hora, $h, $p.Estado, $p.ms, $p.Veredicto) -ForegroundColor $color
            $ronda += $p
        }
        $np = @(Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.ProcessName -match $Patron -and $_.Path })
        if (-not $cloudLog) { $cloudLog = Buscar-CloudLog (Buscar-Carpetas) }
        $aperturas = @(); if ($cloudLog) { $aperturas = @(Leer-NuevoCloudLog $cloudLog $estadoLog) }
        foreach ($a in $aperturas) {
            $col = if ($a.resultado -eq 'ok') { 'Green' } else { 'Red' }
            Write-Host ("  Apertura NewPOS {0}: {1} {2}" -f $a.hora_local, $a.resultado, $a.detalle) -ForegroundColor $col
        }
        # La carpeta de NewPOS (ej. U:) sigue accesible? Si es unidad de red y se cae, NewPOS falla.
        $dirNP = if ($np) { Split-Path $np[0].Path -Parent } elseif ($cloudLog) { Split-Path $cloudLog -Parent } else { $null }
        $unidadOk = if ($dirNP) { Test-Path -LiteralPath $dirNP } else { $null }
        Enviar-Panel 'medicion' @{ pruebas = $ronda; newpos_abierto = ($np.Count -gt 0)
                                   newpos_ram_mb = [math]::Round((($np | Measure-Object WorkingSet64 -Sum).Sum)/1MB)
                                   newpos_aperturas = $aperturas; unidad_newpos = $dirNP; unidad_newpos_ok = $unidadOk }
        Start-Sleep -Seconds $Intervalo
    }
}

# ================================================================ MODO FOTO COMPLETA
New-Item -ItemType Directory -Path $Salida -Force | Out-Null
Start-Transcript -Path (Join-Path $Salida '00-resumen-consola.txt') | Out-Null

Titulo 'Equipo'
$os = Get-CimInstance Win32_OperatingSystem -ErrorAction SilentlyContinue
[pscustomobject]@{
    Equipo = $env:COMPUTERNAME; Usuario = $env:USERNAME; Windows = $os.Caption; Version = $os.Version
    Encendido_desde = $os.LastBootUpTime; RAM_libre_MB = [math]::Round($os.FreePhysicalMemory/1KB)
    Disco_C_libre_GB = [math]::Round((Get-PSDrive C).Free/1GB,1)
} | Format-List | Out-String | Tee-Object (Join-Path $Salida '01-equipo.txt') | Write-Host

Titulo 'Instalacion de NewPos'
$carpetas = @(Buscar-Carpetas)
if (-not $carpetas) { Write-Host 'No se encontro carpeta con NewPos/NewHotel. Ejecuta de nuevo indicando -HostsExtra.' -ForegroundColor Yellow }
$carpetas | Tee-Object (Join-Path $Salida '02-carpetas.txt') | Write-Host
Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.ProcessName -match $Patron } |
    Select-Object ProcessName, Id, StartTime, @{n='RAM_MB';e={[math]::Round($_.WorkingSet64/1MB)}}, Path |
    Format-Table -AutoSize | Out-String | Tee-Object (Join-Path $Salida '03-procesos.txt') | Write-Host
$exeNP = Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.ProcessName -match $Patron -and $_.Path } | Select-Object -First 1 -ExpandProperty Path
if ($exeNP) {
    $letra = (Split-Path $exeNP -Qualifier)
    $disco = Get-CimInstance Win32_LogicalDisk -Filter "DeviceID='$letra'" -ErrorAction SilentlyContinue
    $tipo = switch ($disco.DriveType) { 2 {'USB/extraible'} 3 {'disco local'} 4 {'UNIDAD DE RED'} default {"tipo $($disco.DriveType)"} }
    Write-Host ("  NewPOS se ejecuta desde {0} -> {1} {2}" -f $exeNP, $tipo, $disco.ProviderName) -ForegroundColor Yellow
    ("NewPOS: $exeNP", "Unidad $letra : $tipo $($disco.ProviderName)", '', (net use 2>&1 | Out-String)) | Set-Content (Join-Path $Salida '04b-unidad-newpos.txt')
}
Get-Service -ErrorAction SilentlyContinue | Where-Object { $_.Name -match $Patron -or $_.DisplayName -match $Patron } |
    Format-Table Name, DisplayName, Status, StartType -AutoSize | Out-String |
    Tee-Object (Join-Path $Salida '04-servicios.txt') | Write-Host

Titulo "Logs de NewPos modificados en las ultimas $Horas h"
$logsDir = Join-Path $Salida 'logs-newpos'; New-Item -ItemType Directory $logsDir -Force | Out-Null
$logs = foreach ($c in $carpetas) {
    Get-ChildItem $c -Recurse -Include *.log,*.txt,*.err,*.trace -File -ErrorAction SilentlyContinue |
        Where-Object { $_.LastWriteTime -ge $Desde -and $_.Length -lt 50MB }
}
$logs | Select-Object -Unique FullName, LastWriteTime, Length | ForEach-Object {
    Write-Host ("  {0}  {1}  ({2:N1} MB)" -f $_.LastWriteTime, $_.FullName, ($_.Length / 1MB))
    # Solo las ultimas 3000 lineas, recortadas y SIN contrasenas (el log original las tiene en texto plano)
    Get-Content -LiteralPath $_.FullName -Tail 3000 -Encoding Default -ErrorAction SilentlyContinue |
        ForEach-Object { Limpiar $_ 500 } |
        Set-Content (Join-Path $logsDir ((($_.FullName -replace '[:\\]', '_')) + '.limpio.txt')) -Encoding UTF8
}
# Lineas con errores dentro de los logs
$lineasErr = foreach ($l in $logs) {
    Select-String -LiteralPath $l.FullName -Pattern 'error|exception|excepci|fail|timeout|refused|denied|autenticaci' -ErrorAction SilentlyContinue |
        Where-Object { $_.Line -notmatch 'GetResponseErrors' -and $_.Line -notmatch '^\S+ \{"code":200' } |
        Select-Object @{n='Archivo';e={$_.Filename}}, LineNumber, @{n='Linea';e={ Limpiar $_.Line.Trim() 300 }}
}
$lineasErr | Export-Csv (Join-Path $Salida '05-lineas-con-error.csv') -NoTypeInformation -Encoding UTF8
Write-Host ("  {0} lineas con error/excepcion (ver 05-lineas-con-error.csv)" -f @($lineasErr).Count)
$lineasErr | Select-Object -Last 15 | Format-Table -Wrap | Out-String | Write-Host

Titulo "Aperturas de NewPOS (login en la nube) ultimas $Horas h"
$aperturasDiag = @()
$cloudLog = Buscar-CloudLog $carpetas
if ($cloudLog) {
    $todas = @(Procesar-CloudLog (Get-Content -LiteralPath $cloudLog -Tail 40000 -Encoding Default -ErrorAction SilentlyContinue) @{ ses = $null })
    $aperturasDiag = @($todas | Where-Object { [datetime]::ParseExact($_.hora_local, 'yyyy-MM-dd HH:mm:ss', [Globalization.CultureInfo]::InvariantCulture) -ge $Desde })
    $aperturasDiag | Export-Csv (Join-Path $Salida '09-aperturas-newpos.csv') -NoTypeInformation -Encoding UTF8
    $todas | Export-Csv (Join-Path $Salida '09b-aperturas-historico.csv') -NoTypeInformation -Encoding UTF8
    $aperturasDiag | Group-Object resultado | Format-Table Name, Count -AutoSize | Out-String | Write-Host
    $aperturasDiag | Where-Object resultado -ne 'ok' | Select-Object -Last 10 | Format-Table hora_local, resultado, detalle -AutoSize -Wrap | Out-String | Write-Host
} else { Write-Host '  No se encontro NewPos_CloudLog.txt' -ForegroundColor Yellow }

Titulo "Visor de eventos de Windows (ultimas $Horas h)"
$eventos = Get-WinEvent -FilterHashtable @{ LogName = 'Application'; Level = 1,2,3; StartTime = $Desde } -ErrorAction SilentlyContinue |
    Where-Object { $_.ProviderName -match '\.NET Runtime|Application Error|Application Hang|Windows Error Reporting' -or $_.Message -match $Patron }
$eventos | Select-Object TimeCreated, ProviderName, Id, LevelDisplayName, Message |
    Export-Csv (Join-Path $Salida '06-eventos-windows.csv') -NoTypeInformation -Encoding UTF8
Write-Host ("  {0} eventos de error/cierre (ver 06-eventos-windows.csv)" -f @($eventos).Count)
$eventos | Select-Object -First 5 | ForEach-Object {
    Write-Host ("--- {0}  [{1}]" -f $_.TimeCreated, $_.ProviderName) -ForegroundColor Yellow
    $m = $_.Message; if ($m.Length -gt 800) { $m = $m.Substring(0,800) + ' ...' }; Write-Host $m
}

Titulo 'Servidores que usa NewPos y prueba de conexion'
$hosts = @(Buscar-Servidores $carpetas) + $HostsExtra + @('https://api-am.newhotelcloud.com/', 'https://www.google.com/') |
         Where-Object { $_ } | Select-Object -Unique
$pruebas = $hosts | ForEach-Object { Probar-Url $_ }
$pruebas | Export-Csv (Join-Path $Salida '07-conexion.csv') -NoTypeInformation -Encoding UTF8
$pruebas | Format-Table Url, DNS, Estado, ms, Veredicto -AutoSize -Wrap | Out-String | Write-Host
Get-NetAdapter -ErrorAction SilentlyContinue | Where-Object Status -eq 'Up' |
    Format-Table Name, InterfaceDescription, LinkSpeed -AutoSize | Out-String | Tee-Object (Join-Path $Salida '08-red.txt') | Write-Host

Titulo 'Conclusion rapida'
$google = $pruebas | Where-Object Url -match 'google'
$nh     = $pruebas | Where-Object Url -notmatch 'google'
if ($google -and $google.Veredicto -notmatch '^OK') {
    Write-Host 'Ni Google responde: EL PROBLEMA ES EL INTERNET DE LA PC, no NewHotel.' -ForegroundColor Red
} elseif ($nh | Where-Object Veredicto -match 'CAIDO|ERROR INTERNO') {
    Write-Host 'Internet OK pero NewHotel devuelve error de servidor: REPORTAR, adjuntando el ZIP (incluye CfRay/AzureRef).' -ForegroundColor Red
} elseif ($nh | Where-Object Veredicto -match 'NO CONECTA|TIMEOUT|SIN DNS') {
    Write-Host 'Internet OK pero no se llega a un servidor de NewHotel: revisar firewall/antivirus/proxy; si persiste, reportar.' -ForegroundColor Yellow
} elseif ($aperturasDiag | Where-Object resultado -eq 'error_autenticacion') {
    Write-Host 'NewPOS NO PUDO INICIAR SESION en la nube de NewHotel (Error de autenticacion). Internet OK. Ver 09-aperturas-newpos.csv: horas exactas para reportar.' -ForegroundColor Red
} elseif (@($eventos).Count -gt 0 -or @($lineasErr).Count -gt 0) {
    Write-Host 'La red esta bien: el fallo esta en el programa (ver eventos y lineas de error). Mira 05 y 06 antes de reportar.' -ForegroundColor Yellow
} else {
    Write-Host 'Todo responde ahora mismo. Ejecuta esto JUSTO cuando salga el error, o deja corriendo -Monitor.' -ForegroundColor Green
}

Stop-Transcript | Out-Null
Enviar-Panel 'diagnostico' @{
    pruebas = $pruebas
    eventos = @($eventos | Select-Object -First 20 | ForEach-Object {
        @{ hora = $_.TimeCreated.ToString('o'); fuente = $_.ProviderName; id = $_.Id
           mensaje = $(if ($_.Message.Length -gt 1500) { $_.Message.Substring(0,1500) } else { $_.Message }) } })
    lineas_error = @($lineasErr | Select-Object -Last 30 | ForEach-Object { "$($_.Archivo):$($_.LineNumber) $($_.Linea)" })
    total_eventos = @($eventos).Count; total_lineas_error = @($lineasErr).Count
    aperturas_newpos = @($aperturasDiag | Select-Object -Last 100)
    newpos_exe = $exeNP
}
$zip = "$Salida.zip"
Compress-Archive -Path "$Salida\*" -DestinationPath $zip -Force
Write-Host ""
Write-Host "Listo. Todo quedo en: $zip" -ForegroundColor Green
