$ErrorActionPreference = 'SilentlyContinue'
$ProgressPreference = 'SilentlyContinue'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding $false
# 调用方会在前面注入：$AppId、$ExePath、$OutBase、$Code（IconGrab 的 C# 源码）

$res = [ordered]@{ shell = $null; pkg = $null; pkgSrc = $null; err = '' }

try { Add-Type -TypeDefinition $Code -ReferencedAssemblies System.Drawing -ErrorAction Stop } catch { $res.err += 'add-type: ' + $_.Exception.Message + '; ' }

# 1) 让系统按 256px 给图标（和资源管理器「超大图标」同一个来源）
if ('IconGrab' -as [type]) {
  $out = $OutBase + '.shell.png'
  $ok = $false
  if ($AppId) { $ok = [IconGrab]::Save(('shell:AppsFolder\' + $AppId), $out, 256) }
  if (-not $ok -and $ExePath) { $ok = [IconGrab]::Save($ExePath, $out, 256) }
  if ($ok) { $res.shell = $out } else { $res.err += 'shell: ' + [IconGrab]::LastError + '; ' }
}

# 2) Microsoft Store / MSIX 应用：直接取安装包里最大的那张原图
if ($AppId -and $AppId.Contains('!')) {
  try {
    $parts = $AppId.Split('!')
    $pkg = Get-AppxPackage | Where-Object { $_.PackageFamilyName -eq $parts[0] } | Select-Object -First 1
    if ($pkg) {
      $loc = $pkg.InstallLocation
      [xml]$m = Get-Content -LiteralPath (Join-Path $loc 'AppxManifest.xml') -Raw -Encoding UTF8
      $apps = @($m.Package.Applications.Application)
      $appNode = $apps | Where-Object { $_.Id -eq $parts[1] } | Select-Object -First 1
      if (-not $appNode) { $appNode = $apps[0] }
      $ve = $appNode.VisualElements
      $best = $null; $bestEff = 0
      foreach ($attr in @('Square44x44Logo', 'Square150x150Logo')) {
        $rel = $ve.$attr
        if (-not $rel) { continue }
        $full = Join-Path $loc $rel
        $dir = Split-Path $full -Parent
        $base = [IO.Path]::GetFileNameWithoutExtension($full)
        $ext = [IO.Path]::GetExtension($full)
        $unit = 100
        if ($attr -eq 'Square44x44Logo') { $unit = 44 }
        foreach ($c in @(Get-ChildItem -LiteralPath $dir -File -Filter ($base + '*' + $ext))) {
          $n = $c.Name.ToLower()
          if ($n -match 'contrast') { continue }
          $eff = $unit
          if ($n -match 'targetsize-(\d+)') { $eff = [int]$matches[1] }
          elseif ($n -match 'scale-(\d+)') { $eff = [int]$matches[1] / 100 * $unit }
          if ($n -match 'lightunplated') { $eff += 0.2 } elseif ($n -match 'unplated') { $eff += 0.5 }
          if ($eff -gt $bestEff) { $best = $c.FullName; $bestEff = $eff }
        }
      }
      if ($best) {
        Copy-Item -LiteralPath $best -Destination ($OutBase + '.pkg.png') -Force
        if (Test-Path -LiteralPath ($OutBase + '.pkg.png')) { $res.pkg = $OutBase + '.pkg.png'; $res.pkgSrc = $best }
      }
    } else { $res.err += 'pkg not found; ' }
  } catch { $res.err += 'pkg: ' + $_.Exception.Message + '; ' }
}

'@@JSON@@' + ($res | ConvertTo-Json -Compress)
