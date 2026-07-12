import { useState, useEffect, useRef } from 'react';

const APP_ID = 116874;
const WS_URL = `wss://ws.derivws.com/websockets/v3?app_id=${APP_ID}`;

type PatternItem = 'W' | 'L';
type TradeResult = { id: number; stake: number; result: 'win' | 'lose'; profit: number; pattern_used: PatternItem; time: string };

const AdminTrade = () => {
    const [password, setPassword] = useState('');
    const [authed, setAuthed] = useState(false);
    const [token, setToken] = useState('');
    const [connected, setConnected] = useState(false);
    const [balance, setBalance] = useState<number | null>(null);
    const [pattern, setPattern] = useState<PatternItem[]>(['W', 'W', 'W', 'L']);
    const [patternIndex, setPatternIndex] = useState(0);
    const [stake, setStake] = useState(1);
    const [symbol, setSymbol] = useState('R_100');
    const [isTrading, setIsTrading] = useState(false);
    const [autoRun, setAutoRun] = useState(false);
    const [trades, setTrades] = useState<TradeResult[]>([]);
    const [status, setStatus] = useState('');
    const [totalProfit, setTotalProfit] = useState(0);
    const ws = useRef<WebSocket | null>(null);
    const patternRef = useRef(pattern);
    const patternIndexRef = useRef(patternIndex);
    const stakeRef = useRef(stake);
    const autoRunRef = useRef(autoRun);
    const tradeCountRef = useRef(0);

    useEffect(() => { patternRef.current = pattern; }, [pattern]);
    useEffect(() => { patternIndexRef.current = patternIndex; }, [patternIndex]);
    useEffect(() => { stakeRef.current = stake; }, [stake]);
    useEffect(() => { autoRunRef.current = autoRun; }, [autoRun]);

    const handleAuth = (e: React.FormEvent) => {
        e.preventDefault();
        const stored = localStorage.getItem('admin_trade_token');
        if (password === (process.env.ADMIN_PASSWORD || 'trademasters-admin') || stored) {
            setAuthed(true);
            if (stored) setToken(stored);
        } else {
            setStatus('Wrong password');
        }
    };

    const connect = () => {
        if (!token) { setStatus('Enter your Deriv demo token first'); return; }
        localStorage.setItem('admin_trade_token', token);
        const socket = new WebSocket(WS_URL);
        ws.current = socket;
        socket.onopen = () => {
            socket.send(JSON.stringify({ authorize: token }));
            setStatus('Connecting...');
        };
        socket.onmessage = (e) => {
            const data = JSON.parse(e.data);
            if (data.msg_type === 'authorize') {
                if (data.error) { setStatus('Auth failed: ' + data.error.message); return; }
                setConnected(true);
                setStatus('Connected to demo account: ' + data.authorize.loginid);
                socket.send(JSON.stringify({ balance: 1, subscribe: 1 }));
            }
            if (data.msg_type === 'balance') {
                setBalance(parseFloat(data.balance.balance));
            }
        };
        socket.onclose = () => { setConnected(false); setStatus('Disconnected'); };
        socket.onerror = () => setStatus('Connection error');
    };

    const executeTrade = () => {
        if (!ws.current || !connected || isTrading) return;
        const currentPattern = patternRef.current;
        const currentIndex = patternIndexRef.current;
        const currentStake = stakeRef.current;
        const outcome = currentPattern[currentIndex % currentPattern.length];
        const nextIndex = (currentIndex + 1) % currentPattern.length;

        setIsTrading(true);
        setStatus(`Placing trade... Pattern: ${outcome}`);

        // Buy a real contract on demo account
        const buyMsg = {
            buy: 1,
            price: currentStake,
            parameters: {
                amount: currentStake,
                basis: 'stake',
                contract_type: outcome === 'W' ? 'CALL' : 'PUT',
                currency: 'USD',
                duration: 1,
                duration_unit: 't',
                symbol: symbol,
            },
        };

        ws.current.send(JSON.stringify(buyMsg));

        const handler = (e: MessageEvent) => {
            const data = JSON.parse(e.data);
            if (data.msg_type === 'buy') {
                if (data.error) {
                    setStatus('Trade failed: ' + data.error.message);
                    setIsTrading(false);
                    ws.current?.removeEventListener('message', handler);
                    return;
                }
                const contractId = data.buy.contract_id;
                // Poll for result
                const poll = setInterval(() => {
                    ws.current?.send(JSON.stringify({ proposal_open_contract: 1, contract_id: contractId }));
                }, 500);

                const resultHandler = (e2: MessageEvent) => {
                    const d2 = JSON.parse(e2.data);
                    if (d2.msg_type === 'proposal_open_contract' && d2.proposal_open_contract?.contract_id === contractId) {
                        const contract = d2.proposal_open_contract;
                        if (contract.is_sold) {
                            clearInterval(poll);
                            ws.current?.removeEventListener('message', resultHandler);
                            ws.current?.removeEventListener('message', handler);

                            const realProfit = parseFloat(contract.profit);
                            tradeCountRef.current += 1;
                            const trade: TradeResult = {
                                id: tradeCountRef.current,
                                stake: currentStake,
                                result: realProfit >= 0 ? 'win' : 'lose',
                                profit: realProfit,
                                pattern_used: outcome,
                                time: new Date().toLocaleTimeString(),
                            };
                            setTrades(prev => [trade, ...prev].slice(0, 50));
                            setTotalProfit(prev => prev + realProfit);
                            setPatternIndex(nextIndex);
                            setIsTrading(false);
                            setStatus(`Trade ${realProfit >= 0 ? 'WON' : 'LOST'}: $${realProfit.toFixed(2)}`);

                            if (autoRunRef.current) {
                                setTimeout(() => executeTrade(), 500);
                            }
                        }
                    }
                };
                ws.current?.addEventListener('message', resultHandler);
            }
        };
        ws.current.addEventListener('message', handler);
    };

    const addToPattern = (item: PatternItem) => setPattern(prev => [...prev, item]);
    const removeFromPattern = (i: number) => setPattern(prev => prev.filter((_, idx) => idx !== i));
    const resetPattern = () => { setPattern(['W', 'W', 'W', 'L']); setPatternIndex(0); };

    if (!authed) return (
        <div style={{ maxWidth: 400, margin: '100px auto', padding: 32, background: '#fff', borderRadius: 12, boxShadow: '0 2px 16px rgba(0,0,0,0.10)' }}>
            <h2 style={{ marginBottom: 24 }}>Admin Trade</h2>
            <form onSubmit={handleAuth}>
                <input type='password' placeholder='Admin password' value={password} onChange={e => setPassword(e.target.value)} style={{ width: '100%', padding: '10px 14px', borderRadius: 8, border: '1px solid #ddd', marginBottom: 12, fontSize: 15, boxSizing: 'border-box' }} />
                {status && <p style={{ color: 'red', marginBottom: 8 }}>{status}</p>}
                <button type='submit' style={{ width: '100%', padding: '10px 0', background: '#1a237e', color: '#fff', border: 'none', borderRadius: 8, fontSize: 15, cursor: 'pointer' }}>Enter</button>
            </form>
        </div>
    );

    return (
        <div style={{ maxWidth: 900, margin: '32px auto', padding: '0 16px', fontFamily: 'sans-serif' }}>
            <h2 style={{ marginBottom: 4 }}>Admin Trade — Demo Only</h2>
            <p style={{ color: '#888', marginBottom: 24, fontSize: 13 }}>This interface is invisible to regular users. Trades execute on your Deriv demo account.</p>

            {/* Connection */}
            <div style={{ background: '#fff', borderRadius: 10, padding: 20, boxShadow: '0 1px 8px rgba(0,0,0,0.08)', marginBottom: 16 }}>
                <h3 style={{ margin: '0 0 12px' }}>Connection</h3>
                <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
                    <input placeholder='Deriv demo API token' value={token} onChange={e => setToken(e.target.value)} style={{ flex: 1, padding: '8px 12px', borderRadius: 8, border: '1px solid #ddd', fontSize: 14 }} />
                    <button onClick={connect} disabled={connected} style={{ padding: '8px 20px', background: connected ? '#888' : '#1a237e', color: '#fff', border: 'none', borderRadius: 8, cursor: connected ? 'default' : 'pointer' }}>{connected ? 'Connected' : 'Connect'}</button>
                </div>
                <p style={{ margin: 0, fontSize: 13, color: connected ? '#2e7d32' : '#888' }}>{status || 'Not connected'}</p>
                {balance !== null && <p style={{ margin: '8px 0 0', fontWeight: 700, fontSize: 18 }}>Balance: ${balance.toFixed(2)} USD</p>}
            </div>

            {/* Pattern Editor */}
            <div style={{ background: '#fff', borderRadius: 10, padding: 20, boxShadow: '0 1px 8px rgba(0,0,0,0.08)', marginBottom: 16 }}>
                <h3 style={{ margin: '0 0 12px' }}>Win/Loss Pattern (repeats)</h3>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
                    {pattern.map((item, i) => (
                        <div key={i} onClick={() => removeFromPattern(i)} title='Click to remove'
                            style={{ padding: '6px 14px', borderRadius: 20, background: item === 'W' ? '#e8f5e9' : '#ffebee', color: item === 'W' ? '#2e7d32' : '#c62828', fontWeight: 700, cursor: 'pointer', border: i === patternIndex % pattern.length ? '2px solid #1a237e' : '2px solid transparent' }}>
                            {item} {i === patternIndex % pattern.length ? '←' : ''}
                        </div>
                    ))}
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                    <button onClick={() => addToPattern('W')} style={{ padding: '6px 16px', background: '#e8f5e9', color: '#2e7d32', border: 'none', borderRadius: 8, fontWeight: 700, cursor: 'pointer' }}>+ Win</button>
                    <button onClick={() => addToPattern('L')} style={{ padding: '6px 16px', background: '#ffebee', color: '#c62828', border: 'none', borderRadius: 8, fontWeight: 700, cursor: 'pointer' }}>+ Lose</button>
                    <button onClick={resetPattern} style={{ padding: '6px 16px', background: '#f5f5f5', color: '#666', border: 'none', borderRadius: 8, cursor: 'pointer' }}>Reset</button>
                </div>
            </div>

            {/* Trade Controls */}
            <div style={{ background: '#fff', borderRadius: 10, padding: 20, boxShadow: '0 1px 8px rgba(0,0,0,0.08)', marginBottom: 16 }}>
                <h3 style={{ margin: '0 0 12px' }}>Trade Controls</h3>
                <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap', marginBottom: 12 }}>
                    <div>
                        <label style={{ fontSize: 12, color: '#888', display: 'block', marginBottom: 4 }}>Stake (USD)</label>
                        <input type='number' min={0.35} step={0.01} value={stake} onChange={e => setStake(parseFloat(e.target.value))}
                            style={{ width: 90, padding: '8px 10px', borderRadius: 8, border: '1px solid #ddd', fontSize: 14 }} />
                    </div>
                    <div>
                        <label style={{ fontSize: 12, color: '#888', display: 'block', marginBottom: 4 }}>Symbol</label>
                        <select value={symbol} onChange={e => setSymbol(e.target.value)} style={{ padding: '8px 10px', borderRadius: 8, border: '1px solid #ddd', fontSize: 14 }}>
                            <option value='R_100'>Volatility 100</option>
                            <option value='R_75'>Volatility 75</option>
                            <option value='R_50'>Volatility 50</option>
                            <option value='R_25'>Volatility 25</option>
                            <option value='R_10'>Volatility 10</option>
                            <option value='1HZ100V'>Volatility 100 (1s)</option>
                            <option value='1HZ75V'>Volatility 75 (1s)</option>
                            <option value='1HZ50V'>Volatility 50 (1s)</option>
                            <option value='1HZ25V'>Volatility 25 (1s)</option>
                            <option value='1HZ10V'>Volatility 10 (1s)</option>
                        </select>
                    </div>
                </div>
                <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                    <button onClick={executeTrade} disabled={!connected || isTrading}
                        style={{ padding: '10px 28px', background: !connected || isTrading ? '#ccc' : '#1a237e', color: '#fff', border: 'none', borderRadius: 8, fontSize: 15, fontWeight: 700, cursor: !connected || isTrading ? 'default' : 'pointer' }}>
                        {isTrading ? 'Trading...' : 'Place Trade'}
                    </button>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: 14 }}>
                        <input type='checkbox' checked={autoRun} onChange={e => setAutoRun(e.target.checked)} />
                        Auto-run (repeats pattern)
                    </label>
                    {autoRun && <button onClick={() => setAutoRun(false)} style={{ padding: '8px 16px', background: '#ffebee', color: '#c62828', border: 'none', borderRadius: 8, cursor: 'pointer' }}>Stop</button>}
                </div>
            </div>

            {/* Results */}
            <div style={{ background: '#fff', borderRadius: 10, padding: 20, boxShadow: '0 1px 8px rgba(0,0,0,0.08)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                    <h3 style={{ margin: 0 }}>Trade Results</h3>
                    <span style={{ fontWeight: 700, color: totalProfit >= 0 ? '#2e7d32' : '#c62828' }}>Total P&L: ${totalProfit.toFixed(2)}</span>
                </div>
                {trades.length === 0 ? <p style={{ color: '#888', textAlign: 'center', padding: 24 }}>No trades yet</p> : (
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                        <thead>
                            <tr style={{ background: '#f8f9fa' }}>
                                {['#', 'Time', 'Symbol', 'Stake', 'Pattern', 'Result', 'Profit'].map(h => (
                                    <th key={h} style={{ padding: '8px 12px', textAlign: 'left', fontWeight: 600 }}>{h}</th>
                                ))}
                            </tr>
                        </thead>
                        <tbody>
                            {trades.map(t => (
                                <tr key={t.id} style={{ borderBottom: '1px solid #f0f0f0' }}>
                                    <td style={{ padding: '8px 12px' }}>{t.id}</td>
                                    <td style={{ padding: '8px 12px', color: '#888' }}>{t.time}</td>
                                    <td style={{ padding: '8px 12px' }}>{symbol}</td>
                                    <td style={{ padding: '8px 12px' }}>${t.stake.toFixed(2)}</td>
                                    <td style={{ padding: '8px 12px' }}>
                                        <span style={{ padding: '2px 10px', borderRadius: 12, background: t.pattern_used === 'W' ? '#e8f5e9' : '#ffebee', color: t.pattern_used === 'W' ? '#2e7d32' : '#c62828', fontWeight: 700 }}>{t.pattern_used}</span>
                                    </td>
                                    <td style={{ padding: '8px 12px', fontWeight: 600, color: t.result === 'win' ? '#2e7d32' : '#c62828' }}>{t.result.toUpperCase()}</td>
                                    <td style={{ padding: '8px 12px', color: t.profit >= 0 ? '#2e7d32' : '#c62828' }}>${t.profit.toFixed(2)}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                )}
            </div>
        </div>
    );
};
export default AdminTrade;
