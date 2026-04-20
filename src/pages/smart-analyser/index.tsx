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

type Confidence = 'low' | 'medium' | 'high';

type Prediction = {
    type: string;
    label: string;
    value: string;
    desc: string;
    winPct: number;
    expectedPct: number;
    confidence: Confidence;
    icon: string;
    color: string;
};

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
        count[i] = parseFloat(((count[i] / total) * 100).toFixed(2));
    }
    return count;
};

const confidenceLevel = (actual: number, expected: number): Confidence => {
    const diff = actual - expected;
    if (diff >= 5) return 'high';
    if (diff >= 2.5) return 'medium';
    return 'low';
};

const buildPredictions = (pct: DigitStats, sampleSize: number): Prediction[] => {
    const hasSamples = Object.values(pct).some(v => v > 0);
    if (!hasSamples) return [];

    const predictions: Prediction[] = [];

    const evenPct = [0, 2, 4, 6, 8].reduce((s, d) => s + pct[d], 0);
    const oddPct = [1, 3, 5, 7, 9].reduce((s, d) => s + pct[d], 0);
    const expectedEvenOdd = 50;
    if (evenPct >= oddPct) {
        predictions.push({
            type: 'even-odd',
            label: 'Even / Odd',
            value: 'Even',
            desc: `Even digits (0,2,4,6,8) have occurred ${evenPct.toFixed(1)}% vs expected 50%`,
            winPct: evenPct,
            expectedPct: expectedEvenOdd,
            confidence: confidenceLevel(evenPct, expectedEvenOdd),
            icon: '⚖️',
            color: '#9b59b6',
        });
    } else {
        predictions.push({
            type: 'even-odd',
            label: 'Even / Odd',
            value: 'Odd',
            desc: `Odd digits (1,3,5,7,9) have occurred ${oddPct.toFixed(1)}% vs expected 50%`,
            winPct: oddPct,
            expectedPct: expectedEvenOdd,
            confidence: confidenceLevel(oddPct, expectedEvenOdd),
            icon: '⚖️',
            color: '#9b59b6',
        });
    }

    let bestOverScore = -Infinity;
    let bestOver = { threshold: 3, winPct: 0, expected: 60 };
    for (let t = 0; t <= 8; t++) {
        const winDigits = Array.from({ length: 9 - t }, (_, i) => t + 1 + i);
        const actual = winDigits.reduce((s, d) => s + pct[d], 0);
        const expected = (9 - t) * 10;
        const score = actual - expected;
        if (score > bestOverScore) {
            bestOverScore = score;
            bestOver = { threshold: t, winPct: actual, expected };
        }
    }
    predictions.push({
        type: 'over',
        label: 'Over',
        value: `Over ${bestOver.threshold}`,
        desc: `Last digit > ${bestOver.threshold} has hit ${bestOver.winPct.toFixed(1)}% vs expected ${bestOver.expected}%`,
        winPct: bestOver.winPct,
        expectedPct: bestOver.expected,
        confidence: confidenceLevel(bestOver.winPct, bestOver.expected),
        icon: '📈',
        color: '#27ae60',
    });

    let bestUnderScore = -Infinity;
    let bestUnder = { threshold: 6, winPct: 0, expected: 60 };
    for (let t = 1; t <= 9; t++) {
        const winDigits = Array.from({ length: t }, (_, i) => i);
        const actual = winDigits.reduce((s, d) => s + pct[d], 0);
        const expected = t * 10;
        const score = actual - expected;
        if (score > bestUnderScore) {
            bestUnderScore = score;
            bestUnder = { threshold: t, winPct: actual, expected };
        }
    }
    predictions.push({
        type: 'under',
        label: 'Under',
        value: `Under ${bestUnder.threshold}`,
        desc: `Last digit < ${bestUnder.threshold} has hit ${bestUnder.winPct.toFixed(1)}% vs expected ${bestUnder.expected}%`,
        winPct: bestUnder.winPct,
        expectedPct: bestUnder.expected,
        confidence: confidenceLevel(bestUnder.winPct, bestUnder.expected),
        icon: '📉',
        color: '#3498db',
    });

    let matchDigit = 0;
    let matchMax = pct[0];
    for (let i = 1; i <= 9; i++) {
        if (pct[i] > matchMax) { matchMax = pct[i]; matchDigit = i; }
    }
    predictions.push({
        type: 'matches',
        label: 'Matches',
        value: `Matches ${matchDigit}`,
        desc: `Digit ${matchDigit} has appeared ${matchMax.toFixed(1)}% vs expected 10%`,
        winPct: matchMax,
        expectedPct: 10,
        confidence: confidenceLevel(matchMax, 10),
        icon: '🎯',
        color: '#e67e22',
    });

    let differDigit = 0;
    let differMin = pct[0];
    for (let i = 1; i <= 9; i++) {
        if (pct[i] < differMin) { differMin = pct[i]; differDigit = i; }
    }
    const differWin = 100 - differMin;
    predictions.push({
        type: 'differs',
        label: 'Differs',
        value: `Differs ${differDigit}`,
        desc: `Digit ${differDigit} appears least at ${differMin.toFixed(1)}%, so differs wins ${differWin.toFixed(1)}%`,
        winPct: differWin,
        expectedPct: 90,
        confidence: confidenceLevel(differWin, 90),
        icon: '🔀',
        color: '#e74c3c',
    });

    predictions.sort((a, b) => (b.winPct - b.expectedPct) - (a.winPct - a.expectedPct));

    return predictions;
};

const ConfidenceBar = ({ value, expected, color }: { value: number; expected: number; color: string }) => {
    const fillPct = Math.min(100, (value / 100) * 100);
    const expectedMark = (expected / 100) * 100;
    return (
        <div className='sa-pred-bar-wrap'>
            <div className='sa-pred-bar-track'>
                <div className='sa-pred-bar-fill' style={{ width: `${fillPct}%`, background: color }} />
                <div className='sa-pred-bar-mark' style={{ left: `${expectedMark}%` }} />
            </div>
            <div className='sa-pred-bar-labels'>
                <span style={{ color }}>{value.toFixed(1)}%</span>
                <span className='sa-pred-bar-expected'>Expected: {expected}%</span>
            </div>
        </div>
    );
};

const CONF_LABELS: Record<Confidence, { text: string; cls: string }> = {
    high: { text: '● High Confidence', cls: 'sa-conf--high' },
    medium: { text: '◑ Medium Confidence', cls: 'sa-conf--medium' },
    low: { text: '○ Low Confidence', cls: 'sa-conf--low' },
};

const PredictionCard = ({ pred, rank }: { pred: Prediction; rank: number }) => {
    const conf = CONF_LABELS[pred.confidence];
    return (
        <div className={`sa-pred-card ${rank === 0 ? 'sa-pred-card--top' : ''}`}>
            {rank === 0 && <div className='sa-pred-top-badge'>⭐ Best Pick</div>}
            <div className='sa-pred-header'>
                <span className='sa-pred-icon'>{pred.icon}</span>
                <div>
                    <div className='sa-pred-type'>{pred.label}</div>
                    <div className='sa-pred-value' style={{ color: pred.color }}>{pred.value}</div>
                </div>
                <span className={`sa-conf ${conf.cls}`}>{conf.text}</span>
            </div>
            <div className='sa-pred-desc'>{pred.desc}</div>
            <ConfidenceBar value={pred.winPct} expected={pred.expectedPct} color={pred.color} />
        </div>
    );
};

const CircleProgress = ({ digit, pct, isLast }: { digit: number; pct: number; isLast: boolean }) => {
    const radius = 36;
    const circumference = 2 * Math.PI * radius;
    const dashOffset = circumference - (pct / 100) * circumference;
    const color = DIGIT_COLORS[digit];
    const isHigh = pct > 12;
    const isLow = pct < 8;

    return (
        <div className={`sa-digit-card ${isLast ? 'sa-digit-card--active' : ''}`}>
            <div className='sa-digit-ring'>
                <svg width='92' height='92' viewBox='0 0 92 92'>
                    <circle cx='46' cy='46' r={radius} fill='none' stroke='#e8eaff' strokeWidth='7' />
                    <circle
                        cx='46' cy='46' r={radius} fill='none' stroke={color} strokeWidth='7'
                        strokeDasharray={circumference} strokeDashoffset={dashOffset}
                        strokeLinecap='round' transform='rotate(-90 46 46)'
                    />
                    <text x='46' y='42' textAnchor='middle' dominantBaseline='middle' className='sa-digit-number'>{digit}</text>
                    <text x='46' y='58' textAnchor='middle' dominantBaseline='middle' className='sa-digit-pct'>{pct}%</text>
                </svg>
            </div>
            <div className={`sa-digit-badge ${isHigh ? 'sa-digit-badge--high' : isLow ? 'sa-digit-badge--low' : 'sa-digit-badge--avg'}`}>
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
    const digitsRef = useRef<number[]>([]);

    const percentages = calcPercentages(digits, sampleSize);
    const predictions = buildPredictions(percentages, sampleSize);

    const connect = useCallback(() => {
        if (wsRef.current) wsRef.current.close();
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
            }
            if (data.msg_type === 'tick' && data.tick) {
                const price = data.tick.quote as number;
                const d = getLastDigit(price);
                digitsRef.current = [...digitsRef.current, d];
                setDigits([...digitsRef.current]);
                setLastPrice(price.toFixed(2));
                setLastDigit(d);
                setTickCount(prev => prev + 1);
            }
            if (data.error) setStatus('error');
        };

        ws.onerror = () => setStatus('error');
        ws.onclose = () => {};
    }, [symbol]);

    useEffect(() => {
        connect();
        return () => { wsRef.current?.close(); };
    }, [connect]);

    const symbolLabel = SYMBOLS.find(s => s.value === symbol)?.label ?? symbol;
    const analysedCount = Math.min(tickCount, sampleSize);

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
                        <select className='sa-select' value={symbol} onChange={e => setSymbol(e.target.value)}>
                            {SYMBOLS.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
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
                    <span className='sa-info-badge'>Ticks: <strong>{tickCount}</strong></span>
                    <span className='sa-info-badge'>
                        Last: <strong className='sa-last-price'>{lastPrice}</strong>
                        {lastDigit !== null && (
                            <span className='sa-last-digit' style={{ background: DIGIT_COLORS[lastDigit] }}>
                                {lastDigit}
                            </span>
                        )}
                    </span>
                    <span className='sa-info-badge'>Analysing: <strong>{analysedCount} ticks</strong></span>
                </div>
            </div>

            <div className='sa-digits-grid'>
                {Array.from({ length: 10 }, (_, i) => (
                    <CircleProgress key={i} digit={i} pct={percentages[i] ?? 0} isLast={lastDigit === i} />
                ))}
            </div>

            <div className='sa-legend'>
                <span className='sa-legend-item sa-legend-item--high'>▲ Hot &gt;12%</span>
                <span className='sa-legend-item sa-legend-item--avg'>— Average ~10%</span>
                <span className='sa-legend-item sa-legend-item--low'>▼ Cold &lt;8%</span>
            </div>

            <div className='sa-predictions-section'>
                <div className='sa-predictions-title'>
                    <span>🧠</span>
                    <span>Trade Predictions</span>
                    <span className='sa-predictions-subtitle'>
                        {analysedCount < 25
                            ? 'Collecting data...'
                            : `Based on ${analysedCount} ticks — sorted by strongest signal`}
                    </span>
                </div>

                {analysedCount < 25 ? (
                    <div className='sa-predictions-loading'>
                        <div className='sa-loading-spinner' />
                        <span>Gathering enough ticks to generate predictions...</span>
                    </div>
                ) : (
                    <div className='sa-predictions-grid'>
                        {predictions.map((pred, i) => (
                            <PredictionCard key={pred.type} pred={pred} rank={i} />
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
};

export default SmartAnalyser;
