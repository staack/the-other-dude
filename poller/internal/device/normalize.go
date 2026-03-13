// Package device provides SSH command execution and config normalization for RouterOS devices.
package device

import (
	"crypto/sha256"
	"fmt"
	"regexp"
	"strings"
)

// NormalizationVersion tracks the normalization algorithm version for NATS payloads.
// Increment when the normalization logic changes to allow re-processing.
const NormalizationVersion = 1

// timestampHeaderRe matches the RouterOS export timestamp header line.
// Example: "# 2024/01/15 10:30:00 by RouterOS 7.14"
var timestampHeaderRe = regexp.MustCompile(`(?m)^# \d{4}/\d{2}/\d{2} \d{2}:\d{2}:\d{2} by RouterOS.*\n?`)

// NormalizeConfig deterministically normalizes a RouterOS config export.
//
// Steps:
//  1. Replace \r\n with \n
//  2. Strip the timestamp header line (and the blank line immediately following it)
//  3. Trim trailing whitespace from each line
//  4. Collapse consecutive blank lines (2+ empty lines become 1)
//  5. Ensure exactly one trailing newline
func NormalizeConfig(raw string) string {
	// Step 1: Normalize line endings
	s := strings.ReplaceAll(raw, "\r\n", "\n")

	// Step 2: Strip timestamp header and the blank line immediately following it
	loc := timestampHeaderRe.FindStringIndex(s)
	if loc != nil {
		after := s[loc[1]:]
		// Remove the blank line immediately following the timestamp header
		if strings.HasPrefix(after, "\n") {
			s = s[:loc[0]] + after[1:]
		} else {
			s = s[:loc[0]] + after
		}
	}

	// Step 3: Trim trailing whitespace from each line
	lines := strings.Split(s, "\n")
	for i, line := range lines {
		lines[i] = strings.TrimRight(line, " \t")
	}

	// Step 4: Collapse consecutive blank lines
	var result []string
	prevBlank := false
	for _, line := range lines {
		if line == "" {
			if prevBlank {
				continue
			}
			prevBlank = true
		} else {
			prevBlank = false
		}
		result = append(result, line)
	}

	// Step 5: Ensure exactly one trailing newline
	out := strings.Join(result, "\n")
	out = strings.TrimRight(out, "\n")
	if out != "" {
		out += "\n"
	}

	return out
}

// HashConfig returns the lowercase hex-encoded SHA256 hash of the normalized config text.
// The hash is 64 characters long and deterministic for the same input.
func HashConfig(normalized string) string {
	h := sha256.Sum256([]byte(normalized))
	return fmt.Sprintf("%x", h)
}
