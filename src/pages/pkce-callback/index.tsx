import React, { useEffect, useState } from 'react';
import { detectPkceCallback, exchangePkceCode, clearPkceStorage } from '@/utils/pkce-auth';

/**
 * PKCE callback page — handles the redirect back from Deriv after
 * the New API (PKCE OAuth 2.0) login flow.
 *
 * This page is loaded when oauth-callback-catcher detects ?code= in the
 * URL and the pkce.flow flag is set in sessionStorage.  It exchanges the
 * authorization code for an access token via the backend, stores it, and
 * redirects to the app.
 */
const PkceCallback: React.FC = () => {
    const [status, setStatus] = useState<'loading' | 'success' | 'error'>('loading');
    const [error, setError]   = useState('');

    useEffect(() => {
        (async () => {
            const cb = detectPkceCallback();
            if (!cb) {
                setError('No PKCE session found. The link may have expired.');
                setStatus('error');
                return;
            }

            try {
                const data = await exchangePkceCode(cb.code, cb.verifier);
                clearPkceStorage();

                // Store however we can — the token response shape differs
                // between Deriv endpoints.  Handle both:
                //   a) Standard PKCE: { access_token, ... }
                //   b) Deriv legacy-compat: { acct1, token1, ... }
                if (data.acct1 && data.token1) {
                    // Legacy-compatible shape — feed into the standard flow
                    const accountsList: Record<string, string>  = {};
                    const clientAccounts: Record<string, any>   = {};

                    for (const [k, v] of Object.entries(data)) {
                        if (k.startsWith('acct')) {
                            const tKey = k.replace('acct', 'token');
                            if (data[tKey]) {
                                accountsList[v as string] = data[tKey];
                                clientAccounts[v as string] = {
                                    loginid : v,
                                    token   : data[tKey],
                                    currency: '',
                                };
                            }
                        } else if (k.startsWith('cur')) {
                            const aKey = k.replace('cur', 'acct');
                            if (data[aKey] && clientAccounts[data[aKey]]) {
                                clientAccounts[data[aKey]].currency = v;
                            }
                        }
                    }

                    localStorage.setItem('accountsList',   JSON.stringify(accountsList));
                    localStorage.setItem('clientAccounts', JSON.stringify(clientAccounts));
                    localStorage.setItem('authToken',      data.token1);
                    localStorage.setItem('active_loginid', data.acct1);
                } else if (data.access_token) {
                    // Standard PKCE bearer token — store it
                    localStorage.setItem('authToken',      data.access_token);
                    localStorage.setItem('deriv.auth_method', 'pkce');
                }

                setStatus('success');
                // Remove ?code & ?state from URL then redirect to app
                setTimeout(() => {
                    window.location.replace(`${window.location.origin}/`);
                }, 800);
            } catch (err: any) {
                clearPkceStorage();
                setError(err?.message || 'Unknown error during token exchange');
                setStatus('error');
            }
        })();
    }, []);

    return (
        <div style={{
            display       : 'flex',
            flexDirection : 'column',
            alignItems    : 'center',
            justifyContent: 'center',
            height        : '100vh',
            background    : '#0B1220',
            color         : '#fff',
            fontFamily    : 'Inter, sans-serif',
            gap           : '16px',
        }}>
            {status === 'loading' && (
                <>
                    <div style={{
                        width : '40px', height: '40px',
                        border: '3px solid #1E293B',
                        borderTopColor: '#00C389',
                        borderRadius: '50%',
                        animation: 'spin 0.8s linear infinite',
                    }} />
                    <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
                    <p style={{ color: '#9CA3AF', fontSize: '14px', margin: 0 }}>
                        Completing sign-in with New API…
                    </p>
                </>
            )}

            {status === 'success' && (
                <>
                    <div style={{ fontSize: '40px' }}>✅</div>
                    <p style={{ color: '#00C389', fontWeight: 600, margin: 0 }}>Signed in successfully!</p>
                    <p style={{ color: '#9CA3AF', fontSize: '13px', margin: 0 }}>Redirecting…</p>
                </>
            )}

            {status === 'error' && (
                <>
                    <div style={{ fontSize: '36px' }}>❌</div>
                    <p style={{ color: '#FF444F', fontWeight: 600, margin: 0 }}>Sign-in failed</p>
                    <p style={{ color: '#9CA3AF', fontSize: '13px', maxWidth: '400px', textAlign: 'center' }}>{error}</p>
                    <button
                        onClick={() => window.location.replace('/')}
                        style={{
                            marginTop  : '8px',
                            padding    : '10px 24px',
                            background : '#00C389',
                            border     : 'none',
                            borderRadius: '20px',
                            color      : '#fff',
                            fontWeight : 600,
                            cursor     : 'pointer',
                        }}
                    >
                        Back to Home
                    </button>
                </>
            )}
        </div>
    );
};

export default PkceCallback;
