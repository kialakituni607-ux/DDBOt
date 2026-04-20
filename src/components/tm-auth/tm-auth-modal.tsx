import React, { useState } from 'react';
import tmApi, { TMUser } from '@/utils/tm-api';
import './tm-auth-modal.scss';

type Props = {
    mode: 'login' | 'register' | 'token';
    onClose: () => void;
    onSuccess: (user: TMUser) => void;
};

const TmAuthModal = ({ mode: initialMode, onClose, onSuccess }: Props) => {
    const [mode, setMode] = useState<'login' | 'register' | 'token'>(initialMode);
    const [email, setEmail] = useState('');
    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');
    const [derivToken, setDerivToken] = useState('');
    const [tokenName, setTokenName] = useState('My Token');
    const [error, setError] = useState('');
    const [success, setSuccess] = useState('');
    const [loading, setLoading] = useState(false);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError('');
        setSuccess('');
        setLoading(true);
        try {
            if (mode === 'login') {
                const res = await tmApi.login(email, password);
                onSuccess(res.user);
                onClose();
            } else if (mode === 'register') {
                const res = await tmApi.register(email, username, password);
                onSuccess(res.user);
                onClose();
            } else if (mode === 'token') {
                const info = await tmApi.saveDerivToken(derivToken, tokenName);
                setSuccess(`Token saved! Linked to Deriv account: ${info.loginid}`);
                setDerivToken('');
            }
        } catch (err: unknown) {
            setError(err instanceof Error ? err.message : 'Something went wrong');
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className='tm-modal-overlay' onClick={e => e.target === e.currentTarget && onClose()}>
            <div className='tm-modal'>
                <button className='tm-modal__close' onClick={onClose}>✕</button>

                <div className='tm-modal__logo'>
                    <img src='/trademasters-logo.png' alt='TradeMasters' />
                    <span>TRADEMASTERS</span>
                </div>

                {mode !== 'token' && (
                    <div className='tm-modal__tabs'>
                        <button
                            className={`tm-modal__tab ${mode === 'login' ? 'tm-modal__tab--active' : ''}`}
                            onClick={() => { setMode('login'); setError(''); }}
                        >
                            Log In
                        </button>
                        <button
                            className={`tm-modal__tab ${mode === 'register' ? 'tm-modal__tab--active' : ''}`}
                            onClick={() => { setMode('register'); setError(''); }}
                        >
                            Sign Up
                        </button>
                    </div>
                )}

                {mode === 'token' && (
                    <div className='tm-modal__section-title'>Save Deriv API Token</div>
                )}

                <form className='tm-modal__form' onSubmit={handleSubmit}>
                    {mode === 'token' ? (
                        <>
                            <div className='tm-modal__field'>
                                <label>Token Label</label>
                                <input
                                    type='text'
                                    value={tokenName}
                                    onChange={e => setTokenName(e.target.value)}
                                    placeholder='e.g. My Main Account'
                                />
                            </div>
                            <div className='tm-modal__field'>
                                <label>Deriv API Token</label>
                                <input
                                    type='password'
                                    value={derivToken}
                                    onChange={e => setDerivToken(e.target.value)}
                                    placeholder='Paste your Deriv API token here'
                                    required
                                />
                            </div>
                            <div className='tm-modal__hint'>
                                Your token is encrypted and stored securely. It is never sent to the browser in plain text.
                            </div>
                        </>
                    ) : (
                        <>
                            <div className='tm-modal__field'>
                                <label>Email</label>
                                <input
                                    type='email'
                                    value={email}
                                    onChange={e => setEmail(e.target.value)}
                                    placeholder='you@email.com'
                                    required
                                    autoComplete='email'
                                />
                            </div>
                            {mode === 'register' && (
                                <div className='tm-modal__field'>
                                    <label>Username</label>
                                    <input
                                        type='text'
                                        value={username}
                                        onChange={e => setUsername(e.target.value)}
                                        placeholder='Choose a username'
                                        required
                                        minLength={3}
                                    />
                                </div>
                            )}
                            <div className='tm-modal__field'>
                                <label>Password</label>
                                <input
                                    type='password'
                                    value={password}
                                    onChange={e => setPassword(e.target.value)}
                                    placeholder={mode === 'register' ? 'Min. 8 characters' : 'Your password'}
                                    required
                                    minLength={mode === 'register' ? 8 : 1}
                                    autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                                />
                            </div>
                        </>
                    )}

                    {error && <div className='tm-modal__error'>{error}</div>}
                    {success && <div className='tm-modal__success'>{success}</div>}

                    <button type='submit' className='tm-modal__submit' disabled={loading}>
                        {loading ? (
                            <span className='tm-modal__spinner' />
                        ) : mode === 'login' ? 'Log In' : mode === 'register' ? 'Create Account' : 'Save Token'}
                    </button>
                </form>

                {mode === 'login' && (
                    <div className='tm-modal__footer'>
                        Don't have an account?{' '}
                        <button className='tm-modal__link' onClick={() => { setMode('register'); setError(''); }}>
                            Sign up free
                        </button>
                    </div>
                )}
                {mode === 'register' && (
                    <div className='tm-modal__footer'>
                        Already have an account?{' '}
                        <button className='tm-modal__link' onClick={() => { setMode('login'); setError(''); }}>
                            Log in
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
};

export default TmAuthModal;
