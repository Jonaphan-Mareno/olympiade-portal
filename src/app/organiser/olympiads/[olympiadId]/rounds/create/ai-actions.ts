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
    'gemini-flash-latest',
    'gemini-3.5-flash',
    'gemini-pro-latest'
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
        console.warn(`[${model}] Gemini API Error:`, errText);
        
        // If it's a 503, throw to trigger the next model in the fallback loop
        if (geminiResponse.status === 503 || geminiResponse.status === 429) {
           throw new Error(`Temporary failure on ${model} (Status: ${geminiResponse.status}). Trying next...`);
        }
        
        throw new Error(`Gemini API Error: ${errText}`);
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
      // If it's a permanent error (not a 503/429 thrown by our block above), break and throw
      if (!err.message.includes('Temporary failure')) {
        throw err;
      }
    }
  }

  // If all models failed
  if (lastError?.message?.includes('429')) {
    throw new Error('Gemini API Rate Limit Exceeded (Status 429). The provided PDFs might be too large for your current API key quota, or you are making too many requests. Please wait a minute and try again, or use smaller PDF files.');
  }

  throw new Error(`All Gemini models are currently overwhelmed or unavailable. Last error: ${lastError?.message}`);
}
