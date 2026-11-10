//go:build windows

// 「更多应用」卸载程序：放在安装目录里，由「设置 → 应用」调用。
package main

import (
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"

	w "nl/winutil"
)

const title = "卸载 更多应用"

func main() {
	if !w.SingleInstance(`Local\NexusLauncherUninstall`) {
		return
	}
	exe, err := os.Executable()
	if err != nil {
		return
	}
	dir := filepath.Dir(exe)
	app := filepath.Join(dir, "NexusLauncher.exe")
	// 安全检查：只在真正的安装目录里工作，避免误删别的文件夹
	if !strings.EqualFold(filepath.Base(dir), "NexusLauncher") || !w.Exists(app) {
		w.MsgBox("没有找到「更多应用」的安装目录。\n请从「设置 → 应用 → 已安装的应用」里卸载。", title, w.MB_OK|w.MB_ICONERROR)
		return
	}
	if w.MsgBox("要从这台电脑上卸载「更多应用」吗？", title, w.MB_YESNO|w.MB_ICONQUESTION) != w.IDYES {
		return
	}

	w.KillApp()

	// 让程序自己取消开机自启、删掉桌面和开始菜单的快捷方式
	c := exec.Command(app, "--uninstall-cleanup")
	c.Dir = dir
	if c.Start() == nil {
		done := make(chan struct{})
		go func() { c.Wait(); close(done) }()
		select {
		case <-done:
		case <-time.After(15 * time.Second):
			c.Process.Kill()
		}
	}

	if w.MsgBox("要同时删除你的应用列表、排序和外观设置吗？\n\n选「否」会保留，以后重新安装还能接着用。", title, w.MB_YESNO|w.MB_ICONQUESTION) == w.IDYES {
		if appData := os.Getenv("APPDATA"); appData != "" {
			os.RemoveAll(filepath.Join(appData, "NexusLauncher"))
		}
	}

	w.DeleteUserTree(w.UninstallKey)

	entries, _ := os.ReadDir(dir)
	for _, e := range entries {
		if !strings.EqualFold(e.Name(), filepath.Base(exe)) {
			os.RemoveAll(filepath.Join(dir, e.Name()))
		}
	}

	w.MsgBox("「更多应用」已经卸载。", title, w.MB_OK|w.MB_ICONINFORMATION)

	// 自己退出两秒后，把安装目录（连同卸载程序本身）删掉
	_ = w.StartRawHidden(`cmd.exe /d /c ping 127.0.0.1 -n 3 >nul & rmdir /s /q "`+dir+`"`, os.TempDir())
}
