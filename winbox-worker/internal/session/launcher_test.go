package session

import (
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

// The device username and password must not appear in xpra's argv (visible
// in /proc/<pid>/cmdline to every process in the container) nor be split by
// xpra's whitespace parsing.  They go into an owner-only launcher inside the
// session's private directory, and xpra starts that.
func TestXpraArgsCarryNoCredentials(t *testing.T) {
	cfg := XpraConfig{Display: 101, WSPort: 10101, BindAddr: "127.0.0.1", TunnelHost: "tod_poller",
		TunnelPort: 49001, Username: "admin", Password: "s3cret pass'word", TmpDir: t.TempDir(), WinBoxPath: "/opt/winbox/WinBox"}

	launcher, err := writeLauncher(cfg)
	if err != nil {
		t.Fatal(err)
	}
	args := xpraArgs(cfg, launcher)

	joined := strings.Join(args, " ")
	if strings.Contains(joined, "admin") || strings.Contains(joined, "s3cret") {
		t.Fatalf("credentials present in xpra argv: %q", joined)
	}
	if !strings.Contains(joined, "--start-child="+launcher) {
		t.Fatalf("launcher not used as start-child: %q", joined)
	}
	info, err := os.Stat(launcher)
	if err != nil {
		t.Fatal(err)
	}
	if info.Mode().Perm() != 0o700 {
		t.Fatalf("launcher mode %o, want 0700", info.Mode().Perm())
	}
}

// The launcher hands WinBox exactly host:port, user, password, even when the
// password contains spaces and quotes.
func TestLauncherPassesCredentialsIntact(t *testing.T) {
	dir := t.TempDir()
	out := filepath.Join(dir, "argv.txt")
	fakeWinBox := filepath.Join(dir, "fakewinbox.sh")
	if err := os.WriteFile(fakeWinBox, []byte("#!/bin/sh\nprintf '%s\\n' \"$@\" > \"$WINBOX_ARGV_OUT\"\n"), 0o700); err != nil {
		t.Fatal(err)
	}
	cfg := XpraConfig{TunnelHost: "tod_poller", TunnelPort: 49001, Username: "ad min",
		Password: `p"a'ss $(x) \word`, TmpDir: dir, WinBoxPath: fakeWinBox}

	launcher, err := writeLauncher(cfg)
	if err != nil {
		t.Fatal(err)
	}
	cmd := exec.Command(launcher)
	cmd.Env = append(os.Environ(), "WINBOX_ARGV_OUT="+out)
	if outb, err := cmd.CombinedOutput(); err != nil {
		t.Fatalf("launcher failed: %v\n%s", err, outb)
	}
	got, err := os.ReadFile(out)
	if err != nil {
		t.Fatal(err)
	}
	want := "tod_poller:49001\nad min\n" + `p"a'ss $(x) \word` + "\n"
	if string(got) != want {
		t.Fatalf("WinBox argv:\n%q\nwant\n%q", got, want)
	}
	if _, err := os.Stat(launcher); !os.IsNotExist(err) {
		t.Fatalf("launcher still on disk after use (every session shares one uid): %v", err)
	}
}
