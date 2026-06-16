import React from 'react';
import Cookies from 'js-cookie';
import { crypto_currencies_display_order, fiat_currencies_display_order } from '@/components/shared';
import { generateDerivApiInstance } from '@/external/bot-skeleton/services/api/appId';
import { observer as globalObserver } from '@/external/bot-skeleton/utils/observer';
import { clearAuthData } from '@/utils/auth-utils';
import { Callback } from '@deriv-com/auth-client';
import { Button } from '@deriv-com/ui';

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

const getCurrencyFromStorage = (): string => {
    try {
        const activeLoginid = localStorage.getItem('active_loginid');
        const clientAccounts = JSON.parse(localStorage.getItem('clientAccounts') || '{}');
        if (activeLoginid && clientAccounts[activeLoginid]?.currency) {
            const currency = clientAccounts[activeLoginid].currency;
            const validCurrencies = [...fiat_currencies_display_order, ...crypto_currencies_display_order];
            if (activeLoginid.startsWith('VR')) return 'demo';
            if (validCurrencies.includes(currency.toUpperCase())) return currency;
        }
    } catch {
        // ignore parse errors
    }
    return 'USD';
};

const CallbackPage = () => {
    const hasOidcCode = React.useMemo(
        () => new URLSearchParams(window.location.search).has('code'),
        []
    );

    React.useEffect(() => {
        if (!hasOidcCode) {
            // Legacy OAuth flow: AuthWrapper.tsx has already saved tokens to localStorage
            // synchronously via persistTokensSync before this component ever rendered.
            // We just need to set logged_state=true and redirect to the main app.
            const authToken = localStorage.getItem('authToken');
            const activeLoginid = localStorage.getItem('active_loginid');

            if (authToken && activeLoginid) {
                Cookies.set('logged_state', 'true', { expires: 30, path: '/' });
                const currency = getCurrencyFromStorage();
                window.location.replace(`${window.location.origin}/?account=${currency}`);
            } else {
                // Tokens not found — redirect to root; app will show login button
                window.location.replace(window.location.origin);
            }
        }
    }, [hasOidcCode]);

    // For legacy OAuth (no OIDC code), render nothing while the effect redirects
    if (!hasOidcCode) {
        return null;
    }

    // OIDC flow: use the Callback component to exchange the code for tokens
    return (
        <Callback
            onSignInSuccess={async (tokens: Record<string, string>, rawState: unknown) => {
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
                            // Use window flag directly — useTMB() cannot be called inside a callback (hook violation)
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

                // Ensure logged_state=true so CoreStoreProvider doesn't force a logout
                Cookies.set('logged_state', 'true', { expires: 30, path: '/' });

                const selected_currency = getSelectedCurrency(tokens, clientAccounts, state);
                // Redirect to root (/) not /bot/ — /bot/ has no React Router route
                window.location.replace(`${window.location.origin}/?account=${selected_currency}`);
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
