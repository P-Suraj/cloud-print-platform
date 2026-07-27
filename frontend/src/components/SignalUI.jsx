import NumberRoll from './motion/NumberRoll';

export function SignalPanel({ children, className = "", style = {} }) {
  return (
    <div 
      className={`card ${className}`} 
      style={{ 
        background: 'var(--bg-card)', 
        border: '1px solid var(--border)', 
        borderRadius: 'var(--radius)', 
        padding: '20px', 
        ...style 
      }}
    >
      {children}
    </div>
  );
}

export function SignalSection({ children, style = {} }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', ...style }}>
      {children}
    </div>
  );
}

export function SignalHeader({ title, subtitle, action }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--border)', paddingBottom: '12px', marginBottom: '16px' }}>
      <div>
        <h3 style={{ fontSize: '0.9rem', fontWeight: '700', letterSpacing: '0.05em', textTransform: 'uppercase', color: 'var(--text)', margin: 0, fontFamily: 'var(--font-mono)' }}>
          {title}
        </h3>
        {subtitle && (
          <p style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', margin: '2px 0 0 0', fontFamily: 'var(--font)' }}>
            {subtitle}
          </p>
        )}
      </div>
      {action && <div>{action}</div>}
    </div>
  );
}

export function SignalStatus({ status, label }) {
  const statusColor = `var(--${status})`; // success, error, warning
  return (
    <div style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', padding: '6px 12px', borderRadius: 'var(--radius-pill)', background: 'var(--bg-input)', border: '1px solid var(--border)' }}>
      <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: statusColor, display: 'inline-block' }} />
      <span style={{ fontSize: '0.75rem', fontWeight: '700', fontFamily: 'var(--font-mono)', textTransform: 'uppercase', color: 'var(--text-secondary)' }}>
        {label}
      </span>
    </div>
  );
}

export function SignalMetric({ value, label, isRoll = false, suffix = '' }) {
  return (
    <div style={{ padding: '14px', background: 'var(--bg-input)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', textAlign: 'center', flex: 1 }}>
      <div style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em', fontFamily: 'var(--font-mono)' }}>
        {label}
      </div>
      <div style={{ fontSize: '1.6rem', fontWeight: '700', color: 'var(--primary-light)', marginTop: '6px', fontFamily: 'var(--font-mono)' }}>
        {isRoll ? <NumberRoll value={value} suffix={suffix} /> : `${value}${suffix}`}
      </div>
    </div>
  );
}

export function SignalCard({ children, style = {}, onClick }) {
  return (
    <div 
      style={{ 
        padding: '12px 16px', 
        borderRadius: 'var(--radius-sm)', 
        background: 'rgba(255,255,255,0.015)', 
        border: '1px solid var(--border)', 
        display: 'flex', 
        flexDirection: 'column', 
        gap: '8px', 
        cursor: onClick ? 'pointer' : 'default',
        transition: 'border-color 0.2s, background-color 0.2s',
        ...style 
      }}
      onClick={onClick}
    >
      {children}
    </div>
  );
}

export function SignalDivider() {
  return <div style={{ height: '1px', background: 'var(--border)', margin: '14px 0' }} />;
}

export function SignalLabel({ label, value, color }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.72rem', fontFamily: 'var(--font-mono)' }}>
      <span style={{ color: 'var(--text-secondary)' }}>{label}</span>
      <span style={{ color: color || 'var(--text)', fontWeight: '600' }}>{value}</span>
    </div>
  );
}

export function SignalIndicator({ active, color = '--success' }) {
  return (
    <span 
      style={{ 
        width: '8px', 
        height: '8px', 
        borderRadius: '50%', 
        background: active ? `var(${color})` : 'var(--text-muted)', 
        display: 'inline-block',
        boxShadow: active ? `0 0 8px var(${color})` : 'none',
        transition: 'all 0.3s' 
      }} 
    />
  );
}
