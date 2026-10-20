package sshrelay

import (
	"github.com/staack/the-other-dude/poller/internal/store"
	"testing"
)

func TestSSHAddress(t *testing.T) {
	for _, tc := range []struct {
		host string
		port int
		want string
	}{
		{"192.0.2.1", 65211, "192.0.2.1:65211"},
		{"192.0.2.1", 0, "192.0.2.1:22"},
		{"2001:db8::1", 2222, "[2001:db8::1]:2222"},
	} {
		if got := sshAddress(store.Device{IPAddress: tc.host, SSHPort: tc.port}); got != tc.want {
			t.Errorf("got %s, want %s", got, tc.want)
		}
	}
}
