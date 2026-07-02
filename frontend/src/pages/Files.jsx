import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { supabase } from '../services/supabase';
import ShopNav from '../components/ShopNav';
import { FileIcon } from '../components/Icons';

export default function Files() {
  const { shopId } = useParams();
  const navigate = useNavigate();
  const [files, setFiles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');

  useEffect(() => {
    if (localStorage.getItem(`autoprint_shop_auth_${shopId}`) !== 'true') {
      navigate(`/shop/${shopId}/console`);
      return;
    }
    fetchFiles();
  }, [shopId]);

  const fetchFiles = async () => {
    try {
      setLoading(true);
      // We will fetch from print_jobs directly for now to preserve existing files,
      // and eventually we'd fetch from job_files joined with jobs.
      const { data, error } = await supabase
        .from('print_jobs')
        .select('*')
        .eq('shop_id', shopId)
        .order('created_at', { ascending: false });

      if (error) throw error;
      setFiles(data || []);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const handleReprint = async (file) => {
    try {
      const { error } = await supabase
        .from('print_jobs')
        .insert([{
          shop_id: shopId,
          file_name: file.file_name,
          file_path: file.file_path, // Reuse existing storage path
          copies: file.copies || 1,
          page_count: file.page_count,
          color_mode: file.color_mode || 'bw',
          duplex: file.duplex || false,
          paper_size: file.paper_size || 'A4',
          status: 'queued' // Push straight to queue
        }]);

      if (error) throw error;
      alert('Sent to Print Queue!');
      navigate(`/shop/${shopId}/console`);
    } catch (err) {
      console.error('Error reprinting:', err);
      alert('Failed to reprint');
    }
  };

  const filteredFiles = files.filter(f => 
    f.file_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    (f.id && f.id.toLowerCase().includes(searchQuery.toLowerCase()))
  );

  if (loading) return <div className="page"><div className="spinner lg" /></div>;

  return (
    <div className="console-layout" style={{ display: 'block', padding: 0 }}>
      <ShopNav />
      
      <div style={{ padding: '0 24px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <h2 style={{ fontSize: '1.4rem', margin: 0 }}>File Intelligence & Archives</h2>
        </div>

        <div style={{ marginBottom: 20 }}>
          <input 
            type="text" 
            placeholder="Search by file name or Job ID (CMD+K)" 
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            style={{ width: '100%', maxWidth: 500, padding: '12px 16px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg-raised)', color: 'var(--text)', fontSize: '1rem' }}
          />
        </div>

        <div className="console-panel" style={{ background: 'var(--bg-card)', padding: 16 }}>
          {filteredFiles.length === 0 ? (
            <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}>
              <p>No files found matching your search.</p>
            </div>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border)' }}>
                  <th style={{ padding: '12px 8px', color: 'var(--text-muted)' }}>File Name</th>
                  <th style={{ padding: '12px 8px', color: 'var(--text-muted)' }}>Pages</th>
                  <th style={{ padding: '12px 8px', color: 'var(--text-muted)' }}>Previous Settings</th>
                  <th style={{ padding: '12px 8px', color: 'var(--text-muted)' }}>Date</th>
                  <th style={{ padding: '12px 8px', color: 'var(--text-muted)' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredFiles.map(f => (
                  <tr key={f.id} style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                    <td style={{ padding: '12px 8px', fontWeight: 'bold' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <FileIcon size={16} color="var(--primary-light)" />
                        {f.file_name}
                      </div>
                    </td>
                    <td style={{ padding: '12px 8px' }}>{f.page_count || '?'}</td>
                    <td style={{ padding: '12px 8px', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                      {f.copies}x • {f.color_mode === 'color' ? 'Color' : 'B&W'} • {f.duplex ? 'Duplex' : 'Simplex'} • {f.paper_size || 'A4'}
                    </td>
                    <td style={{ padding: '12px 8px', fontSize: '0.8rem' }}>{new Date(f.created_at).toLocaleDateString()}</td>
                    <td style={{ padding: '12px 8px' }}>
                      <button 
                        className="btn btn-primary" 
                        onClick={() => handleReprint(f)}
                        style={{ height: 30, padding: '0 12px', fontSize: '0.8rem' }}
                      >
                        Reprint
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
