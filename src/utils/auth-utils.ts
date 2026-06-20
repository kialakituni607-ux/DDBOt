import Cookies from 'js-cookie';
import { derivLogin, type LoginOptions } from './deriv-auth-adapter';
export const loginWithFallback = (options?: LoginOptions): Promise<void> => derivLogin(options || {});
export const clearAuthData = (is_reload: boolean = true): void => {
    localStorage.removeItem('accountsList');
    localStorage.removeItem('clientAccounts');
    localStorage.removeItem('callback_token');
    localStorage.removeItem('authToken');
    localStorage.removeItem('active_loginid');
    localStorage.removeItem('client.accounts');
    localStorage.removeItem('client.country');
    if (window.location.pathname.indexOf('/callback') === -1) {
        localStorage.removeItem('pkce_code_verifier');
        localStorage.removeItem('pkce_state');
    }
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
