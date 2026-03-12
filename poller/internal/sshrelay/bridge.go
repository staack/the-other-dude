package sshrelay

import (
	"context"
	"encoding/json"
	"io"
	"sync/atomic"
	"time"

	"golang.org/x/crypto/ssh"
	"nhooyr.io/websocket"
)

type ControlMsg struct {
	Type string `json:"type"`
	Cols int    `json:"cols"`
	Rows int    `json:"rows"`
}

func bridge(ctx context.Context, cancel context.CancelFunc, ws *websocket.Conn,
	sshSess *ssh.Session, stdin io.WriteCloser, stdout, stderr io.Reader, lastActive *int64) {

	// WebSocket → SSH stdin
	go func() {
		defer cancel()
		for {
			typ, data, err := ws.Read(ctx)
			if err != nil {
				return
			}
			atomic.StoreInt64(lastActive, time.Now().UnixNano())

			if typ == websocket.MessageText {
				var ctrl ControlMsg
				if json.Unmarshal(data, &ctrl) != nil {
					continue
				}
				if ctrl.Type == "resize" && ctrl.Cols > 0 && ctrl.Cols <= 500 && ctrl.Rows > 0 && ctrl.Rows <= 200 {
					sshSess.WindowChange(ctrl.Rows, ctrl.Cols)
				}
				continue
			}
			stdin.Write(data)
		}
	}()

	// SSH stdout → WebSocket
	go func() {
		defer cancel()
		buf := make([]byte, 4096)
		for {
			n, err := stdout.Read(buf)
			if err != nil {
				return
			}
			atomic.StoreInt64(lastActive, time.Now().UnixNano())
			ws.Write(ctx, websocket.MessageBinary, buf[:n])
		}
	}()

	// SSH stderr → WebSocket
	go func() {
		defer cancel()
		buf := make([]byte, 4096)
		for {
			n, err := stderr.Read(buf)
			if err != nil {
				return
			}
			ws.Write(ctx, websocket.MessageBinary, buf[:n])
		}
	}()

	<-ctx.Done()
}
