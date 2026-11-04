# Nodexxa — Agent instructions

Nodexxa is a self-hosted, production-oriented infrastructure observability platform. Read every specification in `docs/` before implementation, then follow `docs/03-execution-plan.md` and track progress in `IMPLEMENTATION_STATUS.md`.

## Nonnegotiables
- Implement **Layer 1** multi-team DigitalOcean discovery and health monitoring and **Layer 2** optional outbound-only Linux Go agents in the **same monorepo**. Do not implement remote shell, deployment triggers, service restarts, or automatic configuration changes.
- Stack: Nuxt 4, Vue 3, TypeScript, Nuxt UI, Tailwind, Nitro APIs, PostgreSQL, Prisma, Zod; Go agent; Vitest and Playwright; Go tests; Docker and systemd.
- Robust source-scoped authentication and authorization; encrypt stored DigitalOcean tokens at rest using a separately configured encryption key; do not leak credentials into logs or responses.
- Support Light, Dark, System mode with persistent preference and correct SSR hydration.
- Prefer simple, framework-native implementations. Do not sacrifice security or readability for fewer lines.
- Actually implement, run checks/tests, commit and push milestones. Accurately report verified versus unverified results; never assert readiness without evidence.
- Work on a feature branch; do not force-push or deploy to production. No production credentials supplied or invented.

## Source order
1. `docs/01-product-scope.md`
2. `docs/02-architecture.md`
3. `docs/03-execution-plan.md`
4. `docs/modules/*`
5. `docs/engineering/*`
6. `docs/design/*`
7. `docs/04-acceptance-criteria.md`

If specifications conflict, choose the more secure, narrow and testable behavior, record the decision in docs, and continue.
