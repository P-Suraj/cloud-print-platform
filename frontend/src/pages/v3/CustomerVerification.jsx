import React, { useState } from 'react';
import { ArrowRight, LoaderCircle, Mail, ShieldCheck } from 'lucide-react';
import { v3Api } from '../../services/v3Api';

export default function CustomerVerification({ shopName, onVerified }) {
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [step, setStep] = useState('email');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const sendCode = async (event) => {
    event.preventDefault(); setLoading(true); setError('');
    try { await v3Api.requestCustomerCode(email); setStep('code'); }
    catch (err) { setError(err.message || 'We could not send the verification code.'); }
    finally { setLoading(false); }
  };

  const verifyCode = async (event) => {
    event.preventDefault(); setLoading(true); setError('');
    try {
      const result = await v3Api.verifyCustomerCode(email, code);
      sessionStorage.setItem('v3_customer_csrf', result.csrf_token);
      onVerified(result.customer);
    } catch (err) { setError(err.message || 'The verification code is invalid or expired.'); }
    finally { setLoading(false); }
  };

  return <div className="v3-customer-container v3-verify-wrap"><section className="v3-verify-card">
    <span className="v3-verify-icon"><ShieldCheck /></span><span className="v3-eyebrow">Remote order protection</span>
    <h1>Verify before sending to {shopName}</h1>
    <p>Remote orders need a verified identity. Payment remains pay-at-pickup, and the shop cannot print before check-in unless it explicitly accepts the unpaid risk.</p>
    {step === 'email' ? <form onSubmit={sendCode}><label><span>Email address</span><div className="v3-verify-input"><Mail size={18} /><input type="email" value={email} onChange={event => setEmail(event.target.value)} required autoComplete="email" placeholder="student@example.com" /></div></label><button className="v3-primary-button" disabled={loading}>{loading ? <LoaderCircle className="v3-spinner" /> : <>Send verification code <ArrowRight size={18} /></>}</button></form>
      : <form onSubmit={verifyCode}><label><span>Verification code sent to {email}</span><input className="v3-code-input" inputMode="numeric" value={code} onChange={event => setCode(event.target.value)} required maxLength={12} autoComplete="one-time-code" /></label><button className="v3-primary-button" disabled={loading}>{loading ? <LoaderCircle className="v3-spinner" /> : <>Verify and continue <ArrowRight size={18} /></>}</button><button className="v3-text-button" type="button" onClick={() => { setStep('email'); setCode(''); }}>Use a different email</button></form>}
    {error && <div className="v3-message error" role="alert">{error}</div>}
  </section></div>;
}
