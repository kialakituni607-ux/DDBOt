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
    // Store token directly without WebSocket authorize
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
            const codeVerifier = sessionStorage.getItem('pkce_code_verifier');
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
                    sessionStorage.removeItem('pkce_code_verifier');
                    sessionStorage.removeItem('pkce_state');
                    // Step 2: Get accounts
                    const accountsRes = await fetch('/api/auth/accounts', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ access_token: data.access_token }),
                    });
                    const accountsData = await accountsRes.json();
                    if (!accountsRes.ok) throw new Error(accountsData.error || 'Failed to get accounts');
                    console.log('[callback] accounts:', JSON.stringify(accountsData));
                    const accounts = accountsData.data || [];
                    const realAccount = accounts.find((a) => a.account_type === 'real') || accounts[0];
                    if (!realAccount) throw new Error('No accounts found');
                    // Step 3: Get OTP
                    const otpRes = await fetch('/api/auth/otp', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ access_token: data.access_token, account_id: realAccount.account_id }),
                    });
                    const otpData = await otpRes.json();
                    if (!otpRes.ok) throw new Error(otpData.error || 'Failed to get OTP');
                    console.log('[callback] otp:', JSON.stringify(otpData));
                    const wsUrl = otpData.data && otpData.data.url;
                    if (!wsUrl) throw new Error('No WebSocket URL returned');
                    localStorage.setItem('deriv_ws_url', wsUrl);
                    localStorage.setItem('authToken', data.access_token);
                    localStorage.setItem('active_loginid', realAccount.account_id);
                    // Store ALL accounts
                    const newAccountsList: Record<string, string> = {};
                    const newClientAccounts: Record<string, any> = {};
                    let urlParams = '';
                    accounts.forEach((acc, idx) => {
                        newAccountsList[acc.account_id] = data.access_token;
                        newClientAccounts[acc.account_id] = {loginid: acc.account_id, token: data.access_token, currency: acc.currency || 'USD', balance: acc.balance || '0.00', account_type: acc.account_type || 'real', is_virtual: acc.account_type === 'demo' ? 1 : 0};
                        urlParams += '&acct' + (idx+1) + '=' + acc.account_id + '&token' + (idx+1) + '=' + data.access_token + '&cur' + (idx+1) + '=' + (acc.currency || 'USD');
                    });
                    // Store balance for each account
                    const allAccountsBalance = { accounts: {} as Record<string, any> };
                    accounts.forEach((acc) => {
                        (allAccountsBalance.accounts as Record<string, any>)[acc.account_id] = {
                            balance: parseFloat(acc.balance || '0'),
                            currency: acc.currency || 'USD',
                            converted_amount: parseFloat(acc.balance || '0'),
                            type: acc.account_type || 'real',
                        };
                    });
                    localStorage.setItem('all_accounts_balance', JSON.stringify(allAccountsBalance));
                    localStorage.setItem('all_accounts_balance', JSON.stringify(allAccountsBalance));
                    localStorage.setItem('accountsList', JSON.stringify(newAccountsList));
                    localStorage.setItem('clientAccounts', JSON.stringify(newClientAccounts));
                    const domain = window.location.hostname.split('.').slice(-2).join('.');
                    document.cookie = 'logged_state=true; path=/; domain=' + domain + '; secure; max-age=2592000';
                    localStorage.setItem('is_tmb_enabled', 'false');
                    window.location.href = '/?' + urlParams.substring(1);
                } catch(e: any) {
                    console.log('[callback] PKCE failed, falling back to legacy:', e.message);
                    window.location.href = 'https://oauth.deriv.com/oauth2/authorize?app_id=116874&brand=deriv&l=EN';
                }
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