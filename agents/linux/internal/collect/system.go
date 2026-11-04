// Package collect gathers approved, sanitized host metadata. Collectors never read environment
// variables, command lines, configuration bodies or arbitrary files.
package collect

import (
	"bufio"
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"syscall"

	"github.com/mathewglenn/nodexxa/agents/linux/internal/protocol"
)

// System reads /proc (root configurable for tests). CPU% needs two samples, so the first is null.
type System struct {
	ProcRoot string
	mu       sync.Mutex
	prevIdle uint64
	prevAll  uint64
}

var pseudoFS = map[string]bool{
	"proc": true, "sysfs": true, "devtmpfs": true, "devpts": true, "tmpfs": true, "cgroup": true, "cgroup2": true, "securityfs": true,
	"pstore": true, "bpf": true, "tracefs": true, "debugfs": true, "mqueue": true, "hugetlbfs": true, "fusectl": true, "configfs": true,
	"autofs": true, "squashfs": true, "overlay": true, "nsfs": true, "ramfs": true, "binfmt_misc": true, "efivarfs": true, "rpc_pipefs": true,
}

func (s *System) path(p string) string { return filepath.Join(s.ProcRoot, p) }

func (s *System) Collect() (*protocol.System, error) {
	out := &protocol.System{Filesystems: []protocol.Filesystem{}}
	var errs []string

	if b, err := os.ReadFile(s.path("uptime")); err == nil {
		if f := strings.Fields(string(b)); len(f) > 0 {
			v, _ := strconv.ParseFloat(f[0], 64)
			out.UptimeSec = uint64(v)
		}
	} else {
		errs = append(errs, "uptime")
	}

	if b, err := os.ReadFile(s.path("loadavg")); err == nil {
		f := strings.Fields(string(b))
		if len(f) >= 3 {
			out.Load1, _ = strconv.ParseFloat(f[0], 64)
			out.Load5, _ = strconv.ParseFloat(f[1], 64)
			out.Load15, _ = strconv.ParseFloat(f[2], 64)
		}
	} else {
		errs = append(errs, "loadavg")
	}

	if mem, err := readKV(s.path("meminfo")); err == nil {
		out.MemTotalBytes = mem["MemTotal"] * 1024
		out.MemAvailableBytes = mem["MemAvailable"] * 1024
		out.SwapTotalBytes = mem["SwapTotal"] * 1024
		out.SwapFreeBytes = mem["SwapFree"] * 1024
	} else {
		errs = append(errs, "meminfo")
	}

	if pct, err := s.cpuPercent(); err == nil {
		out.CPUPercent = pct
	} else {
		errs = append(errs, "stat")
	}

	out.Filesystems = s.filesystems()
	if len(errs) == 4 {
		return nil, fmt.Errorf("procfs unreadable")
	}
	return out, nil
}

func readKV(path string) (map[string]uint64, error) {
	f, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer f.Close()
	out := map[string]uint64{}
	sc := bufio.NewScanner(f)
	for sc.Scan() {
		k, v, ok := strings.Cut(sc.Text(), ":")
		if !ok {
			continue
		}
		if fields := strings.Fields(v); len(fields) > 0 {
			n, _ := strconv.ParseUint(fields[0], 10, 64)
			out[strings.TrimSpace(k)] = n
		}
	}
	return out, sc.Err()
}

func (s *System) cpuPercent() (*float64, error) {
	b, err := os.ReadFile(s.path("stat"))
	if err != nil {
		return nil, err
	}
	line, _, _ := strings.Cut(string(b), "\n")
	f := strings.Fields(line)
	if len(f) < 5 || f[0] != "cpu" {
		return nil, fmt.Errorf("unexpected /proc/stat")
	}
	var all, idle uint64
	for i, v := range f[1:] {
		n, _ := strconv.ParseUint(v, 10, 64)
		if i == 8 || i == 9 { // guest/guest_nice are already included in user/nice
			continue
		}
		all += n
		if i == 3 || i == 4 { // idle + iowait
			idle += n
		}
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	prevAll, prevIdle := s.prevAll, s.prevIdle
	s.prevAll, s.prevIdle = all, idle
	if prevAll == 0 || all <= prevAll || idle < prevIdle {
		return nil, nil
	}
	pct := 100 * (1 - float64(idle-prevIdle)/float64(all-prevAll))
	pct = float64(int(pct*100)) / 100
	return &pct, nil
}

func (s *System) filesystems() []protocol.Filesystem {
	out := []protocol.Filesystem{}
	f, err := os.Open(s.path("self/mounts"))
	if err != nil {
		return out
	}
	defer f.Close()
	seen := map[string]bool{}
	sc := bufio.NewScanner(f)
	for sc.Scan() && len(out) < protocol.MaxFS {
		fields := strings.Fields(sc.Text())
		if len(fields) < 3 || pseudoFS[fields[2]] || !strings.HasPrefix(fields[0], "/") {
			continue
		}
		mount := strings.ReplaceAll(fields[1], `\040`, " ")
		if seen[fields[0]] { // bind mounts of the same device
			continue
		}
		seen[fields[0]] = true
		var st syscall.Statfs_t
		if err := syscall.Statfs(mount, &st); err != nil || st.Blocks == 0 {
			continue
		}
		total := st.Blocks * uint64(st.Bsize)
		free := st.Bfree * uint64(st.Bsize)
		out = append(out, protocol.Filesystem{Mount: protocol.Truncate(mount, 256), FSType: protocol.Truncate(fields[2], 32), TotalBytes: total, UsedBytes: total - free})
	}
	return out
}
