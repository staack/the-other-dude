package session

import (
	"context"
	"fmt"
	"log/slog"
	"os"
	"os/exec"
	"os/signal"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"time"
)

// The shipped container runs the worker binary as PID 1 (bare ENTRYPOINT),
// so when an xpra leader dies its survivors — Xvfb above all — reparent to
// the worker, and nothing else will ever wait() on their corpses. Compose now
// also sets init:true, but the worker must not depend on how it is launched:
// it reaps orphan zombies itself.
//
// It deliberately does NOT wait4(-1, WNOHANG) on SIGCHLD: -1 collects
// whichever child exits next, so every cmd.Wait in the process (the
// per-session reaper goroutines, the xpra info probes) would race the
// sweeper for its own child's status and lose with ECHILD. Instead the
// sweeper scans /proc for processes that are (a) zombies, (b) OUR children
// and (c) not registered as managed by os/exec, and wait4()s exactly those.

// managedPids tracks every child pid this process has spawned through
// os/exec and not yet finished Waiting on, so the orphan sweep never touches
// a corpse some cmd.Wait is entitled to.
var managedPids sync.Map

func registerManaged(pid int)   { managedPids.Store(pid, struct{}{}) }
func unregisterManaged(pid int) { managedPids.Delete(pid) }
func isManaged(pid int) bool    { _, ok := managedPids.Load(pid); return ok }

// runManaged runs a one-shot command to completion with its pid registered,
// closing the window in which the orphan sweep could mistake its brief
// zombie phase for an orphan and steal the status out from under Wait.
func runManaged(cmd *exec.Cmd) error {
	if err := cmd.Start(); err != nil {
		return err
	}
	registerManaged(cmd.Process.Pid)
	defer unregisterManaged(cmd.Process.Pid)
	return cmd.Wait()
}

// procStat parses <procRoot>/<pid>/stat and returns the process state byte
// and parent pid. The comm field is parenthesised and may itself contain
// spaces and parentheses, so parsing starts after the LAST ')'.
func procStat(procRoot string, pid int) (state byte, ppid int, err error) {
	b, err := os.ReadFile(filepath.Join(procRoot, strconv.Itoa(pid), "stat"))
	if err != nil {
		return 0, 0, err
	}
	s := string(b)
	i := strings.LastIndexByte(s, ')')
	if i < 0 {
		return 0, 0, fmt.Errorf("unparseable stat for pid %d", pid)
	}
	fields := strings.Fields(s[i+1:])
	if len(fields) < 2 || len(fields[0]) != 1 {
		return 0, 0, fmt.Errorf("unparseable stat for pid %d", pid)
	}
	ppid, err = strconv.Atoi(fields[1])
	if err != nil {
		return 0, 0, fmt.Errorf("unparseable ppid for pid %d: %w", pid, err)
	}
	return fields[0][0], ppid, nil
}

// zombieOrphans scans procRoot for zombie children of self that os/exec is
// not managing: the corpses only we can — and must — collect.
func zombieOrphans(procRoot string, self int) []int {
	entries, err := os.ReadDir(procRoot)
	if err != nil {
		return nil
	}
	var pids []int
	for _, e := range entries {
		pid, err := strconv.Atoi(e.Name())
		if err != nil {
			continue
		}
		state, ppid, err := procStat(procRoot, pid)
		if err != nil || state != 'Z' || ppid != self || isManaged(pid) {
			continue
		}
		pids = append(pids, pid)
	}
	return pids
}

// reapPids wait4(WNOHANG)s each pid and reports how many were collected.
// WNOHANG on a still-running child returns 0 without consuming anything, and
// a pid that is not our child fails with ECHILD, so a stale candidate list
// is harmless.
func reapPids(pids []int) int {
	reaped := 0
	for _, pid := range pids {
		var ws syscall.WaitStatus
		got, err := syscall.Wait4(pid, &ws, syscall.WNOHANG, nil)
		if err == nil && got == pid {
			slog.Info("reaped orphan zombie", "pid", pid, "status", ws.ExitStatus())
			reaped++
		}
	}
	return reaped
}

// runOrphanReaper sweeps on every SIGCHLD burst and on a backstop tick until
// ctx is cancelled.
func runOrphanReaper(ctx context.Context, procRoot string, tick time.Duration) {
	sig := make(chan os.Signal, 1)
	signal.Notify(sig, syscall.SIGCHLD)
	defer signal.Stop(sig)
	ticker := time.NewTicker(tick)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-sig:
		case <-ticker.C:
		}
		reapPids(zombieOrphans(procRoot, os.Getpid()))
	}
}

// RunOrphanReaper is the production entry point (real /proc, 30s backstop).
func RunOrphanReaper(ctx context.Context) {
	runOrphanReaper(ctx, "/proc", 30*time.Second)
}
