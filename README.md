# Olympiad Portal

COMS3011A Project 5 — Next.js (TypeScript) + Drizzle ORM.

## Structure
- `src/app/` — Next.js App Router, split into (organiser), (educator), (student) route groups + api/
- `src/domain/` — framework-agnostic business logic (round lifecycle, marking, standings, etc.)
- `src/lib/` — infra: db, auth, storage, queue, scheduler, logging
- `src/components/` — shared + per-portal UI
- `tests/` — domain, api, e2e

## Setup
```
npm install
cp .env.local.example .env.local   # fill in DATABASE_URL
npm run db:generate
npm run db:migrate
npm run dev
```
