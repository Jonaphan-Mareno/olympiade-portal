'use client';

import { useState } from 'react';

export interface QuestionType {
  id: string; // purely for local keying
  type: string;
  prompt: string;
  marks: number | string;
  options: any; // array of strings for choices, or array of pairs for matching
  correctAnswer: any; // string, array of strings, or text
  imageUrl?: string | null;
}

export default function QuestionBuilder({
  initialQuestions,
}: {
  initialQuestions?: QuestionType[];
}) {
  const [questions, setQuestions] = useState<QuestionType[]>(
    initialQuestions && initialQuestions.length > 0
      ? initialQuestions
      : [
          {
            id: crypto.randomUUID(),
            type: 'single_choice',
            prompt: '',
            marks: '',
            options: ['Option 1'],
            correctAnswer: 'Option 1',
          },
        ]
  );

  const [imagePreviews, setImagePreviews] = useState<Record<string, string>>(
    () => {
      const initial: Record<string, string> = {};
      if (initialQuestions) {
        initialQuestions.forEach((q) => {
          if (q.imageUrl) {
            initial[q.id] = q.imageUrl;
          }
        });
      }
      return initial;
    }
  );

  const updateQuestion = (id: string, updates: Partial<QuestionType>) => {
    setQuestions(
      questions.map((q) => (q.id === id ? { ...q, ...updates } : q))
    );
  };

  const handleImageChange = (qId: string, file: File | null) => {
    setImagePreviews((prev) => {
      const next = { ...prev };
      if (file) {
        next[qId] = URL.createObjectURL(file);
      } else {
        delete next[qId];
      }
      return next;
    });

    if (!file) {
      updateQuestion(qId, { imageUrl: null });
    }
  };

  const addQuestion = () => {
    setQuestions([
      ...questions,
      {
        id: crypto.randomUUID(),
        type: 'single_choice',
        prompt: '',
        marks: '',
        options: ['Option 1'],
        correctAnswer: 'Option 1',
      },
    ]);
  };

  const removeQuestion = (id: string) => {
    setQuestions(questions.filter((q) => q.id !== id));
  };

  // Helper for single/multiple choice options
  const updateOption = (qId: string, optIndex: number, newValue: string) => {
    const q = questions.find((x) => x.id === qId);
    if (!q) return;
    const newOptions = [...q.options];
    newOptions[optIndex] = newValue;

    // If it was the correct answer (single choice), update it too so it doesn't get lost
    let newCorrect = q.correctAnswer;
    if (q.type === 'single_choice' && q.correctAnswer === q.options[optIndex]) {
      newCorrect = newValue;
    } else if (q.type === 'multiple_choice' && Array.isArray(q.correctAnswer)) {
      newCorrect = q.correctAnswer.map((ans: string) =>
        ans === q.options[optIndex] ? newValue : ans
      );
    }

    updateQuestion(qId, { options: newOptions, correctAnswer: newCorrect });
  };

  const addOption = (qId: string) => {
    const q = questions.find((x) => x.id === qId);
    if (!q) return;
    updateQuestion(qId, {
      options: [...q.options, `Option ${q.options.length + 1}`],
    });
  };

  const removeOption = (qId: string, optIndex: number) => {
    const q = questions.find((x) => x.id === qId);
    if (!q) return;
    const newOptions = [...q.options];
    newOptions.splice(optIndex, 1);
    updateQuestion(qId, { options: newOptions });
  };

  // Helper for matching pairs
  const addPair = (qId: string) => {
    const q = questions.find((x) => x.id === qId);
    if (!q) return;
    updateQuestion(qId, {
      options: [...(q.options || []), { premise: '', response: '' }],
    });
  };

  const updatePair = (
    qId: string,
    pairIndex: number,
    field: 'premise' | 'response',
    value: string
  ) => {
    const q = questions.find((x) => x.id === qId);
    if (!q) return;
    const newOptions = [...q.options];
    newOptions[pairIndex] = { ...newOptions[pairIndex], [field]: value };
    updateQuestion(qId, { options: newOptions });
  };

  const removePair = (qId: string, pairIndex: number) => {
    const q = questions.find((x) => x.id === qId);
    if (!q) return;
    const newOptions = [...q.options];
    newOptions.splice(pairIndex, 1);
    updateQuestion(qId, { options: newOptions });
  };

  // Handle type change
  const handleTypeChange = (id: string, newType: string) => {
    let defaultOptions: any = [];
    let defaultCorrect: any = null;

    if (newType === 'single_choice') {
      defaultOptions = ['Option 1', 'Option 2'];
      defaultCorrect = 'Option 1';
    } else if (newType === 'multiple_choice') {
      defaultOptions = ['Option 1', 'Option 2'];
      defaultCorrect = ['Option 1'];
    } else if (newType === 'true_false') {
      defaultOptions = ['True', 'False'];
      defaultCorrect = 'True';
    } else if (newType === 'matching') {
      defaultOptions = [{ premise: 'Item 1', response: 'Match 1' }];
      defaultCorrect = null; // matching relies on options mapping
    } else if (newType === 'free_text') {
      defaultOptions = null;
      defaultCorrect = ''; // can be used for memo/rubric
    }

    updateQuestion(id, {
      type: newType,
      options: defaultOptions,
      correctAnswer: defaultCorrect,
    });
  };

  return (
    <div className="space-y-6">
      {questions.map((q, idx) => (
        <div key={q.id} className="bg-blue-50 rounded-md p-6">
          <div className="flex justify-between items-center mb-4">
            <h4 className="text-lg font-semibold text-slate-800">
              Question {idx + 1}
            </h4>
            <button
              type="button"
              onClick={() => removeQuestion(q.id)}
              className="text-red-600 hover:text-red-700 text-sm font-medium"
            >
              Remove
            </button>
          </div>

          <div className="flex flex-col md:flex-row gap-4 mb-4">
            <div className="flex-1">
              <label className="block text-sm font-semibold text-slate-900 mb-1">
                Type
              </label>
              <select
                value={q.type}
                onChange={(e) => handleTypeChange(q.id, e.target.value)}
                className="w-full p-2 border border-slate-300 rounded-md text-slate-900 bg-white"
              >
                <option value="single_choice">Single Choice</option>
                <option value="multiple_choice">Multiple Choice</option>
                <option value="true_false">True / False</option>
                <option value="matching">Matching</option>
                <option value="free_text">Free Text / Essay</option>
              </select>
            </div>
            <div className="w-full md:w-32">
              <label className="block text-sm font-semibold text-slate-900 mb-1">
                Marks
              </label>
              <input
                type="number"
                min="0"
                step="0.25"
                value={q.marks}
                onChange={(e) => updateQuestion(q.id, { marks: e.target.value })}
                className="w-full p-2 border border-slate-300 rounded-md text-slate-900"
              />
            </div>
          </div>

          <div className="mb-4">
            <label className="block text-sm font-semibold text-slate-900 mb-1">
              Question Text
            </label>
            <textarea
              value={q.prompt}
              onChange={(e) => updateQuestion(q.id, { prompt: e.target.value })}
              className="w-full p-3 border border-slate-300 rounded-md text-slate-900 min-h-[80px]"
              placeholder="Enter the question prompt here..."
            />
          </div>

          {/* Image Upload for Question */}
          <div className="mb-6">
            <label className="block text-sm font-medium text-slate-700 mb-2">
              Attach Image (Optional)
            </label>
            {imagePreviews[q.id] || q.imageUrl ? (
              <div className="mt-2 flex items-start gap-4">
                <img
                  src={imagePreviews[q.id] || q.imageUrl!}
                  alt="Question Preview"
                  className="max-h-48 rounded-md border border-slate-200"
                />
                <button
                  type="button"
                  onClick={() => {
                    handleImageChange(q.id, null);
                    updateQuestion(q.id, { imageUrl: null });
                  }}
                  className="text-slate-500 hover:text-red-600 text-sm font-medium transition-colors mt-2"
                >
                  Remove Image
                </button>
              </div>
            ) : (
              <input
                key="no-img"
                type="file"
                name={`image_${q.id}`}
                accept="image/*"
                onChange={(e) =>
                  handleImageChange(q.id, e.target.files?.[0] || null)
                }
                className="block w-full text-sm text-slate-500 file:mr-4 file:py-2 file:px-4 file:rounded-md file:border-0 file:text-sm file:font-semibold file:bg-blue-100 file:text-blue-700 hover:file:bg-blue-200"
              />
            )}
          </div>

          {/* Dynamic Options UI */}
          <div className="bg-slate-50 p-4 rounded-md border border-slate-200">
            <h5 className="text-sm font-semibold text-slate-900 mb-3">
              Options & Answers
            </h5>

            {/* SINGLE CHOICE */}
            {q.type === 'single_choice' && Array.isArray(q.options) && (
              <div className="space-y-2">
                {q.options.map((opt, oIdx) => (
                  <div key={oIdx} className="flex items-center gap-3">
                    <input
                      type="radio"
                      name={`correct_${q.id}`}
                      checked={q.correctAnswer === opt}
                      onChange={() =>
                        updateQuestion(q.id, { correctAnswer: opt })
                      }
                      className="w-4 h-4 text-blue-600 cursor-pointer"
                    />
                    <input
                      type="text"
                      value={opt}
                      onChange={(e) => updateOption(q.id, oIdx, e.target.value)}
                      className="flex-1 p-2 border border-slate-300 rounded-md text-slate-900"
                      placeholder={`Option ${oIdx + 1}`}
                    />
                    <button
                      type="button"
                      onClick={() => removeOption(q.id, oIdx)}
                      className="text-slate-400 hover:text-red-500"
                    >
                      ✕
                    </button>
                  </div>
                ))}
                <button
                  type="button"
                  onClick={() => addOption(q.id)}
                  className="text-blue-600 text-sm font-medium mt-2 hover:underline"
                >
                  + Add Option
                </button>
              </div>
            )}

            {/* MULTIPLE CHOICE */}
            {q.type === 'multiple_choice' && Array.isArray(q.options) && (
              <div className="space-y-2">
                {q.options.map((opt, oIdx) => (
                  <div key={oIdx} className="flex items-center gap-3">
                    <input
                      type="checkbox"
                      checked={
                        Array.isArray(q.correctAnswer) &&
                        q.correctAnswer.includes(opt)
                      }
                      onChange={(e) => {
                        let current = Array.isArray(q.correctAnswer)
                          ? [...q.correctAnswer]
                          : [];
                        if (e.target.checked) current.push(opt);
                        else current = current.filter((x) => x !== opt);
                        updateQuestion(q.id, { correctAnswer: current });
                      }}
                      className="w-4 h-4 text-blue-600 cursor-pointer"
                    />
                    <input
                      type="text"
                      value={opt}
                      onChange={(e) => updateOption(q.id, oIdx, e.target.value)}
                      className="flex-1 p-2 border border-slate-300 rounded-md text-slate-900"
                      placeholder={`Option ${oIdx + 1}`}
                    />
                    <button
                      type="button"
                      onClick={() => removeOption(q.id, oIdx)}
                      className="text-slate-400 hover:text-red-500"
                    >
                      ✕
                    </button>
                  </div>
                ))}
                <button
                  type="button"
                  onClick={() => addOption(q.id)}
                  className="text-blue-600 text-sm font-medium mt-2 hover:underline"
                >
                  + Add Option
                </button>
              </div>
            )}

            {/* TRUE FALSE */}
            {q.type === 'true_false' && (
              <div className="space-y-3">
                <p className="text-sm text-slate-600 mb-2">
                  Select the correct answer:
                </p>
                {['True', 'False'].map((opt) => (
                  <label
                    key={opt}
                    className="flex items-center gap-2 cursor-pointer"
                  >
                    <input
                      type="radio"
                      name={`tf_${q.id}`}
                      checked={q.correctAnswer === opt}
                      onChange={() =>
                        updateQuestion(q.id, { correctAnswer: opt })
                      }
                      className="w-4 h-4 text-blue-600"
                    />
                    <span className="text-slate-900 font-medium">{opt}</span>
                  </label>
                ))}
              </div>
            )}

            {/* MATCHING */}
            {q.type === 'matching' && Array.isArray(q.options) && (
              <div className="space-y-3">
                <div className="flex gap-4 mb-2">
                  <div className="flex-1 text-xs font-semibold text-slate-500 uppercase">
                    Premise (Item)
                  </div>
                  <div className="flex-1 text-xs font-semibold text-slate-500 uppercase">
                    Response (Match)
                  </div>
                  <div className="w-6"></div>
                </div>
                {q.options.map((pair, pIdx) => (
                  <div key={pIdx} className="flex gap-4 items-center">
                    <input
                      type="text"
                      value={pair.premise}
                      onChange={(e) =>
                        updatePair(q.id, pIdx, 'premise', e.target.value)
                      }
                      placeholder="e.g. Mitochondria"
                      className="flex-1 p-2 border border-slate-300 rounded-md text-slate-900"
                    />
                    <input
                      type="text"
                      value={pair.response}
                      onChange={(e) =>
                        updatePair(q.id, pIdx, 'response', e.target.value)
                      }
                      placeholder="e.g. Powerhouse of the cell"
                      className="flex-1 p-2 border border-slate-300 rounded-md text-slate-900"
                    />
                    <button
                      type="button"
                      onClick={() => removePair(q.id, pIdx)}
                      className="text-slate-400 hover:text-red-500"
                    >
                      ✕
                    </button>
                  </div>
                ))}
                <button
                  type="button"
                  onClick={() => addPair(q.id)}
                  className="text-blue-600 text-sm font-medium mt-2 hover:underline"
                >
                  + Add Pair
                </button>
              </div>
            )}

            {/* FREE TEXT */}
            {q.type === 'free_text' && (
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  Grading Rubric / Memo (Optional)
                </label>
                <textarea
                  value={q.correctAnswer || ''}
                  onChange={(e) =>
                    updateQuestion(q.id, { correctAnswer: e.target.value })
                  }
                  className="w-full p-3 border border-slate-300 rounded-md text-slate-900 min-h-[80px] bg-white"
                  placeholder="Notes for the educator who will mark this question manually..."
                />
              </div>
            )}
          </div>
        </div>
      ))}

      <button
        type="button"
        onClick={addQuestion}
        className="w-full py-3 border-2 border-dashed border-blue-300 rounded-md bg-blue-50 text-blue-700 font-semibold hover:bg-blue-100 transition-colors"
      >
        + Add Another Question
      </button>

      {/* Hidden input to pass data to server action */}
      <input
        type="hidden"
        name="questionsData"
        value={JSON.stringify(questions)}
      />
    </div>
  );
}
