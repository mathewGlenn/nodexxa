package collect

import (
	"context"
	"encoding/json"
	"io"
	"net"
	"net/http"
	"regexp"
	"strings"
	"time"

	"github.com/mathewglenn/nodexxa/agents/linux/internal/protocol"
)

// Docker lists containers through the Engine API. Opt-in only: read access to the Docker socket is
// root-equivalent. Only GET /containers/json is called; container inspect (env, mounts, labels,
// command) is never requested.
type Docker struct {
	Socket string // default /var/run/docker.sock
}

var hexID = regexp.MustCompile(`^[0-9a-f]{12}`)

type dockerContainer struct {
	ID     string   `json:"Id"`
	Names  []string `json:"Names"`
	Image  string   `json:"Image"`
	State  string   `json:"State"`
	Status string   `json:"Status"`
}

func (d *Docker) Collect(ctx context.Context) *protocol.DockerCollector {
	sock := d.Socket
	if sock == "" {
		sock = "/var/run/docker.sock"
	}
	client := &http.Client{
		Timeout: 10 * time.Second,
		Transport: &http.Transport{DialContext: func(ctx context.Context, _, _ string) (net.Conn, error) {
			return (&net.Dialer{}).DialContext(ctx, "unix", sock)
		}},
	}
	req, _ := http.NewRequestWithContext(ctx, http.MethodGet, "http://docker/containers/json?all=1", nil)
	res, err := client.Do(req)
	if err != nil {
		return &protocol.DockerCollector{Status: protocol.StatusUnavailable, Error: "docker socket not reachable"}
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		return &protocol.DockerCollector{Status: protocol.StatusError, Error: "docker API returned " + res.Status}
	}
	body, err := io.ReadAll(io.LimitReader(res.Body, 4<<20))
	if err != nil {
		return &protocol.DockerCollector{Status: protocol.StatusError, Error: "docker API read failed"}
	}
	return ParseDocker(body)
}

func ParseDocker(raw []byte) *protocol.DockerCollector {
	var list []dockerContainer
	if err := json.Unmarshal(raw, &list); err != nil {
		return &protocol.DockerCollector{Status: protocol.StatusError, Error: "unparseable docker output"}
	}
	items := make([]protocol.Container, 0, len(list))
	for _, c := range list {
		if len(items) >= protocol.MaxContainers || !hexID.MatchString(c.ID) {
			continue
		}
		name := c.ID[:12]
		if len(c.Names) > 0 {
			name = strings.TrimPrefix(c.Names[0], "/")
		}
		items = append(items, protocol.Container{
			ID: c.ID[:12], Name: protocol.Truncate(name, 128), Image: protocol.Truncate(c.Image, 256),
			State: protocol.Truncate(c.State, 32), Health: healthFromStatus(c.Status), Status: protocol.Truncate(c.Status, 128),
		})
	}
	return &protocol.DockerCollector{Status: protocol.StatusOK, Items: items}
}

func healthFromStatus(s string) string {
	switch {
	case strings.Contains(s, "(unhealthy)"):
		return "unhealthy"
	case strings.Contains(s, "(healthy)"):
		return "healthy"
	case strings.Contains(s, "(health: starting)"):
		return "starting"
	default:
		return "none"
	}
}
