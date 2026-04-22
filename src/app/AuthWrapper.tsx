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
                        // Silently register/track user in TradeMasters backend (60s timeout — allows for cold start)
                        try {
                            const timeout = new Promise<never>((_, reject) =>
                                setTimeout(() => reject(new Error('timeout')), 60000)
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

    if (!isAuthComplete) {
        return <ChunkLoader message={getLoadingMessage()} />;
    }

    return <App />;
};
