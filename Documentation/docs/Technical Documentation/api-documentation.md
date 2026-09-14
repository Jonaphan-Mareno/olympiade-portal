# API Documentation

The Olympiad Portal utilizes a hybrid API strategy. Standard RESTful API endpoints are exposed for specific client-side consumption (e.g., dynamic search fields, live exam answer persistence) and potential external integrations, while the vast majority of our internal data mutations are handled securely via Next.js Server Actions.

## External Availability

All API routes are served from the same Next.js application and are **externally reachable** over HTTP at `<base-url>/api/...`. There is no API gateway or IP allow-list restricting access.

The global Next.js middleware (`src/middleware.ts`) **explicitly bypasses** all `/api` paths, meaning session-cookie management and page-level auth redirects do **not** apply to API routes. Each endpoint is individually responsible for enforcing authentication.

### Protection Summary

| Route                                          | Auth            | Mechanism                              |
| :--------------------------------------------- | :-------------- | :------------------------------------- |
| `GET /api/health`                              | **None**        | Public — no credentials required       |
| `GET /api/schools/search`                      | **Required**    | Supabase session cookie                |
| `POST /api/student/sitting/save`               | **Required**    | Supabase session cookie                |
| `GET /api/student/sitting/sync`                | **Required**    | Supabase session cookie                |
| `GET` / `POST` `/api/webhooks/round-scheduler` | **Conditional** | `CRON_SECRET` bearer token (see below) |

:::note
There is currently **no rate limiting** or CORS policy configured on any endpoint. Authenticated routes rely on Supabase Auth to verify identity but do not perform granular role-based authorization (e.g., ownership of a sitting is not verified beyond the session being valid).
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

### 2. Schools Search

Used to dynamically search for existing schools when educators are signing up or being invited. This endpoint performs an indexed, case-insensitive search (`ILIKE`) against the database, scoped to a single olympiad portal to prevent cross-portal data leakage.

- **Endpoint**: `GET /api/schools/search`
- **Auth Required**: Yes (Supabase session cookie)
- **Use case**: Autocomplete dropdowns in educator invite forms and signup flows.

**Query Parameters**

| Parameter  | Type     | Required | Description                                                                   |
| :--------- | :------- | :------- | :---------------------------------------------------------------------------- |
| `portalId` | `string` | **Yes**  | The olympiad portal ID to scope the search to. Returns `400` if missing.      |
| `q`        | `string` | Yes      | The search query. Must be at least 2 characters long; otherwise returns `[]`. |

**Example**

```bash
curl "https://<your-domain>/api/schools/search?portalId=abc-123&q=springfield" \
  -H "Cookie: sb-access-token=<your-supabase-jwt>"
```

**Response (200 OK)**

```json
[
  {
    "id": "123e4567-e89b-12d3-a456-426614174000",
    "name": "Springfield High School"
  }
]
```

**Error Responses**

| Status | Body                                  | Cause                        |
| :----- | :------------------------------------ | :--------------------------- |
| `400`  | `{ "error": "portalId is required" }` | Missing `portalId` parameter |
| `401`  | `{ "error": "Unauthorized" }`         | No valid Supabase session    |

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

## Part 2: How to Use the API Externally

### Authentication

Authenticated endpoints require a valid **Supabase session cookie**. In a browser, this cookie is set automatically after login via the Supabase Auth flow. For programmatic access, you first need to obtain an access token:

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
curl "https://<your-domain>/api/schools/search?portalId=abc-123&q=spring" \
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

## Part 3: Next.js Server Actions (Internal API)

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

## Part 4: Standard Error Handling

Our application standardizes error handling across both REST routes and Server Actions. When a failure occurs, the client intercepts the following codes and renders the appropriate toast notification or redirect:

- **401 Unauthorized**: The Supabase session is missing or expired. The client automatically redirects to `/login`.
- **403 Forbidden**: The user is authenticated but lacks the specific `membership` role required for the action (e.g., a Student attempting to call `createRound`).
- **404 Not Found**: The requested resource (e.g., an Olympiad ID) does not exist or belongs to another portal.
- **500 Internal Server Error**: An unhandled database exception occurred. The error is logged to the console, and a generic "Something went wrong" toast is presented to the user to prevent leaking schema details.
