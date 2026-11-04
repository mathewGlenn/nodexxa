package collect

import (
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/json"
	"encoding/pem"
	"math/big"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func mustNoLeak(t *testing.T, v any) {
	t.Helper()
	b, _ := json.Marshal(v)
	if strings.Contains(string(b), "LEAK_") {
		t.Fatalf("sensitive data leaked into output: %s", b)
	}
}

func TestSystemFromProcfs(t *testing.T) {
	s := &System{ProcRoot: "testdata/proc"}
	out, err := s.Collect()
	if err != nil {
		t.Fatal(err)
	}
	if out.UptimeSec != 12345 || out.Load1 != 0.52 || out.MemTotalBytes != 2000000*1024 || out.MemAvailableBytes != 1000000*1024 {
		t.Fatalf("unexpected values: %+v", out)
	}
	if out.CPUPercent != nil {
		t.Fatal("first CPU sample must be null (unknown), not zero")
	}
	// Advance counters: Δall=200, Δidle(idle+iowait)=100 → 50 %.
	dir := t.TempDir()
	copyDir(t, "testdata/proc", dir)
	s.ProcRoot = dir
	if err := os.WriteFile(filepath.Join(dir, "stat"), []byte("cpu  150 0 100 880 70 0 0 0 0 0\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	out, _ = s.Collect()
	if out.CPUPercent == nil || *out.CPUPercent != 50 {
		t.Fatalf("cpu = %v", out.CPUPercent)
	}
	for _, fs := range out.Filesystems {
		if fs.FSType == "tmpfs" || fs.FSType == "proc" {
			t.Fatalf("pseudo filesystem reported: %+v", fs)
		}
	}
}

func TestSystemMissingProcIsError(t *testing.T) {
	if _, err := (&System{ProcRoot: t.TempDir()}).Collect(); err == nil {
		t.Fatal("expected error for empty procfs")
	}
}

func TestPM2SanitizesEnvAndArgs(t *testing.T) {
	raw, _ := os.ReadFile("testdata/pm2-jlist.json")
	out := ParsePM2(raw, time.UnixMilli(1700000060000))
	mustNoLeak(t, out)
	if out.Status != "ok" || len(out.Items) != 2 {
		t.Fatalf("unexpected: %+v", out)
	}
	api := out.Items[0]
	if api.Name != "api" || api.Status != "online" || api.Restarts != 3 || *api.UptimeSec != 60 || *api.MemoryBytes != 104857600 {
		t.Fatalf("api: %+v", api)
	}
	if out.Items[1].Status != "errored" || out.Items[1].UptimeSec != nil {
		t.Fatalf("worker: %+v", out.Items[1])
	}
	if bad := ParsePM2([]byte("not json"), time.Now()); bad.Status != "error" {
		t.Fatal("garbage must be reported as collector error")
	}
}

func TestDockerKeepsOnlyListMetadata(t *testing.T) {
	raw, _ := os.ReadFile("testdata/docker-containers.json")
	out := ParseDocker(raw)
	mustNoLeak(t, out)
	if len(out.Items) != 2 {
		t.Fatalf("expected malformed id to be skipped: %+v", out.Items)
	}
	if out.Items[0].Name != "redis" || out.Items[0].ID != "0123456789ab" || out.Items[0].Health != "healthy" {
		t.Fatalf("redis: %+v", out.Items[0])
	}
	if out.Items[1].Health != "unhealthy" {
		t.Fatalf("web: %+v", out.Items[1])
	}
}

func TestDockerSocketMissingIsUnavailable(t *testing.T) {
	out := (&Docker{Socket: filepath.Join(t.TempDir(), "nope.sock")}).Collect(t.Context())
	if out.Status != "unavailable" {
		t.Fatalf("got %+v", out)
	}
}

func TestNginxExtractsOnlyNamesAndCertExpiry(t *testing.T) {
	dir := t.TempDir()
	certPath := filepath.Join(dir, "fullchain.pem")
	notAfter := time.Date(2030, 1, 2, 3, 4, 5, 0, time.UTC)
	writeCert(t, certPath, "example.com", notAfter)
	conf, _ := os.ReadFile("testdata/nginx/example.conf")
	confDir := filepath.Join(dir, "sites-enabled")
	_ = os.Mkdir(confDir, 0o755)
	_ = os.WriteFile(filepath.Join(confDir, "example"), []byte(strings.ReplaceAll(string(conf), "CERTPATH", certPath)), 0o644)

	out := (&Nginx{ConfDirs: []string{confDir}, Binary: "definitely-not-systemctl"}).Collect(t.Context())
	mustNoLeak(t, out)
	if strings.Contains(mustJSON(out), dir) {
		t.Fatal("file paths must not be reported")
	}
	if len(out.Sites) != 2 || out.Sites[0].TLS || !out.Sites[1].TLS {
		t.Fatalf("sites: %+v", out.Sites)
	}
	if strings.Join(out.Sites[0].ServerNames, ",") != "example.com,www.example.com" || out.Sites[1].Listen[0] != "443 ssl http2" {
		t.Fatalf("site detail: %+v", out.Sites)
	}
	if len(out.Certificates) != 1 || out.Certificates[0].Subject != "example.com" || out.Certificates[0].NotAfter != "2030-01-02T03:04:05Z" {
		t.Fatalf("certs: %+v", out.Certificates)
	}
	if out.Active != nil {
		t.Fatal("unknown service state must be null, not false")
	}
}

func TestNginxAbsent(t *testing.T) {
	out := (&Nginx{ConfDirs: []string{filepath.Join(t.TempDir(), "missing")}, Binary: "definitely-not-systemctl"}).Collect(t.Context())
	if out.Status != "unavailable" {
		t.Fatalf("got %+v", out)
	}
}

func TestSystemdParsingAndUnitValidation(t *testing.T) {
	out := ParseSystemctlShow([]byte("Id=nginx.service\nActiveState=active\nSubState=running\n\nId=app@1.service\nActiveState=failed\nSubState=failed\n"))
	if len(out.Items) != 2 || out.Items[1].ActiveState != "failed" {
		t.Fatalf("got %+v", out.Items)
	}
	for _, bad := range []string{"--all", "-H host", "nginx; rm", "../x", ""} {
		if ValidUnit(bad) {
			t.Fatalf("%q must be rejected", bad)
		}
	}
	if (&Systemd{}).Collect(t.Context()).Status != "disabled" {
		t.Fatal("no allow-listed units means disabled")
	}
}

func mustJSON(v any) string { b, _ := json.Marshal(v); return string(b) }

func copyDir(t *testing.T, src, dst string) {
	t.Helper()
	_ = filepath.Walk(src, func(p string, info os.FileInfo, err error) error {
		rel, _ := filepath.Rel(src, p)
		if info.IsDir() {
			return os.MkdirAll(filepath.Join(dst, rel), 0o755)
		}
		b, _ := os.ReadFile(p)
		return os.WriteFile(filepath.Join(dst, rel), b, 0o644)
	})
}

func writeCert(t *testing.T, path, cn string, notAfter time.Time) {
	t.Helper()
	key, _ := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	tpl := &x509.Certificate{SerialNumber: big.NewInt(1), Subject: pkix.Name{CommonName: cn}, NotBefore: time.Now().Add(-time.Hour), NotAfter: notAfter}
	der, err := x509.CreateCertificate(rand.Reader, tpl, tpl, &key.PublicKey, key)
	if err != nil {
		t.Fatal(err)
	}
	keyDER, _ := x509.MarshalECPrivateKey(key)
	// A key block before the cert must be skipped and never reported.
	data := append(pem.EncodeToMemory(&pem.Block{Type: "EC PRIVATE KEY", Bytes: keyDER}), pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: der})...)
	if err := os.WriteFile(path, data, 0o644); err != nil {
		t.Fatal(err)
	}
}
