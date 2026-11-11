//go:build windows

// 「更多应用」安装程序：程序文件全部打包在 exe 里，不需要联网、不需要管理员权限。
// 装到 %LOCALAPPDATA%\Programs\NexusLauncher，并在「设置 → 应用」里登记卸载入口。
package main

import (
	"archive/zip"
	"bytes"
	_ "embed"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"

	w "nl/winutil"
)

//go:embed payload.zip
var payload []byte

// 版本号由构建脚本通过 -ldflags "-X main.version=…" 写入
var version = "dev"
const title = "更多应用 安装"

func main() {
	if !w.SingleInstance(`Local\NexusLauncherSetup`) {
		return
	}
	local := os.Getenv("LOCALAPPDATA")
	if local == "" {
		w.MsgBox("找不到用户的 AppData\\Local 文件夹，无法安装。", title, w.MB_OK|w.MB_ICONERROR)
		return
	}
	dir := filepath.Join(local, "Programs", "NexusLauncher")
	upgrading := w.Exists(filepath.Join(dir, "NexusLauncher.exe"))

	intro := "将把「更多应用」安装到：\n" + dir + "\n\n" +
		"· 不需要管理员权限，也不需要联网\n" +
		"· 装好后按 Alt+Q 打开启动台，开机会自动在后台启动\n\n" +
		"点「确定」开始安装。"
	if upgrading {
		intro = "这台电脑上已经装过「更多应用」，将更新到 " + version + " 版。\n\n" +
			"你的应用列表、排序和外观设置都会保留。\n\n点「确定」开始更新。"
	}
	if w.MsgBox(intro, title, w.MB_OKCANCEL|w.MB_ICONINFORMATION) != w.IDOK {
		return
	}

	closeBusy := w.Busy("正在安装，请稍候…\n\n大约需要 10 秒，完成后会自动提示。", "更多应用 正在安装")
	err := install(dir)
	closeBusy()
	if err != nil {
		w.MsgBox("安装没有完成：\n\n"+err.Error(), title, w.MB_OK|w.MB_ICONERROR)
		return
	}

	w.MsgBox("安装完成！\n\n点「确定」后会打开启动台。以后：\n"+
		"· 按 Alt+Q 随时打开 / 关闭\n"+
		"· 桌面和开始菜单里有「更多应用」，可以拖到 Nexus 等停靠栏上\n"+
		"· 开机自动在后台启动（可在任务栏托盘图标的右键菜单里关闭）\n\n"+
		"卸载：设置 → 应用 → 已安装的应用 → 更多应用", title, w.MB_OK|w.MB_ICONINFORMATION)

	c := exec.Command(filepath.Join(dir, "NexusLauncher.exe"))
	c.Dir = dir
	_ = c.Start()
}

func install(dir string) error {
	w.KillApp()

	// 直接覆盖写入（升级时保留目录里其它文件；用户数据在 %APPDATA%\NexusLauncher，不受影响）
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return fmt.Errorf("无法创建安装目录：%v", err)
	}

	zr, err := zip.NewReader(bytes.NewReader(payload), int64(len(payload)))
	if err != nil {
		return fmt.Errorf("安装包已损坏，请重新下载。（%v）", err)
	}
	var total uint64
	for _, f := range zr.File {
		name := filepath.FromSlash(f.Name)
		if strings.Contains(name, "..") || filepath.IsAbs(name) {
			continue
		}
		target := filepath.Join(dir, name)
		if f.FileInfo().IsDir() {
			if err := os.MkdirAll(target, 0o755); err != nil {
				return err
			}
			continue
		}
		if err := os.MkdirAll(filepath.Dir(target), 0o755); err != nil {
			return err
		}
		var err error
		for i := 0; i < 10; i++ { // 刚结束的进程可能还占着文件，稍等重试
			if err = extract(f, target); err == nil {
				break
			}
			time.Sleep(500 * time.Millisecond)
		}
		if err != nil {
			return fmt.Errorf("写入 %s 失败：%v\n\n如果「更多应用」还在运行，请在任务栏托盘里右键它选择退出，然后重新运行安装程序。", f.Name, err)
		}
		total += f.UncompressedSize64
	}
	if !w.Exists(filepath.Join(dir, "NexusLauncher.exe")) {
		return fmt.Errorf("主程序没有写入成功，可能被杀毒软件拦截了。")
	}

	// 在「设置 → 应用」里登记，方便以后卸载
	k, err := w.CreateUserKey(w.UninstallKey)
	if err == nil {
		k.SetString("DisplayName", "更多应用（NexusLauncher）")
		k.SetString("DisplayVersion", version)
		k.SetString("Publisher", "NexusLauncher")
		k.SetString("DisplayIcon", filepath.Join(dir, "resources", "app", "assets", "app-icon.ico"))
		k.SetString("InstallLocation", dir)
		k.SetString("UninstallString", `"`+filepath.Join(dir, "uninstall.exe")+`"`)
		k.SetString("InstallDate", time.Now().Format("20060102"))
		k.SetDWord("NoModify", 1)
		k.SetDWord("NoRepair", 1)
		k.SetDWord("EstimatedSize", uint32(total/1024))
		k.Close()
	}
	return nil
}

func extract(f *zip.File, target string) error {
	rc, err := f.Open()
	if err != nil {
		return err
	}
	defer rc.Close()
	out, err := os.Create(target)
	if err != nil {
		return err
	}
	if _, err := io.Copy(out, rc); err != nil {
		out.Close()
		return err
	}
	return out.Close()
}
