package main

import (
	"fmt"
	"sort"
	"strings"

	"github.com/opsbl/gosmi"
	"github.com/opsbl/gosmi/types"
)

// OIDNode represents a single node in the MIB OID tree.
type OIDNode struct {
	OID         string     `json:"oid"`
	Name        string     `json:"name"`
	Description string     `json:"description,omitempty"`
	Type        string     `json:"type,omitempty"`
	Access      string     `json:"access,omitempty"`
	Status      string     `json:"status,omitempty"`
	Children    []*OIDNode `json:"children,omitempty"`
}

// ParseResult is the top-level output from a MIB parse.
type ParseResult struct {
	ModuleName string     `json:"module_name"`
	Nodes      []*OIDNode `json:"nodes"`
	NodeCount  int        `json:"node_count"`
}

// BuildOIDTree walks all nodes in the named module and assembles them into a
// parent-child tree based on OID hierarchy.
func BuildOIDTree(inst *gosmi.Instance, moduleName string) (*ParseResult, error) {
	mod, err := inst.GetModule(moduleName)
	if err != nil {
		return nil, fmt.Errorf("get module %q: %s", moduleName, err.Error())
	}

	smiNodes := mod.GetNodes()
	if len(smiNodes) == 0 {
		return &ParseResult{
			ModuleName: moduleName,
			Nodes:      []*OIDNode{},
			NodeCount:  0,
		}, nil
	}

	// Build a flat map of OID string -> OIDNode.
	nodeMap := make(map[string]*OIDNode, len(smiNodes))
	for _, sn := range smiNodes {
		oidStr := sn.RenderNumeric()
		node := &OIDNode{
			OID:         oidStr,
			Name:        sn.Name,
			Description: cleanDescription(sn.Description),
			Type:        nodeType(sn),
			Access:      nodeAccess(sn.Access),
			Status:      nodeStatus(sn.Status),
		}
		nodeMap[oidStr] = node
	}

	// Build parent-child relationships. A node's parent OID is everything up
	// to (but not including) the last dot segment.
	roots := make([]*OIDNode, 0)
	for oid, node := range nodeMap {
		parentOID := parentOf(oid)
		if parent, ok := nodeMap[parentOID]; ok {
			parent.Children = append(parent.Children, node)
		} else {
			roots = append(roots, node)
		}
	}

	// Sort children at every level by OID for deterministic output.
	for _, node := range nodeMap {
		sortChildren(node)
	}
	sort.Slice(roots, func(i, j int) bool {
		return compareOID(roots[i].OID, roots[j].OID)
	})

	return &ParseResult{
		ModuleName: moduleName,
		Nodes:      roots,
		NodeCount:  len(smiNodes),
	}, nil
}

// nodeType returns a human-readable type string for a node. For leaf nodes with
// an SMI type it uses the type name or base type. For branch nodes (table, row,
// bare node) it uses the node kind.
func nodeType(sn gosmi.SmiNode) string {
	if sn.SmiType != nil {
		name := sn.SmiType.Name
		if name != "" {
			return strings.ToLower(name)
		}
		bt := sn.SmiType.BaseType.String()
		if bt != "" && bt != "Unknown" {
			return strings.ToLower(bt)
		}
	}
	// Fall back to node kind for branch/structural nodes.
	return nodeKindLabel(sn.Kind)
}

// nodeKindLabel converts a gosmi NodeKind to a lowercase label.
func nodeKindLabel(k types.NodeKind) string {
	switch k {
	case types.NodeNode:
		return "node"
	case types.NodeScalar:
		return "scalar"
	case types.NodeTable:
		return "table"
	case types.NodeRow:
		return "row"
	case types.NodeColumn:
		return "column"
	case types.NodeNotification:
		return "notification"
	case types.NodeGroup:
		return "group"
	case types.NodeCompliance:
		return "compliance"
	case types.NodeCapabilities:
		return "capabilities"
	default:
		return ""
	}
}

// nodeAccess converts a gosmi Access value to a kebab-case string matching
// standard MIB notation. Returns empty for unknown/not-implemented.
func nodeAccess(a types.Access) string {
	switch a {
	case types.AccessNotAccessible:
		return "not-accessible"
	case types.AccessNotify:
		return "accessible-for-notify"
	case types.AccessReadOnly:
		return "read-only"
	case types.AccessReadWrite:
		return "read-write"
	default:
		return ""
	}
}

// nodeStatus converts a gosmi Status value to a lowercase string.
func nodeStatus(s types.Status) string {
	switch s {
	case types.StatusCurrent:
		return "current"
	case types.StatusDeprecated:
		return "deprecated"
	case types.StatusObsolete:
		return "obsolete"
	case types.StatusMandatory:
		return "mandatory"
	case types.StatusOptional:
		return "optional"
	default:
		return ""
	}
}

// parentOf returns the parent OID by stripping the last dotted component.
func parentOf(oid string) string {
	idx := strings.LastIndex(oid, ".")
	if idx <= 0 {
		return ""
	}
	return oid[:idx]
}

// sortChildren sorts a node's children slice by OID.
func sortChildren(node *OIDNode) {
	if len(node.Children) < 2 {
		return
	}
	sort.Slice(node.Children, func(i, j int) bool {
		return compareOID(node.Children[i].OID, node.Children[j].OID)
	})
}

// compareOID compares two dotted-decimal OID strings numerically.
func compareOID(a, b string) bool {
	pa := strings.Split(a, ".")
	pb := strings.Split(b, ".")
	minLen := len(pa)
	if len(pb) < minLen {
		minLen = len(pb)
	}
	for i := 0; i < minLen; i++ {
		na := atoiSafe(pa[i])
		nb := atoiSafe(pb[i])
		if na != nb {
			return na < nb
		}
	}
	return len(pa) < len(pb)
}

// atoiSafe parses a string as an integer, returning 0 on error.
func atoiSafe(s string) int {
	n := 0
	for _, c := range s {
		if c < '0' || c > '9' {
			return 0
		}
		n = n*10 + int(c-'0')
	}
	return n
}

// cleanDescription trims whitespace and collapses internal runs of whitespace
// in MIB description strings, which often contain excessive formatting.
func cleanDescription(s string) string {
	if s == "" {
		return ""
	}
	// Replace newlines and tabs with spaces, then collapse multiple spaces.
	s = strings.Join(strings.Fields(s), " ")
	return s
}
