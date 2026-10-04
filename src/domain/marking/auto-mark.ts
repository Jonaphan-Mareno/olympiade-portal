// The single source of truth for auto-marking an online answer. Used when a
// sitting is submitted, when an educator's moderation re-totals a script,
// and on the student's paper review — so the per-question marks a student
// sees always add up to the score that was stored.

/**
 * Marks earned for one auto-marked question. Free-text questions are
 * marked by educators and always return 0 here.
 */
export function calculateEarnedMarks(
  q: any,
  studentAnsRaw: string | undefined | null
): number {
  const maxMarks = q.marks ?? 1;
  if (q.questionType === 'free_text') return 0; // Handled by educators
  if (!studentAnsRaw) return 0;

  if (q.questionType === 'matching') {
     let studentAnsObj: any = {};
     try { studentAnsObj = JSON.parse(studentAnsRaw); } catch {}
     if (typeof studentAnsObj !== 'object') return 0;

     let correctPairs = 0;
     let totalPairs = 0;
     if (Array.isArray(q.options)) {
        q.options.forEach((opt: any, index: number) => {
           totalPairs++;
           if (studentAnsObj[`${q.id}_${index}`] === opt.response) {
               correctPairs++;
           }
        });
     }
     if (totalPairs === 0) return 0;
     return (correctPairs / totalPairs) * maxMarks;
  }

  // Common correct answer normalization
  let correctSelections: string[] = [];
  const strCorrect = typeof q.correctAnswer === 'string' || typeof q.correctAnswer === 'number' || typeof q.correctAnswer === 'boolean' ? String(q.correctAnswer) : '';
  try {
      const parsed = JSON.parse(strCorrect);
      correctSelections = Array.isArray(parsed) ? parsed.map(String) : [String(parsed)];
  } catch {
      if (!strCorrect.startsWith('[')) {
          correctSelections = strCorrect.split(',').map((s: string) => s.trim()).filter(Boolean);
      } else {
          correctSelections = [strCorrect];
      }
  }
  if (Array.isArray(q.correctAnswer)) {
      correctSelections = q.correctAnswer.map(String);
  } else if (typeof q.correctAnswer === 'object' && q.correctAnswer !== null && (q.correctAnswer as any).text !== undefined) {
      correctSelections = [String((q.correctAnswer as any).text)];
  }

  const studentSelections = parseStudentSelections(q, studentAnsRaw);

  if (q.questionType === 'multiple_choice') {
      const totalCorrect = correctSelections.length;
      if (totalCorrect === 0) return 0;
      let matches = 0;
      studentSelections.forEach(s => {
          if (correctSelections.includes(s)) matches++;
      });
      return (matches / totalCorrect) * maxMarks;
  }

  // single_choice or true_false
  const isCorrect = correctSelections.length === 1 && studentSelections.length === 1 && correctSelections[0] === studentSelections[0];
  if (isCorrect) return maxMarks;
  
  const studentStr = studentSelections.join(',').toLowerCase();
  const correctStr = correctSelections.join(',').toLowerCase();
  if (studentStr === correctStr) return maxMarks;

  return 0;
}

/**
 * A student's selections for a question. Answers may be a JSON array (the
 * practice interface) or, for multi-select questions in the real exam, a
 * comma-joined string such as "He likes lasagna,his humans name is John".
 * Comma-joined answers are matched against the question's options so an
 * option that itself contains a comma is still recognised.
 */
function parseStudentSelections(q: any, raw: string): string[] {
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed.map(String);
    return [String(raw)];
  } catch {
    // not JSON — fall through
  }

  if (q.questionType !== 'multiple_choice') return [raw];

  const options: string[] = Array.isArray(q.options) ? q.options.map(String) : [];
  const padded = `,${raw},`;
  const matched = options.filter((opt) => padded.includes(`,${opt},`));
  if (matched.length > 0) return matched;
  return raw.split(',').map((s) => s.trim()).filter(Boolean);
}
