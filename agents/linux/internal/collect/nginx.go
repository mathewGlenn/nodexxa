package collect

import (
	"bufio"
	"context"
	"crypto/x509"
	"encoding/pem"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"github.com/mathewglenn/nodexxa/agents/linux/internal/protocol"
)

// Nginx reports service state, server names / listen directives of enabled sites and certificate
// expiry. Config files are scanned for three directives only (server_name, listen, ssl_certificate);
// config bodies, file paths and private keys are never reported or read.
type Nginx struct {
	ConfDirs []string // default /etc/nginx/sites-enabled, /etc/nginx/conf.d
	Binary   string   // systemctl, used for `is-active nginx`
}

func (n *Nginx) Collect(ctx context.Context) *protocol.Nginx {
	dirs := n.ConfDirs
	if len(dirs) == 0 {
		dirs = []string{"/etc/nginx/sites-enabled", "/etc/nginx/conf.d"}
	}
	out := &protocol.Nginx{Status: protocol.StatusOK}
	out.Active = n.isActive(ctx)

	sites, certPaths, readable := ScanNginxConfigs(dirs)
	if !readable && out.Active == nil {
		return &protocol.Nginx{Status: protocol.StatusUnavailable, Error: "nginx not detected"}
	}
	out.Sites = sites
	out.Certificates = readCertificates(certPaths)
	return out
}

func (n *Nginx) isActive(ctx context.Context) *bool {
	bin := n.Binary
	if bin == "" {
		bin = "systemctl"
	}
	path, err := exec.LookPath(bin)
	if err != nil {
		return nil
	}
	ctx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	cmd := exec.CommandContext(ctx, path, "is-active", "--", "nginx.service")
	cmd.Env = []string{"PATH=/usr/bin:/bin"}
	out, _ := cmd.Output()
	state := strings.TrimSpace(string(out))
	if state == "" || state == "unknown" {
		return nil
	}
	active := state == "active"
	return &active
}

// ScanNginxConfigs extracts per-server-block names/listen/TLS flags and certificate paths.
func ScanNginxConfigs(dirs []string) (sites []protocol.NginxSite, certPaths []string, readable bool) {
	sites = []protocol.NginxSite{}
	certSet := map[string]bool{}
	for _, dir := range dirs {
		entries, err := os.ReadDir(dir)
		if err != nil {
			continue
		}
		readable = true
		for _, e := range entries {
			if e.IsDir() || strings.HasPrefix(e.Name(), ".") {
				continue
			}
			f, err := os.Open(filepath.Join(dir, e.Name()))
			if err != nil {
				continue
			}
			parseServerBlocks(f, &sites, certSet)
			f.Close()
			if len(sites) >= protocol.MaxSites {
				sites = sites[:protocol.MaxSites]
				break
			}
		}
	}
	for p := range certSet {
		certPaths = append(certPaths, p)
	}
	sort.Strings(certPaths)
	return sites, certPaths, readable
}

func parseServerBlocks(f *os.File, sites *[]protocol.NginxSite, certs map[string]bool) {
	sc := bufio.NewScanner(f)
	sc.Buffer(make([]byte, 64*1024), 1024*1024)
	depth, serverDepth := 0, -1
	var cur *protocol.NginxSite
	for sc.Scan() {
		line := strings.TrimSpace(sc.Text())
		if i := strings.IndexByte(line, '#'); i >= 0 {
			line = strings.TrimSpace(line[:i])
		}
		if line == "" {
			continue
		}
		fields := strings.Fields(strings.TrimSuffix(strings.TrimSuffix(line, "{"), ";"))
		if len(fields) > 0 && fields[0] == "server" && strings.HasSuffix(line, "{") && serverDepth < 0 {
			serverDepth = depth
			cur = &protocol.NginxSite{ServerNames: []string{}, Listen: []string{}}
		}
		if cur != nil && depth == serverDepth+1 && len(fields) > 1 {
			switch fields[0] {
			case "server_name":
				for _, n := range fields[1:] {
					if len(cur.ServerNames) < 20 && n != "_" {
						cur.ServerNames = append(cur.ServerNames, protocol.Truncate(n, 253))
					}
				}
			case "listen":
				if len(cur.Listen) < 10 {
					cur.Listen = append(cur.Listen, protocol.Truncate(strings.Join(fields[1:], " "), 64))
				}
				if strings.Contains(line, "ssl") || strings.Contains(line, "quic") {
					cur.TLS = true
				}
			case "ssl_certificate":
				cur.TLS = true
				if p := strings.Trim(fields[1], `"'`); filepath.IsAbs(p) && !strings.Contains(p, "$") {
					certs[filepath.Clean(p)] = true
				}
			}
		}
		depth += strings.Count(line, "{") - strings.Count(line, "}")
		if cur != nil && depth <= serverDepth {
			*sites = append(*sites, *cur)
			cur, serverDepth = nil, -1
		}
	}
}

// readCertificates parses only CERTIFICATE PEM blocks (public data) for subject and expiry.
func readCertificates(paths []string) []protocol.NginxCert {
	out := []protocol.NginxCert{}
	for _, p := range paths {
		if len(out) >= protocol.MaxCerts {
			break
		}
		raw, err := os.ReadFile(p)
		if err != nil || len(raw) > 1<<20 {
			continue
		}
		var block *pem.Block
		for rest := raw; ; {
			if block, rest = pem.Decode(rest); block == nil || block.Type == "CERTIFICATE" {
				break
			}
		}
		if block == nil {
			continue
		}
		cert, err := x509.ParseCertificate(block.Bytes)
		if err != nil {
			continue
		}
		subject := cert.Subject.CommonName
		if subject == "" && len(cert.DNSNames) > 0 {
			subject = cert.DNSNames[0]
		}
		out = append(out, protocol.NginxCert{Subject: protocol.Truncate(subject, 253), NotAfter: cert.NotAfter.UTC().Format(time.RFC3339)})
	}
	return out
}
