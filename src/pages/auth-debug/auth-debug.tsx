import { useEffect, useState } from 'react';
import Cookies from 'js-cookie';
import { getAppId } from '@/components/shared/utils/config/config';
import {
    buildLegacyAuthorizeURL,
    derivLogin,
    resolveAuthMode,
    setAuthMode,
    type AuthMode,
} from '@/utils/deriv-auth-adapter';
import './auth-debug.scss';

const Row = ({ label, value, mono = true }: { label: string; value: string; mono?: boolean }) => (
    <div className='auth-debug__row'>
        <div className='auth-debug__label'>{label}</div>
        <div className={`auth-debug__value ${mono ? 'auth-debug__value--mono' : ''}`}>{value}</div>
    </div>
);

const AuthDebugPage = () => {
    const [mode, setMode] = useState<AuthMode>('auto');
    const [origin, setOrigin] = useState('');
    const [host, setHost] = useState('');
    const [appId, setAppId] = useState<string | number>('');
    const [legacyUrl, setLegacyUrl] = useState('');
    const [callbackPath, setCallbackPath] = useState('');
    const [registeredHint, setRegisteredHint] = useState('');
    const [storedAuth, setStoredAuth] = useState<Record<string, string>>({});
    const [affiliateCookie, setAffiliateCookie] = useState<string>('');

    useEffect(() => {
        setMode(resolveAuthMode());
        setOrigin(window.location.origin);
        setHost(window.location.hostname);
        setAppId(getAppId());
        setLegacyUrl(buildLegacyAuthorizeURL());
        setCallbackPath(`${window.location.origin}/callback`);
        setRegisteredHint(
            window.location.hostname === 'trademasters.site' ||
                window.location.hostname === 'www.trademasters.site'
                ? 'https://trademasters.site/callback'
                : `${window.location.origin}/callback (must be added to Deriv app dashboard)`
        );
        setStoredAuth({
            authToken: localStorage.getItem('authToken') || '(none)',
            active_loginid: localStorage.getItem('active_loginid') || '(none)',
            'config.app_id': localStorage.getItem('config.app_id') || '(none)',
            'deriv.auth.mode': localStorage.getItem('deriv.auth.mode') || '(none — defaults to auto)',
            logged_state: Cookies.get('logged_state') || '(none)',
        });
        setAffiliateCookie(Cookies.get('affiliate_tracking') || '(none)');
    }, []);

    const onModeChange = (next: AuthMode) => {
        setAuthMode(next);
        setMode(next);
    };

    const onTestLegacy = () => {
        derivLogin({ mode: 'legacy' });
    };

    const onTestOidc = () => {
        derivLogin({ mode: 'oidc' });
    };

    const onClearAuth = () => {
        ['authToken', 'active_loginid', 'accountsList', 'clientAccounts', 'callback_token'].forEach(k =>
            localStorage.removeItem(k)
        );
        Cookies.remove('logged_state');
        window.location.reload();
    };

    return (
        <div className='auth-debug'>
            <h1 className='auth-debug__title'>Deriv Auth Diagnostics</h1>
            <p className='auth-debug__sub'>
                Use this page on the live site to verify exactly which app_id, redirect URL and OAuth URL your
                browser will send to Deriv. If any value here is wrong, login won&apos;t redirect back.
            </p>

            <section className='auth-debug__section'>
                <h2>Environment</h2>
                <Row label='Hostname' value={host} />
                <Row label='Origin' value={origin} />
                <Row label='Resolved app_id' value={String(appId)} />
                <Row
                    label='Expected redirect URL'
                    value={callbackPath}
                />
                <Row
                    label='Must be REGISTERED on Deriv dashboard as'
                    value={registeredHint}
                    mono={false}
                />
            </section>

            <section className='auth-debug__section'>
                <h2>Current auth mode</h2>
                <div className='auth-debug__modes'>
                    {(['auto', 'oidc', 'legacy'] as AuthMode[]).map(m => (
                        <label key={m} className={`auth-debug__mode ${mode === m ? 'is-active' : ''}`}>
                            <input
                                type='radio'
                                name='auth-mode'
                                value={m}
                                checked={mode === m}
                                onChange={() => onModeChange(m)}
                            />
                            <span>{m === 'auto' ? 'Auto (try OIDC, fall back to legacy)' : m.toUpperCase()}</span>
                        </label>
                    ))}
                </div>
            </section>

            <section className='auth-debug__section'>
                <h2>Exact URLs that will be sent</h2>
                <Row label='Legacy /oauth2/authorize URL' value={legacyUrl} />
                <p className='auth-debug__note'>
                    OIDC URL is built by <code>@deriv-com/auth-client</code> with PKCE, so it&apos;s only visible
                    in the address bar after clicking &quot;Test OIDC&quot; below.
                </p>
            </section>

            <section className='auth-debug__section'>
                <h2>One-click tests</h2>
                <div className='auth-debug__buttons'>
                    <button className='auth-debug__btn auth-debug__btn--primary' onClick={onTestLegacy}>
                        Test Legacy login
                    </button>
                    <button className='auth-debug__btn auth-debug__btn--primary' onClick={onTestOidc}>
                        Test OIDC login
                    </button>
                    <button className='auth-debug__btn' onClick={onClearAuth}>
                        Clear local auth + reload
                    </button>
                </div>
                <p className='auth-debug__note'>
                    Each button hits Deriv with that exact adapter. Successful flow ends back here at{' '}
                    <code>/callback</code> with <code>?token1=...&amp;acct1=...</code> in the URL. If you instead
                    end up on <code>app.deriv.com</code>, your Deriv app dashboard&apos;s &quot;Redirect URL&quot;
                    doesn&apos;t match the URL above, OR no scopes are selected on the app.
                </p>
            </section>

            <section className='auth-debug__section'>
                <h2>Stored locally</h2>
                {Object.entries(storedAuth).map(([k, v]) => (
                    <Row key={k} label={k} value={v} />
                ))}
                <Row label='Cookie: affiliate_tracking' value={affiliateCookie} />
            </section>

            <section className='auth-debug__section auth-debug__section--checklist'>
                <h2>If login still bounces to app.deriv.com instead of /callback</h2>
                <ol>
                    <li>
                        Open <a href='https://legacy-api.deriv.com/dashboard/' target='_blank' rel='noreferrer'>
                            legacy-api.deriv.com/dashboard
                        </a>{' '}
                        → click your app (id <strong>{String(appId)}</strong>).
                    </li>
                    <li>
                        Confirm <strong>Redirect URL</strong> is exactly <code>{callbackPath}</code> (no trailing
                        slash, no www, no spaces). Click <strong>Update</strong>.
                    </li>
                    <li>
                        Scroll to <strong>Scopes of authorisation</strong>. Tick at minimum <strong>Read</strong>{' '}
                        and <strong>Trade</strong>. Without scopes, Deriv silently drops the redirect.
                    </li>
                    <li>
                        Open a private/incognito window and click &quot;Test Legacy login&quot; above. (Existing
                        Deriv sessions in the same browser can short-circuit the flow.)
                    </li>
                </ol>
            </section>
        </div>
    );
};

export default AuthDebugPage;
