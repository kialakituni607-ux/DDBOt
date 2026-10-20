import { useEffect, useState } from 'react';
import tmApi from '@/utils/tm-api';

export const useCopyAccess = (): boolean => {
    const [allowed, setAllowed] = useState(false);
    useEffect(() => {
        let alive = true;
        if (localStorage.getItem('tm_jwt')) {
            tmApi
                .getCopyAccess()
                .then(r => {
                    if (alive) setAllowed(!!r.copy_enabled || !!r.is_master);
                })
                .catch(() => {});
        }
        return () => {
            alive = false;
        };
    }, []);
    return allowed;
};

const getDemoAccount = (): string => {
    try {
        const accounts = JSON.parse(localStorage.getItem('clientAccounts') || '{}') as Record<string, any>;
        const found = Object.values(accounts).find(
            (a: any) => a && (a.is_virtual || String(a.loginid || '').startsWith('DOT'))
        ) as any;
        return found ? String(found.loginid) : '';
    } catch {
        return '';
    }
};

const box = { background: '#fff', borderRadius: 10, boxShadow: '0 1px 8px rgba(0,0,0,0.08)', padding: 24, marginBottom: 16 } as const;
const input = { padding: '8px 12px', borderRadius: 8, border: '1px solid #ddd', fontSize: 15, width: 120 } as const;
const btn = { padding: '10px 24px', border: 'none', borderRadius: 8, fontSize: 15, cursor: 'pointer', color: '#fff' } as const;

const CopyTrading = () => {
    const [masters, setMasters] = useState<{ name: string; loginid: string }[]>([]);
    const [master, setMaster] = useState('');
    const [follows, setFollows] = useState<any[]>([]);
    const [stake, setStake] = useState('1');
    const [max_stake, setMaxStake] = useState('5');
    const [loss_limit, setLossLimit] = useState('10');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const [message, setMessage] = useState('');
    const demo = getDemoAccount();

    const load = async () => {
        try {
            const [m, s] = await Promise.all([tmApi.getCopyMasters(), tmApi.getCopyStatus()]);
            setMasters(m.masters);
            setMaster(cur => cur || m.masters[0]?.loginid || '');
            setFollows(s.follows);
        } catch (e) {
            setError((e as Error).message || 'Failed to load');
        }
    };

    useEffect(() => {
        load();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const active = follows.find(f => f.is_active);

    const start = async () => {
        const token = localStorage.getItem('authToken') || '';
        if (!token.startsWith('ory_at_')) {
            setError('Please log in with Deriv again, then try once more.');
            return;
        }
        if (!demo) {
            setError('No demo account found on your login. Copy trading is for demo accounts only for now.');
            return;
        }
        setBusy(true);
        setError('');
        setMessage('');
        try {
            await tmApi.copyFollow({
                token,
                loginid: demo,
                master_loginid: master,
                fixed_stake: Number(stake),
                max_stake: Number(max_stake),
                daily_loss_limit: Number(loss_limit),
            });
            setMessage('Copy trading started on your demo account.');
            await load();
        } catch (e) {
            setError((e as Error).message || 'Could not start copying');
        } finally {
            setBusy(false);
        }
    };

    const stop = async () => {
        setBusy(true);
        setError('');
        setMessage('');
        try {
            await tmApi.copyStop();
            setMessage('Stopped. Your stored token was deleted.');
            await load();
        } catch (e) {
            setError((e as Error).message || 'Could not stop');
        } finally {
            setBusy(false);
        }
    };

    return (
        <div style={{ maxWidth: 640, margin: '24px auto', padding: '0 16px' }}>
            <h2 style={{ marginBottom: 16 }}>Copy Trading (beta)</h2>
            <div style={box}>
                {active ? (
                    <>
                        <p style={{ marginTop: 0 }}>
                            <b>Copying is on.</b> You follow {active.master_loginid} on your demo account{' '}
                            {active.follower_loginid}.
                        </p>
                        <p style={{ fontSize: 14, color: '#555' }}>
                            Stake {active.fixed_stake} USD, max {active.max_stake} USD, daily loss limit{' '}
                            {active.daily_loss_limit} USD.
                            {active.token_expires_at
                                ? ` Log in again before ${new Date(active.token_expires_at).toLocaleDateString()} to keep copying.`
                                : ''}
                        </p>
                        <button disabled={busy} onClick={stop} style={{ ...btn, background: '#c62828' }}>
                            {busy ? 'Please wait...' : 'Stop copying'}
                        </button>
                    </>
                ) : (
                    <>
                        <p style={{ marginTop: 0 }}>
                            Your demo account: <b>{demo || 'not found'}</b>
                        </p>
                        <p style={{ marginBottom: 6 }}>Master to copy</p>
                        <select value={master} onChange={e => setMaster(e.target.value)} style={{ ...input, width: '100%', marginBottom: 16 }}>
                            {masters.map(m => (
                                <option key={m.loginid} value={m.loginid}>
                                    {m.name} ({m.loginid})
                                </option>
                            ))}
                        </select>
                        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginBottom: 16 }}>
                            <label>
                                Stake (USD)
                                <br />
                                <input type='number' min='0.35' max='5' step='0.01' value={stake} onChange={e => setStake(e.target.value)} style={input} />
                            </label>
                            <label>
                                Max stake (USD)
                                <br />
                                <input type='number' min='0.35' max='10' step='0.01' value={max_stake} onChange={e => setMaxStake(e.target.value)} style={input} />
                            </label>
                            <label>
                                Daily loss limit (USD)
                                <br />
                                <input type='number' min='1' max='50' step='1' value={loss_limit} onChange={e => setLossLimit(e.target.value)} style={input} />
                            </label>
                        </div>
                        <button disabled={busy || !master || !demo} onClick={start} style={{ ...btn, background: '#1a237e' }}>
                            {busy ? 'Please wait...' : 'Start copying'}
                        </button>
                    </>
                )}
                {error && <p style={{ color: 'red' }}>{error}</p>}
                {message && <p style={{ color: 'green' }}>{message}</p>}
            </div>
            <div style={{ ...box, fontSize: 13, color: '#555' }}>
                <p style={{ marginTop: 0 }}>
                    By pressing Start, you let Trademasters place trades on your demo account that match the master&apos;s
                    trades. To do that, your login token is stored encrypted on our server until you press Stop or it
                    expires. Copied trades can get slightly different prices from the master&apos;s, and results are not
                    guaranteed. Demo accounts only for now.
                </p>
            </div>
        </div>
    );
};

export default CopyTrading;
