#!/usr/bin/env bash
# 下载 Electron 的 Windows 运行时，整理到 build/runtime：
#   electron.exe 改名为 NexusLauncher.exe、去掉默认示例程序、只保留中英文语言包。
# 用法：scripts/fetch-electron.sh
#   ELECTRON_VERSION=38.2.0   指定版本
#   ELECTRON_ZIP=路径          使用已经下载好的 electron-v*-win32-x64.zip
set -euo pipefail
VER=${ELECTRON_VERSION:-38.2.0}
ROOT=$(cd "$(dirname "$0")/.." && pwd)
BUILD=$ROOT/build
OUT=$BUILD/runtime
NAME=electron-v$VER-win32-x64.zip
mkdir -p "$BUILD"

ZIP=${ELECTRON_ZIP:-$BUILD/$NAME}
if [ ! -f "$ZIP" ]; then
  BASE=https://github.com/electron/electron/releases/download/v$VER
  echo "下载 $NAME …"
  curl -fL --retry 2 -o "$ZIP.part" "$BASE/$NAME"
  curl -fL --retry 2 -o "$BUILD/SHASUMS256.txt" "$BASE/SHASUMS256.txt"
  WANT=$(grep "$NAME\$" "$BUILD/SHASUMS256.txt" | cut -d' ' -f1)
  GOT=$(sha256sum "$ZIP.part" | cut -d' ' -f1)
  if [ -z "$WANT" ] || [ "$WANT" != "$GOT" ]; then
    echo "校验失败：下载的文件和官方 SHASUMS256.txt 不一致" >&2
    rm -f "$ZIP.part"
    exit 1
  fi
  mv "$ZIP.part" "$ZIP"
fi

rm -rf "$OUT"
mkdir -p "$OUT"
python3 -c 'import sys, zipfile; zipfile.ZipFile(sys.argv[1]).extractall(sys.argv[2])' "$ZIP" "$OUT"
mv "$OUT/electron.exe" "$OUT/NexusLauncher.exe"
rm -f "$OUT/resources/default_app.asar"
find "$OUT/locales" -name '*.pak' ! -name 'en-US.pak' ! -name 'zh-CN.pak' -delete
echo "运行时已就绪：$OUT（Electron $VER）"
