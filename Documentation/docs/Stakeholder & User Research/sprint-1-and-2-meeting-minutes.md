# Stakeholder Meeting Minutes

This document tracks formal interactions with our primary stakeholder (the University Product Owner) to provide evidence of Agile methodology execution and feedback integration.

## Sprint 1 Review Meeting

**Date**: 2026-08-30
**Attendees**: Development Team, Client/Product Owner
**Focus**: Review of the MVP Authentication Flow and basic Dashboard scaffolding.

### Client Feedback & Action Items

| Feedback | Priority | Action Taken (Sprint 2) |
| :--- | :--- | :--- |
| **Authentication Form**: The client noted that the split between "Educator" and "Student" signup felt clunky and requested a unified form with a role selector. | High | **Integrated**: We refactored `app/signup/page.tsx` to handle dynamic role switching internally, tracked in Gitea Issue #42. |
| **Organiser Dashboard**: Client requested that the Olympiad Portals list be more visually distinct, perhaps using cards instead of a raw data table. | Medium | **Integrated**: Upgraded the portal list UI to use Tailwind CSS grid cards with hover effects in `app/organiser/page.tsx` (Issue #45). |
| **Bug Found**: User sessions occasionally dropped on hard refresh due to middleware configuration. | Severe | **Resolved**: Updated `middleware.ts` to properly handle Supabase auth token refreshing (Issue #48). |

## Sprint 2 Mid-Sprint Check-in

**Date**: 2026-09-06
**Attendees**: Development Team, Client/Product Owner
**Focus**: Walkthrough of the Organiser's "Create Round" flow.

### Client Feedback & Action Items

| Feedback | Priority | Action Taken (Sprint 2) |
| :--- | :--- | :--- |
| **Round Delivery**: The client pointed out that many rural schools still require paper-based exams. The system currently assumed all rounds were online. | High | **Integrated**: We altered the database schema (`drizzle-kit migration`) to add a `deliveryMethod` enum to the `rounds` table, and updated the UI forms accordingly (Issue #51). |
| **404 Error on Creation**: A routing bug caused the app to 404 when navigating immediately after creating a round. | Severe | **Resolved**: Fixed the Next.js `revalidatePath` and redirect logic in the `createRound` Server Action (Issue #57). |

---

*Note: These minutes demonstrate that our development is directly driven by client requirements and validated through regular agile ceremonies.*
