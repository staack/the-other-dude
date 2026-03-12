package sshrelay

import (
	"context"
	"sync/atomic"
	"time"

	"golang.org/x/crypto/ssh"
)

type Session struct {
	ID         string
	DeviceID   string
	TenantID   string
	UserID     string
	SourceIP   string
	StartTime  time.Time
	LastActive int64 // atomic, unix nanoseconds
	sshClient  *ssh.Client
	sshSession *ssh.Session
	ptyCols    int
	ptyRows    int
	cancel     context.CancelFunc
}

func (s *Session) IdleDuration() time.Duration {
	return time.Since(time.Unix(0, atomic.LoadInt64(&s.LastActive)))
}
