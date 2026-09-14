# Sprint 2 Tracker & Retrospective

## Sprint Goals
For Sprint 2, our primary objectives were to expand the core functionality of the Organiser Portal and address critical feedback received during the Sprint 1 review. The specific technical goals included:
- Implementing dynamic school invitations for Olympiads.
- Building an advanced question builder featuring image uploads for complex examination papers.
- Executing a major UI/UX pivot based on stakeholder feedback.

## Delivered Work

### Technical Features
1. **Dynamic School Invitations**: Successfully implemented the invitation flow, allowing organisers to dynamically search for and invite schools to participate in Olympiad rounds.
2. **Advanced Question Builder**: Developed a robust interface for creating various question types (multiple choice, true/false, free text) with support for image attachments, crucial for diagram-based questions.

### The UI Pivot (Addressing Feedback)
During the Sprint 1 review, stakeholders and early test users noted that the UI felt too much like a generic SaaS template, specifically citing the heavy use of drop-shadow cards and padded containers as clunky. We evaluated this feedback and executed a major UI pivot in Sprint 2: we stripped out all card wrappers and standard borders, completely redesigning the portal into a bespoke, flat, edge-to-edge 'Syllabus' layout with alternating color washes. This aligns the platform with the authoritative, academic brand identity required by the university.

## Retrospective
- **What went well**: The team adapted rapidly to the major UI pivot, demonstrating strong agility. The integration of image uploads in the question builder went smoothly.
- **What to improve**: Testing coverage needs to be maintained as we rapidly iterate on UI changes. We will prioritize Playwright E2E tests for the new Syllabus layout in Sprint 3.

## Methodology Adjustments

We identified a process failure during Sprint 2 where technical bugs were being tracked informally via developer communication channels rather than the official Gitea board. During our sprint retrospective, we recognized this as a deviation from proper Agile methodology. To establish a single source of truth and correct this for Sprint 3, we have formally migrated all Sprint 2 resolved bugs into the Gitea tracker, assigning them to the relevant developers and linking the commit hashes that resolved them.
