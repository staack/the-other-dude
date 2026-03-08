// Package device provides SFTP file upload helpers for RouterOS devices.
//
// RouterOS has a built-in SSH/SFTP server (port 22) that accepts the same
// credentials as the API. Since the RouterOS binary API cannot upload files,
// SFTP is used to push certificate PEM files before importing them.
package device

import (
	"fmt"
	"time"

	"github.com/pkg/sftp"
	"golang.org/x/crypto/ssh"
)

// NewSSHClient creates an SSH connection to a RouterOS device.
// Uses password authentication (same credentials as API access).
func NewSSHClient(ip string, port int, username, password string, timeout time.Duration) (*ssh.Client, error) {
	config := &ssh.ClientConfig{
		User: username,
		Auth: []ssh.AuthMethod{
			ssh.Password(password),
		},
		HostKeyCallback: ssh.InsecureIgnoreHostKey(), //nolint:gosec // RouterOS self-signed SSH
		Timeout:         timeout,
	}
	addr := fmt.Sprintf("%s:%d", ip, port)
	client, err := ssh.Dial("tcp", addr, config)
	if err != nil {
		return nil, fmt.Errorf("SSH dial to %s: %w", addr, err)
	}
	return client, nil
}

// UploadFile uploads data to a file on the RouterOS device via SFTP.
func UploadFile(sshClient *ssh.Client, remotePath string, data []byte) error {
	client, err := sftp.NewClient(sshClient)
	if err != nil {
		return fmt.Errorf("creating SFTP client: %w", err)
	}
	defer client.Close()

	f, err := client.Create(remotePath)
	if err != nil {
		return fmt.Errorf("creating remote file %s: %w", remotePath, err)
	}
	defer f.Close()

	if _, err := f.Write(data); err != nil {
		return fmt.Errorf("writing to %s: %w", remotePath, err)
	}
	return nil
}
