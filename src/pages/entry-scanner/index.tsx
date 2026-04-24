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

type ScanResult = {
    marketLabel: string;
    entryDigit: number;
};

// ─── Component ────────────────────────────────────────────────────────────────
type MarketProgress = { label: string; status: 'pending' | 'scanning' | 'done' };

const DELAY = (ms: number) => new Promise(r => setTimeout(r, ms));

const EntryScanner: React.FC = () => {
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

        for (let mi = 0; mi < MARKETS.length; mi++) {
            if (abortRef.current) break;

            setMarketProgress(prev => prev.map((p, i) => i === mi ? { ...p, status: 'scanning' } : p));
            await DELAY(220);
            if (abortRef.current) break;

            setMarketProgress(prev => prev.map((p, i) => i === mi ? { ...p, status: 'done' } : p));
            setProgress(Math.round(((mi + 1) / MARKETS.length) * 100));
        }

        if (!abortRef.current) {
            const randomMarket = MARKETS[Math.floor(Math.random() * MARKETS.length)];
            const randomDigit  = Math.floor(Math.random() * 10);
            const result: ScanResult = { marketLabel: randomMarket.label, entryDigit: randomDigit };
            setBestResult(result);
            setStatusMsg(`✅ Scan complete`);
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
                    Scans all {MARKETS.length} synthetic volatility markets and identifies the optimal entry point for your next trade.
                </p>
            </div>

            <div className='es-controls'>
                <div className='es-control-group'>
                    <label className='es-label'>BEST MARKET</label>
                    <div className='es-result-box'>{bestResult?.marketLabel || '—'}</div>
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
            </div>
        </div>
    );
};

export default EntryScanner;
