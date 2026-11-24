// Launcher do pacote portátil. Compilar com GOOS=windows GOARCH=amd64 e -ldflags=-H=windowsgui.
package main

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"syscall"
	"unsafe"
)

func alert(message string) {
	user32 := syscall.NewLazyDLL("user32.dll")
	box := user32.NewProc("MessageBoxW")
	text, _ := syscall.UTF16PtrFromString(message)
	title, _ := syscall.UTF16PtrFromString("Frequência dos Laboratórios")
	box.Call(0, uintptr(unsafe.Pointer(text)), uintptr(unsafe.Pointer(title)), 0x10)
}

func main() {
	executable, err := os.Executable()
	if err != nil {
		alert("Não foi possível identificar a pasta do aplicativo.")
		return
	}
	base := filepath.Dir(executable)
	runtime := filepath.Join(base, "runtime")
	app := filepath.Join(base, "app")
	python := filepath.Join(runtime, "pythonw.exe")
	entry := filepath.Join(app, "app.py")
	if _, err = os.Stat(entry); err != nil {
		alert("Extraia todo o ZIP antes de abrir. Mantenha as pastas app e runtime junto ao executável.")
		return
	}
	cmd := exec.Command(python, entry)
	cmd.Dir = app
	cmd.Env = append(os.Environ(),
		"TCL_LIBRARY="+filepath.Join(runtime, "tcl", "tcl8.6"),
		"TK_LIBRARY="+filepath.Join(runtime, "tcl", "tk8.6"))
	if err = cmd.Run(); err != nil {
		alert(fmt.Sprintf("O aplicativo não abriu. Confira se todo o ZIP foi extraído.\n%s", err))
	}
}
