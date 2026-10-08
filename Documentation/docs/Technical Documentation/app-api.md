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
| `GET /api/rounds/[roundId]/paper`              | **Required**    | Supabase session cookie (organiser owner / accepted educators only) |
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

**Behaviour**

- **On create** — deals a per-entrant, difficulty-balanced random **variant** from the round's question pool, filled to `rounds.targetTotalMarks`, and persists it on the new `examSittings` row as `variantQuestionIds` (the ordered subset) plus an opaque `variantSeed` (a stable seed for the option shuffle). Both are frozen for the sitting's lifetime.
- **On resume** — an already-`active` sitting is returned **as-is** with `resumed: true`; the frozen variant is reused and **no redraw** occurs, so a reconnecting student sees exactly the same subset and option order. The whole operation runs in one transaction, so concurrent starts collapse onto a single active sitting (and its already-dealt variant).

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

| Field         | Type     | Required | Description                                                                     |
| :------------ | :------- | :------- | :------------------------------------------------------------------------------ |
| `sittingId`   | `string` | Yes      | UUID of the active exam sitting                                                 |
| `questionId`  | `string` | Yes      | UUID of the question being answered. Matching sub-answers use a composite form `${questionId}_${pairIndex}` (see below). |
| `answerValue` | `string` | Yes      | The student's answer text (or, for a matching pair, the chosen response)        |

**Validation & variant scoping**

- **Out-of-variant questions are rejected.** The sitting's frozen `variantQuestionIds` is authoritative: a question outside the assigned variant returns `400` with `"Question is not part of your assigned test"`. (Legacy sittings with a null variant fall back to a round-scoped check only.)
- **Matching sub-answers.** A `matching` question's pairs are posted individually under a composite `questionId` of the form `${questionId}_${pairIndex}`. The base uuid is split off before the lookup and the sub-answers are **aggregated and stored as ONE `student_answers` row** under the BASE question uuid, whose `answerValue` is a JSON object of pair selections (`{ "<questionId>_<pairIndex>": "<chosen response>" }`). A composite key sent for a non-`matching` question returns `400`.
- **Malformed ids are client errors.** An invalid / non-uuid `sittingId` returns `400` `"Invalid sitting id"`, and an invalid / non-uuid question id (after splitting off any pair index) returns `400` `"Invalid question id"` — these are rejected up front rather than surfacing as a Postgres `22P02` uuid-syntax `500`.

**Example**

```bash
curl -X POST "https://olympiad-portal-eta.vercel.app/api/student/sitting/save" \
  -H "Content-Type: application/json" \
  -H "Cookie: sb-access-token=<your-supabase-jwt>" \
  -d '{
    "sittingId": "550e8400-e29b-41d4-a716-446655440000",
    "questionId": "9c1f2e3d-4a5b-6c7d-8e9f-0a1b2c3d4e5f",
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
  "durationMinutes": 60,
  "variantQuestionIds": [
    "9c1f2e3d-4a5b-6c7d-8e9f-0a1b2c3d4e5f",
    "3f2a71c6-9b0e-4d6f-8c1a-2e5b7d9f0a13"
  ],
  "variantSeed": "d1a6f0a3-7c2e-4b8f-9a11-5e0d3c2b1a99",
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

:::note
The response now carries the sitting's frozen `variantQuestionIds` and `variantSeed`, so a resumed attempt re-renders **the same subset** in the same order with a **stable option order**. Both are `null` for legacy sittings, which fall back to the whole pool.
:::

---

### 6. Submit Student Sitting

Submits an active exam sitting, closing it so no further answers can be saved. It triggers automarking of the student's saved answers against the round's questions.

- **Endpoint**: `POST /api/student/sitting/submit`
- **Auth Required**: Yes (Supabase session cookie)
- **Use case**: When the student manually submits their exam or the timer expires.

**Behaviour**

- Auto-marking runs over **only the dealt variant**, resolved through the shared loader (`loadSittingQuestions`, which scopes to `variantQuestionIds` and falls back to the whole pool for legacy sittings), so answers to out-of-variant questions can never be scored.
- `matching` questions earn **proportional credit** (`correctPairs / totalPairs × marks`); the total is rounded to two decimals. `free_text` questions are left for educators and stay out of the auto-marked subtotal.
- The score denominator is the round's **fixed target total** (`rounds.targetTotalMarks`, falling back to the pool total), so different variants stay directly comparable. The `results.feedback` string is `"Auto-marked: <score> / <targetTotalMarks>"`.

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

### 9. Round Question Paper & Memo

Serves a round's printable documents to the schools running it: the question paper and the memo. When the organiser uploaded a PDF it is served (redirected) directly; otherwise the document is generated on the fly from the organiser's ordered physical selection (`questionPapers.selectedQuestionIds`, falling back to the whole pool for legacy papers), so online and hybrid rounds can be sat on paper too.

- **Endpoint**: `GET /api/rounds/[roundId]/paper`
- **Auth Required**: Yes (Supabase session cookie) — **organiser owner** (`portals.ownerUserId`) or an **accepted educator** of the round's portal.
- **Use case**: Educators printing a physical paper/memo for their school; organisers previewing a sample online variant.

**Query Parameters**

| Parameter  | Type     | Required | Description                                                                                                                        |
| :--------- | :------- | :------- | :--------------------------------------------------------------------------------------------------------------------------------- |
| `kind`     | `string` | No       | `paper` (default) or `memo`.                                                                                                       |
| `variant`  | `string` | No       | `preview` renders a **sample online variant** instead of the physical document (organiser/educator only). Any other value is ignored. |

**Access gating**

- The **owner** may download at any time.
- An **educator** is time-gated: the paper is available once the round **opens**, and the memo only once it **closes**, so answers never circulate while entrants are still writing (`403` otherwise).

**Variant preview (`?variant=preview`)**

- Renders a reproducible **sample** online variant drawn from the round's pool with a **fixed seed** (`FIXED_SEED`), filled to `rounds.targetTotalMarks` — a stable, repeatable illustration of what an entrant gets, never tied to a real sitting.
- Shows **only the drawn variant's questions**, in variant order. It deliberately does **not** render the whole pool: the lossless ordering (which would append every undrawn question) is avoided because it would leak exam content — including questions still hidden from students mid-round. This is an intentional exam-content leak guard.

**Example**

```bash
# Physical question paper
curl "https://olympiad-portal-eta.vercel.app/api/rounds/550e8400-e29b-41d4-a716-446655440000/paper?kind=paper" \
  -H "Cookie: sb-access-token=<your-supabase-jwt>" --output round-1-question-paper.pdf

# Reproducible sample online variant (organiser/educator preview)
curl "https://olympiad-portal-eta.vercel.app/api/rounds/550e8400-e29b-41d4-a716-446655440000/paper?variant=preview" \
  -H "Cookie: sb-access-token=<your-supabase-jwt>" --output round-1-sample-variant.pdf
```

**Response (200 OK)**
Returns the PDF document with `Content-Type: application/pdf` and an `attachment` `Content-Disposition`. When the organiser uploaded a PDF, the request is instead redirected (`307`) to its storage URL.

**Error Responses**

| Status | Cause                                                                                     |
| :----- | :---------------------------------------------------------------------------------------- |
| `401`  | No authenticated user.                                                                     |
| `403`  | Not the owner nor an accepted educator; or (educator) the paper/memo is not yet available. |
| `404`  | Round not found; no paper/memo has been uploaded or generated; or a preview was requested for a round with no questions. |

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
Server Actions are **not externally callable** via HTTP. They are invoked exclusively by React form components and client-side `useActionState` hooks within the application. This section documents them for developers working on the codebase; the externally reachable HTTP surface lives in [Part 1](#part-1-standard-rest-endpoints) above, and the open read-only API is covered in the [Public API Documentation](./public-api.md).
:::

Nearly all educator- and organiser-facing functionality lives here rather than in REST routes: portal and round authoring, question-paper and certificate uploads, AI question generation, invitations, marking, results publication, automations, and notifications. There are ~35 such actions, catalogued below.

### Conventions

Every action in this section follows the same broad shape:

1. **Resolve the caller** — `const supabase = await createClient(); const { data: { user } } = await supabase.auth.getUser();`. If there is no `user`, the action either `redirect('/login')`, returns an error object, or `throw`s (see per-action notes).
2. **Authorize** — role and ownership checks are performed against the `memberships`, `portals`, and `users` tables. Membership roles are `organiser`, `educator`, and `student`; platform administrators are flagged by `users.isPlatformAdmin`.
3. **Mutate** — Drizzle queries run against Postgres (Supabase). File uploads go to Supabase Storage buckets (`applications`, `round-documents`, `question-images`).
4. **Side effects** — many actions send email (`sendInviteEmail`, notification dispatch), create in-app notifications (`notifyEducatorsInPortal`), and call `revalidatePath(...)` to refresh cached routes.
5. **Return / redirect** — actions either return a plain result object (`{ success }`, `{ error }`, or a typed payload), `throw` an `Error`, or call `redirect(...)` (which throws internally and unwinds the action).

**Two argument styles are used:**

- **`FormData` actions** — bound to a `<form action={...}>`. Fields are read with `formData.get('field')` / `formData.getAll('field')`, and files arrive as `File` objects.
- **Typed-argument actions** — called directly from client components via `useActionState` or event handlers, receiving primitive/object arguments.

**Return-shape legend used below:**

| Shape | Meaning |
| :--- | :--- |
| `{ success: true, ... }` | Operation completed. |
| `{ error: string }` | Handled failure; the client renders a toast. |
| `throw new Error(...)` | Unhandled/guard failure; surfaces via the error boundary. |
| `redirect(path)` | Navigates the browser (throws internally). |

### Action Index

| # | Action | Role | Source file |
| :-- | :----- | :--- | :---------- |
| 1 | [`login`](#login) | Public | `src/app/auth/actions.ts` |
| 2 | [`signup`](#signup) | Public | `src/app/auth/actions.ts` |
| 3 | [`logout`](#logout) | Any (authed) | `src/app/auth/actions.ts` |
| 4 | [`requestPasswordReset`](#requestpasswordreset) | Public | `src/app/auth/actions.ts` |
| 5 | [`resetPassword`](#resetpassword) | Recovery session | `src/app/auth/actions.ts` |
| 6 | [`approveApplication`](#approveapplication) | Platform admin | `src/app/admin/actions.ts` |
| 7 | [`denyApplication`](#denyapplication) | Platform admin | `src/app/admin/actions.ts` |
| 8 | [`submitOrganiserApplication`](#submitorganiserapplication) | Authed user | `src/app/organiser/actions.ts` |
| 9 | [`createPortal`](#createportal) | Approved organiser | `src/app/organiser/actions.ts` |
| 10 | [`deleteOlympiad`](#deleteolympiad) | Portal owner | `.../[olympiadId]/actions.ts` |
| 11 | [`addEducators`](#addeducators) | Organiser | `.../[olympiadId]/actions.ts` |
| 12 | [`sendInvitations`](#sendinvitations) | Organiser | `.../[olympiadId]/invite/actions.ts` |
| 13 | [`createRound`](#createround) | Portal owner | `.../rounds/create/actions.ts` |
| 14 | [`updateRound`](#updateround) | Portal owner | `.../rounds/[roundId]/actions.ts` |
| 15 | [`deleteRound`](#deleteround) | Organiser | `.../rounds/[roundId]/actions.ts` |
| 16 | [`publishRoundResults`](#publishroundresults-organiser) | Portal owner | `.../rounds/[roundId]/actions.ts` |
| 17 | [`generateTestFromPDF`](#generatetestfrompdf) | Organiser | `.../rounds/[roundId]/ai-actions.ts` |
| 18 | [`generateTestFromBase64PDF`](#generatetestfrombase64pdf) | Organiser | `.../rounds/create/ai-actions.ts` |
| 19 | [`createRule`](#createrule) | Organiser | `.../[olympiadId]/automations/actions.ts` |
| 20 | [`deleteRule`](#deleterule) | Organiser | `.../[olympiadId]/automations/actions.ts` |
| 21 | [`toggleRuleState`](#togglerulestate) | Organiser | `.../[olympiadId]/automations/actions.ts` |
| 22 | [`runDryRun`](#rundryrun) | Organiser | `.../[olympiadId]/automations/dry-run.ts` |
| 23 | [`sendBroadcastNotification`](#sendbroadcastnotification) | Organiser | `.../rounds/[roundId]/broadcast-actions.ts` |
| 24 | [`updateCertificateTemplates`](#updatecertificatetemplates) | Organiser | `.../rounds/[roundId]/certificate/actions.ts` |
| 25 | [`uploadCertificateTemplate`](#uploadcertificatetemplate) | Organiser | `.../rounds/[roundId]/certificate/actions.ts` |
| 26 | [`resolveRemark`](#resolveremark) | Organiser | `.../rounds/[roundId]/remarks/actions.ts` |
| 27 | [`inviteStudents`](#invitestudents) | Educator | `src/app/educator/actions.ts` |
| 28 | [`submitMarksForModeration`](#submitmarksformoderation) | Educator | `.../rounds/[roundId]/marking/actions.ts` |
| 29 | [`publishRoundResults`](#publishroundresults-educator) | Educator | `.../rounds/[roundId]/marking/actions.ts` |
| 30 | [`submitBulkOfflineMarks`](#submitbulkofflinemarks) | Educator | `.../rounds/[roundId]/offline-marks/actions.ts` |
| 31 | [`requestRemark`](#requestremark) | Educator | `.../results/[submissionId]/actions.ts` |
| 32 | [`getUnreadNotifications`](#getunreadnotifications) | Educator | `src/app/educator/notifications/actions.ts` |
| 33 | [`markAsRead`](#markasread) | Educator | `src/app/educator/notifications/actions.ts` |
| 34 | [`markAllAsRead`](#markallasread) | Educator | `src/app/educator/notifications/actions.ts` |
| 35 | [`requestStudentRemark`](#requeststudentremark) | Student | `.../(student)/results/scores/[submissionId]/actions.ts` |

### Authentication & Account

**Source:** `src/app/auth/actions.ts`

#### login

Signs a user in with email + password and routes them to the portal picker.

```ts
login(formData: FormData): Promise<void>
```

- **Role:** Public.
- **Inputs:** `email`, `password`.
- **Behaviour:**
  - Calls `supabase.auth.signInWithPassword`. A development bypass exists for `admin1@gmail.com` / `111111` that auto-creates a platform-admin account if sign-in fails.
  - **Ghost-account guard:** if credentials exist in Supabase Auth but the `public.users` row was deleted, the session is signed out and an error is returned.
  - **Invite auto-claim:** any `memberships` rows with `status = 'invited'` whose `invitedEmail` matches the caller's email are accepted and linked to the user (teachers often join several olympiads).
- **Returns:** `{ error }` on failure; otherwise `revalidatePath('/', 'layout')` then `redirect('/dashboard')`.

#### signup

Creates a Supabase Auth user, mirrors it into `public.users`, and claims any invite token.

```ts
signup(formData: FormData): Promise<void>
```

- **Role:** Public.
- **Inputs:** `email`, `password`, `name`, optional `inviteToken`.
- **Behaviour:**
  - `supabase.auth.signUp` with `full_name` metadata, then inserts into `users` (`onConflictDoNothing`). `isPlatformAdmin` is set when the email is `admin1@gmail.com`.
  - If `inviteToken` is present, the matching membership is claimed (`status = 'accepted'`, `userId` linked, `users.schoolId` set) and a role-based redirect target is computed (`/educator` for educators, `/results` for students).
  - Also auto-accepts **all** other pending invites for the same email.
- **Returns:** `{ error }` on failure; otherwise `redirect('/welcome?next=<target>')`.

#### logout

```ts
logout(): Promise<void>
```

- **Role:** Any authenticated user.
- **Behaviour:** `supabase.auth.signOut()`, then `revalidatePath('/', 'layout')` and `redirect('/')`.

#### requestPasswordReset

Sends a password-recovery email without revealing whether the address exists.

```ts
requestPasswordReset(formData: FormData): Promise<{ error?: string; success?: string }>
```

- **Role:** Public.
- **Inputs:** `email`.
- **Behaviour:**
  - Only sends if a `public.users` profile exists (ghost accounts are skipped).
  - The reset link points to `/auth/callback?next=/reset-password`. The `Origin` header is validated by `resolveResetOrigin` — only the configured base URL, `localhost`/`127.0.0.1`, or RFC-1918 private addresses are trusted; anything else falls back to `NEXT_PUBLIC_BASE_URL`.
- **Returns:** always a generic `{ success }` message (no account enumeration), or `{ error }` if the send call itself fails.

#### resetPassword

Completes the recovery flow after `/auth/callback` has exchanged the code for a session.

```ts
resetPassword(formData: FormData): Promise<void>
```

- **Role:** Requires a valid recovery session.
- **Inputs:** `password`, `confirmPassword` (min 6 chars, must match).
- **Behaviour:** `supabase.auth.updateUser({ password })`.
- **Returns:** `{ error }` on validation/session failure; otherwise `redirect('/dashboard')`.

### Platform Administration

**Source:** `src/app/admin/actions.ts`

Both actions are gated by an internal `verifyPlatformAdmin()` helper that checks `users.isPlatformAdmin`. Non-admins are `redirect('/dashboard')`.

#### approveApplication

```ts
approveApplication(formData: FormData): Promise<void>
```

- **Role:** Platform admin.
- **Inputs:** `applicationId`.
- **Behaviour:** sets `organiserApplications.status = 'approved'` and stamps `updatedAt`.
- **Side effects:** `revalidatePath('/admin/dashboard')`.

#### denyApplication

```ts
denyApplication(formData: FormData): Promise<void>
```

- **Role:** Platform admin.
- **Inputs:** `applicationId`.
- **Behaviour:** sets `organiserApplications.status = 'rejected'` and stamps `updatedAt`.
- **Side effects:** `revalidatePath('/admin/dashboard')`.

### Organiser

The organiser surface is the largest. It spans onboarding, portal/olympiad management, invitations, round authoring (manual + AI), automations, certificates, broadcasts, and remark resolution.

**Onboarding & Portals** — `src/app/organiser/actions.ts`

#### submitOrganiserApplication

Uploads the organiser's motivating PDF and opens (or resets) an application for admin review.

```ts
submitOrganiserApplication(formData: FormData): Promise<void>
```

- **Role:** Any authenticated user.
- **Inputs:** `applicationPdf` (`File`).
- **Behaviour:** uploads to the `applications` Storage bucket as `<userId>-<timestamp>.<ext>`, stores the public URL, then upserts `organiserApplications` with `status = 'pending'`.
- **Side effects:** `revalidatePath('/dashboard')`, `revalidatePath('/organiser/dashboard')`.
- **Returns:** `{ error }` if no file or the upload fails; otherwise resolves with no value.

#### createPortal

Creates a new portal (olympiad container) plus its initial schools and educator invites.

```ts
createPortal(formData: FormData): Promise<{ success?: true; error?: string }>
```

- **Role:** Authenticated user with an **approved** organiser application.
- **Inputs:** `portalName`, `schoolCount`, and per-school indexed fields `school_name_<i>`, `school_type_<i>`, `school_externalId_<i>`, `school_teacherEmails_<i>` (repeated). Schools always come from the picker — never free-typed.
- **Behaviour (single transaction):**
  - Inserts the portal with `status = 'pending'`.
  - For each school entry, `ensureSchool` finds-or-creates a portal-scoped `schools` row.
  - For each teacher email: existing users get an **accepted** educator membership; new emails get an **invited** membership and are queued for an invite email.
  - Invite emails are sent **after** the transaction commits (each failure is logged but does not roll back).
- **Returns:** `{ error }` if not an approved organiser, name missing, or the transaction fails; otherwise `{ success: true }` and `revalidatePath('/organiser/dashboard')`.

**Olympiad Management** — `src/app/organiser/olympiads/[olympiadId]/actions.ts`

#### deleteOlympiad

```ts
deleteOlympiad(portalId: string): Promise<void>
```

- **Role:** Portal owner (`portals.ownerUserId === user.id`).
- **Guard:** refuses if **any** round is past `scheduled` (i.e. has opened or started), via `deriveRoundState`.
- **Behaviour:** deletes the portal; `ON DELETE CASCADE` removes rounds, schools, and memberships.
- **Returns:** `throw`s on unauthorized/blocked; otherwise `revalidatePath` + `redirect('/organiser/dashboard')`.

#### addEducators

Invites additional educators to a school that already participates in the olympiad.

```ts
addEducators(portalId: string, schoolId: string, formData: FormData): Promise<{ error?: string }>
```

- **Role:** Organiser (authenticated).
- **Inputs:** `teacherEmails` (repeated).
- **Guard:** the `schoolId` must belong to `portalId` (a tampered id cannot attach educators to another portal's school).
- **Behaviour:** transaction wrapping `inviteEducatorsToSchool` (existing users accepted, new emails invited), then invite emails after commit.
- **Side effects:** `revalidatePath('/organiser/olympiads/<portalId>')`.

**Invitations** — `src/app/organiser/olympiads/[olympiadId]/invite/actions.ts`

#### sendInvitations

Bulk-invite educators across many schools in one submission.

```ts
sendInvitations(portalId: string, formData: FormData): Promise<void>
```

- **Role:** Organiser (authenticated); redirects to `/login` if absent.
- **Inputs:** `schoolCount` and the same indexed per-school fields as `createPortal`.
- **Behaviour:** single transaction; `ensureSchool` per entry (re-inviting a school reuses its row) then `inviteEducatorsToSchool`; emails sent after commit.
- **Returns:** `{ error }` on failure; otherwise `revalidatePath` + `redirect('/organiser/olympiads/<portalId>')`.

**Rounds** — `.../rounds/create/actions.ts`, `.../rounds/[roundId]/actions.ts`

Rounds support three `deliveryMethod` values — `paper`, `online`, and `hybrid` — which determine whether a PDF is uploaded, an online question set is authored, or both. All timestamps are parsed as SAST (`+02:00`).

Both `createRound` and `updateRound` author a **question pool** for every delivery method and share the same grading/variant model:

- **`targetTotalMarks`** — the unified grading base for **all** delivery methods. Online sittings deal a per-entrant variant filled to this total, and it is the single score denominator for marking, results and advancement. Nullable: paper/hybrid may omit it and fall back to the selected paper total.
- **`selectedQuestionIds`** — the organiser's **ordered physical selection** for paper/hybrid rounds (a hand-picked subset of the pool used to build the printable PDF), stored on `questionPapers`.
- **Per-question `difficulty`** — an integer `1`–`5` used to difficulty-balance the online/hybrid variant draw. **`marks`** is now **nullable** so a draft pool question may omit it.
- **Publish-readiness guard** — a pure check (shared with the advisory client-side `PublishReadinessPanel`) that **blocks the write** when a *used* question lacks marks/difficulty, or the target total is unreachable by the balanced draw. For online/hybrid the whole pool must be fully specified and the target exactly reachable; for physical papers the selected questions must carry marks.

#### createRound

```ts
createRound(formData: FormData): Promise<void>
```

- **Role:** **Portal owner only** (`portals.ownerUserId === user.id`). The `[olympiadId]` URL segment is not trusted — ownership is resolved from the DB before any upload or write, so a round can only be authored into a portal the caller owns.
- **Inputs:** `portalId`, `name`, `orderIndex`, `opensAt`, `closesAt`, `deliveryMethod`, optional `qualifyingThreshold`, `thresholdTopN`, `targetTotalMarks` (unified grading base, all delivery methods), `selectedQuestionIds` (ordered physical selection for paper/hybrid), and method-specific fields (`questionPaper`/`answerKey` files, or `questionsData` JSON + `image_<id>` files). Each `questionsData` entry may carry a per-question `difficulty` (`1`–`5`, online/hybrid) and a nullable `marks` (a draft may omit it).
- **Guards:**
  - `closesAt` must be after `opensAt`; if `targetTotalMarks` is present it must be a whole number ≥ 1.
  - **Publish-readiness guard** (runs before any upload/write, so a not-ready round neither leaks a file nor persists half a round): blocks the write when a used question lacks marks/difficulty or the target total is unreachable.
- **Behaviour:** inserts the round (with `targetTotalMarks`); inserts a `questionPapers` row for every delivery method, storing the uploaded PDF URL and the ordered `selectedQuestionIds` for paper/hybrid; parses `questionsData` (all methods), uploads any question images to `question-images`, and inserts `questions` (each with nullable `marks` and `difficulty`). All in a single atomic transaction.
- **Returns:** `throw`s on validation/upload failure; otherwise `revalidatePath` + `redirect('/organiser/olympiads/<portalId>')`.

#### updateRound

```ts
updateRound(formData: FormData): Promise<void>
```

- **Role:** **Portal owner only** (`portals.ownerUserId === user.id`). Neither the `[olympiadId]` URL segment nor the submitted `roundId`/`portalId` are trusted: the round is joined to its portal and matched on **both** `rounds.id` **and** `rounds.portalId`, and ownership is verified from the DB before any write.
- **Inputs:** `portalId`, `roundId`, and the same round fields as `createRound` — including `targetTotalMarks`, the ordered `selectedQuestionIds`, and per-question `difficulty` / nullable `marks`.
- **Guards:**
  - `closesAt` must be after `opensAt`; if `targetTotalMarks` is present it must be a whole number ≥ 1.
  - For `online`/`hybrid`, editing is **blocked once any student has a live sitting** on the round's paper. The lock is keyed on the **stored** delivery method (not the submitted form field), so posting `deliveryMethod: 'paper'` for a live online round cannot skip it. Any variants already dealt are frozen and will not change.
  - Question validation: `free_text` questions require marking guidelines; choice questions require a selected answer that exists in `options`; `matching` questions require pairs.
  - **Publish-readiness guard** (runs before any write): blocks the write when a used question lacks marks/difficulty or the target total is unreachable. **Legacy exemption** — a round that predates difficulty/target authoring (no `targetTotalMarks` **and** every pool question has a null difficulty) skips the readiness checks, so it stays editable without retrofitting the whole pool.
- **Behaviour:** updates the round fields (including `targetTotalMarks`); optionally replaces the question paper / answer-key memo PDFs (a new paper triggers an in-app "Question Paper Available" notification to educators); and applies an **id-preserving upsert** to the question set — updating unchanged rows, inserting new ones, and deleting only rows that disappeared from the payload, so a persisted `selectedQuestionIds` / dealt `variantQuestionIds` is never orphaned and `studentAnswers` are never cascade-deleted.
- **Returns:** `throw`s on guard failure; otherwise `revalidatePath` + `redirect('/organiser/olympiads/<portalId>')`.

#### deleteRound

```ts
deleteRound(roundId: string, portalId: string): Promise<void>
```

- **Role:** Organiser (authenticated).
- **Guard:** only rounds still in the `scheduled` state can be deleted.
- **Behaviour:** deletes the round; cascade removes questions, papers, and submissions.
- **Returns:** `throw`s if not found/not scheduled; otherwise `revalidatePath` + `redirect`.

#### publishRoundResults (organiser)

Releases a closed round's results and triggers the downstream notification + advancement pipeline.

```ts
publishRoundResults(formData: FormData): Promise<{
  error?: string;
  alreadyPublished?: boolean;
  summary?: DispatchSummary;
  advancementSummary?: AdvancementSummary | null;
}>
```

- **Role:** **Portal owner only** (`portals.ownerUserId === user.id`).
- **Inputs:** `portalId`, `roundId`.
- **Guards:** idempotent — returns `{ alreadyPublished: true }` if `resultsPublishedAt` is already set; otherwise requires the derived round state to be `closed`.
- **Behaviour:** stamps `resultsPublishedAt`, calls `sendResultsPublishedNotifications` (educator school summaries + entrant results), then `advanceQualifyingEntrants` to promote qualifiers into the next round. Notification failures are caught and summarized rather than thrown.
- **Returns:** `{ summary, advancementSummary }` (or `{ error }` / `{ alreadyPublished }`).

**AI Question Generation** — `.../rounds/[roundId]/ai-actions.ts`, `.../rounds/create/ai-actions.ts`

Two related actions call Google Gemini to extract a structured question set from a PDF paper (and optional memo). Both require the `GEMINI_API_KEY` environment variable and try several models in sequence.

:::caution
Neither AI action performs its own `supabase.auth.getUser()` check — they rely on being invoked only from the authorized organiser round pages. If you reuse them elsewhere, add an explicit authorization guard.
:::

#### generateTestFromPDF

Extracts questions from a round's **already-uploaded** paper and writes them to the database.

```ts
generateTestFromPDF(roundId: string, portalId: string): Promise<void>
```

- **Inputs:** `roundId`, `portalId`.
- **Behaviour:** fetches the paper PDF (`questionPapers.fileUrl`) and the memo PDF (`answerKeyJson.memoUrl`) from storage, base64-encodes them, sends both to Gemini with a strict JSON `responseSchema`, then deletes existing questions and inserts the extracted set. When a memo is present it is used to determine each `correctAnswer` for auto-marking.
- **Returns:** `throw`s if the key is missing, no paper exists, the fetch/parse fails, or all models error; otherwise `revalidatePath('/organiser/olympiads/<portalId>/rounds/<roundId>')`.

#### generateTestFromBase64PDF

Preview-time extraction used by the round **builder** before the round exists.

```ts
generateTestFromBase64PDF(base64Pdf: string, base64Memo?: string | null):
  Promise<{ data?: FormattedQuestion[]; error?: string }>
```

- **Inputs:** base64-encoded paper (and optional memo) supplied directly by the client.
- **Behaviour:** same Gemini extraction, but **no database writes** — it returns formatted questions (each given a fresh `crypto.randomUUID()` id, normalized to `single_choice`/`short_text`) so they can populate the `QuestionBuilder` UI.
- **Returns:** `{ data }` on success or `{ error }` on failure.

**Automations** — `.../[olympiadId]/automations/actions.ts`, `.../automations/dry-run.ts`

Automation rules drive scheduled reminder emails. A rule's `triggerType` is one of `round_opening`, `round_closing`, `submission_overdue`, or `results_published`, fired relative to the round by `triggerOffsetMinutes`.

#### createRule

```ts
createRule(formData: FormData): Promise<void>
```

- **Inputs:** `portalId`, `name`, `triggerType`, `triggerOffsetMinutes`, `templateSubject`, `templateHtml`, and a `missingSubmissionsOnly` toggle stored in `conditions`.
- **Behaviour:** inserts an `automationRules` row with `isActive = true`; `revalidatePath('.../automations')`.

#### deleteRule

```ts
deleteRule(ruleId: string, portalId: string): Promise<void>
```

- **Behaviour:** deletes the rule scoped to the portal (`id` **and** `portalId`), then revalidates.

#### toggleRuleState

```ts
toggleRuleState(ruleId: string, portalId: string, isActive: boolean): Promise<void>
```

- **Behaviour:** flips `automationRules.isActive` for the portal-scoped rule, then revalidates.

#### runDryRun

Previews who a rule would email and renders a sample message — **without sending anything**.

```ts
runDryRun(ruleId: string, roundId: string): Promise<DryRunResult>
```

- **Returns `DryRunResult`:**
  ```ts
  { ruleName: string; matchedRecipients: number;
    sampleEmail?: { to: string; subject: string; html: string }; error?: string }
  ```
- **Behaviour:** loads the rule and round, resolves educators and entrant submission status, then computes `matchedRecipients` and a representative `sampleEmail` per `triggerType` using the shared email templates. Returns `{ error }` if the rule or round is missing.

**Broadcast** — `.../rounds/[roundId]/broadcast-actions.ts`

#### sendBroadcastNotification

Pushes an ad-hoc in-app notification to every educator in the portal.

```ts
sendBroadcastNotification(portalId: string, roundId: string, title: string, message: string):
  Promise<{ success: boolean; error?: string }>
```

- **Role:** Organiser (authenticated).
- **Behaviour:** calls `notifyEducatorsInPortal` with a deep link to `/educator/olympiads/<portalId>/rounds/<roundId>`.
- **Returns:** `{ success: true }` or `{ success: false, error }`.

**Certificates** — `.../rounds/[roundId]/certificate/actions.ts`

#### updateCertificateTemplates

Replaces the certificate tiers for a round.

```ts
updateCertificateTemplates(roundId: string, templates: {
  minScorePercentage: string; templateUrl: string;
  nameXCoord: string; nameYCoord: string;
  nameFontSize: number; nameTextColor: string;
}[]): Promise<{ success: true }>
```

- **Behaviour:** deletes existing `certificateTemplates` for the round, then bulk-inserts the new set (each tier keyed by `minScorePercentage` with name-placement coordinates for PDF rendering).

#### uploadCertificateTemplate

```ts
uploadCertificateTemplate(roundId: string, formData: FormData): Promise<{ publicUrl: string }>
```

- **Inputs:** `file` (`File`).
- **Behaviour:** uploads to the `round-documents` bucket and returns the public URL (used to populate `templateUrl` in `updateCertificateTemplates`).
- **Returns:** `throw`s if no file or the upload fails.

**Remarks** — `.../rounds/[roundId]/remarks/actions.ts`

#### resolveRemark

Resolves an educator- or student-initiated remark request.

```ts
resolveRemark(resultId: string, outcome: string): Promise<{ success: boolean; error?: string }>
```

- **Behaviour:** sets `results.status = 'remark_resolved'` and stores `remarkOutcome`, then notifies all educators in the portal (in-app) with a link to the result.
- **Returns:** `{ success: true }` or `{ success: false, error }`.

### Educator

Educators are school-scoped: their membership ties a `userId` to a specific `portalId` **and** `schoolId`. Educator actions cover entrant management, marking (online moderation and offline bulk entry), result remarks, and in-app notifications.

**Entrants** — `src/app/educator/actions.ts`

#### inviteStudents

Invites students to the educator's own school within a portal.

```ts
inviteStudents(formData: FormData): Promise<{ success?: true; count?: number; error?: string }>
```

- **Role:** Educator with an **accepted** membership for the given `portalId` + `schoolId`.
- **Inputs:** `portalId`, `schoolId`, `studentEmails` (repeated).
- **Guards:**
  - The caller must hold an accepted `educator` membership for that exact portal **and** school.
  - Defense-in-depth: the target `school` row must belong to `portalId` (legacy rows predating the membership guard are rejected).
- **Behaviour (per unique email):**
  - Already an accepted member → skipped.
  - Existing user, no membership → membership inserted as **accepted**.
  - No account → membership inserted as **invited** and an invite email is queued.
  - Pending invite whose owner now has an account → linked and accepted.
  - Pending invite, still no account → re-sent with the original token, re-pointed at this school.
  - Invite emails are sent after the DB loop; the whole operation is wrapped in try/catch.
- **Side effects:** `revalidatePath('/educator')`, `/educator/entrants`, and `/organiser/olympiads/<portalId>`.
- **Returns:** `{ error }` on guard/DB failure; otherwise `{ success: true, count }`.

**Marking** — `src/app/educator/rounds/[roundId]/marking/actions.ts`

#### submitMarksForModeration

Saves an educator's per-question grades for one submission and computes the moderated total.

```ts
submitMarksForModeration(
  roundId: string,
  submissionId: string,
  grades: { questionId: string; score: number; feedback: string }[]
): Promise<{ success?: true; error?: string }>
```

- **Role:** Educator for the **student's** school (`schoolId` + `portalId`, accepted).
- **Behaviour:**
  1. Resolves the submission → student membership → verifies the caller is an educator for that school.
  2. Finds the round's question paper and the student's `examSittings` row (creating a `submitted` sitting if none exists).
  3. Upserts `studentAnswers` for each grade, storing `manualScore` and `educatorFeedback`.
  4. Computes the total: manual scores **plus** re-evaluated auto-marked (non-`free_text`) questions for online submissions, using the `isAnswerCorrect` comparator.
  5. Upserts the `results` row with `status = 'moderated'` and `gradedByMembershipId`.
- **Returns:** `{ error }` on any guard/DB failure; otherwise `{ success: true }`.

#### publishRoundResults (educator)

A lightweight educator-side variant that simply stamps the round as published.

```ts
publishRoundResults(roundId: string): Promise<void>
```

- **Role:** Authenticated educator.
- **Behaviour:** sets `rounds.resultsPublishedAt = now()`, then `revalidatePath('.../marking')` and `/results`.
- **Returns:** `throw`s only if unauthenticated; internal errors are caught and logged (no throw).

:::note
This educator action shares its name with the organiser's [`publishRoundResults`](#publishroundresults-organiser) but is a different function in a different module. The organiser version is the authoritative one — it enforces portal ownership, requires the round to be `closed`, sends notifications, and advances qualifiers. The educator version only sets the timestamp.
:::

**Offline Marks** — `src/app/educator/rounds/[roundId]/offline-marks/actions.ts`

#### submitBulkOfflineMarks

Records marks for a paper-based round in bulk.

```ts
submitBulkOfflineMarks(
  roundId: string,
  marksData: { studentMembershipId: string; score: number }[]
): Promise<{ success?: true; error?: string }>
```

- **Role:** Any user holding an `educator` membership (the first one is used as `gradedByMembershipId`).
- **Behaviour (per entry, skipping `NaN` scores):** finds or creates an `offline` submission (`status = 'submitted'`), then upserts the `results` row with the score and `status = 'auto_marked'` (treated as final for offline rounds).
- **Side effects:** `revalidatePath('/educator/rounds/<roundId>/offline-marks')`.
- **Returns:** `{ error }` if unauthenticated/not an educator/on DB failure; otherwise `{ success: true }`.

**Results & Remarks** — `src/app/educator/results/[submissionId]/actions.ts`

#### requestRemark

Flags a result for the organiser to review.

```ts
requestRemark(submissionId: string, reason: string): Promise<{ success: boolean; error?: string }>
```

- **Role:** Authenticated educator.
- **Behaviour:** sets `results.status = 'remark_requested'` and stores `remarkReason` for the submission.
- **Returns:** `{ success: true }` or `{ success: false, error }`; revalidates `/educator/results/<submissionId>`.

**In-App Notifications** — `src/app/educator/notifications/actions.ts`

These three actions back the educator notification bell. All are scoped to the authenticated user's `inAppNotifications` rows.

#### getUnreadNotifications

```ts
getUnreadNotifications(): Promise<InAppNotification[]>
```

- Returns up to the 10 most recent unread notifications (`isRead = false`), newest first. Returns `[]` if unauthenticated.

#### markAsRead

```ts
markAsRead(notificationId: string): Promise<void>
```

- Marks a single notification read — only if it belongs to the caller (`id` **and** `userId`).

#### markAllAsRead

```ts
markAllAsRead(): Promise<void>
```

- Marks every unread notification for the caller as read.

### Student

**Source:** `src/app/(student)/results/scores/[submissionId]/actions.ts`

#### requestStudentRemark

Lets a student dispute their own result.

```ts
requestStudentRemark(submissionId: string, reason: string): Promise<{ success: boolean; error?: string }>
```

- **Role:** Student, with an **ownership check** — the submission's membership must belong to the caller (`memberships.userId === user.id`).
- **Behaviour:** sets `results.status = 'remark_requested'` and stores `remarkReason`, then revalidates `/results/scores/<submissionId>`.
- **Returns:** `{ success: true }`, or `{ success: false, error }` when unauthorized or on failure.

:::note
This mirrors the educator's [`requestRemark`](#requestremark) but adds a strict ownership guard, since students may only act on their own submissions.
:::

### Authorization Summary

| Area | Gate | Enforced by |
| :--- | :--- | :--- |
| Auth (`login`, `signup`, `requestPasswordReset`) | None (public) | Supabase Auth |
| `resetPassword` | Valid recovery session | `/auth/callback` exchange |
| Admin actions | `users.isPlatformAdmin` | `verifyPlatformAdmin()` |
| `submitOrganiserApplication` | Authenticated | `getUser()` |
| `createPortal` | Approved organiser application | `organiserApplications.status` |
| `deleteOlympiad`, `createRound`, `updateRound`, organiser `publishRoundResults` | Portal owner | `portals.ownerUserId` |
| Round/automation/certificate/broadcast/remark actions | Authenticated organiser | `getUser()` + portal scoping |
| `inviteStudents`, `submitMarksForModeration` | Educator for the school | `memberships` (role + `schoolId` + `portalId`) |
| `submitBulkOfflineMarks` | Any educator membership | `memberships.role` |
| `requestStudentRemark` | Owns the submission | `memberships.userId` |

:::caution Known gaps
A few actions authenticate the caller but do **not** re-verify portal ownership before mutating:
- `deleteRound`, `createRule`, `deleteRule`, `toggleRuleState`, `updateCertificateTemplates`, and the AI generation actions check only that a user is signed in (portal scoping happens via the ids passed in). `createRound` and `updateRound` are **no longer** in this group — both now re-verify `portals.ownerUserId` before writing.
- The educator `publishRoundResults(roundId)` sets `resultsPublishedAt` without an ownership or round-state check.

Treat these as trusted-UI actions: they are safe as wired into the organiser/educator pages, but any new call site should add an explicit authorization guard.
:::

---

## Part 4: Standard Error Handling

Our application standardizes error handling across both REST routes and Server Actions. When a failure occurs, the client intercepts the following codes and renders the appropriate toast notification or redirect:

- **401 Unauthorized**: The Supabase session is missing or expired. The client automatically redirects to `/login`.
- **403 Forbidden**: The user is authenticated but lacks the specific `membership` role required for the action (e.g., a Student attempting to call `createRound`).
- **404 Not Found**: The requested resource (e.g., an Olympiad ID) does not exist or belongs to another portal.
- **500 Internal Server Error**: An unhandled database exception occurred. The error is logged to the console, and a generic "Something went wrong" toast is presented to the user to prevent leaking schema details.
