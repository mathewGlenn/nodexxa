package agent

import (
	"bytes"
	"context"
	"crypto/ed25519"
	"crypto/tls"
	"crypto/x509"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"os"
	"strconv"
	"time"

	"github.com/mathewglenn/nodexxa/agents/linux/internal/protocol"
)

var (
	ErrUnauthorized    = errors.New("server rejected agent credentials (revoked or unknown agent)")
	ErrReplay          = errors.New("server rejected request sequence")
	ErrRejected        = errors.New("server rejected payload")
	ErrUpgradeRequired = errors.New("server does not support this protocol version")
)

// RetryableError marks transient failures (network, 429, 5xx); data stays queued.
type RetryableError struct{ Msg string }

func (e *RetryableError) Error() string { return e.Msg }

type Client struct {
	Base    *url.URL
	HTTP    *http.Client
	State   *State
	Version string
}

// NewClient builds an outbound-only HTTPS client. Plain HTTP is accepted only for loopback
// development servers. Redirects are refused so signed requests never go elsewhere.
func NewClient(server, caFile string, state *State, version string) (*Client, error) {
	u, err := url.Parse(server)
	if err != nil || u.Host == "" {
		return nil, fmt.Errorf("invalid server URL")
	}
	if u.Scheme != "https" && !(u.Scheme == "http" && isLoopback(u.Hostname())) {
		return nil, fmt.Errorf("server URL must use https (http is only allowed for loopback development)")
	}
	tlsCfg := &tls.Config{MinVersion: tls.VersionTLS12}
	if caFile != "" {
		pem, err := os.ReadFile(caFile)
		if err != nil {
			return nil, fmt.Errorf("read CA file: %w", err)
		}
		pool, _ := x509.SystemCertPool()
		if pool == nil {
			pool = x509.NewCertPool()
		}
		if !pool.AppendCertsFromPEM(pem) {
			return nil, fmt.Errorf("CA file contains no certificates")
		}
		tlsCfg.RootCAs = pool
	}
	transport := http.DefaultTransport.(*http.Transport).Clone()
	transport.TLSClientConfig = tlsCfg
	transport.MaxIdleConns = 2
	return &Client{
		Base: u,
		HTTP: &http.Client{
			Timeout:       30 * time.Second,
			Transport:     transport,
			CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse },
		},
		State:   state,
		Version: version,
	}, nil
}

func isLoopback(host string) bool {
	if host == "localhost" {
		return true
	}
	ip := net.ParseIP(host)
	return ip != nil && ip.IsLoopback()
}

func (c *Client) endpoint(path string) string {
	u := *c.Base
	u.Path = path
	u.RawQuery = ""
	return u.String()
}

// Enroll exchanges a one-time token; the private key never leaves the host.
func (c *Client) Enroll(ctx context.Context, req protocol.EnrollRequest) (*protocol.EnrollResponse, error) {
	body, _ := json.Marshal(req)
	httpReq, _ := http.NewRequestWithContext(ctx, http.MethodPost, c.endpoint("/api/agent/v1/enroll"), bytes.NewReader(body))
	httpReq.Header.Set("Content-Type", "application/json")
	httpReq.Header.Set("User-Agent", "nodexxa-agent/"+c.Version)
	res, err := c.HTTP.Do(httpReq)
	if err != nil {
		return nil, fmt.Errorf("enroll request failed: %w", err)
	}
	defer res.Body.Close()
	data, _ := io.ReadAll(io.LimitReader(res.Body, 64<<10))
	if res.StatusCode != http.StatusCreated {
		return nil, fmt.Errorf("enrollment refused (HTTP %d): %s", res.StatusCode, serverMessage(data))
	}
	var out protocol.EnrollResponse
	if err := json.Unmarshal(data, &out); err != nil || out.AgentID == "" {
		return nil, fmt.Errorf("malformed enrollment response")
	}
	return &out, nil
}

// PostSigned sends an authenticated request: Ed25519 signature over method, path, agent id,
// timestamp, strictly increasing sequence and body hash.
func (c *Client) PostSigned(ctx context.Context, path string, payload any, key ed25519.PrivateKey) ([]byte, error) {
	body, err := json.Marshal(payload)
	if err != nil {
		return nil, err
	}
	if len(body) > protocol.MaxBodyBytes {
		return nil, fmt.Errorf("%w: payload exceeds %d bytes", ErrRejected, protocol.MaxBodyBytes)
	}
	seq, err := c.State.NextSeq()
	if err != nil {
		return nil, err
	}
	ts := strconv.FormatInt(time.Now().Unix(), 10)
	seqStr := strconv.FormatUint(seq, 10)
	sig := ed25519.Sign(key, []byte(protocol.SigningString(http.MethodPost, path, c.State.ID.AgentID, ts, seqStr, body)))

	req, _ := http.NewRequestWithContext(ctx, http.MethodPost, c.endpoint(path), bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("User-Agent", "nodexxa-agent/"+c.Version)
	req.Header.Set("X-Nodexxa-Agent-Id", c.State.ID.AgentID)
	req.Header.Set("X-Nodexxa-Timestamp", ts)
	req.Header.Set("X-Nodexxa-Seq", seqStr)
	req.Header.Set("X-Nodexxa-Signature", base64.StdEncoding.EncodeToString(sig))
	res, err := c.HTTP.Do(req)
	if err != nil {
		return nil, &RetryableError{Msg: "dashboard unreachable"}
	}
	defer res.Body.Close()
	data, _ := io.ReadAll(io.LimitReader(res.Body, 64<<10))
	switch {
	case res.StatusCode >= 200 && res.StatusCode < 300:
		return data, nil
	case res.StatusCode == http.StatusUnauthorized:
		return nil, fmt.Errorf("%w: %s", ErrUnauthorized, serverMessage(data))
	case res.StatusCode == http.StatusConflict:
		return nil, ErrReplay
	case res.StatusCode == http.StatusUpgradeRequired:
		return nil, ErrUpgradeRequired
	case res.StatusCode == http.StatusTooManyRequests || res.StatusCode >= 500:
		return nil, &RetryableError{Msg: fmt.Sprintf("dashboard responded %d", res.StatusCode)}
	default:
		return nil, fmt.Errorf("%w (HTTP %d): %s", ErrRejected, res.StatusCode, serverMessage(data))
	}
}

func serverMessage(data []byte) string {
	var m struct {
		StatusMessage string `json:"statusMessage"`
	}
	if json.Unmarshal(data, &m) == nil && m.StatusMessage != "" {
		return protocol.Truncate(m.StatusMessage, 200)
	}
	return "no details"
}

// RotateKey installs a new key: the request is signed with the current key and carries a proof
// signed by the new key. The new key is written to disk only after the server accepts it.
func (c *Client) RotateKey(ctx context.Context) error {
	newKey, newPub, err := GenerateKey()
	if err != nil {
		return err
	}
	proof := ed25519.Sign(newKey, []byte(protocol.RotateProofMessage(c.State.ID.AgentID, newPub)))
	req := protocol.RotateKeyRequest{ProtocolVersion: protocol.Version, NewPublicKey: newPub, Proof: base64.StdEncoding.EncodeToString(proof)}
	if _, err := c.PostSigned(ctx, "/api/agent/v1/rotate-key", req, c.State.Key()); err != nil {
		return err
	}
	return c.State.SaveKey(newKey)
}
