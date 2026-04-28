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
import { getAppId } from '@/components/shared/utils/config/config';
import { requestOidcAuthentication, OAuth2Logout } from '@deriv-com/auth-client';

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
 * Build the legacy OAuth URL the SAME way the official Deriv DBot does.
 *
 * KEY POINTS (learned the hard way):
 *  - DO NOT pass `redirect_uri`. Deriv legacy uses the URL registered on the
 *    app's dashboard. Passing it explicitly makes Deriv treat the request as
 *    a confidential-client flow and silently route the user to app.deriv.com
 *    instead of running the redirect-back. The redirect URL on the dashboard
 *    is the source of truth.
 *  - Only `app_id`, `l`, `brand` are needed. Everything else (affiliate token,
 *    currency, utm) goes into a cookie so Deriv's UI can read it post-login.
 */
export const buildLegacyAuthorizeURL = (opts: LoginOptions = {}): string => {
    const app_id = String(getAppId());

    // Pick the right OAuth host for the user's region.
    const host = window.location.hostname;
    let oauth_host = 'oauth.deriv.com';
    if (host.includes('.deriv.me')) oauth_host = 'oauth.deriv.me';
    else if (host.includes('.deriv.be')) oauth_host = 'oauth.deriv.be';

    const url = new URL(`https://${oauth_host}/oauth2/authorize`);
    url.searchParams.set('app_id', app_id);
    url.searchParams.set('l', 'EN');
    url.searchParams.set('brand', 'deriv');

    // Only included if explicitly overridden — otherwise Deriv uses the
    // dashboard-registered URL, which is what we want.
    if (opts.redirectUri) url.searchParams.set('redirect_uri', opts.redirectUri);

    return url.toString();
};

const legacyLogin = async (opts: LoginOptions): Promise<void> => {
    persistAffiliateTracking();
    if (opts.currency) {
        sessionStorage.setItem('query_param_currency', opts.currency);
    }
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

    // mode === 'auto' → OIDC, then legacy.
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
