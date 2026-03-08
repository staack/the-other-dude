package device

import (
	"errors"
	"strings"

	routeros "github.com/go-routeros/routeros/v3"
)

// CommandRequest is the JSON payload received from the Python backend via NATS.
type CommandRequest struct {
	DeviceID string   `json:"device_id"`
	Command  string   `json:"command"`
	Args     []string `json:"args"`
}

// CommandResponse is the JSON payload returned to the Python backend via NATS.
type CommandResponse struct {
	Success bool                `json:"success"`
	Data    []map[string]string `json:"data"`
	Error   string              `json:"error,omitempty"`
}

// ExecuteCommand runs an arbitrary RouterOS API command on a connected device.
// The command string is the full path (e.g., "/ip/address/print").
// Args are optional RouterOS API arguments (e.g., "=.proplist=.id,address").
func ExecuteCommand(client *routeros.Client, command string, args []string) CommandResponse {
	cmdParts := make([]string, 0, 1+len(args))
	cmdParts = append(cmdParts, command)
	cmdParts = append(cmdParts, args...)

	reply, err := client.Run(cmdParts...)
	if err != nil {
		// RouterOS 7.x returns !empty for empty results (e.g., no firewall rules).
		// go-routeros/v3 doesn't recognize this word and returns UnknownReplyError.
		// Treat !empty as a successful empty response.
		var unkErr *routeros.UnknownReplyError
		if errors.As(err, &unkErr) && strings.TrimPrefix(unkErr.Sentence.Word, "!") == "empty" {
			return CommandResponse{Success: true, Data: []map[string]string{}}
		}
		return CommandResponse{Success: false, Data: nil, Error: err.Error()}
	}

	data := make([]map[string]string, 0, len(reply.Re))
	for _, re := range reply.Re {
		data = append(data, re.Map)
	}

	return CommandResponse{Success: true, Data: data}
}
