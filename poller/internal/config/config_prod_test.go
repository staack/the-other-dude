package config

import (
	"os"
	"strings"
	"testing"
)

func TestProductionValidationRejectsInsecureKey(t *testing.T) {
	// Save and restore env
	origEnv := os.Getenv("ENVIRONMENT")
	origDB := os.Getenv("DATABASE_URL")
	origKey := os.Getenv("CREDENTIAL_ENCRYPTION_KEY")
	defer func() {
		os.Setenv("ENVIRONMENT", origEnv)
		os.Setenv("DATABASE_URL", origDB)
		os.Setenv("CREDENTIAL_ENCRYPTION_KEY", origKey)
	}()

	os.Setenv("DATABASE_URL", "postgres://test:test@localhost:5432/test")

	// Test: production with known insecure default key should fail
	os.Setenv("ENVIRONMENT", "production")
	os.Setenv("CREDENTIAL_ENCRYPTION_KEY", "LLLjnfBZTSycvL2U07HDSxUeTtLxb9cZzryQl0R9E4w=")

	_, err := Load()
	if err == nil {
		t.Fatal("expected error for insecure key in production, got nil")
	}
	if !strings.Contains(err.Error(), "FATAL") {
		t.Fatalf("expected FATAL in error message, got: %s", err.Error())
	}
}

func TestProductionValidationRejectsPlaceholder(t *testing.T) {
	origEnv := os.Getenv("ENVIRONMENT")
	origDB := os.Getenv("DATABASE_URL")
	origKey := os.Getenv("CREDENTIAL_ENCRYPTION_KEY")
	defer func() {
		os.Setenv("ENVIRONMENT", origEnv)
		os.Setenv("DATABASE_URL", origDB)
		os.Setenv("CREDENTIAL_ENCRYPTION_KEY", origKey)
	}()

	os.Setenv("DATABASE_URL", "postgres://test:test@localhost:5432/test")
	os.Setenv("ENVIRONMENT", "production")
	os.Setenv("CREDENTIAL_ENCRYPTION_KEY", "CHANGE_ME_IN_PRODUCTION")

	_, err := Load()
	if err == nil {
		t.Fatal("expected error for CHANGE_ME_IN_PRODUCTION in production, got nil")
	}
	if !strings.Contains(err.Error(), "FATAL") {
		t.Fatalf("expected FATAL in error message for placeholder, got: %s", err.Error())
	}
}

func TestDevModeAcceptsInsecureDefaults(t *testing.T) {
	origEnv := os.Getenv("ENVIRONMENT")
	origDB := os.Getenv("DATABASE_URL")
	origKey := os.Getenv("CREDENTIAL_ENCRYPTION_KEY")
	defer func() {
		os.Setenv("ENVIRONMENT", origEnv)
		os.Setenv("DATABASE_URL", origDB)
		os.Setenv("CREDENTIAL_ENCRYPTION_KEY", origKey)
	}()

	os.Setenv("ENVIRONMENT", "dev")
	os.Setenv("DATABASE_URL", "postgres://test:test@localhost:5432/test")
	os.Setenv("CREDENTIAL_ENCRYPTION_KEY", "LLLjnfBZTSycvL2U07HDSxUeTtLxb9cZzryQl0R9E4w=")

	cfg, err := Load()
	if err != nil {
		t.Fatalf("dev mode should accept insecure defaults, got: %s", err.Error())
	}
	if cfg.Environment != "dev" {
		t.Fatalf("expected Environment=dev, got %s", cfg.Environment)
	}
}
