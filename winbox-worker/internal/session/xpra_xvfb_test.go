package session

import (
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"syscall"
	"testing"
	"time"
)

// The X server writes its pid (space-padded, newline-terminated) into
// /tmp/.X<display>-lock. That pid is how we find an orphaned Xvfb, since xpra
// spawns it into its own process group where the leader's group signal cannot
// reach it.

func TestXvfbLockPidParsesPaddedPid(t *testing.T) {
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, ".X100-lock"), []byte("      1234\n"), 0644); err != nil {
		t.Fatal(err)
	}
	pid, err := xvfbLockPid(dir, 100)
	if err != nil {
		t.Fatalf("xvfbLockPid: %v", err)
	}
	if pid != 1234 {
		t.Fatalf("expected pid 1234, got %d", pid)
	}
}

func TestXvfbLockPidRejectsGarbageAndMissing(t *testing.T) {
	dir := t.TempDir()
	if _, err := xvfbLockPid(dir, 100); err == nil {
		t.Fatal("expected error for missing lock file")
	}
	os.WriteFile(filepath.Join(dir, ".X101-lock"), []byte("not-a-pid\n"), 0644)
	if _, err := xvfbLockPid(dir, 101); err == nil {
		t.Fatal("expected error for garbage lock file")
	}
	os.WriteFile(filepath.Join(dir, ".X102-lock"), []byte("0\n"), 0644)
	if _, err := xvfbLockPid(dir, 102); err == nil {
		t.Fatal("expected error for pid 0")
	}
}

// startVictim launches a reaped throwaway process and returns its pid.
func startVictim(t *testing.T) int {
	t.Helper()
	cmd := exec.Command("sleep", "60")
	p, err := startReaped(cmd, nil)
	if err != nil {
		t.Fatalf("start victim: %v", err)
	}
	t.Cleanup(func() { syscall.Kill(p.Pid, syscall.SIGKILL) })
	return p.Pid
}

// writeFakeProc creates <procRoot>/<pid>/comm with the given contents,
// mimicking Linux /proc for the recycled-pid guard.
func writeFakeProc(t *testing.T, procRoot string, pid int, comm string) {
	t.Helper()
	d := filepath.Join(procRoot, strconv.Itoa(pid))
	if err := os.MkdirAll(d, 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(d, "comm"), []byte(comm+"\n"), 0644); err != nil {
		t.Fatal(err)
	}
}

func TestKillOrphanXvfbRefusesRecycledPid(t *testing.T) {
	lockDir, procRoot := t.TempDir(), t.TempDir()
	pid := startVictim(t)
	os.WriteFile(filepath.Join(lockDir, ".X100-lock"), []byte(fmt.Sprintf("%10d\n", pid)), 0644)
	// The lock names our pid, but /proc says the pid now belongs to
	// something that is NOT Xvfb: a stale lock + recycled pid. Must not kill.
	writeFakeProc(t, procRoot, pid, "innocent-bystander")

	killOrphanXvfb(lockDir, procRoot, 100)

	time.Sleep(100 * time.Millisecond)
	if errors.Is(syscall.Kill(pid, 0), syscall.ESRCH) {
		t.Fatal("killOrphanXvfb killed a process whose comm is not Xvfb")
	}
}

func TestKillOrphanXvfbKillsVerifiedXvfb(t *testing.T) {
	lockDir, procRoot := t.TempDir(), t.TempDir()
	pid := startVictim(t)
	os.WriteFile(filepath.Join(lockDir, ".X100-lock"), []byte(fmt.Sprintf("%10d\n", pid)), 0644)
	writeFakeProc(t, procRoot, pid, "Xvfb")

	killOrphanXvfb(lockDir, procRoot, 100)

	waitFor(t, 5*time.Second, "verified Xvfb to be killed", func() bool {
		return errors.Is(syscall.Kill(pid, 0), syscall.ESRCH)
	})
}

func TestKillOrphanXvfbNoLockFileIsNoop(t *testing.T) {
	killOrphanXvfb(t.TempDir(), t.TempDir(), 100) // must not panic or block
}

// When the worker is PID 1, a killed Xvfb reparents to us and sits as a
// zombie until reaped: kill(pid, 0) keeps succeeding, so a liveness loop
// keyed on it alone burns the full TERM grace and then SIGKILLs a corpse.
// The wait loop must recognise the zombie state and stop immediately.
func TestKillOrphanXvfbStopsWaitingOnZombie(t *testing.T) {
	lockDir, procRoot := t.TempDir(), t.TempDir()
	// The victim ignores SIGTERM: if the loop treats it as live it will
	// exhaust the full 2s grace and SIGKILL it. The fake /proc says it is a
	// zombie, so the sweep must return quickly and send no SIGKILL.
	ready := filepath.Join(t.TempDir(), "ready")
	cmd := exec.Command("/bin/sh", "-c", `trap '' TERM; : > `+ready+`; sleep 60; true`)
	p, err := startReaped(cmd, nil)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { syscall.Kill(p.Pid, syscall.SIGKILL) })
	pid := p.Pid
	waitFor(t, 5*time.Second, "victim to install its TERM trap", func() bool {
		_, err := os.Stat(ready)
		return err == nil
	})

	os.WriteFile(filepath.Join(lockDir, ".X100-lock"), []byte(fmt.Sprintf("%10d\n", pid)), 0644)
	writeFakeProc(t, procRoot, pid, "Xvfb")
	writeStat(t, procRoot, pid, "Xvfb", 'Z', os.Getpid())

	start := time.Now()
	killOrphanXvfb(lockDir, procRoot, 100)
	if elapsed := time.Since(start); elapsed > time.Second {
		t.Fatalf("burned %s waiting on a zombie", elapsed)
	}
	time.Sleep(100 * time.Millisecond)
	if errors.Is(syscall.Kill(pid, 0), syscall.ESRCH) {
		t.Fatal("SIGKILL was sent to what /proc reported as a zombie")
	}
}
