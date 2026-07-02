import React from 'react';
import { useDemo } from './DemoContext';

export default function DemoShopPanel() {
  const { state, approveJob, setIsExitModalOpen } = useDemo();

  return (
    <div className="demo-shop-container">
      <div className="demo-shop-header">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <div className="demo-shop-title">Hyderabad Copy Centre</div>
            <div className="demo-shop-subtitle" style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
              KRL004 · <span className="demo-online" style={{ display: 'inline-flex', alignItems: 'center' }}><span className="status-pulse-dot"></span>Agent Online</span>
            </div>
          </div>
        </div>
        <div className="demo-shop-nav">
          <span className="active">Console</span>
          <span>Rates</span>
          <span>Ledger</span>
          <span>Customers</span>
          <span>Payments</span>
        </div>
      </div>

      <div className="demo-shop-content">
        <div className="demo-queue-section">
          <h3>Pending ({state.phase === 'submitted' ? '1' : '0'}) {state.phase === 'submitted' && <span className="status-pulse-dot pending"></span>}</h3>
          
          {state.phase === 'idle' || state.phase === 'configuring' ? (
            <div className="demo-empty-state">
              <div className="demo-empty-icon">
                <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.6 }}><polyline points="22 12 16 12 14 15 10 15 8 12 2 12"/><path d="M5.45 5.11L2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/></svg>
              </div>
              <p>Waiting for a print job...</p>
            </div>
          ) : null}

          {state.phase === 'submitted' && (
            <div className="demo-job-card demo-slide-in">
              <div className="demo-job-header">
                <span className="demo-job-id">#{state.jobId}</span>
                <span className="demo-job-price">₹{state.calculatedPrice}</span>
              </div>
              <div className="demo-job-file" style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                {state.file?.type === 'image' ? (
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--primary-light)' }}><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
                ) : (
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--primary-light)' }}><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
                )}
                {state.file?.name}
              </div>
              <div className="demo-job-details">
                {state.pageRange ? `Pages: ${state.pageRange}` : `${state.file?.pageCount} pages`} · {state.colorMode === 'color' ? 'Color' : 'B&W'} · {state.copies} copies
                {state.layoutMode === 'photo_grid' && ` · Grid (${state.gridSize})`}
                {state.paperSize !== 'A4' && ` · ${state.paperSize}`}
              </div>
              <div className="demo-job-actions">
                <button className="demo-btn-secondary" disabled>Reject</button>
                <button className="demo-btn-primary" onClick={approveJob}>Approve & Print</button>
              </div>
            </div>
          )}
        </div>

        <div className="demo-recent-section">
          <h3>Recent Prints</h3>
          
          {state.phase !== 'approving' && state.phase !== 'completed' ? (
            <div className="demo-empty-state">
              <div className="demo-empty-icon">
                <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.6 }}><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
              </div>
              <p>Completed jobs will appear here.</p>
            </div>
          ) : (
            <div className="demo-job-card demo-timeline-card">
              <div className="demo-job-header">
                <span className="demo-job-id">#{state.jobId}</span>
                <span className="demo-job-price">₹{state.calculatedPrice}</span>
              </div>
              
              <div className="demo-timeline">
                <TimelineStep active={true} completed={true} label="File Uploaded" />
                <TimelineStep active={true} completed={true} label="Settings Applied" />
                <TimelineStep active={true} completed={true} label="Job Approved" />
                <TimelineStep 
                  active={state.timelineStep >= 3} 
                  completed={state.timelineStep > 3} 
                  label="Agent Received Job" 
                  pulsing={state.timelineStep === 3}
                />
                <TimelineStep 
                  active={state.timelineStep >= 4} 
                  completed={state.timelineStep > 4} 
                  label="Sent to Printer" 
                  pulsing={state.timelineStep === 4}
                />
                <TimelineStep 
                  active={state.timelineStep >= 5} 
                  completed={state.timelineStep === 5} 
                  label={`Completed · ₹${state.calculatedPrice}`} 
                  isLast
                />
              </div>
            </div>
          )}

          {state.phase === 'completed' && (
            <div className="demo-end-state-card demo-slide-in">
              <h4>You've experienced the core workflow.</h4>
              
              <div className="demo-feature-list">
                <div className="demo-feature-item">✓ Customer Print Submission</div>
                <div className="demo-feature-item">✓ Shop Queue Management</div>
                <div className="demo-feature-item">✓ Print Job Processing</div>
              </div>

              <div className="demo-feature-divider">Additional production features:</div>

              <div className="demo-feature-list muted">
                <div className="demo-feature-item">✓ Shop Management</div>
                <div className="demo-feature-item">✓ Customer Records</div>
                <div className="demo-feature-item">✓ Pricing Controls</div>
                <div className="demo-feature-item">✓ Job History</div>
                <div className="demo-feature-item">✓ Operational Tools</div>
              </div>

              <button 
                className="demo-btn-primary" 
                style={{ width: '100%', marginTop: '16px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '4px' }}
                onClick={() => setIsExitModalOpen(true)}
              >
                <span className="cta-text-desktop">Explore Production Portal ↗</span>
                <span className="cta-text-mobile">Open Portal ↗</span>
              </button>

              <div className="demo-end-footer" style={{ marginTop: '16px' }}>
                Built and piloted in 6 print shops across Hyderabad.
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function TimelineStep({ active, completed, label, pulsing, isLast }) {
  return (
    <div className={`demo-timeline-step ${active ? 'active' : ''} ${completed ? 'completed' : ''}`}>
      <div className="demo-timeline-indicator">
        <div className={`demo-timeline-dot ${pulsing ? 'pulsing' : ''}`}>
          {completed && (
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
          )}
        </div>
        {!isLast && <div className="demo-timeline-line"></div>}
      </div>
      <div className="demo-timeline-label">{label}</div>
    </div>
  );
}
