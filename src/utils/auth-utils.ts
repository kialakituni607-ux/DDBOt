import Cookies from 'js-cookie';
import { derivLogin, redirectToLegacyLogin, type LoginOptions } from './deriv-auth-adapter';

export const loginWithFallback = (options?: LoginOptions): void => {
    try {
        derivLogin(options || {}).catch((err) => {
            console.warn('[auth] PKCE failed, falling back to legacy:', err);
            redirectToLegacyLogin();
        });
    } catch (err) {
        console.warn('[auth] PKCE setup failed, falling back to legacy:', err);
        redirectToLegacyLogin();
    }
};

export const clearAuthData = (is_reload: boolean = true): void => {
    localStorage.removeItem('accountsList');
    localStorage.removeItem('clientAccounts');
    localStorage.removeItem('callback_token');
    localStorage.removeItem('authToken');
    localStorage.removeItem('active_loginid');
    localStorage.removeItem('client.accounts');
    localStorage.removeItem('client.country');
    sessionStorage.removeItem('query_param_currency');
    if (is_reload) location.reload();
};

export const handleOidcAuthFailure = (error: any): void => {
    console.error('Auth failed:', error);
    clearAuthData(false);
    Cookies.set('logged_state', 'false', {
        domain: window.location.hostname.split('.').slice(-2).join('.'),
        expires: 30, path: '/', secure: true,
    });
    window.location.reload();
};
