import React, { useState, useRef } from 'react';
import { observer } from 'mobx-react-lite';
import { useStore } from '@/hooks/useStore';
import { load, save_types } from '@/external/bot-skeleton';
import { generateDerivApiInstance } from '@/external/bot-skeleton/services/api/appId';
import tmApi from '@/utils/tm-api';
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

// Parse "Under 8 Recovery Under 6" → { predBefore: 8, predAfter: 6 }
function parseStrategy(strategy: string): { predBefore: number; predAfter: number } {
    const match = strategy.match(/\d+/g);
    if (match && match.length >= 2) {
        return { predBefore: parseInt(match[0]), predAfter: parseInt(match[1]) };
    }
    return { predBefore: 8, predAfter: 5 };
}

// After the bot loads, walk the workspace and set values using Blockly's own API.
// This avoids all XML patching — the raw XML is loaded untouched, then workspace
// blocks are updated in-place by variable name, which is far more reliable.
function applyParamsToWorkspace(params: {
    predBefore: number;
    predAfter: number;
    entryDigit: number;
    stake: number;
    stopLoss: number;
    martingale: number;
    symbol?: string;
}) {
    const workspace = (window as any).Blockly?.derivWorkspace;
    if (!workspace) return;

    const numMap: Record<string, number> = {
        'Prediction before loss': params.predBefore,
        'Prediction after loss':  params.predAfter,
        'Entrypoint-Digit':       params.entryDigit,
        'Stake':                  params.stake,
        'Stop Loss':              params.stopLoss,
        'Martingale Split':       params.martingale,
    };

    workspace.getAllBlocks(false)
        .filter((b: any) => b.type === 'variables_set')
        .forEach((block: any) => {
            const varName = block.getField('VAR')?.getText?.();
            if (!varName || !(varName in numMap)) return;
            const valueBlock = block.getInput('VALUE')?.connection?.targetBlock?.();
            if (valueBlock?.type === 'math_number') {
                valueBlock.setFieldValue(String(numMap[varName]), 'NUM');
            }
        });

    // Set the market symbol on the trade_definition_market block.
    // The SYMBOL_LIST dropdown is populated from the Deriv API after workspace load,
    // so we set it after the numeric fields to maximise the chance the options are ready.
    if (params.symbol) {
        const marketBlock = workspace.getAllBlocks(false)
            .find((b: any) => b.type === 'trade_definition_market');
        if (marketBlock) {
            try {
                marketBlock.setFieldValue(params.symbol, 'SYMBOL_LIST');
            } catch {
                // Dropdown may not have the option yet — silently ignore
            }
        }
    }
}

type ScanResult   = { marketLabel: string; marketSymbol: string; strategy: string; entryDigit: number };
type MarketProgress = { label: string; status: 'pending' | 'scanning' | 'done' };

const DELAY = (ms: number) => new Promise(r => setTimeout(r, ms));

const EntryScanner: React.FC = observer(() => {
    const { dashboard, run_panel } = useStore();

    const [tickCount, setTickCount]           = useState(500);
    const [scanning, setScanning]             = useState(false);
    const [progress, setProgress]             = useState(0);
    const [marketProgress, setMarketProgress] = useState<MarketProgress[]>([]);
    const [bestResult, setBestResult]         = useState<ScanResult | null>(null);
    const [statusMsg, setStatusMsg]           = useState('');
    const abortRef = useRef(false);

    // Modal state
    const [modalOpen, setModalOpen]           = useState(false);
    const [launching, setLaunching]           = useState(false);
    const [stake, setStake]                   = useState(0.5);
    const [martingale, setMartingale]         = useState(2);
    const [numWins, setNumWins]               = useState(5);
    const [digitsToCheck, setDigitsToCheck]   = useState(1);
    const [stopLoss, setStopLoss]             = useState(50);
    const [useMartingale, setUseMartingale]   = useState(true);
    const [autoStart, setAutoStart]           = useState(true);

    const startScan = async () => {
        abortRef.current = false;
        setScanning(true);
        setBestResult(null);
        setProgress(0);
        setStatusMsg('Connecting to market data...');
        setMarketProgress(MARKETS.map(m => ({ label: m.label, status: 'pending' })));

        // Pick a strategy up front so all markets are scored against the same one
        const strategy = pickStrategy();
        const { predBefore } = parseStrategy(strategy);
        const isUnder = strategy.toLowerCase().startsWith('under');

        // Extract the true last decimal digit from a tick price
        // e.g. 9823.147 → 7,  1234.56 → 6
        const getLastDigit = (price: number): number => {
            const s = price.toString();
            const dot = s.indexOf('.');
            if (dot === -1) return Math.abs(price) % 10;
            return parseInt(s[s.length - 1], 10);
        };

        // Create a dedicated WebSocket API just for scanning
        let api: any = null;
        try {
            api = generateDerivApiInstance();
        } catch (e) {
            setStatusMsg('⚠️ Could not connect to market data. Check your connection.');
            setScanning(false);
            return;
        }

        let best: ScanResult | null = null;
        let bestScore = -1;

        for (let mi = 0; mi < MARKETS.length; mi++) {
            if (abortRef.current) break;

            const { symbol, label } = MARKETS[mi];
            setMarketProgress(prev => prev.map((p, i) => i === mi ? { ...p, status: 'scanning' } : p));
            setStatusMsg(`Scanning ${label}…`);

            try {
                const response: any = await api.send({
                    ticks_history: symbol,
                    count: tickCount,
                    end: 'latest',
                    start: 1,
                    style: 'ticks',
                    adjust_start_time: 1,
                });

                const prices: number[] = response.history.prices.map(Number);
                const digits = prices.map(getLastDigit);

                // Win rate for the primary prediction digit
                const wins = digits.filter(d => isUnder ? d < predBefore : d > predBefore).length;
                const score = wins / digits.length;

                // Entry digit = last digit that appeared (most recent tick)
                const entryDigit = digits[digits.length - 1] ?? 3;

                if (score > bestScore) {
                    bestScore = score;
                    best = { marketLabel: label, marketSymbol: symbol, strategy, entryDigit };
                }
            } catch (e) {
                console.warn(`[ES] Could not fetch ticks for ${symbol}:`, e);
            }

            setMarketProgress(prev => prev.map((p, i) => i === mi ? { ...p, status: 'done' } : p));
            setProgress(Math.round(((mi + 1) / MARKETS.length) * 100));
        }

        // Clean up the scan connection
        try { api.disconnect?.(); } catch { /* ignore */ }

        if (!abortRef.current) {
            if (best) {
                setBestResult(best);
                setStatusMsg(`✅ Scan complete — ${(bestScore * 100).toFixed(1)}% win-rate on best market`);
            } else {
                setStatusMsg('⚠️ Scan finished but could not retrieve market data. Check connection.');
            }
        }

        setScanning(false);
    };

    const stopScan = () => {
        abortRef.current = true;
        setScanning(false);
        setStatusMsg('Scan stopped.');
    };

    const handleLaunchBot = async () => {
        if (launching) return;
        setLaunching(true);
        try {
            // Fetch raw XML exactly as Antipoverty AI page does — no patching
            const xmlContent = await tmApi.getBotXml('Antipoverty_AI.xml');
            console.log('[ES] XML fetched. Length:', xmlContent.length);

            // Parse prediction digits from strategy e.g. "Under 8 Recovery Under 6"
            const { predBefore, predAfter } = parseStrategy(bestResult?.strategy || '');

            // CRITICAL: Navigate to bot builder BEFORE loading.
            // The Blockly workspace only initialises when the bot builder tab is rendered.
            // Calling load() from the Entry Scanner tab (workspace not yet ready) triggers
            // the "unsupported elements" error even with a perfectly valid XML file.
            setModalOpen(false);
            dashboard.setActiveTab(1);
            window.location.hash = 'bot_builder';

            // Poll until the workspace AND all custom DBot block types are ready (up to 8 s).
            // Custom blocks (trade_definition, after_purchase, etc.) are registered when the
            // bot-builder module loads. If those haven't loaded yet, load() will throw
            // "unsupported elements" even with a perfectly valid XML file.
            let workspace: any = null;
            for (let i = 0; i < 80; i++) {
                const B = (window as any).Blockly;
                if (
                    B?.derivWorkspace &&
                    B?.Blocks?.['trade_definition'] &&
                    B?.Blocks?.['after_purchase'] &&
                    B?.Blocks?.['trade_definition_market']
                ) {
                    workspace = B.derivWorkspace;
                    break;
                }
                await new Promise(r => setTimeout(r, 100));
            }
            if (!workspace) throw new Error('Blockly workspace/blocks did not initialise in time.');

            // Load unmodified XML — same call as Antipoverty AI page
            await load({
                block_string: xmlContent,
                file_name: 'Antipoverty AI',
                workspace,
                from: save_types.LOCAL,
                drop_event: null,
                strategy_id: null,
                showIncompatibleStrategyDialog: null,
            });

            const symbol = bestResult?.marketSymbol;

            // Apply numeric params immediately after load
            applyParamsToWorkspace({
                predBefore,
                predAfter,
                entryDigit: bestResult?.entryDigit ?? 3,
                stake,
                stopLoss,
                martingale: useMartingale ? martingale : 1,
                symbol,
            });

            // The SYMBOL_LIST dropdown is populated asynchronously from the Deriv API.
            // Retry setting the market for up to 4 s until the field value actually sticks.
            if (symbol) {
                for (let i = 0; i < 40; i++) {
                    await new Promise(r => setTimeout(r, 100));
                    const B = (window as any).Blockly;
                    const mBlock = B?.derivWorkspace?.getAllBlocks(false)
                        ?.find((b: any) => b.type === 'trade_definition_market');
                    if (!mBlock) break;
                    const currentVal = mBlock.getFieldValue('SYMBOL_LIST');
                    if (currentVal === symbol) break;
                    try { mBlock.setFieldValue(symbol, 'SYMBOL_LIST'); } catch { /* not ready yet */ }
                }
            }

            // Auto-start: trigger the Run button programmatically so the bot
            // starts trading immediately without the user having to click Run.
            if (autoStart) {
                await run_panel.onRunButtonClick();
            }
        } catch (err) {
            console.error('Failed to launch bot:', err);
            setStatusMsg('⚠️ Failed to load bot. Please try again.');
        } finally {
            setLaunching(false);
        }
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
                <button className='es-btn es-btn--load' onClick={() => setModalOpen(true)}>
                    🤖 Load Bot
                </button>
            </div>

            {/* ── Scanner Parameters Modal ─────────────────────────────── */}
            {modalOpen && (
                <div className='es-modal-overlay' onClick={() => setModalOpen(false)}>
                    <div className='es-modal' onClick={e => e.stopPropagation()}>
                        <div className='es-modal__header'>
                            <span className='es-modal__title'>Scanner Parameters</span>
                            <button className='es-modal__close' onClick={() => setModalOpen(false)}>✕</button>
                        </div>

                        {/* Scan results — auto-filled from deep scan */}
                        <div className='es-modal__results'>
                            <div className='es-modal__result-item es-modal__result-item--full'>
                                <span className='es-modal__label'>BEST MARKET</span>
                                <span className='es-modal__result-value'>{bestResult?.marketLabel || '— Run a deep scan first —'}</span>
                                {bestResult && (
                                    <span className='es-modal__market-hint'>
                                        ⚠ Set market to <strong>{bestResult.marketSymbol}</strong> in the Bot Builder after loading
                                    </span>
                                )}
                            </div>
                            <div className='es-modal__result-item'>
                                <span className='es-modal__label'>STRATEGY</span>
                                <span className='es-modal__result-value es-modal__result-value--small'>{bestResult?.strategy || '—'}</span>
                            </div>
                            <div className='es-modal__result-item'>
                                <span className='es-modal__label'>ENTRY DIGIT</span>
                                <span className='es-modal__result-value es-modal__result-value--digit'>{bestResult !== null ? bestResult.entryDigit : '—'}</span>
                            </div>
                        </div>

                        <div className='es-modal__divider' />

                        <div className='es-modal__grid'>
                            <div className='es-modal__field'>
                                <label className='es-modal__label'>STAKE</label>
                                <input className='es-modal__input' type='number' min={0.35} step={0.01}
                                    value={stake} onChange={e => setStake(parseFloat(e.target.value) || 0.35)} />
                            </div>
                            <div className='es-modal__field'>
                                <label className='es-modal__label'>MARTINGALE</label>
                                <input className='es-modal__input' type='number' min={1} step={0.1}
                                    value={martingale} onChange={e => setMartingale(parseFloat(e.target.value) || 1)} />
                            </div>
                            <div className='es-modal__field'>
                                <label className='es-modal__label'>NUMBER OF WINS</label>
                                <input className='es-modal__input' type='number' min={1}
                                    value={numWins} onChange={e => setNumWins(parseInt(e.target.value) || 1)} />
                            </div>
                            <div className='es-modal__field'>
                                <label className='es-modal__label'>NO. OF DIGITS TO CHECK</label>
                                <input className='es-modal__input' type='number' min={1} max={10}
                                    value={digitsToCheck} onChange={e => setDigitsToCheck(parseInt(e.target.value) || 1)} />
                            </div>
                            <div className='es-modal__field es-modal__field--full'>
                                <label className='es-modal__label'>STOP LOSS</label>
                                <input className='es-modal__input' type='number' min={1}
                                    value={stopLoss} onChange={e => setStopLoss(parseInt(e.target.value) || 1)} />
                            </div>
                        </div>

                        <div className='es-modal__toggle-row'>
                            <span className='es-modal__toggle-label'>Use Martingale</span>
                            <button
                                className={`es-modal__toggle ${useMartingale ? 'es-modal__toggle--on' : ''}`}
                                onClick={() => setUseMartingale(v => !v)}
                            >
                                <span className='es-modal__toggle-knob' />
                            </button>
                        </div>

                        <div className='es-modal__toggle-row'>
                            <div>
                                <span className='es-modal__toggle-label'>Auto-Start Trading</span>
                                <div className='es-modal__toggle-desc'>Bot runs immediately without opening Bot Builder</div>
                            </div>
                            <button
                                className={`es-modal__toggle ${autoStart ? 'es-modal__toggle--on' : ''}`}
                                onClick={() => setAutoStart(v => !v)}
                            >
                                <span className='es-modal__toggle-knob' />
                            </button>
                        </div>

                        <div className='es-modal__actions'>
                            <button className='es-modal__btn es-modal__btn--cancel' onClick={() => setModalOpen(false)}>
                                Cancel
                            </button>
                            <button
                                className='es-modal__btn es-modal__btn--launch'
                                onClick={handleLaunchBot}
                                disabled={launching}
                            >
                                {launching ? <><span className='es-modal__spinner' /> Loading...</> : '▶ Launch Bot'}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
});

export default EntryScanner;
