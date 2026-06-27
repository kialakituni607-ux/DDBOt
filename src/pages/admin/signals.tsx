import { useState } from 'react';

const API_BASE = 'https://api.trademasters.site';

const AdminSignals = () => {
    const [password, setPassword] = useState('');
    const [authed, setAuthed] = useState(false);
    const [form, setForm] = useState({
        market_type: 'Over/Under',
        call: '',
        duration: '',
        confidence: 'High',
        notes: '',
        expires_minutes: '10',
        next_signal_minutes: '',
    });
    const [status, setStatus] = useState('');
    const [loading, setLoading] = useState(false);

    const handleAuth = (e: React.FormEvent) => {
        e.preventDefault();
        if (password.trim()) setAuthed(true);
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);
        setStatus('');
        try {
            const res = await fetch(API_BASE + '/api/signals', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'x-admin-secret': password },
                body: JSON.stringify({
                    ...form,
                    expires_minutes: parseInt(form.expires_minutes),
                    next_signal_minutes: form.next_signal_minutes ? parseInt(form.next_signal_minutes) : null,
                }),
            });
            const data = await res.json();
            if (res.ok) {
                setStatus('Signal posted successfully!');
                setForm(f => ({ ...f, call: '', notes: '', next_signal_minutes: '' }));
            } else {
                setStatus('Error: ' + (data.error || 'Failed'));
            }
        } catch (e) {
            setStatus('Network error');
        }
        setLoading(false);
    };

    const inp = { background: 'var(--color-background-secondary)', border: '0.5px solid var(--color-border-tertiary)', borderRadius: 6, padding: '8px 12px', fontSize: 14, color: 'var(--color-text-primary)', width: '100%', boxSizing: 'border-box' as const };
    const lbl = { display: 'block', fontSize: 12, color: 'var(--color-text-secondary)', marginBottom: 4 };

    if (!authed) {
        return (
            <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--color-background-secondary)' }}>
                <div style={{ background: 'var(--color-background-primary)', borderRadius: 12, padding: '2rem', width: 320, border: '0.5px solid var(--color-border-tertiary)' }}>
                    <h2 style={{ margin: '0 0 1.5rem', fontSize: 18, fontWeight: 500 }}>Admin Login</h2>
                    <form onSubmit={handleAuth}>
                        <label style={lbl}>Admin Password</label>
                        <input type='password' value={password} onChange={e => setPassword(e.target.value)} style={{ ...inp, marginBottom: '1rem' }} placeholder='Enter admin password' />
                        <button type='submit' style={{ width: '100%', padding: '10px', background: '#185fa5', color: 'white', border: 'none', borderRadius: 6, fontSize: 14, cursor: 'pointer', fontWeight: 500 }}>Login</button>
                    </form>
                </div>
            </div>
        );
    }

    return (
        <div style={{ minHeight: '100vh', background: 'var(--color-background-secondary)', padding: '2rem' }}>
            <div style={{ maxWidth: 480, margin: '0 auto' }}>
                <h1 style={{ margin: '0 0 1.5rem', fontSize: 20, fontWeight: 500 }}>Post Signal</h1>
                <div style={{ background: 'var(--color-background-primary)', borderRadius: 12, padding: '1.5rem', border: '0.5px solid var(--color-border-tertiary)' }}>
                    <form onSubmit={handleSubmit}>
                        <div style={{ marginBottom: '1rem' }}>
                            <label style={lbl}>Market Type</label>
                            <select value={form.market_type} onChange={e => setForm(f => ({ ...f, market_type: e.target.value }))} style={inp}>
                                <option>Over/Under</option>
                                <option>Even/Odd</option>
                                <option>Matches/Differs</option>
                            </select>
                        </div>
                        <div style={{ marginBottom: '1rem' }}>
                            <label style={lbl}>Call (e.g. Over 4, Even, Matches 7)</label>
                            <input value={form.call} onChange={e => setForm(f => ({ ...f, call: e.target.value }))} style={inp} placeholder='e.g. Over 4' required />
                        </div>
                        <div style={{ marginBottom: '1rem' }}>
                            <label style={lbl}>Duration (e.g. 5 ticks, 1 minute)</label>
                            <input value={form.duration} onChange={e => setForm(f => ({ ...f, duration: e.target.value }))} style={inp} placeholder='e.g. 5 ticks' required />
                        </div>
                        <div style={{ marginBottom: '1rem' }}>
                            <label style={lbl}>Confidence</label>
                            <select value={form.confidence} onChange={e => setForm(f => ({ ...f, confidence: e.target.value }))} style={inp}>
                                <option>High</option>
                                <option>Medium</option>
                                <option>Low</option>
                            </select>
                        </div>
                        <div style={{ marginBottom: '1rem' }}>
                            <label style={lbl}>Notes (bot to use, volatility, analysis)</label>
                            <textarea value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} style={{ ...inp, height: 80, resize: 'vertical' }} placeholder='e.g. Use Alpha AI Bot on Volatility 75' />
                        </div>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: '1rem' }}>
                            <div>
                                <label style={lbl}>Signal expires in (minutes)</label>
                                <input type='number' value={form.expires_minutes} onChange={e => setForm(f => ({ ...f, expires_minutes: e.target.value }))} style={inp} min={1} required />
                            </div>
                            <div>
                                <label style={lbl}>Next signal in (minutes, optional)</label>
                                <input type='number' value={form.next_signal_minutes} onChange={e => setForm(f => ({ ...f, next_signal_minutes: e.target.value }))} style={inp} min={1} placeholder='leave blank = coming soon' />
                            </div>
                        </div>
                        {status && <p style={{ margin: '0 0 1rem', fontSize: 13, color: status.includes('success') ? '#3b6d11' : '#a32d2d', background: status.includes('success') ? '#eaf3de' : '#fcebeb', padding: '8px 12px', borderRadius: 6 }}>{status}</p>}
                        <button type='submit' disabled={loading} style={{ width: '100%', padding: '12px', background: '#185fa5', color: 'white', border: 'none', borderRadius: 6, fontSize: 14, cursor: loading ? 'not-allowed' : 'pointer', fontWeight: 500, opacity: loading ? 0.7 : 1 }}>
                            {loading ? 'Posting...' : 'Post Signal'}
                        </button>
                    </form>
                </div>
            </div>
        </div>
    );
};

export default AdminSignals;
