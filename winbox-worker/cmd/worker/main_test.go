package main

import "testing"

// Phase 22 criterion 10: the timeout knobs must be real end to end. The
// shipped compose files historically set IDLE_TIMEOUT / MAX_LIFETIME while
// the worker read IDLE_TIMEOUT_SECONDS / MAX_LIFETIME_SECONDS, so operator
// changes were silently ignored — unnoticed only because the defaults
// happened to equal the compose values. Both spellings are accepted now;
// these tests pin the exact names the deployments use.

func TestComposeStyleIdleTimeoutIsHonoured(t *testing.T) {
	t.Setenv("IDLE_TIMEOUT_SECONDS", "")
	t.Setenv("IDLE_TIMEOUT", "120") // the spelling the shipped compose used
	got, source := envIntAliased("IDLE_TIMEOUT_SECONDS", "IDLE_TIMEOUT", 600)
	if got != 120 {
		t.Fatalf("compose-style IDLE_TIMEOUT ignored: got %d, want 120", got)
	}
	if source != "IDLE_TIMEOUT" {
		t.Fatalf("expected source IDLE_TIMEOUT, got %q", source)
	}
}

func TestComposeStyleMaxLifetimeIsHonoured(t *testing.T) {
	t.Setenv("MAX_LIFETIME_SECONDS", "")
	t.Setenv("MAX_LIFETIME", "3600")
	got, _ := envIntAliased("MAX_LIFETIME_SECONDS", "MAX_LIFETIME", 7200)
	if got != 3600 {
		t.Fatalf("compose-style MAX_LIFETIME ignored: got %d, want 3600", got)
	}
}

func TestCanonicalSpellingWinsOverAlias(t *testing.T) {
	t.Setenv("IDLE_TIMEOUT_SECONDS", "300")
	t.Setenv("IDLE_TIMEOUT", "120")
	got, source := envIntAliased("IDLE_TIMEOUT_SECONDS", "IDLE_TIMEOUT", 600)
	if got != 300 || source != "IDLE_TIMEOUT_SECONDS" {
		t.Fatalf("canonical must win when both set: got %d from %q", got, source)
	}
}

func TestNeitherSpellingSetFallsBackToDefault(t *testing.T) {
	t.Setenv("IDLE_TIMEOUT_SECONDS", "")
	t.Setenv("IDLE_TIMEOUT", "")
	got, source := envIntAliased("IDLE_TIMEOUT_SECONDS", "IDLE_TIMEOUT", 600)
	if got != 600 || source != "default" {
		t.Fatalf("expected default 600, got %d from %q", got, source)
	}
}

func TestEnvIntSourceRejectsGarbage(t *testing.T) {
	t.Setenv("MAX_CONCURRENT_SESSIONS", "lots")
	got, source := envIntSource("MAX_CONCURRENT_SESSIONS", 10)
	if got != 10 || source != "default" {
		t.Fatalf("expected default 10 for garbage value, got %d from %q", got, source)
	}
}
