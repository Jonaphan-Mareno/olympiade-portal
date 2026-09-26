# App API Documentation

The Olympiad Portal utilizes a hybrid API strategy. Standard RESTful API endpoints are exposed for specific client-side consumption (e.g., dynamic search fields, live exam answer persistence) and potential external integrations. The vast majority of our internal data mutations are handled securely via Next.js Server Actions.

## External Availability

All API routes are served from the same Next.js application and are **externally reachable** over HTTP at `<base-url>/api/...`. There is no API gateway or IP allow-list restricting access.

The global Next.js middleware (`src/middleware.ts`) **explicitly bypasses** all `/api` paths, meaning session-cookie management and page-level auth redirects do **not** apply to API routes. Each endpoint is individually responsible for enforcing authentication.

### Protection Summary

| Route                                          | Auth            | Mechanism                              |
| :--------------------------------------------- | :-------------- | :------------------------------------- |
| `GET /api/health`                              | **None**        | Public — no credentials required       |
| `GET /api/schools/suggest`                     | **Required**    | Supabase session cookie                |
| `POST /api/student/sitting/start`              | **Required**    | Supabase session cookie                |
| `POST /api/student/sitting/save`               | **Required**    | Supabase session cookie                |
| `GET /api/student/sitting/sync`                | **Required**    | Supabase session cookie                |
| `POST /api/student/sitting/submit`             | **Required**    | Supabase session cookie                |
| `GET /api/certificates/[submissionId]`         | **None**        | Open (depends on URL knowledge)        |
| `GET` / `POST` `/api/webhooks/round-scheduler` | **Conditional** | `CRON_SECRET` bearer token (see below) |

:::note
There is currently **no rate limiting** on any endpoint. Authenticated routes rely on Supabase Auth to verify identity and perform role-based authorization where applicable.
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
curl https://olympiad-portal-eta.vercel.app/api/health
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
curl "https://olympiad-portal-eta.vercel.app/api/schools/suggest?q=pretoria%20boys&type=high_school" \
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

---

### 3. Start Student Sitting

Starts or resumes an online exam sitting for an authenticated student. Validates that the round is open, online, and the student is enrolled.

- **Endpoint**: `POST /api/student/sitting/start`
- **Auth Required**: Yes (Supabase session cookie)
- **Use case**: Starting a test session.

**Request Body (JSON)**

| Field     | Type     | Required | Description             |
| :-------- | :------- | :------- | :---------------------- |
| `roundId` | `string` | Yes      | UUID of the round       |

**Response (200 OK)**

```json
{
  "sittingId": "550e8400-e29b-41d4-a716-446655440000",
  "resumed": false
}
```

---

### 4. Save Student Answer

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
curl -X POST "https://olympiad-portal-eta.vercel.app/api/student/sitting/save" \
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

---

### 5. Sync Student Answers

Retrieves all previously saved answers for a given exam sitting. Used to restore a student's progress if they refresh the page or reconnect.

- **Endpoint**: `GET /api/student/sitting/sync`
- **Auth Required**: Yes (Supabase session cookie)
- **Use case**: Rehydrating a student's exam session on page load or reconnection.

**Query Parameters**

| Parameter   | Type     | Required | Description                      |
| :---------- | :------- | :------- | :------------------------------- |
| `sittingId` | `string` | Yes      | UUID of the exam sitting to sync |

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
    }
  ]
}
```

---

### 6. Submit Student Sitting

Submits an active exam sitting, closing it so no further answers can be saved. It triggers automarking of the student's saved answers against the round's questions.

- **Endpoint**: `POST /api/student/sitting/submit`
- **Auth Required**: Yes (Supabase session cookie)
- **Use case**: When the student manually submits their exam or the timer expires.

**Request Body (JSON)**

| Field       | Type     | Required | Description                     |
| :---------- | :------- | :------- | :------------------------------ |
| `sittingId` | `string` | Yes      | UUID of the active exam sitting |

**Response (200 OK)**

```json
{
  "success": true
}
```

---

### 7. Certificates Download

Generates and downloads a personalized certificate PDF for a specific submission if the student's score meets the qualifying threshold.

- **Endpoint**: `GET /api/certificates/[submissionId]`
- **Auth Required**: No (anyone with the URL can download it)
- **Use case**: Generating PDF certificates for students.

**Example**

```bash
curl "https://olympiad-portal-eta.vercel.app/api/certificates/550e8400-e29b-41d4-a716-446655440000" --output certificate.pdf
```

**Response (200 OK)**
Returns the PDF document with `Content-Type: application/pdf`.

---

### 8. Round Scheduler Webhook

Entry point for the automated round-reminder sweep (opening, closing, overdue, and results-published emails). Vercel Cron calls this endpoint on a schedule, but it also accepts manual triggers from GitHub Actions, `curl`, or any HTTP client.

- **Endpoint**: `GET /api/webhooks/round-scheduler` **and** `POST /api/webhooks/round-scheduler`
- **Auth Required**: Conditional
- **Use case**: Triggering the notification sweep on a schedule or manually.

**Authentication**

| Environment                                 | Behaviour                                                                                                                                             |
| :------------------------------------------ | :---------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Production** (`CRON_SECRET` is set)       | Requires a `Bearer <token>` in the `Authorization` header **or** a `?secret=<token>` query parameter matching `CRON_SECRET`. Returns `401` otherwise. |
| **Local development** (`CRON_SECRET` unset) | Open — no auth check. This simplifies `curl` testing during development.                                                                              |

---

## Part 2: How to Use the API Externally

### Authentication

This section applies to the **authenticated** endpoints only. Authenticated endpoints require a valid **Supabase session cookie**. In a browser, this cookie is set automatically after login via the Supabase Auth flow. For programmatic access, you first need to obtain an access token:

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
curl "https://olympiad-portal-eta.vercel.app/api/schools/suggest?q=spring&type=high_school" \
  -H "Cookie: sb-access-token=<access_token>"
```

---

## Part 3: Next.js Server Actions (Internal API)

While REST routes exist, the Olympiad Portal's core business logic (creating rounds, uploading question papers, submitting answers) is handled via **Next.js Server Actions**.

Server Actions act as strict RPC (Remote Procedure Call) endpoints. They provide end-to-end type safety between our React forms and our backend Drizzle logic, eliminating the need to manually construct `fetch` calls, serialize JSON, or write Zod validators for standard REST bodies.

:::note
Server Actions are **not externally callable** via HTTP. They are invoked exclusively by React form components and client-side `useActionState` hooks within the application.
:::

---

## Part 4: Standard Error Handling

Our application standardizes error handling across both REST routes and Server Actions. When a failure occurs, the client intercepts the following codes and renders the appropriate toast notification or redirect:

- **401 Unauthorized**: The Supabase session is missing or expired. The client automatically redirects to `/login`.
- **403 Forbidden**: The user is authenticated but lacks the specific `membership` role required for the action (e.g., a Student attempting to call `createRound`).
- **404 Not Found**: The requested resource (e.g., an Olympiad ID) does not exist or belongs to another portal.
- **500 Internal Server Error**: An unhandled database exception occurred. The error is logged to the console, and a generic "Something went wrong" toast is presented to the user to prevent leaking schema details.
