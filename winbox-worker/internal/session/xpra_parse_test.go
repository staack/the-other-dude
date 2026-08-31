package session

import "testing"

// Output shapes below mirror what xpra 3.1.5 actually emits (verified against
// the shipped image): every line is dot-namespaced key=value. There is NO bare
// `idle_time=` field in any state — the closest substring match is
// `features.idle_timeout=0`, which is a config setting the old parser must
// never be fooled by. `client.*` fields exist only while a client is attached
// and vanish entirely on disconnect; `clients=` is present in every state.

const xpraInfoNoClient = `clients=0
client-launcher=False
elapsed_time=142
env.DISPLAY=:100
features.idle_timeout=0
features.sharing=False
network.protocol=tcp
server.display=:100
server.mode=start
server.pid=4242
start_time=1756500000
state=LIVE
threads=28
windows=1
`

const xpraInfoClientAttached = `clients=1
client.batch.delay.avg=25
client.connection_time=1756500042
client.hostname=browser-host
client.idle=False
client.idle_time=19
client.type=HTML5
elapsed_time=203
features.idle_timeout=0
network.protocol=ws
server.display=:100
server.pid=4242
state=LIVE
windows=1
`

func TestParseXpraInfoNoClient(t *testing.T) {
	st := parseXpraInfo([]byte(xpraInfoNoClient))
	if st.Clients != 0 {
		t.Fatalf("Clients: expected 0, got %d", st.Clients)
	}
	// client.idle_time is absent when disconnected -> idle must be unknown,
	// and features.idle_timeout=0 must NOT be misread as idle time.
	if st.IdleSeconds != -1 {
		t.Fatalf("IdleSeconds: expected -1 (field absent), got %d", st.IdleSeconds)
	}
}

func TestParseXpraInfoClientAttached(t *testing.T) {
	st := parseXpraInfo([]byte(xpraInfoClientAttached))
	if st.Clients != 1 {
		t.Fatalf("Clients: expected 1, got %d", st.Clients)
	}
	if st.IdleSeconds != 19 {
		t.Fatalf("IdleSeconds: expected 19, got %d", st.IdleSeconds)
	}
}

func TestParseXpraInfoUnparseable(t *testing.T) {
	for _, in := range []string{"", "garbage output\nnot key value\n", "clients=notanumber\n"} {
		st := parseXpraInfo([]byte(in))
		if st.Clients != -1 || st.IdleSeconds != -1 {
			t.Fatalf("input %q: expected {-1,-1}, got %+v", in, st)
		}
	}
}

func TestParseXpraInfoDoesNotMatchNamespacedClientsKeys(t *testing.T) {
	// A hypothetical clients.something= line must not satisfy the clients=
	// prefix, and features.idle_timeout must not satisfy client.idle_time=.
	in := "clients.detail=9\nfeatures.idle_timeout=600\nclients=2\n"
	st := parseXpraInfo([]byte(in))
	if st.Clients != 2 {
		t.Fatalf("Clients: expected 2, got %d", st.Clients)
	}
	if st.IdleSeconds != -1 {
		t.Fatalf("IdleSeconds: expected -1, got %d", st.IdleSeconds)
	}
}
