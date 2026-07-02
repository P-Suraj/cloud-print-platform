import React, { useState, useRef } from 'react';
import { DemoProvider, useDemo } from './DemoContext';
import DemoSplitLayout from './DemoSplitLayout';
import './Demo.css';

function DemoHeader() {
  const { resetDemo, setIsExitModalOpen } = useDemo();
  return (
    <header className="demo-header">
      <div className="demo-header-brand">AutoPrint <span className="demo-badge">Demo Mode</span></div>
      <div className="demo-header-center desktop-only">
        Interactive Demo — Core Workflow
      </div>
      <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
        <button className="demo-btn-secondary" style={{ padding: '4px 12px', fontSize: '0.8rem' }} onClick={resetDemo}>Reset</button>
        <button 
          className="demo-back-link" 
          style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, fontFamily: 'inherit' }}
          onClick={() => setIsExitModalOpen(true)}
        >
          <span className="cta-text-desktop">Explore Production Portal ↗</span>
          <span className="cta-text-mobile">Open Portal ↗</span>
        </button>
      </div>
    </header>
  );
}

function ExitModal() {
  const { isExitModalOpen, setIsExitModalOpen } = useDemo();
  if (!isExitModalOpen) return null;

  return (
    <div className="demo-modal-overlay" onClick={() => setIsExitModalOpen(false)}>
      <div className="demo-modal" onClick={e => e.stopPropagation()}>
        <h3 className="demo-modal-title">Explore the Production Portal</h3>
        <div className="demo-modal-body">
          <p style={{ marginBottom: '12px' }}>
            You've just experienced the core customer-to-shop workflow.
          </p>
          <p style={{ marginBottom: '12px' }}>
            The production system includes additional features used by partner print shops, including shop operations, customer management, pricing controls, and business tools.
          </p>
          <p>
            You are now about to open the live customer portal.
          </p>
        </div>
        <div className="demo-modal-actions">
          <button className="demo-modal-btn demo-modal-btn-secondary" onClick={() => setIsExitModalOpen(false)}>
            Stay in Experience
          </button>
          <a 
            href="/" 
            className="demo-modal-btn demo-modal-btn-primary" 
            style={{ textDecoration: 'none', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}
          >
            <span className="cta-text-desktop">Open Production Portal</span>
            <span className="cta-text-mobile">Open Portal</span>
          </a>
        </div>
      </div>
    </div>
  );
}

function DemoGuide() {
  const { state } = useDemo();
  const [hidden, setHidden] = useState(false);
  const timerRef = useRef(null);

  const handleMouseEnter = () => {
    setHidden(true);
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setHidden(false), 5000);
  };

  let guideText = '';
  if (state.phase === 'idle')        guideText = "Interactive Demo — Choose a file to begin.";
  else if (state.phase === 'configuring') guideText = "Live Preview — Adjust print settings and submit.";
  else if (state.phase === 'submitted')   guideText = "Job Submitted — Awaiting shop approval.";
  else if (state.phase === 'approving')   guideText = "Processing — Printing job...";
  else if (state.phase === 'completed')   guideText = "Job Complete — Try Aadhaar mode next.";

  if (!guideText) return null;

  return (
    <div
      className={`demo-toast-guide ${hidden ? 'demo-toast-hidden' : ''}`}
      onMouseEnter={handleMouseEnter}
    >
      <div className="demo-toast-text">{guideText}</div>
    </div>
  );
}

export default function Demo() {
  return (
    <DemoProvider>
      <div className="demo-page-container">
        <DemoHeader />
        <div className="demo-content">
          <DemoSplitLayout />
        </div>
        <div className="demo-end-footer-subtle">
          Built and piloted in 6 print shops across Hyderabad.
        </div>
        <DemoGuide />
        <ExitModal />
      </div>
    </DemoProvider>
  );
}
