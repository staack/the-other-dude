package device

import (
	"errors"
	routeros "github.com/go-routeros/routeros/v3"
	"github.com/go-routeros/routeros/v3/proto"
	"net"
	"reflect"
	"testing"
	"time"
)

type wirelessFake struct {
	replies  map[string][]map[string]string
	failures map[string]bool
	commands []string
}

func (f *wirelessFake) Run(args ...string) (*routeros.Reply, error) {
	f.commands = append(f.commands, args[0])
	if f.failures[args[0]] {
		return nil, errors.New("unsupported command")
	}
	reply := &routeros.Reply{}
	for _, row := range f.replies[args[0]] {
		reply.Re = append(reply.Re, &proto.Sentence{Map: row})
	}
	return reply, nil
}

func TestCollectWirelessIdleRadios(t *testing.T) {
	for _, path := range []string{"/interface/wifi", "/interface/wireless"} {
		t.Run(path, func(t *testing.T) {
			fake := &wirelessFake{replies: map[string][]map[string]string{
				path + "/print": {{"name": "radio1", "disabled": "true"}, {"name": "radio2", "disabled": "false"}},
			}}
			result, err := CollectWireless(fake, 7)
			want := []WirelessStats{{Interface: "radio1"}, {Interface: "radio2"}}
			if err != nil || !reflect.DeepEqual(result, want) {
				t.Fatalf("got %#v, %v; want %#v", result, err, want)
			}
		})
	}
}

func TestCollectWirelessLegacyFallback(t *testing.T) {
	fake := &wirelessFake{failures: map[string]bool{"/interface/wifi/print": true}, replies: map[string][]map[string]string{
		"/interface/wireless/print":                    {{"name": "wlan1", "frequency": "2412"}},
		"/interface/wireless/registration-table/print": {{"interface": "wlan1", "signal-strength": "-60@HT20", "tx-ccq": "90"}},
	}}
	result, err := CollectWireless(fake, 7)
	if err != nil || len(result) != 1 || result[0].Frequency != 2412 || result[0].AvgSignal != -60 || (result[0].CCQ == nil || *result[0].CCQ != 90) {
		t.Fatalf("%#v, %v", result, err)
	}
}

func TestCollectWirelessWiFiFieldsAndActiveChannel(t *testing.T) {
	fake := &wirelessFake{replies: map[string][]map[string]string{
		"/interface/wifi/print":                    {{".id": "*1", "name": "wifi1", "running": "true", "channel.frequency": "5180,5200"}, {"name": "wifi2"}},
		"/interface/wifi/monitor":                  {{"channel": "5200/ax/Ceee"}},
		"/interface/wifi/registration-table/print": {{"interface": "wifi1", "signal": "-60"}, {"interface": "wifi1", "signal": "-70"}},
	}}
	result, err := CollectWireless(fake, 7)
	want := []WirelessStats{{Interface: "wifi1", ClientCount: 2, AvgSignal: -65, Frequency: 5200}, {Interface: "wifi2"}}
	if err != nil || !reflect.DeepEqual(result, want) {
		t.Fatalf("got %#v, %v; want %#v", result, err, want)
	}
}

func TestCollectWirelessRegistrationFailure(t *testing.T) {
	fake := &wirelessFake{replies: map[string][]map[string]string{"/interface/wifi/print": {{"name": "wifi1"}}}, failures: map[string]bool{"/interface/wifi/registration-table/print": true}}
	_, err := CollectWireless(fake, 7)
	if err == nil {
		t.Fatal("registration failure must not be reported as zero clients")
	}
}

func TestCollectWirelessNoRadios(t *testing.T) {
	result, err := CollectWireless(&wirelessFake{}, 7)
	if err != nil || len(result) != 0 {
		t.Fatalf("%#v, %v", result, err)
	}
}

func TestAggregateWirelessMissingSignalAndFrequencyList(t *testing.T) {
	got := aggregateWireless([]map[string]string{{"name": "wifi1", "channel.frequency": "5180,5200"}}, []map[string]string{{"interface": "wifi1", "signal": "bad"}, {"interface": "wifi1", "signal": "-60"}}, true)
	if len(got) != 1 || got[0].ClientCount != 2 || got[0].AvgSignal != -60 || got[0].Frequency != 0 {
		t.Fatalf("%#v", got)
	}
}

// Exercise the real RouterOS protocol, including against the original collector.
func TestWirelessIdleRadiosProtocol(t *testing.T) {
	for _, path := range []string{"/interface/wifi", "/interface/wireless"} {
		t.Run(path, func(t *testing.T) {
			clientConn, serverConn := net.Pipe()
			defer serverConn.Close()
			clientConn.SetDeadline(time.Now().Add(3 * time.Second))
			client, err := routeros.NewClient(clientConn)
			if err != nil {
				t.Fatal(err)
			}
			defer client.Close()
			go func() {
				reader, writer := proto.NewReader(serverConn), proto.NewWriter(serverConn)
				for {
					command, err := reader.ReadSentence()
					if err != nil {
						return
					}
					if command.Word == path+"/print" {
						writer.BeginSentence()
						writer.WriteWord("!re")
						writer.WriteWord("=name=idle-radio")
						writer.WriteWord("=disabled=true")
						if writer.EndSentence() != nil {
							return
						}
					}
					writer.BeginSentence()
					writer.WriteWord("!done")
					if writer.EndSentence() != nil {
						return
					}
				}
			}()
			result, err := CollectWireless(client, 7)
			if err != nil || len(result) != 1 || result[0].Interface != "idle-radio" || result[0].ClientCount != 0 {
				t.Fatalf("idle interface lost: %#v, %v", result, err)
			}
		})
	}
}

func TestWirelessLegacyZeroCCQIsMeasured(t *testing.T) {
	got := aggregateWireless([]map[string]string{{"name": "wlan1"}}, []map[string]string{{"interface": "wlan1", "signal-strength": "-80", "tx-ccq": "0"}}, false)
	if len(got) != 1 || got[0].CCQ == nil || *got[0].CCQ != 0 {
		t.Fatalf("measured zero CCQ lost: %#v", got)
	}
}
