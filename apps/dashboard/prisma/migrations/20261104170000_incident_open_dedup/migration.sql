-- At most one unresolved incident per dedup key (DB-enforced deduplication).
CREATE UNIQUE INDEX "Incident_open_dedup_key" ON "Incident" ("dedupKey") WHERE "status" <> 'RESOLVED';
