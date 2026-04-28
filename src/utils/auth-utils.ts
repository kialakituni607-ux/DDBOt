/**
 * Utility functions for authentication-related operations
 */
import Cookies from 'js-cookie';
import { generateOAuthURL } from '@/components/shared';
import { requestOidcAuthentication } from '@deriv-com/auth-client';

const TRADEMASTERS_AFFILIATE_TOKEN = '_AmUk5tNdldlMjdsyM5hasGNd7ZgqdRLk';

/**
 * Builds the legacy OAuth fallback URL while preserving affiliate / utm tags.
 */
const buildLegacyOAuthURL = (currency?: string): string => {
    let url: string;
    try {
        url = generateOAuthURL();
    } catch {
        url = 'https://oauth.deriv.com/oauth2/authorize';
    }
    const u = new URL(url);
    if (!u.searchParams.get('l')) u.searchParams.set('l', 'EN');
    if (!u.searchParams.get('brand')) u.searchParams.set('brand', 'deriv');
    if (!u.searchParams.get('affiliate_token')) {
        u.searchParams.set('affiliate_token', TRADEMASTERS_AFFILIATE_TOKEN);
        u.searchParams.set('utm_campaign', 'myaffiliates');
    }
    if (currency) u.searchParams.set('account', currency);
    return u.toString();
};

/**
 * Unified login helper.
 *
 * 1. Try the new Deriv OIDC flow (`requestOidcAuthentication`). This is what
 *    Deriv's newer app registrations require.
 * 2. If OIDC throws / is not configured for this app_id, gracefully fall back
 *    to the legacy `oauth.deriv.com/oauth2/authorize` URL so users on older
 *    app registrations (or networks where OIDC is blocked) can still log in.
 *
 * This means the same "Log in" button works against BOTH the legacy OAuth API
 * and the new Deriv OIDC API.
 */
export const loginWithFallback = async (options?: { currency?: string }): Promise<void> => {
    const currency =
        options?.currency ||
        new URLSearchParams(window.location.search).get('account') ||
        sessionStorage.getItem('query_param_currency') ||
        '';

    if (currency) {
        sessionStorage.setItem('query_param_currency', currency);
    }

    try {
        await requestOidcAuthentication({
            redirectCallbackUri: `${window.location.origin}/callback`,
            postLogoutRedirectUri: window.location.origin,
            ...(currency ? { state: { account: currency } } : {}),
        });
        // requestOidcAuthentication redirects the browser, so this line is
        // typically never reached on success.
        return;
    } catch (err) {
        // OIDC is unavailable for this app/host — fall back to legacy OAuth.
        // eslint-disable-next-line no-console
        console.warn('[auth] OIDC login failed, falling back to legacy OAuth:', err);
        window.location.href = buildLegacyOAuthURL(currency);
    }
};

/**
 * Clears authentication data from local storage and reloads the page
 */
export const clearAuthData = (is_reload: boolean = true): void => {
    localStorage.removeItem('accountsList');
    localStorage.removeItem('clientAccounts');
    localStorage.removeItem('callback_token');
    localStorage.removeItem('authToken');
    localStorage.removeItem('active_loginid');
    localStorage.removeItem('client.accounts');
    localStorage.removeItem('client.country');
    sessionStorage.removeItem('query_param_currency');
    if (is_reload) {
        location.reload();
    }
};

/**
 * Handles OIDC authentication failure by clearing auth data and showing logged out view
 * @param error - The error that occurred during OIDC authentication
 */
export const handleOidcAuthFailure = (error: any): void => {
    // Log the error
    console.error('OIDC authentication failed:', error);

    // Clear auth data
    localStorage.removeItem('authToken');
    localStorage.removeItem('active_loginid');
    localStorage.removeItem('clientAccounts');
    localStorage.removeItem('accountsList');

    // Set logged_state cookie to false
    Cookies.set('logged_state', 'false', {
        domain: window.location.hostname.split('.').slice(-2).join('.'),
        expires: 30,
        path: '/',
        secure: true,
    });

    // Reload the page to show the logged out view
    window.location.reload();
};
