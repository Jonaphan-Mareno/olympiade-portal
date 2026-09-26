# Public API Documentation

A separate, deliberately open API surface is mounted under `/api/public/*`. It is read-only and **GET-only**, requires no credentials of any kind, and serves the public-facing website and any other external consumer: the school directory, the olympiad catalogue, public leaderboards, and — once a round has closed — its question papers and questions.

Only data that is safe for anyone to read is exposed: a round's materials cannot be read while entrants are still sitting it, and marks cannot be read until the organiser has officially released the results. Every response — error responses included — carries a wildcard CORS header (`Access-Control-Allow-Origin: *`), so browser clients on any origin can call these endpoints directly.

:::note
All public routes are `GET`-only and there is no `OPTIONS` handler. Simple cross-origin reads (a plain `fetch` with no custom headers) need no CORS preflight; requests that do trigger a preflight will not succeed.
:::

## Visibility Rules

Round state is derived from timestamps rather than stored: `scheduled` (before `opens_at`) → `open` → `closed` (after `closes_at`) → `released` (once `results_published_at` is set, which takes precedence across the whole lifecycle).

| Round state             | `/api/public/results`          | `/api/public/question-papers`, `/api/public/questions` |
| :---------------------- | :----------------------------- | :----------------------------------------------------- |
| `scheduled` / `open`    | `403` — results not published  | `403` — round has not closed yet                       |
| `closed` (not released) | `403` — results not published  | `200`                                                  |
| `released`              | `200`                          | `200`                                                  |

## Endpoint Overview

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

### 1. Public Schools

The flat directory of every school that any portal has registered. This powers public listings such as "schools taking part" and lookup by the department's external identifier.

- **Endpoint**: `GET /api/public/schools`
- **Auth Required**: No
- **Gating**: None — always readable
- **Use case**: Public school directories; resolving a school by its EMIS number.

**Example**

```bash
curl "https://olympiad-portal-eta.vercel.app/api/public/schools"
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

### 2. Public Portals

The olympiad catalogue: every portal with its participating schools and moderation status. All portals are listed regardless of status so the consuming application can decide what to show (e.g. only `approved` portals).

- **Endpoint**: `GET /api/public/portals`
- **Auth Required**: No
- **Gating**: None — always readable
- **Use case**: Olympiad directory pages; portal pickers on the public website.

**Example**

```bash
curl "https://olympiad-portal-eta.vercel.app/api/public/portals"
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

### 3. Public Rounds

Every round of every portal, with just enough metadata to render schedules and derive open/closed state client-side: the qualifying threshold and the opening/closing timestamps.

- **Endpoint**: `GET /api/public/rounds`
- **Auth Required**: No
- **Gating**: None — always readable (materials and marks are gated per-round on their own endpoints)
- **Use case**: Public round calendars; "when is the next round?" displays.

**Example**

```bash
curl "https://olympiad-portal-eta.vercel.app/api/public/rounds"
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

### 4. Public Results

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
curl "https://olympiad-portal-eta.vercel.app/api/public/results?round_id=550e8400-e29b-41d4-a716-446655440000"
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

### 5. Public Question Papers

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
curl "https://olympiad-portal-eta.vercel.app/api/public/question-papers?round_id=550e8400-e29b-41d4-a716-446655440000"
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

### 6. Public Questions

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
curl "https://olympiad-portal-eta.vercel.app/api/public/questions?round_id=550e8400-e29b-41d4-a716-446655440000"
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
