import React, { useEffect, useRef, useState } from 'react';
import Cookies from 'js-cookie';
import { DERIV_REDIRECT_URI } from '@/utils/deriv-auth-adapter';
import { generateDerivApiInstance } from '@/external/bot-skeleton/services/api/appId';

const processTokensAndRedirect = async (tokens: Record<string, string>): Promise<void> => {
    const accountsList: Record<string, string> = {};
    const clientAccounts: Record<string, { loginid: string; token: string; currency: string }> = {};
    for (const [key, value] of Object.entries(tokens)) {
        if (key.startsWith('acct')) {
            const tokenKey = key.replace('acct', 'token');
            if (tokens[tokenKey]) {
                accountsList[value] = tokens[tokenKey];
                clientAccounts[value] = { loginid: value, token: tokens[tokenKey], currency: '' };
            }
        } else if (key.startsWith('cur')) {
            const accKey = key.replace('cur', 'acct');
            if (tokens[accKey] && clientAccounts[tokens[accKey]]) {
                clientAccounts[tokens[accKey]].currency = value;
            }
        }
    }
    localStorage.setItem('accountsList', JSON.stringify(accountsList));
    localStorage.setItem('clientAccounts', JSON.stringify(clientAccounts));
    const api = await generateDerivApiInstance();
    if (api) {
        const { authorize, error } = await api.authorize(tokens.token1);
        api.disconnect();
        if (!error && authorize) {
            const firstId = authorize?.account_list[0]?.loginid;
            const filtered = Object.values(clientAccounts).filter(a => a.loginid === firstId);
            if (filtered.length) {
                localStorage.setItem('authToken', filtered[0].token);
                localStorage.setItem('active_loginid', filtered[0].loginid);
            }
        }
    }
    if (!localStorage.getItem('authToken') && tokens.token1) {
        localStorage.setItem('authToken', tokens.token1);
        localStorage.setItem('active_loginid', tokens.acct1);
    }
    const domain = window.location.hostname.split('.').slice(-2).join('.');
    Cookies.set('logged_state', 'true', { expires: 30, path: '/', domain, secure: true });
    window.location.href = '/';
};

const CallbackPage = () => {
    const [error, setError] = useState('');
    const handled = useRef(false);
    useEffect(() => {
        if (handled.current) return;
        handled.current = true;
        const params = new URLSearchParams(window.location.search);
        const code = params.get('code');
        const acct1 = params.get('acct1');
        const token1 = params.get('token1');
        if (acct1 && token1) {
            const tokens: Record<string, string> = {};
            for (const [k, v] of params.entries()) tokens[k] = v;
            processTokensAndRedirect(tokens).catch(e => setError(e.message));
            return;
        }
        if (code) {
            const codeVerifier = localStorage.getItem('pkce_code_verifier');
            if (!codeVerifier) { setError('Missing code verifier'); return; }
            (async () => {
                try {
                    const res = await fetch('/api/auth/pkce-exchange', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ code, code_verifier: codeVerifier, redirect_uri: DERIV_REDIRECT_URI }),
                    });
                    const data = await res.json();
                    if (!res.ok) throw new Error(data.error || 'Token exchange failed');
                    localStorage.removeItem('pkce_code_verifier');
                    localStorage.removeItem('pkce_state');
                    const userinfoRes = await fetch('/api/auth/legacy-tokens', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ access_token: data.access_token }),
                    });
                    if (!userinfoRes.ok) throw new Error(legacyData.error || 'Failed to get tokens');
                    const userinfo = await userinfoRes.json();
                    console.log('[callback] userinfo:', userinfo);
                    const tokens: Record<string, string> = {
                        acct1: userinfo.sub || '',
                        token1: data.access_token,
                        cur1: userinfo.currency || 'USD',
                    };
                    await processTokensAndRedirect(tokens);
                } catch(e: any) { setError(e.message || 'Authentication failed'); }
            })();
            return;
        }
        setError('No authentication data received');
    }, []);
    if (error) return (
        <div style={{display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',height:'100vh'}}>
            <h2>Authentication Error</h2>
            <p style={{color:'red'}}>{error}</p>
            <button onClick={() => window.location.href = '/'}>Return to Bot</button>
        </div>
    );
    return <div style={{display:'flex',alignItems:'center',justifyContent:'center',height:'100vh'}}><p>Logging in...</p></div>;
};

export default CallbackPage;