'use client';

import { useState } from 'react';
import CreatePortalForm from './CreatePortalForm';
import { motion, AnimatePresence } from 'framer-motion';

export default function CreatePortalSection({ isEmpty = false }: { isEmpty?: boolean }) {
  const [showDrawer, setShowDrawer] = useState(false);

  return (
    <>
      {isEmpty ? (
        <div style={{ backgroundColor: '#F8FAFC', textAlign: 'center', padding: '3rem 1rem', borderRadius: '0.5rem', border: '1px solid #E2E8F0', marginTop: '1rem' }}>
          <div style={{ width: '48px', height: '48px', backgroundColor: '#EFF6FF', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 1rem auto' }}>
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#3B82F6" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="12" y1="5" x2="12" y2="19"></line>
              <line x1="5" y1="12" x2="19" y2="12"></line>
            </svg>
          </div>
          <p style={{ color: '#64748B', marginBottom: '1.5rem' }}>
            You haven't set up any competitions yet. Click below to get started.
          </p>
          <button
            onClick={() => setShowDrawer(true)}
            className="btn-brand-blue"
          >
            Create New Olympiad
          </button>
        </div>
      ) : (
        <button
          onClick={() => setShowDrawer(true)}
          className="btn-brand-blue"
        >
          Create New Olympiad
        </button>
      )}

      <AnimatePresence>
        {showDrawer && (
          <>
            {/* Backdrop */}
            <motion.div 
              initial={{ opacity: 0 }} 
              animate={{ opacity: 1 }} 
              exit={{ opacity: 0 }} 
              style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(15, 23, 42, 0.3)', backdropFilter: 'blur(4px)', zIndex: 40 }}
              onClick={() => setShowDrawer(false)} 
            />
            
            {/* Slide-Out Drawer */}
            <motion.div 
              initial={{ x: "100%" }} 
              animate={{ x: 0 }} 
              exit={{ x: "100%" }} 
              transition={{ type: "spring", damping: 25, stiffness: 200 }}
              style={{ position: 'fixed', top: 0, right: 0, height: '100vh', width: '100%', maxWidth: '36rem', backgroundColor: '#FFFFFF', boxShadow: '-10px 0 25px rgba(0,0,0,0.1)', zIndex: 50, display: 'flex', flexDirection: 'column' }}
            >
              {/* Organic Wavy Left Edge */}
              <div style={{ position: 'absolute', right: '100%', top: 0, height: '100%', width: '100px', pointerEvents: 'none', overflow: 'hidden' }}>
                <svg viewBox="0 0 100 100" preserveAspectRatio="none" style={{ width: '100%', height: '100%' }}>
                  <path d="M100,0 C-10,25 30,75 100,100 Z" fill="#0066CC" opacity="0.2" />
                  <path d="M100,0 C15,35 45,80 100,100 Z" fill="#FFFFFF" />
                </svg>
              </div>
              {/* Header */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '1.5rem', borderBottom: '1px solid #F1F5F9', backgroundColor: '#FFFFFF', zIndex: 10 }}>
                <h3 style={{ fontSize: '1.25rem', fontWeight: 'bold', color: '#0F172A', margin: 0 }}>Create New Portal</h3>
                <button 
                  onClick={() => setShowDrawer(false)} 
                  style={{ background: 'transparent', border: 'none', color: '#94A3B8', cursor: 'pointer', padding: '0.25rem' }}
                >
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="18" y1="6" x2="6" y2="18"></line>
                    <line x1="6" y1="6" x2="18" y2="18"></line>
                  </svg>
                </button>
              </div>

              {/* Scrollable Content */}
              <div style={{ flex: 1, overflowY: 'auto', backgroundColor: '#FFFFFF', zIndex: 10, display: 'flex', flexDirection: 'column' }}>
                <CreatePortalForm onClose={() => setShowDrawer(false)} />
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </>
  );
}
