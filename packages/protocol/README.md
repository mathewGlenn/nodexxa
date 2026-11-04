# Nodexxa agent protocol v1

- Source of truth: `apps/dashboard/server/utils/protocol.ts` (Zod). `schema/v1.json` is generated (`pnpm --filter dashboard cli protocol-schema`); a unit test fails if it drifts.
- Fixtures: `fixtures/v1/valid/*` must be accepted by the server schema **and** decode into the Go structs with unknown fields disallowed (`agents/linux/internal/protocol`); `fixtures/v1/invalid/*` must be rejected.
- Compatibility: servers accept every version in `SUPPORTED_PROTOCOL_VERSIONS` and answer `426` otherwise. Unknown fields are stripped (newer agents can add optional fields). Breaking changes require v2 alongside v1.

## Endpoints
| Method/path | Auth | Body |
|---|---|---|
| `POST /api/agent/v1/enroll` | one-time enrollment token in body | `enrollRequest` → `201 {agentId, protocolVersion, ingestIntervalSec, maxSnapshots}` |
| `POST /api/agent/v1/telemetry` | signature | `telemetryRequest` (1–20 snapshots, ≤512 KiB) → `202 {accepted, dropped, ingestIntervalSec, serverTime}` |
| `POST /api/agent/v1/rotate-key` | signature (current key) | `{protocolVersion, newPublicKey, proof}` — proof = new key's signature over `nodexxa-v1-rotate\n<agentId>\n<newPublicKey>` |

## Request signing
Headers: `X-Nodexxa-Agent-Id`, `X-Nodexxa-Timestamp` (unix seconds, ±300 s), `X-Nodexxa-Seq` (decimal, strictly increasing per agent, 1…2⁶³−1), `X-Nodexxa-Signature` (base64 Ed25519).
Signed message (newline-joined): `nodexxa-v1`, METHOD, path (no query), agent id, timestamp, seq, hex SHA-256 of the exact body bytes.

Errors: `401` (unknown/revoked agent, bad signature or timestamp — deliberately generic), `409` (sequence not increasing), `411/413` (missing/oversized body), `400` (schema), `426` (unsupported version), `429` (rate limit, 20 req/min/agent).
