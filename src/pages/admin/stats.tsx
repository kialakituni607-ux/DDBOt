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
    return (
        <div style={{ maxWidth: 900, margin: '40px auto', padding: '0 16px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
                <h2 style={{ margin: 0 }}>Admin Dashboard</h2>
                <button onClick={refresh} disabled={loading} style={{ padding: '8px 20px', background: '#1a237e', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer' }}>{loading ? 'Refreshing...' : 'Refresh'}</button>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16, marginBottom: 32 }}>
                {[
                    { label: 'Total Commission', value: '$' + fmt(commission?.total_commission) },
                    { label: 'Commission Today', value: '$' + fmt(commission?.commission_today) },
                    { label: 'Commission This Week', value: '$' + fmt(commission?.commission_this_week) },
                    { label: 'Total Trades', value: commission?.total_trades || 0 },
                    { label: 'Real Trades', value: commission?.real_trades || 0 },
                    { label: 'Total Traders', value: commission?.total_traders || 0 },
                    { label: 'Total Logins', value: logins?.total_logins || 0 },
                    { label: 'Logins Today', value: logins?.logins_today || 0 },
                    { label: 'Unique Users', value: logins?.unique_users_logged_in || 0 },
                ].map(({ label, value }) => (
                    <div key={label} style={{ background: '#fff', borderRadius: 10, padding: '20px 24px', boxShadow: '0 1px 8px rgba(0,0,0,0.08)' }}>
                        <p style={{ margin: '0 0 6px', fontSize: 12, color: '#888' }}>{label}</p>
                        <p style={{ margin: 0, fontSize: 24, fontWeight: 700, color: '#1a237e' }}>{value}</p>
                    </div>
                ))}
            </div>
            <h3 style={{ marginBottom: 16 }}>Commission by User</h3>
            <div style={{ background: '#fff', borderRadius: 10, boxShadow: '0 1px 8px rgba(0,0,0,0.08)', overflow: 'hidden' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
                    <thead>
                        <tr style={{ background: '#1a237e', color: '#fff' }}>
                            {['Deriv Login', 'Email', 'Trades', 'Total Staked', 'Commission', 'Last Trade'].map(h => (
                                <th key={h} style={{ padding: '12px 16px', textAlign: 'left' }}>{h}</th>
                            ))}
                        </tr>
                    </thead>
                    <tbody>
                        {!(per_user || []).length ? (
                            <tr><td colSpan={6} style={{ padding: 24, textAlign: 'center', color: '#888' }}>No data yet</td></tr>
                        ) : (per_user || []).map((u: any, i: number) => (
                            <tr key={u.deriv_loginid} style={{ background: i % 2 === 0 ? '#f8f9fa' : '#fff' }}>
                                <td style={{ padding: '10px 16px' }}>{u.deriv_loginid || '—'}</td>
                                <td style={{ padding: '10px 16px' }}>{u.email || '—'}</td>
                                <td style={{ padding: '10px 16px' }}>{u.trade_count}</td>
                                <td style={{ padding: '10px 16px' }}>${fmt(u.total_staked)}</td>
                                <td style={{ padding: '10px 16px', color: '#2e7d32', fontWeight: 600 }}>${fmt(u.total_commission)}</td>
                                <td style={{ padding: '10px 16px', color: '#888', fontSize: 12 }}>{u.last_trade_at ? new Date(u.last_trade_at).toLocaleString() : '—'}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
};
export default AdminStats;
