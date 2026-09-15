# Sprint 2 Bug Migration Tracker

This document serves as a staging area for migrating informally tracked bugs into our official Gitea issue tracker. The bugs documented below were identified and resolved during Sprint 2.

---

### Bug 1: Image Hydration Data Loss
- **Severity**: High
- **Description**: The `QuestionBuilder.tsx` component failed to preserve the `imageUrl` in local React state when re-opening an existing round from the database. Consequently, when the user saved the round again without modifying the image, the database overwrote the existing image URL with `null`, resulting in data loss.
- **Steps to Reproduce**:
  1. Create a question with an image upload.
  2. Save the round.
  3. Re-open the round from the dashboard.
  4. Save the round again without touching the image field.
  5. Check the database; the `imageUrl` is now `null`.
- **Resolution / Commit**: Fixed local state initialization in the `useEffect` hook of `QuestionBuilder.tsx` to properly hydrate the `imageUrl` from the initial props. (Commit: `fix: preserve imageUrl in QuestionBuilder state`)

### Bug 2: Global Viewport Overscroll
- **Severity**: Low
- **Description**: Bouncing past the top or bottom of the page (viewport overscroll/rubber-banding) on macOS/trackpads revealed unstyled black default backgrounds from the `<body>` tag. This broke the application immersion and the custom 'Syllabus' UI aesthetic.
- **Steps to Reproduce**:
  1. Open the application on a macOS device.
  2. Scroll aggressively past the top or bottom bounds of the document.
  3. Observe the black unstyled background behind the main Next.js wrapper.
- **Resolution / Commit**: Applied Tailwind background utility classes (`bg-stone-50`) directly to the `<body>` and `<html>` tags in `app/layout.tsx` to ensure visual continuity during overscroll. (Commit: `style: fix global overscroll background color`)

### Bug 3: Invite Button Accessibility
- **Severity**: Medium
- **Description**: The '+ Invite School' button had a severe accessibility contrast issue. Hovering over the button caused the background to turn white via Tailwind hover states (`hover:bg-white`), but the text remained white, rendering the label entirely invisible.
- **Steps to Reproduce**:
  1. Navigate to the Organiser Dashboard.
  2. Hover the mouse over the '+ Invite School' primary button.
  3. Observe that the text disappears against the white background.
- **Resolution / Commit**: Updated the button's Tailwind classes to apply a dark text color on hover (`hover:text-slate-900`) alongside the white background transition. (Commit: `fix: invite button hover contrast visibility`)

### Bug 4: Dead Routing on Invite Actions
- **Severity**: High
- **Description**: The primary '+ Invite School' dashboard button was completely unlinked. Clicking the button did not trigger any Next.js router events, failing to route the organizer to the critical `/invite` flow.
- **Steps to Reproduce**:
  1. Navigate to the Organiser Dashboard.
  2. Click the '+ Invite School' button.
  3. Observe that the URL does not change and no action occurs.
- **Resolution / Commit**: Wrapped the button in a Next.js `<Link>` component pointing to the `/organiser/[portalId]/invite` dynamic route. (Commit: `fix: link dashboard invite button to invite flow`)

### Bug 5: Redundant Form Management State
- **Severity**: Low
- **Description**: The 'Participating Schools' data grid rendered unnecessary 'Manage' action links for school entities that were already in a 'dispatched' or read-only state. This caused UX confusion as clicking 'Manage' on these entities led to a disabled form.
- **Steps to Reproduce**:
  1. Navigate to the Participating Schools list.
  2. Locate a school invitation that has already been dispatched/accepted.
  3. Observe the presence of an active 'Manage' link.
- **Resolution / Commit**: Implemented conditional rendering in the data grid component to only show the 'Manage' link if the `status` enum equals `PENDING`. (Commit: `fix: hide manage link for read-only entities`)

### Bug 6: Destructive Action Ambiguity
- **Severity**: Critical
- **Description**: The 'Delete Portal' action in the settings menu lacked high-contrast destructive styling (it looked like a standard action button). Furthermore, executing the deletion at the application layer failed to cascade, potentially leaving orphaned rounds and users in the PostgreSQL database.
- **Steps to Reproduce**:
  1. Navigate to Portal Settings.
  2. Click 'Delete Portal' (Note lack of red/destructive UI cues).
  3. Check the database; dependent rows in `rounds` and `memberships` remain orphaned.
- **Resolution / Commit**: Updated the button UI with `bg-red-600`. Executed a Supabase database migration to add `ON DELETE CASCADE` constraints to the `portalId` foreign keys across all dependent tables to ensure strict data integrity. (Commit: `fix: destructive portal UI and cascade deletes`)

### Bug 7: Hidden Input Serialization
- **Severity**: High
- **Description**: The question creation form failed to properly serialize dynamic arrays containing media URLs. When passing the complex FormData to the Next.js Server Action, the array of URLs was stringified incorrectly (as `[object Object]`), causing the database insert to fail silently.
- **Steps to Reproduce**:
  1. Create a new question.
  2. Attach multiple images (creating a media array).
  3. Submit the form.
  4. Observe that the Server Action receives corrupted string data instead of a valid array.
- **Resolution / Commit**: Implemented `JSON.stringify()` on the media array before appending it to the `FormData` object on the client, and parsed it accordingly inside the Server Action using `zod`. (Commit: `fix: serialize media array for server actions`)
