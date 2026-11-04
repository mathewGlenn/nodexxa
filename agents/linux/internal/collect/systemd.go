package collect

import (
	"bufio"
	"bytes"
	"context"
	"os/exec"
	"regexp"
	"strings"
	"time"

	"github.com/mathewglenn/nodexxa/agents/linux/internal/protocol"
)

// Systemd reports ActiveState/SubState for operator-allow-listed units only.
type Systemd struct {
	Units  []string
	Binary string // default "systemctl"
}

var unitName = regexp.MustCompile(`^[\w@.:-]{1,256}$`)

// ValidUnit rejects anything that is not a plain unit name (no options, globs or paths).
func ValidUnit(u string) bool { return unitName.MatchString(u) && !strings.HasPrefix(u, "-") }

func (s *Systemd) Collect(ctx context.Context) *protocol.SystemdCollector {
	if len(s.Units) == 0 {
		return &protocol.SystemdCollector{Status: protocol.StatusDisabled}
	}
	bin := s.Binary
	if bin == "" {
		bin = "systemctl"
	}
	path, err := exec.LookPath(bin)
	if err != nil {
		return &protocol.SystemdCollector{Status: protocol.StatusUnavailable, Error: "systemctl not found"}
	}
	units := make([]string, 0, len(s.Units))
	for _, u := range s.Units {
		if ValidUnit(u) && len(units) < protocol.MaxUnits {
			units = append(units, u)
		}
	}
	ctx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	args := append([]string{"show", "--property=Id,ActiveState,SubState", "--"}, units...)
	cmd := exec.CommandContext(ctx, path, args...)
	cmd.Env = []string{"PATH=/usr/bin:/bin", "SYSTEMD_PAGER="}
	out, err := cmd.Output()
	if err != nil {
		return &protocol.SystemdCollector{Status: protocol.StatusError, Error: "systemctl show failed"}
	}
	return ParseSystemctlShow(out)
}

// ParseSystemctlShow parses blank-line separated "Key=Value" blocks.
func ParseSystemctlShow(raw []byte) *protocol.SystemdCollector {
	items := []protocol.SystemdUnit{}
	cur := protocol.SystemdUnit{}
	flush := func() {
		if cur.Name != "" && ValidUnit(cur.Name) {
			items = append(items, cur)
		}
		cur = protocol.SystemdUnit{}
	}
	sc := bufio.NewScanner(bytes.NewReader(raw))
	for sc.Scan() {
		line := sc.Text()
		if line == "" {
			flush()
			continue
		}
		k, v, _ := strings.Cut(line, "=")
		switch k {
		case "Id":
			cur.Name = v
		case "ActiveState":
			cur.ActiveState = protocol.Truncate(v, 32)
		case "SubState":
			cur.SubState = protocol.Truncate(v, 32)
		}
	}
	flush()
	return &protocol.SystemdCollector{Status: protocol.StatusOK, Items: items}
}
