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

            // The loginid Deriv authorized us as — this is the account the token belongs to
            const authorizedLoginid = auth.loginid;
            const authorizedBalance = auth.balance ?? 0;
            const authorizedCurrency = auth.currency || 'USD';

            // Try to get a more precise balance from the balance endpoint
            let realBalance = authorizedBalance;
            try {
                const balResp: any = await api.balance({ balance: 1, account: 'all' });
                if (balResp?.balance?.accounts?.[authorizedLoginid]?.balance !== undefined) {
                    realBalance = balResp.balance.accounts[authorizedLoginid].balance;
                } else if (balResp?.balance?.balance !== undefined) {
                    realBalance = balResp.balance.balance;
                }
            } catch { /* use auth.balance fallback */ }

            try { api.disconnect(); } catch { /* ignore */ }

            const accounts: any[] = auth.account_list || [];

            // accountsList: { [loginid]: token } — all accounts map to the pasted token
            // (Deriv API tokens are account-specific; the authorize response doesn't expose
            //  per-account tokens, so the same token is used for all linked accounts)
            const accountsList: Record<string, string> = {};
            const clientAccounts: Record<string, { loginid: string; token: string; currency: string; balance?: string }> = {};

            // Always include the authorized account first
            accountsList[authorizedLoginid] = trimmed;
            clientAccounts[authorizedLoginid] = {
                loginid: authorizedLoginid,
                token: trimmed,
                currency: authorizedCurrency,
                balance: String(realBalance),
            };

            // Include all other linked accounts from account_list
            accounts.forEach((acc: any) => {
                if (acc.loginid === authorizedLoginid) return; // already added
                accountsList[acc.loginid] = trimmed;
                clientAccounts[acc.loginid] = {
                    loginid: acc.loginid,
                    token: trimmed,
                    currency: acc.currency || 'USD',
                };
            });

            // active_loginid = the account Deriv actually authorized (matches the token)
            localStorage.setItem('authToken', trimmed);
            localStorage.setItem('active_loginid', authorizedLoginid);
            localStorage.setItem('accountsList', JSON.stringify(accountsList));
            localStorage.setItem('clientAccounts', JSON.stringify(clientAccounts));
            localStorage.setItem('client_account_details', JSON.stringify(accounts));
            localStorage.setItem('client.country', auth.country || '');

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
                    Create a token at{' '}
                    <a href='https://app.deriv.com/account/api-token' target='_blank' rel='noreferrer' className='atm__link'>
                        app.deriv.com → API Token
                    </a>{' '}
                    while logged into your <strong>real account</strong> with{' '}
                    <strong>Read</strong> and <strong>Trade</strong> permissions.
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
                    Your token is stored only in this browser and never sent to our servers.
                </p>
            </div>
        </div>
    );
};

export default ApiTokenModal;
