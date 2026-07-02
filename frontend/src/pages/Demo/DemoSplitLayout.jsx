import React, { useState, useEffect } from 'react';
import { useDemo } from './DemoContext';
import DemoShopPanel from './DemoShopPanel';
import DemoCustomerPanel from './DemoCustomerPanel';

export default function DemoSplitLayout() {
  const { state } = useDemo();
  const [activeTab, setActiveTab] = useState('customer');

  // Auto-switch to shop tab when job submitted
  useEffect(() => {
    if (state.phase === 'submitted') setActiveTab('shop');
  }, [state.phase]);

  const hasBadge = ['submitted', 'approving'].includes(state.phase);

  return (
    <div className="demo-split-layout">
      {/* ── Mobile tab bar (only visible on small screens) ── */}
      <div className="demo-mobile-tabs">
        <button
          className={`demo-tab ${activeTab === 'customer' ? 'active' : ''}`}
          onClick={() => setActiveTab('customer')}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ verticalAlign: 'middle', marginRight: '6px' }}><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
          Customer Portal
        </button>
        <button
          className={`demo-tab ${activeTab === 'shop' ? 'active' : ''}`}
          onClick={() => setActiveTab('shop')}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ verticalAlign: 'middle', marginRight: '6px' }}><polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/></svg>
          Shop Console
          {hasBadge && <span className="demo-tab-badge">!</span>}
        </button>
      </div>

      {/* ── Desktop split / Mobile single panel ── */}
      <div className="demo-panel-container">

        {/* Shop side */}
        <div className={`demo-column-wrapper shop-wrapper ${activeTab !== 'shop' ? 'mobile-hidden' : ''}`}>
          <div className="demo-column-header">👁️ Shopkeeper View (Console)</div>
          <div className="demo-panel shop-panel">
            <DemoShopPanel />
          </div>
        </div>

        {/* Customer side */}
        <div className={`demo-column-wrapper customer-wrapper ${activeTab !== 'customer' ? 'mobile-hidden' : ''}`}>
          <div className="demo-column-header" style={{ color: 'var(--primary-light)' }}>👤 Customer View (Portal)</div>
          <div className="demo-panel customer-panel">
            <div className="demo-phone-frame">
              <DemoCustomerPanel />
            </div>
          </div>
        </div>

      </div>
    </div>
  );
}
