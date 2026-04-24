import { useState } from 'react';
import { observer } from 'mobx-react-lite';
import { useStore } from '@/hooks/useStore';
import { load, save_types } from '@/external/bot-skeleton';
import tmApi from '@/utils/tm-api';
import './antipoverty-ai.scss';

const AntiPovertyAI = observer(() => {
    const { dashboard } = useStore();
    const [loading, setLoading] = useState(false);
    const [loaded, setLoaded] = useState(false);

    const loadBot = async () => {
        try {
            setLoading(true);
            const xmlContent = await tmApi.getBotXml('Antipoverty_AI.xml');
            await load({
                block_string: xmlContent,
                file_name: 'Antipoverty AI',
                workspace: (window as any).Blockly?.derivWorkspace,
                from: save_types.LOCAL,
                drop_event: null,
                strategy_id: null,
                showIncompatibleStrategyDialog: null,
            });
            setLoaded(true);
            setTimeout(() => {
                dashboard.setActiveTab(1);
                window.location.hash = 'bot_builder';
            }, 800);
        } catch (error) {
            console.error('Error loading Antipoverty AI:', error);
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className='antipoverty-ai'>
            <div className='apai-hero'>
                <div className='apai-hero__badge'>EXCLUSIVE BOT</div>
                <div className='apai-hero__icon'>💰</div>
                <h1 className='apai-hero__title'>Antipoverty AI</h1>
                <p className='apai-hero__tagline'>
                    Smart Over/Under digit bot with recovery logic, martingale, and automatic profit protection.
                </p>
            </div>

            <div className='apai-stats'>
                <div className='apai-stat'>
                    <span className='apai-stat__icon'>🎯</span>
                    <span className='apai-stat__value'>Over/Under</span>
                    <span className='apai-stat__label'>Trade Type</span>
                </div>
                <div className='apai-stat'>
                    <span className='apai-stat__icon'>📊</span>
                    <span className='apai-stat__value'>Volatility 10</span>
                    <span className='apai-stat__label'>Default Market</span>
                </div>
                <div className='apai-stat'>
                    <span className='apai-stat__icon'>💵</span>
                    <span className='apai-stat__value'>$0.50</span>
                    <span className='apai-stat__label'>Initial Stake</span>
                </div>
                <div className='apai-stat'>
                    <span className='apai-stat__icon'>🔄</span>
                    <span className='apai-stat__value'>Martingale x2</span>
                    <span className='apai-stat__label'>Recovery Mode</span>
                </div>
            </div>

            <div className='apai-strategy'>
                <h2 className='apai-strategy__title'>How It Works</h2>
                <div className='apai-strategy__steps'>
                    <div className='apai-step'>
                        <div className='apai-step__num'>1</div>
                        <div className='apai-step__content'>
                            <strong>Entry Condition</strong>
                            <p>Watches for the Entrypoint Digit (default: 3) before placing a trade.</p>
                        </div>
                    </div>
                    <div className='apai-step'>
                        <div className='apai-step__num'>2</div>
                        <div className='apai-step__content'>
                            <strong>Main Prediction</strong>
                            <p>Bets Under 8 (Prediction Before Loss = 8) on first entry — high win probability.</p>
                        </div>
                    </div>
                    <div className='apai-step'>
                        <div className='apai-step__num'>3</div>
                        <div className='apai-step__content'>
                            <strong>Recovery After Loss</strong>
                            <p>Switches to Under 5 (Prediction After Loss = 5) and doubles stake using Martingale x2.</p>
                        </div>
                    </div>
                    <div className='apai-step'>
                        <div className='apai-step__num'>4</div>
                        <div className='apai-step__content'>
                            <strong>Auto Take Profit / Stop Loss</strong>
                            <p>Stops automatically at $100 profit or $50 loss — protecting your account.</p>
                        </div>
                    </div>
                </div>
            </div>

            <div className='apai-params'>
                <h2 className='apai-params__title'>Default Parameters</h2>
                <div className='apai-params__grid'>
                    <div className='apai-param'>
                        <span className='apai-param__key'>Prediction Before Loss</span>
                        <span className='apai-param__val'>8 (Under 8)</span>
                    </div>
                    <div className='apai-param'>
                        <span className='apai-param__key'>Prediction After Loss</span>
                        <span className='apai-param__val'>5 (Under 5)</span>
                    </div>
                    <div className='apai-param'>
                        <span className='apai-param__key'>Entrypoint Digit</span>
                        <span className='apai-param__val'>3</span>
                    </div>
                    <div className='apai-param'>
                        <span className='apai-param__key'>Initial Stake</span>
                        <span className='apai-param__val'>$0.50</span>
                    </div>
                    <div className='apai-param'>
                        <span className='apai-param__key'>Take Profit</span>
                        <span className='apai-param__val'>$100</span>
                    </div>
                    <div className='apai-param'>
                        <span className='apai-param__key'>Stop Loss</span>
                        <span className='apai-param__val'>$50</span>
                    </div>
                    <div className='apai-param'>
                        <span className='apai-param__key'>Martingale Split</span>
                        <span className='apai-param__val'>×2</span>
                    </div>
                    <div className='apai-param'>
                        <span className='apai-param__key'>Payout %</span>
                        <span className='apai-param__val'>39%</span>
                    </div>
                </div>
            </div>

            <div className='apai-warning'>
                <span className='apai-warning__icon'>⚠️</span>
                Always test with a <strong>demo account</strong> before using real funds. Trading involves risk.
            </div>

            <div className='apai-actions'>
                <button
                    className={`apai-btn ${loaded ? 'apai-btn--success' : 'apai-btn--primary'}`}
                    onClick={loadBot}
                    disabled={loading || loaded}
                >
                    {loading ? (
                        <><span className='apai-btn__spinner' /> Loading bot...</>
                    ) : loaded ? (
                        <>✅ Bot Loaded — Redirecting to Builder</>
                    ) : (
                        <>💰 Load Antipoverty AI into Bot Builder</>
                    )}
                </button>
            </div>
        </div>
    );
});

export default AntiPovertyAI;
