/**
 * OAuth callback catcher
 * ----------------------
 *
 * The redirect URL we registered with Deriv for app `116874` is
 * `https://trademasters.site/` (the site root, with trailing slash).
 *
 * That means after the user authenticates on Deriv, the browser lands
 * back on `/`, NOT on `/callback`. Without this catcher the OAuth
 * tokens on the URL would be ignored and the user would just see the
 * logged-out home page.
 *
 * We run synchronously at module load (before React mounts), detect a
 * fresh OAuth response in either the query string OR the URL fragment,
 * and forward the user to `/callback?<same params>` so the existing
 * `<Callback>` handler picks up and processes the tokens.
 */

const looksLikeOAuthCallback = (search: URLSearchParams): boolean => {
    return search.has('token1') || search.has('acct1') || search.has('access_token');
};

export const catchOAuthCallback = (): void => {
    try {
        if (typeof window === 'undefined') return;

        // Only catch at the site root — `/callback` already handles itself.
        const path = window.location.pathname.replace(/\/+$/, '');
        if (path !== '' && path !== '/') return;

        // Look in the query string first.
        const search = new URLSearchParams(window.location.search);

        // If Deriv used the modern fragment-based response (e.g.
        // `#access_token=...&acct1=...`), promote those values to query
        // params so the unified handler sees them.
        if (window.location.hash && window.location.hash.length > 1) {
            const hash = new URLSearchParams(window.location.hash.slice(1));
            for (const [k, v] of hash.entries()) {
                if (!search.has(k)) search.set(k, v);
            }
        }

        if (!looksLikeOAuthCallback(search)) return;

        // Forward to /callback with the same parameters. Use `replace` so the
        // user can't hit Back into a stale OAuth response URL.
        const target = `${window.location.origin}/callback?${search.toString()}`;
        window.location.replace(target);
    } catch {
        /* never let this break app boot */
    }
};
