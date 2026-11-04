// nodexxa-agent: optional, outbound-only Linux monitoring agent for Nodexxa.
// It never listens on a port and has no remote command endpoint.
package main

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"log/slog"
	"os"
	"os/signal"
	"runtime"
	"strings"
	"syscall"
	"time"

	"github.com/mathewglenn/nodexxa/agents/linux/internal/agent"
	"github.com/mathewglenn/nodexxa/agents/linux/internal/collect"
	"github.com/mathewglenn/nodexxa/agents/linux/internal/protocol"
)

// Set at build time: -ldflags "-X main.version=1.2.3"
var version = "0.1.0-dev"

type Config struct {
	StateDir    string `json:"stateDir"`
	IntervalSec int    `json:"intervalSec"`
	CAFile      string `json:"caFile"`
	QueueMax    int    `json:"queueMax"`
	Collectors  struct {
		PM2          bool     `json:"pm2"`
		PM2Home      string   `json:"pm2Home"`
		Docker       bool     `json:"docker"` // opt-in: docker socket access is root-equivalent
		DockerSocket string   `json:"dockerSocket"`
		Nginx        bool     `json:"nginx"`
		NginxDirs    []string `json:"nginxDirs"`
		SystemdUnits []string `json:"systemdUnits"`
	} `json:"collectors"`
}

func defaultConfig() Config {
	var c Config
	c.StateDir = "/var/lib/nodexxa-agent"
	c.IntervalSec = 60
	c.QueueMax = 120
	c.Collectors.PM2 = true
	c.Collectors.Nginx = true
	return c
}

func loadConfig(path string) (Config, error) {
	c := defaultConfig()
	raw, err := os.ReadFile(path)
	if errors.Is(err, os.ErrNotExist) {
		return c, nil
	}
	if err != nil {
		return c, err
	}
	dec := json.NewDecoder(strings.NewReader(string(raw)))
	dec.DisallowUnknownFields()
	if err := dec.Decode(&c); err != nil {
		return c, fmt.Errorf("config %s: %w", path, err)
	}
	if c.IntervalSec < 15 || c.IntervalSec > 3600 {
		return c, fmt.Errorf("intervalSec must be between 15 and 3600")
	}
	if c.QueueMax < 1 || c.QueueMax > 10000 {
		return c, fmt.Errorf("queueMax must be between 1 and 10000")
	}
	for _, u := range c.Collectors.SystemdUnits {
		if !collect.ValidUnit(u) {
			return c, fmt.Errorf("invalid systemd unit name %q", u)
		}
	}
	return c, nil
}

func collectors(c Config) agent.Collectors {
	cs := agent.Collectors{System: &collect.System{ProcRoot: "/proc"}}
	if c.Collectors.PM2 {
		cs.PM2 = &collect.PM2{Home: c.Collectors.PM2Home}
	}
	if c.Collectors.Docker {
		cs.Docker = &collect.Docker{Socket: c.Collectors.DockerSocket}
	}
	if c.Collectors.Nginx {
		cs.Nginx = &collect.Nginx{ConfDirs: c.Collectors.NginxDirs}
	}
	if len(c.Collectors.SystemdUnits) > 0 {
		cs.Systemd = &collect.Systemd{Units: c.Collectors.SystemdUnits}
	}
	return cs
}

func usage() {
	fmt.Fprintf(os.Stderr, `nodexxa-agent %s — outbound-only Linux monitoring agent

Usage:
  nodexxa-agent enroll --server https://dashboard.example [--config FILE] [--state-dir DIR]
      Enrollment token is read from $NODEXXA_ENROLLMENT_TOKEN or stdin (never a flag: argv is visible in ps).
  nodexxa-agent run [--config FILE] [--once]
  nodexxa-agent rotate-key [--config FILE]
  nodexxa-agent version
`, version)
}

func main() {
	log := slog.New(slog.NewJSONHandler(os.Stderr, &slog.HandlerOptions{Level: slog.LevelInfo}))
	if len(os.Args) < 2 {
		usage()
		os.Exit(2)
	}
	cmd, args := os.Args[1], os.Args[2:]
	fs := flag.NewFlagSet(cmd, flag.ExitOnError)
	configPath := fs.String("config", "/etc/nodexxa-agent/config.json", "config file")
	stateDir := fs.String("state-dir", "", "state directory (overrides config)")
	server := fs.String("server", "", "dashboard URL (enroll only)")
	hostname := fs.String("hostname", "", "hostname to register (enroll only; default: os hostname)")
	once := fs.Bool("once", false, "collect and deliver once, then exit (run only)")
	_ = fs.Parse(args)

	if cmd == "version" {
		fmt.Printf("nodexxa-agent %s protocol v%d %s/%s\n", version, protocol.Version, runtime.GOOS, runtime.GOARCH)
		return
	}
	cfg, err := loadConfig(*configPath)
	if err != nil {
		fatal(log, err)
	}
	if *stateDir != "" {
		cfg.StateDir = *stateDir
	}
	state := &agent.State{Dir: cfg.StateDir}
	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	switch cmd {
	case "enroll":
		err = enroll(ctx, cfg, state, *server, *hostname)
	case "run":
		err = run(ctx, cfg, state, *once, log)
	case "rotate-key":
		err = rotate(ctx, cfg, state)
	default:
		usage()
		os.Exit(2)
	}
	if err != nil {
		fatal(log, err)
	}
}

func fatal(log *slog.Logger, err error) {
	log.Error("fatal", "error", err.Error())
	os.Exit(1)
}

func readToken() (string, error) {
	if t := strings.TrimSpace(os.Getenv("NODEXXA_ENROLLMENT_TOKEN")); t != "" {
		_ = os.Unsetenv("NODEXXA_ENROLLMENT_TOKEN")
		return t, nil
	}
	fmt.Fprint(os.Stderr, "Enrollment token: ")
	line, err := bufio.NewReader(os.Stdin).ReadString('\n')
	if err != nil && line == "" {
		return "", fmt.Errorf("no enrollment token provided")
	}
	return strings.TrimSpace(line), nil
}

func enroll(ctx context.Context, cfg Config, state *agent.State, server, hostname string) error {
	if server == "" {
		return fmt.Errorf("--server is required")
	}
	if err := state.EnsureDir(); err != nil {
		return err
	}
	if err := state.Load(); err == nil {
		return fmt.Errorf("already enrolled as %s; remove %s to re-enroll", state.ID.AgentID, cfg.StateDir)
	}
	token, err := readToken()
	if err != nil {
		return err
	}
	if hostname == "" {
		hostname, _ = os.Hostname()
	}
	key, pub, err := agent.GenerateKey()
	if err != nil {
		return err
	}
	client, err := agent.NewClient(server, cfg.CAFile, state, version)
	if err != nil {
		return err
	}
	res, err := client.Enroll(ctx, protocol.EnrollRequest{
		ProtocolVersion: protocol.Version, EnrollmentToken: token, PublicKey: pub, Hostname: protocol.Truncate(hostname, 253),
		OS: runtime.GOOS, Arch: runtime.GOARCH, AgentVersion: version, Capabilities: collectors(cfg).Capabilities(),
	})
	if err != nil {
		return err
	}
	if err := state.SaveKey(key); err != nil {
		return err
	}
	if err := state.SaveIdentity(agent.Identity{AgentID: res.AgentID, Server: client.Base.String()}); err != nil {
		return err
	}
	fmt.Fprintf(os.Stderr, "enrolled as agent %s\n", res.AgentID)
	return nil
}

func loadClient(cfg Config, state *agent.State) (*agent.Client, error) {
	if err := state.Load(); err != nil {
		return nil, err
	}
	return agent.NewClient(state.ID.Server, cfg.CAFile, state, version)
}

func run(ctx context.Context, cfg Config, state *agent.State, once bool, log *slog.Logger) error {
	client, err := loadClient(cfg, state)
	if err != nil {
		return err
	}
	r := &agent.Runner{Client: client, Collectors: collectors(cfg), Interval: time.Duration(cfg.IntervalSec) * time.Second, Queue: agent.NewQueue(cfg.QueueMax), Log: log}
	log.Info("agent starting", "version", version, "agentId", state.ID.AgentID, "server", state.ID.Server, "capabilities", r.Collectors.Capabilities())
	if once {
		// CPU% needs two samples; take a short baseline first.
		if r.Collectors.System != nil {
			_, _ = r.Collectors.System.Collect()
			time.Sleep(time.Second)
		}
		r.Queue.Push(r.Collect(ctx))
		return r.Flush(ctx)
	}
	return r.Run(ctx)
}

func rotate(ctx context.Context, cfg Config, state *agent.State) error {
	client, err := loadClient(cfg, state)
	if err != nil {
		return err
	}
	if err := client.RotateKey(ctx); err != nil {
		return err
	}
	fmt.Fprintln(os.Stderr, "agent key rotated")
	return nil
}
