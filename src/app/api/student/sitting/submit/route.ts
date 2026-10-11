import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { db } from '@/lib/db';
import {
  examSittings,
  memberships,
  questionPapers,
  submissions,
  studentAnswers,
  results,
} from '@/lib/db/schema';
import { and, eq } from 'drizzle-orm';
import { calculateEarnedMarks, reassembleAnswers } from '@/domain/marking/auto-mark';
import { loadSittingQuestions } from '@/domain/question-bank/load-variant';
import { getRoundTotalMarks } from '@/domain/rounds/score-percentage';

export async function POST(request: Request) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { sittingId } = await request.json();
    if (!sittingId) return NextResponse.json({ error: 'Missing sittingId' }, { status: 400 });

    // 1. Fetch the exam sitting and paper details
    const [sittingData] = await db
      .select({
        sitting: examSittings,
        paper: questionPapers,
        membershipId: memberships.id,
      })
      .from(examSittings)
      .innerJoin(memberships, eq(memberships.id, examSittings.studentMembershipId))
      .innerJoin(questionPapers, eq(questionPapers.id, examSittings.questionPaperId))
      .where(and(eq(examSittings.id, sittingId), eq(memberships.userId, user.id)))
      .limit(1);

    if (!sittingData) return NextResponse.json({ error: 'Sitting not found' }, { status: 404 });
    if (sittingData.sitting.status !== 'active') return NextResponse.json({ success: true });

    // 2. Mark the test sitting as submitted
    await db
      .update(examSittings)
      .set({ status: 'submitted', endedAt: new Date() })
      .where(eq(examSittings.id, sittingId));

    // 3. Fetch all saved answers for this sitting
    const savedAnswers = await db
      .select()
      .from(studentAnswers)
      .where(eq(studentAnswers.sittingId, sittingId));

    // Build lookup map: questionId -> student's answerValue
    const rawAnswers: Record<string, string> = {};
    for (const ans of savedAnswers) {
      if (ans.questionId) {
        rawAnswers[ans.questionId] = ans.answerValue;
      }
    }

    // Reassemble before anything reads an answer by `q.id`: a matching question
    // is stored as ONE row under its base uuid whose value is the aggregated
    // JSON object of pair selections, but legacy/practice payloads can hold one
    // entry per pair under the composite key `${q.id}_${index}`. Folding those
    // back into the base id is what lets the marker reach the matching branch at
    // all — looking up `answersObj[q.id]` on composite keys returns undefined
    // and silently scores every matching question 0.
    const answersObj = reassembleAnswers(rawAnswers);

    // 4. Find-or-create the submission row, race-safe against the unique
    // (student_membership_id, round_id) index.
    const roundId = sittingData.paper.roundId;
    const membershipId = sittingData.membershipId;

    const [existingSubmission] = await db
      .select()
      .from(submissions)
      .where(
        and(
          eq(submissions.studentMembershipId, membershipId),
          eq(submissions.roundId, roundId)
        )
      )
      .limit(1);

    // FIRST IS FINAL. A hybrid round can be marked offline by an educator before
    // (or while) the entrant submits online. If a submitted record already
    // exists for this entrant+round it is authoritative: never overwrite its
    // answers, its submissionType or its mark. The sitting was already flagged
    // submitted above, so there is nothing left to do here.
    if (existingSubmission && existingSubmission.status === 'submitted') {
      return NextResponse.json({ success: true });
    }

    // Denormalize the dealt variant onto the submission so results, review and
    // remarks pages can scope to it without joining back to the sitting.
    const variantQuestionIds = sittingData.sitting.variantQuestionIds ?? null;

    let submissionId = existingSubmission?.id;

    if (!existingSubmission) {
      // ON CONFLICT DO NOTHING against submissions_student_round_uniq: if a
      // concurrent writer (another submit, or the offline-marks action) created
      // the row between the SELECT above and this INSERT, we lose the race and
      // their record is final — return without marking rather than duplicating
      // or clobbering it.
      const [newSub] = await db
        .insert(submissions)
        .values({
          studentMembershipId: membershipId,
          roundId,
          status: 'submitted',
          submissionType: 'online',
          startedAt: sittingData.sitting.startedAt,
          submittedAt: new Date(),
          answersJson: answersObj,
          variantQuestionIds,
        })
        .onConflictDoNothing()
        .returning({ id: submissions.id });

      if (!newSub) {
        return NextResponse.json({ success: true });
      }
      submissionId = newSub.id;
    } else {
      // A pre-existing draft (not yet submitted): finalize it in place.
      await db
        .update(submissions)
        .set({
          status: 'submitted',
          submittedAt: new Date(),
          answersJson: answersObj,
          variantQuestionIds,
        })
        .where(eq(submissions.id, existingSubmission.id));
    }

    // 5. Automarking over the dealt variant only: loadSittingQuestions scopes to
    // sitting.variantQuestionIds (falling back to the whole pool for legacy
    // sittings), so answers to out-of-variant questions can never be scored.
    // Free-text stays educator-marked and out of the auto-markable subtotal.
    if (submissionId) {
      const variantQuestions = await loadSittingQuestions(
        { variantQuestionIds: sittingData.sitting.variantQuestionIds as string[] | null },
        sittingData.paper.roundId
      );

      let totalScore = 0;
      let autoMarkable = 0;

      for (const q of variantQuestions) {
        if (q.questionType === 'free_text') continue; // Do not include educator-marked questions in the auto-marked subtotal

        autoMarkable += q.marks ?? 1;

        // Matching questions resolve to their aggregated pair payload here (see
        // reassembleAnswers above), so calculateEarnedMarks reaches its matching
        // branch and awards proportional credit instead of 0.
        const studentAns = answersObj[q.id];
        totalScore += calculateEarnedMarks(q, studentAns);
      }

      // Matching awards fractional marks (correctPairs / totalPairs * marks);
      // keep two decimals so results.score stays readable and matches the
      // rounding the remark workflow applies.
      totalScore = Math.round(totalScore * 100) / 100;

      // The single grading denominator is the round's fixed target total, so
      // different variants remain directly comparable. Fall back to the
      // auto-markable subtotal only when no target/pool total is known.
      const totals = await getRoundTotalMarks([sittingData.paper.roundId]);
      const denominator = totals.get(sittingData.paper.roundId) ?? autoMarkable;

      // 6. Record or update the grade in the results table
      const [existingResult] = await db
        .select()
        .from(results)
        .where(eq(results.submissionId, submissionId))
        .limit(1);

      const resultPayload = {
        submissionId,
        score: totalScore.toString(),
        // The numerator is the provisional auto-marked total (free-text is still
        // educator-marked); the denominator is the round's whole target total,
        // the same one the review page, standings and advancement use — so the
        // feedback fraction reads "marks so far out of the paper's total" and
        // rises once an educator grades the written questions.
        feedback: `Auto-marked: ${totalScore} / ${denominator}`,
        status: 'auto_marked' as const,
      };

      if (!existingResult) {
        await db.insert(results).values(resultPayload);
      } else {
        await db
          .update(results)
          .set(resultPayload)
          .where(eq(results.id, existingResult.id));
      }
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error submitting sitting:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}