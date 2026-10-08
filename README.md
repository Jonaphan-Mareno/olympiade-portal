# Olympiad Portal - Getting Started

## Project Overview

The Olympiad Portal is a comprehensive platform designed to facilitate the management and execution of academic olympiads. It provides dedicated interfaces for organizers, educators, and students to streamline registration, test administration, and performance analytics.

## Architectural Stack

This project follows a logically decoupled Domain-Driven Design (DDD) architecture utilizing a modern full-stack meta-framework:

- **Framework:** Next.js (App Router, Server Actions)
- **Styling:** Tailwind CSS
- **Database ORM:** Drizzle ORM
- **Database & Auth:** Supabase (PostgreSQL)

## Prerequisites

Before you begin, ensure you have the following installed on your system:

- **Node.js** (v18 or higher recommended)
- **Git**

## Local Setup

**1. Clone the repository**

```bash
git clone [https://github.com/your-username/olympiad-portal-repo.git](https://github.com/your-username/olympiad-portal-repo.git)
cd olympiad-portal-repo
```

**2. Environment Variables**
To connect the database and authentication services, you will need to configure your local environment keys.

- We have provided a secure template file named `.env.example` in the repository.
- Duplicate this file and rename it to `.env.local` in your root directory.
- Please contact the development team for the live Supabase testing keys.

**3. Running the Application**
Install the dependencies and start the Next.js development server:

```bash
npm install
npm run dev
```

**4. Viewing the Documentation (Docusaurus)**
Comprehensive technical documentation, including our Milestone 1 system design and roadmaps, is available locally. Open a _second_ terminal window:

```bash
cd Documentation
npm install
npm run start
```

**5. Running Tests**
The unit test suite runs on Vitest:

```bash
npm run test:run
```

To run the suite with code coverage and print only the overall coverage summary (the header and the `All files` row):

```bash
npm run test:coverage 2>&1 | sed -n '/% Stmts/,$p' | head -3
```

How it works:

- `npm run test:coverage` — runs all unit tests with code coverage enabled
- `2>&1` — merges stderr into stdout (Vitest prints the coverage table to stderr, so a plain pipe would miss it)
- `sed -n '/% Stmts/,$p'` — starts printing at the coverage table header and continues to the end, discarding all test-run output above it
- `head -3` — keeps only the table header, separator, and the `All files` summary row

Example output:

```
File               | % Stmts | % Branch | % Funcs | % Lines | Uncovered Line #s
-------------------|---------|----------|---------|---------|-------------------
All files          |   78.64 |    70.48 |   74.26 |   80.28 |
```

> **Note:** Vitest skips the coverage report when any test fails. If the command prints nothing, run `npm run test:run` to find the failing test.

---
## AI Declaration

All code and documentation in this repository was generated and/or reviewed with the assistance of multiple AI models and agents, under the direction and final review of the developers.