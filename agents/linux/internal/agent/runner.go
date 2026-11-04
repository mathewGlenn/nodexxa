package agent

import (
	"context"
	"errors"
	"log/slog"
	"math/rand/v2"
	"sync"
	"time"

	"github.com/mathewglenn/nodexxa/agents/linux/internal/collect"
	"github.com/mathewglenn/nodexxa/agents/linux/internal/protocol"
)

// Queue is a bounded FIFO of snapshots kept in memory. When full, the oldest snapshot is dropped
// and counted, so dashboard outages never cause unbounded memory or disk growth.
type Queue struct {
	mu      sync.Mutex
	items   []protocol.Snapshot
	max     int
	dropped uint64
}

func NewQueue(max int) *Queue { return &Queue{max: max} }

func (q *Queue) Push(s protocol.Snapshot) {
	q.mu.Lock()
	defer q.mu.Unlock()
	if len(q.items) >= q.max {
		q.items = q.items[1:]
		q.dropped++
	}
	q.items = append(q.items, s)
}

// Peek returns up to n oldest snapshots without removing them.
func (q *Queue) Peek(n int) []protocol.Snapshot {
	q.mu.Lock()
	defer q.mu.Unlock()
	n = min(n, len(q.items))
	return append([]protocol.Snapshot(nil), q.items[:n]...)
}

// Drop removes the n oldest snapshots (after successful delivery).
func (q *Queue) Drop(n int) {
	q.mu.Lock()
	defer q.mu.Unlock()
	q.items = q.items[min(n, len(q.items)):]
}

func (q *Queue) Stats() (length int, dropped uint64) {
	q.mu.Lock()
	defer q.mu.Unlock()
	return len(q.items), q.dropped
}

// Collectors selects which collectors run. Docker is opt-in (socket access is root-equivalent).
type Collectors struct {
	System  *collect.System
	PM2     *collect.PM2
	Docker  *collect.Docker
	Nginx   *collect.Nginx
	Systemd *collect.Systemd
}

func (c Collectors) Capabilities() []string {
	caps := []string{"system"}
	if c.PM2 != nil {
		caps = append(caps, "pm2")
	}
	if c.Docker != nil {
		caps = append(caps, "docker")
	}
	if c.Nginx != nil {
		caps = append(caps, "nginx")
	}
	if c.Systemd != nil && len(c.Systemd.Units) > 0 {
		caps = append(caps, "systemd")
	}
	return caps
}

type Runner struct {
	Client     *Client
	Collectors Collectors
	Interval   time.Duration
	Queue      *Queue
	Log        *slog.Logger

	startedAt time.Time
	mu        sync.Mutex
	lastError string
}

// Collect runs every enabled collector; a failing collector degrades only its own section.
func (r *Runner) Collect(ctx context.Context) protocol.Snapshot {
	snap := protocol.Snapshot{CollectedAt: time.Now().UTC().Format(time.RFC3339Nano)}
	if r.Collectors.System != nil {
		if sys, err := r.Collectors.System.Collect(); err == nil {
			snap.System = sys
		} else {
			r.setError("system collector: " + err.Error())
		}
	}
	if r.Collectors.PM2 != nil {
		snap.PM2 = r.Collectors.PM2.Collect(ctx)
	}
	if r.Collectors.Docker != nil {
		snap.Docker = r.Collectors.Docker.Collect(ctx)
	} else {
		snap.Docker = &protocol.DockerCollector{Status: protocol.StatusDisabled}
	}
	if r.Collectors.Nginx != nil {
		snap.Nginx = r.Collectors.Nginx.Collect(ctx)
	}
	if r.Collectors.Systemd != nil {
		snap.Systemd = r.Collectors.Systemd.Collect(ctx)
	}
	return snap
}

func (r *Runner) setError(msg string) {
	r.mu.Lock()
	r.lastError = protocol.Truncate(msg, 300)
	r.mu.Unlock()
}

func (r *Runner) health() protocol.Health {
	length, dropped := r.Queue.Stats()
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.startedAt.IsZero() {
		r.startedAt = time.Now()
	}
	return protocol.Health{StartedAt: r.startedAt.UTC().Format(time.RFC3339), QueueLength: length, DroppedSnapshots: dropped, LastError: r.lastError}
}

// Flush delivers queued snapshots in batches. Rejected (malformed) batches are dropped so a
// poison payload cannot block the queue; retryable failures keep data queued.
func (r *Runner) Flush(ctx context.Context) error {
	batch := protocol.MaxSnapshots
	for {
		snaps := r.Queue.Peek(batch)
		if len(snaps) == 0 {
			return nil
		}
		req := protocol.TelemetryRequest{
			ProtocolVersion: protocol.Version, AgentVersion: r.Client.Version, Capabilities: r.Collectors.Capabilities(),
			Health: r.health(), Snapshots: snaps,
		}
		_, err := r.Client.PostSigned(ctx, "/api/agent/v1/telemetry", req, r.Client.State.Key())
		switch {
		case err == nil:
			r.Queue.Drop(len(snaps))
			r.setError("")
		case errors.Is(err, ErrReplay):
			r.Client.State.BumpSeq(uint64(time.Now().UnixNano()))
			return err
		case errors.Is(err, ErrRejected) && batch > 1:
			batch /= 2 // maybe too large; retry smaller
		case errors.Is(err, ErrRejected):
			r.Queue.Drop(1)
			r.setError(err.Error())
			r.Log.Warn("dropped snapshot rejected by server", "error", err)
		default:
			r.setError(err.Error())
			return err
		}
	}
}

// Run collects every Interval and delivers with exponential backoff + jitter on failures.
func (r *Runner) Run(ctx context.Context) error {
	r.mu.Lock()
	r.startedAt = time.Now()
	r.mu.Unlock()
	backoff := time.Duration(0)
	nextSend := time.Now()
	tick := func() error {
		r.Queue.Push(r.Collect(ctx))
		if time.Now().Before(nextSend) {
			return nil
		}
		err := r.Flush(ctx)
		switch {
		case err == nil:
			backoff = 0
		case errors.Is(err, ErrUnauthorized), errors.Is(err, ErrUpgradeRequired):
			return err // fatal: needs operator action (re-enroll / upgrade)
		default:
			backoff = min(max(backoff*2, 10*time.Second), 5*time.Minute)
			jittered := backoff/2 + time.Duration(rand.Int64N(int64(backoff/2)+1))
			nextSend = time.Now().Add(jittered)
			r.Log.Warn("delivery failed; will retry", "error", err, "retryIn", jittered.Round(time.Second))
		}
		return nil
	}
	// Small start-up jitter avoids synchronized fleets after a mass restart.
	select {
	case <-ctx.Done():
		return nil
	case <-time.After(time.Duration(rand.Int64N(int64(5 * time.Second)))):
	}
	timer := time.NewTicker(r.Interval)
	defer timer.Stop()
	for {
		if err := tick(); err != nil {
			return err
		}
		select {
		case <-ctx.Done():
			return nil
		case <-timer.C:
		}
	}
}
