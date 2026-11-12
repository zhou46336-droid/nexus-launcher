//go:build windows

// mousewatch：小助手程序，报告鼠标左键（主键）的按下 / 松开和拖动。
// 启动台失去焦点时由主程序启动，用来判断你是在「点别处」（收起面板）
// 还是在「从桌面拖东西过来」（面板保持打开）。主程序关闭管道或 3 分钟后自动退出。
//
// 输出（每行一个事件）：
//   init down|up X Y   启动时主键的状态和指针位置
//   down X Y           主键按下
//   move               按住后移动超过 6 像素（开始拖动）
//   up X Y             主键松开
package main

import (
	"fmt"
	"os"
	"syscall"
	"time"
	"unsafe"
)

var (
	user32            = syscall.NewLazyDLL("user32.dll")
	pGetAsyncKeyState = user32.NewProc("GetAsyncKeyState")
	pGetCursorPos     = user32.NewProc("GetCursorPos")
	pGetSystemMetrics = user32.NewProc("GetSystemMetrics")
)

type point struct{ X, Y int32 }

func abs(v int32) int32 {
	if v < 0 {
		return -v
	}
	return v
}

func main() {
	// 主程序关掉管道（或者主程序退出）时跟着退出
	go func() {
		b := make([]byte, 64)
		for {
			if _, err := os.Stdin.Read(b); err != nil {
				os.Exit(0)
			}
		}
	}()

	vk := uintptr(0x01) // VK_LBUTTON
	if swapped, _, _ := pGetSystemMetrics.Call(23); swapped != 0 { // SM_SWAPBUTTON：左右键互换时主键是右键
		vk = 0x02
	}
	isDown := func() bool {
		r, _, _ := pGetAsyncKeyState.Call(vk)
		return r&0x8000 != 0
	}
	var p point
	cursor := func() point {
		pGetCursorPos.Call(uintptr(unsafe.Pointer(&p)))
		return p
	}

	down := isDown()
	start := cursor()
	state := "up"
	if down {
		state = "down"
	}
	fmt.Printf("init %s %d %d\n", state, start.X, start.Y)

	moved := false
	deadline := time.Now().Add(3 * time.Minute)
	for time.Now().Before(deadline) {
		time.Sleep(15 * time.Millisecond)
		d := isDown()
		c := cursor()
		if d && !down {
			fmt.Printf("down %d %d\n", c.X, c.Y)
			start, moved = c, false
		} else if !d && down {
			fmt.Printf("up %d %d\n", c.X, c.Y)
		}
		if d && !moved && (abs(c.X-start.X) > 6 || abs(c.Y-start.Y) > 6) {
			moved = true
			fmt.Println("move")
		}
		down = d
	}
}
