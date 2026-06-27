import { useEffect, useState, useRef } from 'react';

type Signal = {
    id: number;
    market_type: string;
    call: string;
    duration: string;
    confidence: string;
    notes: string | null;
    posted_at: string;
    expires_at: string;
    next_signal_at: string | null;
    is_active: boolean;
};

const API_BASE = 'https://api.trademasters.site';

function useCountdown(target: string | null) {
    const [secs, setSecs] = useState(0);
    useEffect(() => {
        if (!target) return;
        const tick = () => setSecs(Math.max(0, Math.floor((new Date(target).getTime() - Date.now()) / 1000)));
        tick();
        const id = setInterval(tick, 1000);
        return () => clearInterval(id);
    }, [target]);
    const m = Math.floor(secs / 60).toString().padStart(2, '0');
    const s = (secs % 60).toString().padStart(2, '0');
    return { secs, label: m + ':' + s };
}

function SignalCard({ signal }: { signal: Signal }) {
    const expiry = useCountdown(signal.expires_at);
    const isExpired = expiry.secs === 0;
    const nextCountdown = useCountdown(signal.next_signal_at);
    const typeColor: Record<string, { bg: string; color: string }> = {
        'Over/Under': { bg: '#e6f1fb', color: '#185fa5' },
        'Even/Odd': { bg: '#eaf3de', color: '#3b6d11' },
        'Matches/Differs': { bg: '#faeeda', color: '#854f0b' },
    };
    const tc = typeColor[signal.market_type] || { bg: '#f1efe8', color: '#5f5e5a' };
    const confColor: Record<string, string> = { High: '#3b6d11', Medium: '#ba7517', Low: '#a32d2d' };
    if (isExpired) {
        return (
            <div style={{ padding: '1.5rem', textAlign: 'center' }}>
                <div style={{ fontSize: 32, marginBottom: 8 }}>⏳</div>
                <p style={{ margin: '0 0 4px', fontWeight: 500, fontSize: 15 }}>Signal expired</p>
                {signal.next_signal_at && nextCountdown.secs > 0 ? (
                    <>
                        <p style={{ margin: '0 0 8px', fontSize: 13, color: 'var(--color-text-secondary)' }}>Next signal in</p>
                        <p style={{ margin: 0, fontSize: 28, fontWeight: 500, color: '#185fa5' }}>{nextCountdown.label}</p>
                    </>
                ) : (
                    <p style={{ margin: 0, fontSize: 13, color: 'var(--color-text-secondary)' }}>Next signal coming soon...</p>
                )}
            </div>
        );
    }
    return (
        <div style={{ padding: '1rem 1.25rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                <span style={{ fontSize: 12, color: 'var(--color-text-secondary)' }}>{signal.market_type}</span>
                <span style={{ fontSize: 11, color: expiry.secs < 60 ? '#e24b4a' : 'var(--color-text-secondary)', fontWeight: 500 }}>Expires in {expiry.label}</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                <span style={{ background: tc.bg, color: tc.color, fontSize: 14, fontWeight: 500, padding: '4px 14px', borderRadius: 20 }}>{signal.call}</span>
                <span style={{ fontSize: 12, color: 'var(--color-text-secondary)' }}>{signal.duration}</span>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 10 }}>
                <div>
                    <p style={{ margin: 0, fontSize: 11, color: 'var(--color-text-secondary)' }}>Confidence</p>
                    <p style={{ margin: 0, fontSize: 13, fontWeight: 500, color: confColor[signal.confidence] || 'inherit' }}>{signal.confidence}</p>
                </div>
                <div>
                    <p style={{ margin: 0, fontSize: 11, color: 'var(--color-text-secondary)' }}>Posted at</p>
                    <p style={{ margin: 0, fontSize: 13, fontWeight: 500 }}>{new Date(signal.posted_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} GMT</p>
                </div>
            </div>
            {signal.notes && (
                <p style={{ margin: 0, fontSize: 12, color: 'var(--color-text-secondary)', background: 'var(--color-background-secondary)', padding: '8px 10px', borderRadius: 6 }}>{signal.notes}</p>
            )}
        </div>
    );
}

export function SignalsPanel({ onClose }: { onClose: () => void }) {
    const [signal, setSignal] = useState<Signal | null>(null);
    const [loading, setLoading] = useState(true);
    const esRef = useRef<EventSource | null>(null);
    useEffect(() => {
        fetch(API_BASE + '/api/signals/active')
            .then(r => r.json())
            .then(d => { setSignal(d.signal); setLoading(false); })
            .catch(() => setLoading(false));
        const es = new EventSource(API_BASE + '/api/signals/stream');
        esRef.current = es;
        es.onmessage = (e) => {
            try { const data = JSON.parse(e.data); if (data.type === 'new_signal') setSignal(data.signal); } catch {}
        };
        return () => { esRef.current?.close(); };
    }, []);
    return (
        <div style={{ position: 'fixed', inset: 0, zIndex: 9999, display: 'flex', justifyContent: 'flex-end' }} onClick={onClose}>
            <div style={{ width: 320, background: 'var(--color-background-primary)', borderLeft: '0.5px solid var(--color-border-tertiary)', height: '100%', overflowY: 'auto', display: 'flex', flexDirection: 'column' }} onClick={e => e.stopPropagation()}>
                <div style={{ padding: '1rem 1.25rem', borderBottom: '0.5px solid var(--color-border-tertiary)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div>
                        <p style={{ margin: 0, fontWeight: 500, fontSize: 15 }}>Live Signals</p>
                        <p style={{ margin: 0, fontSize: 12, color: 'var(--color-text-secondary)' }}>Real-time trading signals</p>
                    </div>
                    <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 20, color: 'var(--color-text-secondary)', padding: 4 }}>x</button>
                </div>
                <div style={{ flex: 1 }}>
                    {loading ? (
                        <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--color-text-secondary)', fontSize: 13 }}>Loading...</div>
                    ) : signal ? (
                        <SignalCard signal={signal} />
                    ) : (
                        <div style={{ padding: '2rem', textAlign: 'center' }}>
                            <p style={{ margin: '0 0 4px', fontWeight: 500, fontSize: 15 }}>No active signal</p>
                            <p style={{ margin: 0, fontSize: 13, color: 'var(--color-text-secondary)' }}>Next signal coming soon...</p>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}

export function useBellIcon() {
    const [open, setOpen] = useState(false);
    const [hasNew, setHasNew] = useState(false);
    useEffect(() => {
        const es = new EventSource(API_BASE + '/api/signals/stream');
        es.onmessage = (e) => {
            try { const data = JSON.parse(e.data); if (data.type === 'new_signal') setHasNew(true); } catch {}
        };
        return () => es.close();
    }, []);
    const openPanel = () => { setOpen(true); setHasNew(false); };
    const bell = (
        <div style={{ position: 'relative', cursor: 'pointer' }} onClick={openPanel}>
            <i className='ti ti-bell' style={{ fontSize: 20, color: 'var(--color-text-secondary)' }} />
            {hasNew && <span style={{ position: 'absolute', top: -4, right: -4, width: 8, height: 8, background: '#e24b4a', borderRadius: '50%' }} />}
        </div>
    );
    const panel = open ? <SignalsPanel onClose={() => setOpen(false)} /> : null;
    return { bell, panel };
}
