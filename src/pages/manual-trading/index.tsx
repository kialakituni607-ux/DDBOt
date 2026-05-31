import React, { useCallback, useEffect, useRef, useState } from 'react';
import './manual-trading.scss';

const WS_URL = 'wss://ws.derivws.com/websockets/v3?app_id=116874';

// ── Contract groups ────────────────────────────────────────────────────────
const CONTRACT_GROUPS = [
    { id: 'RISE_FALL',    label: 'Rise/Fall' },
    { id: 'HIGHER_LOWER', label: 'Higher/Lower' },
    { id: 'TOUCH',        label: 'Touch/No Touch' },
    { id: 'ACCUMULATOR',  label: 'Accumulators' },
    { id: 'EVEN_ODD',     label: 'Odd/Even' },
    { id: 'MATCH_DIFFER', label: 'Matches/Differs' },
    { id: 'OVER_UNDER',   label: 'Over/Under' },
    { id: 'MULTIPLIER',   label: 'Multipliers' },
    { id: 'TURBO',        label: 'Turbos' },
    { id: 'VANILLA',      label: 'Vanillas' },
];

// Markets per group
const DIGIT_MARKETS = [
    { symbol: '1HZ100V', label: 'Volatility 100 (1s) Index' },
    { symbol: '1HZ75V',  label: 'Volatility 75 (1s) Index' },
    { symbol: '1HZ50V',  label: 'Volatility 50 (1s) Index' },
    { symbol: '1HZ25V',  label: 'Volatility 25 (1s) Index' },
    { symbol: '1HZ10V',  label: 'Volatility 10 (1s) Index' },
    { symbol: 'R_100',   label: 'Volatility 100 Index' },
    { symbol: 'R_75',    label: 'Volatility 75 Index' },
    { symbol: 'R_50',    label: 'Volatility 50 Index' },
    { symbol: 'R_25',    label: 'Volatility 25 Index' },
    { symbol: 'R_10',    label: 'Volatility 10 Index' },
];

const ACCU_MARKETS = [
    { symbol: '1HZ100V', label: 'Volatility 100 (1s) Index' },
    { symbol: '1HZ75V',  label: 'Volatility 75 (1s) Index' },
    { symbol: '1HZ50V',  label: 'Volatility 50 (1s) Index' },
    { symbol: '1HZ25V',  label: 'Volatility 25 (1s) Index' },
    { symbol: '1HZ10V',  label: 'Volatility 10 (1s) Index' },
];

const TURBO_MARKETS = [
    { symbol: 'STPRNG',  label: 'Volatility 100 (1s) Index' },
    { symbol: '1HZ100V', label: 'Volatility 100 (1s) Index' },
    { symbol: '1HZ75V',  label: 'Volatility 75 (1s) Index' },
    { symbol: '1HZ50V',  label: 'Volatility 50 (1s) Index' },
];

const VANILLA_MARKETS = [
    { symbol: 'frxEURUSD', label: 'EUR/USD' },
    { symbol: 'frxGBPUSD', label: 'GBP/USD' },
    { symbol: 'frxAUDUSD', label: 'AUD/USD' },
    { symbol: 'frxUSDJPY', label: 'USD/JPY' },
    { symbol: 'frxUSDCAD', label: 'USD/CAD' },
];

const MULT_MARKETS = [
    { symbol: '1HZ100V', label: 'Volatility 100 (1s) Index' },
    { symbol: '1HZ75V',  label: 'Volatility 75 (1s) Index' },
    { symbol: '1HZ50V',  label: 'Volatility 50 (1s) Index' },
    { symbol: 'R_100',   label: 'Volatility 100 Index' },
    { symbol: 'R_50',    label: 'Volatility 50 Index' },
    { symbol: 'R_25',    label: 'Volatility 25 Index' },
    { symbol: 'R_10',    label: 'Volatility 10 Index' },
];

function marketsForGroup(group: string) {
    if (group === 'ACCUMULATOR') return ACCU_MARKETS;
    if (group === 'TURBO') return TURBO_MARKETS;
    if (group === 'VANILLA') return VANILLA_MARKETS;
    if (group === 'MULTIPLIER') return MULT_MARKETS;
    return DIGIT_MARKETS;
}

// ── Types ──────────────────────────────────────────────────────────────────
type Tick = { epoch: number; quote: number };
type Position = {
    id: number;
    label: string;
    stake: number;
    profit?: number;
    status: 'open' | 'won' | 'lost';
};

function getLastDigit(price: number) {
    const s = price.toFixed(2);
    return parseInt(s[s.length - 1], 10);
}

function digitPcts(ticks: Tick[]): number[] {
    const counts = new Array(10).fill(0);
    ticks.forEach(t => counts[getLastDigit(t.quote)]++);
    const n = ticks.length || 1;
    return counts.map(c => Math.round((c / n) * 1000) / 10);
}

// ── SVG Chart ──────────────────────────────────────────────────────────────
const LiveChart: React.FC<{ ticks: Tick[]; w: number; h: number }> = ({ ticks, w, h }) => {
    if (ticks.length < 2) return null;
    const prices = ticks.map(t => t.quote);
    const min = Math.min(...prices);
    const max = Math.max(...prices);
    const range = max - min || 1;
    const px = 6;
    const py = 16;
    const cw = w - px * 2;
    const ch = h - py * 2;

    const pts = prices.map((p, i) => {
        const x = px + (i / (prices.length - 1)) * cw;
        const y = py + (1 - (p - min) / range) * ch;
        return `${x},${y}`;
    });
    const path = 'M' + pts.join('L');
    const area = path + `L${px + cw},${py + ch}L${px},${py + ch}Z`;
    const lx = px + cw;
    const ly = py + (1 - (prices[prices.length - 1] - min) / range) * ch;

    return (
        <svg width={w} height={h} style={{ display: 'block', width: '100%', height: '100%' }}>
            <defs>
                <linearGradient id='mtg' x1='0' y1='0' x2='0' y2='1'>
                    <stop offset='0%' stopColor='#85e044' stopOpacity='0.25' />
                    <stop offset='100%' stopColor='#85e044' stopOpacity='0' />
                </linearGradient>
            </defs>
            <path d={area} fill='url(#mtg)' />
            <path d={path} fill='none' stroke='#85e044' strokeWidth='1.5' />
            <circle cx={lx} cy={ly} r='4' fill='#85e044' />
        </svg>
    );
};

// ── Main component ─────────────────────────────────────────────────────────
const ManualTrading: React.FC = () => {
    // Auth
    const [token, setToken]       = useState('');
    const [authed, setAuthed]     = useState(false);
    const [authErr, setAuthErr]   = useState('');

    // Market / contract
    const [group, setGroup]       = useState('RISE_FALL');
    const markets = marketsForGroup(group);
    const [symbol, setSymbol]     = useState(markets[0].symbol);

    // Trading state — common
    const [side, setSide]         = useState<string>('call'); // varies per group
    const [barrier, setBarrier]   = useState(5);            // digit 0-9
    const [barrierPrice, setBarrierPrice] = useState('');   // price-level barrier
    const [duration, setDuration] = useState(5);
    const [durUnit, setDurUnit]   = useState('t');
    const [stake, setStake]       = useState('1');
    const [growthRate, setGrowthRate] = useState(0.03);      // accumulators
    const [multiplier, setMultiplier] = useState(10);        // multipliers

    // Proposal / buy
    const [payout, setPayout]     = useState<number | null>(null);
    const [propId, setPropId]     = useState<string | null>(null);
    const [buying, setBuying]     = useState(false);
    const [buyErr, setBuyErr]     = useState('');

    // Ticks + chart
    const [ticks, setTicks]       = useState<Tick[]>([]);
    const [lastPrice, setLastPrice] = useState<number | null>(null);
    const [prevPrice, setPrevPrice] = useState<number | null>(null);

    // Positions
    const [positions, setPositions] = useState<Position[]>([]);

    const wsRef       = useRef<WebSocket | null>(null);
    const tickSub     = useRef<string | null>(null);
    const propSubRef  = useRef<string | null>(null);   // ref avoids stale-closure on forget
    const askPriceRef = useRef<number>(1);             // ask_price from latest proposal
    const chartRef    = useRef<HTMLDivElement>(null);
    const tabsRef     = useRef<HTMLDivElement>(null);
    const [chartW, setChartW] = useState(800);
    const [chartH, setChartH] = useState(300);

    const pcts = digitPcts(ticks.slice(-500));

    // Resize chart
    useEffect(() => {
        if (!chartRef.current) return;
        const ro = new ResizeObserver(([e]) => {
            setChartW(e.contentRect.width);
            setChartH(e.contentRect.height);
        });
        ro.observe(chartRef.current);
        return () => ro.disconnect();
    }, []);

    // Load token from localStorage
    useEffect(() => {
        try {
            const raw = localStorage.getItem('client.accounts');
            if (raw) {
                const obj = JSON.parse(raw);
                const key = Object.keys(obj)[0];
                if (key && obj[key]?.token) { setToken(obj[key].token); return; }
            }
        } catch { /* ignore */ }
        const t = localStorage.getItem('authToken') || localStorage.getItem('deriv_api_token') || '';
        if (t) setToken(t);
    }, []);

    const sendWs = useCallback((msg: object) => {
        if (wsRef.current?.readyState === WebSocket.OPEN)
            wsRef.current.send(JSON.stringify(msg));
    }, []);

    // Connect
    useEffect(() => {
        if (!token) return;
        wsRef.current?.close();
        setAuthed(false); setAuthErr(''); setPropId(null); setPayout(null);

        const ws = new WebSocket(WS_URL);
        wsRef.current = ws;

        ws.onopen = () => ws.send(JSON.stringify({ authorize: token }));

        ws.onmessage = evt => {
            const msg = JSON.parse(evt.data);

            if (msg.msg_type === 'authorize') {
                if (msg.error) { setAuthErr(msg.error.message); return; }
                setAuthed(true); setAuthErr('');
                ws.send(JSON.stringify({ ticks_history: symbol, count: 200, end: 'latest', style: 'ticks', subscribe: 1 }));
            }

            if (msg.msg_type === 'history') {
                const h = msg.history;
                if (!h) return;
                const combined: Tick[] = h.times.map((e: number, i: number) => ({ epoch: e, quote: parseFloat(h.prices[i]) }));
                setTicks(combined);
                if (msg.subscription?.id) tickSub.current = msg.subscription.id;
            }

            if (msg.msg_type === 'tick') {
                const t = msg.tick;
                if (!t || t.symbol !== symbol) return;
                const q = parseFloat(t.quote);
                setLastPrice(old => { setPrevPrice(old); return q; });
                setTicks(prev => [...prev.slice(-599), { epoch: t.epoch, quote: q }]);
            }

            if (msg.msg_type === 'proposal') {
                if (msg.error) { setPayout(null); setPropId(null); return; }
                const p = msg.proposal;
                if (!p) return;
                // ask_price is what Deriv requires as the buy `price` param
                askPriceRef.current = parseFloat(p.ask_price ?? p.display_value ?? p.payout ?? stake) || 1;
                setPayout(parseFloat(p.payout || p.display_value || '0'));
                setPropId(p.id);
                if (msg.subscription?.id) propSubRef.current = msg.subscription.id;
            }

            if (msg.msg_type === 'buy') {
                setBuying(false);
                if (msg.error) { setBuyErr(msg.error.message); return; }
                const b = msg.buy;
                if (!b) return;
                setBuyErr('');
                const pos: Position = { id: b.contract_id, label: buildLabel(), stake: parseFloat(stake) || 1, status: 'open' };
                setPositions(prev => [pos, ...prev.slice(0, 11)]);
                ws.send(JSON.stringify({ proposal_open_contract: 1, contract_id: b.contract_id, subscribe: 1 }));
            }

            if (msg.msg_type === 'proposal_open_contract') {
                const poc = msg.proposal_open_contract;
                if (!poc) return;
                if (poc.status === 'won' || poc.status === 'lost') {
                    const pl = parseFloat(poc.profit || '0');
                    setPositions(prev => prev.map(p =>
                        p.id === poc.contract_id ? { ...p, status: poc.status, profit: pl } : p
                    ));
                }
            }
        };

        ws.onerror = () => setAuthErr('Connection error.');
        ws.onclose = () => setAuthed(false);

        return () => { ws.close(); };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [token]);

    // Re-subscribe ticks on symbol change
    useEffect(() => {
        if (!authed || !wsRef.current) return;
        if (tickSub.current) { sendWs({ forget: tickSub.current }); tickSub.current = null; }
        setTicks([]); setLastPrice(null); setPrevPrice(null);
        sendWs({ ticks_history: symbol, count: 200, end: 'latest', style: 'ticks', subscribe: 1 });
    }, [symbol, authed, sendWs]);

    // Build proposal params
    const buildProposal = useCallback((): Record<string, any> | null => {
        const amount = parseFloat(stake);
        if (!amount || amount <= 0) return null;

        const base = { proposal: 1, subscribe: 1, amount, basis: 'stake', currency: 'USD', symbol };

        if (group === 'RISE_FALL') {
            return { ...base, contract_type: side === 'call' ? 'CALL' : 'PUT', duration: Math.max(1, duration), duration_unit: 't' };
        }
        if (group === 'HIGHER_LOWER') {
            return { ...base, contract_type: side === 'call' ? 'CALL' : 'PUT', duration: Math.max(1, duration), duration_unit: durUnit };
        }
        if (group === 'TOUCH') {
            const ct = side === 'touch' ? 'ONETOUCH' : 'NOTOUCH';
            const bp = parseFloat(barrierPrice);
            if (!bp) return null;
            return { ...base, contract_type: ct, duration: Math.max(1, duration), duration_unit: durUnit, barrier: bp };
        }
        if (group === 'ACCUMULATOR') {
            return { ...base, contract_type: 'ACCU', growth_rate: growthRate };
        }
        if (group === 'EVEN_ODD') {
            return { ...base, contract_type: side === 'even' ? 'DIGITEVEN' : 'DIGITODD', duration: Math.max(1, duration), duration_unit: 't' };
        }
        if (group === 'MATCH_DIFFER') {
            return { ...base, contract_type: side === 'match' ? 'DIGITMATCH' : 'DIGITDIFF', duration: Math.max(1, duration), duration_unit: 't', barrier };
        }
        if (group === 'OVER_UNDER') {
            return { ...base, contract_type: side === 'over' ? 'DIGITOVER' : 'DIGITUNDER', duration: Math.max(1, duration), duration_unit: 't', barrier };
        }
        if (group === 'MULTIPLIER') {
            return { ...base, contract_type: side === 'up' ? 'MULTUP' : 'MULTDOWN', multiplier };
        }
        if (group === 'TURBO') {
            const bp = parseFloat(barrierPrice);
            if (!bp) return null;
            return { ...base, contract_type: side === 'long' ? 'TURBOSLONG' : 'TURBOSSHORT', duration: Math.max(1, duration), duration_unit: durUnit, barrier: bp };
        }
        if (group === 'VANILLA') {
            const bp = parseFloat(barrierPrice);
            if (!bp) return null;
            return { ...base, contract_type: side === 'call' ? 'VANILLALONGCALL' : 'VANILLALONGPUT', duration: Math.max(1, duration), duration_unit: durUnit, barrier: bp };
        }
        return null;
    }, [group, side, barrier, barrierPrice, duration, durUnit, stake, symbol, growthRate, multiplier]);

    const buildLabel = () => {
        const g = CONTRACT_GROUPS.find(x => x.id === group);
        return `${g?.label} · ${side.toUpperCase()}`;
    };

    // Subscribe proposal on param changes (uses ref to avoid stale closures)
    useEffect(() => {
        if (!authed) return;
        // Forget previous subscription immediately using the ref value
        if (propSubRef.current) {
            sendWs({ forget: propSubRef.current });
            propSubRef.current = null;
        }
        setPropId(null); setPayout(null);

        const t = setTimeout(() => {
            const params = buildProposal();
            if (params) sendWs(params);
        }, 400);
        return () => clearTimeout(t);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [authed, group, side, barrier, barrierPrice, duration, durUnit, stake, symbol, growthRate, multiplier]);

    // Reset side / symbol when group changes
    useEffect(() => {
        const m = marketsForGroup(group);
        setSymbol(m[0].symbol);
        if (group === 'RISE_FALL' || group === 'HIGHER_LOWER' || group === 'TOUCH') setSide('call');
        else if (group === 'EVEN_ODD') setSide('even');
        else if (group === 'MATCH_DIFFER') setSide('differ');
        else if (group === 'OVER_UNDER') setSide('over');
        else if (group === 'MULTIPLIER') setSide('up');
        else if (group === 'TURBO') setSide('long');
        else if (group === 'VANILLA') setSide('call');
        else if (group === 'ACCUMULATOR') setSide('accu');
        setBarrierPrice('');
        setBarrier(5);
    }, [group]);

    const handleBuy = () => {
        if (!propId || buying) return;
        setBuying(true); setBuyErr('');
        // Must send ask_price (not raw stake) — Deriv rejects if price doesn't match
        sendWs({ buy: propId, price: askPriceRef.current });
    };

    const needsDigit = group === 'OVER_UNDER' || group === 'MATCH_DIFFER';
    const needsPriceBarrier = group === 'TOUCH' || group === 'TURBO' || group === 'VANILLA';
    const showDuration = !['ACCUMULATOR', 'MULTIPLIER'].includes(group);
    const showDigitBar = ['OVER_UNDER', 'MATCH_DIFFER', 'EVEN_ODD', 'RISE_FALL'].includes(group);

    const dir = lastPrice !== null && prevPrice !== null
        ? lastPrice > prevPrice ? 'up' : lastPrice < prevPrice ? 'down' : 'flat'
        : 'flat';

    // Duration unit options per group
    const durUnits = () => {
        if (['RISE_FALL', 'EVEN_ODD', 'MATCH_DIFFER', 'OVER_UNDER'].includes(group))
            return [{ v: 't', l: 'Ticks' }];
        if (group === 'VANILLA')
            return [{ v: 'd', l: 'Days' }, { v: 'm', l: 'Mins' }];
        return [{ v: 'm', l: 'Mins' }, { v: 'h', l: 'Hours' }, { v: 'd', l: 'Days' }];
    };

    const scrollTabs = (dir: 'left' | 'right') => {
        if (tabsRef.current) tabsRef.current.scrollBy({ left: dir === 'left' ? -160 : 160, behavior: 'smooth' });
    };

    return (
        <div className='manual-trading'>
            {/* Contract type tabs with scroll arrows */}
            <div className='manual-trading__ct-bar'>
                <button className='manual-trading__ct-arrow' onClick={() => scrollTabs('left')}>‹</button>
                <div className='manual-trading__ct-tabs' ref={tabsRef}>
                    {CONTRACT_GROUPS.map(cg => (
                        <div
                            key={cg.id}
                            className={`manual-trading__ct-tab${group === cg.id ? ' manual-trading__ct-tab--active' : ''}`}
                            onClick={() => setGroup(cg.id)}
                        >
                            {cg.label}
                        </div>
                    ))}
                </div>
                <button className='manual-trading__ct-arrow' onClick={() => scrollTabs('right')}>›</button>
            </div>

            {/* Market bar */}
            <div className='manual-trading__market-bar'>
                <select
                    className='manual-trading__market-select'
                    value={symbol}
                    onChange={e => setSymbol(e.target.value)}
                >
                    {markets.map(m => <option key={m.symbol} value={m.symbol}>{m.label}</option>)}
                </select>
                {lastPrice !== null && (
                    <>
                        <span className='manual-trading__price'>{lastPrice.toFixed(2)}</span>
                        <span className={`manual-trading__price-dir manual-trading__price-dir--${dir}`}>
                            {dir === 'up' ? '▲' : dir === 'down' ? '▼' : '—'}
                        </span>
                    </>
                )}
                {authed && <div className='manual-trading__live-pip' />}
            </div>

            {/* Body */}
            <div className='manual-trading__body'>
                {/* Chart column */}
                <div className='manual-trading__chart-col'>
                    <div className='manual-trading__chart-area' ref={chartRef}>
                        {ticks.length < 2
                            ? <div className='manual-trading__chart-empty'>{authed ? 'Loading chart…' : 'Please log in to view chart'}</div>
                            : <LiveChart ticks={ticks.slice(-200)} w={chartW} h={chartH} />
                        }
                    </div>

                    {/* Digit stats bar — shown for digit-relevant groups */}
                    {showDigitBar && (
                        <div className='manual-trading__digit-row'>
                            {Array.from({ length: 10 }, (_, d) => (
                                <div
                                    key={d}
                                    className={`manual-trading__digit-cell${needsDigit && barrier === d ? ' manual-trading__digit-cell--sel' : ''}`}
                                    onClick={() => needsDigit && setBarrier(d)}
                                >
                                    <span className='manual-trading__digit-num'>{d}</span>
                                    <span className='manual-trading__digit-pct'>{pcts[d]}%</span>
                                </div>
                            ))}
                        </div>
                    )}
                </div>

                {/* Trading panel */}
                <div className='manual-trading__panel'>
                    {authErr && <div className='manual-trading__error'>{authErr}</div>}
                    {!authed && !authErr && (
                        <div className='manual-trading__no-auth'>
                            <span style={{ fontSize: 28 }}>🔌</span>
                            <span>Connecting to Deriv…</span>
                        </div>
                    )}

                    {authed && (
                        <>
                            {/* ── Side toggle ── */}
                            {group === 'RISE_FALL' && (
                                <div>
                                    <span className='manual-trading__label'>Direction</span>
                                    <div className='manual-trading__toggle'>
                                        <button className={`manual-trading__toggle-btn${side === 'call' ? ' manual-trading__toggle-btn--on' : ''}`} onClick={() => setSide('call')}>Rise</button>
                                        <button className={`manual-trading__toggle-btn${side === 'put' ? ' manual-trading__toggle-btn--on' : ''}`} onClick={() => setSide('put')}>Fall</button>
                                    </div>
                                </div>
                            )}
                            {group === 'HIGHER_LOWER' && (
                                <div>
                                    <span className='manual-trading__label'>Direction</span>
                                    <div className='manual-trading__toggle'>
                                        <button className={`manual-trading__toggle-btn${side === 'call' ? ' manual-trading__toggle-btn--on' : ''}`} onClick={() => setSide('call')}>Higher</button>
                                        <button className={`manual-trading__toggle-btn${side === 'put' ? ' manual-trading__toggle-btn--on' : ''}`} onClick={() => setSide('put')}>Lower</button>
                                    </div>
                                </div>
                            )}
                            {group === 'TOUCH' && (
                                <div>
                                    <span className='manual-trading__label'>Type</span>
                                    <div className='manual-trading__toggle'>
                                        <button className={`manual-trading__toggle-btn${side === 'touch' ? ' manual-trading__toggle-btn--on' : ''}`} onClick={() => setSide('touch')}>Touch</button>
                                        <button className={`manual-trading__toggle-btn${side === 'notouch' ? ' manual-trading__toggle-btn--on' : ''}`} onClick={() => setSide('notouch')}>No Touch</button>
                                    </div>
                                </div>
                            )}
                            {group === 'EVEN_ODD' && (
                                <div>
                                    <span className='manual-trading__label'>Direction</span>
                                    <div className='manual-trading__toggle'>
                                        <button className={`manual-trading__toggle-btn${side === 'even' ? ' manual-trading__toggle-btn--on' : ''}`} onClick={() => setSide('even')}>Even</button>
                                        <button className={`manual-trading__toggle-btn${side === 'odd' ? ' manual-trading__toggle-btn--on' : ''}`} onClick={() => setSide('odd')}>Odd</button>
                                    </div>
                                </div>
                            )}
                            {group === 'MATCH_DIFFER' && (
                                <div>
                                    <span className='manual-trading__label'>Type</span>
                                    <div className='manual-trading__toggle'>
                                        <button className={`manual-trading__toggle-btn${side === 'match' ? ' manual-trading__toggle-btn--on' : ''}`} onClick={() => setSide('match')}>Matches</button>
                                        <button className={`manual-trading__toggle-btn${side === 'differ' ? ' manual-trading__toggle-btn--on' : ''}`} onClick={() => setSide('differ')}>Differs</button>
                                    </div>
                                </div>
                            )}
                            {group === 'OVER_UNDER' && (
                                <div>
                                    <span className='manual-trading__label'>Type</span>
                                    <div className='manual-trading__toggle'>
                                        <button className={`manual-trading__toggle-btn${side === 'over' ? ' manual-trading__toggle-btn--on' : ''}`} onClick={() => setSide('over')}>Over</button>
                                        <button className={`manual-trading__toggle-btn${side === 'under' ? ' manual-trading__toggle-btn--on' : ''}`} onClick={() => setSide('under')}>Under</button>
                                    </div>
                                </div>
                            )}
                            {group === 'MULTIPLIER' && (
                                <div>
                                    <span className='manual-trading__label'>Direction</span>
                                    <div className='manual-trading__toggle'>
                                        <button className={`manual-trading__toggle-btn${side === 'up' ? ' manual-trading__toggle-btn--on' : ''}`} onClick={() => setSide('up')}>Up</button>
                                        <button className={`manual-trading__toggle-btn${side === 'down' ? ' manual-trading__toggle-btn--on' : ''}`} onClick={() => setSide('down')}>Down</button>
                                    </div>
                                </div>
                            )}
                            {group === 'TURBO' && (
                                <div>
                                    <span className='manual-trading__label'>Direction</span>
                                    <div className='manual-trading__toggle'>
                                        <button className={`manual-trading__toggle-btn${side === 'long' ? ' manual-trading__toggle-btn--on' : ''}`} onClick={() => setSide('long')}>Long</button>
                                        <button className={`manual-trading__toggle-btn${side === 'short' ? ' manual-trading__toggle-btn--on' : ''}`} onClick={() => setSide('short')}>Short</button>
                                    </div>
                                </div>
                            )}
                            {group === 'VANILLA' && (
                                <div>
                                    <span className='manual-trading__label'>Type</span>
                                    <div className='manual-trading__toggle'>
                                        <button className={`manual-trading__toggle-btn${side === 'call' ? ' manual-trading__toggle-btn--on' : ''}`} onClick={() => setSide('call')}>Call</button>
                                        <button className={`manual-trading__toggle-btn${side === 'put' ? ' manual-trading__toggle-btn--on' : ''}`} onClick={() => setSide('put')}>Put</button>
                                    </div>
                                </div>
                            )}

                            {/* ── Accumulators: growth rate ── */}
                            {group === 'ACCUMULATOR' && (
                                <div className='manual-trading__input-wrap'>
                                    <span className='manual-trading__label'>Growth Rate</span>
                                    <div className='manual-trading__chips'>
                                        {[0.01, 0.02, 0.03, 0.04, 0.05].map(r => (
                                            <div
                                                key={r}
                                                className={`manual-trading__chip${growthRate === r ? ' manual-trading__chip--sel' : ''}`}
                                                onClick={() => setGrowthRate(r)}
                                            >
                                                {(r * 100).toFixed(0)}%
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}

                            {/* ── Multipliers: multiplier value ── */}
                            {group === 'MULTIPLIER' && (
                                <div className='manual-trading__input-wrap'>
                                    <span className='manual-trading__label'>Multiplier</span>
                                    <div className='manual-trading__mult-chips'>
                                        {[10, 20, 50, 100, 200, 300, 400, 500].map(m => (
                                            <div
                                                key={m}
                                                className={`manual-trading__chip${multiplier === m ? ' manual-trading__chip--sel' : ''}`}
                                                onClick={() => setMultiplier(m)}
                                            >
                                                ×{m}
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}

                            {/* ── Digit picker (panel) ── */}
                            {needsDigit && (
                                <div className='manual-trading__input-wrap'>
                                    <span className='manual-trading__label'>Last digit prediction</span>
                                    <div className='manual-trading__digit-grid'>
                                        {Array.from({ length: 10 }, (_, d) => (
                                            <button
                                                key={d}
                                                className={`manual-trading__digit-btn${barrier === d ? ' manual-trading__digit-btn--sel' : ''}`}
                                                onClick={() => setBarrier(d)}
                                            >
                                                <span className='manual-trading__digit-btn-num'>{d}</span>
                                                <span className='manual-trading__digit-btn-pct'>{pcts[d]}%</span>
                                            </button>
                                        ))}
                                    </div>
                                </div>
                            )}

                            {/* ── Price barrier (Touch, Turbo, Vanilla) ── */}
                            {needsPriceBarrier && (
                                <div className='manual-trading__input-wrap'>
                                    <span className='manual-trading__label'>Barrier {lastPrice ? `(current: ${lastPrice.toFixed(2)})` : ''}</span>
                                    <div className='manual-trading__row'>
                                        <input
                                            type='number'
                                            className='manual-trading__input'
                                            placeholder={lastPrice ? lastPrice.toFixed(2) : '0.00'}
                                            value={barrierPrice}
                                            onChange={e => setBarrierPrice(e.target.value)}
                                        />
                                    </div>
                                </div>
                            )}

                            {/* ── Duration ── */}
                            {showDuration && (
                                <div className='manual-trading__input-wrap'>
                                    <span className='manual-trading__label'>Duration</span>
                                    <div className='manual-trading__row'>
                                        <input
                                            type='number'
                                            className='manual-trading__input'
                                            value={duration}
                                            min={1}
                                            onChange={e => setDuration(Math.max(1, parseInt(e.target.value) || 1))}
                                        />
                                        <select
                                            className='manual-trading__select'
                                            value={durUnit}
                                            onChange={e => setDurUnit(e.target.value)}
                                        >
                                            {durUnits().map(u => <option key={u.v} value={u.v}>{u.l}</option>)}
                                        </select>
                                    </div>
                                </div>
                            )}

                            {/* ── Stake ── */}
                            <div className='manual-trading__input-wrap'>
                                <span className='manual-trading__label'>Stake</span>
                                <div className='manual-trading__row'>
                                    <input
                                        type='number'
                                        className='manual-trading__input'
                                        value={stake}
                                        min={0.35}
                                        step={0.01}
                                        onChange={e => setStake(e.target.value)}
                                    />
                                    <div className='manual-trading__suffix'>USD</div>
                                </div>
                            </div>

                            {/* ── Buy button ── */}
                            <button
                                className='manual-trading__buy'
                                onClick={handleBuy}
                                disabled={buying || !propId}
                            >
                                {buying ? 'Placing…' : 'Buy'}
                                {payout !== null && !buying && <small>Payout {payout.toFixed(2)} USD</small>}
                            </button>

                            {buyErr && <div className='manual-trading__error'>{buyErr}</div>}

                            {/* ── Positions ── */}
                            {positions.length > 0 && (
                                <>
                                    <div className='manual-trading__separator' />
                                    <div className='manual-trading__positions'>
                                        <span className='manual-trading__pos-title'>Recent Positions</span>
                                        {positions.map(p => (
                                            <div key={p.id} className={`manual-trading__pos-card manual-trading__pos-card--${p.status}`}>
                                                <div className='manual-trading__pos-row'>
                                                    <span className='manual-trading__pos-type'>{p.label}</span>
                                                    <span className={`manual-trading__pos-pl manual-trading__pos-pl--${p.status === 'open' ? 'open' : p.profit && p.profit > 0 ? 'pos' : 'neg'}`}>
                                                        {p.status === 'open' ? '●  Open' : `${p.profit && p.profit > 0 ? '+' : ''}${p.profit?.toFixed(2)} USD`}
                                                    </span>
                                                </div>
                                                <div className='manual-trading__pos-sub'>Stake {p.stake.toFixed(2)} USD · #{p.id}</div>
                                            </div>
                                        ))}
                                    </div>
                                </>
                            )}
                        </>
                    )}
                </div>
            </div>
        </div>
    );
};

export default ManualTrading;
