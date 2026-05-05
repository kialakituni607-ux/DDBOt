import React, { useEffect, useRef, useState } from 'react';
import { useCopyTrading } from '@/context/copy-trading-context';
import './copy-trading.scss';

function maskLoginid(id: string) {
    if (!id) return 'CR*****';
    return id.slice(0, 2) + '*'.repeat(Math.max(id.length - 2, 3));
}

function fmtTime(d: Date) {
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

const CopyTrading: React.FC = () => {
    const masterLoginid = localStorage.getItem('active_loginid') || '';

    const {
        clients, running, statusMsg, addingClient, addError, tradeLog,
        clearLog, addClient, removeClient, toggleSelect, removeSelected,
        syncClients, startCopyTrading, stopCopyTrading, clearAddError,
    } = useCopyTrading();

    const [clientInput, setClientInput] = useState('');
    const logEndRef = useRef<HTMLDivElement>(null);

    const handleAdd = async () => {
        const trimmed = clientInput.trim();
        if (!trimmed || addingClient || running) return;
        clearAddError();
        await addClient(trimmed);
        setClientInput('');
    };

    const hasSelected = clients.some(c => c.selected);

    // Auto-scroll log to top (newest entry) when new entries arrive
    useEffect(() => {
        logEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [tradeLog.length]);

    return (
        <div className='ct'>
            {/* ── Top controls row ─────────────────────────── */}
            <div className='ct__top-card'>
                <button
                    className={`ct__start-btn${running ? ' ct__start-btn--stop' : ''}`}
                    onClick={running ? stopCopyTrading : startCopyTrading}
                >
                    {running ? '⏹ Stop Copy Trading' : '▶ Start Demo to Real Copy Trading'}
                </button>
                <a
                    className='ct__tutorial-btn'
                    href='https://www.youtube.com/'
                    target='_blank'
                    rel='noreferrer'
                    title='Tutorial'
                >
                    <span className='ct__yt-icon'>▶</span>
                    <span className='ct__tutorial-label'>Tutorial</span>
                </a>
            </div>

            {/* ── Master account bar ───────────────────────── */}
            {masterLoginid && (
                <div className='ct__master-bar'>
                    <div className='ct__master-left'>
                        {running && <span className='ct__live-pulse' />}
                        <span className='ct__master-id'>{maskLoginid(masterLoginid)}</span>
                        {running && <span className='ct__live-badge'>LIVE</span>}
                    </div>
                    <span className='ct__master-stars'>★★★★★</span>
                </div>
            )}

            {/* ── Status message ───────────────────────────── */}
            {statusMsg && (
                <div className={`ct__status ${running ? 'ct__status--live' : ''}`}>
                    {statusMsg}
                </div>
            )}

            {/* ── Add tokens section ───────────────────────── */}
            <div className='ct__section-label'>Add tokens to Replicator</div>

            <div className='ct__add-card'>
                <div className='ct__input-row'>
                    <input
                        className='ct__input'
                        type='text'
                        placeholder='Enter Client token'
                        value={clientInput}
                        onChange={e => { setClientInput(e.target.value); clearAddError(); }}
                        onKeyDown={e => e.key === 'Enter' && handleAdd()}
                        disabled={running}
                    />
                    <button
                        className='ct__btn ct__btn--add'
                        onClick={handleAdd}
                        disabled={addingClient || !clientInput.trim() || running}
                    >
                        {addingClient ? '…' : 'Add'}
                    </button>
                    <button
                        className='ct__btn ct__btn--sync'
                        onClick={syncClients}
                        disabled={clients.length === 0 || running}
                    >
                        Sync ↻
                    </button>
                </div>

                {addError && <div className='ct__add-error'>{addError}</div>}

                <div className='ct__add-footer'>
                    <button
                        className={`ct__start-copy-btn${running ? ' ct__start-copy-btn--stop' : ''}`}
                        onClick={running ? stopCopyTrading : startCopyTrading}
                        disabled={clients.length === 0 && !running}
                    >
                        {running ? '⏹ Stop Copy Trading' : '▶ Start Copy Trading'}
                    </button>
                    <a className='ct__yt-small' href='https://www.youtube.com/' target='_blank' rel='noreferrer'>▶</a>
                </div>
            </div>

            {/* ── Client list ──────────────────────────────── */}
            <div className='ct__clients-card'>
                <div className='ct__clients-header'>
                    <span className='ct__clients-count'>
                        Total Clients added: <strong>{clients.length}</strong>
                    </span>
                    {hasSelected && !running && (
                        <button className='ct__remove-selected-btn' onClick={removeSelected}>
                            ✕ Remove selected
                        </button>
                    )}
                </div>

                {clients.length === 0 ? (
                    <div className='ct__clients-empty'>No tokens added yet</div>
                ) : (
                    <div className='ct__clients-list'>
                        {clients.map(c => (
                            <div
                                key={c.loginid}
                                className={`ct__client ct__client--${c.status}${c.selected ? ' ct__client--selected' : ''}`}
                            >
                                {!running && (
                                    <input
                                        type='checkbox'
                                        className='ct__client-checkbox'
                                        checked={c.selected}
                                        onChange={() => toggleSelect(c.loginid)}
                                    />
                                )}
                                <span className='ct__client-id'>{maskLoginid(c.loginid)}</span>
                                <span className='ct__client-currency'>{c.currency}</span>
                                <span className='ct__client-balance'>{c.balance}</span>
                                <span className={`ct__client-dot ct__client-dot--${c.status}`} title={c.status} />
                                {!running && (
                                    <button className='ct__client-remove' onClick={() => removeClient(c.loginid)} title='Remove'>
                                        ✕
                                    </button>
                                )}
                            </div>
                        ))}
                    </div>
                )}
            </div>

            {/* ── Live Trade Log ──────────────────────────── */}
            <div className='ct__log-card'>
                <div className='ct__log-header'>
                    <span className='ct__log-title'>
                        Live Trade Log
                        {tradeLog.length > 0 && (
                            <span className='ct__log-count'>{tradeLog.length}</span>
                        )}
                    </span>
                    {tradeLog.length > 0 && (
                        <button className='ct__log-clear' onClick={clearLog}>Clear</button>
                    )}
                </div>

                <div className='ct__log-body'>
                    {tradeLog.length === 0 ? (
                        <div className='ct__log-empty'>
                            {running
                                ? 'Waiting for master to place a trade…'
                                : 'No trades recorded yet. Start copy trading to see live activity here.'}
                        </div>
                    ) : (
                        <>
                            {tradeLog.map(entry => (
                                <div key={entry.id} className={`ct__log-entry ct__log-entry--${entry.type}`}>
                                    <span className='ct__log-time'>{fmtTime(entry.timestamp)}</span>
                                    <span className={`ct__log-badge ct__log-badge--${entry.type}`}>
                                        {entry.type === 'success' && '✓ Copied'}
                                        {entry.type === 'error'   && '✗ Failed'}
                                        {entry.type === 'master'  && '⬆ Master'}
                                        {entry.type === 'info'    && 'ℹ Info'}
                                    </span>
                                    <span className='ct__log-body-text'>
                                        {entry.clientLoginid && (
                                            <span className='ct__log-client'>{maskLoginid(entry.clientLoginid)}</span>
                                        )}
                                        {entry.contractType && entry.symbol && (
                                            <span className='ct__log-trade'>
                                                {entry.contractType} · {entry.symbol}
                                                {entry.stake !== undefined && ` · ${entry.stake} ${entry.currency || 'USD'}`}
                                            </span>
                                        )}
                                        {entry.contractId && (
                                            <span className='ct__log-contract'>#{entry.contractId}</span>
                                        )}
                                        <span className='ct__log-msg'>{entry.message}</span>
                                    </span>
                                </div>
                            ))}
                            <div ref={logEndRef} />
                        </>
                    )}
                </div>
            </div>
        </div>
    );
};

export default CopyTrading;
