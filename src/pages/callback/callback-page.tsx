import { useEffect, useState } from 'react';
import Cookies from 'js-cookie';
import { crypto_currencies_display_order, fiat_currencies_display_order } from '@/components/shared';
import { generateDerivApiInstance } from '@/external/bot-skeleton/services/api/appId';
import { observer as globalObserver } from '@/external/bot-skeleton/utils/observer';
import useTMB from '@/hooks/useTMB';
import { clearAuthData } from '@/utils/auth-utils';

const TRADEMASTERS_CLIENT_ID = '33s71w7Czu1uFS8H4HmjTK';
const REDIRECT_URI = 'https://trademasters.site';

const getSelectedCurrency = (
    tokens: Record<string, string>,
    clientAccounts: Record<string, any>,
    state: any
): string => {
    const getQueryParams = new URLSearchParams(window.location.search);
    const currency =
        (state && state?.account) ||
        getQueryParams.get('account') ||
        sessionStorage.getItem('query_param_currency') ||
        '';
    const firstAccountKey = tokens.acct1;
    const firstAccountCurrency = clientAccounts[firstAccountKey]?.currency;
    const validCurrencies = [...fiat_currencies_display_order, ...crypto_currencies_display_order];
    if (tokens.acct1?.startsWith('VR') || currency === 'demo') return 'demo';
    if (currency && validCurrencies.includes(currency.toUpperCase())) return currency;
    return firstAccountCurrency || 'USD';
};

const processTokens = async (tokens: Record<string, string>, state: any) => {
    const accountsList: Record<string, string> = {};
    const clientAccounts: Record<string, { loginid: string; token: string; currency: string }> = {};

    for (const [key, value] of Object.entries(tokens)) {
        if (key.startsWith('acct')) {
            const tokenKey = key.replace('acct', 'token');
            if (tokens[tokenKey]) {
                accountsList[value] = tokens[tokenKey];
                clientAccounts[value] = { loginid: value, token: tokens[tokenKey], currency: '' };
            }
        } else if (key.startsWith('cur')) {
            const accKey = key.replace('cur', 'acct');
            if (tokens[accKey]) {
                clientAccounts[tokens[accKey]].currency = value;
            }
        }
    }

    localStorage.setItem('accountsList', JSON.stringify(accountsList));
    localStorage.setItem('clientAccounts', JSON.stringify(clientAccounts));

    let is_token_set = false;
    const api = await generateDerivApiInstance();
    if (api) {
        const { authorize, error } = await api.authorize(tokens.token1);
        api.disconnect();
        if (error) {
            if (error.code === 'InvalidToken') {
                is_token_set = true;
                const { is_tmb_enabled = false } = useTMB();
                if (Cookies.get('logged_state') === 'true' && !is_tmb_enabled) {
                    globalObserver.emit('InvalidToken', { error });
                }
                if (Cookies.get('logged_state') === 'false') {
                    clearAuthData();
                }
            }
        } else {
            localStorage.setItem('callback_token', authorize.toString());
            const clientAccountsArray = Object.values(clientAccounts);
            const firstId = authorize?.account_list[0]?.loginid;
            const filteredTokens = clientAccountsArray.filter(account => account.loginid === firstId);
            if (filteredTokens.length) {
                localStorage.setItem('authToken', filteredTokens[0].token);
                localStorage.setItem('active_loginid', filteredTokens[0].loginid);
                is_token_set = true;
            }
        }
    }

    if (!is_token_set) {
        localStorage.setItem('authToken', tokens.token1);
        localStorage.setItem('active_loginid', tokens.acct1);
    }

    const selected_currency = getSelectedCurrency(tokens, clientAccounts, state);
    window.location.replace(`${window.location.origin}/bot/?account=${selected_currency}`);
};

const exchangePKCECode = async (code: string): Promise<Record<string, string> | null> => {
    const verifier = sessionStorage.getItem('deriv_code_verifier');
    if (!verifier) return null;

    const host = window.location.hostname;
    let oauth_host = 'oauth.deriv.com';
    if (host.includes('.deriv.me')) oauth_host = 'oauth.deriv.me';
    else if (host.includes('.deriv.be')) oauth_host = 'oauth.deriv.be';

    try {
        const res = await fetch(`https://${oauth_host}/oauth2/token`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
                grant_type: 'authorization_code',
                code,
                code_verifier: verifier,
                client_id: TRADEMASTERS_CLIENT_ID,
                redirect_uri: REDIRECT_URI,
            }).toString(),
        });
        if (!res.ok) return null;
        return await res.json();
    } catch {
        return null;
    }
};

const CallbackPage = () => {
    const [status, setStatus] = useState<'loading' | 'error'>('loading');
    const [errorMsg, setErrorMsg] = useState('');

    useEffect(() => {
        const params = new URLSearchParams(window.location.search);
        const error = params.get('error');
        const code = params.get('code');
        const token1 = params.get('token1');

        if (error) {
            setStatus('error');
            setErrorMsg(params.get('error_description') || error);
            return;
        }

        // ── Legacy flow ──────────────────────────────────────────────────────
        // Deriv appends tokens directly to the redirect_uri query string:
        //   ?token1=xxx&acct1=VRTxxx&cur1=USD&token2=xxx&acct2=CRxxx…
        if (token1) {
            const tokens: Record<string, string> = {};
            params.forEach((v, k) => { tokens[k] = v; });
            processTokens(tokens, null).catch(() => {
                setStatus('error');
                setErrorMsg('Failed to complete login. Please try again.');
            });
            return;
        }

        // ── New API (PKCE) flow ───────────────────────────────────────────────
        // Deriv returns an authorization code that must be exchanged for tokens.
        if (code) {
            exchangePKCECode(code).then(data => {
                if (!data) {
                    setStatus('error');
                    setErrorMsg('Token exchange failed. Please try again.');
                    return;
                }
                // Map the PKCE token response into the standard token format.
                const tokens: Record<string, string> = {};
                if (data.acct1 || data.token1) {
                    Object.assign(tokens, data);
                } else if (data.access_token) {
                    tokens.token1 = data.access_token;
                    tokens.acct1 = data.loginid || '';
                }
                processTokens(tokens, null).catch(() => {
                    setStatus('error');
                    setErrorMsg('Failed to complete login. Please try again.');
                });
            });
            return;
        }

        // No recognised params — go home.
        window.location.replace('/');
    }, []);

    if (status === 'error') {
        return (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100vh', gap: '16px', fontFamily: 'sans-serif' }}>
                <h2 style={{ color: '#e53e3e' }}>Login failed</h2>
                <p style={{ color: '#666', maxWidth: '400px', textAlign: 'center' }}>{errorMsg}</p>
                <button
                    style={{ padding: '10px 24px', background: '#ff444f', color: '#fff', border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '14px' }}
                    onClick={() => window.location.replace('/')}
                >
                    Return to TradeMasters
                </button>
            </div>
        );
    }

    return (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100vh', gap: '16px', fontFamily: 'sans-serif' }}>
            <div style={{
                width: '40px', height: '40px',
                border: '4px solid #e2e8f0',
                borderTop: '4px solid #ff444f',
                borderRadius: '50%',
                animation: 'spin 1s linear infinite',
            }} />
            <p style={{ color: '#666' }}>Completing login…</p>
            <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
        </div>
    );
};

export default CallbackPage;
