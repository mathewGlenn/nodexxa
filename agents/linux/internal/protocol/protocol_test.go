package protocol

import (
	"bytes"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

const fixtures = "../../../../packages/protocol/fixtures/v1"

// Decoding with DisallowUnknownFields proves every field the server schema accepts in the
// fixtures exists in the Go structs; re-encoding proves field names round-trip unchanged.
func TestValidFixturesMatchGoStructs(t *testing.T) {
	files, err := filepath.Glob(filepath.Join(fixtures, "valid", "*.json"))
	if err != nil || len(files) == 0 {
		t.Fatalf("no fixtures found: %v", err)
	}
	for _, f := range files {
		raw, err := os.ReadFile(f)
		if err != nil {
			t.Fatal(err)
		}
		var target any
		switch base := filepath.Base(f); {
		case strings.HasPrefix(base, "telemetry"):
			target = &TelemetryRequest{}
		case strings.HasPrefix(base, "enroll"):
			target = &EnrollRequest{}
		case strings.HasPrefix(base, "rotate"):
			target = &RotateKeyRequest{}
		default:
			t.Fatalf("unknown fixture %s", base)
		}
		dec := json.NewDecoder(bytes.NewReader(raw))
		dec.DisallowUnknownFields()
		if err := dec.Decode(target); err != nil {
			t.Errorf("%s: %v", f, err)
			continue
		}
		again, _ := json.Marshal(target)
		var a, b map[string]any
		_ = json.Unmarshal(raw, &a)
		_ = json.Unmarshal(again, &b)
		if !sameKeys(a, b) {
			t.Errorf("%s: field names do not round-trip\nfixture: %s\ngo:      %s", f, raw, again)
		}
	}
}

func sameKeys(a, b any) bool {
	switch av := a.(type) {
	case map[string]any:
		bv, ok := b.(map[string]any)
		if !ok {
			return false
		}
		for k, v := range av {
			if _, ok := bv[k]; !ok {
				return false
			}
			if !sameKeys(v, bv[k]) {
				return false
			}
		}
		return true
	case []any:
		bv, ok := b.([]any)
		if !ok || len(av) != len(bv) {
			return false
		}
		for i := range av {
			if !sameKeys(av[i], bv[i]) {
				return false
			}
		}
		return true
	default:
		return true
	}
}

func TestSigningStringMatchesServer(t *testing.T) {
	// Same vector as apps/dashboard/tests/unit/protocol.test.ts (body hash differs: computed here).
	got := SigningString("post", "/api/agent/v1/telemetry", "id", "1700000000", "42", []byte("{}"))
	want := "nodexxa-v1\nPOST\n/api/agent/v1/telemetry\nid\n1700000000\n42\n44136fa355b3678a1146ad16f7e8649e94fb4fc21fe77e8310c060f61caaff8a"
	if got != want {
		t.Fatalf("got %q want %q", got, want)
	}
}

func TestTruncateKeepsUTF8(t *testing.T) {
	if got := Truncate("héllo", 2); got != "h" {
		t.Fatalf("got %q", got)
	}
	if got := Truncate("abc", 10); got != "abc" {
		t.Fatalf("got %q", got)
	}
}
