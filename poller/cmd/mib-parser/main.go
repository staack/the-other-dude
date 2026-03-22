// tod-mib-parser parses vendor MIB files using gosmi and outputs a JSON OID tree.
//
// Usage:
//
//	tod-mib-parser <mib-file-path> [--search-path <dir>]
//
// The binary reads a MIB file, parses it with opsbl/gosmi, and writes a JSON
// OID tree to stdout. On any parse error it outputs {"error": "..."} to stdout
// and exits 0 (the Python backend reads stdout, not exit codes).
package main

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"

	"github.com/opsbl/gosmi"
)

func main() {
	mibPath, searchPath, err := parseArgs(os.Args[1:])
	if err != nil {
		writeError(err.Error())
		return
	}

	result, err := parseMIB(mibPath, searchPath)
	if err != nil {
		writeError(err.Error())
		return
	}

	enc := json.NewEncoder(os.Stdout)
	enc.SetIndent("", "  ")
	if err := enc.Encode(result); err != nil {
		writeError(fmt.Sprintf("json encode: %s", err.Error()))
	}
}

// parseArgs extracts the MIB file path and optional --search-path from argv.
func parseArgs(args []string) (mibPath, searchPath string, err error) {
	if len(args) == 0 {
		return "", "", fmt.Errorf("usage: tod-mib-parser <mib-file-path> [--search-path <dir>]")
	}

	mibPath = args[0]
	searchPath = filepath.Dir(mibPath)

	for i := 1; i < len(args); i++ {
		if args[i] == "--search-path" {
			if i+1 >= len(args) {
				return "", "", fmt.Errorf("--search-path requires a directory argument")
			}
			searchPath = args[i+1]
			i++
		}
	}

	if _, statErr := os.Stat(mibPath); statErr != nil {
		return "", "", fmt.Errorf("cannot access MIB file: %s", statErr.Error())
	}

	return mibPath, searchPath, nil
}

// parseMIB loads a MIB file with gosmi and builds the OID tree. It recovers
// from gosmi panics on malformed MIBs and returns them as errors.
func parseMIB(mibPath, searchPath string) (result *ParseResult, err error) {
	defer func() {
		if r := recover(); r != nil {
			result = nil
			err = fmt.Errorf("gosmi panic: %v", r)
		}
	}()

	inst, err := gosmi.New("tod-mib-parser")
	if err != nil {
		return nil, fmt.Errorf("gosmi init: %s", err.Error())
	}
	defer inst.Close()

	// Append rather than replace so the default IETF/IANA MIB search paths
	// from gosmi bootstrap are preserved. The MIB file's directory (or the
	// explicit --search-path) is added so dependent MIBs co-located with the
	// input file are found.
	inst.AppendPath(searchPath)

	moduleName, err := inst.LoadModule(filepath.Base(mibPath))
	if err != nil {
		return nil, fmt.Errorf("load module: %s", err.Error())
	}

	return BuildOIDTree(inst, moduleName)
}

// writeError outputs a JSON error object to stdout.
func writeError(msg string) {
	fmt.Fprintf(os.Stderr, "tod-mib-parser: %s\n", msg)
	enc := json.NewEncoder(os.Stdout)
	_ = enc.Encode(map[string]string{"error": msg})
}
