/**
 * Deriv Personal API Token Auth
 * -----------------------------
 *
 * The "new API" path Deriv recommends for users who don't want to go through
 * OAuth: they paste their personal API token (created at
 * https://app.deriv.com/account/api-token) and we authorize the same WebSocket
 * connection with that token.
 *
 * Once authorized, the rest of the app uses the SAME flows as OAuth login —
 * `proposal`, `buy`, `ticks`, `statement` etc. all just work because they
 * operate on the same `authToken` in localStorage.
 *
 * Security notes (per Deriv support guidance):
 *   - The raw token is kept in sessionStorage (not localStorage) so it lives
 *     only for the current tab session.
 *   - We never log the token; it's masked in any diagnostic output.
 *   - On logout we clear both the session token AND the localStorage mirror.
 *   - We also stash an `auth_method=token` flag so we can show the right UI
 *     and short-circuit OAuth re-authentication on InvalidToken events.
 */
import { generateDerivApiInstance } from '@/external/bot-skeleton/services/api/appId';

export const PERSONAL_TOKEN_SESSION_KEY = 'deriv.personal_api_token';
export const AUTH_METHOD_KEY = 'deriv.auth_method';

export type AuthMethod = 'oauth' | 'token';

export interface AuthorizeResult {
    success: boolean;
    loginid?: string;
    currency?: string;
    fullname?: string;
    email?: string;
    /** Scopes attached to the token, e.g. ['read', 'trade', 'trading_information'] */
    scopes?: string[];
    /** When success === false */
    error?: {
        code: string;
        message: string;
        /** True if it's a recoverable user error (bad token, missing scope) */
        userFacing: boolean;
    };
}

const REQUIRED_SCOPES = ['read', 'trade'];

const maskToken = (t: string): string => {
    if (!t) return '(empty)';
    if (t.length <= 6) return '****';
    return `${t.slice(0, 3)}…${t.slice(-3)}`;
};

/** Quick syntactic validation — Deriv tokens are typically 15 chars, alnum. */
export const isPlausibleToken = (token: string): boolean => {
    const t = token.trim();
    return t.length >= 8 && t.length <= 64 && /^[A-Za-z0-9_-]+$/.test(t);
};

export const setAuthMethod = (method: AuthMethod): void => {
    sessionStorage.setItem(AUTH_METHOD_KEY, method);
};

export const getAuthMethod = (): AuthMethod => {
    return (sessionStorage.getItem(AUTH_METHOD_KEY) as AuthMethod) || 'oauth';
};

export const setPersonalToken = (token: string): void => {
    sessionStorage.setItem(PERSONAL_TOKEN_SESSION_KEY, token);
};

export const getPersonalToken = (): string | null => {
    return sessionStorage.getItem(PERSONAL_TOKEN_SESSION_KEY);
};

export const clearPersonalToken = (): void => {
    sessionStorage.removeItem(PERSONAL_TOKEN_SESSION_KEY);
    sessionStorage.removeItem(AUTH_METHOD_KEY);
};

/**
 * Calls `authorize` against the Deriv WebSocket using the supplied token.
 *
 * On success: persists account info into the same localStorage keys the
 * OAuth /callback handler writes to, so the rest of the app picks the user
 * up automatically on reload.
 */
export const authorizeWithPersonalToken = async (rawToken: string): Promise<AuthorizeResult> => {
    const token = rawToken.trim();

    if (!isPlausibleToken(token)) {
        return {
            success: false,
            error: {
                code: 'InvalidFormat',
                message: 'That doesn\u2019t look like a Deriv API token. Tokens are typically 15 characters and contain only letters, numbers, dashes or underscores.',
                userFacing: true,
            },
        };
    }

    let api: ReturnType<typeof generateDerivApiInstance> | null = null;
    try {
        api = generateDerivApiInstance();
        if (!api) {
            return {
                success: false,
                error: {
                    code: 'NoConnection',
                    message: 'Could not open a connection to Deriv. Please check your internet and try again.',
                    userFacing: true,
                },
            };
        }

        // eslint-disable-next-line no-console
        console.info(`[deriv-token-auth] authorizing with token=${maskToken(token)}`);

        const response = await api.authorize(token);

        if (response?.error) {
            const errCode = String(response.error.code || 'AuthError');
            const errMsg = String(response.error.message || 'Authorization failed.');
            return {
                success: false,
                error: {
                    code: errCode,
                    message: errMsg,
                    userFacing: ['InvalidToken', 'PermissionDenied', 'AuthorizationRequired'].includes(errCode),
                },
            };
        }

        const authorize = response?.authorize;
        if (!authorize?.loginid || !authorize?.token) {
            return {
                success: false,
                error: {
                    code: 'BadAuthorizeResponse',
                    message: 'Deriv accepted the token but didn\u2019t return account details. Please try again.',
                    userFacing: true,
                },
            };
        }

        const scopes: string[] = (authorize.scopes || []) as string[];
        const missing = REQUIRED_SCOPES.filter(s => !scopes.includes(s));
        if (missing.length) {
            return {
                success: false,
                error: {
                    code: 'MissingScopes',
                    message: `This token is missing required permission(s): ${missing.join(', ')}. Create a new token with at least Read and Trade enabled.`,
                    userFacing: true,
                },
                scopes,
                loginid: authorize.loginid,
                currency: authorize.currency,
            };
        }

        // Mirror the same shape the OAuth /callback handler writes, so the
        // existing app machinery (account switcher, store, etc.) picks this
        // session up exactly like an OAuth login.
        const accountsList: Record<string, string> = { [authorize.loginid]: token };
        const clientAccounts: Record<string, { loginid: string; token: string; currency: string }> = {
            [authorize.loginid]: {
                loginid: authorize.loginid,
                token,
                currency: authorize.currency || 'USD',
            },
        };

        // If the account_list contains additional accounts (siblings on the
        // same login), include them too so the account switcher works. They
        // share the same token because personal tokens grant cross-account
        // access by default.
        if (Array.isArray(authorize.account_list)) {
            for (const acc of authorize.account_list) {
                if (acc?.loginid && !accountsList[acc.loginid]) {
                    accountsList[acc.loginid] = token;
                    clientAccounts[acc.loginid] = {
                        loginid: acc.loginid,
                        token,
                        currency: acc.currency || authorize.currency || 'USD',
                    };
                }
            }
        }

        localStorage.setItem('accountsList', JSON.stringify(accountsList));
        localStorage.setItem('clientAccounts', JSON.stringify(clientAccounts));
        localStorage.setItem('authToken', token);
        localStorage.setItem('active_loginid', authorize.loginid);

        // Mark this session as token-auth so logout/re-auth handlers know
        // not to bounce the user through OAuth.
        setPersonalToken(token);
        setAuthMethod('token');

        return {
            success: true,
            loginid: authorize.loginid,
            currency: authorize.currency,
            fullname: authorize.fullname,
            email: authorize.email,
            scopes,
        };
    } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'Unknown error during authorization.';
        return {
            success: false,
            error: {
                code: 'NetworkError',
                message,
                userFacing: true,
            },
        };
    } finally {
        try {
            (api as unknown as { connection?: WebSocket })?.connection?.close();
        } catch {
            /* noop */
        }
    }
};
