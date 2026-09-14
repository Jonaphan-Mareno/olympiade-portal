# Testing Documentation

To ensure the reliability and stability of the Olympiad Portal, we employ a rigorous, multi-faceted testing strategy. This document covers our automated testing procedures, the formal policy governing our test coverage, and the formal process by which we collect and integrate user feedback.

## 1. Automated Testing Procedure

We employ a two-tiered automated testing strategy consisting of isolated component/API tests and comprehensive end-to-end (E2E) UI tests.

### Unit & Component Testing (Vitest)
- **Tooling**: We utilize `Vitest` paired with `@testing-library/react`. Vitest was chosen over Jest for its native ESM support and exceptional speed in our Vite/Turbopack environment.
- **Scope & Execution**: These tests isolate React components (e.g., `tests/components/OrganisationApplicationForm.test.tsx`) and standard Next.js API routes (e.g., `/api/health`). 
- **Mocking**: Because our application heavily relies on Supabase Auth and Server Actions, we aggressively mock these dependencies in Vitest using `vi.mock()`. For instance, in our form tests, we mock the `submitOrganiserApplication` server action to isolate the UI validation logic from the database mutation.
- **Commands**: 
  - `npm run test` (Executes the suite in watch mode)
  - `npm run test:coverage` (Generates a full V8 coverage report)

### End-to-End (E2E) Testing (Playwright)
- **Tooling**: We use `@playwright/test` to simulate real, unmocked user interactions across Chromium, Firefox, and WebKit browsers.
- **Scope & Execution**: Playwright is reserved for critical user journeys. For example, `tests/e2e/signup.spec.ts` verifies the full DOM rendering of the authentication flow, while `tests/e2e/organiser.spec.ts` verifies that our Next.js Middleware correctly intercepts unauthenticated users and redirects them away from secure dashboard routes.
- **Commands**: 
  - `npm run test:e2e` (Executes the headless browser suite)

## 2. The Testing Policy

To maintain an "Advanced" standard of software quality, the development team adheres strictly to the following policies:

1. **Test-Driven Requirements**: Any pull request introducing a new core feature (e.g., the Question Builder) must be accompanied by relevant Vitest unit tests.
2. **UI Critical Path Coverage**: Any modification to a core user journey (Login, Signup, Round Creation) requires a corresponding Playwright E2E test to verify the flow visually and functionally.
3. **Coverage Target**: We mandate a minimum of **70% statement coverage** across our `src/components`, `src/app`, and `src/lib/db` directories.
4. **CI/CD Integration Pipeline**: All Vitest and Playwright suites are configured to run synchronously in our deployment pipeline. A branch **cannot be merged** into `main` if any automated test fails.
5. **Regression Policy**: When resolving a bug tracked in Gitea, developers are required to write a failing regression test *before* implementing the fix, ensuring the bug can never re-enter the codebase.

## 3. User Feedback Formal Process

In strict alignment with Agile Scrum, our testing strategy extends beyond automated scripts to include formal, human-in-the-loop user feedback.

### The Feedback Lifecycle
1. **Distribution**: At the culmination of a sprint (e.g., the Sprint 1 MVP), we deploy a staging branch via Vercel and distribute preview links to a curated group of peer testers representing our 'Educator' and 'Organiser' personas.
2. **Formal Collection**: Testers are required to fill out a structured Google Form. This form collects:
   - **Quantitative Metrics**: Task completion rates and System Usability Scale (SUS) scores.
   - **Qualitative Critiques**: Open text fields targeting friction points.
3. **Triage & Evaluation**: The development team reviews the survey results during the Sprint Retrospective. Critical feedback is immediately triaged into actionable Gitea Issues and added to the Sprint Backlog for the next cycle.
4. **Integration**: We execute the necessary code changes (as seen in our Sprint 2 UI Pivot, driven entirely by qualitative feedback that the initial UI felt "too generic").

*For the specific results and integration evidence of our latest feedback cycle, please see the `Stakeholder & User Research` documentation.*
