// Clean Deriv Auth Adapter — supports both legacy and new PKCE flow
export const DERIV_OAUTH_CLIENT_ID = '33s7LwZCzluES8H4HmjIK';
export const DERIV_REDIRECT_URI = 'https://trademasters.site/callback';
const APP_ID = '116874';

export type LoginOptions = { currency?: string; redirectUri?: string; mode?: string };
export type AuthMode = 'legacy' | 'oidc' | 'auto';

export const resolveAuthMode = (): AuthMode => (localStorage.getItem('auth_mode') as AuthMode) || 'legacy';
export const setAuthMode = (mode: AuthMode): void => { localStorage.setItem('auth_mode', mode); };

export const derivLogin = async (_options: LoginOptions = {}): Promise<void> => {
    const array = crypto.getRandomValues(new Uint8Array(64));
    const codeVerifier = Array.from(array)
        .map(v => 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~'[v % 66])
        .join('');
    const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(codeVerifier));
    const hashArray = new Uint8Array(hash);
    let binary = '';
    for (let i = 0; i < hashArray.length; i++) binary += String.fromCharCode(hashArray[i]);
    const codeChallenge = btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    const state = Array.from(crypto.getRandomValues(new Uint8Array(16)))
        .map(b => b.toString(16).padStart(2, '0')).join('');
    sessionStorage.setItem('pkce_code_verifier', codeVerifier);
    sessionStorage.setItem('pkce_state', state);
    const url = new URL('https://auth.deriv.com/oauth2/auth');
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('client_id', DERIV_OAUTH_CLIENT_ID);
    url.searchParams.set('redirect_uri', DERIV_REDIRECT_URI);
    url.searchParams.set('scope', 'trade');
    url.searchParams.set('state', state);
    url.searchParams.set('code_challenge', codeChallenge);
    url.searchParams.set('code_challenge_method', 'S256');
    window.location.href = url.toString();
};

export const buildLegacyAuthorizeURL = (): string => {
    return `https://oauth.deriv.com/oauth2/authorize?app_id=${APP_ID}&brand=deriv&l=EN&redirect_uri=https://trademasters.site/callback`;
};

export const derivLogout = async (): Promise<void> => {
    localStorage.clear();
    window.location.href = '/';
};
