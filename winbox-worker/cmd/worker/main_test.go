package main

import "testing"

func TestEnvIntAliasedPrefersCanonical(t *testing.T) {
	t.Setenv("IDLE_TIMEOUT_SECONDS", "300")
	t.Setenv("IDLE_TIMEOUT", "900")

	v, src := envIntAliased("IDLE_TIMEOUT_SECONDS", "IDLE_TIMEOUT", 600)
	if v != 300 {
		t.Fatalf("expected 300, got %d", v)
	}
	if src != "IDLE_TIMEOUT_SECONDS" {
		t.Fatalf("expected canonical source, got %q", src)
	}
}

// The compose file historically set the short spelling; it must be honoured.
func TestEnvIntAliasedAcceptsAlias(t *testing.T) {
	t.Setenv("MAX_LIFETIME", "1800")

	v, src := envIntAliased("MAX_LIFETIME_SECONDS", "MAX_LIFETIME", 7200)
	if v != 1800 {
		t.Fatalf("expected 1800, got %d", v)
	}
	if src != "MAX_LIFETIME" {
		t.Fatalf("expected alias source, got %q", src)
	}
}

func TestEnvIntAliasedFallsBackToDefault(t *testing.T) {
	v, src := envIntAliased("IDLE_TIMEOUT_SECONDS", "IDLE_TIMEOUT", 600)
	if v != 600 {
		t.Fatalf("expected 600, got %d", v)
	}
	if src != "default" {
		t.Fatalf("expected default source, got %q", src)
	}
}

func TestEnvIntSourceIgnoresGarbage(t *testing.T) {
	t.Setenv("MAX_CONCURRENT_SESSIONS", "ten")

	v, src := envIntSource("MAX_CONCURRENT_SESSIONS", 10)
	if v != 10 {
		t.Fatalf("expected default 10, got %d", v)
	}
	if src != "default" {
		t.Fatalf("expected default source, got %q", src)
	}
}
