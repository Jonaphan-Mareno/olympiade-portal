'use client';

import { useState, use } from 'react';
import { createRound } from './actions';

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
    <div>
      <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: '500', color: '#334155', marginBottom: '0.5rem' }} htmlFor={name}>
        {label}
      </label>
      <div style={{ position: 'relative' }}>
        <input type="file" name={name} id={name} accept={accept} required onChange={onChange}
          style={{ position: 'absolute', width: '100%', height: '100%', opacity: 0, cursor: 'pointer', zIndex: 10 }}
        />
        <div style={{
            border: selectedFile ? '2px solid #3B82F6' : '2px dashed #93C5FD',
            borderRadius: '0.5rem', padding: '1.5rem 1rem', textAlign: 'center',
            backgroundColor: selectedFile ? '#DBEAFE' : '#EFF6FF', transition: 'all 0.2s ease-in-out',
          }}>
          {selectedFile ? (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
              <p style={{ color: '#1E3A8A', fontWeight: '600', fontSize: '0.9rem' }}>{selectedFile.name}</p>
              <p style={{ color: '#2563EB', fontSize: '0.8rem', marginTop: '0.25rem' }}>Ready to submit</p>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
              <p style={{ color: '#2563EB', fontWeight: '500', fontSize: '0.9rem' }}>Click to upload or drag and drop</p>
              <p style={{ color: '#60A5FA', fontSize: '0.8rem', marginTop: '0.25rem' }}>{description}</p>
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

  const handlePaperChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setSelectedPaper(e.target.files?.[0] || null);
  };

  const handleAnswerKeyChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setSelectedAnswerKey(e.target.files?.[0] || null);
  };

  

  return (
    <div style={{ minHeight: '100vh', backgroundColor: '#F8FAFC', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '2rem 1rem' }}>
      <div style={{ backgroundColor: '#FFFFFF', border: '1px solid #E2E8F0', borderRadius: '0.75rem', boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.05)', width: '100%', maxWidth: '550px', padding: '2.5rem' }}>
        <h1 style={{ fontSize: '1.75rem', fontWeight: 'bold', color: '#0F172A', marginBottom: '0.5rem', textAlign: 'center' }}>Create a New Round</h1>
        <p style={{ color: '#64748B', textAlign: 'center', marginBottom: '2rem', fontSize: '0.95rem' }}>Schedule your round and upload the necessary documentation.</p>

        <form action={createRound} style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
            <input type="hidden" name="portalId" value={portalId} />
          <div style={{ display: 'flex', gap: '1rem' }}>
            <div style={{ flex: 2 }}>
              <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: '500', color: '#334155', marginBottom: '0.5rem' }} htmlFor="name">Round Name</label>
              <input type="text" id="name" name="name" required placeholder="e.g. First Round" style={{ width: '100%', padding: '0.75rem', borderRadius: '0.5rem', border: '1px solid #E2E8F0' }} />
            </div>
            <div style={{ flex: 1 }}>
              <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: '500', color: '#334155', marginBottom: '0.5rem' }} htmlFor="orderIndex">Round Order</label>
              <input type="number" id="orderIndex" name="orderIndex" min="1" required defaultValue={1} style={{ width: '100%', padding: '0.75rem', borderRadius: '0.5rem', border: '1px solid #E2E8F0' }} />
            </div>
          </div>

          <div style={{ display: 'flex', gap: '1rem' }}>
            <div style={{ flex: 1 }}>
              <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: '500', color: '#334155', marginBottom: '0.5rem' }} htmlFor="opensAt">Opening Time</label>
              <input type="datetime-local" id="opensAt" name="opensAt" required style={{ width: '100%', padding: '0.75rem', borderRadius: '0.5rem', border: '1px solid #E2E8F0' }} />
            </div>
            <div style={{ flex: 1 }}>
              <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: '500', color: '#334155', marginBottom: '0.5rem' }} htmlFor="closesAt">Closing Time</label>
              <input type="datetime-local" id="closesAt" name="closesAt" required style={{ width: '100%', padding: '0.75rem', borderRadius: '0.5rem', border: '1px solid #E2E8F0' }} />
            </div>
          </div>

          <FileUploadDropzone name="questionPaper" label="Question Paper (PDF)" accept=".pdf" description="PDF up to 10MB" selectedFile={selectedPaper} onChange={handlePaperChange} />
          
          <FileUploadDropzone name="answerKey" label="Answer Key (JSON)" accept=".json" description="JSON file for automarking" selectedFile={selectedAnswerKey} onChange={handleAnswerKeyChange} />

          <button type="submit" style={{ width: '100%', backgroundColor: '#0066CC', color: '#FFFFFF', border: 'none', borderRadius: '0.5rem', padding: '0.75rem', fontSize: '1rem', fontWeight: '600', cursor: 'pointer' }}>
            Save & Publish Round
          </button>
        </form>
      </div>
    </div>
  );
}