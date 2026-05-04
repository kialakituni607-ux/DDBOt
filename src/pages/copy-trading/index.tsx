import React, { useRef, useState } from 'react';
import DerivAPIBasic from '@deriv/deriv-api/dist/DerivAPIBasic';
import './copy-trading.scss';

const WS_URL = 'wss://ws.derivws.com/websockets/v3?app_id=116874';

type ClientRecord = {
    token: string;
    loginid: string;
    currency: string;
    balance: string;
    status: 'connected' | 'error';
    errorMsg?: string;
};

function maskLoginid(id: string) {
    if (!id) return 'CR*****';
    return id.slice(0, 2) + '*'.repeat(Math.max(id.length - 2, 3));
}

async function authorizeToken(token: string): Promise<{ loginid: string; currency: string; balance: string }> {
    const ws = new WebSocket(WS_URL);
    const api = new DerivAPIBasic({ connection: ws });
    try {
        const resp: any = await api.authorize(token);
        if (resp?.error) throw new Error(resp.error.message || 'Authorization failed');
        const auth = resp?.authorize;
        if (!auth?.loginid) throw new Error("Token accepted but no account details returned");

        // Fetch balance
        let balance = '0.00';
        try {
            const balResp: any = await api.balance();
            balance = balResp?.balance?.balance?.toFixed(2) ?? '0.00';
        } catch { /* ignore balance failure */ }

        return { loginid: auth.loginid, currency: auth.currency || 'USD', balance };
    } finally {
        try { api.disconnect(); } catch { /* ignore */ }
    }
}

const CopyTrading: React.FC = () => {
    const masterLoginid = localStorage.getItem('active_loginid') || '';
    const masterToken   = localStorage.getItem('authToken') || '';

    const [clientInput, setClientInput] = useState('');
    const [clients, setClients] = useState<ClientRecord[]>([]);
    const [addingClient, setAddingClient] = useState(false);
    const [addError, setAddError] = useState('');
    const [running, setRunning] = useState(false);
    const [statusMsg, setStatusMsg] = useState('');

    // Refs for live WS connections kept open during copy session
    const masterWsRef = useRef<WebSocket | null>(null);
    const clientApisRef = useRef<{ loginid: string; api: any }[]>([]);

    const handleAddClient = async () => {
        const trimmed = clientInput.trim();
        if (!trimmed) return;
        setAddError('');
        setAddingClient(true);
        try {
            const { loginid, currency, balance } = await authorizeToken(trimmed);
            if (clients.some(c => c.loginid === loginid)) {
                setAddError(`${loginid} is already in the list.`);
                setAddingClient(false);
                return;
            }
            setClients(prev => [...prev, { token: trimmed, loginid, currency, balance, status: 'connected' }]);
            setClientInput('');
        } catch (e: any) {
            setAddError(e?.message || 'Failed to validate token');
        } finally {
            setAddingClient(false);
        }
    };

    const handleSync = async () => {
        if (clients.length === 0) return;
        const updated = await Promise.all(
            clients.map(async c => {
                try {
                    const { balance } = await authorizeToken(c.token);
                    return { ...c, balance, status: 'connected' as const };
                } catch (e: any) {
                    return { ...c, status: 'error' as const, errorMsg: e?.message };
                }
            })
        );
        setClients(updated);
    };

    const stopCopyTrading = () => {
        try { masterWsRef.current?.close(); } catch { /* ignore */ }
        clientApisRef.current.forEach(({ api }) => { try { api.disconnect(); } catch { /* ignore */ } });
        masterWsRef.current = null;
        clientApisRef.current = [];
        setRunning(false);
        setStatusMsg('Copy trading stopped.');
    };

    const startCopyTrading = () => {
        if (!masterToken) {
            setStatusMsg('⚠ You must be logged in to start copy trading.');
            return;
        }
        if (clients.length === 0) {
            setStatusMsg('⚠ Add at least one client token before starting.');
            return;
        }

        setRunning(true);
        setStatusMsg('Connecting to master account…');

        // Connect master WS and subscribe to transactions
        const masterWs = new WebSocket(WS_URL);
        masterWsRef.current = masterWs;

        // Establish client API connections
        const clientConns = clients.map(c => {
            const cWs = new WebSocket(WS_URL);
            const cApi = new DerivAPIBasic({ connection: cWs });
            return { loginid: c.loginid, token: c.token, api: cApi };
        });
        clientApisRef.current = clientConns;

        // Authorize clients first
        Promise.all(clientConns.map(c => c.api.authorize(c.token).catch(() => null)))
            .then(() => setStatusMsg('Clients connected. Listening for master trades…'));

        let authorizeDone = false;
        let lastContractId: number | null = null;

        masterWs.onopen = () => {
            masterWs.send(JSON.stringify({ authorize: masterToken }));
        };

        masterWs.onmessage = async (evt) => {
            try {
                const msg = JSON.parse(evt.data);

                if (msg.msg_type === 'authorize' && !authorizeDone) {
                    authorizeDone = true;
                    setStatusMsg(`Master connected (${msg.authorize?.loginid}). Listening for trades…`);
                    // Subscribe to all buy/sell transactions
                    masterWs.send(JSON.stringify({ transaction: 1, subscribe: 1 }));
                    return;
                }

                if (msg.msg_type === 'transaction') {
                    const txn = msg.transaction;
                    // Only react to buys, skip duplicate contract IDs
                    if (txn?.action !== 'buy') return;
                    if (txn.contract_id === lastContractId) return;
                    lastContractId = txn.contract_id;

                    setStatusMsg(`📈 Master bought contract ${txn.contract_id} — replicating on ${clients.length} client(s)…`);

                    // Fetch the open contract to get full trade parameters
                    masterWs.send(JSON.stringify({
                        proposal_open_contract: 1,
                        contract_id: txn.contract_id,
                    }));
                    return;
                }

                if (msg.msg_type === 'proposal_open_contract') {
                    const poc = msg.proposal_open_contract;
                    if (!poc) return;

                    const { contract_type, underlying, duration, duration_unit, buy_price } = poc;

                    // Replicate on each client
                    for (const { loginid, api } of clientApisRef.current) {
                        try {
                            const propResp: any = await api.proposal({
                                proposal: 1,
                                amount: buy_price || 1,
                                basis: 'stake',
                                contract_type,
                                currency: 'USD',
                                duration: duration || 1,
                                duration_unit: duration_unit || 't',
                                symbol: underlying,
                            });

                            if (propResp?.error) {
                                console.warn(`[CT] Proposal error for ${loginid}:`, propResp.error.message);
                                continue;
                            }

                            const buyResp: any = await api.buy({
                                buy: propResp.proposal.id,
                                price: buy_price || 1,
                            });

                            if (buyResp?.error) {
                                console.warn(`[CT] Buy error for ${loginid}:`, buyResp.error.message);
                            } else {
                                setStatusMsg(`✅ Trade replicated on ${loginid} (contract ${buyResp?.buy?.contract_id})`);
                            }
                        } catch (e: any) {
                            console.warn(`[CT] Replication failed for ${loginid}:`, e?.message);
                        }
                    }
                }
            } catch (e) {
                console.warn('[CT] Message parse error:', e);
            }
        };

        masterWs.onerror = () => {
            setStatusMsg('⚠ Master connection error. Please try again.');
            setRunning(false);
        };

        masterWs.onclose = () => {
            if (running) setStatusMsg('Master connection closed.');
        };
    };

    return (
        <div className='ct'>
            {/* ── Top controls row ─────────────────────────── */}
            <div className='ct__top-card'>
                <button className='ct__start-btn' onClick={running ? stopCopyTrading : startCopyTrading}>
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
                        onChange={e => setClientInput(e.target.value)}
                        onKeyDown={e => e.key === 'Enter' && !addingClient && handleAddClient()}
                        disabled={running}
                    />
                    <button
                        className='ct__btn ct__btn--add'
                        onClick={handleAddClient}
                        disabled={addingClient || !clientInput.trim() || running}
                    >
                        {addingClient ? '…' : 'Add'}
                    </button>
                    <button
                        className='ct__btn ct__btn--sync'
                        onClick={handleSync}
                        disabled={clients.length === 0 || running}
                    >
                        Sync ↻
                    </button>
                </div>

                {addError && <div className='ct__add-error'>{addError}</div>}

                <div className='ct__add-footer'>
                    <button
                        className='ct__start-copy-btn'
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
                <div className='ct__clients-count'>
                    Total Clients added: <strong>{clients.length}</strong>
                </div>

                {clients.length === 0 ? (
                    <div className='ct__clients-empty'>No tokens added yet</div>
                ) : (
                    <div className='ct__clients-list'>
                        {clients.map(c => (
                            <div key={c.loginid} className={`ct__client ct__client--${c.status}`}>
                                <span className='ct__client-id'>{maskLoginid(c.loginid)}</span>
                                <span className='ct__client-currency'>{c.currency}</span>
                                <span className='ct__client-balance'>{c.balance}</span>
                                <span className={`ct__client-dot ct__client-dot--${c.status}`} />
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
};

export default CopyTrading;
