package device

import (
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestNormalizeConfig_StripTimestampHeader(t *testing.T) {
	input := "# 2024/01/15 10:30:00 by RouterOS 7.14\n# software id = ABC123\n/ip address\n"
	got := NormalizeConfig(input)
	assert.NotContains(t, got, "2024/01/15")
	assert.Contains(t, got, "# software id = ABC123")
	assert.Contains(t, got, "/ip address")
}

func TestNormalizeConfig_LineEndingNormalization(t *testing.T) {
	input := "/ip address\r\nadd address=10.0.0.1\r\n"
	got := NormalizeConfig(input)
	assert.NotContains(t, got, "\r")
	assert.Contains(t, got, "/ip address\n")
}

func TestNormalizeConfig_TrailingWhitespaceTrimming(t *testing.T) {
	input := "  /ip address  \n"
	got := NormalizeConfig(input)
	// Each line should be trimmed of trailing whitespace only
	lines := strings.Split(got, "\n")
	for _, line := range lines {
		if line == "" {
			continue
		}
		assert.Equal(t, strings.TrimRight(line, " \t"), line, "line should have no trailing whitespace")
	}
}

func TestNormalizeConfig_BlankLineCollapsing(t *testing.T) {
	input := "/ip address\n\n\n\n/ip route\n"
	got := NormalizeConfig(input)
	assert.NotContains(t, got, "\n\n\n")
	assert.Contains(t, got, "/ip address\n\n/ip route")
}

func TestNormalizeConfig_TrailingNewline(t *testing.T) {
	tests := []struct {
		name  string
		input string
	}{
		{"no trailing newline", "/ip address"},
		{"one trailing newline", "/ip address\n"},
		{"multiple trailing newlines", "/ip address\n\n\n"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := NormalizeConfig(tt.input)
			assert.True(t, strings.HasSuffix(got, "\n"), "should end with newline")
			assert.False(t, strings.HasSuffix(got, "\n\n"), "should not end with double newline")
		})
	}
}

func TestNormalizeConfig_CommentPreservation(t *testing.T) {
	input := "# 2024/01/15 10:30:00 by RouterOS 7.14\n# software id = ABC123\n# custom comment\n/ip address\n"
	got := NormalizeConfig(input)
	assert.Contains(t, got, "# software id = ABC123")
	assert.Contains(t, got, "# custom comment")
}

func TestNormalizeConfig_FullPipeline(t *testing.T) {
	input := "# 2024/01/15 10:30:00 by RouterOS 7.14\n" +
		"# software id = ABC123\r\n" +
		"/ip address  \r\n" +
		"add address=10.0.0.1/24  \r\n" +
		"\r\n" +
		"\r\n" +
		"\r\n" +
		"/ip route  \r\n" +
		"add dst-address=0.0.0.0/0 gateway=10.0.0.1\r\n"

	expected := "# software id = ABC123\n" +
		"/ip address\n" +
		"add address=10.0.0.1/24\n" +
		"\n" +
		"/ip route\n" +
		"add dst-address=0.0.0.0/0 gateway=10.0.0.1\n"

	got := NormalizeConfig(input)
	assert.Equal(t, expected, got)
}

func TestHashConfig(t *testing.T) {
	normalized := "/ip address\nadd address=10.0.0.1/24\n"
	hash := HashConfig(normalized)
	assert.Len(t, hash, 64, "SHA256 hex should be 64 chars")
	assert.Equal(t, strings.ToLower(hash), hash, "hash should be lowercase")
	// Deterministic
	assert.Equal(t, hash, HashConfig(normalized))
}

func TestNormalizeConfig_Idempotency(t *testing.T) {
	input := "# 2024/01/15 10:30:00 by RouterOS 7.14\n" +
		"# software id = ABC123\r\n" +
		"/ip address  \r\n" +
		"\r\n\r\n\r\n" +
		"/ip route\r\n"

	first := NormalizeConfig(input)
	second := NormalizeConfig(first)
	assert.Equal(t, first, second, "NormalizeConfig should be idempotent")
}

func TestNormalizationVersion(t *testing.T) {
	require.Equal(t, 1, NormalizationVersion, "NormalizationVersion should be 1")
}
