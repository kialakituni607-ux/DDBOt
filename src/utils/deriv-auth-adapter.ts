/**
 * Deriv Auth Adapter
 * ------------------
 *
 *   UI (your app)
 *      ↓
 *   API Layer (this module)
 *      ↓
 *   Adapter (PKCE or OIDC)
 *      ↓
 *   auth.deriv.com / oauth.deriv.com
 *
 * The app picks ONE mode at runtime:
 *
 *   - 'legacy' : new PKCE flow via auth.deriv.com (replaces old oauth.deriv.com URL).
 *                Generates code_verifier + code_challenge per Deriv OAuth2 PKCE docs.
 *                Callback handled by /callback with server-side token exchange.
 *
 *   - 'oidc'   : Deriv OIDC PKCE flow via @deriv-com/auth-client
 *                (works with apps that have OIDC enabled on the new Deriv API).
 *
 *   - 'auto'   : try OIDC first, fall back to PKCE on failure
 *                (default — covers both old and new app registrations).
 *
 * Mode can be forced from outside by setting one of:
 *   - localStorage.setItem('deriv.auth.mode', 'legacy' | 'oidc' | 'auto')
 *   - URL: ?auth_mode=legacy
 *   - window.DERIV_AUTH_MODE = 'legacy'
 *
 * PKCE implementation follows:
 *   https://developers.deriv.com/docs/oauth2-pkce
 *   Step 1: Generate code_verifier + code_challenge (SHA-256 + BASE64URL)
 *   Step 2: Redirect to https://auth.deriv.com/oauth2/auth
 *   Step 3: /callback verifies state, exchanges code server-side
 */

import Cookies from 'js-cookie';
import { getAppId } from '@/components/shared/utils/config/config';
import { requestOidcAuthentication, OAuth2Logout } from '@deriv-com/auth-client';

/**
 * New Deriv OAuth2 client_id — registered at developers.deriv.com.
 * This is the `client_id` used in the PKCE authorization request.
 * Distinct from `app_id` (legacy WebSocket API identifier, kept for dual support).
 */
export const DERIV_OAUTH_CLIENT_ID = '33s7LwZCzluES8H4HmjIK';

/**
 * The redirect URI registered for DERIV_OAUTH_CLIENT_ID.
 * Must match EXACTLY — scheme, host, path — or Deriv will reject the request.
 */
export const DERIV_REDIRECT_URI = 'https://trademasters.site/callback';

export type AuthMode = 'legacy' | 'oidc' | 'auto';

export interface LoginOptions {
    /** e.g. "USD", "demo" — propagated through `state` / `?account=` */
    currency?: string;
    /** Override the redirect URL. Defaults to `${origin}/callback`. */
    redirectUri?: string;
    /** Force a specific mode for this single call. */
    mode?: AuthMode;
}

export interface LogoutOptions {
    redirectUri?: string;
    onLogout?: () => Promise<void>;
}

const TRADEMASTERS_AFFILIATE_TOKEN = '_AmUk5tNdldlMjdsyM5hasGNd7ZgqdRLk';
const AFFILIATE_COOKIE = 'affiliate_tracking';

/**
 * App IDs that we KNOW are registered as legacy OAuth apps only (i.e. they
 * are NOT registered as OIDC clients on the new Deriv API). When a request to
 * the OIDC `/oauth2/auth` endpoint is made for one of these app_ids, Deriv
 * responds with `invalid_client: The requested OAuth 2.0 Client does not exist`.
 *
 * For these app_ids we skip the OIDC attempt in `auto` mode and go straight to
 * the PKCE URL — saves a network round-trip and avoids the brief flash of
 * Deriv's OIDC error page.
 */
const LEGACY_ONLY_APP_IDS = new Set<number>([
    // 116874 removed — now using dual-support PKCE flow with both client_id and app_id
]);

declare global {
    interface Window {
        DERIV_AUTH_MODE?: AuthMode;
    }
}

/* -------------------------------------------------------------------------- */
/* Mode resolution                                                            */
/* -------------------------------------------------------------------------- */

export const resolveAuthMode = (override?: AuthMode): AuthMode => {
    if (override) return override;

    const url_param = new URLSearchParams(window.location.search).get('auth_mode') as AuthMode | null;
    if (url_param === 'legacy' || url_param === 'oidc' || url_param === 'auto') {
        return url_param;
    }

    const ls = window.localStorage.getItem('deriv.auth.mode') as AuthMode | null;
    if (ls === 'legacy' || ls === 'oidc' || ls === 'auto') {
        return ls;
    }

    if (window.DERIV_AUTH_MODE) return window.DERIV_AUTH_MODE;

    // Default to 'legacy' — use manual PKCE flow
    return 'legacy';
};

/* -------------------------------------------------------------------------- */
/* Affiliate tracking — kept OUT of the OAuth URL (Deriv rejects it now)      */
/* -------------------------------------------------------------------------- */

const persistAffiliateTracking = () => {
    try {
        const params = new URLSearchParams(window.location.search);
        const incoming = params.get('affiliate_token') || params.get('utm_campaign');
        const token = incoming || TRADEMASTERS_AFFILIATE_TOKEN;

        Cookies.set(
            AFFILIATE_COOKIE,
            JSON.stringify({ affiliate_token: token, utm_campaign: 'myaffiliates' }),
            {
                domain: window.location.hostname.split('.').slice(-2).join('.'),
                expires: 30,
                path: '/',
                secure: window.location.protocol === 'https:',
            }
        );
    } catch {
        /* cookies may be blocked — non-fatal */
    }
};

/* -------------------------------------------------------------------------- */
/* PKCE helpers (Step 1 of Deriv PKCE docs)                                   */
/* -------------------------------------------------------------------------- */

/**
 * Generate PKCE parameters per Deriv OAuth2 documentation.
 *
 * - code_verifier : cryptographically random string (64 chars, safe alphabet)
 * - code_challenge: BASE64URL(SHA256(code_verifier))
 *
 * Uses Web Crypto API — available in all modern browsers and Node ≥ 15.
 */
export const generatePKCEParams = async (): Promise<{
    codeVerifier: string;
    codeChallenge: string;
}> => {
    // Generate a cryptographically random code_verifier
    const array = crypto.getRandomValues(new Uint8Array(64));
    const codeVerifier = Array.from(array)
        .map(v => 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~'[v % 66])
        .join('');

    // Derive code_challenge = BASE64URL(SHA256(code_verifier))
    const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(codeVerifier));
    const hashArray = new Uint8Array(hash);
    let binary = '';
    for (let i = 0; i < hashArray.length; i++) binary += String.fromCharCode(hashArray[i]);
    const codeChallenge = btoa(binary)
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/, '');

    return { codeVerifier, codeChallenge };
};

/**
 * Generate a random hex state string for CSRF protection.
 */
const generateState = (): string =>
    Array.from(crypto.getRandomValues(new Uint8Array(16)))
        .map(b => b.toString(16).padStart(2, '0'))
        .join('');

/* -------------------------------------------------------------------------- */
/* PKCE auth URL builder (Step 2 of Deriv PKCE docs)                          */
/* -------------------------------------------------------------------------- */

/**
 * Build the new Deriv PKCE authorization URL targeting auth.deriv.com.
 *
 *   https://auth.deriv.com/oauth2/auth
 *     ?response_type=code
 *     &client_id=<app_id>
 *     &redirect_uri=<callback>
 *     &scope=trade+account_manage
 *     &state=<csrf_nonce>
 *     &code_challenge=<BASE64URL(SHA256(verifier))>
 *     &code_challenge_method=S256
 *     &app_id=<legacy_app_id>   ← dual-support per docs
 *
 * Stores code_verifier + state in sessionStorage before redirecting.
 * Both are cleared by the callback handler after a successful exchange.
 */
export const buildPKCEAuthURL = async (opts: LoginOptions = {}): Promise<string> => {
    const { codeVerifier, codeChallenge } = await generatePKCEParams();
    const state = generateState();

    // Store per docs — cleared after successful token exchange
    try {
        localStorage.setItem('pkce_code_verifier', codeVerifier);
        sessionStorage.setItem('oauth_state', state);
        // Also preserve currency for post-auth redirect
        if (opts.currency) {
            sessionStorage.setItem('query_param_currency', opts.currency);
        }
    } catch {
        /* sessionStorage may be unavailable — non-fatal */
    }

    // client_id = new OAuth2 client (33s7LwZCzluES8H4HmjIK)
    // app_id    = legacy WebSocket API identifier (116874) — optional dual-support param per docs
    const legacy_app_id = String(getAppId());
    const redirect_uri = DERIV_REDIRECT_URI;

    const url = new URL('https://auth.deriv.com/oauth2/auth');
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('client_id', DERIV_OAUTH_CLIENT_ID);
    url.searchParams.set('redirect_uri', redirect_uri);
    url.searchParams.set('scope', 'trade account_manage');
    url.searchParams.set('state', state);
    url.searchParams.set('code_challenge', codeChallenge);
    url.searchParams.set('code_challenge_method', 'S256');
    // Optional: include legacy app_id for dual-support routing per Deriv docs
    url.searchParams.set('app_id', legacy_app_id);

    return url.toString();
};

/**
 * Build the legacy OAuth URL (fallback for QA / test environments).
 * Used as a hard fallback when auth.deriv.com is unreachable.
 */
export const buildLegacyAuthorizeURL = (opts: LoginOptions = {}): string => {
    const app_id = String(getAppId());

    const host = window.location.hostname;
    let oauth_host = 'oauth.deriv.com';
    if (host.includes('.deriv.me')) oauth_host = 'oauth.deriv.me';
    else if (host.includes('.deriv.be')) oauth_host = 'oauth.deriv.be';

    const url = new URL(`https://${oauth_host}/oauth2/authorize`);
    url.searchParams.set('app_id', app_id);
    url.searchParams.set('brand', 'deriv');

    if (opts.redirectUri) {
        url.searchParams.set('redirect_uri', opts.redirectUri);
    } else {
        url.searchParams.set('redirect', 'home');
    }

    // CSRF state nonce (stored under legacy key — not the PKCE key)
    const array = new Uint8Array(32);
    crypto.getRandomValues(array);
    const state = btoa(String.fromCharCode(...array))
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/, '');
    try { sessionStorage.setItem('deriv.oauth.state', state); } catch { /* non-fatal */ }
    url.searchParams.set('state', state);

    return url.toString();
};

/* -------------------------------------------------------------------------- */
/* Login adapters                                                              */
/* -------------------------------------------------------------------------- */

/**
 * PKCE login — uses new auth.deriv.com endpoint with full PKCE per docs.
 * Token exchange is handled server-side in /callback via /api/auth/pkce-token.
 */
const pkceLogin = async (opts: LoginOptions): Promise<void> => {
    persistAffiliateTracking();
    // Use legacy OAuth for app_id 116874 which is not registered on new OIDC
    const app_id = Number(getAppId());
    if (LEGACY_ONLY_APP_IDS.has(app_id)) {
        const url = buildLegacyAuthorizeURL(opts);
        window.location.href = url;
        return;
    }
    const url = await buildPKCEAuthURL(opts);
    window.location.href = url;
};

/* -------------------------------------------------------------------------- */
/* OIDC adapter                                                               */
/* -------------------------------------------------------------------------- */

const oidcLogin = async (opts: LoginOptions): Promise<void> => {
    persistAffiliateTracking();
    if (opts.currency) {
        sessionStorage.setItem('query_param_currency', opts.currency);
    }
    await requestOidcAuthentication({
        redirectCallbackUri: opts.redirectUri || `${window.location.origin}/callback`,
        postLogoutRedirectUri: window.location.origin,
        ...(opts.currency ? { state: { account: opts.currency } } : {}),
    });
};

/* -------------------------------------------------------------------------- */
/* Public API                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Single entry point for "log in to Deriv".
 *
 *  - mode='legacy' → PKCE flow via auth.deriv.com (our implementation)
 *  - mode='oidc'   → OIDC PKCE flow via @deriv-com/auth-client
 *  - mode='auto'   → For legacy-only apps: use PKCE directly.
 *                    For OIDC-enabled apps: try OIDC first, fall back to PKCE.
 */
export const derivLogin = async (options: LoginOptions = {}): Promise<void> => {
    const mode = resolveAuthMode(options.mode);
    const currency =
        options.currency ||
        new URLSearchParams(window.location.search).get('account') ||
        sessionStorage.getItem('query_param_currency') ||
        '';

    const opts: LoginOptions = { ...options, currency };

    // eslint-disable-next-line no-console
    console.info(`[deriv-auth] login mode=${mode} app_id=${getAppId()}`);

    if (mode === 'legacy') {
        return pkceLogin(opts);
    }

    if (mode === 'oidc') {
        return oidcLogin(opts);
    }

    // mode === 'auto'
    const app_id = Number(getAppId());
    if (LEGACY_ONLY_APP_IDS.has(app_id)) {
        // eslint-disable-next-line no-console
        console.info(`[deriv-auth] auto: app_id ${app_id} → using PKCE adapter (auth.deriv.com)`);
        return pkceLogin(opts);
    }

    try {
        await oidcLogin(opts);
    } catch (err) {
        // eslint-disable-next-line no-console
        console.warn('[deriv-auth] OIDC failed, falling back to PKCE:', err);
        await pkceLogin(opts);
    }
};

export const derivLogout = async (options: LogoutOptions = {}): Promise<void> => {
    const mode = resolveAuthMode();
    const redirectCallbackUri = options.redirectUri || `${window.location.origin}/callback`;

    if (mode === 'legacy') {
        try {
            await options.onLogout?.();
        } finally {
            window.location.href = window.location.origin;
        }
        return;
    }

    await OAuth2Logout({
        redirectCallbackUri,
        WSLogoutAndRedirect: options.onLogout ?? (() => Promise.resolve()),
        postLogoutRedirectUri: window.location.origin,
    });
};

/** Convenience for the React side. */
export const setAuthMode = (mode: AuthMode): void => {
    window.localStorage.setItem('deriv.auth.mode', mode);
};
