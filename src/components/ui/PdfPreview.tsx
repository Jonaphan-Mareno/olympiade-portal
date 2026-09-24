'use client';

import React, { useEffect, useRef, useState } from 'react';
import * as pdfjsLib from 'pdfjs-dist';

// Configure the worker to use a CDN
if (typeof window !== 'undefined') {
  pdfjsLib.GlobalWorkerOptions.workerSrc = `//cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.mjs`;
}

export default function PdfPreview({ url }: { url: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let renderTask: any;
    let isActive = true;

    const renderPdf = async () => {
      try {
        if (!url) return;
        if (!containerRef.current) return;
        
        const loadingTask = pdfjsLib.getDocument({ url });
        const pdf = await loadingTask.promise;
        const page = await pdf.getPage(1);
        
        if (!isActive) return;

        const viewport = page.getViewport({ scale: 2.0 });
        
        const canvas = document.createElement('canvas');
        canvas.className = "absolute inset-0 w-full h-full object-contain pointer-events-none";
        const context = canvas.getContext('2d');
        if (!context) return;
        
        canvas.height = viewport.height;
        canvas.width = viewport.width;
        
        const renderContext = {
          canvas,
          canvasContext: context,
          viewport: viewport,
        };
        
        renderTask = page.render(renderContext);
        await renderTask.promise;

        if (isActive && containerRef.current) {
          containerRef.current.innerHTML = '';
          containerRef.current.appendChild(canvas);
        }
      } catch (err: any) {
        if (err.name === 'RenderingCancelledException' || err.name === 'PromiseCancelledException') return;
        console.error('Error rendering PDF:', err);
        if (isActive) setError('Failed to load PDF preview');
      }
    };

    renderPdf();

    return () => {
      isActive = false;
      if (renderTask) {
        renderTask.cancel();
      }
    };
  }, [url]);

  if (error) {
    return <div className="absolute inset-0 flex items-center justify-center text-red-500 bg-slate-100">{error}</div>;
  }

  return (
    <div ref={containerRef} className="absolute inset-0 w-full h-full pointer-events-none" />
  );
}
