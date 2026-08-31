import React from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, BookOpen, CreditCard, FileText, ReceiptText, Settings2, Users } from 'lucide-react';
import './shopManagement.css';

const modules = [
  ['Rates', 'Set page prices and print rules.', 'rates', ReceiptText],
  ['Payments', 'Review payments during the pilot.', 'payments', CreditCard],
  ['Ledger', 'See transaction records.', 'ledger', BookOpen],
  ['Customers', 'Manage customer records.', 'customers', Users],
  ['Files', 'Review stored print files.', 'files', FileText],
  ['Queue settings', 'Remote orders and queue configuration.', 'queue-settings', Settings2],
];

export default function ShopManagement() {
  const { shopId } = useParams();
  return <div className="shop-management-page">
    <Link to={`/v3/console/${shopId}/dashboard`} className="shop-management-back"><ArrowLeft size={16} /> Shop home</Link>
    <span>SHMS · Shop management system</span><h1>Manage your shop</h1><p>Settings and records live here, away from your day-to-day print queue.</p>
    <div className="shop-management-grid">{modules.map(([name, detail, suffix, Icon]) => <Link key={suffix} to={suffix === 'queue-settings' ? '/v3/console/queue-settings' : `/v3/console/${shopId}/${suffix}`}><Icon size={22} /><div><strong>{name}</strong><small>{detail}</small></div></Link>)}</div>
  </div>;
}
