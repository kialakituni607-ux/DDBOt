import React, { useCallback, useEffect, useRef, useState } from 'react';
import './smart-analyser.scss';

const SYMBOLS = [
    { label: 'Volatility 10 Index', value: 'R_10' },
    { label: 'Volatility 10 (1s) Index', value: '1HZ10V' },
    { label: 'Volatility 25 Index', value: 'R_25' },
    { label: 'Volatility 25 (1s) Index', value: '1HZ25V' },
    { label: 'Volatility 50 Index', value: 'R_50' },
    { label: 'Volatility 50 (1s) Index', value: '1HZ50V' },
    { label: 'Volatility 75 Index', value: 'R_75' },
    { label: 'Volatility 75 (1s) Index', value: '1HZ75V' },
    { label: 'Volatility 100 Index', value: 'R_100' },
    { label: 'Volatility 100 (1s) Index', value: '1HZ100V' },
];

const SAMPLE_SIZES = [25, 50, 100, 500, 1000];

const APP_ID = '116874';
const WS_URL = `wss://ws.derivws.com/websockets/v3?app_id=${APP_ID}`;

const DIGIT_COLORS = [
    '#e74c3c', '#e67e22', '#f1c40f', '#2ecc71', '#1abc9c',
    '#3498db', '#9b59b6', '#e91e63', '#00bcd4', '#ff5722',
];

type DigitStats = { [digit: number]: number };

const getLastDigit = (price: number): number => {
    const str = price.toFixed(2);
    return parseInt(str[str.length - 1], 10);
};

const calcPercentages = (digits: number[], sampleSize: number): DigitStats => {
    const count: DigitStats = {};
    for (let i = 0; i <= 9; i++) count[i] = 0;
    const slice = digits.slice(-sampleSize);
    slice.forEach(d => { count[d] = (count[d] || 0) + 1; });
    const total = slice.length;
    if (total === 0) return count;
    for (let i = 0; i <= 9; i++) {
        count[i] = parseFloat(((count[i] / total) * 100).toFixed(1));
    }
    return count;
};

const CircleProgress = ({ digit, pct, isLast }: { digit: number; pct: number; isLast: boolean }) => {
    const radius = 36;
    const circumference = 2 * Math.PI * radius;
    const dashOffset = circumference - (pct / 100) * circumference;
    const color = DIGIT_COLORS[digit];
    const avg = 10;
    const isHigh = pct > avg + 2;
    const isLow = pct < avg - 2;

    return (
        <div className={`sa-digit-card ${isLast ? 'sa-digit-card--active' : ''}`}>
            <div className='sa-digit-ring'>
                <svg width='92' height='92' viewBox='0 0 92 92'>
                    <circle cx='46' cy='46' r={radius} fill='none' stroke='#e8eaff' strokeWidth='7' />
                    <circle
                        cx='46'
                        cy='46'
                        r={radius}
                        fill='none'
                        stroke={color}
                        strokeWidth='7'
                        strokeDasharray={circumference}
                        strokeDashoffset={dashOffset}
                        strokeLinecap='round'
                        transform='rotate(-90 46 46)'
                    />
                    <text x='46' y='42' textAnchor='middle' dominantBaseline='middle' className='sa-digit-number'>
                        {digit}
                    </text>
                    <text x='46' y='58' textAnchor='middle' dominantBaseline='middle' className='sa-digit-pct'>
                        {pct}%
                    </text>
                </svg>
            </div>
            <div
                className={`sa-digit-badge ${isHigh ? 'sa-digit-badge--high' : isLow ? 'sa-digit-badge--low' : 'sa-digit-badge--avg'}`}
            >
                {isHigh ? '▲ Hot' : isLow ? '▼ Cold' : '— Avg'}
            </div>
        </div>
    );
};

const SmartAnalyser = () => {
    const [symbol, setSymbol] = useState('R_10');
    const [sampleSize, setSampleSize] = useState(100);
    const [digits, setDigits] = useState<number[]>([]);
    const [lastPrice, setLastPrice] = useState<string>('—');
    const [lastDigit, setLastDigit] = useState<number | null>(null);
    const [status, setStatus] = useState<'connecting' | 'connected' | 'error'>('connecting');
    const [tickCount, setTickCount] = useState(0);

    const wsRef = useRef<WebSocket | null>(null);
    const subsIdRef = useRef<string | null>(null);
    const digitsRef = useRef<number[]>([]);

    const percentages = calcPercentages(digits, sampleSize);

    const connect = useCallback(() => {
        if (wsRef.current) {
            wsRef.current.close();
        }
        digitsRef.current = [];
        setDigits([]);
        setLastPrice('—');
        setLastDigit(null);
        setTickCount(0);
        setStatus('connecting');

        const ws = new WebSocket(WS_URL);
        wsRef.current = ws;

        ws.onopen = () => {
            setStatus('connected');
            ws.send(JSON.stringify({
                ticks_history: symbol,
                adjust_start_time: 1,
                count: 1000,
                end: 'latest',
                start: 1,
                style: 'ticks',
                subscribe: 1,
            }));
        };

        ws.onmessage = (evt: MessageEvent) => {
            const data = JSON.parse(evt.data);

            if (data.msg_type === 'history' && data.history) {
                const prices = data.history.prices as number[];
                const d = prices.map(getLastDigit);
                digitsRef.current = d;
                setDigits([...d]);
                setTickCount(d.length);
                if (prices.length > 0) {
                    const last = prices[prices.length - 1];
                    setLastPrice(last.toFixed(2));
                    setLastDigit(getLastDigit(last));
                }
                if (data.subscription) subsIdRef.current = data.subscription.id;
            }

            if (data.msg_type === 'tick' && data.tick) {
                const price = data.tick.quote as number;
                const d = getLastDigit(price);
                digitsRef.current = [...digitsRef.current, d];
                setDigits([...digitsRef.current]);
                setLastPrice(price.toFixed(2));
                setLastDigit(d);
                setTickCount(prev => prev + 1);
                if (data.tick.id) subsIdRef.current = data.tick.id;
            }

            if (data.error) {
                setStatus('error');
            }
        };

        ws.onerror = () => setStatus('error');
        ws.onclose = () => {};
    }, [symbol]);

    useEffect(() => {
        connect();
        return () => {
            wsRef.current?.close();
        };
    }, [connect]);

    const symbolLabel = SYMBOLS.find(s => s.value === symbol)?.label ?? symbol;

    return (
        <div className='smart-analyser'>
            <div className='sa-header'>
                <div className='sa-header__title'>
                    <span className='sa-header__icon'>📊</span>
                    <span>Smart Analyser</span>
                </div>
                <div className='sa-header__controls'>
                    <div className='sa-control-group'>
                        <label className='sa-label'>Market</label>
                        <select
                            className='sa-select'
                            value={symbol}
                            onChange={e => setSymbol(e.target.value)}
                        >
                            {SYMBOLS.map(s => (
                                <option key={s.value} value={s.value}>{s.label}</option>
                            ))}
                        </select>
                    </div>
                    <div className='sa-control-group'>
                        <label className='sa-label'>Sample Size</label>
                        <div className='sa-pills'>
                            {SAMPLE_SIZES.map(n => (
                                <button
                                    key={n}
                                    className={`sa-pill ${sampleSize === n ? 'sa-pill--active' : ''}`}
                                    onClick={() => setSampleSize(n)}
                                >
                                    {n}
                                </button>
                            ))}
                        </div>
                    </div>
                </div>
            </div>

            <div className='sa-status-bar'>
                <div className={`sa-status-dot sa-status-dot--${status}`} />
                <span className='sa-status-text'>
                    {status === 'connecting' && 'Connecting...'}
                    {status === 'connected' && `Live — ${symbolLabel}`}
                    {status === 'error' && 'Connection error. Try refreshing.'}
                </span>
                <div className='sa-stats-info'>
                    <span className='sa-info-badge'>Ticks collected: <strong>{tickCount}</strong></span>
                    <span className='sa-info-badge'>
                        Last tick: <strong className='sa-last-price'>{lastPrice}</strong>
                        {lastDigit !== null && (
                            <span className='sa-last-digit' style={{ background: DIGIT_COLORS[lastDigit] }}>
                                {lastDigit}
                            </span>
                        )}
                    </span>
                    <span className='sa-info-badge'>Analysing: <strong>{Math.min(tickCount, sampleSize)} ticks</strong></span>
                </div>
            </div>

            <div className='sa-digits-grid'>
                {Array.from({ length: 10 }, (_, i) => (
                    <CircleProgress
                        key={i}
                        digit={i}
                        pct={percentages[i] ?? 0}
                        isLast={lastDigit === i}
                    />
                ))}
            </div>

            <div className='sa-legend'>
                <span className='sa-legend-item sa-legend-item--high'>▲ Hot &gt;12%</span>
                <span className='sa-legend-item sa-legend-item--avg'>— Average ~10%</span>
                <span className='sa-legend-item sa-legend-item--low'>▼ Cold &lt;8%</span>
            </div>
        </div>
    );
};

export default SmartAnalyser;
