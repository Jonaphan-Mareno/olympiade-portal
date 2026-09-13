'use client';

import { useState, use } from 'react';
import { createRound } from './actions';
import QuestionBuilder from '@/components/organiser/QuestionBuilder';
import Link from 'next/link';

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
      <label className="block text-sm font-semibold text-slate-900 mb-2" htmlFor={name}>
        {label}
      </label>
      <div className="relative w-full">
        <input type="file" name={name} id={name} accept={accept} required onChange={onChange}
          className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
        />
        <div className={`border-2 border-dashed rounded-lg p-8 text-center transition-all ${selectedFile ? 'border-blue-500 bg-blue-100' : 'border-blue-400 bg-blue-50 hover:bg-blue-100'}`}>
          {selectedFile ? (
            <div className="flex flex-col items-center">
              <p className="text-blue-900 font-semibold text-lg">{selectedFile.name}</p>
              <p className="text-blue-700 text-sm mt-1">Ready to submit</p>
            </div>
          ) : (
            <div className="flex flex-col items-center">
              <p className="text-blue-600 font-medium text-base">Click to upload or drag and drop</p>
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
  const [deliveryMethod, setDeliveryMethod] = useState<'paper' | 'online'>('paper');

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
          <Link href={`/organiser/olympiads/${portalId}`} className="text-blue-900 hover:underline text-sm font-medium">
            &larr; Back to Olympiad
          </Link>
        </div>

        {/* Header */}
        <div className="mb-12 border-b border-slate-200 pb-8">
          <h1 className="font-serif text-5xl font-bold text-slate-900 mb-2">Create a New Round</h1>
          <p className="text-slate-600 text-lg">Set up round details and build your online test or upload question papers.</p>
        </div>
      </div>

      <form action={createRound} className="flex flex-col">
        <input type="hidden" name="portalId" value={portalId} />
        <input type="hidden" name="deliveryMethod" value={deliveryMethod} />

        {/* Section 1: Round Details */}
        <div className="w-full">
          <div className="max-w-5xl mx-auto px-4 md:px-8 mb-12 pb-12 border-b border-slate-200">
            <h2 className="font-serif text-3xl font-bold text-blue-950 mb-6">Round Details</h2>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <div className="md:col-span-2">
                <label className="block text-sm font-semibold text-slate-700 mb-2" htmlFor="name">Round Name</label>
                <input type="text" id="name" name="name" required placeholder="e.g. First Round" className="w-full p-3 border border-slate-300 rounded-md text-slate-900 bg-white focus:ring-2 focus:ring-blue-500 focus:outline-none" />
              </div>
              <div className="md:col-span-1">
                <label className="block text-sm font-semibold text-slate-700 mb-2" htmlFor="orderIndex">Round Order</label>
                <input type="number" id="orderIndex" name="orderIndex" min="1" required defaultValue={1} className="w-full p-3 border border-slate-300 rounded-md text-slate-900 bg-white focus:ring-2 focus:ring-blue-500 focus:outline-none" />
              </div>
              <div className="md:col-span-1">
                <label className="block text-sm font-semibold text-slate-700 mb-2" htmlFor="opensAt">Opening Time</label>
                <input type="datetime-local" id="opensAt" name="opensAt" required className="w-full p-3 border border-slate-300 rounded-md text-slate-900 bg-white focus:ring-2 focus:ring-blue-500 focus:outline-none" />
              </div>
              <div className="md:col-span-1">
                <label className="block text-sm font-semibold text-slate-700 mb-2" htmlFor="closesAt">Closing Time</label>
                <input type="datetime-local" id="closesAt" name="closesAt" required className="w-full p-3 border border-slate-300 rounded-md text-slate-900 bg-white focus:ring-2 focus:ring-blue-500 focus:outline-none" />
              </div>
            </div>
          </div>
        </div>

        {/* Section 2: Delivery Method */}
        <div className="w-full">
          <div className="max-w-5xl mx-auto px-4 md:px-8 mb-12 pb-12 border-b border-slate-200">
            <h2 className="font-serif text-3xl font-bold text-blue-950 mb-6">Delivery Method</h2>
            <div className="flex gap-8">
              <button
                type="button"
                onClick={() => setDeliveryMethod('paper')}
                className={`pb-2 text-lg transition-colors ${
                  deliveryMethod === 'paper' 
                    ? 'text-blue-900 font-semibold border-b-2 border-blue-900' 
                    : 'text-slate-500 font-medium border-b-2 border-transparent hover:text-slate-700'
                }`}
              >
                Paper (PDF)
              </button>
              
              <button
                type="button"
                onClick={() => setDeliveryMethod('online')}
                className={`pb-2 text-lg transition-colors ${
                  deliveryMethod === 'online' 
                    ? 'text-blue-900 font-semibold border-b-2 border-blue-900' 
                    : 'text-slate-500 font-medium border-b-2 border-transparent hover:text-slate-700'
                }`}
              >
                Online Test
              </button>
            </div>
          </div>
        </div>

        {/* Section 3: Content (Uploads or Question Builder) */}
        <div className="w-full">
          <div className="max-w-5xl mx-auto px-4 md:px-8 mb-12 pb-12 border-b border-slate-200">
            {deliveryMethod === 'paper' ? (
              <>
                <h2 className="font-serif text-3xl font-bold text-blue-950 mb-6">Upload Documents</h2>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                  <FileUploadDropzone name="questionPaper" label="Question Paper (PDF)" accept=".pdf" description="PDF up to 10MB" selectedFile={selectedPaper} onChange={handlePaperChange} />
                  <FileUploadDropzone name="answerKey" label="Answer Key Memo (PDF)" accept=".pdf" description="PDF file for marking reference" selectedFile={selectedAnswerKey} onChange={handleAnswerKeyChange} />
                </div>
              </>
            ) : (
              <>
                <h2 className="font-serif text-3xl font-bold text-blue-950 mb-6">Question Builder</h2>
                <QuestionBuilder />
              </>
            )}
          </div>
        </div>

        {/* Footer Actions */}
        <div className="w-full bg-white py-10 px-4 md:px-8">
          <div className="max-w-5xl mx-auto flex justify-end">
            <button type="submit" className="w-full md:w-auto bg-blue-900 hover:bg-blue-800 text-white rounded-md py-4 px-10 text-lg font-bold transition-all">
              Save & Publish Round
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}