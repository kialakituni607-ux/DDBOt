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

const setLocalStorageToken = async (
    loginInfo: URLUtils.LoginInfo[],
    paramsToDelete: string[],
    setIsAuthComplete: React.Dispatch<React.SetStateAction<boolean>>,
    isOnline: boolean
) => {
    if (loginInfo.length) {
        try {
            const defaultActiveAccount = URLUtils.getDefaultActiveAccount(loginInfo);
            if (!defaultActiveAccount) return;

            const accountsList: Record<string, string> = {};
            const clientAccounts: Record<string, { loginid: string; token: string; currency: string }> = {};

            loginInfo.forEach((account: { loginid: string; token: string; currency: string }) => {
                accountsList[account.loginid] = account.token;
                clientAccounts[account.loginid] = account;
            });

            localStorage.setItem('accountsList', JSON.stringify(accountsList));
            localStorage.setItem('clientAccounts', JSON.stringify(clientAccounts));

            URLUtils.filterSearchParams(paramsToDelete);

            // Skip API connection when offline
            if (!isOnline) {
                console.log('[Auth] Offline mode - skipping API connection');
                localStorage.setItem('authToken', loginInfo[0].token);
                localStorage.setItem('active_loginid', loginInfo[0].loginid);
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
    const { loginInfo, paramsToDelete } = URLUtils.getLoginInfoFromURL();
    const { isOnline } = useOfflineDetection();

    React.useEffect(() => {
        const initializeAuth = async () => {
            try {
                // Pass isOnline to setLocalStorageToken to handle offline mode properly
                await setLocalStorageToken(loginInfo, paramsToDelete, setIsAuthComplete, isOnline);
                URLUtils.filterSearchParams(['lang']);
                setIsAuthComplete(true);
            } catch (error) {
                console.error('[Auth] Authentication initialization failed:', error);
                // Don't block the app if auth fails, especially when offline
                setIsAuthComplete(true);
            }
        };

        // If offline, set auth complete immediately but still run initializeAuth
        // to save login info to localStorage for offline use
        if (!isOnline) {
            console.log('[Auth] Offline detected, proceeding with minimal auth');
            setIsAuthComplete(true);
        }

        initializeAuth();
    }, [loginInfo, paramsToDelete, isOnline]);

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
            const url = new URL(window.location.href);
            const search = url.search || '(empty)';
            const tokens = loginInfo.length;
            const accts = loginInfo.map(a => a.loginid).join(', ') || 'none';
            return `URL search: ${search} | tokens parsed: ${tokens} | accounts: ${accts} | host: ${url.host}`;
        } catch {
            return 'diagnostic error';
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
                lineHeight: 1.3, opacity: 0.92,
            }}>
                DEBUG: {diagnosticBanner} | authToken: {(typeof window !== 'undefined' && localStorage.getItem('authToken')) ? 'YES' : 'NO'} | active_loginid: {(typeof window !== 'undefined' && localStorage.getItem('active_loginid')) || 'none'}
            </div>
            <App />
        </>
    );
};
