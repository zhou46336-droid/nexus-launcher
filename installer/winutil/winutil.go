//go:build windows

// Package winutil 是安装 / 卸载程序共用的一点 Windows 小工具：
// 系统对话框、防重复运行、隐藏窗口执行命令、写注册表。只用标准库。
package winutil

import (
	"os"
	"os/exec"
	"runtime"
	"syscall"
	"time"
	"unsafe"
)

var (
	user32   = syscall.NewLazyDLL("user32.dll")
	kernel32 = syscall.NewLazyDLL("kernel32.dll")
	advapi32 = syscall.NewLazyDLL("advapi32.dll")

	pMessageBoxW     = user32.NewProc("MessageBoxW")
	pFindWindowW     = user32.NewProc("FindWindowW")
	pPostMessageW    = user32.NewProc("PostMessageW")
	pCreateMutexW    = kernel32.NewProc("CreateMutexW")
	pRegCreateKeyExW = advapi32.NewProc("RegCreateKeyExW")
	pRegSetValueExW  = advapi32.NewProc("RegSetValueExW")
	pRegCloseKey     = advapi32.NewProc("RegCloseKey")
	pRegDeleteTreeW  = advapi32.NewProc("RegDeleteTreeW")
)

const (
	MB_OK              = 0x0
	MB_OKCANCEL        = 0x1
	MB_YESNO           = 0x4
	MB_ICONERROR       = 0x10
	MB_ICONQUESTION    = 0x20
	MB_ICONINFORMATION = 0x40
	mbSetForeground    = 0x10000
	IDOK               = 1
	IDYES              = 6

	createNoWindow = 0x08000000
)

func u16(s string) *uint16 {
	p, _ := syscall.UTF16PtrFromString(s)
	return p
}

// MsgBox 弹出系统对话框，返回按下的按钮。
func MsgBox(text, title string, flags uintptr) int {
	r, _, _ := pMessageBoxW.Call(0, uintptr(unsafe.Pointer(u16(text))), uintptr(unsafe.Pointer(u16(title))), flags|mbSetForeground)
	return int(r)
}

// Busy 在后台显示一个“请稍候”的提示框，返回关闭它的函数。
func Busy(text, title string) func() {
	done := make(chan struct{})
	go func() {
		runtime.LockOSThread()
		MsgBox(text, title, MB_OK|MB_ICONINFORMATION)
		close(done)
	}()
	return func() {
		for i := 0; i < 50; i++ {
			h, _, _ := pFindWindowW.Call(uintptr(unsafe.Pointer(u16("#32770"))), uintptr(unsafe.Pointer(u16(title))))
			if h != 0 {
				pPostMessageW.Call(h, 0x0010, 0, 0) // WM_CLOSE
				break
			}
			select {
			case <-done:
				return
			case <-time.After(20 * time.Millisecond):
			}
		}
		select {
		case <-done:
		case <-time.After(2 * time.Second):
		}
	}
}

// SingleInstance 用命名互斥量防止同时运行两份；已有一份在运行时返回 false。
func SingleInstance(name string) bool {
	h, _, err := pCreateMutexW.Call(0, 0, uintptr(unsafe.Pointer(u16(name))))
	if h == 0 {
		return true
	}
	if errno, ok := err.(syscall.Errno); ok && errno == 183 { // ERROR_ALREADY_EXISTS
		return false
	}
	return true
}

// RunHidden 不弹黑窗口地运行一条命令并等待结束。
func RunHidden(name string, args ...string) error {
	c := exec.Command(name, args...)
	c.SysProcAttr = &syscall.SysProcAttr{HideWindow: true, CreationFlags: createNoWindow}
	return c.Run()
}

// StartRawHidden 用原样的命令行在后台启动（不等待）。
func StartRawHidden(cmdLine, dir string) error {
	c := exec.Command("cmd.exe")
	c.SysProcAttr = &syscall.SysProcAttr{HideWindow: true, CreationFlags: createNoWindow, CmdLine: cmdLine}
	c.Dir = dir
	return c.Start()
}

// KillApp 结束正在运行的启动台（升级、卸载前需要）。
func KillApp() {
	_ = RunHidden("taskkill.exe", "/F", "/T", "/IM", "NexusLauncher.exe")
	time.Sleep(800 * time.Millisecond)
}

// RegKey 是 HKEY_CURRENT_USER 下打开的一个键。
type RegKey uintptr

// CreateUserKey 创建 / 打开 HKCU\path。
func CreateUserKey(path string) (RegKey, error) {
	var h uintptr
	r, _, _ := pRegCreateKeyExW.Call(uintptr(syscall.HKEY_CURRENT_USER), uintptr(unsafe.Pointer(u16(path))), 0, 0, 0,
		0x20006 /*KEY_WRITE*/, 0, uintptr(unsafe.Pointer(&h)), 0)
	if r != 0 {
		return 0, syscall.Errno(r)
	}
	return RegKey(h), nil
}

func (k RegKey) SetString(name, val string) error {
	data, _ := syscall.UTF16FromString(val)
	r, _, _ := pRegSetValueExW.Call(uintptr(k), uintptr(unsafe.Pointer(u16(name))), 0, 1 /*REG_SZ*/,
		uintptr(unsafe.Pointer(&data[0])), uintptr(len(data)*2))
	if r != 0 {
		return syscall.Errno(r)
	}
	return nil
}

func (k RegKey) SetDWord(name string, val uint32) error {
	r, _, _ := pRegSetValueExW.Call(uintptr(k), uintptr(unsafe.Pointer(u16(name))), 0, 4 /*REG_DWORD*/,
		uintptr(unsafe.Pointer(&val)), 4)
	if r != 0 {
		return syscall.Errno(r)
	}
	return nil
}

func (k RegKey) Close() { pRegCloseKey.Call(uintptr(k)) }

// DeleteUserTree 删除 HKCU\path 整个键。
func DeleteUserTree(path string) {
	pRegDeleteTreeW.Call(uintptr(syscall.HKEY_CURRENT_USER), uintptr(unsafe.Pointer(u16(path))))
}

// UninstallKey 是「设置 → 应用」里卸载条目的位置。
const UninstallKey = `Software\Microsoft\Windows\CurrentVersion\Uninstall\NexusLauncher`

// Exists 判断文件是否存在。
func Exists(p string) bool {
	_, err := os.Stat(p)
	return err == nil
}
