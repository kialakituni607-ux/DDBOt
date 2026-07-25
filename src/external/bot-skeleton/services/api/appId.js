import { getAppId, getSocketURL } from '@/components/shared';
import { website_name } from '@/utils/site-config';
import DerivAPIBasic from '@deriv/deriv-api/dist/DerivAPIBasic';
import { getInitialLanguage } from '@deriv-com/translations';
import APIMiddleware from './api-middleware';

export const generateDerivApiInstance = async () => {
    const authToken = localStorage.getItem('authToken');
    let socket_url;

    // Per Deriv's new API: Bearer/OAuth2 (PKCE) users must trade over the WebSocket
    // URL returned by POST /trading/v1/options/accounts/{accountId}/otp — always
    // freshly requested (OTP URLs are short-lived), never hard-coded or reused from
    // a previous session.
    if (authToken && authToken.startsWith('ory_at_')) {
        const active_loginid = localStorage.getItem('active_loginid');
        try {
            const otpRes = await fetch('/api/auth/otp', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ access_token: authToken, account_id: active_loginid }),
            });
            const otpData = await otpRes.json();
            const otpWsUrl = otpData?.data?.url;
            if (otpWsUrl) {
                localStorage.setItem('deriv_ws_url', otpWsUrl);
                socket_url = otpWsUrl;
                console.log('[api-base] Using fresh OTP trading WebSocket URL');
            } else {
                console.error('[api-base] No OTP url returned from /api/auth/otp:', otpData);
            }
        } catch (e) {
            console.error('[api-base] Failed to obtain OTP trading URL:', e);
        }
    }

    if (!socket_url) {
        const cleanedServer = getSocketURL().replace(/[^a-zA-Z0-9.]/g, '');
        const cleanedAppId = getAppId()?.replace?.(/[^a-zA-Z0-9]/g, '') ?? getAppId();
        socket_url = `wss://${cleanedServer}/websockets/v3?app_id=${cleanedAppId}&l=${getInitialLanguage()}&brand=${website_name.toLowerCase()}`;
    }

    const deriv_socket = new WebSocket(socket_url);
    const deriv_api = new DerivAPIBasic({
        connection: deriv_socket,
        middleware: new APIMiddleware({}),
    });
    return deriv_api;
};

export const getLoginId = () => {
    const login_id = localStorage.getItem('active_loginid');
    if (login_id && login_id !== 'null') return login_id;
    return null;
};

export const V2GetActiveToken = () => {
    const token = localStorage.getItem('authToken');
    if (token && token !== 'null') return token;
    return null;
};

export const V2GetActiveClientId = () => {
    const token = V2GetActiveToken();
    if (!token) return null;
    const account_list = JSON.parse(localStorage.getItem('accountsList'));
    if (account_list && account_list !== 'null') {
        const active_clientId = Object.keys(account_list).find(key => account_list[key] === token);
        return active_clientId;
    }
    return null;
};

export const getToken = () => {
    const active_loginid = getLoginId();
    const client_accounts = JSON.parse(localStorage.getItem('accountsList')) ?? undefined;
    const active_account = (client_accounts && client_accounts[active_loginid]) || {};
    return {
        token: active_account ?? undefined,
        account_id: active_loginid ?? undefined,
    };
};
