'use server';

export async function generateTestFromBase64PDF(base64Pdf: string, base64Memo?: string | null) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return { error: 'GEMINI_API_KEY is missing from your environment variables. Please add it to your deployment settings.' };
  }

  // Construct Gemini Prompt
  let prompt = `
    You are an expert exam extractor. 
    Analyze the provided PDF test paper. 
    Extract the questions into a structured format.
    Return an array of JSON objects matching this exact schema for each question:
    {
      "questionText": string, // The text of the question
      "type": "mcq" | "text", // Use "mcq" if there are multiple choice options, otherwise "text"
      "options": string[], // The multiple choice options, if applicable. If it's a text question, this should be empty.
      "marks": number, // The marks allocated to this question, if specified (default to 1 if not)
      "correctAnswer": string // The correct answer text if explicitly provided, otherwise leave empty.
    }
    Make sure your entire response is a valid JSON array.
  `;

  if (base64Memo) {
    prompt += `\nI have provided TWO PDFs. The FIRST is the Question Paper. The SECOND is the Answer Key Memo. Extract the questions from the first PDF and use the second PDF to precisely determine the exact 'correctAnswer' for every single question for auto-marking.`;
  }

  const parts: any[] = [
    { text: prompt },
    {
      inlineData: {
        mimeType: 'application/pdf',
        data: base64Pdf,
      },
    },
  ];

  if (base64Memo) {
    parts.push({
      inlineData: {
        mimeType: 'application/pdf',
        data: base64Memo,
      },
    });
  }

  const modelsToTry = [
    'gemini-3.8-flash',
    'gemini-flash-latest',
    'gemini-3.5-flash'
  ];

  let lastError = null;

  for (const model of modelsToTry) {
    try {
      const geminiEndpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

      const geminiResponse = await fetch(geminiEndpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          contents: [
            {
              parts,
            },
          ],
          generationConfig: {
            responseMimeType: 'application/json',
            responseSchema: {
              type: "ARRAY",
              items: {
                type: "OBJECT",
                properties: {
                  questionText: { type: "STRING" },
                  type: { type: "STRING" },
                  options: {
                    type: "ARRAY",
                    items: { type: "STRING" }
                  },
                  marks: { type: "INTEGER" },
                  correctAnswer: { type: "STRING" }
                },
                required: ["questionText", "type", "marks"]
              }
            }
          },
        }),
      });

      if (!geminiResponse.ok) {
        const errText = await geminiResponse.text();
        console.warn(`[${model}] Gemini API Error (${geminiResponse.status}):`, errText);
        throw new Error(`[${model}] Error ${geminiResponse.status}: ${errText}`);
      }

      const geminiData = await geminiResponse.json();
      const textOutput = (geminiData?.candidates?.[0]?.content?.parts ?? [])
        .filter((p: any) => typeof p.text === 'string' && !p.thought)
        .map((p: any) => p.text)
        .join('');
      if (!textOutput) {
        throw new Error('Invalid response from LLM.');
      }

      // Parse
      const extractedQuestions = JSON.parse(textOutput);
      if (!Array.isArray(extractedQuestions)) {
        throw new Error('LLM did not return an array of questions.');
      }

      if (extractedQuestions.length === 0) {
        throw new Error('LLM could not find any questions in the PDF.');
      }

      const formattedQuestions = extractedQuestions.map((q: any) => {
        const isMcq = q.type === 'mcq';
        const options: string[] = Array.isArray(q.options) ? q.options.map(String) : (isMcq ? ['Option 1'] : []);

        // The builder matches the correct answer against option text exactly, so
        // map things like "B" or differently-cased text onto the real option.
        let correctAnswer: string | null = q.correctAnswer ? String(q.correctAnswer).trim() : null;
        if (isMcq && correctAnswer) {
          const exact = options.find((o) => o === correctAnswer);
          const ci = options.find((o) => o.trim().toLowerCase() === correctAnswer!.toLowerCase());
          const letterIdx = /^[A-Za-z][.)]?$/.test(correctAnswer)
            ? correctAnswer.toUpperCase().charCodeAt(0) - 65
            : -1;
          correctAnswer = exact ?? ci ?? (letterIdx >= 0 && letterIdx < options.length ? options[letterIdx] : null);
        }

        return {
          id: crypto.randomUUID(), // for QuestionBuilder keys
          type: isMcq ? 'single_choice' : 'free_text',
          prompt: q.questionText || 'Unknown question',
          marks: q.marks || 1,
          // Difficulty is organiser-assigned (1-5) and drives the balanced
          // online draw, so the AI must NOT guess it. Leave it null; the
          // PublishReadinessPanel surfaces it as "needs a difficulty".
          difficulty: null,
          options: isMcq ? options : null,
          correctAnswer: isMcq ? correctAnswer : (correctAnswer ?? ''),
        };
      });

      return { data: formattedQuestions };

    } catch (err: any) {
      lastError = err;
      // Try next model if one model fails
      continue;
    }
  }

  return { error: `Gemini test generation failed across all models. Last error: ${lastError?.message || lastError}` };
}
