package agent

import (
	"crypto/ed25519"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/mathewglenn/nodexxa/agents/linux/internal/protocol"
)

func newState(t *testing.T) *State {
	t.Helper()
	s := &State{Dir: filepath.Join(t.TempDir(), "state")}
	if err := s.EnsureDir(); err != nil {
		t.Fatal(err)
	}
	return s
}

func TestStatePersistsKeyWithOwnerOnlyPermissions(t *testing.T) {
	s := newState(t)
	key, _, _ := GenerateKey()
	if err := s.SaveKey(key); err != nil {
		t.Fatal(err)
	}
	if err := s.SaveIdentity(Identity{AgentID: "a1", Server: "https://x"}); err != nil {
		t.Fatal(err)
	}
	fi, _ := os.Stat(filepath.Join(s.Dir, keyFile))
	if fi.Mode().Perm() != 0o600 {
		t.Fatalf("key mode %o", fi.Mode().Perm())
	}
	s2 := &State{Dir: s.Dir}
	if err := s2.Load(); err != nil {
		t.Fatal(err)
	}
	if !s2.Key().Equal(key) || s2.ID.AgentID != "a1" {
		t.Fatal("state did not round-trip")
	}
	_ = os.Chmod(filepath.Join(s.Dir, keyFile), 0o644)
	if err := (&State{Dir: s.Dir}).Load(); err == nil {
		t.Fatal("world-readable key must be refused")
	}
}

func TestStateDirMustBePrivate(t *testing.T) {
	dir := filepath.Join(t.TempDir(), "open")
	_ = os.Mkdir(dir, 0o755)
	if err := (&State{Dir: dir}).EnsureDir(); err == nil {
		t.Fatal("expected refusal for group/world-accessible state dir")
	}
	if err := (&State{Dir: t.TempDir() + "/missing-x"}).Load(); !errors.Is(err, ErrNotEnrolled) {
		t.Fatalf("got %v", err)
	}
}

func TestSequenceIsStrictlyIncreasingAcrossRestartsAndConcurrency(t *testing.T) {
	s := newState(t)
	_ = s.SaveIdentity(Identity{AgentID: "a"})
	key, _, _ := GenerateKey()
	_ = s.SaveKey(key)
	s.BumpSeq(uint64(time.Now().Add(time.Hour).UnixNano())) // clock behind persisted state
	var mu sync.Mutex
	seen := map[uint64]bool{}
	var wg sync.WaitGroup
	for range 20 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			n, err := s.NextSeq()
			if err != nil {
				t.Error(err)
			}
			mu.Lock()
			seen[n] = true
			mu.Unlock()
		}()
	}
	wg.Wait()
	if len(seen) != 20 {
		t.Fatal("duplicate sequence numbers")
	}
	last, _ := s.NextSeq()
	reloaded := &State{Dir: s.Dir}
	_ = reloaded.Load()
	if n, _ := reloaded.NextSeq(); n <= last {
		t.Fatalf("sequence regressed after restart: %d <= %d", n, last)
	}
}

func TestClientRefusesPlainHTTPExceptLoopback(t *testing.T) {
	s := newState(t)
	if _, err := NewClient("http://dashboard.example.com", "", s, "t"); err == nil {
		t.Fatal("plain http to a remote host must be refused")
	}
	for _, ok := range []string{"https://dashboard.example.com", "http://127.0.0.1:3000", "http://localhost:3000", "http://[::1]:3000"} {
		if _, err := NewClient(ok, "", s, "t"); err != nil {
			t.Fatalf("%s: %v", ok, err)
		}
	}
}

// fakeServer verifies signatures exactly like the dashboard does.
type fakeServer struct {
	pub      ed25519.PublicKey
	lastSeq  uint64
	status   atomic.Int32
	received atomic.Int32
	bodies   [][]byte
	mu       sync.Mutex
}

func (f *fakeServer) handler(t *testing.T) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)
		seqStr := r.Header.Get("X-Nodexxa-Seq")
		seq, _ := strconv.ParseUint(seqStr, 10, 64)
		sig, _ := base64.StdEncoding.DecodeString(r.Header.Get("X-Nodexxa-Signature"))
		msg := protocol.SigningString(r.Method, r.URL.Path, r.Header.Get("X-Nodexxa-Agent-Id"), r.Header.Get("X-Nodexxa-Timestamp"), seqStr, body)
		f.mu.Lock()
		defer f.mu.Unlock()
		if !ed25519.Verify(f.pub, []byte(msg), sig) {
			w.WriteHeader(401)
			return
		}
		if seq <= f.lastSeq {
			w.WriteHeader(409)
			return
		}
		f.lastSeq = seq
		if s := f.status.Load(); s != 0 {
			w.WriteHeader(int(s))
			return
		}
		f.received.Add(1)
		f.bodies = append(f.bodies, body)
		w.WriteHeader(202)
		_, _ = w.Write([]byte(`{"accepted":1}`))
	}
}

func setupRunner(t *testing.T) (*Runner, *fakeServer, *httptest.Server) {
	t.Helper()
	s := newState(t)
	key, _, _ := GenerateKey()
	_ = s.SaveKey(key)
	fs := &fakeServer{pub: key.Public().(ed25519.PublicKey)}
	srv := httptest.NewTLSServer(fs.handler(t))
	t.Cleanup(srv.Close)
	_ = s.SaveIdentity(Identity{AgentID: "agent-1", Server: srv.URL})

	// Trust the test server's certificate through the same CA-file path operators use.
	caFile := filepath.Join(t.TempDir(), "ca.pem")
	certPEM := "-----BEGIN CERTIFICATE-----\n" + base64.StdEncoding.EncodeToString(srv.Certificate().Raw) + "\n-----END CERTIFICATE-----\n"
	_ = os.WriteFile(caFile, []byte(certPEM), 0o600)
	c, err := NewClient(srv.URL, caFile, s, "test")
	if err != nil {
		t.Fatal(err)
	}
	r := &Runner{Client: c, Interval: time.Second, Queue: NewQueue(5), Log: slog.New(slog.NewTextHandler(io.Discard, nil))}
	return r, fs, srv
}

func snap(i int) protocol.Snapshot {
	return protocol.Snapshot{CollectedAt: time.Unix(int64(1700000000+i), 0).UTC().Format(time.RFC3339)}
}

func TestSignedDeliveryOverTLSAndQueueDrain(t *testing.T) {
	r, fs, _ := setupRunner(t)
	for i := range 3 {
		r.Queue.Push(snap(i))
	}
	if err := r.Flush(t.Context()); err != nil {
		t.Fatal(err)
	}
	if n, _ := r.Queue.Stats(); n != 0 || fs.received.Load() != 1 {
		t.Fatalf("queue=%d received=%d", n, fs.received.Load())
	}
	var req protocol.TelemetryRequest
	_ = json.Unmarshal(fs.bodies[0], &req)
	if len(req.Snapshots) != 3 || req.ProtocolVersion != 1 || req.Capabilities[0] != "system" {
		t.Fatalf("payload: %+v", req)
	}
}

func TestUntrustedCertificateIsRefused(t *testing.T) {
	r, fs, srv := setupRunner(t)
	c, _ := NewClient(srv.URL, "", r.Client.State, "test") // no CA file → system roots only
	r.Client = c
	r.Queue.Push(snap(1))
	var re *RetryableError
	if err := r.Flush(t.Context()); !errors.As(err, &re) {
		t.Fatalf("expected TLS failure as retryable, got %v", err)
	}
	if fs.received.Load() != 0 {
		t.Fatal("data must not be delivered to an untrusted server")
	}
}

func TestOutageKeepsBoundedQueueAndRecovers(t *testing.T) {
	r, fs, _ := setupRunner(t)
	fs.status.Store(503)
	for i := range 8 { // queue max is 5
		r.Queue.Push(snap(i))
		var re *RetryableError
		if err := r.Flush(t.Context()); !errors.As(err, &re) {
			t.Fatalf("expected retryable error, got %v", err)
		}
	}
	n, dropped := r.Queue.Stats()
	if n != 5 || dropped != 3 {
		t.Fatalf("queue=%d dropped=%d", n, dropped)
	}
	fs.status.Store(0)
	if err := r.Flush(t.Context()); err != nil {
		t.Fatal(err)
	}
	var req protocol.TelemetryRequest
	_ = json.Unmarshal(fs.bodies[0], &req)
	if req.Health.DroppedSnapshots != 3 || req.Snapshots[0].CollectedAt != snap(3).CollectedAt {
		t.Fatalf("expected oldest dropped and drop count reported: %+v", req.Health)
	}
}

func TestRevocationIsFatal(t *testing.T) {
	r, fs, _ := setupRunner(t)
	fs.status.Store(401)
	r.Queue.Push(snap(1))
	if err := r.Flush(t.Context()); !errors.Is(err, ErrUnauthorized) {
		t.Fatalf("got %v", err)
	}
}

func TestRejectedPayloadIsDroppedNotRetriedForever(t *testing.T) {
	r, fs, _ := setupRunner(t)
	fs.status.Store(400)
	r.Queue.Push(snap(1))
	r.Queue.Push(snap(2))
	if err := r.Flush(t.Context()); err != nil {
		t.Fatalf("got %v", err)
	}
	if n, _ := r.Queue.Stats(); n != 0 {
		t.Fatalf("poison snapshots must be dropped, queue=%d", n)
	}
}

func TestKeyRotation(t *testing.T) {
	r, fs, _ := setupRunner(t)
	old := r.Client.State.Key()
	var newPub ed25519.PublicKey
	fs.mu.Lock()
	fs.pub = old.Public().(ed25519.PublicKey)
	fs.mu.Unlock()
	srv := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
		var body protocol.RotateKeyRequest
		raw, _ := io.ReadAll(req.Body)
		_ = json.Unmarshal(raw, &body)
		pub, _ := base64.StdEncoding.DecodeString(body.NewPublicKey)
		proof, _ := base64.StdEncoding.DecodeString(body.Proof)
		if !ed25519.Verify(pub, []byte(protocol.RotateProofMessage("agent-1", body.NewPublicKey)), proof) {
			w.WriteHeader(400)
			return
		}
		newPub = pub
		w.WriteHeader(200)
	}))
	defer srv.Close()
	r.Client.Base.Host = strings.TrimPrefix(srv.URL, "https://")
	r.Client.HTTP = srv.Client()
	if err := r.Client.RotateKey(t.Context()); err != nil {
		t.Fatal(err)
	}
	if r.Client.State.Key().Equal(old) || !newPub.Equal(r.Client.State.Key().Public()) {
		t.Fatal("new key not installed")
	}
	reloaded := &State{Dir: r.Client.State.Dir}
	_ = reloaded.Load()
	if !reloaded.Key().Equal(r.Client.State.Key()) {
		t.Fatal("rotated key not persisted")
	}
}

func TestBodyHashBindsSignature(t *testing.T) {
	sum := sha256.Sum256([]byte(`{"a":1}`))
	msg := protocol.SigningString("POST", "/p", "id", "1", "2", []byte(`{"a":1}`))
	if !strings.HasSuffix(msg, hex.EncodeToString(sum[:])) {
		t.Fatal("signature must cover the body hash")
	}
}
