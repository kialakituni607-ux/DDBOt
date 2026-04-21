import React from 'react';
import Cookies from 'js-cookie';
import ChunkLoader from '@/components/loader/chunk-loader';
import { generateDerivApiInstance } from '@/external/bot-skeleton/services/api/appId';
import { observer as globalObserver } from '@/external/bot-skeleton/utils/observer';
import { useOfflineDetection } from '@/hooks/useOfflineDetection';
import { clearAuthData } from '@/utils/auth-utils';
import tmApi from '@/utils/tm-api';
import { localize } from '@deriv-com/translations';
import { URLUtils } from '@deriv-com/utils';
import App from './App';

// Extend Window interface to include is_tmb_enabled property
declare global {
    interface Window {
        is_tmb_enabled?: boolean;
    }
}

// Synchronously persist tokens + pick the real (non-virtual) account.
// Must run at mount BEFORE any async work so api_base.init() finds authToken in localStorage.
const persistTokensSync = (loginInfo: URLUtils.LoginInfo[]) => {
    if (!loginInfo.length) return null;
    const accountsList: Record<string, string> = {};
    const clientAccounts: Record<string, { loginid: string; token: string; currency: string }> = {};
    loginInfo.forEach(acc => {
        accountsList[acc.loginid] = acc.token;
        clientAccounts[acc.loginid] = acc;
    });
    localStorage.setItem('accountsList', JSON.stringify(accountsList));
    localStorage.setItem('clientAccounts', JSON.stringify(clientAccounts));
    // Prefer first real account (non-VR/VRTC/VRW), else first entry
    const realAccount = loginInfo.find(a => !/^VR/.test(a.loginid));
    const chosen = realAccount || loginInfo[0];
    localStorage.setItem('authToken', chosen.token);
    localStorage.setItem('active_loginid', chosen.loginid);
    return chosen;
};

const setLocalStorageToken = async (
    loginInfo: URLUtils.LoginInfo[],
    paramsToDelete: string[],
    setIsAuthComplete: React.Dispatch<React.SetStateAction<boolean>>,
    isOnline: boolean
) => {
    if (loginInfo.length) {
        try {
            URLUtils.filterSearchParams(paramsToDelete);

            // Skip API refinement when offline (tokens already stored synchronously)
            if (!isOnline) {
                console.log('[Auth] Offline mode - skipping API connection');
                return;
            }

            try {
                const api = await generateDerivApiInstance();

                if (api) {
                    const { authorize, error } = await api.authorize(loginInfo[0].token);
                    api.disconnect();
                    if (error) {
                        // Check if the error is due to an invalid token
                        if (error.code === 'InvalidToken') {
                            // Set isAuthComplete to true to prevent the app from getting stuck in loading state
                            setIsAuthComplete(true);

                            const is_tmb_enabled = window.is_tmb_enabled === true;
                            // Only emit the InvalidToken event if logged_state is true
                            if (Cookies.get('logged_state') === 'true' && !is_tmb_enabled) {
                                // Emit an event that can be caught by the application to retrigger OIDC authentication
                                globalObserver.emit('InvalidToken', { error });
                            }

                            if (Cookies.get('logged_state') === 'false') {
                                // If the user is not logged out, we need to clear the local storage
                                clearAuthData();
                            }
                        }
                    } else {
                        localStorage.setItem('client.country', authorize.country);
                        // Use authorize.loginid (the account we actually authorized with) not account_list[0]
                        // which Deriv often puts as the virtual/demo account first
                        const authorizedLoginid = authorize?.loginid ?? loginInfo[0].loginid;
                        // Prefer the real (non-virtual) account: if authorized loginid is VR, fallback to first real
                        const realAccount = loginInfo.find(
                            t => !t.loginid.startsWith('VR') && !t.loginid.startsWith('VRW')
                        );
                        const chosenAccount = realAccount || loginInfo.find(t => t.loginid === authorizedLoginid) || loginInfo[0];
                        localStorage.setItem('authToken', chosenAccount.token);
                        localStorage.setItem('active_loginid', chosenAccount.loginid);
                        // Silently register/track user in TradeMasters backend (5s timeout)
                        try {
                            const timeout = new Promise<never>((_, reject) =>
                                setTimeout(() => reject(new Error('timeout')), 5000)
                            );
                            await Promise.race([tmApi.loginWithDeriv(chosenAccount.token, chosenAccount.loginid), timeout]);
                        } catch {
                            // Non-fatal — don't block auth if backend is unavailable or slow
                        }
                        return;
                    }
                }
            } catch (apiError) {
                console.error('[Auth] API connection error:', apiError);
                // Still set token in offline mode
                localStorage.setItem('authToken', loginInfo[0].token);
                localStorage.setItem('active_loginid', loginInfo[0].loginid);
            }

            localStorage.setItem('authToken', loginInfo[0].token);
            localStorage.setItem('active_loginid', loginInfo[0].loginid);
        } catch (error) {
            console.error('Error setting up login info:', error);
        }
    }
};

export const AuthWrapper = () => {
    const [isAuthComplete, setIsAuthComplete] = React.useState(false);
    // Capture URL state ONCE at mount before anything modifies it
    const initialUrlRef = React.useRef<{ href: string; search: string; hash: string }>({
        href: typeof window !== 'undefined' ? window.location.href : '',
        search: typeof window !== 'undefined' ? window.location.search : '',
        hash: typeof window !== 'undefined' ? window.location.hash : '',
    });
    // Parse login info ONCE at mount and persist tokens synchronously BEFORE any async work.
    // This guarantees api_base.init() (which reads localStorage on mount) sees the auth token.
    const parsedRef = React.useRef<{ loginInfo: URLUtils.LoginInfo[]; paramsToDelete: string[] }>(
        (() => {
            const parsed = URLUtils.getLoginInfoFromURL();
            if (parsed.loginInfo.length && typeof window !== 'undefined') {
                try {
                    persistTokensSync(parsed.loginInfo);
                } catch (e) {
                    console.error('[Auth] Sync token persist failed:', e);
                }
            }
            return parsed;
        })()
    );
    const loginInfo = parsedRef.current.loginInfo;
    const paramsToDelete = parsedRef.current.paramsToDelete;
    const { isOnline } = useOfflineDetection();

    // Persistent OAuth landing log
    React.useEffect(() => {
        try {
            const log = {
                timestamp: new Date().toISOString(),
                landedUrl: initialUrlRef.current.href,
                landedSearch: initialUrlRef.current.search,
                landedHash: initialUrlRef.current.hash,
                tokensParsedAtMount: loginInfo.length,
                accountsAtMount: loginInfo.map(a => a.loginid),
                host: typeof window !== 'undefined' ? window.location.host : '',
            };
            const history = JSON.parse(localStorage.getItem('__oauth_debug_log') || '[]');
            history.push(log);
            // Keep only last 5 entries
            localStorage.setItem('__oauth_debug_log', JSON.stringify(history.slice(-5)));
        } catch {
            // ignore
        }
    }, []);

    React.useEffect(() => {
        // Tokens are already persisted synchronously at mount (see persistTokensSync above).
        // We can complete auth IMMEDIATELY and let the API refinement run in the background.
        // This prevents "Initializing..." from hanging forever when api.authorize websocket is slow.
        URLUtils.filterSearchParams(['lang']);
        setIsAuthComplete(true);

        // Background refinement: don't await, don't block UI
        if (isOnline && loginInfo.length) {
            setLocalStorageToken(loginInfo, paramsToDelete, setIsAuthComplete, isOnline).catch(error => {
                console.error('[Auth] Background auth refinement failed (non-blocking):', error);
            });
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isOnline]); // loginInfo/paramsToDelete are stable refs, intentionally excluded to avoid re-fires

    // Add timeout for offline scenarios to prevent infinite loading
    React.useEffect(() => {
        if (!isOnline && !isAuthComplete) {
            console.log('[Auth] Offline detected, setting auth timeout');
            const timeout = setTimeout(() => {
                console.log('[Auth] Offline timeout reached, proceeding without full auth');
                setIsAuthComplete(true);
            }, 2000); // 2 second timeout for offline

            return () => clearTimeout(timeout);
        }
    }, [isOnline, isAuthComplete]);

    const getLoadingMessage = () => {
        if (!isOnline) return localize('Loading offline mode...');
        return localize('Initializing...');
    };

    // TEMP DIAGNOSTIC: visible on-screen debug to identify OAuth redirect issues
    const diagnosticBanner = (() => {
        try {
            const initialSearch = initialUrlRef.current.search || '(empty)';
            const tokens = loginInfo.length;
            const accts = loginInfo.map(a => a.loginid).join(', ') || 'none';
            return `LANDED search: ${initialSearch} | tokens: ${tokens} | accts: ${accts} | host: ${window.location.host}`;
        } catch {
            return 'diagnostic error';
        }
    })();

    const persistentLog = (() => {
        try {
            const history = JSON.parse(localStorage.getItem('__oauth_debug_log') || '[]');
            if (!history.length) return 'no history';
            return history
                .map((h: any, i: number) =>
                    `#${i + 1} [${h.timestamp?.slice(11, 19)}] host=${h.host} search=${h.landedSearch || '(empty)'} tokens=${h.tokensParsedAtMount} accts=${h.accountsAtMount?.join(',') || 'none'}`
                )
                .join('  |||  ');
        } catch {
            return 'log error';
        }
    })();

    if (!isAuthComplete) {
        return (
            <>
                <div style={{
                    position: 'fixed', top: 0, left: 0, right: 0, zIndex: 99999,
                    background: '#2A2E9B', color: '#fff', padding: '8px 12px',
                    fontSize: '11px', fontFamily: 'monospace', wordBreak: 'break-all',
                    lineHeight: 1.4,
                }}>
                    {diagnosticBanner}
                </div>
                <ChunkLoader message={getLoadingMessage()} />
            </>
        );
    }

    return (
        <>
            <div style={{
                position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 99999,
                background: '#2A2E9B', color: '#fff', padding: '6px 10px',
                fontSize: '10px', fontFamily: 'monospace', wordBreak: 'break-all',
                lineHeight: 1.3, opacity: 0.95, maxHeight: '40vh', overflow: 'auto',
            }}>
                <div><strong>NOW:</strong> {diagnosticBanner} | authToken: {(typeof window !== 'undefined' && localStorage.getItem('authToken')) ? 'YES' : 'NO'} | active_loginid: {(typeof window !== 'undefined' && localStorage.getItem('active_loginid')) || 'none'}</div>
                <div style={{ marginTop: 4, borderTop: '1px solid rgba(255,255,255,0.3)', paddingTop: 4 }}>
                    <strong>HISTORY:</strong> {persistentLog}
                </div>
            </div>
            <App />
        </>
    );
};
