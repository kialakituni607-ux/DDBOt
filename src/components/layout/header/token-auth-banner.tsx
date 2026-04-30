import { useEffect, useState } from 'react';
import { getAuthMethod } from '@/utils/deriv-token-auth';
import './token-auth-banner.scss';

export const OPEN_API_TOKEN_DIALOG_EVENT = 'trademasters:open-api-token-dialog';

/**
 * Small banner displayed at the top of the account-switcher dropdown when
 * the current session was authenticated with a personal API token rather
 * than OAuth. Lets the user clearly see how they're signed in and gives
 * them a one-click "Replace token" action.
 */
const TokenAuthBanner = () => {
    const [method, setMethod] = useState(getAuthMethod());

    useEffect(() => {
        // Re-read the auth method whenever the window regains focus or the
        // storage event fires — that way the banner stays in sync with any
        // token changes happening in this or a sibling tab.
        const sync = () => setMethod(getAuthMethod());
        window.addEventListener('focus', sync);
        window.addEventListener('storage', sync);
        return () => {
            window.removeEventListener('focus', sync);
            window.removeEventListener('storage', sync);
        };
    }, []);

    if (method !== 'token') return null;

    return (
        <div className='token-auth-banner' role='status'>
            <div className='token-auth-banner__row'>
                <span className='token-auth-banner__icon' aria-hidden='true'>
                    🔑
                </span>
                <div className='token-auth-banner__text'>
                    <strong>Signed in via API token</strong>
                    <span>Token lives only in this tab. Sign out below to clear it.</span>
                </div>
            </div>
            <button
                type='button'
                className='token-auth-banner__action'
                onClick={() => {
                    window.dispatchEvent(new Event(OPEN_API_TOKEN_DIALOG_EVENT));
                }}
            >
                Replace token
            </button>
        </div>
    );
};

export default TokenAuthBanner;
