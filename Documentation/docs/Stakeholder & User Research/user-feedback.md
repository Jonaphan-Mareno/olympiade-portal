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
- **Pivot (Frontend & Backend):** We completely paused our planned work on advanced reporting to address this critical friction point. We implemented a **CSV Bulk Upload** feature. On the frontend, we added a drag-and-drop file parser using PapaParse that validates emails in the browser. On the backend, we introduced a batch insertion endpoint for the `users` and `memberships` tables, reducing a 2-hour task to under 30 seconds.

### 2. Student Feedback: Exam Navigation and Anxiety
**Feedback:** During mock `examSittings`, students reported that keeping track of which questions they had answered, skipped, or flagged for review was difficult, leading to test anxiety.
- *Quote:* "I got to the end of the question paper and couldn't remember which math problem I wanted to double-check. I had to click through every single page again."
- **Pivot (Frontend):** We redesigned the exam sitting interface to include a persistent, sticky **"Question Navigator" side-panel**. This panel dynamically updates the state of each question (gray for unvisited, blue for answered, and yellow for flagged), allowing students to jump directly to specific questions with a single click.

### 3. Student Feedback: Network Instability
**Feedback:** Several students experienced minor network drops during testing. When they attempted to submit an answer while disconnected, the app threw an error and their input was lost, causing significant frustration.
- **Pivot (Frontend & Backend):** We overhauled the `studentAnswers` submission architecture. We introduced a **Local-First Caching Strategy**. As students type or select answers, the data is immediately saved to the browser's `localStorage` or `IndexedDB`. A background sync worker attempts to push to the server. If the network drops, the UI shows a "Working Offline" indicator and quietly syncs the queued answers once the connection is restored, ensuring zero data loss.

## Sprint 2: Stakeholder Feedback (Organisers & University Administration)

Stakeholder feedback in Sprint 2 was gathered via bi-weekly demonstration sessions. The feedback here was largely focused on operational scaling, auditing, and grading efficiency.

### 1. Organiser Feedback: Grading Bottlenecks
**Feedback:** The initial grading flow required organizers to open a student's `submission`, grade it, and then go back to a list to select the next student. For open-ended questions in large `questionPapers`, this context-switching was deemed unacceptable.
- *Quote:* "If I have 500 essays to grade for Question 4, I want to read all 500 essays back-to-back. I don't want to see the rest of the student's exam."
- **Pivot (Frontend):** We pivoted our dashboard roadmap to build a **"Speed Grader" view**. Instead of grouping by student, this view queries the database to group all `studentAnswers` by `questionId`. Organizers can now rapidly cycle through all submissions for a single question using keyboard shortcuts, drastically reducing grading time. 

### 2. University Admin Feedback: Audit Trails and Logs
**Feedback:** The University Administration expressed concerns regarding the `notificationLog`. As the platform scales, they need to ensure communications (exam reminders, result publications) can be audited if a student claims they were never notified. The current log was a flat, unfilterable list.
- **Pivot (Backend):** We restructured the `notificationLog` schema to be highly structured. We added indexed columns for `notificationType` (e.g., 'system', 'exam-reminder', 'result-published', 'security') and `deliveryStatus`. We then built an Admin Audit Dashboard that allows university staff to filter millions of logs by date range, user ID, and type in milliseconds, satisfying their strict compliance requirements.

### 3. Organiser Feedback: Granular Access Control
**Feedback:** The permissions model was too rigid. Stakeholders wanted to invite external university auditors to view `results` and `submissions` to verify fairness, but without giving them full organiser rights to modify data or create new `rounds`.
- **Pivot (Backend/Database):** We undertook a significant refactor of the Role-Based Access Control (RBAC) system. We updated the `memberships` schema to support custom, granular permission levels within a `portal`. We introduced a new **'Auditor' role** and implemented strict middleware checks on all API routes, ensuring Auditors have read-only access to specific resources, thereby solving a major compliance blocker for the university stakeholders.
