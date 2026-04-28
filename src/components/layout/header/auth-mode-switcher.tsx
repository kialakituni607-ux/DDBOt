import { useEffect, useState } from 'react';
import { resolveAuthMode, setAuthMode, type AuthMode } from '@/utils/deriv-auth-adapter';
import './auth-mode-switcher.scss';

const MODES: { value: AuthMode; label: string; hint: string }[] = [
    { value: 'auto', label: 'Auto', hint: 'Try new (OIDC) first, fall back to legacy' },
    { value: 'oidc', label: 'New API', hint: 'Force the new Deriv OIDC flow' },
    { value: 'legacy', label: 'Legacy', hint: 'Force the classic oauth.deriv.com URL' },
];

const AuthModeSwitcher = () => {
    const [mode, setMode] = useState<AuthMode>('auto');

    useEffect(() => {
        setMode(resolveAuthMode());
    }, []);

    const onChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
        const next = e.target.value as AuthMode;
        setAuthMode(next);
        setMode(next);
    };

    const current = MODES.find(m => m.value === mode) ?? MODES[0];

    return (
        <label className='auth-mode-switcher' title={current.hint}>
            <span className='auth-mode-switcher__label'>Mode</span>
            <select
                className='auth-mode-switcher__select'
                value={mode}
                onChange={onChange}
                aria-label='Login mode'
            >
                {MODES.map(m => (
                    <option key={m.value} value={m.value}>
                        {m.label}
                    </option>
                ))}
            </select>
        </label>
    );
};

export default AuthModeSwitcher;
