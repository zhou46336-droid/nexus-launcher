$ErrorActionPreference = 'SilentlyContinue'
$ProgressPreference = 'SilentlyContinue'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding $false
New-Item -ItemType Directory -Force -Path $IconDir | Out-Null

$code = @'
using System;
using System.Drawing;
using System.Drawing.Imaging;
using System.Runtime.InteropServices;

public static class IconGrab {
  [StructLayout(LayoutKind.Sequential)]
  public struct SIZE { public int cx; public int cy; }

  [ComImport, Guid("bcc18b79-ba16-442f-80c4-8a59c30c463b"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  public interface IShellItemImageFactory {
    [PreserveSig] int GetImage(SIZE size, int flags, out IntPtr phbm);
  }

  [DllImport("shell32.dll", CharSet = CharSet.Unicode, PreserveSig = false)]
  static extern void SHCreateItemFromParsingName(
    [MarshalAs(UnmanagedType.LPWStr)] string path, IntPtr pbc,
    [MarshalAs(UnmanagedType.LPStruct)] Guid riid,
    [MarshalAs(UnmanagedType.Interface)] out IShellItemImageFactory ppv);

  [DllImport("gdi32.dll")]
  static extern bool DeleteObject(IntPtr h);

  public static string LastError = "";

  public static bool Save(string parsingName, string outPath, int size) {
    IShellItemImageFactory f = null;
    IntPtr hbm = IntPtr.Zero;
    try {
      SHCreateItemFromParsingName(parsingName, IntPtr.Zero, typeof(IShellItemImageFactory).GUID, out f);
      if (f == null) { LastError = "no factory"; return false; }
      SIZE s; s.cx = size; s.cy = size;
      // 0x4 = SIIGBF_ICONONLY, 0x1 = SIIGBF_BIGGERSIZEOK
      int hr = f.GetImage(s, 0x5, out hbm);
      if (hr != 0 || hbm == IntPtr.Zero) { LastError = "GetImage hr=0x" + hr.ToString("X8"); return false; }
      using (Bitmap src = Image.FromHbitmap(hbm)) {
        int w = src.Width, h = src.Height;
        Rectangle r = new Rectangle(0, 0, w, h);
        BitmapData bd = src.LockBits(r, ImageLockMode.ReadOnly, PixelFormat.Format32bppRgb);
        // Stride 可能是负数（自下而上存储的位图），所以逐行按 Stride 读取
        int row = w * 4;
        byte[] buf = new byte[row * h];
        for (int y = 0; y < h; y++) {
          Marshal.Copy(new IntPtr(bd.Scan0.ToInt64() + (long)y * bd.Stride), buf, y * row, row);
        }
        src.UnlockBits(bd);
        bool hasAlpha = false;
        for (int i = 3; i < buf.Length; i += 4) { if (buf[i] != 0) { hasAlpha = true; break; } }
        if (!hasAlpha) { src.Save(outPath, ImageFormat.Png); return true; }
        using (Bitmap dst = new Bitmap(w, h, PixelFormat.Format32bppArgb)) {
          BitmapData dd = dst.LockBits(r, ImageLockMode.WriteOnly, PixelFormat.Format32bppArgb);
          for (int y = 0; y < h; y++) {
            Marshal.Copy(buf, y * row, new IntPtr(dd.Scan0.ToInt64() + (long)y * dd.Stride), row);
          }
          dst.UnlockBits(dd);
          dst.Save(outPath, ImageFormat.Png);
        }
      }
      return true;
    } catch (Exception ex) {
      LastError = ex.GetType().Name + ": " + ex.Message;
      return false;
    } finally {
      if (hbm != IntPtr.Zero) DeleteObject(hbm);
      if (f != null) Marshal.ReleaseComObject(f);
    }
  }
}
'@

$log = New-Object System.Collections.Generic.List[string]
$log.Add('scan ' + (Get-Date -Format s) + ' ps=' + $PSVersionTable.PSVersion + ' apt=' + [Threading.Thread]::CurrentThread.ApartmentState)
$canIcon = $false
try {
  Add-Type -TypeDefinition $code -ReferencedAssemblies System.Drawing -ErrorAction Stop -ErrorVariable addTypeErr
  $canIcon = $true
  $log.Add('add-type ok')
} catch {
  $canIcon = $false
  $log.Add('add-type FAILED: ' + ($_.Exception.Message -replace '\s+', ' '))
  foreach ($e in @($addTypeErr)) { $log.Add('  err: ' + ($e.ToString() -replace '\s+', ' ')) }
}

# Microsoft Store 应用：从安装包清单里找它自带的图标文件
$pkgDirs = @{}
try { Get-AppxPackage | ForEach-Object { $pkgDirs[$_.PackageFamilyName] = $_.InstallLocation } } catch { $log.Add('appx list failed: ' + $_.Exception.Message) }

function Get-UwpLogo([string]$aumid) {
  try {
    $parts = $aumid.Split('!')
    $loc = $pkgDirs[$parts[0]]
    if (-not $loc) { return $null }
    $manifest = Join-Path $loc 'AppxManifest.xml'
    if (-not (Test-Path -LiteralPath $manifest)) { return $null }
    [xml]$m = Get-Content -LiteralPath $manifest -Raw -Encoding UTF8
    $apps = @($m.Package.Applications.Application)
    $appNode = $apps | Where-Object { $_.Id -eq $parts[1] } | Select-Object -First 1
    if (-not $appNode) { $appNode = $apps[0] }
    $ve = $appNode.VisualElements
    $logo = $null
    if ($ve) { $logo = $ve.Square44x44Logo; if (-not $logo) { $logo = $ve.Square150x150Logo } }
    if (-not $logo) { $logo = $m.Package.Properties.Logo }
    if (-not $logo) { return $null }
    $full = Join-Path $loc $logo
    $dir = Split-Path $full -Parent
    $base = [IO.Path]::GetFileNameWithoutExtension($full)
    $ext = [IO.Path]::GetExtension($full)
    $best = $null; $bestScore = -1
    foreach ($c in @(Get-ChildItem -LiteralPath $dir -File -Filter ($base + '*' + $ext) -ErrorAction SilentlyContinue)) {
      $n = $c.Name.ToLower()
      if ($n -match 'contrast') { continue }
      $score = 0
      if ($n -match 'targetsize-(\d+)') {
        $t = [int]$matches[1]
        $score = if ($t -le 256) { $t * 10 } else { 5 }
        if ($n -match 'unplated') { $score += 5 }
      } elseif ($n -match 'scale-(\d+)') {
        $score = [int]$matches[1] / 2
      } else {
        $score = 2
      }
      if ($score -gt $bestScore) { $best = $c.FullName; $bestScore = $score }
    }
    return $best
  } catch { return $null }
}

$pf64 = if ($env:ProgramW6432) { $env:ProgramW6432 } else { $env:ProgramFiles }
$kf = @{
  '{6D809377-6AF0-444B-8957-A3773F02200E}' = $pf64
  '{7C5A40EF-A0FB-4BFC-874A-C0F2E0B9FA8E}' = ${env:ProgramFiles(x86)}
  '{905E63B6-C1BF-494E-B29C-65B732D3D21A}' = $env:ProgramFiles
  '{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}' = [Environment]::GetFolderPath('System')
  '{D65231B0-B2F1-4857-A4CE-A8E7C6EA7D27}' = [Environment]::GetFolderPath('SystemX86')
  '{F38BF404-1D43-42F2-9305-67DE0B28FC23}' = $env:windir
  '{F1B32785-6FBA-4FCF-9D55-7B8E7F157091}' = $env:LOCALAPPDATA
  '{3EB685DB-65F9-4CF6-A03A-E3EF65729F3D}' = $env:APPDATA
  '{62AB5D82-FDC1-4DC3-A9DD-070D1D495D97}' = $env:ProgramData
}

function Resolve-AppPath([string]$id) {
  if ($id -match '^(\{[0-9A-Fa-f\-]+\})\\(.+)$') {
    $base = $kf[$matches[1].ToUpper()]
    if ($base) {
      $p = Join-Path $base $matches[2]
      if (Test-Path -LiteralPath $p) { return $p }
    }
  } elseif ($id -match '^[A-Za-z]:\\') {
    if (Test-Path -LiteralPath $id) { return $id }
  }
  return $null
}

# 开始菜单里的快捷方式：按显示名、AppUserModelID、目标路径建立索引
$sh = New-Object -ComObject Shell.Application
$lnkByName = @{}
$lnkByAumid = @{}
$lnkByTarget = @{}
$roots = @(
  (Join-Path ([Environment]::GetFolderPath('CommonStartMenu')) 'Programs'),
  (Join-Path ([Environment]::GetFolderPath('StartMenu')) 'Programs')
)
foreach ($root in $roots) {
  if (-not (Test-Path -LiteralPath $root)) { continue }
  Get-ChildItem -LiteralPath $root -Recurse -File -ErrorAction SilentlyContinue |
    Where-Object { $_.Extension -eq '.lnk' } |
    ForEach-Object {
      $file = $_
      $item = $null
      $folder = $sh.NameSpace($file.DirectoryName)
      if ($folder) { $item = $folder.ParseName($file.Name) }
      $display = if ($item) { [string]$item.Name } else { $file.BaseName }
      if ($display -and -not $lnkByName.ContainsKey($display)) { $lnkByName[$display] = $file.FullName }
      if ($item) {
        $aumid = $item.ExtendedProperty('System.AppUserModel.ID')
        if ($aumid) { $lnkByAumid[[string]$aumid] = $file.FullName }
        $tgt = $item.ExtendedProperty('System.Link.TargetParsingPath')
        if ($tgt) { $lnkByTarget[([string]$tgt).ToLower()] = $file.FullName }
      }
    }
}

# 开始菜单「所有应用」列表（含 Microsoft Store 应用，名字是系统显示的中文名）
$apps = @()
try { $apps = @(Get-StartApps) } catch { $apps = @() }
if ($apps.Count -eq 0) {
  $af = $sh.NameSpace('shell:::{4234d49b-0245-4df3-b780-3893943456e1}')
  if ($af) { $apps = @($af.Items() | ForEach-Object { [pscustomobject]@{ Name = $_.Name; AppID = $_.Path } }) }
}

$sha = [System.Security.Cryptography.SHA1]::Create()
function Get-Hash([string]$s) {
  -join ($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($s)) | ForEach-Object { $_.ToString('x2') })
}

$seen = @{}
$failed = 0
$made = 0
$result = New-Object System.Collections.Generic.List[object]
foreach ($a in $apps) {
  $id = [string]$a.AppID
  $name = [string]$a.Name
  if (-not $id -or -not $name -or $seen.ContainsKey($id)) { continue }
  $seen[$id] = $true
  $uwp = $id.Contains('!')
  $p = $null
  if (-not $uwp) {
    if ($lnkByAumid.ContainsKey($id)) {
      $p = $lnkByAumid[$id]
    } else {
      $exe = Resolve-AppPath $id
      if ($exe) {
        $k = $exe.ToLower()
        if ($lnkByTarget.ContainsKey($k)) { $p = $lnkByTarget[$k] } else { $p = $exe }
      } elseif ($lnkByName.ContainsKey($name)) {
        $p = $lnkByName[$name]
      }
    }
  }
  $icon = Join-Path $IconDir ((Get-Hash $id) + '.png')
  if (-not (Test-Path -LiteralPath $icon)) {
    $ok = $false
    if ($canIcon) {
      $ok = [IconGrab]::Save(('shell:AppsFolder\' + $id), $icon, 96)
      if (-not $ok -and $p) { $ok = [IconGrab]::Save($p, $icon, 96) }
      if (-not $ok -and $failed -lt 8) { $failed++; $log.Add('icon fail: ' + $name + ' -> ' + [IconGrab]::LastError) }
    }
    if (-not $ok -and $uwp) {
      $logoFile = Get-UwpLogo $id
      if ($logoFile) { Copy-Item -LiteralPath $logoFile -Destination $icon -Force; $ok = Test-Path -LiteralPath $icon }
    }
    if ($ok) { $made++ }
  }
  if (-not (Test-Path -LiteralPath $icon)) { $icon = $null }
  $result.Add([pscustomobject]@{ name = $name; appId = $id; path = $p; icon = $icon; uwp = $uwp })
}

$log.Add('apps=' + $result.Count + ' newIcons=' + $made + ' withIcon=' + @($result | Where-Object { $_.icon }).Count)
try { $log | Out-File -LiteralPath (Join-Path (Split-Path $IconDir -Parent) 'scan.log') -Encoding utf8 } catch {}

'@@JSON@@' + (ConvertTo-Json -InputObject $result.ToArray() -Compress -Depth 3)
