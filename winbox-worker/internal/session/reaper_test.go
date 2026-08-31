package session

import (
	"context"
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

// The shipped container runs the worker as PID 1 (ENTRYPOINT, no init), so
// when an xpra leader dies its survivors — Xvfb above all — reparent to the
// worker, and nothing else will ever wait() on their corpses. The worker must
// therefore reap orphan zombies itself. It must do so WITHOUT wait4(-1),
// which would steal exit statuses from os/exec's own Wait calls; instead it
// scans /proc for zombies that are (a) our children and (b) not managed by
// os/exec, and waits on exactly those pids.

func writeStat(t *testing.T, procRoot string, pid int, comm string, state byte, ppid int) {
	t.Helper()
	d := filepath.Join(procRoot, strconv.Itoa(pid))
	if err := os.MkdirAll(d, 0755); err != nil {
		t.Fatal(err)
	}
	// Real /proc/<pid>/stat shape: comm is parenthesised and may itself
	// contain spaces and parentheses; state and ppid follow the LAST ')'.
	line := fmt.Sprintf("%d (%s) %c %d %d 0 0 -1 4194304 0\n", pid, comm, state, ppid, pid)
	if err := os.WriteFile(filepath.Join(d, "stat"), []byte(line), 0644); err != nil {
		t.Fatal(err)
	}
}

func TestProcStatParsesStateAndPpid(t *testing.T) {
	procRoot := t.TempDir()
	writeStat(t, procRoot, 77, "weird (name) with) parens", 'Z', 4242)
	state, ppid, err := procStat(procRoot, 77)
	if err != nil {
		t.Fatalf("procStat: %v", err)
	}
	if state != 'Z' || ppid != 4242 {
		t.Fatalf("expected state Z ppid 4242, got %c %d", state, ppid)
	}
}

func TestProcStatMissingAndGarbage(t *testing.T) {
	procRoot := t.TempDir()
	if _, _, err := procStat(procRoot, 99); err == nil {
		t.Fatal("expected error for missing stat")
	}
	d := filepath.Join(procRoot, "98")
	os.MkdirAll(d, 0755)
	os.WriteFile(filepath.Join(d, "stat"), []byte("garbage with no parens\n"), 0644)
	if _, _, err := procStat(procRoot, 98); err == nil {
		t.Fatal("expected error for unparseable stat")
	}
}

func TestZombieOrphansSelectsOnlyUnmanagedZombieChildren(t *testing.T) {
	const self = 4242
	procRoot := t.TempDir()
	writeStat(t, procRoot, 101, "Xvfb", 'Z', self) // orphan zombie: selected
	writeStat(t, procRoot, 102, "Xvfb", 'Z', 999)  // someone else's child: skipped
	writeStat(t, procRoot, 103, "Xvfb", 'S', self) // alive: skipped
	writeStat(t, procRoot, 104, "xpra", 'Z', self) // managed by os/exec: skipped
	registerManaged(104)
	defer unregisterManaged(104)
	os.MkdirAll(filepath.Join(procRoot, "notapid"), 0755) // non-numeric: skipped
	os.MkdirAll(filepath.Join(procRoot, "105"), 0755)     // no stat file: skipped

	got := zombieOrphans(procRoot, self)
	if len(got) != 1 || got[0] != 101 {
		t.Fatalf("expected [101], got %v", got)
	}
}

func TestReapPidsCollectsRealZombie(t *testing.T) {
	// A real un-Waited exited child of ours: a genuine zombie on any POSIX
	// system. reapPids must collect it so it vanishes from the process table.
	cmd := exec.Command("/bin/sh", "-c", "exit 0")
	if err := cmd.Start(); err != nil {
		t.Fatal(err)
	}
	pid := cmd.Process.Pid // deliberately never cmd.Wait()ed

	waitFor(t, 5*time.Second, "zombie to be reaped by reapPids", func() bool {
		reapPids([]int{pid})
		return errors.Is(syscall.Kill(pid, 0), syscall.ESRCH)
	})
}

func TestManagedRegistryTracksChildLifetime(t *testing.T) {
	cmd := exec.Command("/bin/sh", "-c", "sleep 0.2")
	p, err := startReaped(cmd, nil)
	if err != nil {
		t.Fatal(err)
	}
	if !isManaged(p.Pid) {
		t.Fatal("running child not registered as managed")
	}
	<-p.Done()
	if isManaged(p.Pid) {
		t.Fatal("reaped child still registered as managed")
	}
}

func TestOrphanReaperReapsOnSigchld(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	// Real zombie (un-Waited exited child, not managed) plus a fake /proc
	// entry describing it, since darwin has no /proc to scan.
	cmd := exec.Command("/bin/sh", "-c", "exit 0")
	if err := cmd.Start(); err != nil {
		t.Fatal(err)
	}
	pid := cmd.Process.Pid
	procRoot := t.TempDir()
	writeStat(t, procRoot, pid, "sh", 'Z', os.Getpid())

	go runOrphanReaper(ctx, procRoot, 50*time.Millisecond)

	waitFor(t, 5*time.Second, "orphan reaper to collect the zombie", func() bool {
		syscall.Kill(os.Getpid(), syscall.SIGCHLD) // nudge, in case the child's own SIGCHLD predated Notify
		return errors.Is(syscall.Kill(pid, 0), syscall.ESRCH)
	})
}
