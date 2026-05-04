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
            try { api.disconnect(); } catch { /* ignore */ }

            if (resp?.error) {
                setError(resp.error.message || 'Authorization failed. Check your token has Read & Trade permissions.');
                setLoading(false);
                return;
            }

            const auth = resp?.authorize;
            if (!auth?.loginid) {
                setError(
                    "Deriv accepted the token but didn't return account details. " +
                    'Make sure the token has Read and Trade permissions enabled.'
                );
                setLoading(false);
                return;
            }

            const accounts: any[] = auth.account_list || [];

            // Prefer real (non-virtual) account as the active one
            const real = accounts.find((a: any) => !a.is_virtual) || accounts[0];
            const activeLoginid = real?.loginid || auth.loginid;

            // accountsList: { [loginid]: token }  — read by V2GetActiveClientId
            const accountsList: Record<string, string> = {};
            // clientAccounts: { [loginid]: { loginid, token, currency } } — read by hydrateFromLocalStorage
            const clientAccounts: Record<string, { loginid: string; token: string; currency: string }> = {};

            accounts.forEach((acc: any) => {
                accountsList[acc.loginid] = trimmed;
                clientAccounts[acc.loginid] = {
                    loginid: acc.loginid,
                    token: trimmed,
                    currency: acc.currency || 'USD',
                };
            });

            // Fallback: if account_list was empty, store just the authorized account
            if (accounts.length === 0) {
                accountsList[auth.loginid] = trimmed;
                clientAccounts[auth.loginid] = {
                    loginid: auth.loginid,
                    token: trimmed,
                    currency: auth.currency || 'USD',
                };
            }

            localStorage.setItem('authToken', trimmed);
            localStorage.setItem('active_loginid', activeLoginid);
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
                    Your token is kept only for this browser tab and never stored on our servers.
                    Sign out (or close the tab) to clear it.
                </p>
            </div>
        </div>
    );
};

export default ApiTokenModal;
