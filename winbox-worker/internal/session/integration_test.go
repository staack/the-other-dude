package session

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"syscall"
	"testing"
	"time"
)

// Phase 22 criterion 13: session count and actual live-process count must be
// asserted equal in an integration test that opens, abandons, and force-kills
// sessions. This is the test that would have caught the original leak, whose
// failure mode was precisely "worker reports the slot free while ~300MB of
// session processes are still alive".
//
// Each session's process tree is a leader plus a forked survivor in the same
// process group (standing in for WinBox under the real xpra leader). The
// leader writes both pids to a control dir, then idles until either told to
// exit cleanly or killed. After every termination path the test asserts that
// the manager's reported count dropped AND that the dead session's entire
// tree is really gone — a live survivor with a freed slot is the defect.

type sessionProcs struct {
	leader, survivor int
}

func readPid(t *testing.T, path string) int {
	t.Helper()
	var pid int
	waitFor(t, 5*time.Second, "pid file "+path, func() bool {
		b, err := os.ReadFile(path)
		if err != nil {
			return false
		}
		n, err := strconv.Atoi(strings.TrimSpace(string(b)))
		if err != nil || n <= 1 {
			return false
		}
		pid = n
		return true
	})
	return pid
}

func alive(pid int) bool {
	return !errors.Is(syscall.Kill(pid, 0), syscall.ESRCH)
}

// liveSessionProcs counts how many of the given sessions still have at least
// one live process.
func liveSessionProcs(procs []sessionProcs) int {
	n := 0
	for _, p := range procs {
		if alive(p.leader) || alive(p.survivor) {
			n++
		}
	}
	return n
}

func assertCountsAgree(t *testing.T, m *Manager, procs []sessionProcs, want int, when string) {
	t.Helper()
	waitFor(t, 5*time.Second, fmt.Sprintf("%s: reported and live counts to reach %d", when, want), func() bool {
		return m.SessionCount() == want && len(m.ListSessions()) == want && liveSessionProcs(procs) == want
	})
}

func TestSessionCountMatchesLiveProcessCount(t *testing.T) {
	ctl := t.TempDir()
	fake := &fakeStatus{}
	fake.set(0, -1) // nobody ever attaches to any of these sessions

	// The leader records itself and a same-group survivor, then idles until
	// $ctl/stop.<leaderpid> appears (clean exit) or it is killed.
	script := fmt.Sprintf(
		`sleep 300 & echo $! > %[1]s/surv.$$; echo $$ > %[1]s/lead.$$; `+
			`while :; do [ -f %[1]s/stop.$$ ] && exit 0; sleep 0.05; done`, ctl)

	m := newTestManager(t, 10*time.Second, script, fake, nil)
	m.cfg.FirstConnectTimeout = 50 * time.Millisecond // only enforced when checkTimeouts runs

	var ids []string
	var procs []sessionProcs
	for i := 0; i < 3; i++ {
		id := mustCreate(t, m)
		ids = append(ids, id)
	}
	// Leader pids are the sessions' XpraPIDs; survivors come from the ctl dir.
	for _, id := range ids {
		m.mu.Lock()
		sess := m.sessions[id]
		m.mu.Unlock()
		sess.mu.Lock()
		leader := sess.XpraPID
		sess.mu.Unlock()
		procs = append(procs, sessionProcs{
			leader:   leader,
			survivor: readPid(t, filepath.Join(ctl, fmt.Sprintf("surv.%d", leader))),
		})
	}

	assertCountsAgree(t, m, procs, 3, "all sessions open")

	// Path 1 — clean exit: the leader exits zero of its own accord (WinBox
	// quit under --exit-with-children). The exit watcher must tear the whole
	// tree down, survivor included.
	if err := os.WriteFile(filepath.Join(ctl, fmt.Sprintf("stop.%d", procs[0].leader)), nil, 0644); err != nil {
		t.Fatal(err)
	}
	assertCountsAgree(t, m, procs, 2, "after clean exit")
	if alive(procs[0].survivor) {
		t.Fatal("clean exit left its survivor process alive")
	}

	// Path 2 — force-kill: the leader is SIGKILLed from outside (crash/OOM).
	// This is the original ~300MB leak: leader reaped, survivor left alive,
	// slot reported free.
	if err := syscall.Kill(procs[1].leader, syscall.SIGKILL); err != nil {
		t.Fatalf("force-kill leader: %v", err)
	}
	assertCountsAgree(t, m, procs, 1, "after force-kill")
	if alive(procs[1].survivor) {
		t.Fatal("force-killed session left its survivor process alive (the ~300MB leak)")
	}

	// Path 3 — abandonment: the remaining session is never connected to and
	// never told to exit; the first-connect deadline reclaims it.
	time.Sleep(100 * time.Millisecond) // past FirstConnectTimeout
	m.checkTimeouts()
	assertCountsAgree(t, m, procs, 0, "after abandonment")
	if alive(procs[2].survivor) || alive(procs[2].leader) {
		t.Fatal("abandoned session left processes alive")
	}

	if !poolsFull(m) {
		t.Fatal("pools not refilled after all sessions terminated")
	}
}
