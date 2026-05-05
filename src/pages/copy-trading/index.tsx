import React, { useState } from 'react';
import { useCopyTrading } from '@/context/copy-trading-context';
import './copy-trading.scss';

function maskLoginid(id: string) {
    if (!id) return 'CR*****';
    return id.slice(0, 2) + '*'.repeat(Math.max(id.length - 2, 3));
}

const CopyTrading: React.FC = () => {
    const masterLoginid = localStorage.getItem('active_loginid') || '';

    const {
        clients, running, statusMsg, addingClient, addError,
        addClient, removeClient, toggleSelect, removeSelected,
        syncClients, startCopyTrading, stopCopyTrading, clearAddError,
    } = useCopyTrading();

    const [clientInput, setClientInput] = useState('');

    const handleAdd = async () => {
        const trimmed = clientInput.trim();
        if (!trimmed || addingClient || running) return;
        clearAddError();
        await addClient(trimmed);
        setClientInput('');
    };

    const hasSelected = clients.some(c => c.selected);

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
                    <span className='ct__master-id'>{maskLoginid(masterLoginid)}</span>
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
                    <a
                        className='ct__yt-small'
                        href='https://www.youtube.com/'
                        target='_blank'
                        rel='noreferrer'
                    >
                        ▶
                    </a>
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
                                {/* Checkbox */}
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

                                {/* Individual remove button */}
                                {!running && (
                                    <button
                                        className='ct__client-remove'
                                        onClick={() => removeClient(c.loginid)}
                                        title='Remove'
                                    >
                                        ✕
                                    </button>
                                )}
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
};

export default CopyTrading;
