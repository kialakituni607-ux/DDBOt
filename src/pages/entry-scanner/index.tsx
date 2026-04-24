import React, { useState, useRef } from 'react';
import './entry-scanner.scss';

const APP_ID = '116874';
const WS_URL = `wss://ws.derivws.com/websockets/v3?app_id=${APP_ID}`;

const MARKETS = [
    { symbol: '1HZ10V',  label: 'Volatility 10 (1s) Index'  },
    { symbol: '1HZ15V',  label: 'Volatility 15 (1s) Index'  },
    { symbol: '1HZ25V',  label: 'Volatility 25 (1s) Index'  },
    { symbol: '1HZ30V',  label: 'Volatility 30 (1s) Index'  },
    { symbol: '1HZ50V',  label: 'Volatility 50 (1s) Index'  },
    { symbol: '1HZ75V',  label: 'Volatility 75 (1s) Index'  },
    { symbol: '1HZ90V',  label: 'Volatility 90 (1s) Index'  },
    { symbol: '1HZ100V', label: 'Volatility 100 (1s) Index' },
    { symbol: 'R_10',    label: 'Volatility 10 Index'       },
    { symbol: 'R_15',    label: 'Volatility 15 Index'       },
    { symbol: 'R_25',    label: 'Volatility 25 Index'       },
    { symbol: 'R_30',    label: 'Volatility 30 Index'       },
    { symbol: 'R_50',    label: 'Volatility 50 Index'       },
    { symbol: 'R_75',    label: 'Volatility 75 Index'       },
    { symbol: 'R_90',    label: 'Volatility 90 Index'       },
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

// ─── Single shared WebSocket that handles all market requests via req_id ───────
type PendingRequest = {
    resolve: (prices: number[]) => void;
    reject: (err: Error) => void;
    timer: ReturnType<typeof setTimeout>;
};

function createSharedWS(): Promise<{
    fetchTicks: (symbol: string, count: number) => Promise<number[]>;
    close: () => void;
}> {
    return new Promise((resolve, reject) => {
        const ws = new WebSocket(WS_URL);
        const pending = new Map<number, PendingRequest>();
        let nextId = 1;
        let connTimer: ReturnType<typeof setTimeout>;

        connTimer = setTimeout(() => {
            ws.close();
            reject(new Error('Connection timeout'));
        }, 12000);

        ws.onopen = () => {
            clearTimeout(connTimer);
            resolve({
                fetchTicks(symbol: string, count: number) {
                    return new Promise<number[]>((res, rej) => {
                        const id = nextId++;
                        const timer = setTimeout(() => {
                            pending.delete(id);
                            rej(new Error(`Timeout: ${symbol}`));
                        }, 20000);
                        pending.set(id, { resolve: res, reject: rej, timer });
                        ws.send(JSON.stringify({
                            ticks_history: symbol,
                            count,
                            end: 'latest',
                            start: 1,
                            style: 'ticks',
                            req_id: id,
                        }));
                    });
                },
                close() { ws.close(); },
            });
        };

        ws.onmessage = event => {
            try {
                const msg = JSON.parse(event.data as string);
                const id: number | undefined = msg.req_id;
                if (id === undefined || !pending.has(id)) return;
                const { resolve: res, reject: rej, timer } = pending.get(id)!;
                clearTimeout(timer);
                pending.delete(id);
                if (msg.error) rej(new Error(msg.error.message));
                else res((msg.history?.prices as number[]) || []);
            } catch { /* ignore parse errors */ }
        };

        ws.onerror = () => {
            clearTimeout(connTimer);
            pending.forEach(({ reject: rej, timer }) => { clearTimeout(timer); rej(new Error('WS error')); });
            pending.clear();
            reject(new Error('WebSocket connection error'));
        };

        ws.onclose = () => {
            pending.forEach(({ reject: rej, timer }) => { clearTimeout(timer); rej(new Error('WS closed')); });
            pending.clear();
        };
    });
}

// ─── Analysis helpers ──────────────────────────────────────────────────────────
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

    const winCount      = triggerResults.filter(r => r.win).length;
    const winRate       = (winCount / triggerResults.length) * 100;
    const recentN       = Math.min(20, triggerResults.length);
    const recentWins    = triggerResults.slice(-recentN).filter(r => r.win).length;
    const recentWinRate = (recentWins / recentN) * 100;
    const sampleSize    = triggerResults.length;
    const qualityScore  = (winRate * 0.6 + recentWinRate * 0.4) * (sampleSize / (sampleSize + 3));

    const winDigits = triggerResults.filter(r => r.win).map(r => r.digit);
    const freq: Record<number, number> = {};
    winDigits.forEach(d => { freq[d] = (freq[d] || 0) + 1; });
    const entryDigit = winDigits.length > 0
        ? parseInt(Object.entries(freq).sort((a, b) => b[1] - a[1])[0][0], 10)
        : recoveryDigit;

    return { winRate, sampleSize, recentWinRate, qualityScore, entryDigit };
}

// ─── Component ────────────────────────────────────────────────────────────────
type MarketProgress = { label: string; status: 'pending' | 'scanning' | 'done' | 'failed'; winRate?: number };

const EntryScanner: React.FC = () => {
    const [tickCount, setTickCount]           = useState(500);
    const [scanning, setScanning]             = useState(false);
    const [progress, setProgress]             = useState(0);
    const [marketProgress, setMarketProgress] = useState<MarketProgress[]>([]);
    const [bestResult, setBestResult]         = useState<ScanResult | null>(null);
    const [topResults, setTopResults]         = useState<ScanResult[]>([]);
    const [statusMsg, setStatusMsg]           = useState('');
    const abortRef  = useRef(false);
    const wsRef     = useRef<{ fetchTicks: (s: string, c: number) => Promise<number[]>; close: () => void } | null>(null);

    const startScan = async () => {
        abortRef.current = false;
        setScanning(true);
        setBestResult(null);
        setTopResults([]);
        setProgress(0);
        setStatusMsg('Connecting to Deriv live market data...');
        setMarketProgress(MARKETS.map(m => ({ label: m.label, status: 'pending' })));

        // Collect best result per market, plus overall best
        const perMarketBest: ScanResult[] = [];
        let overallBest: ScanResult | null = null;

        try {
            setStatusMsg('Opening WebSocket connection...');
            const ws = await createSharedWS();
            wsRef.current = ws;

            for (let mi = 0; mi < MARKETS.length; mi++) {
                if (abortRef.current) break;
                const market = MARKETS[mi];

                setMarketProgress(prev => prev.map((p, i) => i === mi ? { ...p, status: 'scanning' } : p));
                setStatusMsg(`Scanning ${market.label}...`);

                try {
                    const prices = await ws.fetchTicks(market.symbol, tickCount);
                    if (abortRef.current) break;

                    const digits = prices.map(getLastDigit);
                    let bestForMarket: ScanResult | null = null;

                    for (const strat of STRATEGIES) {
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
                        if (!bestForMarket || sr.qualityScore > bestForMarket.qualityScore) bestForMarket = sr;
                    }

                    if (bestForMarket) {
                        perMarketBest.push(bestForMarket);
                        if (!overallBest || bestForMarket.qualityScore > overallBest.qualityScore) overallBest = bestForMarket;
                    }

                    setMarketProgress(prev => prev.map((p, i) =>
                        i === mi ? { ...p, status: 'done', winRate: bestForMarket ? Math.round(bestForMarket.winRate) : 0 } : p
                    ));
                } catch {
                    setMarketProgress(prev => prev.map((p, i) => i === mi ? { ...p, status: 'failed' } : p));
                }

                setProgress(Math.round(((mi + 1) / MARKETS.length) * 100));
            }

            ws.close();
            wsRef.current = null;
        } catch (err: any) {
            setStatusMsg(`Connection error: ${err?.message || 'Unknown error'}. Try again.`);
            setScanning(false);
            return;
        }

        // Sort per-market best by quality score descending
        perMarketBest.sort((a, b) => b.qualityScore - a.qualityScore);

        // Weighted random selection among markets within 15% of the top score
        // (markets this close are statistically equal — this prevents the same market always winning)
        let selected: ScanResult | null = null;
        if (perMarketBest.length > 0) {
            const topScore = perMarketBest[0].qualityScore;
            const candidates = perMarketBest.filter(r => r.qualityScore >= topScore * 0.85);
            const totalWeight = candidates.reduce((s, r) => s + r.qualityScore, 0);
            let pick = Math.random() * totalWeight;
            for (const c of candidates) {
                pick -= c.qualityScore;
                if (pick <= 0) { selected = c; break; }
            }
            if (!selected) selected = candidates[0];
        }

        setTopResults(selected ? [selected] : []);
        setBestResult(selected);

        if (overallBest) {
            setStatusMsg(
                `✅ Best: ${overallBest.marketLabel} | ${overallBest.strategy} | Entry ${overallBest.entryDigit} | Quality ${overallBest.qualityScore.toFixed(2)}%`
            );
        } else {
            setStatusMsg('Scan complete. Could not retrieve data. Check your connection and try again.');
        }
        setScanning(false);
    };

    const stopScan = () => {
        abortRef.current = true;
        wsRef.current?.close();
        wsRef.current = null;
        setScanning(false);
        setStatusMsg('Scan stopped.');
    };

    const statusIcon = (s: MarketProgress['status']) => {
        if (s === 'done')     return <span className='es-market-item__check'>✓</span>;
        if (s === 'failed')   return <span className='es-market-item__fail'>✗</span>;
        if (s === 'scanning') return <span className='es-market-item__spinner' />;
        return <span className='es-market-item__dot' />;
    };

    return (
        <div className='entry-scanner'>
            <div className='es-header'>
                <div className='es-header__title'>
                    <span className='es-header__icon'>🔍</span>
                    Entry Scanner
                </div>
                <p className='es-header__desc'>
                    Deep scanner evaluates all {MARKETS.length} synthetic volatility markets using real Deriv tick data,
                    finds the best entry point digit and strategy profile across all Over/Under recovery combinations.
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

            {(scanning || marketProgress.length > 0) && (
                <div className='es-progress-section'>
                    {scanning && (
                        <div className='es-progress-bar-track'>
                            <div className='es-progress-bar-fill' style={{ width: `${progress}%` }} />
                            <span className='es-progress-bar-label'>{progress}%</span>
                        </div>
                    )}
                    <div className='es-market-grid'>
                        {marketProgress.map((m, i) => (
                            <div
                                key={i}
                                className={`es-market-item es-market-item--${m.status}`}
                            >
                                {statusIcon(m.status)}
                                <span className='es-market-item__label'>{m.label}</span>
                                {m.status === 'done' && m.winRate !== undefined && (
                                    <span className='es-market-item__result'>{m.winRate}%</span>
                                )}
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {statusMsg && (
                <div className={`es-status-msg ${statusMsg.startsWith('✅') ? 'es-status-msg--success' : ''}`}>
                    {statusMsg}
                </div>
            )}

            {topResults.length > 0 && !scanning && (
                <div className='es-top-results'>
                    <div className='es-top-results__title'>🏆 Best Strategy Per Market</div>
                    <div className='es-top-results__legend'>
                        <span>Market</span>
                        <span>Strategy</span>
                        <span>Digit</span>
                        <span>Quality</span>
                    </div>
                    {topResults.map((r, i) => (
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
