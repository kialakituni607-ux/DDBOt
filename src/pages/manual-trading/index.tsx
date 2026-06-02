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

// ── All valid Deriv Volatility Indices ─────────────────────────────────────
const ALL_VOLATILITY_MARKETS = [
    { symbol: '1HZ100V', label: 'Volatility 100 (1s) Index' },
    { symbol: '1HZ75V',  label: 'Volatility 75 (1s) Index' },
    { symbol: '1HZ50V',  label: 'Volatility 50 (1s) Index' },
    { symbol: '1HZ25V',  label: 'Volatility 25 (1s) Index' },
    { symbol: '1HZ10V',  label: 'Volatility 10 (1s) Index' },
    { symbol: '1HZ150V', label: 'Volatility 150 (1s) Index' },
    { symbol: '1HZ200V', label: 'Volatility 200 (1s) Index' },
    { symbol: '1HZ250V', label: 'Volatility 250 (1s) Index' },
    { symbol: '1HZ300V', label: 'Volatility 300 (1s) Index' },
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
    { symbol: '1HZ100V', label: 'Volatility 100 (1s) Index' },
    { symbol: '1HZ75V',  label: 'Volatility 75 (1s) Index' },
    { symbol: '1HZ50V',  label: 'Volatility 50 (1s) Index' },
    { symbol: '1HZ25V',  label: 'Volatility 25 (1s) Index' },
    { symbol: 'R_100',   label: 'Volatility 100 Index' },
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
    return ALL_VOLATILITY_MARKETS;
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
    const px = 12; const py = 20;
    const cw = w - px * 2; const ch = h - py * 2;
    // Grid lines
    const gridLines = Array.from({ length: 6 }, (_, i) => {
        const y = py + (i / 5) * ch;
        return <line key={i} x1={px} y1={y} x2={px + cw} y2={y} stroke='rgba(255,255,255,0.06)' strokeWidth='1' />;
    });
    const pts = prices.map((p, i) => {
        const x = px + (i / (prices.length - 1)) * cw;
        const y = py + (1 - (p - min) / range) * ch;
        return `${x},${y}`;
    });
    const path = 'M' + pts.join('L');
    const area = path + `L${px + cw},${py + ch}L${px},${py + ch}Z`;
    const lx = px + cw;
    const ly = py + (1 - (prices[prices.length - 1] - min) / range) * ch;
    const lastVal = prices[prices.length - 1].toFixed(2);
    return (
        <svg width={w} height={h} style={{ display: 'block', width: '100%', height: '100%' }}>
            <defs>
                <linearGradient id='mtg' x1='0' y1='0' x2='0' y2='1'>
                    <stop offset='0%' stopColor='#FFFFFF' stopOpacity='0.08' />
                    <stop offset='100%' stopColor='#FFFFFF' stopOpacity='0' />
                </linearGradient>
            </defs>
            {gridLines}
            <path d={area} fill='url(#mtg)' />
            <path d={path} fill='none' stroke='#FFFFFF' strokeWidth='1.5' />
            <circle cx={lx} cy={ly} r='4' fill='#FFFFFF' />
            {/* Price label */}
            <rect x={lx + 8} y={ly - 10} width='60' height='20' rx='4' fill='#1A2438' />
            <text x={lx + 38} y={ly + 5} textAnchor='middle' fill='#FFFFFF' fontSize='11' fontWeight='600'>{lastVal}</text>
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

    // Trading state
    const [side, setSide]         = useState<string>('call');
    const [barrier, setBarrier]   = useState(5);
    const [barrierPrice, setBarrierPrice] = useState('');
    const [durationStr, setDurationStr]   = useState('5');   // string so user can clear field
    const [durUnit, setDurUnit]   = useState('t');
    const [stake, setStake]       = useState('1');
    const [growthRate, setGrowthRate] = useState(0.03);
    const [multiplier, setMultiplier] = useState(10);

    // Proposal / buy
    const [payout, setPayout]     = useState<number | null>(null);
    const [propId, setPropId]     = useState<string | null>(null);
    const [buying, setBuying]     = useState(false);
    const [buyErr, setBuyErr]     = useState('');
    const [resubNeeded, setResubNeeded] = useState(false);

    // Ticks + chart
    const [ticks, setTicks]       = useState<Tick[]>([]);
    const [lastPrice, setLastPrice] = useState<number | null>(null);
    const [prevPrice, setPrevPrice] = useState<number | null>(null);

    // Positions panel
    const [positions, setPositions]         = useState<Position[]>([]);
    const [positionsVisible, setPosVisible] = useState(false);

    const wsRef       = useRef<WebSocket | null>(null);
    const tickSub     = useRef<string | null>(null);
    const propSubRef  = useRef<string | null>(null);
    const askPriceRef = useRef<number>(1);
    const chartRef    = useRef<HTMLDivElement>(null);
    const tabsRef     = useRef<HTMLDivElement>(null);
    const [chartW, setChartW] = useState(800);
    const [chartH, setChartH] = useState(300);

    const duration = parseInt(durationStr) || 1;
    const pcts     = digitPcts(ticks.slice(-500));
    const minPct   = Math.min(...pcts);
    const maxPct   = Math.max(...pcts);

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

    // Load token
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
                askPriceRef.current = parseFloat(p.ask_price ?? p.display_value ?? p.payout ?? '1') || 1;
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
                setPositions(prev => {
                    const label = b.shortcode || 'Trade';
                    const pos: Position = { id: b.contract_id, label, stake: b.buy_price || 0, status: 'open' };
                    return [pos, ...prev.slice(0, 19)];
                });
                setPosVisible(true);
                ws.send(JSON.stringify({ proposal_open_contract: 1, contract_id: b.contract_id, subscribe: 1 }));
                // Forget consumed proposal sub and flag for re-subscribe
                if (propSubRef.current) {
                    ws.send(JSON.stringify({ forget: propSubRef.current }));
                    propSubRef.current = null;
                }
                setPropId(null); setPayout(null);
                setResubNeeded(true);
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
        const dur = parseInt(durationStr) || 1;

        const base = { proposal: 1, subscribe: 1, amount, basis: 'stake', currency: 'USD', symbol };

        if (group === 'RISE_FALL')
            return { ...base, contract_type: side === 'call' ? 'CALL' : 'PUT', duration: Math.max(1, dur), duration_unit: 't' };
        if (group === 'HIGHER_LOWER')
            return { ...base, contract_type: side === 'call' ? 'CALL' : 'PUT', duration: Math.max(1, dur), duration_unit: durUnit };
        if (group === 'TOUCH') {
            const bp = parseFloat(barrierPrice);
            if (!bp) return null;
            return { ...base, contract_type: side === 'touch' ? 'ONETOUCH' : 'NOTOUCH', duration: Math.max(1, dur), duration_unit: durUnit, barrier: bp };
        }
        if (group === 'ACCUMULATOR')
            return { ...base, contract_type: 'ACCU', growth_rate: growthRate };
        if (group === 'EVEN_ODD')
            return { ...base, contract_type: side === 'even' ? 'DIGITEVEN' : 'DIGITODD', duration: Math.max(1, dur), duration_unit: 't' };
        if (group === 'MATCH_DIFFER')
            return { ...base, contract_type: side === 'match' ? 'DIGITMATCH' : 'DIGITDIFF', duration: Math.max(1, dur), duration_unit: 't', barrier };
        if (group === 'OVER_UNDER')
            return { ...base, contract_type: side === 'over' ? 'DIGITOVER' : 'DIGITUNDER', duration: Math.max(1, dur), duration_unit: 't', barrier };
        if (group === 'MULTIPLIER')
            return { ...base, contract_type: side === 'up' ? 'MULTUP' : 'MULTDOWN', multiplier };
        if (group === 'TURBO') {
            const bp = parseFloat(barrierPrice);
            if (!bp) return null;
            return { ...base, contract_type: side === 'long' ? 'TURBOSLONG' : 'TURBOSSHORT', duration: Math.max(1, dur), duration_unit: durUnit, barrier: bp };
        }
        if (group === 'VANILLA') {
            const bp = parseFloat(barrierPrice);
            if (!bp) return null;
            return { ...base, contract_type: side === 'call' ? 'VANILLALONGCALL' : 'VANILLALONGPUT', duration: Math.max(1, dur), duration_unit: durUnit, barrier: bp };
        }
        return null;
    }, [group, side, barrier, barrierPrice, durationStr, durUnit, stake, symbol, growthRate, multiplier]);

    // Subscribe proposal on param changes
    useEffect(() => {
        if (!authed) return;
        if (propSubRef.current) { sendWs({ forget: propSubRef.current }); propSubRef.current = null; }
        setPropId(null); setPayout(null);
        const t = setTimeout(() => {
            const params = buildProposal();
            if (params) sendWs(params);
        }, 400);
        return () => clearTimeout(t);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [authed, group, side, barrier, barrierPrice, durationStr, durUnit, stake, symbol, growthRate, multiplier]);

    // Re-subscribe after buy without page refresh
    useEffect(() => {
        if (!resubNeeded || !authed) return;
        setResubNeeded(false);
        const t = setTimeout(() => {
            const params = buildProposal();
            if (params) sendWs(params);
        }, 300);
        return () => clearTimeout(t);
    }, [resubNeeded, authed, buildProposal, sendWs]);

    // Reset side / symbol when group changes
    useEffect(() => {
        const m = marketsForGroup(group);
        setSymbol(m[0].symbol);
        if (['RISE_FALL', 'HIGHER_LOWER', 'TOUCH'].includes(group)) setSide('call');
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

    // Scroll active tab into view
    useEffect(() => {
        if (!tabsRef.current) return;
        const active = tabsRef.current.querySelector('.manual-trading__ct-tab--active') as HTMLElement | null;
        if (active) active.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' });
    }, [group]);

    const handleBuy = () => {
        if (!propId || buying) return;
        setBuying(true); setBuyErr('');
        sendWs({ buy: propId, price: askPriceRef.current });
    };

    const needsDigit        = group === 'OVER_UNDER' || group === 'MATCH_DIFFER';
    const needsPriceBarrier = group === 'TOUCH' || group === 'TURBO' || group === 'VANILLA';
    const showDuration      = !['ACCUMULATOR', 'MULTIPLIER'].includes(group);

    const dir = lastPrice !== null && prevPrice !== null
        ? lastPrice > prevPrice ? 'up' : lastPrice < prevPrice ? 'down' : 'flat' : 'flat';

    const durUnits = () => {
        if (['RISE_FALL', 'EVEN_ODD', 'MATCH_DIFFER', 'OVER_UNDER'].includes(group))
            return [{ v: 't', l: 'Ticks' }];
        if (group === 'VANILLA')
            return [{ v: 'd', l: 'Days' }, { v: 'm', l: 'Mins' }];
        return [{ v: 'm', l: 'Mins' }, { v: 'h', l: 'Hours' }, { v: 'd', l: 'Days' }];
    };

    const scrollTabs = (d: 'left' | 'right') => {
        if (tabsRef.current) tabsRef.current.scrollBy({ left: d === 'left' ? -200 : 200, behavior: 'smooth' });
    };

    // Digit pct color: lowest = red, highest = green
    const digitClass = (i: number) => {
        if (pcts[i] === maxPct) return ' manual-trading__digit-btn--max';
        if (pcts[i] === minPct) return ' manual-trading__digit-btn--min';
        return '';
    };

    return (
        <div className='manual-trading'>
            {/* Contract type tabs */}
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
                {positions.length > 0 && (
                    <button className='manual-trading__pos-toggle' onClick={() => setPosVisible(v => !v)}>
                        {positionsVisible ? '✕ Positions' : `📋 Positions (${positions.length})`}
                    </button>
                )}
            </div>

            {/* Body */}
            <div className='manual-trading__body'>
                {/* Open Positions — fixed left column */}
                <div className='manual-trading__pos-panel'>
                    <div className='manual-trading__pos-panel-head'>
                        <span>Open Positions</span>
                    </div>
                        <div className='manual-trading__pos-list'>
                            {positions.map(p => {
                                const isOpen = p.status === 'open';
                                const isWon  = p.status === 'won';
                                return (
                                    <div key={p.id} className={`manual-trading__pos-item manual-trading__pos-item--${p.status}`}>
                                        <div className='manual-trading__pos-item-top'>
                                            <span className='manual-trading__pos-item-label'>{p.label}</span>
                                            <span className={`manual-trading__pos-item-pl manual-trading__pos-item-pl--${isOpen ? 'open' : isWon ? 'pos' : 'neg'}`}>
                                                {isOpen ? '● Live' : `${isWon ? '+' : ''}${p.profit?.toFixed(2)} USD`}
                                            </span>
                                        </div>
                                        <div className='manual-trading__pos-item-sub'>
                                            {isOpen ? 'In progress…' : isWon ? 'Won ✓' : 'Lost ✗'} · Stake {p.stake.toFixed(2)} USD
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                </div>

                {/* Chart column */}
                <div className='manual-trading__chart-col'>
                    <div className='manual-trading__chart-area' ref={chartRef}>
                        {ticks.length < 2
                            ? <div className='manual-trading__chart-empty'>{authed ? 'Loading chart…' : 'Please log in to view chart'}</div>
                            : <LiveChart ticks={ticks.slice(-200)} w={chartW} h={chartH} />
                        }
                    </div>

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
                            {/* Side toggle */}
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

                            {/* Digit picker in panel (0–9, 5×2 grid) */}
                            {needsDigit && (
                                <div className='manual-trading__input-wrap manual-trading__input-wrap--digit'>
                                    <span className='manual-trading__label'>Last digit prediction</span>
                                    <div className='manual-trading__digit-grid'>
                                        {Array.from({ length: 10 }, (_, d) => (
                                            <button
                                                key={d}
                                                className={`manual-trading__digit-btn${barrier === d ? ' manual-trading__digit-btn--sel' : ''}${digitClass(d)}`}
                                                onClick={() => setBarrier(d)}
                                            >
                                                <span className='manual-trading__digit-btn-num'>{d}</span>
                                                <span className='manual-trading__digit-btn-pct'>{pcts[d]}%</span>
                                            </button>
                                        ))}
                                    </div>
                                </div>
                            )}

                            {/* Accumulators: growth rate */}
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

                            {/* Multipliers */}
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

                            {/* Price barrier */}
                            {needsPriceBarrier && (
                                <div className='manual-trading__input-wrap'>
                                    <span className='manual-trading__label'>Barrier {lastPrice ? `(current: ${lastPrice.toFixed(2)})` : ''}</span>
                                    <input
                                        type='number'
                                        className='manual-trading__input'
                                        placeholder={lastPrice ? lastPrice.toFixed(2) : '0.00'}
                                        value={barrierPrice}
                                        onChange={e => setBarrierPrice(e.target.value)}
                                    />
                                </div>
                            )}

                            {/* Duration */}
                            {showDuration && (
                                <div className='manual-trading__input-wrap'>
                                    <span className='manual-trading__label'>Duration</span>
                                    <div className='manual-trading__row'>
                                        <input
                                            type='number'
                                            className='manual-trading__input'
                                            placeholder='1'
                                            value={durationStr}
                                            min={1}
                                            onChange={e => setDurationStr(e.target.value)}
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

                            {/* Stake */}
                            <div className='manual-trading__input-wrap'>
                                <span className='manual-trading__label'>Stake</span>
                                <div className='manual-trading__row'>
                                    <input
                                        type='number'
                                        className='manual-trading__input'
                                        placeholder='1'
                                        value={stake}
                                        min={0.35}
                                        step={0.01}
                                        onChange={e => setStake(e.target.value)}
                                    />
                                    <div className='manual-trading__suffix'>USD</div>
                                </div>
                            </div>

                            {/* Buy button */}
                            <button
                                className='manual-trading__buy'
                                onClick={handleBuy}
                                disabled={buying || !propId}
                            >
                                {buying ? 'Placing…' : 'Buy'}
                                {payout !== null && !buying && <small>Payout {payout.toFixed(2)} USD</small>}
                            </button>

                            {buyErr && <div className='manual-trading__error'>{buyErr}</div>}
                        </>
                    )}
                </div>
            </div>
        </div>
    );
};

export default ManualTrading;
