import { useEffect, useRef, useState } from 'react';
import { authorizeWithPersonalToken, isPlausibleToken } from '@/utils/deriv-token-auth';
import './api-token-dialog.scss';

type Props = {
    isOpen: boolean;
    onClose: () => void;
};

const ApiTokenDialog = ({ isOpen, onClose }: Props) => {
    const [token, setToken] = useState('');
    const [showToken, setShowToken] = useState(false);
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState<string>('');
    const [success, setSuccess] = useState<string>('');
    const inputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        if (isOpen) {
            setToken('');
            setError('');
            setSuccess('');
            setShowToken(false);
            setSubmitting(false);
            setTimeout(() => inputRef.current?.focus(), 50);
        }
    }, [isOpen]);

    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if (!isOpen) return;
            if (e.key === 'Escape' && !submitting) onClose();
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [isOpen, submitting, onClose]);

    if (!isOpen) return null;

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError('');
        setSuccess('');

        const trimmed = token.trim();
        if (!trimmed) {
            setError('Please paste your Deriv API token.');
            return;
        }
        if (!isPlausibleToken(trimmed)) {
            setError('That doesn\u2019t look like a Deriv API token. Tokens are usually 15 characters.');
            return;
        }

        setSubmitting(true);
        const result = await authorizeWithPersonalToken(trimmed);

        if (!result.success) {
            setError(result.error?.message || 'Authorization failed.');
            setSubmitting(false);
            return;
        }

        setSuccess(`Logged in as ${result.loginid}${result.currency ? ` (${result.currency})` : ''}. Redirecting\u2026`);
        const account_param = result.currency || 'USD';
        setTimeout(() => {
            window.location.replace(`${window.location.origin}/bot/?account=${account_param}`);
        }, 600);
    };

    return (
        <div className='api-token-dialog__backdrop' onClick={() => !submitting && onClose()}>
            <div
                className='api-token-dialog'
                role='dialog'
                aria-modal='true'
                aria-labelledby='api-token-dialog-title'
                onClick={e => e.stopPropagation()}
            >
                <div className='api-token-dialog__header'>
                    <h2 id='api-token-dialog-title'>Sign in with API token</h2>
                    <button
                        type='button'
                        className='api-token-dialog__close'
                        aria-label='Close'
                        onClick={onClose}
                        disabled={submitting}
                    >
                        ×
                    </button>
                </div>

                <p className='api-token-dialog__hint'>
                    Don&apos;t have a token?{' '}
                    <a
                        href='https://app.deriv.com/account/api-token'
                        target='_blank'
                        rel='noreferrer'
                    >
                        Create one on Deriv
                    </a>{' '}
                    with at least <strong>Read</strong> and <strong>Trade</strong> permissions (add{' '}
                    <strong>Trading information</strong> for statements/history).
                </p>

                <form onSubmit={handleSubmit} className='api-token-dialog__form'>
                    <label className='api-token-dialog__label' htmlFor='api-token-input'>
                        API token
                    </label>
                    <div className='api-token-dialog__input-row'>
                        <input
                            id='api-token-input'
                            ref={inputRef}
                            type={showToken ? 'text' : 'password'}
                            className='api-token-dialog__input'
                            value={token}
                            onChange={e => setToken(e.target.value)}
                            placeholder='Paste your token here'
                            autoComplete='off'
                            spellCheck={false}
                            disabled={submitting}
                        />
                        <button
                            type='button'
                            className='api-token-dialog__toggle'
                            onClick={() => setShowToken(s => !s)}
                            disabled={submitting}
                            tabIndex={-1}
                        >
                            {showToken ? 'Hide' : 'Show'}
                        </button>
                    </div>

                    {error && <div className='api-token-dialog__error'>{error}</div>}
                    {success && <div className='api-token-dialog__success'>{success}</div>}

                    <div className='api-token-dialog__actions'>
                        <button
                            type='button'
                            className='api-token-dialog__btn'
                            onClick={onClose}
                            disabled={submitting}
                        >
                            Cancel
                        </button>
                        <button
                            type='submit'
                            className='api-token-dialog__btn api-token-dialog__btn--primary'
                            disabled={submitting || !token.trim()}
                        >
                            {submitting ? 'Authorizing\u2026' : 'Sign in'}
                        </button>
                    </div>

                    <p className='api-token-dialog__security'>
                        Your token is kept only for this browser tab and never stored on our servers.
                        Sign out (or close the tab) to clear it.
                    </p>
                </form>
            </div>
        </div>
    );
};

export default ApiTokenDialog;
