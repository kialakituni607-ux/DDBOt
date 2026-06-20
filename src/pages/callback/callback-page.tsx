import React, { useEffect, useRef, useState } from 'react';
import Cookies from 'js-cookie';
import { crypto_currencies_display_order, fiat_currencies_display_order } from '@/components/shared';
import { generateDerivApiInstance } from '@/external/bot-skeleton/services/api/appId';
import { observer as globalObserver } from '@/external/bot-skeleton/utils/observer';
import { clearAuthData } from '@/utils/auth-utils';
import { DERIV_OAUTH_CLIENT_ID, DERIV_REDIRECT_URI } from '@/utils/deriv-auth-adapter';
import { Callback, requestLegacyToken } from '@deriv-com/auth-client';
import { Button } from '@deriv-com/ui';

/**
 * Gets the selected currency or falls back to appropriate defaults
 */
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

/**
 * Shared token processing — called by both the manual PKCE handler
 * and the OIDC library Callback's onSignInSuccess.
 *
 * tokens: Record from Deriv legacy token response
 *   { acct1, token1, cur1, acct2, token2, cur2, … }
 * rawState: OIDC state object (may contain { account: currency })
 */
const processTokensAndRedirect = async (tokens: Record<string, string>, rawState: unknown): Promise<void> => {
    const state = rawState as { account?: string } | null;
    const accountsList: Record<string, string> = {};
    const clientAccounts: Record<string, { loginid: string; token: string; currency: string }> = {};

    for (const [key, value] of Object.entries(tokens)) {
        if (key.startsWith('acct')) {
            const tokenKey = key.replace('acct', 'token');
            if (tokens[tokenKey]) {
                accountsList[value] = tokens[tokenKey];
                clientAccounts[value] = {
                    loginid: value,
                    token: tokens[tokenKey],
                    currency: '',
                };
            }
        } else if (key.startsWith('cur')) {
            const accKey = key.replace('cur', 'acct');
            if (tokens[accKey] && clientAccounts[tokens[accKey]]) {
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
                const is_tmb_enabled = window.is_tmb_enabled === true;
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

/* -------------------------------------------------------------------------- */
/* Manual PKCE callback handler (Step 3 of Deriv PKCE docs)                   */
/* -------------------------------------------------------------------------- */

type PKCEStatus = 'idle' | 'loading' | 'error';

const ManualPKCECallback: React.FC<{ code: string; codeVerifier: string }> = ({ code, codeVerifier }) => {
    const [status, setStatus] = useState<PKCEStatus>('loading');
    const [errorMsg, setErrorMsg] = useState<string>('');
    const handledRef = useRef(false);

    useEffect(() => {
        if (handledRef.current) return;
        handledRef.current = true;

        (async () => {
            try {
                // Use the registered redirect_uri and new OAuth2 client_id — must match exactly
                const redirectUri = DERIV_REDIRECT_URI;
                const clientId = DERIV_OAUTH_CLIENT_ID;

                // Step 3a: Exchange code for access_token directly with Deriv's token endpoint.
                // PKCE needs no client_secret — the code_verifier is the proof.
                const params = new URLSearchParams();
                params.append('grant_type', 'authorization_code');
                params.append('client_id', clientId);
                params.append('code', code);
                params.append('code_verifier', codeVerifier);
                params.append('redirect_uri', redirectUri);

                // Route through backend to avoid CORS
                const response = await fetch('/api/auth/pkce-exchange', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ code, code_verifier: codeVerifier, redirect_uri: redirectUri }),
                });

                const data = await response.json();

                if (!response.ok) {
                    throw new Error(
                        data.error_description || data.error || `Token exchange failed (${response.status})`
                    );
                }

                const access_token: string = data.access_token;
                if (!access_token) {
                    throw new Error('No access_token in token exchange response');
                }

                // Clear PKCE storage immediately after exchange
                localStorage.removeItem('pkce_code_verifier');
                sessionStorage.removeItem('oauth_state');

                // Convert OIDC access token → Deriv legacy tokens via auth-client
                const legacyRes = await fetch('/api/auth/legacy-tokens', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ access_token }),
                });
                if (!legacyRes.ok) throw new Error('Failed to retrieve legacy tokens');
                const legacyTokens = (await legacyRes.json()) as Record<string, string>;

                // Step 3d: Process and redirect
                await processTokensAndRedirect(legacyTokens, null);
            } catch (err) {
                console.error('[PKCE callback] error:', err);
                setErrorMsg(err instanceof Error ? err.message : 'Authentication failed');
                setStatus('error');
            }
        })();
    }, [code, codeVerifier]);

    if (status === 'loading') {
        return (
            <div className='callback'>
                <div className='callback__content'>
                    <img
                        src='/bot/assets/images/deriv.svg'
                        width={234}
                        height={234}
                        alt='Deriv'
                        onError={e => {
                            (e.target as HTMLImageElement).style.display = 'none';
                        }}
                    />
                </div>
            </div>
        );
    }

    return (
        <div className='callback'>
            <div className='callback__content'>
                <h3 className='callback__title'>Authentication error</h3>
                <p style={{ color: '#f44336', marginBottom: '16px' }}>{errorMsg}</p>
                <Button
                    className='callback-return-button'
                    onClick={() => {
                        localStorage.removeItem('pkce_code_verifier');
                        sessionStorage.removeItem('oauth_state');
                        window.location.href = '/';
                    }}
                >
                    {'Return to Bot'}
                </Button>
            </div>
        </div>
    );
};

/* -------------------------------------------------------------------------- */
/* Callback page — routes to manual PKCE or OIDC library flow                 */
/* -------------------------------------------------------------------------- */

const CallbackPage = () => {
    const params = new URLSearchParams(window.location.search);
    const code = params.get('code');
    const acct1 = params.get('acct1');
    const token1 = params.get('token1');
    if (acct1 && token1) {
        const legacyTokens: Record<string, string> = {};
        for (const [key, value] of params.entries()) legacyTokens[key] = value;
        processTokensAndRedirect(legacyTokens, null).then(() => {
            window.location.href = '/';
        });
        return <div style={{display:'flex',justifyContent:'center',alignItems:'center',height:'100vh'}}>Logging in...</div>;
    }

    const storedVerifier = localStorage.getItem('pkce_code_verifier');
    const isManualPKCE = !!(code && storedVerifier);
    if (isManualPKCE) {
        return <ManualPKCECallback code={code!} codeVerifier={storedVerifier!} />;
    }

    // OIDC library flow — handled by <Callback> from @deriv-com/auth-client
    return (
        <Callback
            redirectCallbackUri="https://trademasters.site/callback"
            onSignInSuccess={async (tokens: Record<string, string>, rawState: unknown) => {
                console.log('[Callback] onSignInSuccess tokens:', JSON.stringify(tokens).substring(0, 200));
                await processTokensAndRedirect(tokens, rawState);
            }}
            onSignInError={(err) => { console.error('[Callback] onSignInError:', err); }}
            renderReturnButton={() => {
                return (
                    <Button
                        className='callback-return-button'
                        onClick={() => {
                            window.location.href = '/';
                        }}
                    >
                        {'Return to Bot'}
                    </Button>
                );
            }}
        />
    );
};

export default CallbackPage;
