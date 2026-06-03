/**
 * PKCE (Proof Key for Code Exchange) OAuth 2.0 flow for Deriv New API.
 *
 * Client ID  : 33s7LwZCzluES8H4HmjIK
 * Auth URL   : https://oauth.deriv.com/oauth2/authorize
 * Token URL  : POST /api/auth/pkce-exchange  (our backend proxies to Deriv)
 * Redirect   : https://trademasters.site/
 */

export const PKCE_CLIENT_ID  = '33s7LwZCzluES8H4HmjIK';
export const PKCE_REDIRECT_URI = `${window.location.origin}/`;
export const PKCE_SCOPE      = 'trade';

const SK_VERIFIER = 'pkce.code_verifier';
const SK_STATE    = 'pkce.state';
const SK_FLOW     = 'pkce.flow';

function generateVerifier(): string {
    const arr = new Uint8Array(32);
    crypto.getRandomValues(arr);
    return btoa(String.fromCharCode(...arr))
        .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function sha256B64url(plain: string): Promise<string> {
    const data   = new TextEncoder().encode(plain);
    const digest = await crypto.subtle.digest('SHA-256', data);
    return btoa(String.fromCharCode(...new Uint8Array(digest)))
        .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function buildAuthorizeURL(): Promise<{ url: string; verifier: string; state: string }> {
    const verifier   = generateVerifier();
    const challenge  = await sha256B64url(verifier);

    const stateArr = new Uint8Array(16);
    crypto.getRandomValues(stateArr);
    const state = btoa(String.fromCharCode(...stateArr))
        .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

    const params = new URLSearchParams({
        response_type        : 'code',
        client_id            : PKCE_CLIENT_ID,
        redirect_uri         : PKCE_REDIRECT_URI,
        scope                : PKCE_SCOPE,
        state,
        code_challenge       : challenge,
        code_challenge_method: 'S256',
    });

    return { url: `https://oauth.deriv.com/oauth2/authorize?${params}`, verifier, state };
}

export async function startPkceLogin(): Promise<void> {
    const { url, verifier, state } = await buildAuthorizeURL();
    try {
        sessionStorage.setItem(SK_VERIFIER, verifier);
        sessionStorage.setItem(SK_STATE,    state);
        sessionStorage.setItem(SK_FLOW,     'pkce');
    } catch { /* sessionStorage unavailable */ }
    window.location.href = url;
}

export interface PkceCallbackData {
    code    : string;
    verifier: string;
    state   : string;
}

export function detectPkceCallback(): PkceCallbackData | null {
    const params  = new URLSearchParams(window.location.search);
    const code    = params.get('code');
    const state   = params.get('state');
    try {
        const verifier    = sessionStorage.getItem(SK_VERIFIER);
        const storedFlow  = sessionStorage.getItem(SK_FLOW);
        const storedState = sessionStorage.getItem(SK_STATE);
        if (code && verifier && storedFlow === 'pkce') {
            if (state && storedState && state !== storedState) {
                console.warn('[PKCE] state mismatch — aborting');
                return null;
            }
            return { code, verifier, state: state || '' };
        }
    } catch { /* ignore */ }
    return null;
}

export function clearPkceStorage(): void {
    try {
        sessionStorage.removeItem(SK_VERIFIER);
        sessionStorage.removeItem(SK_STATE);
        sessionStorage.removeItem(SK_FLOW);
    } catch { /* ignore */ }
}

export interface PkceTokenResponse {
    access_token : string;
    token_type   : string;
    expires_in?  : number;
    scope?       : string;
    acct1?       : string;
    token1?      : string;
    [key: string]: any;
}

export async function exchangePkceCode(
    code        : string,
    codeVerifier: string,
): Promise<PkceTokenResponse> {
    const resp = await fetch('/api/auth/pkce-exchange', {
        method : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body   : JSON.stringify({
            code,
            codeVerifier,
            clientId   : PKCE_CLIENT_ID,
            redirectUri: PKCE_REDIRECT_URI,
        }),
    });
    if (!resp.ok) {
        const err = await resp.json().catch(() => ({ error: 'Exchange failed' }));
        throw new Error(err.error || `PKCE exchange failed (${resp.status})`);
    }
    return resp.json();
}
