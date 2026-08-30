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
	"sync/atomic"
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

// XpraProc is a launched xpra process tree whose exit is always reaped.
//
// Exactly one goroutine (spawned by startReaped) calls Wait on the underlying
// exec.Cmd. Everything else observes the exit through Done(). This is the only
// safe shape: exec.Cmd.Wait must not be called twice, and os.FindProcess+Wait
// on an already-reaped pid returns ECHILD (or worse, waits on a recycled pid).
type XpraProc struct {
	Pid     int
	done    chan struct{}
	waitErr error // written by the reaper goroutine before done is closed
}

// Done is closed once the process has exited AND been reaped (Wait returned).
func (p *XpraProc) Done() <-chan struct{} { return p.done }

// Exited reports (without blocking) whether the process has been reaped.
func (p *XpraProc) Exited() bool {
	select {
	case <-p.done:
		return true
	default:
		return false
	}
}

// ExitErr returns the error from Wait. Only valid after Done() is closed.
func (p *XpraProc) ExitErr() error {
	<-p.done
	return p.waitErr
}

// startReaped starts cmd and spawns the single reaper goroutine that owns
// cmd.Wait. logFile (may be nil) is closed once the child has exited so the
// parent does not leak one fd per session.
func startReaped(cmd *exec.Cmd, logFile *os.File) (*XpraProc, error) {
	if err := cmd.Start(); err != nil {
		if logFile != nil {
			logFile.Close()
		}
		return nil, err
	}
	p := &XpraProc{Pid: cmd.Process.Pid, done: make(chan struct{})}
	go func() {
		p.waitErr = cmd.Wait()
		if logFile != nil {
			logFile.Close()
		}
		close(p.done)
	}()
	return p, nil
}

func StartXpra(cfg XpraConfig) (*XpraProc, error) {
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
		// When WinBox exits (quit, crash, segfault) the xpra server exits
		// too. With --daemon=no that exit is our own child exiting, so the
		// reaper goroutine sees it and session cleanup runs immediately.
		"--exit-with-children",
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

	proc, err := startReaped(cmd, f)
	if err != nil {
		return nil, fmt.Errorf("xpra start failed: %w", err)
	}
	return proc, nil
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

// XpraStatus is the parsed subset of `xpra info` we act on.
type XpraStatus struct {
	// Clients is the number of attached clients, or -1 if it could not be
	// determined (xpra info failed or output was unparseable).
	Clients int
	// IdleSeconds is the attached client's idle time (client.idle_time), or
	// -1 when unknown. xpra omits client.* fields entirely when clients=0,
	// so -1 with Clients==0 is the normal disconnected shape.
	IdleSeconds int
}

var xpraQueryFailures atomic.Int64

// XpraQueryFailureCount reports how many times querying/parsing `xpra info`
// has failed since process start. Exposed on /healthz so a silently broken
// idle/disconnect probe is visible instead of quietly returning -1 forever.
func XpraQueryFailureCount() int64 { return xpraQueryFailures.Load() }

// parseXpraInfo extracts clients= and client.idle_time= from `xpra info`
// output. Verified against xpra 3.1.5: output is dot-namespaced key=value
// lines; `clients=N` is present in every state, while `client.idle_time=N`
// exists only while a client is attached. There is no bare `idle_time=` field
// (the historical code matched that prefix and therefore never parsed
// anything; the only near-miss is `features.idle_timeout=`, a config value).
func parseXpraInfo(out []byte) XpraStatus {
	st := XpraStatus{Clients: -1, IdleSeconds: -1}
	for _, line := range strings.Split(string(out), "\n") {
		line = strings.TrimSpace(line)
		if v, ok := strings.CutPrefix(line, "clients="); ok {
			if n, err := strconv.Atoi(strings.TrimSpace(v)); err == nil {
				st.Clients = n
			}
		} else if v, ok := strings.CutPrefix(line, "client.idle_time="); ok {
			if n, err := strconv.Atoi(strings.TrimSpace(v)); err == nil {
				st.IdleSeconds = n
			}
		}
	}
	return st
}

// QueryXpraStatus runs `xpra info` for the display and parses it. Failures
// are logged at WARN and counted; they were previously silent, which is how a
// probe that never matched anything went unnoticed for months.
func QueryXpraStatus(display int) XpraStatus {
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	cmd := exec.CommandContext(ctx, "xpra", "info", fmt.Sprintf(":%d", display))
	out, err := cmd.Output()
	if err != nil {
		xpraQueryFailures.Add(1)
		slog.Warn("xpra info query failed", "display", display, "err", err,
			"total_failures", xpraQueryFailures.Load())
		return XpraStatus{Clients: -1, IdleSeconds: -1}
	}
	st := parseXpraInfo(out)
	if st.Clients < 0 {
		xpraQueryFailures.Add(1)
		slog.Warn("xpra info output missing clients= field", "display", display,
			"bytes", len(out), "total_failures", xpraQueryFailures.Load())
	}
	return st
}

// KillXpraSession escalates SIGTERM -> (5s) -> SIGKILL against the process
// group and waits for the reaper goroutine (via proc.Done()) to confirm the
// exit. It never calls Wait itself: the single reaper owns that.
func KillXpraSession(proc *XpraProc) error {
	if proc.Exited() {
		return nil
	}

	if err := syscall.Kill(-proc.Pid, syscall.SIGTERM); err != nil {
		slog.Warn("SIGTERM to xpra process group failed", "pid", proc.Pid, "err", err)
	}

	select {
	case <-proc.Done():
		return nil
	case <-time.After(5 * time.Second):
		slog.Warn("SIGKILL to xpra process group", "pid", proc.Pid)
		err := syscall.Kill(-proc.Pid, syscall.SIGKILL)
		select {
		case <-proc.Done():
		case <-time.After(5 * time.Second):
			slog.Error("xpra process not reaped after SIGKILL", "pid", proc.Pid)
		}
		return err
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
