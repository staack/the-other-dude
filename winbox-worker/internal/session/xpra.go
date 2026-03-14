package session

import (
	"context"
	"fmt"
	"log/slog"
	"net"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"syscall"
	"time"
)

type XpraConfig struct {
	Display    int
	WSPort     int
	BindAddr   string
	TunnelHost string
	TunnelPort int
	Username   string
	Password   string
	TmpDir     string
	WinBoxPath string
}

func StartXpra(cfg XpraConfig) (*os.Process, error) {
	display := fmt.Sprintf(":%d", cfg.Display)
	bindWS := fmt.Sprintf("%s:%d", cfg.BindAddr, cfg.WSPort)
	winboxCmd := fmt.Sprintf("%s %s:%d %s %s",
		cfg.WinBoxPath, cfg.TunnelHost, cfg.TunnelPort, cfg.Username, cfg.Password)

	args := []string{
		"start", display,
		"--bind-ws=" + bindWS,
		"--html=on",
		"--daemon=no",
		"--start-new-commands=no",
		"--no-clipboard",
		"--no-printing",
		"--no-file-transfer",
		"--no-notifications",
		"--no-webcam",
		"--no-speaker",
		"--no-microphone",
		"--sharing=no",
		"--opengl=off",
		"--env=XPRA_CLIENT_CAN_SHUTDOWN=0",
		"--xvfb=Xvfb +extension GLX +extension Composite -screen 0 1280x800x24+32 -dpi 96 -nolisten tcp -noreset -auth /home/worker/.Xauthority",
		"--start-child=" + winboxCmd,
	}

	logFile := filepath.Join(cfg.TmpDir, "xpra.log")

	cmd := exec.Command("xpra", args...)
	cmd.Dir = cfg.TmpDir

	f, err := os.Create(logFile)
	if err != nil {
		return nil, fmt.Errorf("create xpra log: %w", err)
	}
	cmd.Stdout = f
	cmd.Stderr = f

	cmd.Env = append(os.Environ(),
		"HOME="+cfg.TmpDir,
		"DISPLAY="+display,
		"XPRA_CLIENT_CAN_SHUTDOWN=0",
		"LIBGL_ALWAYS_SOFTWARE=1",
		"GALLIUM_DRIVER=llvmpipe",
	)
	cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}

	if err := cmd.Start(); err != nil {
		return nil, fmt.Errorf("xpra start failed: %w", err)
	}

	return cmd.Process, nil
}

func WaitForXpraReady(ctx context.Context, bindAddr string, wsPort int, timeout time.Duration) error {
	addr := fmt.Sprintf("%s:%d", bindAddr, wsPort)
	deadline := time.After(timeout)
	ticker := time.NewTicker(250 * time.Millisecond)
	defer ticker.Stop()

	for {
		select {
		case <-deadline:
			return fmt.Errorf("xpra not ready after %s", timeout)
		case <-ctx.Done():
			return ctx.Err()
		case <-ticker.C:
			conn, err := (&net.Dialer{Timeout: 200 * time.Millisecond}).DialContext(ctx, "tcp", addr)
			if err == nil {
				conn.Close()
				return nil
			}
		}
	}
}

func QueryIdleTime(display int) int {
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	cmd := exec.CommandContext(ctx, "xpra", "info", fmt.Sprintf(":%d", display))
	out, err := cmd.Output()
	if err != nil {
		return -1
	}
	for _, line := range strings.Split(string(out), "\n") {
		line = strings.TrimSpace(line)
		if strings.HasPrefix(line, "idle_time=") {
			val := strings.TrimPrefix(line, "idle_time=")
			if n, err := strconv.Atoi(val); err == nil {
				return n
			}
		}
	}
	return -1
}

func KillXpraSession(pid int) error {
	if err := syscall.Kill(-pid, syscall.SIGTERM); err != nil {
		slog.Warn("SIGTERM to xpra process group failed", "pid", pid, "err", err)
	}

	done := make(chan struct{})
	go func() {
		proc, err := os.FindProcess(pid)
		if err == nil {
			proc.Wait()
		}
		close(done)
	}()

	select {
	case <-done:
		return nil
	case <-time.After(5 * time.Second):
		slog.Warn("SIGKILL to xpra process group", "pid", pid)
		return syscall.Kill(-pid, syscall.SIGKILL)
	}
}

func CleanupTmpDir(dir string) error {
	if dir == "" || !strings.HasPrefix(dir, "/tmp/winbox-sessions/") {
		return fmt.Errorf("refusing to remove suspicious path: %s", dir)
	}
	return os.RemoveAll(dir)
}

func CreateSessionTmpDir(sessionID string) (string, error) {
	dir := filepath.Join("/tmp/winbox-sessions", sessionID)
	if err := os.MkdirAll(dir, 0700); err != nil {
		return "", fmt.Errorf("create tmpdir: %w", err)
	}
	return dir, nil
}
