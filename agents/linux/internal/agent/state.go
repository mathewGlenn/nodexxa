// Package agent implements enrollment, signing, queueing and delivery for the Nodexxa agent.
package agent

import (
	"crypto/ed25519"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"
)

// State lives in a root/agent-owned directory (0700). The private key file is 0600 and never logged.
type State struct {
	Dir string

	mu      sync.Mutex
	ID      Identity
	key     ed25519.PrivateKey
	lastSeq uint64
}

type Identity struct {
	AgentID string `json:"agentId"`
	Server  string `json:"server"`
}

const (
	identityFile = "identity.json"
	keyFile      = "agent.key"
	seqFile      = "seq"
)

var ErrNotEnrolled = errors.New("agent is not enrolled (run `nodexxa-agent enroll`)")

func (s *State) path(name string) string { return filepath.Join(s.Dir, name) }

// EnsureDir creates the state directory with owner-only permissions and refuses group/world access.
func (s *State) EnsureDir() error {
	if err := os.MkdirAll(s.Dir, 0o700); err != nil {
		return err
	}
	fi, err := os.Stat(s.Dir)
	if err != nil {
		return err
	}
	if fi.Mode().Perm()&0o077 != 0 {
		return fmt.Errorf("state dir %s must not be accessible by group/others (mode %o)", s.Dir, fi.Mode().Perm())
	}
	return nil
}

func GenerateKey() (ed25519.PrivateKey, string, error) {
	pub, priv, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		return nil, "", err
	}
	return priv, base64.StdEncoding.EncodeToString(pub), nil
}

// writeAtomic writes via a temp file + rename so a crash never leaves a truncated key.
func writeAtomic(path string, data []byte, mode os.FileMode) error {
	tmp, err := os.CreateTemp(filepath.Dir(path), ".tmp-*")
	if err != nil {
		return err
	}
	defer os.Remove(tmp.Name())
	if err := tmp.Chmod(mode); err != nil {
		tmp.Close()
		return err
	}
	if _, err := tmp.Write(data); err != nil {
		tmp.Close()
		return err
	}
	if err := tmp.Sync(); err != nil {
		tmp.Close()
		return err
	}
	if err := tmp.Close(); err != nil {
		return err
	}
	return os.Rename(tmp.Name(), path)
}

func (s *State) SaveKey(k ed25519.PrivateKey) error {
	enc := base64.StdEncoding.EncodeToString(k.Seed())
	if err := writeAtomic(s.path(keyFile), []byte(enc+"\n"), 0o600); err != nil {
		return err
	}
	s.mu.Lock()
	s.key = k
	s.mu.Unlock()
	return nil
}

func (s *State) SaveIdentity(id Identity) error {
	b, _ := json.MarshalIndent(id, "", "  ")
	if err := writeAtomic(s.path(identityFile), b, 0o600); err != nil {
		return err
	}
	s.ID = id
	return nil
}

func (s *State) Load() error {
	b, err := os.ReadFile(s.path(identityFile))
	if errors.Is(err, os.ErrNotExist) {
		return ErrNotEnrolled
	}
	if err != nil {
		return err
	}
	if err := json.Unmarshal(b, &s.ID); err != nil || s.ID.AgentID == "" {
		return fmt.Errorf("corrupt identity file")
	}
	fi, err := os.Stat(s.path(keyFile))
	if err != nil {
		return ErrNotEnrolled
	}
	if fi.Mode().Perm()&0o077 != 0 {
		return fmt.Errorf("key file must be mode 0600 (is %o)", fi.Mode().Perm())
	}
	raw, err := os.ReadFile(s.path(keyFile))
	if err != nil {
		return err
	}
	seed, err := base64.StdEncoding.DecodeString(strings.TrimSpace(string(raw)))
	if err != nil || len(seed) != ed25519.SeedSize {
		return fmt.Errorf("corrupt key file")
	}
	s.key = ed25519.NewKeyFromSeed(seed)
	if b, err := os.ReadFile(s.path(seqFile)); err == nil {
		s.lastSeq, _ = strconv.ParseUint(strings.TrimSpace(string(b)), 10, 64)
	}
	return nil
}

func (s *State) Key() ed25519.PrivateKey {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.key
}

// NextSeq returns a strictly increasing sequence (≥ wall-clock nanoseconds) and persists it, so
// restarts and clock steps never reuse a value the server has already seen.
func (s *State) NextSeq() (uint64, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	next := uint64(time.Now().UnixNano())
	if next <= s.lastSeq {
		next = s.lastSeq + 1
	}
	if next > 1<<63-1 {
		return 0, fmt.Errorf("sequence exhausted")
	}
	if err := writeAtomic(s.path(seqFile), []byte(strconv.FormatUint(next, 10)), 0o600); err != nil {
		return 0, err
	}
	s.lastSeq = next
	return next, nil
}

// BumpSeq moves past a server-side sequence (used after a 409 when local state was restored from backup).
func (s *State) BumpSeq(min uint64) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if min > s.lastSeq {
		s.lastSeq = min
	}
}
