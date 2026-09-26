# Feature Documentation

The Olympiad Portal is a comprehensive platform designed to manage the entire lifecycle of academic competitions. This document provides an overview of the core features and how they are implemented technically.

## 1. Portal & Organizer Management
- **Portals**: The highest level of organization. An organizing body (e.g., "National Science Foundation") creates a Portal, which acts as a container for all their competitions (Olympiads).
- **Organizer Applications**: Users can apply to become organizers by uploading necessary documentation (e.g., PDFs). Platform admins review and approve these applications.

## 2. Competition Rounds
Competitions are structured into **Rounds**, which represent distinct phases (e.g., First Round, Finals). 
- **Delivery Methods**: Rounds can be configured for `online` or `offline` delivery.
- **Scheduling**: Rounds have strict `opensAt` and `closesAt` timestamps, which dictate when students can participate.
- **Qualifying Thresholds**: Organizers can set thresholds to automatically determine which students advance to the next round.

## 3. Online Examination Engine
The platform includes a robust online testing environment:
- **Question Banks**: Organizers can create varied question types (multiple choice, free text, matching, etc.) and assign marks.
- **Exam Sittings**: When a student starts an online exam, a secure `exam_sitting` session is created.
- **Auto-Saving**: As students progress, their answers are continuously synced to the server to prevent data loss.
- **Auto-Marking**: Upon submission or when the round closes, the system automatically grades the student's answers against the configured answer key.

## 4. Offline Exams & Manual Grading
For offline rounds, the platform supports manual processing:
- **Document Uploads**: Educators or students can upload scanned answer sheets.
- **Manual Grading**: Organizers can manually input scores and provide feedback for these submissions.

## 5. Results & Leaderboards
- **Result Publishing**: Organizers have full control over when results are released to the public.
- **Public Leaderboards**: Once published, anonymous leaderboards are exposed via the Public API, allowing external sites to display top performers without compromising student privacy.
- **Remarks/Appeals**: The system supports tracking requests for remarks and logging the outcome.

## 6. Automated Certificate Generation
- **Custom Templates**: Organizers can upload PDF templates for certificates and configure where the student's name should be drawn (X/Y coordinates, font size, and color).
- **Tiered Awards**: Multiple templates can be assigned to a single round based on score thresholds (e.g., Gold for >90%, Silver for >75%).
- **On-Demand Generation**: Certificates are dynamically generated on the fly using `pdf-lib` when a student or educator requests them.

## 7. Role-Based Access Control & Memberships
Authentication is handled by Supabase Auth, but authorization is managed by a granular `memberships` table.
- **Roles**: Users can hold different roles (e.g., `admin`, `educator`, `student`) within different contexts (Portals and Schools).
- **Invitations**: Organizers can invite schools to participate, generating secure invite tokens that educators can claim to join a Portal.

## 8. Notifications & Automations
- **Round Scheduler**: A cron job (Vercel Cron) routinely checks round states and triggers state changes (e.g., opening a round, closing it, or publishing results).
- **Email Notifications**: Automated emails are sent out to educators and students regarding upcoming rounds, results, and invitations.
- **In-App Notifications**: Users receive persistent alerts within the portal dashboard for important events.
- **Automation Rules**: Organizers can configure custom event-driven rules to trigger specific actions (like sending custom emails) based on portal activity.

## 9. Public API
A fully open, CORS-enabled Public API allows external platforms to integrate with the Olympiad Portal. It exposes directories of participating schools, available portals, upcoming rounds, and anonymized results.
