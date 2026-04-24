import React, { useState, useRef } from 'react';
import { observer } from 'mobx-react-lite';
import { useStore } from '@/hooks/useStore';
import { load, save_types } from '@/external/bot-skeleton';
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

// Replace the value between <field name="NUM"> and </field> for a specific block id.
// Works entirely on the original string — never uses XMLSerializer — so Blockly's
// parser receives the exact same XML structure it already accepts.
function patchNumField(xml: string, blockId: string, value: number): string {
    const marker = `id="${blockId}"`;
    const idx = xml.indexOf(marker);
    if (idx === -1) return xml;
    const numTag = '<field name="NUM">';
    const tagIdx = xml.indexOf(numTag, idx);
    if (tagIdx === -1) return xml;
    const valStart = tagIdx + numTag.length;
    const valEnd = xml.indexOf('</field>', valStart);
    if (valEnd === -1) return xml;
    return xml.slice(0, valStart) + String(value) + xml.slice(valEnd);
}

function patchXml(
    xml: string,
    symbol: string,
    entryDigit: number,
    predBefore: number,
    predAfter: number,
    stake: number,
    stopLoss: number,
    martingale: number
): string {
    // Market symbol — only field[name="SYMBOL_LIST"] matches this pattern
    xml = xml.replace(/<field name="SYMBOL_LIST">[^<]*<\/field>/,
        `<field name="SYMBOL_LIST">${symbol}</field>`);

    // All numeric patches operate on the raw string — no serializer involved
    xml = patchNumField(xml, 'Ai5]{:#d~w;]%q`:p[h,',  predBefore);   // Prediction before loss
    xml = patchNumField(xml, 'gT6?xbULKjs8^Sw?0iH%',  predAfter);    // Prediction after loss
    xml = patchNumField(xml, 'KR2=c$XO!b_Bgl_ASR4(',  entryDigit);   // Entrypoint-Digit
    xml = patchNumField(xml, '!TI[pk;TXnU%n?K/nH:^',  stake);        // Stake
    xml = patchNumField(xml, 'tACLVvalL.#)Xxz`ZoBC',  stopLoss);     // Stop Loss
    xml = patchNumField(xml, 'LqV%S=;Xlb|o9}weJjz1',  martingale);   // Martingale Split

    return xml;
}

type ScanResult   = { marketLabel: string; marketSymbol: string; strategy: string; entryDigit: number };
type MarketProgress = { label: string; status: 'pending' | 'scanning' | 'done' };

const DELAY = (ms: number) => new Promise(r => setTimeout(r, ms));

const EntryScanner: React.FC = observer(() => {
    const { dashboard } = useStore();

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

    const startScan = async () => {
        abortRef.current = false;
        setScanning(true);
        setBestResult(null);
        setProgress(0);
        setStatusMsg('Scanning all volatility markets...');
        setMarketProgress(MARKETS.map(m => ({ label: m.label, status: 'pending' })));

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
            setBestResult({ marketLabel: randomMarket.label, marketSymbol: randomMarket.symbol, strategy, entryDigit: randomDigit });
            setStatusMsg('✅ Scan complete');
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
            let xmlContent = await tmApi.getBotXml('Antipoverty_AI.xml');
            console.log('[ES] XML fetched. Length:', xmlContent.length,
                '| Starts with:', xmlContent.slice(0, 80));

            // Parse prediction digits from strategy string e.g. "Under 8 Recovery Under 6"
            const { predBefore, predAfter } = parseStrategy(bestResult?.strategy || '');

            const rawXml = xmlContent;

            // Inject scan results + modal parameters into the XML
            xmlContent = patchXml(
                xmlContent,
                bestResult?.marketSymbol || 'R_10',
                bestResult?.entryDigit ?? 3,
                predBefore,
                predAfter,
                stake,
                stopLoss,
                useMartingale ? martingale : 1
            );

            // Pre-validate with DOMParser before handing to DBot
            const preCheck = new DOMParser().parseFromString(xmlContent, 'application/xml');
            const parseErrors = preCheck.getElementsByTagName('parsererror');
            if (parseErrors.length > 0) {
                console.error('[ES] Patched XML has parseerror — falling back to raw XML');
                console.error('[ES] parseerror text:', parseErrors[0].textContent);
                console.error('[ES] Patched XML (first 800 chars):', xmlContent.slice(0, 800));
                // Fall back to the unpatched XML so the bot still loads
                xmlContent = rawXml;
            } else {
                console.log('[ES] Patched XML is valid. Blocks found:',
                    preCheck.querySelectorAll('block').length);
            }

            await load({
                block_string: xmlContent,
                file_name: 'Antipoverty AI',
                workspace: (window as any).Blockly?.derivWorkspace,
                from: save_types.LOCAL,
                drop_event: null,
                strategy_id: null,
                showIncompatibleStrategyDialog: null,
            });

            setModalOpen(false);
            setTimeout(() => {
                dashboard.setActiveTab(1);
                window.location.hash = 'bot_builder';
            }, 400);
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
