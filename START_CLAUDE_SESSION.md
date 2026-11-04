# One-shot Claude Cloud Session prompt

Read `CLAUDE.md`, `IMPLEMENTATION_STATUS.md`, and every file under `docs/` before implementation. Build **Nodexxa**, a complete production-oriented infrastructure monitoring platform, in one autonomous coding session.

Implement both mandatory layers in this single monorepo: (1) unified read-only DigitalOcean integration for multiple independent teams/accounts and projects, and (2) optional lightweight outbound-only Go agents providing Linux/PM2/Docker/Nginx visibility. Respect provider scopes, tenant/account boundaries, credential encryption, agent enrollment, versioned protocols, ingestion security, retention, availability/staleness semantics, and tests.

Use Nuxt 4 + Nitro, Nuxt UI, Vue 3, PostgreSQL + Prisma, Zod, Go, Vitest, Playwright, Docker, and systemd. Create a polished administrative UI with Light / Dark / System theme support across every page, with persistent preferences and no hydration flash.

Follow the milestones in `docs/03-execution-plan.md` and update `IMPLEMENTATION_STATUS.md` as you complete each module. Write functional database-backed features, not static mocks. Implement unit, integration, API, security, agent and end-to-end tests. Run them, fix failures, verify builds, and document what could not be verified due to cloud-environment limitations.

Conserve tokens by favoring existing framework primitives, minimizing unnecessary layers, and following `docs/engineering/lean-code.md`. Work autonomously without asking routine questions. Commit and push complete increments to a feature branch, create a PR if possible, and provide a verified final report. Do not stop at scaffolding or call it production-ready without actual verification. Never perform destructive or administrative actions against real infrastructure. Begin implementation now.
