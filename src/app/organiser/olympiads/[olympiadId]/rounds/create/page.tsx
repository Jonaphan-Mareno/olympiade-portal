'use client';
import { useState, use, useCallback, useRef } from 'react';
import { createRound } from './actions';
import { generateTestFromBase64PDF } from './ai-actions';
import QuestionBuilder, { QuestionType } from '@/components/organiser/QuestionBuilder';
import { SubmitButton } from '@/components/SubmitButton';
import Link from 'next/link';
import PaperMarkingFields from '@/components/organiser/PaperMarkingFields';
import RoundFormInputs from '@/components/organiser/RoundFormInputs';
import {
  generateQuestionPaperPdf,
  generateMemoPdf,
  downloadPdf,
} from '@/lib/pdf/online-test-pdf';

const FileUploadDropzone = ({
  name,
  label,
  accept,
  selectedFile,
  onChange,
  description,
  required = true,
}: {
  name: string;
  label: string;
  accept: string;
  selectedFile: File | null;
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  description: string;
  required?: boolean;
}) => (
  <div className="w-full">
    <label
      className="block text-sm font-semibold text-slate-900 mb-2"
      htmlFor={name}
    >
      {label}
    </label>
    <div className="relative w-full">
      <input
        type="file"
        name={name}
        id={name}
        accept={accept}
        required={required}
        onChange={onChange}
        className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
      />
      <div
        className={`border-2 border-dashed rounded-lg p-8 text-center transition-all ${selectedFile ? 'border-blue-500 bg-blue-100' : 'border-blue-400 bg-blue-50 hover:bg-blue-100'}`}
      >
        {selectedFile ? (
          <div className="flex flex-col items-center">
            <p className="text-blue-900 font-semibold text-lg">
              {selectedFile.name}
            </p>
            <p className="text-blue-700 text-sm mt-1">Ready to submit</p>
          </div>
        ) : (
          <div className="flex flex-col items-center">
            <p className="text-blue-600 font-medium text-base">
              Click to upload or drag and drop
            </p>
            <p className="text-blue-500 text-sm mt-1">{description}</p>
          </div>
        )}
      </div>
    </div>
  </div>
);

export default function CreateRoundPage({
  params,
}: {
  params: Promise<{ olympiadId: string }>;
}) {
  const resolvedParams = use(params);
  const portalId = resolvedParams.olympiadId;

  const [selectedPaper, setSelectedPaper] = useState<File | null>(null);
  const [selectedAnswerKey, setSelectedAnswerKey] = useState<File | null>(null);
  const [deliveryMethod, setDeliveryMethod] = useState<'paper' | 'online' | 'hybrid'>(
    'paper'
  );
  const [roundName, setRoundName] = useState('');
  const [pdfBusy, setPdfBusy] = useState<'paper' | 'memo' | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [generatedQuestions, setGeneratedQuestions] = useState<any[] | null>(null);

  const handleGenerateTest = async () => {
    if (!selectedPaper) return;
    setIsGenerating(true);
    try {
      const fileToBase64 = (file: File): Promise<string> =>
        new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = (e) => {
            const bytes = new Uint8Array(e.target?.result as ArrayBuffer);
            let binary = '';
            const chunk = 0x8000;
            for (let i = 0; i < bytes.length; i += chunk) {
              binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
            }
            resolve(window.btoa(binary));
          };
          reader.onerror = () => reject(new Error('Failed to read file.'));
          reader.readAsArrayBuffer(file);
        });

      const [base64Paper, base64Memo] = await Promise.all([
        fileToBase64(selectedPaper),
        selectedAnswerKey ? fileToBase64(selectedAnswerKey) : Promise.resolve(null),
      ]);

      const result = await generateTestFromBase64PDF(base64Paper, base64Memo);
      if (result && 'error' in result && result.error) {
        alert(result.error);
      } else if (result && 'data' in result && result.data) {
        setGeneratedQuestions(result.data);
      }
    } catch (err: any) {
      console.error(err);
      alert(err.message || 'Failed to generate test.');
    } finally {
      setIsGenerating(false);
    }
  };
  const builderState = useRef<{
    questions: QuestionType[];
    images: Record<string, string>;
  }>({ questions: [], images: {} });

  const handleBuilderChange = useCallback(
    (questions: QuestionType[], images: Record<string, string>) => {
      builderState.current = { questions, images };
    },
    []
  );

  /** Validates that every question has what the PDFs need. Returns an error message or null. */
  const validateForPdf = (): string | null => {
    const { questions } = builderState.current;
    if (questions.length === 0) return 'Add at least one question first.';
    for (let i = 0; i < questions.length; i++) {
      const q = questions[i];
      if (!q.prompt?.trim()) return `Question ${i + 1} has no question text.`;
    }
    return null;
  };

  const buildPaperBytes = () =>
    generateQuestionPaperPdf(
      builderState.current.questions,
      { roundName: roundName.trim() || 'Question Paper' },
      builderState.current.images
    );

  const handleDownload = async (kind: 'paper' | 'memo') => {
    const err = validateForPdf();
    if (err) {
      alert(err);
      return;
    }
    setPdfBusy(kind);
    try {
      const name = roundName.trim() || 'round';
      const safe = name.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase() || 'round';
      if (kind === 'paper') {
        downloadPdf(await buildPaperBytes(), `${safe}-question-paper.pdf`);
      } else {
        downloadPdf(
          await generateMemoPdf(builderState.current.questions, {
            roundName: name === 'round' ? 'Question Paper' : name,
          }),
          `${safe}-memo.pdf`
        );
      }
    } catch (e: any) {
      console.error(e);
      alert(e?.message || 'Failed to generate PDF.');
    } finally {
      setPdfBusy(null);
    }
  };

  /**
   * Hybrid rounds need a paper PDF on the server. If the organiser did not
   * upload one, we generate it from the online test on submit.
   */
  const submitRound = async (formData: FormData) => {
    if (deliveryMethod === 'hybrid') {
      const uploaded = formData.get('questionPaper') as File | null;
      if (!uploaded || uploaded.size === 0) {
        const err = validateForPdf();
        if (err) {
          alert(err);
          return;
        }
        const bytes = await buildPaperBytes();
        formData.set(
          'questionPaper',
          new File([bytes as BlobPart], 'question-paper.pdf', { type: 'application/pdf' })
        );
      }
    }
    await createRound(formData);
  };

  const handlePaperChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setSelectedPaper(e.target.files?.[0] || null);
  };

  const handleAnswerKeyChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setSelectedAnswerKey(e.target.files?.[0] || null);
  };

  return (
    <div className="min-h-screen bg-white font-sans relative">
      <div className="max-w-5xl mx-auto pt-16 px-4 md:px-8">
        {/* Absolute Back Button */}
        <div className="absolute top-6 left-4 md:left-8">
          <Link
            href={`/organiser/olympiads/${portalId}`}
            className="text-blue-900 hover:underline text-sm font-medium"
          >
            &larr; Back to Olympiad
          </Link>
        </div>

        {/* Header */}
        <div className="mb-12 border-b border-slate-200 pb-8">
          <h1 className="font-serif text-5xl font-bold text-slate-900 mb-2">
            Create a New Round
          </h1>
          <p className="text-slate-600 text-lg">
            Set up round details and build your online test or upload question
            papers.
          </p>
        </div>
      </div>

      <form action={submitRound} className="flex flex-col">
        <input type="hidden" name="portalId" value={portalId} />
        <input type="hidden" name="deliveryMethod" value={deliveryMethod} />

        {/* Section 1: Round Details */}
        <div className="w-full">
          <div className="max-w-5xl mx-auto px-4 md:px-8 mb-12 pb-12 border-b border-slate-200">
            <h2 className="font-serif text-3xl font-bold text-blue-950 mb-6">
              Round Details
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <div className="md:col-span-2">
                <label
                  className="block text-sm font-semibold text-slate-700 mb-2"
                  htmlFor="name"
                >
                  Round Name
                </label>
                <input
                  type="text"
                  id="name"
                  name="name"
                  required
                  value={roundName}
                  onChange={(e) => setRoundName(e.target.value)}
                  placeholder="e.g. First Round"
                  className="w-full p-3 border border-slate-300 rounded-md text-slate-900 bg-white focus:ring-2 focus:ring-blue-500 focus:outline-none"
                />
              </div>
              <div className="md:col-span-1">
                <label
                  className="block text-sm font-semibold text-slate-700 mb-2"
                  htmlFor="orderIndex"
                >
                  Round Order
                </label>
                <input
                  type="number"
                  id="orderIndex"
                  name="orderIndex"
                  min="1"
                  required
                  defaultValue={1}
                  className="w-full p-3 border border-slate-300 rounded-md text-slate-900 bg-white focus:ring-2 focus:ring-blue-500 focus:outline-none"
                />
              </div>
              <RoundFormInputs />
            </div>

            {/* Advancement Thresholds */}
            <div className="mt-6 pt-6 border-t border-slate-200">
              <h3 className="font-serif text-xl font-bold text-blue-950 mb-1">Advancement to Next Round</h3>
              <p className="text-sm text-slate-500 mb-4">
                When results are published, qualifying students are automatically enrolled in the next round.
                Leave empty to disable. If both are set, a student must satisfy <strong>both</strong>.
              </p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div>
                  <label className="block text-sm font-semibold text-slate-700 mb-2" htmlFor="qualifyingThreshold">
                    Minimum Score (%)
                  </label>
                  <input
                    type="number"
                    id="qualifyingThreshold"
                    name="qualifyingThreshold"
                    min="0"
                    max="100"
                    step="0.1"
                    placeholder="e.g. 60"
                    className="w-full p-3 border border-slate-300 rounded-md text-slate-900 bg-white focus:ring-2 focus:ring-blue-500 focus:outline-none"
                  />
                  <p className="text-xs text-slate-400 mt-1">Student must score at least this percentage to advance.</p>
                </div>
                <div>
                  <label className="block text-sm font-semibold text-slate-700 mb-2" htmlFor="thresholdTopN">
                    Top N Students
                  </label>
                  <input
                    type="number"
                    id="thresholdTopN"
                    name="thresholdTopN"
                    min="1"
                    step="1"
                    placeholder="e.g. 50"
                    className="w-full p-3 border border-slate-300 rounded-md text-slate-900 bg-white focus:ring-2 focus:ring-blue-500 focus:outline-none"
                  />
                  <p className="text-xs text-slate-400 mt-1">Only the top N highest-scoring students advance.</p>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Section 2: Delivery Method */}
        <div className="w-full">
          <div className="max-w-5xl mx-auto px-4 md:px-8 mb-12 pb-12 border-b border-slate-200">
            <h2 className="font-serif text-3xl font-bold text-blue-950 mb-6">
              Delivery Method
            </h2>
            <div className="flex gap-8">
              <button
                type="button"
                onClick={() => setDeliveryMethod('online')}
                className={`pb-2 text-lg transition-colors ${
                  deliveryMethod === 'online'
                    ? 'text-blue-900 font-semibold border-b-2 border-blue-900'
                    : 'text-slate-500 font-medium border-b-2 border-transparent hover:text-slate-700'
                }`}
              >
                Online Only
              </button>

              <button
                type="button"
                onClick={() => setDeliveryMethod('paper')}
                className={`pb-2 text-lg transition-colors ${
                  deliveryMethod === 'paper'
                    ? 'text-blue-900 font-semibold border-b-2 border-blue-900'
                    : 'text-slate-500 font-medium border-b-2 border-transparent hover:text-slate-700'
                }`}
              >
                Offline Only (Paper)
              </button>

              <button
                type="button"
                onClick={() => setDeliveryMethod('hybrid')}
                className={`pb-2 text-lg transition-colors ${
                  deliveryMethod === 'hybrid'
                    ? 'text-blue-900 font-semibold border-b-2 border-blue-900'
                    : 'text-slate-500 font-medium border-b-2 border-transparent hover:text-slate-700'
                }`}
              >
                Hybrid (Both)
              </button>
            </div>
          </div>
        </div>

        {/* Section 3: Content (Uploads or Question Builder) */}
        <div className="w-full">
          <div className="max-w-5xl mx-auto px-4 md:px-8 mb-12 pb-12 border-b border-slate-200">
            {(deliveryMethod === 'paper' || deliveryMethod === 'hybrid') && (
              <div className="mb-10">
                <h2 className="font-serif text-3xl font-bold text-blue-950 mb-6">
                  Physical Marking
                </h2>
                <PaperMarkingFields />
              </div>
            )}
            {deliveryMethod === 'paper' ? (
              <>
                <h2 className="font-serif text-3xl font-bold text-blue-950 mb-6">
                  Upload Documents
                </h2>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                  <FileUploadDropzone
                    name="questionPaper"
                    label="Question Paper (PDF)"
                    accept=".pdf"
                    description="PDF up to 10MB"
                    selectedFile={selectedPaper}
                    onChange={handlePaperChange}
                  />
                  <FileUploadDropzone
                    name="answerKey"
                    label="Answer Key Memo (PDF)"
                    accept=".pdf"
                    description="PDF file for marking reference"
                    selectedFile={selectedAnswerKey}
                    onChange={handleAnswerKeyChange}
                  />
                </div>
              </>
            ) : null}

            {deliveryMethod === 'hybrid' ? (
              <>
                <h2 className="font-serif text-3xl font-bold text-blue-950 mb-2">
                  Start from an existing paper (optional)
                </h2>
                <p className="text-sm text-slate-600 mb-6">
                  Upload a paper (and memo) and let AI turn it into an online test, or skip
                  this and build the test below and export it as PDFs. If you upload a
                  paper it is used as the round&apos;s printed paper; otherwise one is
                  generated from the test.
                </p>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                  <div>
                    <FileUploadDropzone
                      name="questionPaper"
                      label="Question Paper (PDF)"
                      accept=".pdf"
                      description="PDF up to 10MB"
                      selectedFile={selectedPaper}
                      onChange={handlePaperChange}
                      required={false}
                    />
                    {selectedPaper && (
                      <button
                        type="button"
                        id="generate-online-test-ai"
                        onClick={handleGenerateTest}
                        disabled={isGenerating}
                        className="mt-4 flex items-center justify-center w-full px-4 py-3 bg-gradient-to-r from-indigo-500 to-purple-600 hover:from-indigo-600 hover:to-purple-700 text-white font-bold rounded-lg shadow-sm transition-all disabled:opacity-70 disabled:cursor-not-allowed"
                      >
                        {isGenerating ? (
                          <span className="flex items-center gap-2">
                            <svg className="animate-spin h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                            </svg>
                            Generating AI Test...
                          </span>
                        ) : (
                          <span className="flex items-center gap-2 text-sm">
                            ✨ Generate Online Test from PDF
                          </span>
                        )}
                      </button>
                    )}
                  </div>
                  <FileUploadDropzone
                    name="answerKey"
                    label="Answer Key Memo (PDF)"
                    accept=".pdf"
                    description="Optional - helps AI pick correct answers"
                    selectedFile={selectedAnswerKey}
                    onChange={handleAnswerKeyChange}
                    required={false}
                  />
                </div>
              </>
            ) : null}

            {deliveryMethod === 'online' || deliveryMethod === 'hybrid' ? (
              <>
                <h2 className="font-serif text-3xl font-bold text-blue-950 mb-6 mt-12 border-t border-slate-200 pt-12">
                  Question Builder
                </h2>
                {deliveryMethod === 'hybrid' && generatedQuestions && generatedQuestions.length > 0 && (
                  <div className="bg-amber-50 border border-amber-200 text-amber-800 p-3 rounded-md mb-6 text-sm">
                    <strong>AI-Generated Test.</strong> Please review all questions and answers for accuracy and manually upload any required diagrams or images.
                  </div>
                )}
                <QuestionBuilder
                  key={generatedQuestions ? 'generated' : 'default'}
                  initialQuestions={generatedQuestions || undefined}
                  onChange={handleBuilderChange}
                />

                {deliveryMethod === 'hybrid' && (
                  <div className="mt-10 rounded-lg border border-blue-200 bg-blue-50 p-6">
                    <h3 className="font-serif text-2xl font-bold text-blue-950 mb-1">
                      Printable Paper &amp; Memo
                    </h3>
                    <p className="text-sm text-slate-600 mb-4">
                      Generate a PDF of this online test to print for the physical sitting. The
                      question paper contains <strong>no answers</strong>; the correct answers
                      you selected above go into a separate memo PDF. The question paper is
                      also attached to the round automatically when you publish.
                    </p>
                    <div className="flex flex-col sm:flex-row gap-3">
                      <button
                        type="button"
                        id="download-question-paper"
                        onClick={() => handleDownload('paper')}
                        disabled={pdfBusy !== null}
                        className="flex-1 px-4 py-3 bg-blue-900 hover:bg-blue-800 text-white font-bold rounded-md transition-all disabled:opacity-70 disabled:cursor-not-allowed"
                      >
                        {pdfBusy === 'paper' ? 'Generating…' : 'Download Question Paper (PDF)'}
                      </button>
                      <button
                        type="button"
                        id="download-memo"
                        onClick={() => handleDownload('memo')}
                        disabled={pdfBusy !== null}
                        className="flex-1 px-4 py-3 bg-white border border-blue-900 text-blue-900 hover:bg-blue-100 font-bold rounded-md transition-all disabled:opacity-70 disabled:cursor-not-allowed"
                      >
                        {pdfBusy === 'memo' ? 'Generating…' : 'Download Memo (PDF)'}
                      </button>
                    </div>
                  </div>
                )}
              </>
            ) : null}
          </div>
        </div>

        {/* Footer Actions */}
        <div className="w-full bg-white py-10 px-4 md:px-8">
          <div className="max-w-5xl mx-auto flex justify-end">
            <SubmitButton
              pendingText="Publishing…"
              fullWidth={false}
              className="w-full md:w-auto bg-blue-900 hover:bg-blue-800 disabled:bg-slate-400 disabled:cursor-not-allowed text-white rounded-md py-4 px-10 text-lg font-bold transition-all"
            >
              Save & Publish Round
            </SubmitButton>
          </div>
        </div>
      </form>
    </div>
  );
}
