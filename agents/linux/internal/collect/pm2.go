package collect

import (
	"context"
	"encoding/json"
	"errors"
	"os/exec"
	"time"

	"github.com/mathewglenn/nodexxa/agents/linux/internal/protocol"
)

// PM2 lists processes of the PM2 daemon owned by the agent's user (PM2 is per-user; a root/global
// list is not a reliable cross-user source). Only names, ids, states and counters are kept —
// pm2_env (environment variables) and args are never read into the output.
type PM2 struct {
	Binary string // default "pm2"
	Home   string // optional PM2_HOME of the monitored user
}

// pm2 jlist entries — deliberately decoding only the allow-listed fields.
type pm2Entry struct {
	Name  string `json:"name"`
	PMID  int    `json:"pm_id"`
	Monit *struct {
		CPU    *float64 `json:"cpu"`
		Memory *uint64  `json:"memory"`
	} `json:"monit"`
	Env *struct {
		Status      string `json:"status"`
		RestartTime uint64 `json:"restart_time"`
		PMUptime    int64  `json:"pm_uptime"`
	} `json:"pm2_env"`
}

func (p *PM2) Collect(ctx context.Context) *protocol.PM2Collector {
	bin := p.Binary
	if bin == "" {
		bin = "pm2"
	}
	path, err := exec.LookPath(bin)
	if err != nil {
		return &protocol.PM2Collector{Status: protocol.StatusUnavailable, Error: "pm2 not found in PATH"}
	}
	ctx, cancel := context.WithTimeout(ctx, 15*time.Second)
	defer cancel()
	// Fixed argv, no shell. Environment is minimal: never inherits the agent's own environment.
	cmd := exec.CommandContext(ctx, path, "jlist")
	cmd.Env = []string{"PATH=/usr/local/bin:/usr/bin:/bin"}
	if p.Home != "" {
		cmd.Env = append(cmd.Env, "PM2_HOME="+p.Home)
	}
	out, err := cmd.Output()
	if err != nil {
		var ee *exec.ExitError
		if errors.As(err, &ee) {
			return &protocol.PM2Collector{Status: protocol.StatusError, Error: "pm2 jlist failed"}
		}
		return &protocol.PM2Collector{Status: protocol.StatusError, Error: "pm2 could not be executed"}
	}
	return ParsePM2(out, time.Now())
}

// ParsePM2 converts `pm2 jlist` output into sanitized process entries.
func ParsePM2(raw []byte, now time.Time) *protocol.PM2Collector {
	var entries []pm2Entry
	if err := json.Unmarshal(raw, &entries); err != nil {
		return &protocol.PM2Collector{Status: protocol.StatusError, Error: "unparseable pm2 output"}
	}
	items := make([]protocol.PM2Process, 0, len(entries))
	for _, e := range entries {
		if len(items) >= protocol.MaxProcesses || e.Name == "" {
			continue
		}
		p := protocol.PM2Process{Name: protocol.Truncate(e.Name, 128), PMID: e.PMID, Status: "unknown"}
		if e.Env != nil {
			p.Status = protocol.Truncate(e.Env.Status, 32)
			p.Restarts = e.Env.RestartTime
			if e.Env.PMUptime > 0 && e.Env.Status == "online" {
				up := uint64(max(0, now.UnixMilli()-e.Env.PMUptime) / 1000)
				p.UptimeSec = &up
			}
		}
		if e.Monit != nil {
			p.CPUPercent = e.Monit.CPU
			p.MemoryBytes = e.Monit.Memory
		}
		items = append(items, p)
	}
	return &protocol.PM2Collector{Status: protocol.StatusOK, Items: items}
}
