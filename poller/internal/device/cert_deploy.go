// Package device provides the full certificate deployment flow for RouterOS devices.
//
// The deployment follows these steps:
//  1. Upload cert.pem and key.pem via SFTP
//  2. Import the certificate via RouterOS API (/certificate/import)
//  3. Import the private key via RouterOS API (/certificate/import)
//  4. Determine the certificate name on device
//  5. Assign the certificate to the api-ssl service (/ip/service/set)
//  6. Clean up uploaded PEM files from device filesystem (/file/remove)
package device

import (
	"fmt"
	"log/slog"

	routeros "github.com/go-routeros/routeros/v3"
	"golang.org/x/crypto/ssh"
)

// CertDeployRequest is the NATS request payload for certificate deployment.
type CertDeployRequest struct {
	DeviceID string `json:"device_id"`
	CertPEM  string `json:"cert_pem"`
	KeyPEM   string `json:"key_pem"`
	CertName string `json:"cert_name"` // e.g., "portal-device-cert"
	SSHPort  int    `json:"ssh_port"`
}

// CertDeployResponse is the NATS reply payload.
type CertDeployResponse struct {
	Success          bool   `json:"success"`
	CertNameOnDevice string `json:"cert_name_on_device,omitempty"`
	Error            string `json:"error,omitempty"`
}

// DeployCert performs the full certificate deployment flow:
//  1. Upload cert.pem and key.pem files via SFTP
//  2. Import certificate via RouterOS API
//  3. Import key via RouterOS API
//  4. Assign certificate to api-ssl service
//  5. Clean up uploaded PEM files from device filesystem
func DeployCert(sshClient *ssh.Client, apiClient *routeros.Client, req CertDeployRequest) CertDeployResponse {
	certFile := req.CertName + ".pem"
	keyFile := req.CertName + "-key.pem"

	// Step 1: Upload cert via SFTP
	slog.Debug("uploading cert file via SFTP", "file", certFile, "device_id", req.DeviceID)
	if err := UploadFile(sshClient, certFile, []byte(req.CertPEM)); err != nil {
		return CertDeployResponse{Success: false, Error: fmt.Sprintf("SFTP cert upload: %s", err)}
	}

	// Step 2: Upload key via SFTP
	slog.Debug("uploading key file via SFTP", "file", keyFile, "device_id", req.DeviceID)
	if err := UploadFile(sshClient, keyFile, []byte(req.KeyPEM)); err != nil {
		return CertDeployResponse{Success: false, Error: fmt.Sprintf("SFTP key upload: %s", err)}
	}

	// Step 3: Import certificate
	slog.Debug("importing certificate", "file", certFile, "device_id", req.DeviceID)
	importResult := ExecuteCommand(apiClient, "/certificate/import", []string{
		"=file-name=" + certFile,
	})
	if !importResult.Success {
		return CertDeployResponse{Success: false, Error: fmt.Sprintf("cert import: %s", importResult.Error)}
	}

	// Step 4: Import private key
	slog.Debug("importing private key", "file", keyFile, "device_id", req.DeviceID)
	keyImportResult := ExecuteCommand(apiClient, "/certificate/import", []string{
		"=file-name=" + keyFile,
	})
	if !keyImportResult.Success {
		return CertDeployResponse{Success: false, Error: fmt.Sprintf("key import: %s", keyImportResult.Error)}
	}

	// Determine the certificate name on device.
	// RouterOS names imported certs as <filename>_0 by convention.
	// Query to find the actual name by looking for certs with a private key.
	certNameOnDevice := certFile + "_0"
	printResult := ExecuteCommand(apiClient, "/certificate/print", []string{
		"=.proplist=name,common-name,private-key",
	})
	if printResult.Success && len(printResult.Data) > 0 {
		// Use the last cert that has a private key (most recently imported)
		for _, entry := range printResult.Data {
			if name, ok := entry["name"]; ok {
				if pk, hasPK := entry["private-key"]; hasPK && pk == "true" {
					certNameOnDevice = name
				}
			}
		}
	}

	// Step 5: Assign to api-ssl service
	slog.Debug("assigning certificate to api-ssl", "cert_name", certNameOnDevice, "device_id", req.DeviceID)
	assignResult := ExecuteCommand(apiClient, "/ip/service/set", []string{
		"=numbers=api-ssl",
		"=certificate=" + certNameOnDevice,
	})
	if !assignResult.Success {
		slog.Warn("api-ssl assignment failed (cert still imported)",
			"device_id", req.DeviceID,
			"error", assignResult.Error,
		)
		// Don't fail entirely -- cert is imported, assignment can be retried
	}

	// Step 6: Clean up uploaded PEM files from device filesystem
	slog.Debug("cleaning up PEM files", "device_id", req.DeviceID)
	ExecuteCommand(apiClient, "/file/remove", []string{"=.id=" + certFile})
	ExecuteCommand(apiClient, "/file/remove", []string{"=.id=" + keyFile})
	// File cleanup failures are non-fatal

	slog.Info("certificate deployed successfully",
		"device_id", req.DeviceID,
		"cert_name", certNameOnDevice,
	)
	return CertDeployResponse{
		Success:          true,
		CertNameOnDevice: certNameOnDevice,
	}
}
