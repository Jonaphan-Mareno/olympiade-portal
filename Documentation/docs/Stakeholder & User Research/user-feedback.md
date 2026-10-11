# User Feedback & Integration

In strict alignment with our Agile Scrum methodology, extensive user testing and feedback integration are not afterthoughts; they are the core drivers of our development lifecycle. This document serves as our primary evidence of formal feedback collection and integration.

## Formal Collection Process

To ensure feedback is actionable and measurable, our formal feedback collection process utilizes structured Google Forms distributed to early testers (comprising our peer group, potential educators, and university stakeholders). 

These forms are explicitly designed to gather two types of data:
1. **Quantitative Usability Scores**: Metrics on task completion rates, perceived difficulty, and overall satisfaction (utilizing the System Usability Scale).
2. **Qualitative Critiques**: Open-ended text fields where users are encouraged to explain friction points, design flaws, and missing features.

### Sprint 1 Feedback Metrics

> [!NOTE]
> **Quantitative Survey Results (n=12 Testers)**
> - **System Usability Scale (SUS) Score**: 68 (Slightly below average)
> - **Task Completion Rate (Create an Account)**: 100%
> - **Task Completion Rate (Navigate to Organiser Dashboard)**: 92%
> - **Aesthetic Rating**: 4/10 (The primary failure point identified)

## Evidence of Integration: The Sprint 2 UI Pivot

During the Sprint 1 review, the quantitative data showed a glaring failure in our Aesthetic Rating. We turned to the qualitative open-ended responses to diagnose the issue. 

Stakeholders and early test users overwhelmingly noted that the UI felt too much like a generic SaaS template. Specific quotes from the feedback forms included:
- *"The heavy use of drop-shadow cards makes the screen look cluttered."*
- *"It feels like a generic startup app, not a serious university portal."*
- *"The padded containers take up too much vertical space on my laptop screen, forcing me to scroll constantly."*

We evaluated this qualitative feedback rigorously during our Sprint Retrospective. Understanding that the platform needed to exude a professional, authoritative, and academic aesthetic to succeed, we made the bold decision to execute a major UI pivot in Sprint 2: 

We stripped out all card wrappers and standard borders, completely redesigning the portal into a bespoke, flat, edge-to-edge **'Syllabus' layout** with alternating color washes. This new design language perfectly aligns the platform with the authoritative, academic brand identity required by the university.

### Post-Pivot Validation
Following the UI pivot, we conducted a rapid follow-up survey with the same user group. The results validated our Agile approach:
- **Aesthetic Rating**: Increased from 4/10 to 9/10.
- **User Quote**: *"The flat, edge-to-edge layout is significantly faster to navigate and feels incredibly professional."*

This pivot serves as our primary, extensive evidence of actively evaluating and integrating user feedback into our core product design.

## Sprint 2: User Feedback (Students & Educators)

During Sprint 2, our focus shifted towards the core functionality of the platform, specifically exam taking (`examSittings`) and user onboarding (`memberships`). We conducted remote usability testing and distributed surveys to a pilot group of 20 students and 5 educators.

### 1. Educator Feedback: Roster Management
**Feedback:** Educators found that manually inputting student details to invite them to a portal was excessively tedious and error-prone, especially for classes of 30+ students.
- *Quote:* "I love the clean interface, but I cannot spend 2 hours typing in emails for my entire school. There has to be a faster way."
- **Pivot (Frontend & Backend):** We completely paused our planned work on advanced reporting to address this critical friction point. The invite form now accumulates a whole list of student email addresses — added and removed line-by-line — and submits them all in a single action, `inviteStudents`. Instead of silently skipping anyone who cannot be added, the action reports each address that was not invited back to the educator along with the reason, and when an invited student later signs up, their pending membership is claimed automatically.

### 2. Student Feedback: Exam Navigation and Anxiety
**Feedback:** During mock `examSittings`, students reported that keeping track of which questions they had answered, skipped, or flagged for review was difficult, leading to test anxiety.
- *Quote:* "I got to the end of the question paper and couldn't remember which math problem I wanted to double-check. I had to click through every single page again."
- **Pivot (Frontend):** We redesigned the exam sitting interface to include a persistent **"Quiz Navigation" side-panel**. This panel keeps the state of every question visible (unanswered, answered, and flagged) and lets students jump directly to specific questions with a single click, instead of paging through the entire paper.

### 3. Student Feedback: Network Instability
**Feedback:** Several students experienced minor network drops during testing. When they attempted to submit an answer while disconnected, the app threw an error and their input was lost, causing significant frustration.
- **Pivot (Frontend):** We overhauled how answers are submitted during a sitting with a **Local-First Caching Strategy**. As students type or select answers, the data is immediately saved to the browser's `localStorage` and queued for the server. If the network drops, the UI shows a "Working Offline" indicator and the queue is resynced as soon as the connection returns — on the browser's `online` event and whenever a new answer is saved — ensuring zero data loss.

### 4. Student & Educator Feedback: Account Recovery
**Feedback:** Testers who forgot their password hit a dead end — there was no self-service way to regain access, and asking an administrator to intervene was slow and error-prone.
- **Pivot (Frontend & Backend):** We built a complete, self-service password reset flow. The "Forgot your password?" link on the login page calls `requestPasswordReset`, which emails a time-limited recovery link; the link routes through `/auth/callback` into the `/reset-password` screen, which sets the new password and returns the user to the login page.

### 5. Educator Feedback: Picking a School
**Feedback:** During signup, testers were unsure how to identify their school, and free-typed school names produced inconsistent records (abbreviations, spelling variants) that made rostering unreliable.
- **Pivot (Frontend & Backend):** The free-text school field was replaced with a curated, debounced picker backed by the `/api/schools/suggest` endpoint — a searchable directory of South African high schools, with university search for university staff — so new accounts reference canonical school records instead of free text.

### 6. Login Feedback: Revealing the Password
**Feedback:** On the login screen, testers found they had no way to verify what they had typed — the field stayed masked with no way to check for typos before signing in.
- **Pivot (Frontend):** Every password field across the authentication screens — login, signup, and both fields on the reset-password screen — now includes a show/hide toggle (eye icon) that switches the input between masked and plain text. The control is implemented once as a shared `PasswordField` component (`src/components/PasswordField.tsx`), is keyboard-accessible, announces its state to screen readers via `aria-label` and `aria-pressed`, and never submits the form or clears what has already been typed. End-to-end tests in `tests/e2e/login.spec.ts`, `tests/e2e/signup.spec.ts`, and `tests/e2e/forgot-password.spec.ts` cover the masked → revealed → masked cycle on each screen.

## Sprint 2: Stakeholder Feedback (Organisers & University Administration)

Stakeholder feedback in Sprint 2 was gathered via bi-weekly demonstration sessions. The feedback here was largely focused on operational scaling, auditing, and grading efficiency.

### 1. Organiser Feedback: Grading at Scale
**Feedback:** Paper rounds put hundreds of physical scripts in front of markers, and a per-student online flow would have forced educators to double-capture every mark. Organisers also had no consolidated way to move an entire school's marks into the system.
- **Pivot (Frontend & Backend):** We built a bulk offline-marks workflow for paper rounds: a per-school screen lists every entrant with a single total-marks field, and the whole school's marks are saved in one action (`submitBulkOfflineMarks`). Marked physical scripts are digitised through the script-upload flow (`prepareScriptUploadAction` → `commitScriptUploadAction`), so their pages can be attached to each entrant's submission and reviewed during remarking. Online rounds gained a moderation flow (`submitMarksForModeration`), and appeals are resolved in dedicated remark screens shared by educators and organisers (`submitRemarkResolution`).

### 2. University Stakeholder Feedback: Auditable Notifications
**Feedback:** University stakeholders asked how automated communications — round opening/closing reminders, overdue-submission follow-ups, and result announcements — could be audited if an entrant claimed they were never notified.
- **Pivot (Backend):** Every automated email is now recorded in the `notification_log` table with the round, rule, recipient membership, notification kind, delivery status (`sent`/`failed`) and timestamp. A unique index on (kind, round, recipient, rule) guarantees each recipient is notified at most once per rule, so scheduled re-runs can never double-send, and the log keeps a complete audit trail of what went out, to whom, and when.

### 3. Organiser Feedback: Schools Across Multiple Olympiads
**Feedback:** Stakeholders asked how a school taking part in several olympiads over the school year would work for its educators — without re-registering staff or splitting their view of students across competitions.
- **Pivot (Database/Architecture):** School records remain per olympiad, but the educator experience is unified: the school picker lists each school once (matched by name, ignoring case and spacing) and the educator pages — dashboard, entrants, rounds, offline marks, results, remarks and standings — combine that school's rows across every olympiad it takes part in (`src/domain/educator/active-school.ts`). Roles live on per-(portal, school) memberships, so the same educator can hold different access in different olympiads.

### 4. Organiser Feedback: Adding Educators in Bulk
**Feedback:** Organisers who keep their school's educator roster in a spreadsheet had to retype every address into the invite forms one by one — workable for a handful of teachers, but error-prone for a full staff complement.
- **Pivot (Frontend):** The educator email list in both the Create Portal form and the post-creation invite-schools form now accepts a CSV upload alongside the existing manual entry. The list is implemented once as a shared `EducatorEmailsField` component (`src/components/organiser/EducatorEmailsField.tsx`), and the CSV is parsed entirely in the browser (`src/lib/csv-emails.ts`) — the file itself is never uploaded, saved or stored; only the unique email addresses it contains are merged into the invite list, with duplicates skipped and a running message reporting how many were added. Files with headers, extra columns, quotes or semicolons all work. The quick-add dialog for a school already participating in an olympiad (`AddEducatorButton`) intentionally keeps its manual-only input. Unit tests in `tests/components/organiser/EducatorEmailsField.test.tsx`, `tests/components/organiser/CreatePortalForm.test.tsx`, `tests/components/organiser/InviteSchoolForm.test.tsx` and `tests/lib/csv-emails.test.ts` pin the merge, de-duplication and submission behaviour.
