# API Documentation

The Olympiad Portal utilizes a hybrid API strategy. Standard RESTful API endpoints are exposed for specific client-side consumption (e.g., dynamic search fields) and potential external integrations, while the vast majority of our internal data mutations are handled securely via Next.js Server Actions.

All endpoints and actions require authentication via a valid Supabase session cookie, enforced either via Next.js Middleware or explicit server-side auth checks.

---

## Part 1: Standard REST Endpoints

### 1. Health Check
Used by monitoring tools (and our automated CI pipeline) to ensure the Next.js server is responsive.
- **Endpoint**: `GET /api/health`
- **Auth Required**: No

**Response (200 OK)**
```json
{
  "status": "ok",
  "timestamp": "2026-09-14T19:27:54.000Z"
}
```

### 2. Schools Search
Used to dynamically search for existing schools when educators are signing up. This endpoint performs an indexed, case-insensitive search (`ILIKE`) against the database.
- **Endpoint**: `GET /api/schools/search`
- **Auth Required**: Yes

**Query Parameters**
| Parameter | Type | Required | Description |
| :--- | :--- | :--- | :--- |
| `q` | `string` | Yes | The search query. Must be at least 2 characters long. |

**Response (200 OK)**
```json
[
  {
    "id": "123e4567-e89b-12d3-a456-426614174000",
    "name": "Springfield High School"
  }
]
```

---

## Part 2: Next.js Server Actions (Internal API)

While REST routes exist, the Olympiad Portal's core business logic (creating rounds, uploading question papers, submitting answers) is handled via **Next.js Server Actions**. 

Server Actions act as strict RPC (Remote Procedure Call) endpoints. They provide end-to-end type safety between our React forms and our backend Drizzle logic, eliminating the need to manually construct `fetch` calls, serialize JSON, or write Zod validators for standard REST bodies.

### Core Actions Map

| Action Name | Location | Purpose | Expected Payload | Returns |
| :--- | :--- | :--- | :--- | :--- |
| `createRound` | `app/organiser/.../actions.ts` | Generates a new exam phase for a portal. | `FormData` (name, deliveryMethod, dates) | `{ success: boolean, roundId?: string, error?: string }` |
| `submitOrganiserApplication` | `app/organiser/actions.ts` | Allows users to apply for organiser status. | `FormData` (orgName, purpose, pdfUrl) | `{ success: true }` |
| `submitExamAnswers` | `app/student/.../actions.ts` | Securely posts a student's live exam session data. | `Array<{questionId, answerValue}>` | `{ score: number, passed: boolean }` |

---

## Part 3: Standard Error Handling

Our application standardizes error handling across both REST routes and Server Actions. When a failure occurs, the client intercepts the following codes and renders the appropriate toast notification or redirect:

- **401 Unauthorized**: The Supabase session is missing or expired. The client automatically redirects to `/login`.
- **403 Forbidden**: The user is authenticated but lacks the specific `membership` role required for the action (e.g., a Student attempting to call `createRound`). 
- **404 Not Found**: The requested resource (e.g., an Olympiad ID) does not exist or belongs to another portal.
- **500 Internal Server Error**: An unhandled database exception occurred. The error is logged to the console, and a generic "Something went wrong" toast is presented to the user to prevent leaking schema details.
