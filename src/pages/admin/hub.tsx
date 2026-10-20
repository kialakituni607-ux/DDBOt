import { useEffect, useState } from 'react';

const API_BASE = 'https://api.trademasters.site';
const links = [
    { href: '/admin/stats', title: 'Stats', desc: 'Users, logins, trades and commission' },
    { href: '/admin/signals', title: 'Signals', desc: 'Post and manage trading signals' },
    { href: '/admin/trade', title: 'Admin Trade', desc: 'Admin trading page' },
    { href: '/', title: 'App Admin tab', desc: 'Log in as an admin account, then open the Admin tab (virtual balance controls)' },
];
const cell = (v: any) => (v === null || v === undefined ? '—' : typeof v === 'object' ? JSON.stringify(v) : String(v));
const card = { background: '#fff', borderRadius: 10, boxShadow: '0 1px 8px rgba(0,0,0,0.08)' } as const;

const AdminHub = () => {
    const [secret, setSecret] = useState<string>(() => sessionStorage.getItem('admin_secret') || '');
    const [password, setPassword] = useState('');
    const [authed, setAuthed] = useState(false);
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);
    const [tables, setTables] = useState<{ name: string; count: number }[]>([]);
    const [selected, setSelected] = useState('');
    const [offset, setOffset] = useState(0);
    const [tableData, setTableData] = useState<any>(null);
    const [detail, setDetail] = useState<any>(null);
    const [copier, setCopier] = useState<string>('unknown');

    const call = async (path: string, sec: string) => {
        const res = await fetch(API_BASE + path, { headers: { 'x-admin-secret': sec } });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || 'Failed');
        return json;
    };
    const logout = () => {
        sessionStorage.removeItem('admin_secret');
        setSecret('');
        setAuthed(false);
        setTables([]);
        setSelected('');
        setTableData(null);
    };
    const login = async (sec: string) => {
        setLoading(true);
        setError('');
        try {
            const json = await call('/api/admin/tables', sec);
            sessionStorage.setItem('admin_secret', sec);
            setSecret(sec);
            setTables(json.tables);
            setAuthed(true);
        } catch (e: any) {
            sessionStorage.removeItem('admin_secret');
            setError(e.message === 'Forbidden' ? 'Wrong password' : e.message);
        }
        setLoading(false);
    };

    const openUser = async (id: number) => {
        setError('');
        try {
            setDetail(await call(`/api/admin/user/${id}`, secret));
            window.scrollTo({ top: 0, behavior: 'smooth' });
        } catch (e: any) { setError(e.message); }
    };

    const setFlag = async (id: number, flag: 'master' | 'enabled', value: boolean) => {
        if (!value && !window.confirm('Turning this off stops their copy trading and deletes any stored tokens. Continue?')) return;
        setError('');
        try {
            const res = await fetch(API_BASE + '/api/admin/hub/copy-flag', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'x-admin-secret': secret },
                body: JSON.stringify({ user_id: id, flag, value }),
            });
            const json = await res.json();
            if (!res.ok) throw new Error(json.error || 'Failed');
            const col = flag === 'master' ? 'is_copy_master' : 'copy_enabled';
            setTableData((d: any) => (d ? { ...d, rows: d.rows.map((r: any) => (r.id === id ? { ...r, [col]: value } : r)) } : d));
        } catch (e: any) {
            setError(e.message);
        }
    };

    const loadCopier = async () => {
        try {
            setCopier((await call('/api/admin/hub/copy-switch', secret)).copier);
        } catch (e) {
            setCopier('unknown');
        }
    };
    const setCopierState = async (on: boolean) => {
        setError('');
        try {
            const res = await fetch(API_BASE + '/api/admin/hub/copy-switch', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'x-admin-secret': secret },
                body: JSON.stringify({ on }),
            });
            const json = await res.json();
            if (!res.ok) throw new Error(json.error || 'Failed');
            setCopier(json.copier);
        } catch (e: any) {
            setError(e.message);
        }
    };
    useEffect(() => {
        if (authed) loadCopier();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [authed]);

    useEffect(() => {
        if (secret) login(secret);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    useEffect(() => {
        if (!authed || !selected) return;
        setLoading(true);
        call(`/api/admin/table/${encodeURIComponent(selected)}?limit=50&offset=${offset}`, secret)
            .then(setTableData)
            .catch((e: any) => setError(e.message))
            .finally(() => setLoading(false));
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [selected, offset, authed]);

    if (!authed)
        return (
            <div style={{ ...card, maxWidth: 400, margin: '100px auto', padding: 32 }}>
                <h2 style={{ marginBottom: 24 }}>Admin</h2>
                <form onSubmit={e => { e.preventDefault(); if (password.trim()) login(password); }}>
                    <input type='password' placeholder='Admin password' value={password} onChange={e => setPassword(e.target.value)} style={{ width: '100%', padding: '10px 14px', borderRadius: 8, border: '1px solid #ddd', marginBottom: 12, fontSize: 15 }} />
                    {error && <p style={{ color: 'red', marginBottom: 8 }}>{error}</p>}
                    <button type='submit' disabled={loading} style={{ width: '100%', padding: '10px 0', background: '#1a237e', color: '#fff', border: 'none', borderRadius: 8, fontSize: 15, cursor: 'pointer' }}>{loading ? 'Checking...' : 'Unlock'}</button>
                </form>
            </div>
        );

    return (
        <div style={{ maxWidth: 1100, margin: '40px auto', padding: '0 16px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
                <h2 style={{ margin: 0 }}>Admin</h2>
                <button onClick={logout} style={{ padding: '8px 20px', background: '#fff', color: '#1a237e', border: '1px solid #1a237e', borderRadius: 8, cursor: 'pointer' }}>Lock</button>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 16, marginBottom: 32 }}>
                {links.map(l => (
                    <a key={l.title} href={l.href} style={{ ...card, display: 'block', padding: '16px 20px', textDecoration: 'none' }}>
                        <p style={{ margin: '0 0 6px', fontSize: 17, fontWeight: 700, color: '#1a237e' }}>{l.title}</p>
                        <p style={{ margin: 0, fontSize: 13, color: '#666' }}>{l.desc}</p>
                    </a>
                ))}
            </div>
            {detail && (
                <div style={{ ...card, padding: 20, marginBottom: 32 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                        <h3 style={{ margin: 0 }}>{detail.user.username} ({detail.user.deriv_loginid})</h3>
                        <button onClick={() => setDetail(null)} style={{ border: 'none', background: 'none', cursor: 'pointer', fontSize: 18 }}>×</button>
                    </div>
                    <p style={{ color: '#666', fontSize: 13 }}>Joined {new Date(detail.user.created_at).toLocaleString()} · Email {detail.user.deriv_email || '—'}</p>
                    <p style={{ fontSize: 14 }}>
                        Virtual balance: <b>{detail.virtual_balance ? Number(detail.virtual_balance.balance).toFixed(2) : 'none'}</b> ·
                        Trades recorded: <b>{detail.summary.trades}</b> (real {detail.summary.real_trades}) ·
                        Staked <b>{Number(detail.summary.staked).toFixed(2)}</b> · Profit <b>{Number(detail.summary.profit).toFixed(2)}</b>
                    </p>
                    <p style={{ fontSize: 12, color: '#888' }}>Real account balance is not stored by the backend, so it cannot be shown here.</p>
                    <h4>Logins ({detail.logins.length})</h4>
                    {!detail.logins.length ? <p style={{ color: '#888', fontSize: 13 }}>No logins recorded yet.</p> : (
                        <div style={{ overflow: 'auto', maxHeight: 220 }}><table style={{ width: '100%', fontSize: 13 }}><tbody>
                            {detail.logins.map((l: any, i: number) => <tr key={i}><td style={{ padding: 4 }}>{new Date(l.created_at).toLocaleString()}</td><td style={{ padding: 4 }}>{l.ip || '—'}</td><td style={{ padding: 4, color: '#888' }}>{(l.user_agent || '').slice(0, 60)}</td></tr>)}
                        </tbody></table></div>
                    )}
                    <h4>Trades (latest 100)</h4>
                    {!detail.trades.length ? <p style={{ color: '#888', fontSize: 13 }}>No trades recorded.</p> : (
                        <div style={{ overflow: 'auto', maxHeight: 300 }}><table style={{ width: '100%', fontSize: 13 }}>
                            <thead><tr>{['Opened', 'Symbol', 'Type', 'Stake', 'Profit', 'Result', 'Real'].map(h => <th key={h} style={{ textAlign: 'left', padding: 4 }}>{h}</th>)}</tr></thead>
                            <tbody>{detail.trades.map((t: any) => <tr key={t.id}><td style={{ padding: 4 }}>{t.opened_at ? new Date(t.opened_at).toLocaleString() : '—'}</td><td style={{ padding: 4 }}>{t.symbol}</td><td style={{ padding: 4 }}>{t.trade_type}</td><td style={{ padding: 4 }}>{t.stake}</td><td style={{ padding: 4 }}>{t.profit ?? '—'}</td><td style={{ padding: 4 }}>{t.result || t.status}</td><td style={{ padding: 4 }}>{t.is_real ? 'yes' : 'no'}</td></tr>)}</tbody>
                        </table></div>
                    )}
                </div>
            )}
            <div style={{ ...card, padding: 16, marginBottom: 24, display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                <b>Copy trading copier:</b>
                <span style={{ color: copier === 'on' ? 'green' : '#c62828', fontWeight: 700 }}>{copier.toUpperCase()}</span>
                <button onClick={() => setCopierState(true)} style={{ padding: '6px 16px', borderRadius: 8, border: '1px solid green', background: '#fff', color: 'green', cursor: 'pointer' }}>Turn ON</button>
                <button onClick={() => setCopierState(false)} style={{ padding: '6px 16px', borderRadius: 8, border: '1px solid #c62828', background: '#fff', color: '#c62828', cursor: 'pointer' }}>Turn OFF</button>
            </div>
            <h3 style={{ marginBottom: 12 }}>Database tables (read-only)</h3>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 16 }}>
                {tables.map(t => (
                    <button key={t.name} onClick={() => { setSelected(t.name); setOffset(0); setTableData(null); }} style={{ padding: '8px 14px', borderRadius: 8, border: '1px solid #1a237e', cursor: 'pointer', background: selected === t.name ? '#1a237e' : '#fff', color: selected === t.name ? '#fff' : '#1a237e' }}>
                        {t.name} ({t.count})
                    </button>
                ))}
            </div>
            {error && <p style={{ color: 'red' }}>{error}</p>}
            {selected && (
                <div style={{ ...card, overflow: 'auto', marginBottom: 16 }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                        <thead>
                            <tr style={{ background: '#1a237e', color: '#fff' }}>
                                {(tableData?.columns || []).map((c: string) => <th key={c} style={{ padding: '10px 12px', textAlign: 'left', whiteSpace: 'nowrap' }}>{c}</th>)}
                                {selected === 'users' && <th style={{ padding: '10px 12px', textAlign: 'left' }}>Footprint</th>}
                                {selected === 'users' && <th style={{ padding: '10px 12px', textAlign: 'left' }}>Master</th>}
                                {selected === 'users' && <th style={{ padding: '10px 12px', textAlign: 'left' }}>Copy</th>}
                            </tr>
                        </thead>
                        <tbody>
                            {loading && !tableData ? (
                                <tr><td style={{ padding: 20 }}>Loading...</td></tr>
                            ) : !(tableData?.rows || []).length ? (
                                <tr><td style={{ padding: 20, color: '#888' }}>No rows</td></tr>
                            ) : tableData.rows.map((r: any, i: number) => (
                                <tr key={i} style={{ background: i % 2 === 0 ? '#f8f9fa' : '#fff' }}>
                                    {tableData.columns.map((c: string) => <td key={c} style={{ padding: '8px 12px', maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={cell(r[c])}>{cell(r[c])}</td>)}
                                    {selected === 'users' && <td style={{ padding: '8px 12px' }}><button onClick={() => openUser(r.id)} style={{ padding: '4px 12px', borderRadius: 6, border: '1px solid #1a237e', background: '#fff', color: '#1a237e', cursor: 'pointer' }}>View</button></td>}
                                    {selected === 'users' && <td style={{ padding: '8px 12px' }}><input type='checkbox' checked={!!r.is_copy_master} disabled={!r.deriv_loginid} onChange={e => setFlag(r.id, 'master', e.target.checked)} /></td>}
                                    {selected === 'users' && <td style={{ padding: '8px 12px' }}><input type='checkbox' checked={!!r.copy_enabled} onChange={e => setFlag(r.id, 'enabled', e.target.checked)} /></td>}
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
            {selected && (
                <div style={{ display: 'flex', gap: 8, marginBottom: 40 }}>
                    <button disabled={offset === 0 || loading} onClick={() => setOffset(Math.max(0, offset - 50))} style={{ padding: '8px 16px', borderRadius: 8, border: '1px solid #ccc', cursor: 'pointer' }}>Newer</button>
                    <button disabled={(tableData?.rows || []).length < 50 || loading} onClick={() => setOffset(offset + 50)} style={{ padding: '8px 16px', borderRadius: 8, border: '1px solid #ccc', cursor: 'pointer' }}>Older</button>
                    <span style={{ alignSelf: 'center', color: '#888', fontSize: 13 }}>Rows {offset + 1}–{offset + (tableData?.rows || []).length}, newest first</span>
                </div>
            )}
        </div>
    );
};

export default AdminHub;
