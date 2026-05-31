import React, { useCallback, useEffect, useRef, useState } from 'react';
import './manual-trading.scss';

const WS_URL = 'wss://ws.derivws.com/websockets/v3?app_id=116874';

const MARKETS = [
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

const CONTRACT_TYPES = [
    { id: 'OVER_UNDER',     label: 'Over/Under' },
    { id: 'MATCH_DIFFER',   label: 'Matches/Differs' },
    { id: 'EVEN_ODD',       label: 'Even/Odd' },
    { id: 'HIGHER_LOWER',   label: 'Higher/Lower' },
];

const DURATION_UNITS = [
    { value: 't', label: 'Ticks' },
    { value: 's', label: 'Seconds' },
    { value: 'm', label: 'Minutes' },
];

type Tick = { epoch: number; quote: number };
type Position = {
    id: number;
    type: string;
    symbol: string;
    stake: number;
    payout?: number;
    profit?: number;
    status: 'open' | 'won' | 'lost';
    detail: string;
};

function getDigit(price: number): number {
    const s = price.toFixed(2);
    return parseInt(s[s.length - 1], 10);
}

function computeDigitPcts(ticks: Tick[]): number[] {
    const counts = new Array(10).fill(0);
    ticks.forEach(t => { counts[getDigit(t.quote)]++; });
    const total = ticks.length || 1;
    return counts.map(c => Math.round((c / total) * 1000) / 10);
}

const ChartSVG: React.FC<{ ticks: Tick[]; width: number; height: number }> = ({ ticks, width, height }) => {
    if (ticks.length < 2) return null;
    const prices = ticks.map(t => t.quote);
    const min = Math.min(...prices);
    const max = Math.max(...prices);
    const range = max - min || 1;
    const pad = { top: 20, bottom: 20, left: 8, right: 8 };
    const w = width - pad.left - pad.right;
    const h = height - pad.top - pad.bottom;
    const points = prices.map((p, i) => {
        const x = pad.left + (i / (prices.length - 1)) * w;
        const y = pad.top + (1 - (p - min) / range) * h;
        return `${x},${y}`;
    });
    const pathD = 'M' + points.join('L');
    const areaD = pathD + `L${pad.left + w},${pad.top + h}L${pad.left},${pad.top + h}Z`;
    const lastX = pad.left + w;
    const lastY = pad.top + (1 - (prices[prices.length - 1] - min) / range) * h;

    return (
        <svg width={width} height={height} className='manual-trading__chart-svg'>
            <defs>
                <linearGradient id='mtChartGrad' x1='0' y1='0' x2='0' y2='1'>
                    <stop offset='0%' stopColor='#85e044' stopOpacity='0.3' />
                    <stop offset='100%' stopColor='#85e044' stopOpacity='0' />
                </linearGradient>
            </defs>
            <path d={areaD} fill='url(#mtChartGrad)' />
            <path d={pathD} fill='none' stroke='#85e044' strokeWidth='1.5' />
            <circle cx={lastX} cy={lastY} r='4' fill='#85e044' />
        </svg>
    );
};

export const ManualTrading: React.FC = () => {
    const [token, setToken] = useState<string>('');
    const [authed, setAuthed] = useState(false);
    const [authError, setAuthError] = useState('');

    const [symbol, setSymbol] = useState('1HZ100V');
    const [contractGroup, setContractGroup] = useState('OVER_UNDER');

    // Over/Under
    const [ouSide, setOuSide] = useState<'over' | 'under'>('over');
    // Match/Differ
    const [mdSide, setMdSide] = useState<'match' | 'differ'>('differ');
    // Even/Odd
    const [eoSide, setEoSide] = useState<'even' | 'odd'>('even');
    // Higher/Lower
    const [hlSide, setHlSide] = useState<'higher' | 'lower'>('higher');

    const [barrier, setBarrier] = useState(5);
    const [duration, setDuration] = useState(5);
    const [durationUnit, setDurationUnit] = useState('t');
    const [stake, setStake] = useState('1');
    const [payout, setPayout] = useState<number | null>(null);
    const [proposalId, setProposalId] = useState<string | null>(null);
    const [buying, setBuying] = useState(false);
    const [buyError, setBuyError] = useState('');

    const [ticks, setTicks] = useState<Tick[]>([]);
    const [lastPrice, setLastPrice] = useState<number | null>(null);
    const [prevPrice, setPrevPrice] = useState<number | null>(null);
    const [positions, setPositions] = useState<Position[]>([]);

    const wsRef = useRef<WebSocket | null>(null);
    const tickSubIdRef = useRef<string | null>(null);
    const propSubIdRef = useRef<string | null>(null);
    const chartContainerRef = useRef<HTMLDivElement>(null);
    const [chartSize, setChartSize] = useState({ w: 600, h: 300 });

    const digitPcts = computeDigitPcts(ticks.slice(-500));

    // Resize observer for chart
    useEffect(() => {
        if (!chartContainerRef.current) return;
        const ro = new ResizeObserver(entries => {
            for (const e of entries) {
                setChartSize({ w: e.contentRect.width, h: e.contentRect.height });
            }
        });
        ro.observe(chartContainerRef.current);
        return () => ro.disconnect();
    }, []);

    // Load token from storage
    useEffect(() => {
        const accounts = localStorage.getItem('client.accounts');
        if (accounts) {
            try {
                const parsed = JSON.parse(accounts);
                const keys = Object.keys(parsed);
                if (keys.length > 0) {
                    const tok = parsed[keys[0]]?.token;
                    if (tok) { setToken(tok); return; }
                }
            } catch { /* ignore */ }
        }
        const legacy = localStorage.getItem('authToken') || localStorage.getItem('deriv_api_token') || '';
        if (legacy) setToken(legacy);
    }, []);

    const sendWs = useCallback((msg: object) => {
        if (wsRef.current?.readyState === WebSocket.OPEN) {
            wsRef.current.send(JSON.stringify(msg));
        }
    }, []);

    const unsubProp = useCallback(() => {
        if (propSubIdRef.current) {
            sendWs({ forget: propSubIdRef.current });
            propSubIdRef.current = null;
        }
        setPayout(null);
        setProposalId(null);
    }, [sendWs]);

    const subscribeProposal = useCallback(() => {
        if (!authed) return;
        unsubProp();

        let ct: string;
        let bar: number | undefined;
        if (contractGroup === 'OVER_UNDER') {
            ct = ouSide === 'over' ? 'DIGITOVER' : 'DIGITUNDER';
            bar = barrier;
        } else if (contractGroup === 'MATCH_DIFFER') {
            ct = mdSide === 'match' ? 'DIGITMATCH' : 'DIGITDIFF';
            bar = barrier;
        } else if (contractGroup === 'EVEN_ODD') {
            ct = eoSide === 'even' ? 'DIGITEVEN' : 'DIGITODD';
        } else {
            ct = hlSide === 'higher' ? 'CALL' : 'PUT';
        }

        const msg: Record<string, any> = {
            proposal: 1,
            subscribe: 1,
            amount: parseFloat(stake) || 1,
            basis: 'stake',
            contract_type: ct,
            currency: 'USD',
            duration: Math.max(1, duration),
            duration_unit: durationUnit,
            symbol,
        };
        if (bar !== undefined) msg.barrier = bar;

        sendWs(msg);
    }, [authed, contractGroup, ouSide, mdSide, eoSide, hlSide, barrier, duration, durationUnit, stake, symbol, sendWs, unsubProp]);

    // Connect WebSocket
    useEffect(() => {
        if (!token) return;
        if (wsRef.current) {
            wsRef.current.close();
            wsRef.current = null;
        }
        setAuthed(false);
        setAuthError('');

        const ws = new WebSocket(WS_URL);
        wsRef.current = ws;

        ws.onopen = () => {
            ws.send(JSON.stringify({ authorize: token }));
        };

        ws.onmessage = (evt) => {
            const msg = JSON.parse(evt.data);

            if (msg.msg_type === 'authorize') {
                if (msg.error) { setAuthError(msg.error.message); return; }
                setAuthed(true);
                setAuthError('');
                // Subscribe to ticks
                ws.send(JSON.stringify({ ticks: symbol, subscribe: 1 }));
                ws.send(JSON.stringify({ ticks_history: symbol, count: 200, end: 'latest', style: 'ticks', subscribe: 1 }));
            }

            if (msg.msg_type === 'tick') {
                const t = msg.tick;
                if (!t || t.symbol !== symbol) return;
                const q: number = parseFloat(t.quote);
                setPrevPrice(prev => { return prev; });
                setLastPrice(old => { setPrevPrice(old); return q; });
                setTicks(prev => [...prev.slice(-599), { epoch: t.epoch, quote: q }]);
            }

            if (msg.msg_type === 'history') {
                const hist = msg.history;
                if (!hist) return;
                const combined: Tick[] = hist.times.map((e: number, i: number) => ({ epoch: e, quote: parseFloat(hist.prices[i]) }));
                setTicks(combined);
                if (hist.subscription?.id) tickSubIdRef.current = hist.subscription.id;
            }

            if (msg.msg_type === 'proposal') {
                if (msg.error) { setPayout(null); return; }
                const p = msg.proposal;
                if (!p) return;
                setPayout(parseFloat(p.payout));
                setProposalId(p.id);
                if (msg.subscription?.id) propSubIdRef.current = msg.subscription.id;
            }

            if (msg.msg_type === 'buy') {
                setBuying(false);
                if (msg.error) { setBuyError(msg.error.message); return; }
                const b = msg.buy;
                if (!b) return;
                setBuyError('');
                const pos: Position = {
                    id: b.contract_id,
                    type: contractGroup,
                    symbol,
                    stake: parseFloat(stake) || 1,
                    status: 'open',
                    detail: `Contract #${b.contract_id}`,
                };
                setPositions(prev => [pos, ...prev.slice(0, 9)]);
                // Subscribe to contract updates
                ws.send(JSON.stringify({ proposal_open_contract: 1, contract_id: b.contract_id, subscribe: 1 }));
            }

            if (msg.msg_type === 'proposal_open_contract') {
                const poc = msg.proposal_open_contract;
                if (!poc) return;
                const isWon = poc.status === 'won';
                const isLost = poc.status === 'lost';
                if (isWon || isLost) {
                    const profit = parseFloat(poc.profit || '0');
                    setPositions(prev => prev.map(p =>
                        p.id === poc.contract_id
                            ? { ...p, status: isWon ? 'won' : 'lost', profit, detail: `${isWon ? '+' : ''}${profit.toFixed(2)} USD` }
                            : p
                    ));
                }
            }
        };

        ws.onerror = () => setAuthError('WebSocket connection error.');
        ws.onclose = () => setAuthed(false);

        return () => { ws.close(); };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [token]);

    // Re-subscribe ticks when symbol changes
    useEffect(() => {
        if (!authed || !wsRef.current) return;
        if (tickSubIdRef.current) {
            sendWs({ forget: tickSubIdRef.current });
            tickSubIdRef.current = null;
        }
        setTicks([]);
        setLastPrice(null);
        setPrevPrice(null);
        sendWs({ ticks_history: symbol, count: 200, end: 'latest', style: 'ticks', subscribe: 1 });
    }, [symbol, authed, sendWs]);

    // Subscribe/re-subscribe proposal when params change
    useEffect(() => {
        if (!authed) return;
        const t = setTimeout(subscribeProposal, 400);
        return () => clearTimeout(t);
    }, [authed, subscribeProposal]);

    const handleBuy = () => {
        if (!proposalId || buying) return;
        setBuying(true);
        setBuyError('');
        sendWs({ buy: proposalId, price: parseFloat(stake) || 1 });
    };

    const needsDigit = contractGroup === 'OVER_UNDER' || contractGroup === 'MATCH_DIFFER';
    const changeDir = lastPrice !== null && prevPrice !== null
        ? (lastPrice > prevPrice ? 'up' : lastPrice < prevPrice ? 'down' : 'flat')
        : 'flat';

    const marketLabel = MARKETS.find(m => m.symbol === symbol)?.label || symbol;

    const contractTypeLabel = () => {
        if (contractGroup === 'OVER_UNDER') return ouSide === 'over' ? `Over ${barrier}` : `Under ${barrier}`;
        if (contractGroup === 'MATCH_DIFFER') return mdSide === 'match' ? `Matches ${barrier}` : `Differs from ${barrier}`;
        if (contractGroup === 'EVEN_ODD') return eoSide === 'even' ? 'Even' : 'Odd';
        return hlSide === 'higher' ? 'Higher' : 'Lower';
    };

    return (
        <div className='manual-trading'>
            {/* Contract type tabs */}
            <div className='manual-trading__contract-tabs'>
                {CONTRACT_TYPES.map(ct => (
                    <div
                        key={ct.id}
                        className={`manual-trading__contract-tab${contractGroup === ct.id ? ' manual-trading__contract-tab--active' : ''}`}
                        onClick={() => setContractGroup(ct.id)}
                    >
                        {ct.label}
                    </div>
                ))}
            </div>

            <div className='manual-trading__body'>
                {/* Left: market + chart */}
                <div className='manual-trading__left'>
                    <div className='manual-trading__market-bar'>
                        <select
                            className='manual-trading__market-select'
                            value={symbol}
                            onChange={e => setSymbol(e.target.value)}
                        >
                            {MARKETS.map(m => (
                                <option key={m.symbol} value={m.symbol}>{m.label}</option>
                            ))}
                        </select>
                        {lastPrice !== null && (
                            <>
                                <span className='manual-trading__market-price'>
                                    {lastPrice.toFixed(2)}
                                </span>
                                <span className={`manual-trading__market-change manual-trading__market-change--${changeDir}`}>
                                    {changeDir === 'up' ? '▲' : changeDir === 'down' ? '▼' : '–'}
                                </span>
                            </>
                        )}
                        {authed && <div className='manual-trading__live-dot' />}
                    </div>

                    <div className='manual-trading__chart-area' ref={chartContainerRef}>
                        {ticks.length < 2
                            ? <div className='manual-trading__no-data'>{authed ? 'Loading chart…' : 'Connect to view chart'}</div>
                            : <ChartSVG ticks={ticks.slice(-200)} width={chartSize.w} height={chartSize.h} />
                        }
                    </div>

                    {/* Digit stats bar */}
                    <div className='manual-trading__digit-bar'>
                        {Array.from({ length: 10 }, (_, d) => (
                            <div
                                key={d}
                                className={`manual-trading__digit-stat${needsDigit && barrier === d ? ' manual-trading__digit-stat--selected' : ''}`}
                                onClick={() => needsDigit && setBarrier(d)}
                            >
                                <span className='manual-trading__digit-num'>{d}</span>
                                <span className='manual-trading__digit-pct'>{digitPcts[d]}%</span>
                            </div>
                        ))}
                    </div>
                </div>

                {/* Right: trading panel */}
                <div className='manual-trading__right'>
                    <div className='manual-trading__panel'>
                        {!authed && !authError && (
                            <div className='manual-trading__no-auth'>
                                <span>🔌</span>
                                <span>Connecting to Deriv…</span>
                            </div>
                        )}
                        {authError && (
                            <div className='manual-trading__error-msg'>{authError}</div>
                        )}

                        {authed && (
                            <>
                                {/* Side toggle */}
                                {contractGroup === 'OVER_UNDER' && (
                                    <div className='manual-trading__toggle-row'>
                                        <button className={`manual-trading__toggle-btn${ouSide === 'over' ? ' manual-trading__toggle-btn--active' : ''}`} onClick={() => setOuSide('over')}>Over</button>
                                        <button className={`manual-trading__toggle-btn${ouSide === 'under' ? ' manual-trading__toggle-btn--active' : ''}`} onClick={() => setOuSide('under')}>Under</button>
                                    </div>
                                )}
                                {contractGroup === 'MATCH_DIFFER' && (
                                    <div className='manual-trading__toggle-row'>
                                        <button className={`manual-trading__toggle-btn${mdSide === 'match' ? ' manual-trading__toggle-btn--active' : ''}`} onClick={() => setMdSide('match')}>Matches</button>
                                        <button className={`manual-trading__toggle-btn${mdSide === 'differ' ? ' manual-trading__toggle-btn--active' : ''}`} onClick={() => setMdSide('differ')}>Differs</button>
                                    </div>
                                )}
                                {contractGroup === 'EVEN_ODD' && (
                                    <div className='manual-trading__toggle-row'>
                                        <button className={`manual-trading__toggle-btn${eoSide === 'even' ? ' manual-trading__toggle-btn--active' : ''}`} onClick={() => setEoSide('even')}>Even</button>
                                        <button className={`manual-trading__toggle-btn${eoSide === 'odd' ? ' manual-trading__toggle-btn--active' : ''}`} onClick={() => setEoSide('odd')}>Odd</button>
                                    </div>
                                )}
                                {contractGroup === 'HIGHER_LOWER' && (
                                    <div className='manual-trading__toggle-row'>
                                        <button className={`manual-trading__toggle-btn${hlSide === 'higher' ? ' manual-trading__toggle-btn--active' : ''}`} onClick={() => setHlSide('higher')}>Higher</button>
                                        <button className={`manual-trading__toggle-btn${hlSide === 'lower' ? ' manual-trading__toggle-btn--active' : ''}`} onClick={() => setHlSide('lower')}>Lower</button>
                                    </div>
                                )}

                                {/* Digit picker */}
                                {needsDigit && (
                                    <div className='manual-trading__input-group'>
                                        <span className='manual-trading__label'>Last digit prediction</span>
                                        <div className='manual-trading__digit-picker'>
                                            {Array.from({ length: 10 }, (_, d) => (
                                                <button
                                                    key={d}
                                                    className={`manual-trading__digit-pick-btn${barrier === d ? ' manual-trading__digit-pick-btn--selected' : ''}`}
                                                    onClick={() => setBarrier(d)}
                                                >
                                                    <span className='manual-trading__digit-pick-num'>{d}</span>
                                                    <span className='manual-trading__digit-pick-pct'>{digitPcts[d]}%</span>
                                                </button>
                                            ))}
                                        </div>
                                    </div>
                                )}

                                {/* Duration */}
                                <div className='manual-trading__input-group'>
                                    <span className='manual-trading__label'>Duration</span>
                                    <div className='manual-trading__duration-row'>
                                        <input
                                            type='number'
                                            className='manual-trading__duration-input'
                                            value={duration}
                                            min={1}
                                            onChange={e => setDuration(Math.max(1, parseInt(e.target.value) || 1))}
                                        />
                                        <select
                                            className='manual-trading__duration-unit'
                                            value={durationUnit}
                                            onChange={e => setDurationUnit(e.target.value)}
                                        >
                                            {DURATION_UNITS.map(u => (
                                                <option key={u.value} value={u.value}>{u.label}</option>
                                            ))}
                                        </select>
                                    </div>
                                </div>

                                {/* Stake */}
                                <div className='manual-trading__input-group'>
                                    <span className='manual-trading__label'>Stake</span>
                                    <div className='manual-trading__stake-row'>
                                        <input
                                            type='number'
                                            className='manual-trading__stake-input'
                                            value={stake}
                                            min={0.35}
                                            step={0.01}
                                            onChange={e => setStake(e.target.value)}
                                        />
                                        <span className='manual-trading__stake-currency'>USD</span>
                                    </div>
                                </div>

                                {/* Buy button */}
                                <button
                                    className='manual-trading__buy-btn'
                                    onClick={handleBuy}
                                    disabled={buying || !proposalId}
                                >
                                    {buying ? 'Placing…' : 'Buy'}
                                    {payout !== null && !buying && (
                                        <span>Payout {payout.toFixed(2)} USD</span>
                                    )}
                                </button>

                                {buyError && (
                                    <div className='manual-trading__error-msg'>{buyError}</div>
                                )}
                            </>
                        )}
                    </div>

                    {/* Positions */}
                    {positions.length > 0 && (
                        <div className='manual-trading__positions'>
                            <div className='manual-trading__positions-title'>Recent Positions</div>
                            {positions.map(p => (
                                <div
                                    key={p.id}
                                    className={`manual-trading__position-card manual-trading__position-card--${p.status}`}
                                >
                                    <div className='manual-trading__position-top'>
                                        <span className='manual-trading__position-type'>
                                            {contractTypeLabel()} · {p.symbol}
                                        </span>
                                        <span className={`manual-trading__position-pl manual-trading__position-pl--${p.status === 'open' ? 'open' : p.profit && p.profit > 0 ? 'pos' : 'neg'}`}>
                                            {p.status === 'open' ? 'Open' : p.detail}
                                        </span>
                                    </div>
                                    <div className='manual-trading__position-details'>
                                        Stake: {p.stake.toFixed(2)} USD · #{p.id}
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

export default ManualTrading;
