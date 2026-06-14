import React, { useEffect, useState } from 'react';
import './oauth-consent.scss';

type ScopeDetail = {
    scope: string;
    label: string;
    index: number;
};

type ChallengeInfo = {
    consent_challenge: string;
    client_id: string;
    client_name: string;
    scopes: ScopeDetail[];
    expires_at: string;
};

type Status = 'loading' | 'ready' | 'submitting' | 'error' | 'not_logged_in';

const OAuthConsentPage = () => {
    const [info, setInfo] = useState<ChallengeInfo | null>(null);
    const [status, setStatus] = useState<Status>('loading');
    const [errorMsg, setErrorMsg] = useState('');

    const challenge = new URLSearchParams(window.location.search).get('consent_challenge') ?? '';
    const tmToken = localStorage.getItem('tm_token') ?? sessionStorage.getItem('tm_token') ?? '';

    useEffect(() => {
        if (!challenge) {
            setStatus('error');
            setErrorMsg('Missing consent_challenge parameter.');
            return;
        }

        fetch(`/api/oauth/consent?consent_challenge=${encodeURIComponent(challenge)}`)
            .then(r => r.json())
            .then(data => {
                if (data.error) {
                    setStatus('error');
                    setErrorMsg(data.error);
                } else {
                    setInfo(data);
                    setStatus(tmToken ? 'ready' : 'not_logged_in');
                }
            })
            .catch(() => {
                setStatus('error');
                setErrorMsg('Could not reach authorization server.');
            });
    }, [challenge, tmToken]);

    const handleDecision = async (action: 'allow' | 'deny') => {
        if (!tmToken) {
            setStatus('not_logged_in');
            return;
        }
        setStatus('submitting');
        try {
            const res = await fetch('/api/oauth/consent', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${tmToken}`,
                },
                body: JSON.stringify({ consent_challenge: challenge, action }),
            });
            const data = await res.json();
            if (data.error) {
                setStatus('error');
                setErrorMsg(data.error);
            } else if (data.redirect_to) {
                window.location.href = data.redirect_to;
            }
        } catch {
            setStatus('error');
            setErrorMsg('Request failed. Please try again.');
        }
    };

    if (status === 'loading') {
        return (
            <div className='oauth-consent'>
                <div className='oauth-consent__card'>
                    <div className='oauth-consent__spinner' />
                    <p className='oauth-consent__loading-text'>Loading authorization request…</p>
                </div>
            </div>
        );
    }

    if (status === 'error') {
        return (
            <div className='oauth-consent'>
                <div className='oauth-consent__card oauth-consent__card--error'>
                    <div className='oauth-consent__error-icon'>✕</div>
                    <h2 className='oauth-consent__error-title'>Authorization Error</h2>
                    <p className='oauth-consent__error-msg'>{errorMsg}</p>
                    <button className='oauth-consent__btn oauth-consent__btn--secondary' onClick={() => (window.location.href = '/')}>
                        Back to Bot
                    </button>
                </div>
            </div>
        );
    }

    if (status === 'not_logged_in') {
        return (
            <div className='oauth-consent'>
                <div className='oauth-consent__card'>
                    <div className='oauth-consent__lock-icon'>🔒</div>
                    <h2 className='oauth-consent__title'>Sign in required</h2>
                    <p className='oauth-consent__subtitle'>
                        You need to be signed in to your TradeMasters account to authorize{' '}
                        <strong>{info?.client_name ?? 'this app'}</strong>.
                    </p>
                    <button
                        className='oauth-consent__btn oauth-consent__btn--primary'
                        onClick={() => {
                            sessionStorage.setItem('oauth_return', window.location.href);
                            window.location.href = '/';
                        }}
                    >
                        Sign in
                    </button>
                </div>
            </div>
        );
    }

    return (
        <div className='oauth-consent'>
            <div className='oauth-consent__card'>
                <div className='oauth-consent__logo'>
                    <span className='oauth-consent__logo-letter'>
                        {info?.client_name?.[0]?.toUpperCase() ?? 'A'}
                    </span>
                </div>

                <h1 className='oauth-consent__title'>
                    Authorize &ldquo;{info?.client_name}&rdquo; to access your account
                </h1>

                <p className='oauth-consent__subtitle'>
                    <strong>{info?.client_name}</strong> is requesting permission to perform the following actions on
                    your behalf:
                </p>

                <ul className='oauth-consent__scopes'>
                    {info?.scopes.map(s => (
                        <li key={s.scope} className='oauth-consent__scope-item'>
                            <span className='oauth-consent__scope-index'>{s.index}</span>
                            <span className='oauth-consent__scope-label'>{s.label}</span>
                        </li>
                    ))}
                </ul>

                <p className='oauth-consent__notice'>
                    These permissions let the app work securely without sharing your password.
                </p>

                <div className='oauth-consent__actions'>
                    <button
                        className='oauth-consent__btn oauth-consent__btn--secondary'
                        onClick={() => handleDecision('deny')}
                        disabled={status === 'submitting'}
                    >
                        Deny access
                    </button>
                    <button
                        className='oauth-consent__btn oauth-consent__btn--primary'
                        onClick={() => handleDecision('allow')}
                        disabled={status === 'submitting'}
                    >
                        {status === 'submitting' ? 'Processing…' : 'Allow access'}
                    </button>
                </div>
            </div>
        </div>
    );
};

export default OAuthConsentPage;
