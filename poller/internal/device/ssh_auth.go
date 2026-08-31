package device

import (
	"errors"
	"fmt"

	"golang.org/x/crypto/ssh"
)

// SSHAuthMethods builds the ordered SSH authentication methods for a device.
//
// The public key, when present, is offered before the password: the key is the
// credential a key-mandating customer configured, and the password is only a
// fallback for fleets mid-migration. RouterOS continues the authentication
// conversation after a rejected public key, so the fallback is genuinely
// reachable rather than theoretical.
//
// With no private key this returns exactly one ssh.Password method, which is
// byte-for-byte the behavior that existed before key support — password
// deployments are unaffected.
//
// privateKeyPEM must be unencrypted. Passphrases are stripped by the API at
// upload time and never persisted, so a passphrase-protected key arriving here
// is a bug and is reported as one.
func SSHAuthMethods(password, privateKeyPEM string) ([]ssh.AuthMethod, error) {
	var methods []ssh.AuthMethod

	if privateKeyPEM != "" {
		signer, err := ssh.ParsePrivateKey([]byte(privateKeyPEM))
		if err != nil {
			// Never include the key material or the underlying passphrase in
			// the error; these errors reach logs.
			var missing *ssh.PassphraseMissingError
			if errors.As(err, &missing) {
				return nil, errors.New(
					"parsing SSH private key: key is passphrase-protected, but stored keys must be " +
						"unencrypted (the passphrase is stripped at upload and never persisted)")
			}
			return nil, fmt.Errorf("parsing SSH private key: %w", err)
		}
		methods = append(methods, ssh.PublicKeys(signer))
	}

	if password != "" {
		methods = append(methods, ssh.Password(password))
	}

	if len(methods) == 0 {
		return nil, errors.New("no SSH credentials available: neither a private key nor a password")
	}

	return methods, nil
}
