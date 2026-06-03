import { useEffect, useRef, useState } from 'react';
import { derivLogin, resolveAuthMode, setAuthMode } from '@/utils/deriv-auth-adapter';
import { startPkceLogin } from '@/utils/pkce-auth';
import './login-picker.scss';

/**
 * Login method picker — replaces the plain "Log in" button.
 *
 * Clicking the button opens a small dropdown where the user can choose:
 *   Auto (default) → try New API (OIDC) first, fall back to Legacy
 *   Legacy         → app_id 116874, classic oauth.deriv.com redirect
 *   New API (PKCE) → OAuth 2.0 PKCE with client_id 33s7LwZCzluES8H4HmjIK
 */
const LoginPicker = () => {
    const [open, setOpen]         = useState(false);
    const [loading, setLoading]   = useState(false);
    const ref                     = useRef<HTMLDivElement>(null);
    const currentMode             = resolveAuthMode();

    useEffect(() => {
        const handler = (e: MouseEvent) => {
            if (ref.current && !ref.current.contains(e.target as Node)) {
                setOpen(false);
            }
        };
        document.addEventListener('mousedown', handler);
        return () => document.removeEventListener('mousedown', handler);
    }, []);

    const pick = async (action: () => Promise<void> | void) => {
        setOpen(false);
        setLoading(true);
        try { await action(); } finally { setLoading(false); }
    };

    const handleAuto = () => pick(() => {
        setAuthMode('auto');
        return derivLogin({ mode: 'auto' });
    });

    const handleLegacy = () => pick(() => {
        setAuthMode('legacy');
        return derivLogin({ mode: 'legacy' });
    });

    const handleNewApi = () => pick(() => startPkceLogin());

    return (
        <div className='login-picker' ref={ref}>
            <button
                className='login-picker__btn'
                onClick={() => setOpen(v => !v)}
                disabled={loading}
            >
                {loading ? 'Connecting…' : 'Log in'}
                {!loading && <span className='login-picker__arrow'>{open ? '▲' : '▼'}</span>}
            </button>

            {open && (
                <div className='login-picker__dropdown'>
                    <div className='login-picker__title'>Choose login method</div>

                    {/* Auto */}
                    <button
                        className={`login-picker__option${currentMode === 'auto' ? ' login-picker__option--active' : ''}`}
                        onClick={handleAuto}
                    >
                        <span className='login-picker__option-label'>
                            Auto
                            <span className='login-picker__badge'>Recommended</span>
                        </span>
                        <span className='login-picker__option-hint'>
                            Try New API first, fall back to Legacy automatically
                        </span>
                    </button>

                    <div className='login-picker__divider' />

                    {/* Legacy */}
                    <button
                        className={`login-picker__option${currentMode === 'legacy' ? ' login-picker__option--active' : ''}`}
                        onClick={handleLegacy}
                    >
                        <span className='login-picker__option-label'>Legacy</span>
                        <span className='login-picker__option-hint'>
                            App ID 116874 · Classic OAuth redirect
                        </span>
                    </button>

                    {/* New API (PKCE) */}
                    <button className='login-picker__option' onClick={handleNewApi}>
                        <span className='login-picker__option-label'>
                            New API
                            <span className='login-picker__badge login-picker__badge--pkce'>PKCE</span>
                        </span>
                        <span className='login-picker__option-hint'>
                            OAuth 2.0 PKCE · Client ID 33s7LwZCzluES8H4HmjIK
                        </span>
                    </button>
                </div>
            )}
        </div>
    );
};

export default LoginPicker;
