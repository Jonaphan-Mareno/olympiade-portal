'use client';

import React, { useState, useRef } from 'react';
import { updateCertificateTemplates, uploadCertificateTemplate } from './actions';
import { PDFDocument } from 'pdf-lib';
import PdfPreview from '@/components/ui/PdfPreview';

export type TemplateT = {
  id: string;
  minScorePercentage: number;
  templateUrl: string;
  nameXCoord: number;
  nameYCoord: number;
  nameFontSize: number;
  nameTextColor: string;
};

export default function CertificateMapper({
  roundId,
  initialTemplates,
}: {
  roundId: string;
  initialTemplates: TemplateT[];
}) {
  const [templates, setTemplates] = useState<TemplateT[]>(
    initialTemplates.length > 0 ? initialTemplates : [
      {
        id: 'new-' + Date.now(),
        minScorePercentage: 0,
        templateUrl: '',
        nameXCoord: 50,
        nameYCoord: 50,
        nameFontSize: 48,
        nameTextColor: '#000000',
      }
    ]
  );
  const [activeIndex, setActiveIndex] = useState(0);

  const [isUploading, setIsUploading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  
  const containerRef = useRef<HTMLDivElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [showSuccessMsg, setShowSuccessMsg] = useState(false);
  const [hasSavedOnce, setHasSavedOnce] = useState(initialTemplates.length > 0);
  const activeTemplate = templates[activeIndex];

  const updateActive = (updates: Partial<TemplateT>) => {
    const newTemplates = [...templates];
    newTemplates[activeIndex] = { ...newTemplates[activeIndex], ...updates };
    setTemplates(newTemplates);
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsUploading(true);
    try {
      if (file.type === 'application/pdf') {
        const arrayBuffer = await file.arrayBuffer();
        const pdfDoc = await PDFDocument.load(arrayBuffer);
        if (pdfDoc.getPageCount() > 1) {
          alert('Your PDF certificate template must be exactly 1 page for each tier.');
          setIsUploading(false);
          return;
        }
      }

      const formData = new FormData();
      formData.append('file', file);
      
      const { publicUrl } = await uploadCertificateTemplate(roundId, formData);
        
      updateActive({ templateUrl: publicUrl });
    } catch (err: any) {
      console.error(err);
      alert(err.message || 'Upload failed');
    } finally {
      setIsUploading(false);
    }
  };

  const handlePointerDown = (e: React.PointerEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!isDragging || !containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    let newX = ((e.clientX - rect.left) / rect.width) * 100;
    let newY = ((e.clientY - rect.top) / rect.height) * 100;
    
    newX = Math.max(0, Math.min(100, newX));
    newY = Math.max(0, Math.min(100, newY));
    
    updateActive({ nameXCoord: newX, nameYCoord: newY });
  };

  const handlePointerUp = () => {
    setIsDragging(false);
  };

  const handleSave = async () => {
    setIsSaving(true);
    await updateCertificateTemplates(roundId, templates.map(t => ({
      ...t,
      minScorePercentage: t.minScorePercentage.toString(),
      nameXCoord: t.nameXCoord.toString(),
      nameYCoord: t.nameYCoord.toString(),
    })));
    setIsSaving(false);
    setHasSavedOnce(true);
    setShowSuccessMsg(true);
    setTimeout(() => setShowSuccessMsg(false), 3000);
  };

  const addTier = () => {
    setTemplates([...templates, {
      id: 'new-' + Date.now(),
      minScorePercentage: 0,
      templateUrl: '',
      nameXCoord: 50,
      nameYCoord: 50,
      nameFontSize: 48,
      nameTextColor: '#000000',
    }]);
    setActiveIndex(templates.length);
  };

  const removeTier = (index: number) => {
    const newTemplates = [...templates];
    newTemplates.splice(index, 1);
    setTemplates(newTemplates);
    if (activeIndex >= newTemplates.length) {
      setActiveIndex(Math.max(0, newTemplates.length - 1));
    }
  };

  return (
    <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-200">
      
      {/* Tiers Tabs */}
      <div className="flex border-b-2 border-slate-200 mb-8 gap-2 overflow-x-auto pb-0">
        {templates.map((t, idx) => (
          <div 
            key={t.id} 
            className={`flex items-center px-4 py-3 cursor-pointer whitespace-nowrap transition-colors border-b-4 -mb-[2px] ${activeIndex === idx ? 'border-blue-950 text-blue-950 bg-blue-50/50' : 'border-transparent text-slate-500 hover:text-slate-700 hover:bg-slate-50'}`} 
            onClick={() => setActiveIndex(idx)}
          >
            <span className="font-bold text-sm uppercase tracking-wider mr-4">
              Tier: {t.minScorePercentage}%+
            </span>
            {templates.length > 1 && (
              <button 
                onClick={(e) => { e.stopPropagation(); removeTier(idx); }}
                className="text-slate-400 hover:text-red-600 rounded-full w-5 h-5 flex items-center justify-center font-bold text-lg"
              >
                &times;
              </button>
            )}
          </div>
        ))}
        <button onClick={addTier} className="flex items-center gap-1 text-sm font-bold text-blue-600 hover:text-blue-800 px-4 uppercase tracking-wider">
          + Add Tier
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-8">
        <div className="md:col-span-1 space-y-6">
          <div>
            <label className="block text-xs font-bold text-blue-950 uppercase tracking-wider mb-2">Minimum Score (%)</label>
            <input 
              type="number" 
              value={activeTemplate.minScorePercentage === 0 ? '' : activeTemplate.minScorePercentage} 
              onChange={e => updateActive({ minScorePercentage: parseFloat(e.target.value) || 0 })} 
              className="w-full border-2 border-slate-200 p-3 rounded-none focus:border-blue-950 focus:ring-0 text-slate-900 font-medium" 
              min="0" 
              max="100" 
            />
            {activeTemplate.minScorePercentage === 0 ? (
              <p className="text-xs text-blue-600 mt-2 font-bold uppercase tracking-wider">Default Tier (Participation for All)</p>
            ) : (
              <p className="text-xs text-slate-500 mt-2 font-medium">Students must score &ge; this to earn this tier.</p>
            )}
          </div>
          
          <div>
            <label className="block text-xs font-bold text-blue-950 uppercase tracking-wider mb-2">Upload Template (Image/PDF)</label>
            <div className="relative">
              <input 
                type="file" 
                accept="image/*,application/pdf" 
                onChange={handleFileUpload} 
                className="absolute inset-0 w-full h-full opacity-0 cursor-pointer" 
                disabled={isUploading} 
              />
              <div className="w-full border-2 border-slate-200 border-dashed p-4 flex items-center justify-center text-center hover:bg-slate-50 transition-colors">
                <span className="text-sm font-bold text-blue-600 uppercase tracking-wider">
                  {isUploading ? 'Uploading...' : 'Choose File'}
                </span>
              </div>
            </div>
            {activeTemplate.templateUrl && !isUploading && (
              <p className="text-xs text-green-600 mt-2 font-bold uppercase tracking-wider">Template Loaded</p>
            )}
          </div>

          <div>
            <label className="block text-xs font-bold text-blue-950 uppercase tracking-wider mb-2">Name Font Size (px)</label>
            <input 
              type="number" 
              value={activeTemplate.nameFontSize} 
              onChange={e => updateActive({ nameFontSize: parseInt(e.target.value) || 48 })} 
              className="w-full border-2 border-slate-200 p-3 rounded-none focus:border-blue-950 focus:ring-0 text-slate-900 font-medium" 
            />
          </div>

          <div>
            <label className="block text-xs font-bold text-blue-950 uppercase tracking-wider mb-2">Name Text Color</label>
            <div className="flex items-center gap-3">
              <input 
                type="color" 
                value={activeTemplate.nameTextColor} 
                onChange={e => updateActive({ nameTextColor: e.target.value })} 
                className="w-12 h-12 p-0 border-0 cursor-pointer rounded-none" 
              />
              <span className="text-sm font-medium text-slate-700 uppercase tracking-wider">{activeTemplate.nameTextColor}</span>
            </div>
          </div>

          <div className="pt-6 border-t-2 border-slate-100">
            <button 
              onClick={handleSave} 
              disabled={isSaving || templates.some(t => !t.templateUrl)} 
              className="w-full bg-blue-950 text-white font-bold py-3 px-4 rounded-none hover:bg-blue-900 transition-colors disabled:opacity-50 uppercase tracking-wider text-sm flex items-center justify-center gap-2"
            >
              {isSaving ? 'Saving...' : hasSavedOnce ? 'Update Configuration' : 'Save Configuration'}
            </button>
            {showSuccessMsg && (
              <div className="mt-3 bg-green-50 border border-green-200 text-green-700 px-4 py-2 text-xs font-bold uppercase tracking-wider text-center transition-opacity">
                Configuration Saved Successfully!
              </div>
            )}
            {templates.some(t => !t.templateUrl) && <p className="text-xs font-bold text-red-500 uppercase tracking-wider mt-3">All tiers must have a template uploaded.</p>}
          </div>
        </div>
        
        <div className="md:col-span-3 border-l-2 border-slate-100 pl-8">
          <h3 className="text-sm font-bold text-blue-950 uppercase tracking-wider mb-4">Preview & Mapping</h3>
          {activeTemplate.templateUrl ? (
            <div 
              ref={containerRef}
              className="relative border-2 border-slate-200 bg-slate-50 overflow-hidden w-full select-none touch-none rounded-none shadow-inner"
              style={{ aspectRatio: '1.414 / 1' }} 
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUp}
              onPointerLeave={handlePointerUp}
            >
              {activeTemplate.templateUrl.toLowerCase().includes('.pdf') ? (
                <PdfPreview url={activeTemplate.templateUrl} />
              ) : (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img src={activeTemplate.templateUrl} alt="Certificate Template" className="absolute inset-0 w-full h-full object-contain pointer-events-none" />
              )}
              <div 
                onPointerDown={handlePointerDown}
                className="absolute cursor-move border-2 border-dashed border-blue-500 bg-blue-50/50 p-2 whitespace-nowrap -translate-x-1/2 -translate-y-1/2 rounded-none"
                style={{ 
                  left: `${activeTemplate.nameXCoord}%`, 
                  top: `${activeTemplate.nameYCoord}%`,
                  color: activeTemplate.nameTextColor,
                  fontSize: `${Math.max(12, activeTemplate.nameFontSize * 0.5)}px`
                }}
              >
                [Student Name]
              </div>
            </div>
          ) : (
            <div className="h-64 bg-slate-50 border-2 border-slate-200 border-dashed rounded-none flex flex-col items-center justify-center text-slate-500">
              <svg className="w-12 h-12 text-slate-300 mb-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
              <span className="font-medium text-sm">Upload a template image or PDF to start mapping this tier</span>
            </div>
          )}
          <p className="text-xs text-slate-600 mt-4 bg-blue-50 p-4 border border-blue-100 rounded-none font-medium">
            <strong className="text-blue-900 uppercase tracking-wider mr-2">Tip:</strong> 
            Drag the placeholder box to position where the student's name should be drawn. The text size here is an approximation.
          </p>
        </div>
      </div>
    </div>
  );
}
