param(
    [string]$ProcessName = "MonitoringDaemon",
    [int]$DurationSeconds = 120,
    [int]$IntervalMs = 1000,
    [string]$OutputPath = ""
)

if ($DurationSeconds -le 0) {
    throw "DurationSeconds must be greater than 0."
}

if ($IntervalMs -le 0) {
    throw "IntervalMs must be greater than 0."
}

if ([string]::IsNullOrWhiteSpace($OutputPath)) {
    $OutputPath = Join-Path -Path $PWD -ChildPath ("perf-smoke-{0:yyyyMMdd-HHmmss}.csv" -f (Get-Date))
}

$proc = Get-Process -Name $ProcessName -ErrorAction Stop | Select-Object -First 1
$startCpu = $proc.CPU
$startLines = 0

$today = Get-Date -Format "yyyy-MM-dd"
$appData = [Environment]::GetFolderPath([Environment+SpecialFolder]::ApplicationData)
$dayLogs = Join-Path -Path $appData -ChildPath "Ophanim\DayLogs"
$todayFiles = @()

if (Test-Path $dayLogs) {
    $todayFiles = Get-ChildItem -Path $dayLogs -Filter "$today*.ndjson" -File -ErrorAction SilentlyContinue
    foreach ($f in $todayFiles) {
        $startLines += (Get-Content -Path $f.FullName -ReadCount 0).Count
    }
}

$deadline = (Get-Date).AddSeconds($DurationSeconds)
$rows = New-Object System.Collections.Generic.List[object]

while ((Get-Date) -lt $deadline) {
    Start-Sleep -Milliseconds $IntervalMs

    $p = Get-Process -Id $proc.Id -ErrorAction SilentlyContinue
    if (-not $p) {
        break
    }

    $rows.Add([pscustomobject]@{
        Timestamp = (Get-Date).ToString("o")
        ProcessId = $p.Id
        CPUSeconds = [math]::Round($p.CPU, 3)
        WorkingSetMB = [math]::Round($p.WorkingSet64 / 1MB, 2)
        PrivateMemoryMB = [math]::Round($p.PrivateMemorySize64 / 1MB, 2)
        Threads = $p.Threads.Count
        Handles = $p.HandleCount
    })
}

$endLines = 0
if ($todayFiles.Count -gt 0) {
    foreach ($f in $todayFiles) {
        $endLines += (Get-Content -Path $f.FullName -ReadCount 0).Count
    }
}

$rows | Export-Csv -Path $OutputPath -NoTypeInformation -Encoding UTF8

$endProc = Get-Process -Id $proc.Id -ErrorAction SilentlyContinue
$endCpu = if ($endProc) { $endProc.CPU } else { $startCpu }

"Perf smoke complete"
"CSV: $OutputPath"
"CPU delta (sec): $([math]::Round(($endCpu - $startCpu), 3))"
"NDJSON lines delta: $($endLines - $startLines)"
