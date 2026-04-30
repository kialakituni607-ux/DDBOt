/**
 * Deriv Auth Adapter
 * ------------------
 *
 *   UI (your app)
 *      ↓
 *   API Layer (this module)
 *      ↓
 *   Adapter (LEGACY or OIDC)
 *      ↓
 *   WebSocket / OAuth handshake at oauth.deriv.com
 *
 * The app picks ONE mode at runtime:
 *
 *   - 'legacy' : classic `oauth.deriv.com/oauth2/authorize` URL
 *                (works with the old API and any app registered on
 *                 legacy-api.deriv.com).
 *
 *   - 'oidc'   : new Deriv OIDC PKCE flow via @deriv-com/auth-client
 *                (works with apps that have OIDC enabled).
 *
 *   - 'auto'   : try OIDC first, fall back to legacy on failure
 *                (default — covers both old and new app registrations).
 *
 * Mode can be forced from outside by setting one of:
 *   - localStorage.setItem('deriv.auth.mode', 'legacy' | 'oidc' | 'auto')
 *   - URL: ?auth_mode=legacy
 *   - window.DERIV_AUTH_MODE = 'legacy'
 *
 * IMPORTANT: This builds a SPEC-COMPLIANT legacy URL. The previous
 * hardcoded URL was missing `redirect_uri` and contained non-OAuth2
 * parameters (`affiliate_token`, `utm_campaign`) that Deriv's stricter
 * server now rejects with `invalid_request`. We pass `redirect_uri`
 * explicitly and keep marketing tags out of the OAuth call itself
 * (they go in a cookie instead, the same way Deriv's main app does it).
 */

import Cookies from 'js-cookie';
import { getAppId, TRADEMASTERS_APP_ID } from '@/components/shared/utils/config/config';
import { requestOidcAuthentication, OAuth2Logout } from '@deriv-com/auth-client';

/**
 * The redirect URI registered in the Deriv app dashboard for each app_id.
 * Deriv requires the redirect_uri in the request to exactly match this value —
 * scheme, domain, path, and trailing slash all must match.
 */
const REGISTERED_REDIRECT_URIS: Record<number, string> = {
    [TRADEMASTERS_APP_ID]: 'https://trademasters.site/',
};

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
 * the legacy URL — saves a network round-trip and avoids the brief flash of
 * Deriv's OIDC error page.
 */
const LEGACY_ONLY_APP_IDS = new Set<number>([
    116874, // trademasters.site (verified 2026-04-28: invalid_client on /oauth2/auth)
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

    return 'auto';
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
/* Legacy adapter                                                             */
/* -------------------------------------------------------------------------- */

/**
 * Generate a cryptographically random state value for OAuth CSRF protection,
 * persist it in sessionStorage, and return the base64url-encoded string.
 *
 * Why: other Deriv-integrated platforms (e.g. dollarprinter.com) use a
 * `state` nonce with `redirect=home` instead of a `redirect_uri` query param.
 * This is the pattern Deriv's new `home.deriv.com` login portal honours for
 * legacy (non-OIDC) apps — it uses the app's registered redirect URL from
 * the Deriv dashboard rather than reading `redirect_uri` from the request,
 * which it now ignores for non-OIDC app_ids.
 */
const generateOAuthState = (extra: Record<string, string | undefined> = {}): string => {
    const array = new Uint8Array(16);
    crypto.getRandomValues(array);
    const nonce = btoa(String.fromCharCode(...array))
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/, '');

    // OAuth `state` is the right place to carry our own metadata back to us
    // (per Deriv support guidance — never as separate top-level query params).
    // We pack the CSRF nonce + affiliate/UTM into a JSON object, then base64url
    // encode it so it's safe to pass through a URL.
    const payload: Record<string, string> = { n: nonce };
    for (const [k, v] of Object.entries(extra)) {
        if (v) payload[k] = v;
    }
    const json = JSON.stringify(payload);
    const state = btoa(unescape(encodeURIComponent(json)))
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/, '');

    try {
        sessionStorage.setItem('deriv.oauth.state', state);
        sessionStorage.setItem('deriv.oauth.state.nonce', nonce);
    } catch {
        /* sessionStorage may be unavailable — non-fatal */
    }
    return state;
};

/**
 * Build the legacy OAuth URL using the pattern observed from working
 * Deriv-integrated platforms:
 *
 *   ?app_id=<id>&brand=deriv&redirect=home&state=<nonce>
 *
 * Using `redirect=home` tells Deriv's login portal to redirect to the URL
 * registered in the app's Deriv dashboard after authentication, rather than
 * reading `redirect_uri` from the query string. Deriv's new
 * `home.deriv.com/dashboard/login` portal ignores `redirect_uri` for
 * non-OIDC apps, which is why the old approach failed.
 */
export const buildLegacyAuthorizeURL = (opts: LoginOptions = {}): string => {
    const app_id_num = Number(getAppId());
    const app_id = String(app_id_num);

    // Pick the right OAuth host for the user's region.
    const host = window.location.hostname;
    let oauth_host = 'oauth.deriv.com';
    if (host.includes('.deriv.me')) oauth_host = 'oauth.deriv.me';
    else if (host.includes('.deriv.be')) oauth_host = 'oauth.deriv.be';

    const url = new URL(`https://${oauth_host}/oauth2/authorize`);
    url.searchParams.set('app_id', app_id);
    url.searchParams.set('l', 'EN');
    url.searchParams.set('brand', 'deriv');

    // Per Deriv support: send `redirect_uri` (NOT `redirect=home`), and the
    // value MUST exactly match the URL saved on the Deriv app dashboard
    // (scheme, domain, path, trailing slash). For our app the registered URL
    // is `https://trademasters.site/`.
    const redirect_uri =
        opts.redirectUri || REGISTERED_REDIRECT_URIS[app_id_num] || `${window.location.origin}/`;
    url.searchParams.set('redirect_uri', redirect_uri);

    // Pack affiliate token + (optional) currency hint into the OAuth `state`.
    // Per Deriv support: never put affiliate/UTM data as top-level query params
    // — it belongs inside `state`, which Deriv echoes back to us untouched.
    let affiliate_token: string | undefined;
    try {
        const cookie = Cookies.get(AFFILIATE_COOKIE);
        if (cookie) affiliate_token = JSON.parse(cookie).affiliate_token;
    } catch {
        /* malformed cookie — ignore */
    }
    affiliate_token = affiliate_token || TRADEMASTERS_AFFILIATE_TOKEN;

    url.searchParams.set(
        'state',
        generateOAuthState({ a: affiliate_token, c: opts.currency }),
    );

    return url.toString();
};

/**
 * Clear any active Deriv session before starting the OAuth flow.
 *
 * Why this is needed: Deriv's new login portal (`home.deriv.com/dashboard/login`)
 * auto-completes the flow using the existing browser session and redirects to
 * `app.deriv.com` — completely ignoring the `redirect_uri` we supply. Clearing
 * the session first forces the login portal to show the sign-in form and then
 * honour our redirect_uri after the user authenticates.
 *
 * Previous approach (iframe) was blocked by Deriv's X-Frame-Options header.
 * This approach uses fetch with `credentials: 'include'` so the browser sends
 * the Deriv session cookie; Deriv's server clears it via Set-Cookie. We use
 * `mode: 'no-cors'` and `redirect: 'manual'` so we never follow the server
 * redirect — we only care that the session cookie is cleared.
 */
const preClearDerivSession = (): Promise<void> => {
    const host = window.location.hostname;
    let oauth_host = 'oauth.deriv.com';
    if (host.includes('.deriv.me')) oauth_host = 'oauth.deriv.me';
    else if (host.includes('.deriv.be')) oauth_host = 'oauth.deriv.be';

    const logoutUrl = `https://${oauth_host}/oauth2/sessions/logout`;

    // Race between the fetch completing and a 1.5s safety timeout so the
    // login button never freezes even if the request hangs.
    return Promise.race([
        fetch(logoutUrl, {
            method: 'GET',
            credentials: 'include',
            mode: 'no-cors',
            redirect: 'manual',
        }).catch(() => { /* network error — ignore, proceed to login */ }),
        new Promise<void>(resolve => setTimeout(resolve, 1500)),
    ]).then(() => { /* void */ });
};

const legacyLogin = async (opts: LoginOptions): Promise<void> => {
    persistAffiliateTracking();
    if (opts.currency) {
        sessionStorage.setItem('query_param_currency', opts.currency);
    }
    // Clear any stale Deriv session that would otherwise short-circuit OAuth.
    await preClearDerivSession();
    window.location.href = buildLegacyAuthorizeURL(opts);
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
 *  - mode='legacy' → uses the legacy URL only
 *  - mode='oidc'   → uses the new Deriv OIDC flow only
 *  - mode='auto'   → try OIDC first, fall back to legacy on any error
 *                    (this is what makes the same button work for users
 *                    on BOTH the old and the new Deriv API)
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
        return legacyLogin(opts);
    }

    if (mode === 'oidc') {
        return oidcLogin(opts);
    }

    // mode === 'auto' → If we know this app is legacy-only, skip OIDC entirely.
    // Otherwise try OIDC, then legacy.
    const app_id = Number(getAppId());
    if (LEGACY_ONLY_APP_IDS.has(app_id)) {
        // eslint-disable-next-line no-console
        console.info(`[deriv-auth] auto: app_id ${app_id} is legacy-only → using legacy adapter`);
        return legacyLogin(opts);
    }

    try {
        await oidcLogin(opts);
    } catch (err) {
        // eslint-disable-next-line no-console
        console.warn('[deriv-auth] OIDC failed, falling back to legacy:', err);
        await legacyLogin(opts);
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
