package device

import (
	"testing"
)

func TestParseSignalStrength(t *testing.T) {
	tests := []struct {
		name    string
		input   string
		want    int
		wantErr bool
	}{
		{name: "plain negative", input: "-67", want: -67},
		{name: "with 5GHz suffix", input: "-67@5GHz", want: -67},
		{name: "with 2.4GHz suffix", input: "-72@2.4GHz", want: -72},
		{name: "empty string", input: "", want: 0},
		{name: "invalid string", input: "abc", want: 0, wantErr: true},
		{name: "with HT40 suffix", input: "-67@HT40", want: -67},
		{name: "with HT20 suffix", input: "-55@HT20", want: -55},
		{name: "positive value", input: "10", want: 10},
		{name: "zero", input: "0", want: 0},
		{name: "with complex suffix", input: "-80@5GHz-Ce/a/ac/an", want: -80},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := ParseSignalStrength(tt.input)
			if (err != nil) != tt.wantErr {
				t.Errorf("ParseSignalStrength(%q) error = %v, wantErr %v", tt.input, err, tt.wantErr)
				return
			}
			if got != tt.want {
				t.Errorf("ParseSignalStrength(%q) = %d, want %d", tt.input, got, tt.want)
			}
		})
	}
}

func TestRegistrationEntryFields(t *testing.T) {
	// Compilation test: ensure RegistrationEntry has all required fields.
	entry := RegistrationEntry{
		Interface:        "wlan1",
		MacAddress:       "AA:BB:CC:DD:EE:FF",
		SignalStrength:   -67,
		TxCCQ:           95,
		TxRate:          "130Mbps",
		RxRate:          "130Mbps",
		Uptime:          "3d12h5m",
		Distance:        150,
		LastIP:          "192.168.1.100",
		TxSignalStrength: -65,
		Bytes:           "123456,789012",
	}
	if entry.Interface != "wlan1" {
		t.Error("Interface field not set correctly")
	}
	if entry.MacAddress != "AA:BB:CC:DD:EE:FF" {
		t.Error("MacAddress field not set correctly")
	}
	if entry.SignalStrength != -67 {
		t.Error("SignalStrength field not set correctly")
	}
}
