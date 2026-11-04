// Package protocol mirrors the Nodexxa agent protocol v1.
// Source of truth: apps/dashboard/server/utils/protocol.ts (JSON Schema: packages/protocol/schema/v1.json).
// Fixture tests in this package decode packages/protocol/fixtures/v1 to detect drift.
package protocol

import (
	"crypto/sha256"
	"encoding/hex"
	"strings"
)

const Version = 1

// Limits enforced by the server; the agent stays within them.
const (
	MaxSnapshots  = 20
	MaxBodyBytes  = 512 * 1024
	MaxProcesses  = 200
	MaxContainers = 200
	MaxUnits      = 50
	MaxSites      = 100
	MaxCerts      = 100
	MaxFS         = 32
)

type EnrollRequest struct {
	ProtocolVersion int      `json:"protocolVersion"`
	EnrollmentToken string   `json:"enrollmentToken"`
	PublicKey       string   `json:"publicKey"`
	Hostname        string   `json:"hostname"`
	OS              string   `json:"os"`
	Arch            string   `json:"arch"`
	AgentVersion    string   `json:"agentVersion"`
	Capabilities    []string `json:"capabilities"`
}

type EnrollResponse struct {
	AgentID           string `json:"agentId"`
	ProtocolVersion   int    `json:"protocolVersion"`
	IngestIntervalSec int    `json:"ingestIntervalSec"`
	MaxSnapshots      int    `json:"maxSnapshots"`
}

type RotateKeyRequest struct {
	ProtocolVersion int    `json:"protocolVersion"`
	NewPublicKey    string `json:"newPublicKey"`
	Proof           string `json:"proof"`
}

type Filesystem struct {
	Mount      string `json:"mount"`
	FSType     string `json:"fsType"`
	TotalBytes uint64 `json:"totalBytes"`
	UsedBytes  uint64 `json:"usedBytes"`
}

type System struct {
	UptimeSec         uint64       `json:"uptimeSec"`
	CPUPercent        *float64     `json:"cpuPercent"` // null until two samples exist
	Load1             float64      `json:"load1"`
	Load5             float64      `json:"load5"`
	Load15            float64      `json:"load15"`
	MemTotalBytes     uint64       `json:"memTotalBytes"`
	MemAvailableBytes uint64       `json:"memAvailableBytes"`
	SwapTotalBytes    uint64       `json:"swapTotalBytes"`
	SwapFreeBytes     uint64       `json:"swapFreeBytes"`
	Filesystems       []Filesystem `json:"filesystems"`
}

type PM2Process struct {
	Name        string   `json:"name"`
	PMID        int      `json:"pmId"`
	Status      string   `json:"status"`
	Restarts    uint64   `json:"restarts"`
	CPUPercent  *float64 `json:"cpuPercent"`
	MemoryBytes *uint64  `json:"memoryBytes"`
	UptimeSec   *uint64  `json:"uptimeSec"`
}

type Container struct {
	ID     string `json:"id"`
	Name   string `json:"name"`
	Image  string `json:"image"`
	State  string `json:"state"`
	Health string `json:"health"`
	Status string `json:"status"`
}

type SystemdUnit struct {
	Name        string `json:"name"`
	ActiveState string `json:"activeState"`
	SubState    string `json:"subState"`
}

// Collector status values.
const (
	StatusOK          = "ok"
	StatusUnavailable = "unavailable"
	StatusError       = "error"
	StatusDisabled    = "disabled"
)

type PM2Collector struct {
	Status string       `json:"status"`
	Error  string       `json:"error,omitempty"`
	Items  []PM2Process `json:"items,omitempty"`
}

type DockerCollector struct {
	Status string      `json:"status"`
	Error  string      `json:"error,omitempty"`
	Items  []Container `json:"items,omitempty"`
}

type SystemdCollector struct {
	Status string        `json:"status"`
	Error  string        `json:"error,omitempty"`
	Items  []SystemdUnit `json:"items,omitempty"`
}

type NginxSite struct {
	ServerNames []string `json:"serverNames"`
	Listen      []string `json:"listen"`
	TLS         bool     `json:"tls"`
}

type NginxCert struct {
	Subject  string `json:"subject"`
	NotAfter string `json:"notAfter"`
}

type Nginx struct {
	Status       string      `json:"status"`
	Error        string      `json:"error,omitempty"`
	Active       *bool       `json:"active"`
	Version      *string     `json:"version"`
	Sites        []NginxSite `json:"sites,omitempty"`
	Certificates []NginxCert `json:"certificates,omitempty"`
}

type Snapshot struct {
	CollectedAt string            `json:"collectedAt"`
	System      *System           `json:"system,omitempty"`
	PM2         *PM2Collector     `json:"pm2,omitempty"`
	Docker      *DockerCollector  `json:"docker,omitempty"`
	Systemd     *SystemdCollector `json:"systemd,omitempty"`
	Nginx       *Nginx            `json:"nginx,omitempty"`
}

type Health struct {
	StartedAt        string `json:"startedAt"`
	QueueLength      int    `json:"queueLength"`
	DroppedSnapshots uint64 `json:"droppedSnapshots"`
	LastError        string `json:"lastError,omitempty"`
}

type TelemetryRequest struct {
	ProtocolVersion int        `json:"protocolVersion"`
	AgentVersion    string     `json:"agentVersion"`
	Capabilities    []string   `json:"capabilities"`
	Health          Health     `json:"health"`
	Snapshots       []Snapshot `json:"snapshots"`
}

// SigningString is the canonical message signed with the agent's Ed25519 key.
func SigningString(method, path, agentID, timestamp, seq string, body []byte) string {
	sum := sha256.Sum256(body)
	return strings.Join([]string{"nodexxa-v1", strings.ToUpper(method), path, agentID, timestamp, seq, hex.EncodeToString(sum[:])}, "\n")
}

// RotateProofMessage is signed by the NEW key to prove possession during rotation.
func RotateProofMessage(agentID, newPublicKey string) string {
	return "nodexxa-v1-rotate\n" + agentID + "\n" + newPublicKey
}

// Truncate bounds a string to max bytes on a rune boundary.
func Truncate(s string, max int) string {
	if len(s) <= max {
		return s
	}
	for max > 0 && (s[max]&0xC0) == 0x80 {
		max--
	}
	return s[:max]
}
