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
	"sync"
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
//
// The anchor is a tiny helper process we place INTO the leader's process
// group at launch (see startGroupAnchor). Its whole job is to pin the pgid:
// POSIX guarantees a process group ID cannot be reused while the group has a
// live member, so as long as the anchor is alive, kill(-Pid, sig) provably
// signals OUR group — even long after the leader itself has exited and been
// reaped. Without it, a post-reap group signal could in principle hit an
// unrelated process group that recycled the number.
type XpraProc struct {
	Pid     int
	done    chan struct{}
	waitErr error // written by the reaper goroutine before done is closed

	anchor     *XpraProc // pgid pin; nil if the anchor failed to start
	anchorW    *os.File  // write end of the pipe the anchor blocks on
	anchorOnce sync.Once
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

// startPending starts cmd but does NOT begin reaping it: until the caller
// invokes beginReaping, the child — alive or already dead — stays un-Waited,
// which pins its pid (and thus its pgid) against recycling. That window is
// what lets startGroupAnchor join the leader's group provably, not just
// probably: setpgid against a reaped pid could hit a recycled group.
func startPending(cmd *exec.Cmd, logFile *os.File) (*XpraProc, error) {
	if err := cmd.Start(); err != nil {
		if logFile != nil {
			logFile.Close()
		}
		return nil, err
	}
	registerManaged(cmd.Process.Pid)
	return &XpraProc{Pid: cmd.Process.Pid, done: make(chan struct{})}, nil
}

// beginReaping spawns the single reaper goroutine that owns cmd.Wait.
// logFile (may be nil) is closed once the child has exited so the parent
// does not leak one fd per session.
func (p *XpraProc) beginReaping(cmd *exec.Cmd, logFile *os.File) {
	go func() {
		p.waitErr = cmd.Wait()
		unregisterManaged(p.Pid)
		if logFile != nil {
			logFile.Close()
		}
		close(p.done)
	}()
}

// startReaped is startPending + beginReaping for children that need no
// anchor (the anchor itself, one-shot helpers).
func startReaped(cmd *exec.Cmd, logFile *os.File) (*XpraProc, error) {
	p, err := startPending(cmd, logFile)
	if err != nil {
		return nil, err
	}
	p.beginReaping(cmd, logFile)
	return p, nil
}

// startGroupAnchor pins p's process group (see the XpraProc doc). Failure is
// non-fatal: p.anchor stays nil and post-reap group kills are skipped, which
// is exactly the pre-anchor behavior.
func startGroupAnchor(p *XpraProc) {
	r, w, err := os.Pipe()
	if err != nil {
		slog.Warn("group anchor: pipe failed; post-reap group kill disabled",
			"pid", p.Pid, "err", err)
		return
	}
	// The anchor must survive the group SIGTERM that KillXpraSession sends
	// (otherwise the pgid would be unpinned before the SIGKILL escalation),
	// so it ignores catchable termination signals and exits only on EOF —
	// when releaseAnchor closes the write end — or on the final group
	// SIGKILL. Either way its reaper goroutine (startReaped) collects it.
	cmd := exec.Command("/bin/sh", "-c", `trap '' TERM INT HUP QUIT; read _; exit 0`)
	cmd.Stdin = r
	cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true, Pgid: p.Pid}
	anchor, err := startReaped(cmd, nil)
	r.Close() // the child holds its own copy of the read end
	if err != nil {
		// A leader that died before the anchor could join its group lands
		// here: setpgid into an empty group fails.
		w.Close()
		slog.Warn("group anchor failed to start; post-reap group kill disabled",
			"pid", p.Pid, "err", err)
		return
	}
	p.anchor = anchor
	p.anchorW = w
	slog.Debug("group anchor armed", "leader_pid", p.Pid, "anchor_pid", anchor.Pid)
}

// releaseAnchor unpins the process group: closing the pipe's write end EOFs
// the anchor, which exits and is reaped by its own reaper goroutine. Safe to
// call multiple times and with no anchor armed.
func (p *XpraProc) releaseAnchor() {
	p.anchorOnce.Do(func() {
		if p.anchorW != nil {
			p.anchorW.Close()
			slog.Debug("group anchor released", "leader_pid", p.Pid, "anchor_pid", p.anchor.Pid)
		}
	})
}

// xvfbLockPid reads the X server lock file (<lockDir>/.X<display>-lock,
// written by Xvfb as a space-padded pid) and returns the pid it names.
func xvfbLockPid(lockDir string, display int) (int, error) {
	b, err := os.ReadFile(filepath.Join(lockDir, fmt.Sprintf(".X%d-lock", display)))
	if err != nil {
		return 0, err
	}
	pid, err := strconv.Atoi(strings.TrimSpace(string(b)))
	if err != nil {
		return 0, fmt.Errorf("unparseable X lock file for :%d: %w", display, err)
	}
	if pid <= 1 {
		return 0, fmt.Errorf("implausible pid %d in X lock file for :%d", pid, display)
	}
	return pid, nil
}

// pidCommIs reports whether <procRoot>/<pid>/comm names the expected
// executable. This is the guard that keeps a stale lock file or a recycled
// pid from getting an unrelated process killed.
func pidCommIs(procRoot string, pid int, want string) bool {
	b, err := os.ReadFile(filepath.Join(procRoot, strconv.Itoa(pid), "comm"))
	if err != nil {
		return false
	}
	return strings.TrimSpace(string(b)) == want
}

// killOrphanXvfb terminates the Xvfb serving the display, if one is still
// alive. xpra spawns Xvfb into its OWN process group (observed on live
// hardware), so the leader's group signal never reaches it; on the crash
// path it survives as a live ~250MB orphan. The pid comes from the X lock
// file and is verified against /proc before being signalled.
func killOrphanXvfb(lockDir, procRoot string, display int) {
	pid, err := xvfbLockPid(lockDir, display)
	if err != nil {
		// No lock file: no Xvfb, or it already exited cleanly.
		slog.Debug("xvfb sweep: no lock file", "display", display, "err", err)
		return
	}
	if !pidCommIs(procRoot, pid, "Xvfb") {
		// Stale lock / recycled pid: not ours to kill.
		slog.Debug("xvfb sweep: lock pid is not Xvfb, skipping", "display", display, "pid", pid)
		return
	}
	slog.Info("killing leftover Xvfb", "display", display, "pid", pid)
	syscall.Kill(pid, syscall.SIGTERM)
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		if syscall.Kill(pid, 0) != nil {
			return
		}
		// kill(pid, 0) succeeds against a zombie, so when the worker is
		// PID 1 and the corpse reparented to us the loop would otherwise
		// burn the whole grace and SIGKILL a dead process. A zombie is
		// done: collect it (harmless if it is not ours) and stop.
		if st, _, err := procStat(procRoot, pid); err == nil && st == 'Z' {
			slog.Debug("xvfb sweep: pid is a zombie, reaping instead of waiting", "display", display, "pid", pid)
			if !isManaged(pid) {
				reapPids([]int{pid})
			}
			return
		}
		time.Sleep(50 * time.Millisecond)
	}
	// Re-verify before the hard kill: the pid could in principle have been
	// recycled while we waited.
	if !pidCommIs(procRoot, pid, "Xvfb") {
		return
	}
	slog.Warn("Xvfb ignored SIGTERM, escalating to SIGKILL", "display", display, "pid", pid)
	syscall.Kill(pid, syscall.SIGKILL)
}

// KillXvfbForDisplay is the production entry point for killOrphanXvfb.
func KillXvfbForDisplay(display int) {
	killOrphanXvfb("/tmp", "/proc", display)
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

	proc, err := startPending(cmd, f)
	if err != nil {
		return nil, fmt.Errorf("xpra start failed: %w", err)
	}
	// Arm the anchor BEFORE the reaper starts: the un-Waited leader (alive
	// or zombie) pins its own pid, so the pgid startGroupAnchor joins is
	// provably ours. With reaping already underway there is a window where
	// the leader is collected, its pid recycled by a new group leader in our
	// session, and setpgid quietly anchors a stranger's group.
	startGroupAnchor(proc)
	proc.beginReaping(cmd, f)
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
	var buf strings.Builder
	cmd.Stdout = &buf
	err := runManaged(cmd)
	out := []byte(buf.String())
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
	// Unpin the process group once we are done, whichever path we took.
	defer proc.releaseAnchor()

	if proc.Exited() {
		// Crash path: the leader is already reaped, so its pid alone no
		// longer proves the group is ours — kill(-pid) could hit a recycled
		// pgid. The anchor is what makes this safe: while it lives the pgid
		// is provably still ours. SIGKILL outright: the session is already
		// dead and the survivors are leaderless leftovers (WinBox et al,
		// ~300MB live) with no state worth a graceful TERM. Xvfb is not in
		// this group and is swept separately (killOrphanXvfb).
		if proc.anchor == nil || proc.anchor.Exited() {
			return nil // nothing provably safe to signal
		}
		slog.Info("leader already reaped; killing surviving process group via anchor", "pid", proc.Pid)
		if err := syscall.Kill(-proc.Pid, syscall.SIGKILL); err != nil {
			slog.Warn("SIGKILL to anchored process group failed", "pid", proc.Pid, "err", err)
			return err
		}
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
