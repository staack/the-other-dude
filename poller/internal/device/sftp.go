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
//
// privateKey is an unencrypted PEM private key, or empty for password-only
// auth; when present it is offered before the password.
//
// knownFingerprint is a previously pinned "SHA256:base64(...)" host key
// fingerprint, or empty for a first connect. Host key verification uses the
// same Trust-On-First-Use policy as RunCommand: a first connect accepts the
// key and reports it, and a later mismatch is rejected. The observed
// fingerprint is returned so the caller can persist it on first connect.
func NewSSHClient(ip string, port int, username, password, privateKey, knownFingerprint string,
	timeout time.Duration) (*ssh.Client, string, error) {

	authMethods, err := SSHAuthMethods(password, privateKey)
	if err != nil {
		return nil, "", err
	}

	cb, fpCh := tofuHostKeyCallback(knownFingerprint)

	config := &ssh.ClientConfig{
		User:            username,
		Auth:            authMethods,
		HostKeyCallback: cb,
		Timeout:         timeout,
	}
	addr := fmt.Sprintf("%s:%d", ip, port)
	client, err := ssh.Dial("tcp", addr, config)

	// The callback runs during the handshake, so a fingerprint is available
	// even when the handshake is then rejected.
	var observedFP string
	select {
	case fp := <-fpCh:
		observedFP = fp
	default:
	}

	if err != nil {
		return nil, observedFP, fmt.Errorf("SSH dial to %s: %w", addr, err)
	}
	return client, observedFP, nil
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
