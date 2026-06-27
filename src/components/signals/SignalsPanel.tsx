import { useEffect, useState, useRef } from 'react';
import { isPushSupported, isLikelySubscribed, subscribeToPush, unsubscribeFromPush } from '@/utils/push-notifications';

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
    const confColor: Record<string, string> = { High: '#69f0ae', Medium: '#ffd740', Low: '#ff5252' };
    if (isExpired) {
        return (
            <div style={{ padding: '1.5rem', textAlign: 'center' }}>
                <div style={{ fontSize: 32, marginBottom: 8 }}>⏳</div>
                <p style={{ margin: '0 0 4px', fontWeight: 500, fontSize: 15 }}>Signal expired</p>
                {signal.next_signal_at && nextCountdown.secs > 0 ? (
                    <>
                        <p style={{ margin: '0 0 8px', fontSize: 13, color: 'rgba(255,255,255,0.7)' }}>Next signal in</p>
                        <p style={{ margin: 0, fontSize: 28, fontWeight: 700, color: '#ffffff' }}>{nextCountdown.label}</p>
                    </>
                ) : (
                    <p style={{ margin: 0, fontSize: 13, color: 'rgba(255,255,255,0.7)' }}>Next signal coming soon...</p>
                )}
            </div>
        );
    }
    return (
        <div style={{ padding: '1rem 1.25rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.6)' }}>{signal.market_type}</span>
                <span style={{ fontSize: 11, color: expiry.secs < 60 ? '#ff5252' : '#ffd740', fontWeight: 700 }}>Expires in {expiry.label}</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                <span style={{ background: tc.bg, color: tc.color, fontSize: 14, fontWeight: 500, padding: '4px 14px', borderRadius: 20 }}>{signal.call}</span>
                <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.7)' }}>{signal.duration}</span>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 10 }}>
                <div>
                    <p style={{ margin: 0, fontSize: 11, color: 'rgba(255,255,255,0.6)' }}>Confidence</p>
                    <p style={{ margin: 0, fontSize: 13, fontWeight: 500, color: confColor[signal.confidence] || 'inherit' }}>{signal.confidence}</p>
                </div>
                <div>
                    <p style={{ margin: 0, fontSize: 11, color: 'rgba(255,255,255,0.6)' }}>Posted at</p>
                    <p style={{ margin: 0, fontSize: 13, fontWeight: 500, color: 'white' }}>{new Date(signal.posted_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} GMT</p>
                </div>
            </div>
            {signal.notes && (
                <p style={{ margin: 0, fontSize: 12, color: 'white', background: 'rgba(255,255,255,0.12)', padding: '8px 10px', borderRadius: 6 }}>{signal.notes}</p>
            )}
        </div>
    );
}

export function SignalsPanel({ onClose }: { onClose: () => void }) {
    const [signal, setSignal] = useState<Signal | null>(null);
    const [loading, setLoading] = useState(true);
    const [isMobile, setIsMobile] = useState(window.innerWidth < 768);
    const [subscribed, setSubscribed] = useState(isLikelySubscribed());
    const [subBusy, setSubBusy] = useState(false);
    const [subError, setSubError] = useState('');
    const esRef = useRef<EventSource | null>(null);
    useEffect(() => {
        const onResize = () => setIsMobile(window.innerWidth < 768);
        window.addEventListener('resize', onResize);
        return () => window.removeEventListener('resize', onResize);
    }, []);
    const handleToggleSubscribe = async () => {
        setSubBusy(true);
        setSubError('');
        const result = subscribed ? await unsubscribeFromPush() : await subscribeToPush();
        if (result.ok) {
            setSubscribed(!subscribed);
        } else {
            setSubError(result.error || 'Something went wrong.');
        }
        setSubBusy(false);
    };
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
        <>
            <div style={{ position: 'fixed', inset: 0, zIndex: 9997 }} onClick={onClose} />
            <div style={{ position: 'fixed', top: isMobile ? 100 : 158, left: 0, width: isMobile ? '70vw' : 260, maxWidth: isMobile ? 320 : 260, height: isMobile ? 300 : 'calc(100vh - 158px)', maxHeight: isMobile ? 'calc(100vh - 100px)' : 'calc(100vh - 158px)', zIndex: 9998, background: 'linear-gradient(160deg, #1a237e 0%, #1565c0 60%, #0288d1 100%)', overflowY: 'auto', display: 'flex', flexDirection: 'column', boxShadow: '4px 0 24px rgba(0,0,0,0.18)', borderRadius: isMobile ? '0 0 16px 0' : 0 }} onClick={e => e.stopPropagation()}>
                <div style={{ padding: '1rem 1.25rem', borderBottom: '1px solid rgba(255,255,255,0.15)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div>
                        <p style={{ margin: 0, fontWeight: 700, fontSize: 16, color: 'white' }}>Live Signals</p>
                        <p style={{ margin: 0, fontSize: 11, color: 'rgba(255,255,255,0.7)' }}>Real-time trading signals</p>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        {isPushSupported() && (
                            <button
                                onClick={handleToggleSubscribe}
                                disabled={subBusy}
                                title={subscribed ? 'Notifications enabled' : 'Enable notifications'}
                                style={{ background: subscribed ? 'rgba(105,240,174,0.25)' : 'rgba(255,255,255,0.15)', border: 'none', cursor: subBusy ? 'wait' : 'pointer', fontSize: 11, fontWeight: 600, color: 'white', padding: '6px 10px', borderRadius: 14, display: 'flex', alignItems: 'center', gap: 4 }}
                            >
                                {subscribed ? '🔔 On' : '🔕 Off'}
                            </button>
                        )}
                        <button onClick={onClose} style={{ background: 'rgba(255,255,255,0.15)', border: 'none', cursor: 'pointer', fontSize: 16, color: 'white', width: 28, height: 28, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>x</button>
                    </div>
                </div>
                <div style={{ flex: 1, padding: '0.5rem' }}>
                    {loading ? (
                        <div style={{ padding: '2rem', textAlign: 'center', color: 'rgba(255,255,255,0.7)', fontSize: 13 }}>Loading...</div>
                    ) : signal ? (
                        <SignalCard signal={signal} />
                    ) : (
                        <div style={{ padding: '2rem', textAlign: 'center' }}>
                            <p style={{ margin: '0 0 4px', fontWeight: 600, fontSize: 15, color: 'white' }}>No Active Signal</p>
                            <p style={{ margin: 0, fontSize: 13, color: 'rgba(255,255,255,0.7)' }}>Next signal coming soon...</p>
                        </div>
                    )}
                </div>
            </div>
        </>
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
        <div onClick={openPanel} style={{ cursor: 'pointer', position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center', width: 36, height: 36, borderRadius: '50%', background: hasNew ? '#e8f4fd' : 'transparent' }}>
            <span style={{ fontSize: 18 }}>🔔</span>
            {hasNew && <span style={{ position: 'absolute', top: 4, right: 4, width: 8, height: 8, background: '#e53935', borderRadius: '50%', border: '1.5px solid white' }} />}
        </div>
    );
    const panel = open ? <SignalsPanel onClose={() => setOpen(false)} /> : null;
    return { bell, panel };
}
