package main

import (
	"log/slog"
	"testing"
)

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

// LOG_LEVEL was never read at all — the third ignored knob after
// IDLE_TIMEOUT and MAX_LIFETIME, and the one that bites during an incident:
// an operator sets LOG_LEVEL=debug to watch a leaking session, restarts,
// gets identical output, and concludes the logging is just sparse.

func TestLogLevelComposeKnobIsHonoured(t *testing.T) {
	t.Setenv("LOG_LEVEL", "debug")
	lvl, source := envLogLevel("LOG_LEVEL", slog.LevelInfo)
	if lvl != slog.LevelDebug {
		t.Fatalf("LOG_LEVEL=debug ignored: got %v", lvl)
	}
	if source != "LOG_LEVEL" {
		t.Fatalf("expected source LOG_LEVEL, got %q", source)
	}
}

func TestLogLevelIsCaseInsensitive(t *testing.T) {
	for _, v := range []string{"DEBUG", "Debug", " debug "} {
		t.Setenv("LOG_LEVEL", v)
		if lvl, _ := envLogLevel("LOG_LEVEL", slog.LevelInfo); lvl != slog.LevelDebug {
			t.Fatalf("LOG_LEVEL=%q not honoured: got %v", v, lvl)
		}
	}
}

func TestLogLevelAllFourNames(t *testing.T) {
	want := map[string]slog.Level{
		"debug": slog.LevelDebug,
		"info":  slog.LevelInfo,
		"warn":  slog.LevelWarn,
		"error": slog.LevelError,
	}
	for name, lvl := range want {
		t.Setenv("LOG_LEVEL", name)
		if got, _ := envLogLevel("LOG_LEVEL", slog.LevelInfo); got != lvl {
			t.Fatalf("LOG_LEVEL=%q: got %v, want %v", name, got, lvl)
		}
	}
}

func TestLogLevelGarbageFallsBackToDefault(t *testing.T) {
	t.Setenv("LOG_LEVEL", "loud")
	lvl, source := envLogLevel("LOG_LEVEL", slog.LevelInfo)
	if lvl != slog.LevelInfo || source != "default" {
		t.Fatalf("expected Info/default for garbage, got %v/%q", lvl, source)
	}
}

func TestLogLevelUnsetUsesDefault(t *testing.T) {
	t.Setenv("LOG_LEVEL", "")
	lvl, source := envLogLevel("LOG_LEVEL", slog.LevelInfo)
	if lvl != slog.LevelInfo || source != "default" {
		t.Fatalf("expected Info/default when unset, got %v/%q", lvl, source)
	}
}

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
