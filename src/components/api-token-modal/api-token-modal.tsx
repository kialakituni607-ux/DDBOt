import React, { useState } from 'react';
import DerivAPIBasic from '@deriv/deriv-api/dist/DerivAPIBasic';
import './api-token-modal.scss';

const WS_URL = 'wss://ws.derivws.com/websockets/v3?app_id=116874';

type Props = { onClose: () => void };

const ApiTokenModal = ({ onClose }: Props) => {
    const [token, setToken] = useState('');
    const [show, setShow] = useState(false);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');

    const handleSignIn = async () => {
        const trimmed = token.trim();
        if (!trimmed) return;
        setLoading(true);
        setError('');

        try {
            const ws = new WebSocket(WS_URL);
            const api = new DerivAPIBasic({ connection: ws });

            const resp: any = await api.authorize(trimmed);

            if (resp?.error) {
                setError(resp.error.message || 'Authorization failed. Check your token has Read & Trade permissions.');
                setLoading(false);
                try { api.disconnect(); } catch { /* ignore */ }
                return;
            }

            const auth = resp?.authorize;
            if (!auth?.loginid) {
                setError(
                    "Deriv accepted the token but didn't return account details. " +
                    'Make sure the token has Read and Trade permissions enabled.'
                );
                setLoading(false);
                try { api.disconnect(); } catch { /* ignore */ }
                return;
            }

            // Fetch real balance for the authorized account
            let realBalance = auth.balance ?? 0;
            let realCurrency = auth.currency || 'USD';
            try {
                const balResp: any = await api.balance({ balance: 1, account: 'current' });
                if (balResp?.balance?.balance !== undefined) {
                    realBalance = balResp.balance.balance;
                    realCurrency = balResp.balance.currency || realCurrency;
                }
            } catch { /* ignore, use auth.balance */ }

            try { api.disconnect(); } catch { /* ignore */ }

            const accounts: any[] = auth.account_list || [];

            // Prefer real (non-virtual) account as the active one
            const real = accounts.find((a: any) => !a.is_virtual) || accounts[0];
            const activeLoginid = real?.loginid || auth.loginid;

            // accountsList: { [loginid]: token } — each account uses its OWN token from account_list
            const accountsList: Record<string, string> = {};
            // clientAccounts: full details per loginid
            const clientAccounts: Record<string, { loginid: string; token: string; currency: string; balance?: string }> = {};

            accounts.forEach((acc: any) => {
                // Deriv returns each account's real token in acc.token
                const accToken = acc.token || trimmed;
                accountsList[acc.loginid] = accToken;
                clientAccounts[acc.loginid] = {
                    loginid: acc.loginid,
                    token: accToken,
                    currency: acc.currency || 'USD',
                    // balance only known for the active account
                    balance: acc.loginid === (real?.loginid || auth.loginid)
                        ? String(realBalance)
                        : undefined,
                };
            });

            // Fallback: if account_list was empty
            if (accounts.length === 0) {
                accountsList[auth.loginid] = trimmed;
                clientAccounts[auth.loginid] = {
                    loginid: auth.loginid,
                    token: trimmed,
                    currency: realCurrency,
                    balance: String(realBalance),
                };
            }

            // Store in the format the Deriv Bot store reads on startup
            localStorage.setItem('authToken', real?.token || trimmed);
            localStorage.setItem('active_loginid', activeLoginid);
            localStorage.setItem('accountsList', JSON.stringify(accountsList));
            localStorage.setItem('clientAccounts', JSON.stringify(clientAccounts));
            localStorage.setItem('client_account_details', JSON.stringify(accounts));
            localStorage.setItem('client.country', auth.country || '');

            // Store balance info so the header shows the real balance immediately
            localStorage.setItem(
                `balance_${activeLoginid}`,
                JSON.stringify({ balance: realBalance, currency: realCurrency })
            );

            window.location.reload();
        } catch (e: any) {
            setError(e?.message || 'Connection failed. Please try again.');
            setLoading(false);
        }
    };

    return (
        <div className='atm-overlay' onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
            <div className='atm'>
                <button className='atm__close' onClick={onClose}>✕</button>

                <h2 className='atm__title'>Sign in with API token</h2>

                <p className='atm__desc'>
                    Don't have a token?{' '}
                    <a href='https://app.deriv.com/account/api-token' target='_blank' rel='noreferrer' className='atm__link'>
                        Create one on Deriv
                    </a>{' '}
                    with at least <strong>Read</strong> and <strong>Trade</strong> permissions (add{' '}
                    <strong>Trading information</strong> for statements/history).
                </p>

                <label className='atm__label'>API TOKEN</label>
                <div className='atm__row'>
                    <input
                        className='atm__input'
                        type={show ? 'text' : 'password'}
                        placeholder='Paste your token here'
                        value={token}
                        onChange={e => setToken(e.target.value)}
                        onKeyDown={e => e.key === 'Enter' && !loading && handleSignIn()}
                        autoFocus
                    />
                    <button className='atm__show' onClick={() => setShow(s => !s)}>
                        {show ? 'Hide' : 'Show'}
                    </button>
                </div>

                {error && <div className='atm__error'>{error}</div>}

                <div className='atm__actions'>
                    <button className='atm__cancel' onClick={onClose}>Cancel</button>
                    <button
                        className='atm__submit'
                        onClick={handleSignIn}
                        disabled={loading || !token.trim()}
                    >
                        {loading ? <span className='atm__spinner' /> : 'Sign in'}
                    </button>
                </div>

                <p className='atm__footer'>
                    Your token is kept only in this browser and never stored on our servers.
                    Sign out (or clear browser data) to remove it.
                </p>
            </div>
        </div>
    );
};

export default ApiTokenModal;
