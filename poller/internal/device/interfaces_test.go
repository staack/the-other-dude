package device

import (
	"testing"
)

func TestInterfaceInfoFields(t *testing.T) {
	// Verify struct compiles with expected fields and JSON tags.
	info := InterfaceInfo{
		Name:       "ether1",
		MacAddress: "aa:bb:cc:dd:ee:ff",
		Type:       "ether",
		Running:    true,
	}

	if info.Name != "ether1" {
		t.Errorf("Name = %q, want %q", info.Name, "ether1")
	}
	if info.MacAddress != "aa:bb:cc:dd:ee:ff" {
		t.Errorf("MacAddress = %q, want %q", info.MacAddress, "aa:bb:cc:dd:ee:ff")
	}
	if info.Type != "ether" {
		t.Errorf("Type = %q, want %q", info.Type, "ether")
	}
	if !info.Running {
		t.Error("Running = false, want true")
	}
}

func TestInterfaceMACLowercasing(t *testing.T) {
	tests := []struct {
		name  string
		input string
		want  string
	}{
		{name: "already lowercase", input: "aa:bb:cc:dd:ee:ff", want: "aa:bb:cc:dd:ee:ff"},
		{name: "uppercase", input: "AA:BB:CC:DD:EE:FF", want: "aa:bb:cc:dd:ee:ff"},
		{name: "mixed case", input: "Aa:Bb:Cc:Dd:Ee:Ff", want: "aa:bb:cc:dd:ee:ff"},
		{name: "empty", input: "", want: ""},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := normalizeMACAddress(tt.input)
			if got != tt.want {
				t.Errorf("normalizeMACAddress(%q) = %q, want %q", tt.input, got, tt.want)
			}
		})
	}
}

func TestInterfaceRunningParsing(t *testing.T) {
	tests := []struct {
		name  string
		input string
		want  bool
	}{
		{name: "true string", input: "true", want: true},
		{name: "false string", input: "false", want: false},
		{name: "empty string", input: "", want: false},
		{name: "yes string", input: "yes", want: false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := parseRunning(tt.input)
			if got != tt.want {
				t.Errorf("parseRunning(%q) = %v, want %v", tt.input, got, tt.want)
			}
		})
	}
}
