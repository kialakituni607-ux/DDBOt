import React, { createContext, useCallback, useContext, useRef, useState } from 'react';
import DerivAPIBasic from '@deriv/deriv-api/dist/DerivAPIBasic';

const WS_URL = 'wss://ws.derivws.com/websockets/v3?app_id=116874';

export type ClientRecord = {
    token: string;
    loginid: string;
    currency: string;
    balance: string;
    status: 'connected' | 'error';
    errorMsg?: string;
    selected: boolean;
};

type CopyTradingCtx = {
    clients: ClientRecord[];
    running: boolean;
    statusMsg: string;
    addingClient: boolean;
    addError: string;
    addClient: (token: string) => Promise<void>;
    removeClient: (loginid: string) => void;
    toggleSelect: (loginid: string) => void;
    removeSelected: () => void;
    syncClients: () => Promise<void>;
    startCopyTrading: () => void;
    stopCopyTrading: () => void;
    clearAddError: () => void;
};

const CopyTradingContext = createContext<CopyTradingCtx | null>(null);

async function authorizeToken(token: string): Promise<{ loginid: string; currency: string; balance: string }> {
    const ws = new WebSocket(WS_URL);
    const api = new DerivAPIBasic({ connection: ws });
    try {
        const resp: any = await api.authorize(token);
        if (resp?.error) throw new Error(resp.error.message || 'Authorization failed');
        const auth = resp?.authorize;
        if (!auth?.loginid) throw new Error('Token accepted but no account details returned');
        let balance = '0.00';
        try {
            const balResp: any = await api.balance();
            balance = balResp?.balance?.balance?.toFixed(2) ?? '0.00';
        } catch { /* ignore */ }
        return { loginid: auth.loginid, currency: auth.currency || 'USD', balance };
    } finally {
        try { api.disconnect(); } catch { /* ignore */ }
    }
}

export const CopyTradingProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const [clients, setClients] = useState<ClientRecord[]>([]);
    const [running, setRunning] = useState(false);
    const [statusMsg, setStatusMsg] = useState('');
    const [addingClient, setAddingClient] = useState(false);
    const [addError, setAddError] = useState('');

    const masterWsRef = useRef<WebSocket | null>(null);
    const clientApisRef = useRef<{ loginid: string; api: any }[]>([]);
    const runningRef = useRef(false);

    const clearAddError = useCallback(() => setAddError(''), []);

    const addClient = useCallback(async (token: string) => {
        const trimmed = token.trim();
        if (!trimmed) return;
        setAddError('');
        setAddingClient(true);
        try {
            const { loginid, currency, balance } = await authorizeToken(trimmed);
            setClients(prev => {
                if (prev.some(c => c.loginid === loginid)) {
                    setAddError(`${loginid} is already in the list.`);
                    return prev;
                }
                return [...prev, { token: trimmed, loginid, currency, balance, status: 'connected', selected: false }];
            });
        } catch (e: any) {
            setAddError(e?.message || 'Failed to validate token');
        } finally {
            setAddingClient(false);
        }
    }, []);

    const removeClient = useCallback((loginid: string) => {
        setClients(prev => prev.filter(c => c.loginid !== loginid));
    }, []);

    const toggleSelect = useCallback((loginid: string) => {
        setClients(prev => prev.map(c => c.loginid === loginid ? { ...c, selected: !c.selected } : c));
    }, []);

    const removeSelected = useCallback(() => {
        setClients(prev => prev.filter(c => !c.selected));
    }, []);

    const syncClients = useCallback(async () => {
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
    }, [clients]);

    const stopCopyTrading = useCallback(() => {
        try { masterWsRef.current?.close(); } catch { /* ignore */ }
        clientApisRef.current.forEach(({ api }) => { try { api.disconnect(); } catch { /* ignore */ } });
        masterWsRef.current = null;
        clientApisRef.current = [];
        runningRef.current = false;
        setRunning(false);
        setStatusMsg('Copy trading stopped.');
    }, []);

    const startCopyTrading = useCallback(() => {
        const masterToken = localStorage.getItem('authToken') || '';
        if (!masterToken) {
            setStatusMsg('You must be signed in to start copy trading.');
            return;
        }
        if (clients.length === 0) {
            setStatusMsg('Add at least one client token before starting.');
            return;
        }

        runningRef.current = true;
        setRunning(true);
        setStatusMsg('Connecting to master account…');

        const masterWs = new WebSocket(WS_URL);
        masterWsRef.current = masterWs;

        const clientConns = clients.map(c => {
            const cWs = new WebSocket(WS_URL);
            const cApi = new DerivAPIBasic({ connection: cWs });
            return { loginid: c.loginid, token: c.token, api: cApi };
        });
        clientApisRef.current = clientConns;

        Promise.all(clientConns.map(c => c.api.authorize(c.token).catch(() => null)))
            .then(() => setStatusMsg('Clients connected. Listening for master trades…'));

        let authorizeDone = false;
        let lastContractId: number | null = null;

        masterWs.onopen = () => {
            masterWs.send(JSON.stringify({ authorize: masterToken }));
        };

        masterWs.onmessage = async evt => {
            if (!runningRef.current) return;
            try {
                const msg = JSON.parse(evt.data);

                if (msg.msg_type === 'authorize' && !authorizeDone) {
                    authorizeDone = true;
                    setStatusMsg(`Master connected (${msg.authorize?.loginid}). Listening for trades…`);
                    masterWs.send(JSON.stringify({ transaction: 1, subscribe: 1 }));
                    return;
                }

                if (msg.msg_type === 'transaction') {
                    const txn = msg.transaction;
                    if (txn?.action !== 'buy') return;
                    if (txn.contract_id === lastContractId) return;
                    lastContractId = txn.contract_id;

                    setStatusMsg(`Master bought contract ${txn.contract_id} — replicating on ${clientConns.length} client(s)…`);

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
                            if (propResp?.error) { console.warn(`[CT] Proposal error for ${loginid}:`, propResp.error.message); continue; }
                            const buyResp: any = await api.buy({ buy: propResp.proposal.id, price: buy_price || 1 });
                            if (buyResp?.error) {
                                console.warn(`[CT] Buy error for ${loginid}:`, buyResp.error.message);
                            } else {
                                setStatusMsg(`Trade replicated on ${loginid} (contract ${buyResp?.buy?.contract_id})`);
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
            setStatusMsg('Master connection error. Please try again.');
            runningRef.current = false;
            setRunning(false);
        };

        masterWs.onclose = () => {
            if (runningRef.current) setStatusMsg('Master connection closed unexpectedly.');
        };
    }, [clients]);

    return (
        <CopyTradingContext.Provider value={{
            clients, running, statusMsg, addingClient, addError,
            addClient, removeClient, toggleSelect, removeSelected,
            syncClients, startCopyTrading, stopCopyTrading, clearAddError,
        }}>
            {children}
        </CopyTradingContext.Provider>
    );
};

export const useCopyTrading = () => {
    const ctx = useContext(CopyTradingContext);
    if (!ctx) throw new Error('useCopyTrading must be used within CopyTradingProvider');
    return ctx;
};
