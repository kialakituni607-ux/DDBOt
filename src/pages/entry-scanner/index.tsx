import React, { useState, useRef } from 'react';
import './entry-scanner.scss';

const APP_ID = '116874';
const WS_URL = `wss://ws.derivws.com/websockets/v3?app_id=${APP_ID}`;

const MARKETS = [
    { symbol: '1HZ10V',  label: 'Volatility 10 (1s) Index'  },
    { symbol: '1HZ25V',  label: 'Volatility 25 (1s) Index'  },
    { symbol: '1HZ50V',  label: 'Volatility 50 (1s) Index'  },
    { symbol: '1HZ75V',  label: 'Volatility 75 (1s) Index'  },
    { symbol: '1HZ100V', label: 'Volatility 100 (1s) Index' },
    { symbol: 'R_10',    label: 'Volatility 10 Index'       },
    { symbol: 'R_25',    label: 'Volatility 25 Index'       },
    { symbol: 'R_50',    label: 'Volatility 50 Index'       },
    { symbol: 'R_75',    label: 'Volatility 75 Index'       },
    { symbol: 'R_100',   label: 'Volatility 100 Index'      },
];

const STRATEGIES = [
    { label: 'Over 3 Recovery Over 5',   mainType: 'over'  as const, mainDigit: 3, recoveryType: 'over'  as const, recoveryDigit: 5 },
    { label: 'Under 6 Recovery Under 5', mainType: 'under' as const, mainDigit: 6, recoveryType: 'under' as const, recoveryDigit: 5 },
    { label: 'Over 2 Recovery Over 4',   mainType: 'over'  as const, mainDigit: 2, recoveryType: 'over'  as const, recoveryDigit: 4 },
    { label: 'Under 8 Recovery Under 6', mainType: 'under' as const, mainDigit: 8, recoveryType: 'under' as const, recoveryDigit: 6 },
    { label: 'Over 1 Recovery Over 5',   mainType: 'over'  as const, mainDigit: 1, recoveryType: 'over'  as const, recoveryDigit: 5 },
    { label: 'Under 9 Recovery Under 5', mainType: 'under' as const, mainDigit: 9, recoveryType: 'under' as const, recoveryDigit: 5 },
    { label: 'Over 3 Recovery Under 5',  mainType: 'over'  as const, mainDigit: 3, recoveryType: 'under' as const, recoveryDigit: 5 },
    { label: 'Under 6 Recovery Over 5',  mainType: 'under' as const, mainDigit: 6, recoveryType: 'over'  as const, recoveryDigit: 5 },
    { label: 'Over 1 Recovery Over 4',   mainType: 'over'  as const, mainDigit: 1, recoveryType: 'over'  as const, recoveryDigit: 4 },
    { label: 'Under 9 Recovery Under 6', mainType: 'under' as const, mainDigit: 9, recoveryType: 'under' as const, recoveryDigit: 6 },
];

function fetchTicks(symbol: string, count: number): Promise<number[]> {
    return new Promise((resolve, reject) => {
        const ws = new WebSocket(WS_URL);
        let done = false;
        const timeout = setTimeout(() => {
            if (!done) { done = true; ws.close(); reject(new Error('Timeout')); }
        }, 15000);
        ws.onopen = () => {
            ws.send(JSON.stringify({ ticks_history: symbol, count, end: 'latest', start: 1, style: 'ticks' }));
        };
        ws.onmessage = event => {
            if (done) return;
            done = true;
            clearTimeout(timeout);
            ws.close();
            const msg = JSON.parse(event.data);
            if (msg.error) return reject(new Error(msg.error.message));
            resolve((msg.history?.prices as number[]) || []);
        };
        ws.onerror = () => {
            if (!done) { done = true; clearTimeout(timeout); reject(new Error('WS error')); }
        };
    });
}

function getLastDigit(price: number): number {
    const s = price.toFixed(2);
    return parseInt(s[s.length - 1], 10);
}

function winsCheck(digit: number, type: 'over' | 'under', threshold: number): boolean {
    return type === 'over' ? digit > threshold : digit < threshold;
}

type ScanResult = {
    market: string;
    marketLabel: string;
    strategy: string;
    entryDigit: number;
    winRate: number;
    sampleSize: number;
    recentWinRate: number;
    qualityScore: number;
};

function analyzeStrategy(
    digits: number[],
    mainType: 'over' | 'under', mainDigit: number,
    recoveryType: 'over' | 'under', recoveryDigit: number
): { winRate: number; sampleSize: number; recentWinRate: number; qualityScore: number; entryDigit: number } | null {
    const triggerResults: { win: boolean; digit: number }[] = [];

    for (let i = 0; i < digits.length - 1; i++) {
        if (!winsCheck(digits[i], mainType, mainDigit)) {
            const nextDigit = digits[i + 1];
            triggerResults.push({ win: winsCheck(nextDigit, recoveryType, recoveryDigit), digit: nextDigit });
        }
    }

    if (triggerResults.length === 0) return null;

    const winCount  = triggerResults.filter(r => r.win).length;
    const winRate   = (winCount / triggerResults.length) * 100;

    const recentN   = Math.min(20, triggerResults.length);
    const recentWins = triggerResults.slice(-recentN).filter(r => r.win).length;
    const recentWinRate = (recentWins / recentN) * 100;

    const sampleSize    = triggerResults.length;
    const qualityScore  = (winRate * 0.6 + recentWinRate * 0.4) * (sampleSize / (sampleSize + 3));

    // Entry digit = most common winning digit among recovery wins
    const winDigits = triggerResults.filter(r => r.win).map(r => r.digit);
    const freq: Record<number, number> = {};
    winDigits.forEach(d => { freq[d] = (freq[d] || 0) + 1; });
    const entryDigit = winDigits.length > 0
        ? parseInt(Object.entries(freq).sort((a, b) => b[1] - a[1])[0][0], 10)
        : recoveryDigit;

    return { winRate, sampleSize, recentWinRate, qualityScore, entryDigit };
}

type MarketProgress = { label: string; done: boolean; wins?: number; total?: number };

const EntryScanner: React.FC = () => {
    const [tickCount, setTickCount]         = useState(500);
    const [scanning, setScanning]           = useState(false);
    const [progress, setProgress]           = useState(0);
    const [marketProgress, setMarketProgress] = useState<MarketProgress[]>([]);
    const [bestResult, setBestResult]       = useState<ScanResult | null>(null);
    const [allResults, setAllResults]       = useState<ScanResult[]>([]);
    const [statusMsg, setStatusMsg]         = useState('');
    const abortRef = useRef(false);

    const startScan = async () => {
        abortRef.current = false;
        setScanning(true);
        setBestResult(null);
        setAllResults([]);
        setProgress(0);
        setStatusMsg('Connecting to live market data...');
        setMarketProgress(MARKETS.map(m => ({ label: m.label, done: false })));

        const results: ScanResult[] = [];
        const total = MARKETS.length;

        for (let mi = 0; mi < total; mi++) {
            if (abortRef.current) break;
            const market = MARKETS[mi];
            setStatusMsg(`Scanning ${market.label}...`);

            try {
                const prices = await fetchTicks(market.symbol, tickCount);
                const digits = prices.map(getLastDigit);
                let bestForMarket: ScanResult | null = null;

                for (const strat of STRATEGIES) {
                    if (abortRef.current) break;
                    const res = analyzeStrategy(digits, strat.mainType, strat.mainDigit, strat.recoveryType, strat.recoveryDigit);
                    if (!res) continue;
                    const sr: ScanResult = {
                        market: market.symbol,
                        marketLabel: market.label,
                        strategy: strat.label,
                        entryDigit: res.entryDigit,
                        winRate: res.winRate,
                        sampleSize: res.sampleSize,
                        recentWinRate: res.recentWinRate,
                        qualityScore: res.qualityScore,
                    };
                    results.push(sr);
                    if (!bestForMarket || sr.qualityScore > bestForMarket.qualityScore) bestForMarket = sr;
                }

                setMarketProgress(prev => prev.map((p, i) =>
                    i === mi ? { ...p, done: true, wins: bestForMarket ? Math.round(bestForMarket.winRate) : 0, total: digits.length } : p
                ));
            } catch {
                setMarketProgress(prev => prev.map((p, i) => i === mi ? { ...p, done: true } : p));
            }

            setProgress(Math.round(((mi + 1) / total) * 100));
        }

        results.sort((a, b) => b.qualityScore - a.qualityScore);
        setAllResults(results.slice(0, 5));
        if (results.length > 0) {
            setBestResult(results[0]);
            setStatusMsg(`Best market: ${results[0].marketLabel} | ${results[0].strategy} | Entry ${results[0].entryDigit} | Quality ${results[0].qualityScore.toFixed(2)}%`);
        } else {
            setStatusMsg('Scan complete. No results found.');
        }
        setScanning(false);
    };

    const stopScan = () => {
        abortRef.current = true;
        setScanning(false);
        setStatusMsg('Scan stopped.');
    };

    return (
        <div className='entry-scanner'>
            <div className='es-header'>
                <div className='es-header__title'>
                    <span className='es-header__icon'>🔍</span>
                    Entry Scanner
                </div>
                <p className='es-header__desc'>
                    Deep scanner evaluates all synthetic index random markets, then finds the best entry point digit and
                    strategy profile from historical tick data.
                </p>
            </div>

            <div className='es-controls'>
                <div className='es-control-group'>
                    <label className='es-label'>NUMBER OF TICKS TO SCAN</label>
                    <input
                        className='es-input'
                        type='number'
                        min={100}
                        max={5000}
                        value={tickCount}
                        onChange={e => setTickCount(Math.max(100, Math.min(5000, parseInt(e.target.value) || 500)))}
                        disabled={scanning}
                    />
                </div>

                <div className='es-control-group'>
                    <label className='es-label'>BEST MARKET</label>
                    <div className='es-result-box'>{bestResult?.marketLabel || '—'}</div>
                </div>

                <div className='es-control-group'>
                    <label className='es-label'>STRATEGY</label>
                    <div className='es-result-box'>{bestResult?.strategy || '—'}</div>
                </div>

                <div className='es-control-group'>
                    <label className='es-label'>ENTRY DIGIT</label>
                    <div className='es-result-box es-result-box--highlight'>{bestResult !== null ? bestResult.entryDigit : '—'}</div>
                </div>
            </div>

            {bestResult && (
                <div className='es-stats-bar'>
                    <div className='es-stat'>
                        <span className='es-stat__label'>Win Rate</span>
                        <span className='es-stat__value es-stat__value--green'>{bestResult.winRate.toFixed(1)}%</span>
                    </div>
                    <div className='es-stat-divider' />
                    <div className='es-stat'>
                        <span className='es-stat__label'>Sample Size</span>
                        <span className='es-stat__value'>{bestResult.sampleSize}</span>
                    </div>
                    <div className='es-stat-divider' />
                    <div className='es-stat'>
                        <span className='es-stat__label'>Quality Score</span>
                        <span className='es-stat__value es-stat__value--blue'>{bestResult.qualityScore.toFixed(2)}%</span>
                    </div>
                    <div className='es-stat-divider' />
                    <div className='es-stat'>
                        <span className='es-stat__label'>Recent Win Rate</span>
                        <span className='es-stat__value es-stat__value--green'>{bestResult.recentWinRate.toFixed(1)}%</span>
                    </div>
                </div>
            )}

            {scanning && (
                <div className='es-progress-section'>
                    <div className='es-progress-bar-track'>
                        <div className='es-progress-bar-fill' style={{ width: `${progress}%` }} />
                    </div>
                    <div className='es-market-list'>
                        {marketProgress.map((m, i) => (
                            <div key={i} className={`es-market-item ${m.done ? 'es-market-item--done' : 'es-market-item--scanning'}`}>
                                <span className='es-market-item__dot' />
                                <span className='es-market-item__label'>{m.label}</span>
                                {m.done && m.wins !== undefined && (
                                    <span className='es-market-item__result'>{m.wins}%</span>
                                )}
                                {!m.done && <span className='es-market-item__spinner' />}
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {statusMsg && (
                <div className='es-status-msg'>{statusMsg}</div>
            )}

            {allResults.length > 0 && !scanning && (
                <div className='es-top-results'>
                    <div className='es-top-results__title'>🏆 Top Results</div>
                    {allResults.map((r, i) => (
                        <div key={i} className={`es-result-row ${i === 0 ? 'es-result-row--best' : ''}`}>
                            <span className='es-result-row__rank'>#{i + 1}</span>
                            <span className='es-result-row__market'>{r.marketLabel}</span>
                            <span className='es-result-row__strategy'>{r.strategy}</span>
                            <span className='es-result-row__digit'>Digit {r.entryDigit}</span>
                            <span className='es-result-row__quality'>{r.qualityScore.toFixed(1)}%</span>
                        </div>
                    ))}
                </div>
            )}

            <div className='es-actions'>
                {!scanning ? (
                    <button className='es-btn es-btn--primary' onClick={startScan}>
                        🔍 Deep Scan for Best Market
                    </button>
                ) : (
                    <button className='es-btn es-btn--stop' onClick={stopScan}>
                        ⏹ Stop Scan
                    </button>
                )}
            </div>
        </div>
    );
};

export default EntryScanner;
