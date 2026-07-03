import { useState } from 'react';
const API_BASE = 'https://api.trademasters.site';
const fmt = (n: number, decimals = 2) => Number(n || 0).toFixed(decimals);
const AdminStats = () => {
    const [password, setPassword] = useState('');
    const [authed, setAuthed] = useState(false);
    const [data, setData] = useState<any>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const handleAuth = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!password.trim()) return;
        setLoading(true);
        setError('');
        try {
            const res = await fetch(API_BASE + '/api/admin/stats', { headers: { 'x-admin-secret': password } });
            const json = await res.json();
            if (!res.ok) { setError(json.error || 'Failed'); setLoading(false); return; }
            setData(json);
            setAuthed(true);
        } catch (e: any) { setError(e.message); }
        setLoading(false);
    };
    const refresh = async () => {
        setLoading(true);
        try {
            const res = await fetch(API_BASE + '/api/admin/stats', { headers: { 'x-admin-secret': password } });
            const json = await res.json();
            if (res.ok) setData(json);
        } catch {}
        setLoading(false);
    };
    if (!authed) return (
        <div style={{ maxWidth: 400, margin: '100px auto', padding: 32, background: '#fff', borderRadius: 12, boxShadow: '0 2px 16px rgba(0,0,0,0.10)' }}>
            <h2 style={{ marginBottom: 24 }}>Admin Stats</h2>
            <form onSubmit={handleAuth}>
                <input type='password' placeholder='Admin password' value={password} onChange={e => setPassword(e.target.value)} style={{ width: '100%', padding: '10px 14px', borderRadius: 8, border: '1px solid #ddd', marginBottom: 12, fontSize: 15 }} />
                {error && <p style={{ color: 'red', marginBottom: 8 }}>{error}</p>}
                <button type='submit' disabled={loading} style={{ width: '100%', padding: '10px 0', background: '#1a237e', color: '#fff', border: 'none', borderRadius: 8, fontSize: 15, cursor: 'pointer' }}>{loading ? 'Loading...' : 'View Stats'}</button>
            </form>
        </div>
    );
    const { commission, per_user, logins } = data || {};
