# Measures the running app's CPU, memory and GPU use against the idle budget: the app
# process plus every WebView2 process it started, sampled over a fixed window.
#
#   pnpm measure:idle                                # 120 s, 5 s samples
#   pnpm measure:idle -Duration 300 -Label "hiyori, cursor away"
#
# Budget: CPU (CPU seconds per wall second over the whole tree) at most 3% of the machine
# and at most 25% of one core, so it still means something on small CPUs; the peak summed
# private working set under 300 MB (shared WebView2 pages are not counted). GPU time and
# dedicated video memory are reported but not budgeted.
#
# Start the app (ideally a release build, `pnpm tauri build --no-bundle`; never distribute
# it), let it settle, close the settings window, then run this. Windows PowerShell 5.1+.

[CmdletBinding()]
param(
  [int]$Duration = 120,
  [int]$Interval = 5,
  [string]$ProcessName = "itsumo-desk",
  [string]$Label = "",
  [double]$MachineCpuBudget = 3,
  [double]$CoreCpuBudget = 25,
  [double]$MemoryBudgetMb = 300
)

$ErrorActionPreference = "Stop"

if ($Interval -lt 1 -or $Duration -lt (2 * $Interval)) {
  throw "Duration must be at least two intervals (got -Duration $Duration -Interval $Interval)."
}

$logicalCpus = [Environment]::ProcessorCount
$mb = 1MB

# Perf counters (unlike Get-Process) carry the parent PID and the private working set, and
# the GPU counters are keyed by PID. WQL `_` is a wildcard, harmless for these names.
function Get-Tree {
  $rows = Get-CimInstance Win32_PerfRawData_PerfProc_Process `
    -Filter "Name LIKE '$ProcessName%' OR Name LIKE 'msedgewebview2%'"
  $byParent = @{}
  foreach ($row in $rows) {
    $parent = [int]$row.CreatingProcessID
    if (-not $byParent.ContainsKey($parent)) { $byParent[$parent] = @() }
    $byParent[$parent] += $row
  }
  $roots = @($rows | Where-Object { $_.Name -eq $ProcessName -or $_.Name -like "$ProcessName#*" })
  $tree = @{}
  $queue = New-Object System.Collections.Queue
  foreach ($root in $roots) { $queue.Enqueue($root) }
  while ($queue.Count -gt 0) {
    $row = $queue.Dequeue()
    $id = [int]$row.IDProcess
    if ($tree.ContainsKey($id)) { continue }
    $tree[$id] = $row
    if ($byParent.ContainsKey($id)) {
      foreach ($child in $byParent[$id]) { $queue.Enqueue($child) }
    }
  }
  $tree
}

function Get-Role([int]$id, [string]$name) {
  if ($name -notlike "msedgewebview2*") { return "app" }
  $proc = Get-CimInstance Win32_Process -Filter "ProcessId = $id" -ErrorAction SilentlyContinue
  if ($null -eq $proc -or $null -eq $proc.CommandLine) { return "webview" }
  if ($proc.CommandLine -match "--type=([\w-]+)") {
    $type = $Matches[1]
    if ($type -eq "utility" -and $proc.CommandLine -match "--utility-sub-type=[\w]+\.mojom\.(\w+)") {
      return "utility ($($Matches[1]))"
    }
    return $type
  }
  "webview browser"
}

# Running time (100 ns units) per PID and engine type, summed over engine instances.
function Get-GpuEngines([hashtable]$tree) {
  $result = @{}
  foreach ($row in Get-CimInstance Win32_PerfRawData_GPUPerformanceCounters_GPUEngine) {
    if ($row.Name -notmatch "^pid_(\d+)_.*_engtype_(.+)$") { continue }
    $id = [int]$Matches[1]
    if (-not $tree.ContainsKey($id)) { continue }
    $key = "$id|$($Matches[2])"
    $prev = 0
    if ($result.ContainsKey($key)) { $prev = $result[$key].Running }
    $result[$key] = @{ Running = $prev + [double]$row.RunningTime; Time = [double]$row.Timestamp_Sys100NS }
  }
  $result
}

function Get-GpuMemory([hashtable]$tree) {
  $result = @{}
  foreach ($row in Get-CimInstance Win32_PerfRawData_GPUPerformanceCounters_GPUProcessMemory) {
    if ($row.Name -notmatch "^pid_(\d+)_") { continue }
    $id = [int]$Matches[1]
    if (-not $tree.ContainsKey($id)) { continue }
    $prev = 0
    if ($result.ContainsKey($id)) { $prev = $result[$id] }
    $result[$id] = $prev + [double]$row.DedicatedUsage
  }
  $result
}

$tree = Get-Tree
if ($tree.Count -eq 0) {
  throw "No running '$ProcessName' process found. Start the app first."
}

# Per-PID accumulators. CPU and GPU time count only between two samples in which the PID
# was present, so a process that starts mid-window is counted from its first sample.
$procs = @{}
$engines = @{}
$samples = New-Object System.Collections.ArrayList
$prevTree = $tree
$prevGpu = Get-GpuEngines $tree
$startTime = [double]($tree.Values | Select-Object -First 1).Timestamp_Sys100NS
$prevTime = $startTime

foreach ($id in $tree.Keys) {
  $row = $tree[$id]
  $procs[$id] = @{
    Name = $row.Name; Role = Get-Role $id $row.Name; Cpu = 0.0
    Ws = New-Object System.Collections.ArrayList; Private = New-Object System.Collections.ArrayList
    Vram = New-Object System.Collections.ArrayList; Gpu3d = 0.0
  }
}

$title = "Measuring '$ProcessName' for $Duration s, $Interval s samples"
if ($Label) { $title += " - $Label" }
Write-Host $title
Write-Host ("{0,6}  {1,8}  {2,9}  {3,10}  {4,9}" -f "t (s)", "core %", "machine %", "priv WS MB", "processes")

$steps = [math]::Floor($Duration / $Interval)
for ($step = 1; $step -le $steps; $step++) {
  Start-Sleep -Seconds $Interval
  $tree = Get-Tree
  if ($tree.Count -eq 0) { throw "'$ProcessName' exited during the measurement." }
  $gpu = Get-GpuEngines $tree
  $vram = Get-GpuMemory $tree
  $now = [double]($tree.Values | Select-Object -First 1).Timestamp_Sys100NS
  $wall = $now - $prevTime

  $stepCpu = 0.0
  $stepWs = 0.0
  foreach ($id in $tree.Keys) {
    $row = $tree[$id]
    if (-not $procs.ContainsKey($id)) {
      $procs[$id] = @{
        Name = $row.Name; Role = Get-Role $id $row.Name; Cpu = 0.0
        Ws = New-Object System.Collections.ArrayList; Private = New-Object System.Collections.ArrayList
        Vram = New-Object System.Collections.ArrayList; Gpu3d = 0.0
      }
    }
    $p = $procs[$id]
    if ($prevTree.ContainsKey($id)) {
      $delta = [double]$row.PercentProcessorTime - [double]$prevTree[$id].PercentProcessorTime
      $p.Cpu += $delta
      $stepCpu += $delta
    }
    [void]$p.Ws.Add([double]$row.WorkingSetPrivate)
    [void]$p.Private.Add([double]$row.PrivateBytes)
    $v = 0.0
    if ($vram.ContainsKey($id)) { $v = $vram[$id] }
    [void]$p.Vram.Add($v)
    $stepWs += [double]$row.WorkingSetPrivate
  }
  foreach ($key in $gpu.Keys) {
    if (-not $prevGpu.ContainsKey($key)) { continue }
    $delta = $gpu[$key].Running - $prevGpu[$key].Running
    $type = $key.Split("|")[1]
    if (-not $engines.ContainsKey($type)) { $engines[$type] = 0.0 }
    $engines[$type] += $delta
    if ($type -eq "3D") { $procs[[int]$key.Split("|")[0]].Gpu3d += $delta }
  }

  $core = 100 * $stepCpu / $wall
  [void]$samples.Add(@{ Core = $core; Ws = $stepWs })
  Write-Host ("{0,6:N0}  {1,8:N1}  {2,9:N2}  {3,10:N1}  {4,9}" -f `
      (($now - $startTime) / 1e7), $core, ($core / $logicalCpus), ($stepWs / $mb), $tree.Count)
  $prevTree = $tree
  $prevGpu = $gpu
  $prevTime = $now
}

$elapsed = $prevTime - $startTime

function Get-Mean($list) {
  if ($list.Count -eq 0) { return 0.0 }
  ($list | Measure-Object -Average).Average
}

Write-Host ""
Write-Host "Per process (memory averaged over samples, MB):"
$table = foreach ($id in $procs.Keys) {
  $p = $procs[$id]
  [pscustomobject]@{
    PID = $id
    Role = $p.Role
    "Core %" = [math]::Round(100 * $p.Cpu / $elapsed, 2)
    "Priv WS" = [math]::Round((Get-Mean $p.Ws) / $mb, 1)
    "Priv bytes" = [math]::Round((Get-Mean $p.Private) / $mb, 1)
    "GPU 3D %" = [math]::Round(100 * $p.Gpu3d / $elapsed, 2)
    "VRAM" = [math]::Round((Get-Mean $p.Vram) / $mb, 1)
  }
}
$table | Sort-Object { $_."Priv WS" } -Descending | Format-Table -AutoSize | Out-String -Width 200 | Write-Host

$totalCpu = 0.0
foreach ($p in $procs.Values) { $totalCpu += $p.Cpu }
$core = 100 * $totalCpu / $elapsed
$machine = $core / $logicalCpus
$coreSamples = @($samples | ForEach-Object { $_.Core })
$wsSamples = @($samples | ForEach-Object { $_.Ws })
$peakCore = ($coreSamples | Measure-Object -Maximum).Maximum
$meanWs = (Get-Mean $wsSamples) / $mb
$peakWs = ($wsSamples | Measure-Object -Maximum).Maximum / $mb
$privateTotal = 0.0
$vramTotal = 0.0
foreach ($p in $procs.Values) {
  $privateTotal += Get-Mean $p.Private
  $vramTotal += Get-Mean $p.Vram
}
$gpuText = ($engines.Keys | Sort-Object | Where-Object { $engines[$_] -gt 0 } | ForEach-Object {
    "{0} {1:N2}%" -f $_, (100 * $engines[$_] / $elapsed)
  }) -join ", "
if (-not $gpuText) { $gpuText = "idle" }

function Get-Verdict([bool]$ok) { if ($ok) { "ok" } else { "OVER" } }

$cpuName = (Get-CimInstance Win32_Processor | Select-Object -First 1).Name.Trim()
Write-Host ("Machine:       {0}, {1} logical processors" -f $cpuName, $logicalCpus)
Write-Host ("Window:        {0:N0} s, {1} samples" -f ($elapsed / 1e7), $samples.Count)
Write-Host ("CPU:           {0:N1}% of one core (peak sample {1:N1}%), {2:N2}% of the machine" -f `
    $core, $peakCore, $machine)
Write-Host ("Private WS:    {0:N1} MB mean, {1:N1} MB peak" -f $meanWs, $peakWs)
Write-Host ("Private bytes: {0:N1} MB mean" -f ($privateTotal / $mb))
Write-Host ("GPU:           {0}; dedicated VRAM {1:N1} MB mean" -f $gpuText, ($vramTotal / $mb))
Write-Host ""
Write-Host ("Budget:        CPU machine {0:N2}% / {1}% {2}; CPU core {3:N1}% / {4}% {5}; peak private WS {6:N1} / {7} MB {8}" -f `
    $machine, $MachineCpuBudget, (Get-Verdict ($machine -le $MachineCpuBudget)),
  $core, $CoreCpuBudget, (Get-Verdict ($core -le $CoreCpuBudget)),
  $peakWs, $MemoryBudgetMb, (Get-Verdict ($peakWs -le $MemoryBudgetMb)))
