# Third-Party Code Documentation

## Tech Stack Overview

Our Olympiad Portal is built on a modern, robust web stack designed for scalability, type safety, and rapid development. Below is an extensive breakdown of every major third-party library and tool we employ, alongside the strict technical motivation for their selection over competing alternatives.

### 1. Framework & Core Libraries

- **Next.js (App Router) & React** (`next`, `react`, `react-dom`):
  - *Usage*: The foundational full-stack React framework for our application. We heavily utilize React Server Components (RSC) and Next.js Server Actions.
  - *Motivation*: Next.js was chosen over standard Vite/React because the Olympiad Portal requires secure server-side logic to handle exam submissions and auth tokens. Server Actions allow us to handle data fetching and mutations securely on the server without the overhead of building and managing a separate Express backend.

- **TypeScript** (`typescript`):
  - *Usage*: The primary programming language for both frontend UI and backend server logic.
  - *Motivation*: Ensures strict end-to-end type safety. Given the complexity of tracking nested relationships (Portals -> Rounds -> Papers -> Submissions -> Results), static typing significantly reduces runtime errors and improves developer velocity via IDE autocompletion.

### 2. Database & ORM

- **Supabase SDKs** (`@supabase/supabase-js`, `@supabase/ssr`):
  - *Usage*: Interacts with the Supabase Auth API and provides session management utilities.
  - *Motivation*: Building a secure, GDPR-compliant authentication system from scratch is highly risky. Supabase provides an enterprise-grade backend out of the box. The `@supabase/ssr` package was explicitly chosen to simplify cookie-based auth resolution inside Next.js Server Components.

- **Drizzle ORM** (`drizzle-orm`, `drizzle-kit`):
  - *Usage*: The Object-Relational Mapper used to define our database schema (`schema/index.ts`) and interact with the PostgreSQL database.
  - *Motivation*: Chosen over Prisma due to its extremely lightweight footprint, full edge compatibility, and lack of a bulky rust-engine cold start. It allows us to write TypeScript that compiles down directly to highly performant SQL queries.

- **Postgres.js** (`postgres`):
  - *Usage*: The underlying PostgreSQL client driver used by Drizzle ORM.
  - *Motivation*: Highly performant and works exceptionally well in serverless environments compared to older libraries like `pg`.

### 3. Styling & User Interface

- **Tailwind CSS** (`tailwindcss`, `postcss`, `autoprefixer`):
  - *Usage*: Utility-first CSS framework for rapidly building custom user interfaces.
  - *Motivation*: We evaluated standard CSS Modules and SCSS, but Tailwind was chosen to ensure absolute design consistency (strict design tokens) and to minimize our final CSS bundle size (via automated purging of unused styles).

- **Framer Motion** (`framer-motion`):
  - *Usage*: Animation library for React used for micro-interactions and transitions.
  - *Motivation*: Essential for meeting the "Advanced" aesthetics criteria. It allows us to build complex, fluid page transitions (like our Syllabus layout slide-ins) that are notoriously difficult to coordinate with pure CSS keyframes.

- **Lucide React** (`lucide-react`):
  - *Usage*: SVG icon library.
  - *Motivation*: Provides clean, consistent, customizable SVG icons that don't bloat the bundle size compared to older font-based icon sets like FontAwesome.

### 4. Quality Assurance & Testing

- **Vitest** (`vitest`, `@testing-library/react`, `@vitest/coverage-v8`):
  - *Usage*: The primary test runner and assertion library for our unit, component, and API route tests.
  - *Motivation*: Significantly faster than Jest because it natively understands ESM and TypeScript without requiring Babel transpilation. Integrates perfectly with our Vite/Turbopack tooling.

- **Playwright** (`@playwright/test`):
  - *Usage*: Framework for end-to-end (E2E) UI testing.
  - *Motivation*: Chosen over Cypress because it supports multi-page testing, native multiple tabs, and can easily simulate real user interactions across Chromium, WebKit, and Firefox concurrently.

### 5. Dependency Versioning Strategy

To maintain stability and prevent "dependency hell," we enforce the following versioning strategy:
- **Strict Semantic Versioning**: `package.json` relies on the `^` prefix (e.g., `"next": "^16.3.1"`) to automatically pull in non-breaking minor/patch updates for security fixes.
- **Lockfile Enforcement**: `package-lock.json` is strictly committed to the repository, ensuring that every developer and the CI/CD pipeline installs the exact same dependency tree, preventing "works on my machine" errors.
- **Auditing**: We routinely run `npm audit` during our sprint cycles to detect and patch vulnerabilities in underlying third-party dependencies.

## External Services & APIs

Beyond installable libraries, the portal integrates three external HTTP services. All of them are called **server-side only**, so the browser never depends on their availability directly.

### Hipolabs Universities API

- **Service**: [`universities.hipolabs.com/search`](http://universities.hipolabs.com/search) — a free, public directory of world universities (name, country, domains). No API key, no account, no documented rate limit.
- **Usage**: Powers the `type=university` half of the school picker. When an organiser types a university name, `src/lib/schools/universities.ts` calls the API server-side via `GET /search?name=<query>`, maps each hit to a `SchoolSuggestion` (name, country, primary domain as `externalId`), ranks South African universities first, and caps the response at 20 results. The call is wrapped in a 10-second timeout.
- **Motivation**: Maintaining our own list of international universities would go stale immediately; Hipolabs is the de-facto free option and requires no key management.
- **Error handling**: Any upstream failure (network error, timeout, non-2xx, malformed payload) throws `UniversitiesApiError`, which the `/api/schools/suggest` route translates into a `502` with a friendly message instead of silently claiming there are no matches.
- **Gotcha**: The API **must be called over plain `http://`** — the host refuses connections on port 443, so `https://` fails with `ECONNREFUSED`.

### api.labs.org.za (South African high-school directory)

- **Service**: The national education department's public high-school directory.
- **Usage**: We do **not** call it at request time — it is rate limited to roughly 20 requests per minute. Instead, `npm run fetch:schools` walks all 441 pages offline (checkpointing after each page) and commits the ~8 800 schools as a static snapshot (`src/data/south-african-high-schools.json`). The `type=high_school` suggestions are served entirely from this snapshot, making high-school search instant and dependency-free at runtime.

### Brevo SMTP relay

- **Service**: Brevo (formerly Sendinblue) — transactional email relay used through standard SMTP with [Nodemailer](https://nodemailer.com/), no proprietary SDK.
- **Usage**: Delivers all invite and notification emails. See the [Email (SMTP)](./email-smtp.mdx) page for the full pipeline, environment variables, and setup guide.
