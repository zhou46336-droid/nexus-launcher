#!/usr/bin/env bash
# 打包「更多应用」：
#   build/NexusLauncher/                    可以直接运行的程序目录
#   dist/NexusLauncher-Setup-<版本>.exe     单文件安装程序（离线、不需要管理员权限）
# 需要：Python 3、Go 1.21+；先运行 scripts/fetch-electron.sh 准备运行时（或用 RUNTIME=目录 指定）
set -euo pipefail
ROOT=$(cd "$(dirname "$0")/.." && pwd)
RUNTIME=${RUNTIME:-$ROOT/build/runtime}
VER=$(python3 -c 'import json, sys; print(json.load(open(sys.argv[1], encoding="utf-8"))["version"])' "$ROOT/app/package.json")
APPDIR=$ROOT/build/NexusLauncher
DIST=$ROOT/dist

if [ ! -f "$RUNTIME/NexusLauncher.exe" ]; then
  echo "找不到 Electron 运行时（$RUNTIME），请先运行 scripts/fetch-electron.sh" >&2
  exit 1
fi

echo "== 组装程序目录（v$VER）"
rm -rf "$APPDIR"
mkdir -p "$APPDIR" "$DIST"
cp -r "$RUNTIME"/. "$APPDIR"/
rm -rf "$APPDIR/resources/app"
cp -r "$ROOT/app" "$APPDIR/resources/app"

echo "== 编译卸载程序和安装程序"
cd "$ROOT/installer"
export GOOS=windows GOARCH=amd64 CGO_ENABLED=0 GOFLAGS=-mod=mod
LDFLAGS="-H windowsgui -s -w -X main.version=$VER"
python3 mksyso.py "$ROOT/app/assets/app-icon.ico" app.manifest cmd/setup/rsrc_windows_amd64.syso
cp cmd/setup/rsrc_windows_amd64.syso cmd/uninstall/rsrc_windows_amd64.syso
go vet ./winutil ./cmd/uninstall
go build -trimpath -ldflags "$LDFLAGS" -o "$APPDIR/uninstall.exe" ./cmd/uninstall
python3 mkpayload.py "$APPDIR" cmd/setup/payload.zip
go vet ./cmd/setup
go build -trimpath -ldflags "$LDFLAGS" -o "$DIST/NexusLauncher-Setup-$VER.exe" ./cmd/setup
rm -f cmd/setup/payload.zip

ls -la "$DIST"
echo "完成：$DIST/NexusLauncher-Setup-$VER.exe"
