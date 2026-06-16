import React, { useEffect, useRef, useState } from 'react';
import Cookies from 'js-cookie';
import { crypto_currencies_display_order, fiat_currencies_display_order } from '@/components/shared';
import { getAppId } from '@/components/shared/utils/config/config';
import { generateDerivApiInstance } from '@/external/bot-skeleton/services/api/appId';
import { observer as globalObserver } from '@/external/bot-skeleton/utils/observer';
import { clearAuthData } from '@/utils/auth-utils';
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
const processTokensAndRedirect = async (
    tokens: Record<string, string>,
    rawState: unknown
): Promise<void> => {
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

const ManualPKCECallback: React.FC<{ code: string; codeVerifier: string }> = ({
    code,
    codeVerifier,
}) => {
    const [status, setStatus] = useState<PKCEStatus>('loading');
    const [errorMsg, setErrorMsg] = useState<string>('');
    const handledRef = useRef(false);

    useEffect(() => {
        if (handledRef.current) return;
        handledRef.current = true;

        (async () => {
            try {
                const redirectUri = `${window.location.origin}/callback`;
                const clientId = String(getAppId());

                // Step 3a: Server-side token exchange (per docs — never in browser)
                const response = await fetch('/api/auth/pkce-token', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        code,
                        code_verifier: codeVerifier,
                        redirect_uri: redirectUri,
                        client_id: clientId,
                    }),
                });

                const data = await response.json();

                if (!response.ok) {
                    throw new Error(data.error || `Token exchange failed (${response.status})`);
                }

                const access_token: string = data.access_token;
                if (!access_token) {
                    throw new Error('No access_token in token exchange response');
                }

                // Step 3b: Clear PKCE storage immediately after exchange (per docs)
                sessionStorage.removeItem('pkce_code_verifier');
                sessionStorage.removeItem('oauth_state');

                // Step 3c: Exchange access_token → Deriv legacy tokens
                const legacyTokens = (await requestLegacyToken(access_token)) as Record<
                    string,
                    string
                >;

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
                        sessionStorage.removeItem('pkce_code_verifier');
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
    const state = params.get('state');

    // Detect manual PKCE flow: we stored oauth_state + pkce_code_verifier ourselves
    const storedState = sessionStorage.getItem('oauth_state');
    const storedVerifier = sessionStorage.getItem('pkce_code_verifier');
    const isManualPKCE = !!(code && state && storedState && state === storedState && storedVerifier);

    if (isManualPKCE) {
        return <ManualPKCECallback code={code!} codeVerifier={storedVerifier!} />;
    }

    // OIDC library flow — handled by <Callback> from @deriv-com/auth-client
    return (
        <Callback
            onSignInSuccess={async (tokens: Record<string, string>, rawState: unknown) => {
                await processTokensAndRedirect(tokens, rawState);
            }}
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
