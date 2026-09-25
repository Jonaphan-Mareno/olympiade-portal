'use client';
import { useState, use } from 'react';
import { createRound } from './actions';
import { generateTestFromBase64PDF } from './ai-actions';
import QuestionBuilder from '@/components/organiser/QuestionBuilder';
import { SubmitButton } from '@/components/SubmitButton';
import Link from 'next/link';
import RoundFormInputs from '@/components/organiser/RoundFormInputs';

const FileUploadDropzone = ({
  name,
  label,
  accept,
  selectedFile,
  onChange,
  description,
}: {
  name: string;
  label: string;
  accept: string;
  selectedFile: File | null;
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  description: string;
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
        required
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
  const [isGenerating, setIsGenerating] = useState(false);
  const [generatedQuestions, setGeneratedQuestions] = useState<any[] | null>(null);

  const handleGenerateTest = async () => {
    if (!selectedPaper) return;
    setIsGenerating(true);
    try {
      const fileToBase64 = (file: File): Promise<string> => {
        return new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = (e) => {
            const buffer = e.target?.result as ArrayBuffer;
            const bytes = new Uint8Array(buffer);
            let binary = '';
            for (let i = 0; i < bytes.byteLength; i++) {
              binary += String.fromCharCode(bytes[i]);
            }
            resolve(window.btoa(binary));
          };
          reader.onerror = () => reject(new Error('Failed to read file.'));
          reader.readAsArrayBuffer(file);
        });
      };

      const [base64Paper, base64Memo] = await Promise.all([
        fileToBase64(selectedPaper),
        selectedAnswerKey ? fileToBase64(selectedAnswerKey) : Promise.resolve(null),
      ]);

      const questions = await generateTestFromBase64PDF(base64Paper, base64Memo);
      setGeneratedQuestions(questions);
    } catch (err: any) {
      console.error(err);
      alert(err.message || 'Failed to generate test.');
    } finally {
      setIsGenerating(false);
    }
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

      <form action={createRound} className="flex flex-col">
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
              <RoundFormInputs isOnline={deliveryMethod === 'online' || deliveryMethod === 'hybrid'} />
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
            {deliveryMethod === 'paper' || deliveryMethod === 'hybrid' ? (
              <>
                <h2 className="font-serif text-3xl font-bold text-blue-950 mb-6">
                  Upload Documents
                </h2>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                  <div>
                    <FileUploadDropzone
                      name="questionPaper"
                      label="Question Paper (PDF)"
                      accept=".pdf"
                      description="PDF up to 10MB"
                      selectedFile={selectedPaper}
                      onChange={handlePaperChange}
                    />
                    {deliveryMethod === 'hybrid' && selectedPaper && (
                      <button
                        type="button"
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
                    description="PDF file for marking reference"
                    selectedFile={selectedAnswerKey}
                    onChange={handleAnswerKeyChange}
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
                  <div className="bg-amber-50 border border-amber-200 text-amber-800 p-3 rounded-md mb-6 text-sm flex gap-2 items-start">
                    <svg className="w-5 h-5 shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    <div>
                      <strong>AI-Generated Test.</strong> Please review all questions for formatting accuracy and manually upload any required diagrams or images.
                    </div>
                  </div>
                )}
                <QuestionBuilder key={generatedQuestions ? 'generated' : 'default'} initialQuestions={generatedQuestions || undefined} />
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
