'use server';

export async function generateTestFromBase64PDF(base64Pdf: string, base64Memo?: string | null) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY is missing from the environment variables.');
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
    'gemini-2.5-flash',
    'gemini-2.5-flash-lite',
    'gemini-3.5-flash',
    'gemini-2.5-pro'
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
      const textOutput = geminiData?.candidates?.[0]?.content?.parts?.[0]?.text;
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

      return extractedQuestions.map((q: any) => ({
        id: crypto.randomUUID(), // for QuestionBuilder keys
        type: q.type === 'mcq' || q.type === 'text' ? (q.type === 'mcq' ? 'single_choice' : 'short_text') : 'short_text',
        prompt: q.questionText || 'Unknown question',
        marks: q.marks || 1,
        options: Array.isArray(q.options) ? q.options : (q.type === 'mcq' ? ['Option 1'] : []),
        correctAnswer: q.correctAnswer || null,
      }));

    } catch (err: any) {
      lastError = err;
      // Try next model if one model fails
      continue;
    }
  }

  throw new Error(`Gemini test generation failed across all models. Last error: ${lastError?.message || lastError}`);
}
