---
name: Legacy OAuth Callback Behavior
description: How the @deriv-com/auth-client Callback component behaves with legacy token OAuth vs OIDC, and the fix pattern for trademasters.site
---

## The Problem

`@deriv-com/auth-client`'s `<Callback>` component **only handles OIDC `?code=`** flows:
- Checks `URLSearchParams.get("code")` on mount
- If no `?code=`, immediately sets OIDCError("OneTimeCodeMissing") and shows error UI
- `onSignInSuccess` is NEVER called for legacy `?token1=xxx&acct1=xxx&cur1=xxx` redirects

Additionally, `AuthWrapper.tsx` calls `URLUtils.filterSearchParams(paramsToDelete)` synchronously (before first `await` inside `setLocalStorageToken`), which removes all legacy token params from the URL BEFORE `<CallbackPage>` ever renders. So `<Callback>` would not even see `?token1=` even if it tried.

## The Fix

**callback-page.tsx** now:
1. Checks `hasOidcCode = URLSearchParams.has('code')` on mount (via `useMemo`)
2. **If no `?code=` (legacy OAuth path):**
   - `AuthWrapper.tsx`'s `persistTokensSync` has already saved `authToken` and `active_loginid` to localStorage synchronously before this component rendered
   - Read `authToken` + `active_loginid` from localStorage
   - Set `logged_state=true` cookie (Callback.js only sets it for Deriv domains, never for trademasters.site)
   - Redirect to `/?account=<currency>` (NOT `/bot/` — `/bot/` has no React Router route)
3. **If `?code=` present (OIDC path):** render `<Callback>` normally

## Key Rules

- **Redirect target must be `/` not `/bot/`**: `/bot/` has no React Router route, so `AppRoot` never mounts and `api_base.init()` never runs → user stays logged out
- **`logged_state=true` must be set manually** for legacy OAuth: `<Callback>` sets it only for `.deriv.com`, `.deriv.dev`, etc. — not for `trademasters.site`
- **`useTMB()` cannot be called inside async callbacks**: it's a React hook. Use `window.is_tmb_enabled === true` instead

## Why AuthWrapper.tsx's persistTokensSync Works

`AuthWrapper.tsx` uses `React.useRef` with an IIFE that runs synchronously at mount time:
```js
const parsedRef = React.useRef((() => {
    const parsed = URLUtils.getLoginInfoFromURL(); // reads ?token1=xxx from URL
    if (parsed.loginInfo.length) persistTokensSync(parsed.loginInfo); // saves to localStorage
    return parsed;
})());
```
This runs BEFORE the first render, so by the time any child component's `useEffect` fires, tokens are already in localStorage.
