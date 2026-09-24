# API Documentation

The Olympiad Portal utilizes a hybrid API strategy. Standard RESTful API endpoints are exposed for specific client-side consumption (e.g., dynamic search fields, live exam answer persistence) and potential external integrations. A separate, deliberately open **public API** (Part 2) exposes read-only data to the public-facing website and other external consumers. The vast majority of our internal data mutations are handled securely via Next.js Server Actions.

## External Availability

All API routes are served from the same Next.js application and are **externally reachable** over HTTP at `<base-url>/api/...`. There is no API gateway or IP allow-list restricting access.

The global Next.js middleware (`src/middleware.ts`) **explicitly bypasses** all `/api` paths, meaning session-cookie management and page-level auth redirects do **not** apply to API routes. Each endpoint is individually responsible for enforcing authentication.

### Protection Summary

| Route                                          | Auth            | Mechanism                              |
| :--------------------------------------------- | :-------------- | :------------------------------------- |
| `GET /api/health`                              | **None**        | Public — no credentials required       |
| `GET /api/schools/suggest`                     | **Required**    | Supabase session cookie                |
| `POST /api/student/sitting/save`               | **Required**    | Supabase session cookie                |
| `GET /api/student/sitting/sync`                | **Required**    | Supabase session cookie                |
| `GET` / `POST` `/api/webhooks/round-scheduler` | **Conditional** | `CRON_SECRET` bearer token (see below) |
| `GET /api/public/schools`                     | **None**        | Public — read-only, wildcard CORS       |
| `GET /api/public/portals`                     | **None**        | Public — read-only, wildcard CORS       |
| `GET /api/public/rounds`                      | **None**        | Public — read-only, wildcard CORS       |
| `GET /api/public/results`                     | **None**        | Public — gated until results published  |
| `GET /api/public/question-papers`             | **None**        | Semi-public — gated until round closes  |
| `GET /api/public/questions`                   | **None**        | Semi-public — gated until round closes  |

:::note
There is currently **no rate limiting** on any endpoint, and the only CORS policy is the wildcard `Access-Control-Allow-Origin: *` applied to the public API routes (Part 2). Authenticated routes rely on Supabase Auth to verify identity but do not perform granular role-based authorization (e.g., ownership of a sitting is not verified beyond the session being valid).
:::

---

## Part 1: Standard REST Endpoints

### 1. Health Check

Used by monitoring tools (and our automated CI pipeline) to ensure the Next.js server is responsive.

- **Endpoint**: `GET /api/health`
- **Auth Required**: No
- **Use case**: Uptime monitoring, CI smoke tests, load-balancer health probes.

**Example**

```bash
curl https://<your-domain>/api/health
```

**Response (200 OK)**

```json
{
  "status": "ok"
}
```

---

### 2. Schools Suggest

Powers the school picker used when organisers create portals and invite schools. Schools are never free-typed: they are picked from one of two curated directories.

- **`type=high_school`** — searched entirely against a local JSON snapshot of the South African high-school directory (`src/data/south-african-high-schools.json`, ~8 800 schools). No upstream API is called at request time because the source API (api.labs.org.za) is rate limited to ~20 requests/minute; the snapshot is built offline in bulk instead (see below).
- **`type=university`** — proxied server-side to the free [hipolabs universities API](http://universities.hipolabs.com/search). South African universities are ranked first in the results.

- **Endpoint**: `GET /api/schools/suggest`
- **Auth Required**: Yes (Supabase session cookie)
- **Use case**: The `SchoolPicker` combobox in the Create Portal form and the Invite Schools form.

**Query Parameters**

| Parameter | Type     | Required | Description                                                                                          |
| :-------- | :------- | :------- | :--------------------------------------------------------------------------------------------------- |
| `q`       | `string` | Yes      | The search query. Must be at least 2 characters long; otherwise returns `[]`.                        |
| `type`    | `string` | **Yes**  | Either `high_school` or `university`. Any other value returns `400`.                                  |

**Example**

```bash
curl "https://<your-domain>/api/schools/suggest?q=pretoria%20boys&type=high_school" \
  -H "Cookie: sb-access-token=<your-supabase-jwt>"
```

**Response (200 OK)**

```json
[
  {
    "name": "PRETORIA BOYS HIGH SCHOOL",
    "type": "high_school",
    "province": "Gauteng",
    "town": "PRETORIA",
    "externalId": "700401012"
  }
]
```

High-school suggestions carry `province`/`town` and the department's `nat_emis` number as `externalId`; university suggestions carry `country` and the university's primary domain as `externalId`. The `externalId` is stored on the `schools` row when the picked school is saved.

**Error Responses**

| Status | Body                                                             | Cause                                    |
| :----- | :--------------------------------------------------------------- | :--------------------------------------- |
| `400`  | `{ "error": "type must be \"high_school\" or \"university\"" }` | Missing or invalid `type` parameter      |
| `401`  | `{ "error": "Unauthorized" }`                                  | No valid Supabase session                |
| `502`  | `{ "error": "University search is temporarily unavailable…" }` | The hipolabs API failed (universities only) |

**Refreshing the high-school snapshot**

The snapshot is generated by walking the entire api.labs.org.za high-school directory (441 pages at 20 schools per page, rate limited to ~20 requests per minute — about 25 minutes end to end):

```bash
npm run fetch:schools   # walks api.labs.org.za into src/data/south-african-high-schools.json
```

The walk checkpoints after every page (`.high-schools.partial.json`), so an interrupted run resumes where it left off instead of starting over. The snapshot is committed to the repository, so this only needs re-running when the directory should be refreshed.

---

### 3. Save Student Answer

Persists (or updates) a single answer for an active exam sitting. Uses an upsert so this can be called repeatedly as the student works through questions.

- **Endpoint**: `POST /api/student/sitting/save`
- **Auth Required**: Yes (Supabase session cookie)
- **Use case**: Auto-saving student responses during a live exam session (called on each answer change).

**Request Body (JSON)**

| Field            | Type     | Required | Description                     |
| :--------------- | :------- | :------- | :------------------------------ |
| `sittingId`      | `string` | Yes      | UUID of the active exam sitting |
| `questionNumber` | `number` | Yes      | 1-based question index          |
| `answerValue`    | `string` | Yes      | The student's answer text       |

**Example**

```bash
curl -X POST "https://<your-domain>/api/student/sitting/save" \
  -H "Content-Type: application/json" \
  -H "Cookie: sb-access-token=<your-supabase-jwt>" \
  -d '{
    "sittingId": "550e8400-e29b-41d4-a716-446655440000",
    "questionNumber": 3,
    "answerValue": "42"
  }'
```

**Response (200 OK)**

```json
{
  "success": true,
  "savedAt": "2026-09-14T12:34:56.000Z"
}
```

**Error Responses**

| Status | Body                                        | Cause                                        |
| :----- | :------------------------------------------ | :------------------------------------------- |
| `400`  | `{ "error": "Missing required fields" }`    | One or more fields missing                   |
| `400`  | `{ "error": "Exam sitting is not active" }` | Sitting exists but is not in `active` status |
| `401`  | `{ "error": "Unauthorized" }`               | No valid Supabase session                    |
| `404`  | `{ "error": "Sitting not found" }`          | No sitting with that ID                      |

---

### 4. Sync Student Answers

Retrieves all previously saved answers for a given exam sitting. Used to restore a student's progress if they refresh the page or reconnect.

- **Endpoint**: `GET /api/student/sitting/sync`
- **Auth Required**: Yes (Supabase session cookie)
- **Use case**: Rehydrating a student's exam session on page load or reconnection.

**Query Parameters**

| Parameter   | Type     | Required | Description                      |
| :---------- | :------- | :------- | :------------------------------- |
| `sittingId` | `string` | Yes      | UUID of the exam sitting to sync |

**Example**

```bash
curl "https://<your-domain>/api/student/sitting/sync?sittingId=550e8400-e29b-41d4-a716-446655440000" \
  -H "Cookie: sb-access-token=<your-supabase-jwt>"
```

**Response (200 OK)**

```json
{
  "sitting": {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "status": "active",
    "...": "..."
  },
  "answers": [
    {
      "sittingId": "550e8400-e29b-41d4-a716-446655440000",
      "questionNumber": 1,
      "answerValue": "Paris",
      "savedAt": "2026-09-14T12:30:00.000Z"
    },
    {
      "sittingId": "550e8400-e29b-41d4-a716-446655440000",
      "questionNumber": 2,
      "answerValue": "7",
      "savedAt": "2026-09-14T12:31:00.000Z"
    }
  ]
}
```

**Error Responses**

| Status | Body                               | Cause                     |
| :----- | :--------------------------------- | :------------------------ |
| `400`  | `{ "error": "Missing sittingId" }` | `sittingId` not provided  |
| `401`  | `{ "error": "Unauthorized" }`      | No valid Supabase session |
| `404`  | `{ "error": "Sitting not found" }` | No sitting with that ID   |

---

### 5. Round Scheduler Webhook

Entry point for the automated round-reminder sweep (opening, closing, overdue, and results-published emails). Vercel Cron calls this endpoint on a schedule, but it also accepts manual triggers from GitHub Actions, `curl`, or any HTTP client.

- **Endpoint**: `GET /api/webhooks/round-scheduler` **and** `POST /api/webhooks/round-scheduler`
- **Auth Required**: Conditional — see below
- **Use case**: Triggering the notification sweep on a schedule or manually.

**Authentication**

| Environment                                 | Behaviour                                                                                                                                             |
| :------------------------------------------ | :---------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Production** (`CRON_SECRET` is set)       | Requires a `Bearer <token>` in the `Authorization` header **or** a `?secret=<token>` query parameter matching `CRON_SECRET`. Returns `401` otherwise. |
| **Local development** (`CRON_SECRET` unset) | Open — no auth check. This simplifies `curl` testing during development.                                                                              |

**Configuration**

The cron schedule is defined in [`vercel.json`](https://vercel.com/docs/cron-jobs):

```json
{
  "crons": [
    {
      "path": "/api/webhooks/round-scheduler",
      "schedule": "0 * * * *"
    }
  ]
}
```

This runs the sweep **hourly**. The sweep itself is **idempotent** — overlapping or repeated invocations are harmless because each notification is deduplicated per `(kind, roundId, recipientMembershipId)` in the `notification_log` table.

**Example — Vercel Cron (automatic)**

```bash
# Vercel Cron sends this automatically each hour:
curl "https://<your-domain>/api/webhooks/round-scheduler" \
  -H "Authorization: Bearer <CRON_SECRET>"
```

**Example — Manual trigger**

```bash
# Using Bearer header
curl -X POST "https://<your-domain>/api/webhooks/round-scheduler" \
  -H "Authorization: Bearer <CRON_SECRET>"

# Using query parameter (handy for quick testing)
curl -X POST "https://<your-domain>/api/webhooks/round-scheduler?secret=<CRON_SECRET>"

# Local development (no secret needed when CRON_SECRET is unset)
curl -X POST "http://localhost:3000/api/webhooks/round-scheduler"
```

**Response (200 OK)**

```json
{
  "sent": 12,
  "failed": 0,
  "skipped": 3
}
```

**Error Responses**

| Status | Body                                            | Cause                                                   |
| :----- | :---------------------------------------------- | :------------------------------------------------------ |
| `401`  | `{ "error": "Unauthorized" }`                   | `CRON_SECRET` is set but token is missing or mismatched |
| `500`  | `{ "error": "Sweep failed", "message": "..." }` | Internal error during the sweep (logged to console)     |

---

## Part 2: Public API (No Authentication)

A separate, deliberately open API surface is mounted under `/api/public/*`. It is read-only and **GET-only**, requires no credentials of any kind, and serves the public-facing website and any other external consumer: the school directory, the olympiad catalogue, public leaderboards, and — once a round has closed — its question papers and questions.

Only data that is safe for anyone to read is exposed: a round's materials cannot be read while entrants are still sitting it, and marks cannot be read until the organiser has officially released the results. Every response — error responses included — carries a wildcard CORS header (`Access-Control-Allow-Origin: *`), so browser clients on any origin can call these endpoints directly.

:::note
All public routes are `GET`-only and there is no `OPTIONS` handler. Simple cross-origin reads (a plain `fetch` with no custom headers) need no CORS preflight; requests that do trigger a preflight will not succeed.
:::

### Visibility Rules

Round state is derived from timestamps rather than stored: `scheduled` (before `opens_at`) → `open` → `closed` (after `closes_at`) → `released` (once `results_published_at` is set, which takes precedence across the whole lifecycle).

| Round state             | `/api/public/results`          | `/api/public/question-papers`, `/api/public/questions` |
| :---------------------- | :----------------------------- | :----------------------------------------------------- |
| `scheduled` / `open`    | `403` — results not published  | `403` — round has not closed yet                       |
| `closed` (not released) | `403` — results not published  | `200`                                                  |
| `released`              | `200`                          | `200`                                                  |

### Endpoint Overview

| Endpoint                          | Auth | Description                                             |
| :-------------------------------- | :--- | :------------------------------------------------------ |
| `GET /api/public/schools`         | None | Flat, deduplicated directory of participating schools.  |
| `GET /api/public/portals`         | None | All portals with their schools, status and creation date. |
| `GET /api/public/rounds`          | None | All rounds with portal name, threshold and dates.       |
| `GET /api/public/results`         | None | Anonymous marks for a round whose results are published. |
| `GET /api/public/question-papers` | None | Paper download URLs for a closed round.                 |
| `GET /api/public/questions`       | None | Full question bank, answers included, for a closed round. |

**Conventions**

- Keys are `snake_case`, mirroring the database columns.
- Dates serialize to ISO-8601 UTC strings (e.g. `2026-09-01T09:00:00.000Z`).
- Numeric columns (`qualifying_threshold`, `marks`, `score`) are JSON numbers, not strings.
- The three round-scoped endpoints share the same outer envelope: `{ round, portal, ... }`.

---

### 6. Public Schools

The flat directory of every school that any portal has registered. This powers public listings such as "schools taking part" and lookup by the department's external identifier.

- **Endpoint**: `GET /api/public/schools`
- **Auth Required**: No
- **Gating**: None — always readable
- **Use case**: Public school directories; resolving a school by its EMIS number.

**Example**

```bash
curl "https://<your-domain>/api/public/schools"
```

**Response (200 OK)**

```json
[
  {
    "name": "PRETORIA BOYS HIGH SCHOOL",
    "external_id": "700401012"
  },
  {
    "name": "SOMERSET WEST HIGH SCHOOL",
    "external_id": "700402001"
  }
]
```

**Notes**

- Deduplicated: a school registered by several portals appears exactly once.
- Sorted alphabetically by `name`.
- `external_id` is the identifier stored when the school was picked from a curated directory (the `nat_emis` number for high schools, the primary domain for universities). It is `null` when no external identifier is on record.

**Error Responses**

| Status | Body                                   | Cause                                         |
| :----- | :------------------------------------- | :-------------------------------------------- |
| `500`  | `{ "error": "Internal server error" }` | Unhandled database error (logged server-side) |

---

### 7. Public Portals

The olympiad catalogue: every portal with its participating schools and moderation status. All portals are listed regardless of status so the consuming application can decide what to show (e.g. only `approved` portals).

- **Endpoint**: `GET /api/public/portals`
- **Auth Required**: No
- **Gating**: None — always readable
- **Use case**: Olympiad directory pages; portal pickers on the public website.

**Example**

```bash
curl "https://<your-domain>/api/public/portals"
```

**Response (200 OK)**

```json
[
  {
    "id": "8f14e45f-ceea-467a-9c1f-2b4a1b8d3f21",
    "name": "National Maths Olympiad",
    "created_at": "2026-08-01T09:15:00.000Z",
    "status": "approved",
    "schools": [
      {
        "name": "PRETORIA BOYS HIGH SCHOOL",
        "external_id": "700401012"
      }
    ]
  }
]
```

**Notes**

- `status` is one of `pending`, `approved` or `rejected`.
- `created_at` can be `null` on legacy rows.
- Portals are sorted by `name`; each portal's `schools` array is sorted by school name.

**Error Responses**

| Status | Body                                   | Cause                                         |
| :----- | :------------------------------------- | :-------------------------------------------- |
| `500`  | `{ "error": "Internal server error" }` | Unhandled database error (logged server-side) |

---

### 8. Public Rounds

Every round of every portal, with just enough metadata to render schedules and derive open/closed state client-side: the qualifying threshold and the opening/closing timestamps.

- **Endpoint**: `GET /api/public/rounds`
- **Auth Required**: No
- **Gating**: None — always readable (materials and marks are gated per-round on their own endpoints)
- **Use case**: Public round calendars; "when is the next round?" displays.

**Example**

```bash
curl "https://<your-domain>/api/public/rounds"
```

**Response (200 OK)**

```json
[
  {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "name": "Round 1",
    "qualifying_threshold": 30,
    "opens_at": "2026-09-01T09:00:00.000Z",
    "closes_at": "2026-09-10T17:00:00.000Z",
    "portal": {
      "id": "8f14e45f-ceea-467a-9c1f-2b4a1b8d3f21",
      "name": "National Maths Olympiad"
    }
  }
]
```

**Notes**

- Sorted by portal name, then by the organiser-defined round order (`order_index`) within each portal.
- `qualifying_threshold` is a number, or `null` when the round has no threshold.
- The portal is embedded as a nested `{ id, name }` object rather than a raw foreign key.

**Error Responses**

| Status | Body                                   | Cause                                         |
| :----- | :------------------------------------- | :-------------------------------------------- |
| `500`  | `{ "error": "Internal server error" }` | Unhandled database error (logged server-side) |

---

### 9. Public Results

Anonymous marks for a round, for public leaderboards. Only scores are exposed — never student names, emails or membership IDs. Results stay hidden until the organiser publishes them.

- **Endpoint**: `GET /api/public/results?round_id=<uuid>`
- **Auth Required**: No
- **Gating**: the round's `results_published_at` must be set (state `released`); otherwise `403`.
- **Use case**: Public leaderboards and result announcements.

**Query Parameters**

| Parameter  | Type     | Required | Description                            |
| :--------- | :------- | :------- | :------------------------------------- |
| `round_id` | `string` | Yes      | UUID of the round to fetch marks for   |

**Example**

```bash
curl "https://<your-domain>/api/public/results?round_id=550e8400-e29b-41d4-a716-446655440000"
```

**Response (200 OK)**

```json
{
  "round": {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "name": "Round 1"
  },
  "portal": {
    "id": "8f14e45f-ceea-467a-9c1f-2b4a1b8d3f21",
    "name": "National Maths Olympiad"
  },
  "results": [
    { "score": 42 },
    { "score": 38 },
    { "score": 30 }
  ]
}
```

**Notes**

- Scores are ordered highest-first.
- Each entry contains only `score` — the contract is deliberately anonymous, so a leaderboard can be rendered without exposing any entrant's identity.
- Submissions without a graded score are omitted.

**Error Responses**

| Status | Body                                                               | Cause                                         |
| :----- | :----------------------------------------------------------------- | :-------------------------------------------- |
| `400`  | `{ "error": "Missing round_id" }`                                  | `round_id` not provided                       |
| `403`  | `{ "error": "Results for this round have not been published yet" }` | Round exists but results are not published    |
| `404`  | `{ "error": "Round not found" }`                                   | No round with that ID                         |
| `500`  | `{ "error": "Internal server error" }`                             | Unhandled database error (logged server-side) |

---

### 10. Public Question Papers

Download URLs for a round's paper PDF(s). Semi-public: the papers become readable only once the round has closed, so they cannot leak to entrants who are still writing.

- **Endpoint**: `GET /api/public/question-papers?round_id=<uuid>`
- **Auth Required**: No
- **Gating**: round state must be `closed` or `released`; still-active rounds return `403`.
- **Use case**: Publishing past papers on the public website.

**Query Parameters**

| Parameter  | Type     | Required | Description                              |
| :--------- | :------- | :------- | :--------------------------------------- |
| `round_id` | `string` | Yes      | UUID of the round to fetch papers for    |

**Example**

```bash
curl "https://<your-domain>/api/public/question-papers?round_id=550e8400-e29b-41d4-a716-446655440000"
```

**Response (200 OK)**

```json
{
  "round": {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "name": "Round 1"
  },
  "portal": {
    "id": "8f14e45f-ceea-467a-9c1f-2b4a1b8d3f21",
    "name": "National Maths Olympiad"
  },
  "question_papers": [
    {
      "id": "3f2a71c6-9b0e-4d6f-8c1a-2e5b7d9f0a13",
      "public_url": "https://<project-ref>.supabase.co/storage/v1/object/public/question-papers/round-1-paper.pdf"
    }
  ]
}
```

**Notes**

- `public_url` is the storage public URL of the uploaded PDF (`question_papers.file_url`).
- Paper rows without an uploaded file are skipped — e.g. an online round that has auto-created a paper row for its duration returns `200` with an empty `question_papers` array.

**Error Responses**

| Status | Body                                           | Cause                                         |
| :----- | :--------------------------------------------- | :-------------------------------------------- |
| `400`  | `{ "error": "Missing round_id" }`              | `round_id` not provided                       |
| `403`  | `{ "error": "This round has not closed yet" }` | Round is still scheduled or open              |
| `404`  | `{ "error": "Round not found" }`               | No round with that ID                         |
| `500`  | `{ "error": "Internal server error" }`         | Unhandled database error (logged server-side) |

---

### 11. Public Questions

The full question bank of a closed round — **including correct answers**. This is safe only because the gate guarantees the round can no longer be sat; by then the questions are historical.

- **Endpoint**: `GET /api/public/questions?round_id=<uuid>`
- **Auth Required**: No
- **Gating**: round state must be `closed` or `released`; still-active rounds return `403`.
- **Use case**: Publishing past papers with memos; building drills/practice content.

**Query Parameters**

| Parameter  | Type     | Required | Description                                |
| :--------- | :------- | :------- | :----------------------------------------- |
| `round_id` | `string` | Yes      | UUID of the round to fetch questions for   |

**Example**

```bash
curl "https://<your-domain>/api/public/questions?round_id=550e8400-e29b-41d4-a716-446655440000"
```

**Response (200 OK)**

```json
{
  "round": {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "name": "Round 1"
  },
  "portal": {
    "id": "8f14e45f-ceea-467a-9c1f-2b4a1b8d3f21",
    "name": "National Maths Olympiad"
  },
  "questions": [
    {
      "id": "9c1f2e3d-4a5b-6c7d-8e9f-0a1b2c3d4e5f",
      "question_type": "single_choice",
      "prompt": "What is 2 + 2?",
      "options": ["3", "4", "5"],
      "correct_answer": "4",
      "marks": 1,
      "image_url": null
    }
  ]
}
```

**Notes**

- `question_type` is one of `single_choice`, `multiple_choice`, `true_false`, `matching` or `free_text`.
- `options` and `correct_answer` mirror the stored JSON: string arrays and a string answer for choice questions, `{ "premise", "response" }` object arrays for matching questions, `null` when not applicable.
- `marks` is the question's available marks; `image_url` is `null` when the question has no image.

**Error Responses**

| Status | Body                                           | Cause                                         |
| :----- | :--------------------------------------------- | :-------------------------------------------- |
| `400`  | `{ "error": "Missing round_id" }`              | `round_id` not provided                       |
| `403`  | `{ "error": "This round has not closed yet" }` | Round is still scheduled or open              |
| `404`  | `{ "error": "Round not found" }`               | No round with that ID                         |
| `500`  | `{ "error": "Internal server error" }`         | Unhandled database error (logged server-side) |

:::note
**Implementation** — the handlers live in `src/app/api/public/*`, backed by the shared read queries in `src/domain/public-api/queries.ts` and the visibility gates in `src/domain/public-api/access.ts`. Each endpoint is covered by route tests in `tests/api/public/`, plus the domain suites `tests/domain/public-api-queries.test.ts` and `tests/domain/public-api-access.test.ts`.
:::

---

## Part 3: How to Use the API Externally

### Authentication

This section applies to the **authenticated** endpoints only — the public API in Part 2 requires no credentials at all. Authenticated endpoints require a valid **Supabase session cookie**. In a browser, this cookie is set automatically after login via the Supabase Auth flow. For programmatic access, you first need to obtain an access token:

```bash
# 1. Sign in to get an access token
curl -X POST "https://<SUPABASE_URL>/auth/v1/token?grant_type=password" \
  -H "apikey: <SUPABASE_ANON_KEY>" \
  -H "Content-Type: application/json" \
  -d '{
    "email": "user@example.com",
    "password": "your-password"
  }'

# Response includes access_token — use it in subsequent calls
```

Then pass the token as a cookie on every API call:

```bash
# 2. Call an authenticated endpoint
curl "https://<your-domain>/api/schools/suggest?q=spring&type=high_school" \
  -H "Cookie: sb-access-token=<access_token>"
```

### Base URL

| Environment         | URL                            |
| :------------------ | :----------------------------- |
| Local development   | `http://localhost:3000`        |
| Production (Vercel) | `https://<your-vercel-domain>` |

### Content Type

All `POST` endpoints expect `Content-Type: application/json` unless otherwise stated.

---

## Part 4: Next.js Server Actions (Internal API)

While REST routes exist, the Olympiad Portal's core business logic (creating rounds, uploading question papers, submitting answers) is handled via **Next.js Server Actions**.

Server Actions act as strict RPC (Remote Procedure Call) endpoints. They provide end-to-end type safety between our React forms and our backend Drizzle logic, eliminating the need to manually construct `fetch` calls, serialize JSON, or write Zod validators for standard REST bodies.

:::note
Server Actions are **not externally callable** via HTTP. They are invoked exclusively by React form components and client-side `useActionState` hooks within the application.
:::

### Core Actions Map

| Action Name                  | Location                       | Purpose                                                                       | Expected Payload                         | Returns                                                  |
| :--------------------------- | :----------------------------- | :---------------------------------------------------------------------------- | :--------------------------------------- | :------------------------------------------------------- |
| `createRound`                | `app/organiser/.../actions.ts` | Generates a new exam phase for a portal.                                      | `FormData` (name, deliveryMethod, dates) | `{ success: boolean, roundId?: string, error?: string }` |
| `submitOrganiserApplication` | `app/organiser/actions.ts`     | Allows users to apply for organiser status.                                   | `FormData` (orgName, purpose, pdfUrl)    | `{ success: true }`                                      |
| `submitExamAnswers`          | `app/student/.../actions.ts`   | Securely posts a student's live exam session data.                            | `Array<{questionId, answerValue}>`       | `{ score: number, passed: boolean }`                     |
| `publishRoundResults`        | `app/organiser/.../actions.ts` | Publishes results for a closed round, triggering results-notification emails. | `FormData` (roundId)                     | `{ success: boolean, error?: string }`                   |

---

## Part 5: Standard Error Handling

Our application standardizes error handling across both REST routes and Server Actions. When a failure occurs, the client intercepts the following codes and renders the appropriate toast notification or redirect:

- **401 Unauthorized**: The Supabase session is missing or expired. The client automatically redirects to `/login`.
- **403 Forbidden**: The user is authenticated but lacks the specific `membership` role required for the action (e.g., a Student attempting to call `createRound`).
- **404 Not Found**: The requested resource (e.g., an Olympiad ID) does not exist or belongs to another portal.
- **500 Internal Server Error**: An unhandled database exception occurred. The error is logged to the console, and a generic "Something went wrong" toast is presented to the user to prevent leaking schema details.
