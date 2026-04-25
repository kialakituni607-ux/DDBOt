import React, { useState } from 'react';
import { observer } from 'mobx-react-lite';
import { useStore } from '@/hooks/useStore';
import Journal from '@/components/journal';
import Summary from '@/components/summary';
import Transactions from '@/components/transactions';
import './es-overlay.scss';

type Tab = 'summary' | 'transactions' | 'journal';

const EsOverlay: React.FC = observer(() => {
    const { dashboard, run_panel } = useStore();
    const { is_es_overlay_active, setEsOverlayActive } = dashboard;
    const [tab, setTab] = useState<Tab>('summary');

    if (!is_es_overlay_active) return null;

    return (
        <div className='es-overlay'>
            <div className='es-overlay__header'>
                <div className='es-overlay__title'>
                    <span className='es-overlay__title-icon'>🤖</span>
                    Bot Trading Live
                </div>
                <div className='es-overlay__status'>
                    <span
                        className={`es-overlay__status-dot ${run_panel.is_running ? 'es-overlay__status-dot--live' : ''}`}
                    />
                    <span className='es-overlay__status-label'>{run_panel.is_running ? 'LIVE' : 'STOPPED'}</span>
                </div>
            </div>

            <div className='es-overlay__run-row'>
                {run_panel.is_running ? (
                    <button
                        className='es-overlay__run-btn es-overlay__run-btn--stop'
                        onClick={() => run_panel.stopBot()}
                    >
                        ⏹ Stop Bot
                    </button>
                ) : (
                    <button
                        className='es-overlay__run-btn es-overlay__run-btn--run'
                        onClick={() => run_panel.onRunButtonClick()}
                    >
                        ▶ Run Bot
                    </button>
                )}
                {!run_panel.is_running && (
                    <button className='es-overlay__close-btn' onClick={() => setEsOverlayActive(false)}>
                        Close Overlay
                    </button>
                )}
            </div>

            <div className='es-overlay__tabs'>
                {(['summary', 'transactions', 'journal'] as const).map(t => (
                    <button
                        key={t}
                        className={`es-overlay__tab ${tab === t ? 'es-overlay__tab--active' : ''}`}
                        onClick={() => setTab(t)}
                    >
                        {t.charAt(0).toUpperCase() + t.slice(1)}
                    </button>
                ))}
            </div>

            <div className='es-overlay__content'>
                {tab === 'summary' && <Summary is_drawer_open={true} />}
                {tab === 'transactions' && <Transactions is_drawer_open={true} />}
                {tab === 'journal' && <Journal />}
            </div>
        </div>
    );
});

export default EsOverlay;
