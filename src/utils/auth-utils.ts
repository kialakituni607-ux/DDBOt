/**
 * Utility functions for authentication-related operations
 */
import Cookies from 'js-cookie';
import { derivLogin, type LoginOptions } from './deriv-auth-adapter';

/**
 * Unified login helper — thin wrapper around the Deriv auth adapter.
 *
 * The adapter (`src/utils/deriv-auth-adapter.ts`) decides whether to use
 *   - the new Deriv OIDC flow (`mode='oidc'`)
 *   - the legacy `oauth.deriv.com/oauth2/authorize` URL (`mode='legacy'`)
 *   - or 'auto' (default): try OIDC first, fall back to legacy on any error.
 *
 * That means the same "Log in" button works against BOTH the old and the
 * new Deriv API, exactly as requested.
 */
export const loginWithFallback = (options?: LoginOptions): Promise<void> => derivLogin(options);

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
    // Personal API token (Deriv "new API" path) — kept in sessionStorage only.
    sessionStorage.removeItem('deriv.personal_api_token');
    sessionStorage.removeItem('deriv.auth_method');
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
