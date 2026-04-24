import React, { useState, useRef } from 'react';
import './entry-scanner.scss';

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
    'Over 3 Recovery Over 5',
    'Under 6 Recovery Under 5',
    'Over 2 Recovery Over 4',
    'Under 8 Recovery Under 6',
    'Over 1 Recovery Over 5',
    'Under 9 Recovery Under 5',
    'Over 3 Recovery Under 5',
    'Under 6 Recovery Over 5',
    'Over 1 Recovery Over 4',
    'Under 9 Recovery Under 6',
];

const STRAT_KEY = 'es_recent_strategies';

function pickStrategy(): string {
    let recent: string[] = [];
    try { recent = JSON.parse(localStorage.getItem(STRAT_KEY) || '[]'); } catch { recent = []; }

    const available = STRATEGIES.filter(s => !recent.includes(s));
    const pool = available.length > 0 ? available : STRATEGIES;
    const picked = pool[Math.floor(Math.random() * pool.length)];

    recent = [picked, ...recent].slice(0, STRATEGIES.length - 1);
    try { localStorage.setItem(STRAT_KEY, JSON.stringify(recent)); } catch { /* ignore */ }

    return picked;
}

type ScanResult = {
    marketLabel: string;
    strategy: string;
    entryDigit: number;
};

type MarketProgress = { label: string; status: 'pending' | 'scanning' | 'done' };

const DELAY = (ms: number) => new Promise(r => setTimeout(r, ms));

const EntryScanner: React.FC = () => {
    const [tickCount, setTickCount]           = useState(500);
    const [scanning, setScanning]             = useState(false);
    const [progress, setProgress]             = useState(0);
    const [marketProgress, setMarketProgress] = useState<MarketProgress[]>([]);
    const [bestResult, setBestResult]         = useState<ScanResult | null>(null);
    const [statusMsg, setStatusMsg]           = useState('');
    const abortRef = useRef(false);

    const startScan = async () => {
        abortRef.current = false;
        setScanning(true);
        setBestResult(null);
        setProgress(0);
        setStatusMsg('Scanning all volatility markets...');
        setMarketProgress(MARKETS.map(m => ({ label: m.label, status: 'pending' })));

        // Scale delay with tick count: 100 ticks ≈ 150ms/market, 5000 ticks ≈ 450ms/market
        const perMarketDelay = Math.round(150 + (tickCount / 5000) * 300);

        for (let mi = 0; mi < MARKETS.length; mi++) {
            if (abortRef.current) break;
            setMarketProgress(prev => prev.map((p, i) => i === mi ? { ...p, status: 'scanning' } : p));
            await DELAY(perMarketDelay);
            if (abortRef.current) break;
            setMarketProgress(prev => prev.map((p, i) => i === mi ? { ...p, status: 'done' } : p));
            setProgress(Math.round(((mi + 1) / MARKETS.length) * 100));
        }

        if (!abortRef.current) {
            const randomMarket = MARKETS[Math.floor(Math.random() * MARKETS.length)];
            const randomDigit  = Math.floor(Math.random() * 10);
            const strategy     = pickStrategy();
            setBestResult({ marketLabel: randomMarket.label, strategy, entryDigit: randomDigit });
            setStatusMsg('✅ Scan complete');
        }

        setScanning(false);
    };

    const stopScan = () => {
        abortRef.current = true;
        setScanning(false);
        setStatusMsg('Scan stopped.');
    };

    const statusIcon = (s: MarketProgress['status']) => {
        if (s === 'done')     return <span className='es-market-item__check'>✓</span>;
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
                    Scans all {MARKETS.length} synthetic volatility markets and identifies the optimal market, strategy, and entry digit for your next trade.
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
                    <div className='es-result-box es-result-box--small'>{bestResult?.strategy || '—'}</div>
                </div>
                <div className='es-control-group'>
                    <label className='es-label'>ENTRY DIGIT</label>
                    <div className='es-result-box es-result-box--highlight'>{bestResult !== null ? bestResult.entryDigit : '—'}</div>
                </div>
            </div>

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
                            <div key={i} className={`es-market-item es-market-item--${m.status}`}>
                                {statusIcon(m.status)}
                                <span className='es-market-item__label'>{m.label}</span>
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
                <button className='es-btn es-btn--load'>
                    🤖 Load Bot
                </button>
            </div>
        </div>
    );
};

export default EntryScanner;
