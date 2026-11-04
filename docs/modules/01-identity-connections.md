# Identity, workspaces and DigitalOcean connections

Secure email/password login with reputable password hashing and server-side sessions; bootstrap/admin provisioning with no static production default credentials. CSRF protections for mutation endpoints, secure cookies, rate limits on auth and token enrollment.

Workspace users: Owner, Admin, Viewer. Invite/disable members using explicit permission checks. Audit privileged changes.

Connections: create/verify/delete or disable distinct DO team integrations; label with owner/client, test scopes, show masked token suffix, last successful sync, failures, rate-limit state and credential rotation history. Encrypt tokens at rest (AEAD) with separate key supplied as environment secret, never log or return plaintext after entry. Keep auth scopes least privileged. Do not use client-provided workspace IDs without membership checks. API pagination and retries. Carefully handle resource/project discovery with explicit cross-account uniqueness `(connectionId, providerResourceType, providerResourceId)`.
