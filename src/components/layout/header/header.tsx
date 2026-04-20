import { useCallback, useState } from 'react';
import clsx from 'clsx';
import { observer } from 'mobx-react-lite';
import TmAuthModal from '@/components/tm-auth/tm-auth-modal';
import PWAInstallButton from '@/components/pwa-install-button';
import { standalone_routes } from '@/components/shared';
import Button from '@/components/shared_ui/button';
import useActiveAccount from '@/hooks/api/account/useActiveAccount';
import { useOauth2 } from '@/hooks/auth/useOauth2';
import { useFirebaseCountriesConfig } from '@/hooks/firebase/useFirebaseCountriesConfig';
import { useApiBase } from '@/hooks/useApiBase';
import { useStore } from '@/hooks/useStore';
import useTMB from '@/hooks/useTMB';
import tmApi, { TMUser } from '@/utils/tm-api';
import { StandaloneCircleUserRegularIcon } from '@deriv/quill-icons/Standalone';
import { Localize, useTranslations } from '@deriv-com/translations';
import { Header, useDevice } from '@deriv-com/ui';
import { Tooltip } from '@deriv-com/ui';
import { AppLogo } from '../app-logo';
import AccountsInfoLoader from './account-info-loader';
import AccountSwitcher from './account-switcher';
import MenuItems from './menu-items';
import MobileMenu from './mobile-menu';
import PlatformSwitcher from './platform-switcher';
import './header.scss';

type TAppHeaderProps = {
    isAuthenticating?: boolean;
};

const AppHeader = observer(({ isAuthenticating }: TAppHeaderProps) => {
    const { isDesktop } = useDevice();
    const { isAuthorizing, activeLoginid } = useApiBase();
    const { client } = useStore() ?? {};

    const [tmUser, setTmUser] = useState<TMUser | null>(() => tmApi.getSavedUser());
    const [authModal, setAuthModal] = useState<'login' | 'register' | 'token' | null>(null);

    const { data: activeAccount } = useActiveAccount({ allBalanceData: client?.all_accounts_balance });
    const { accounts, getCurrency, is_virtual } = client ?? {};
    const has_wallet = Object.keys(accounts ?? {}).some(id => accounts?.[id].account_category === 'wallet');

    const currency = getCurrency?.();
    const { localize } = useTranslations();

    const { isSingleLoggingIn } = useOauth2();

    const { hubEnabledCountryList } = useFirebaseCountriesConfig();
    const { isTmbEnabled } = useTMB();
    const is_tmb_enabled = isTmbEnabled() || window.is_tmb_enabled === true;

    const renderAccountSection = useCallback(() => {
        if (isAuthenticating || isAuthorizing || (isSingleLoggingIn && !is_tmb_enabled)) {
            return <AccountsInfoLoader isLoggedIn isMobile={!isDesktop} speed={3} />;
        } else if (activeLoginid) {
            return (
                <>
                    {isDesktop &&
                        (has_wallet ? (
                            <Button
                                className='manage-funds-button'
                                has_effect
                                text={localize('Manage funds')}
                                onClick={() => {
                                    let redirect_url = new URL(standalone_routes.wallets_transfer);
                                    const is_hub_enabled_country = hubEnabledCountryList.includes(
                                        client?.residence || ''
                                    );
                                    if (is_hub_enabled_country) {
                                        redirect_url = new URL(standalone_routes.recent_transactions);
                                    }
                                    if (is_virtual) {
                                        redirect_url.searchParams.set('account', 'demo');
                                    } else if (currency) {
                                        redirect_url.searchParams.set('account', currency);
                                    }
                                    window.location.assign(redirect_url.toString());
                                }}
                                primary
                            />
                        ) : (
                            <Button
                                primary
                                onClick={() => {
                                    const redirect_url = new URL(standalone_routes.cashier_deposit);
                                    if (currency) {
                                        redirect_url.searchParams.set('account', currency);
                                    }
                                    window.location.assign(redirect_url.toString());
                                }}
                                className='deposit-button'
                            >
                                {localize('Deposit')}
                            </Button>
                        ))}

                    <AccountSwitcher activeAccount={activeAccount} />

                    {isDesktop &&
                        (() => {
                            let redirect_url = new URL(standalone_routes.personal_details);
                            const is_hub_enabled_country = hubEnabledCountryList.includes(client?.residence || '');

                            if (has_wallet && is_hub_enabled_country) {
                                redirect_url = new URL(standalone_routes.account_settings);
                            }
                            const urlParams = new URLSearchParams(window.location.search);
                            const account_param = urlParams.get('account');
                            const is_virtual = client?.is_virtual || account_param === 'demo';

                            if (is_virtual) {
                                redirect_url.searchParams.set('account', 'demo');
                            } else if (currency) {
                                redirect_url.searchParams.set('account', currency);
                            }
                            return (
                                <Tooltip
                                    as='a'
                                    href={redirect_url.toString()}
                                    tooltipContent={localize('Manage account settings')}
                                    tooltipPosition='bottom'
                                    className='app-header__account-settings'
                                >
                                    <StandaloneCircleUserRegularIcon className='app-header__profile_icon' />
                                </Tooltip>
                            );
                        })()}
                </>
            );
        } else if (tmUser) {
            return (
                <div className='auth-actions'>
                    <div className='auth-actions__tm-user'>
                        <span className='auth-actions__tm-avatar'>{tmUser.username[0].toUpperCase()}</span>
                        <span className='auth-actions__tm-name'>{tmUser.username}</span>
                    </div>
                    <Button
                        className='auth-actions__api-token'
                        onClick={() => setAuthModal('token')}
                    >
                        <Localize i18n_default_text='API Token' />
                    </Button>
                    <Button
                        className='auth-actions__logout'
                        onClick={() => { tmApi.logout(); setTmUser(null); }}
                    >
                        <Localize i18n_default_text='Log out' />
                    </Button>
                </div>
            );
        } else {
            return (
                <div className='auth-actions'>
                    <Button
                        className='auth-actions__login'
                        onClick={() => setAuthModal('login')}
                    >
                        <Localize i18n_default_text='Log in' />
                    </Button>
                    <Button
                        className='auth-actions__api-token'
                        onClick={() => setAuthModal('token')}
                    >
                        <Localize i18n_default_text='API Token' />
                    </Button>
                    <Button
                        className='auth-actions__signup'
                        onClick={() => setAuthModal('register')}
                    >
                        <Localize i18n_default_text='Sign up' />
                    </Button>
                </div>
            );
        }
    }, [
        isAuthenticating,
        isAuthorizing,
        isSingleLoggingIn,
        isDesktop,
        activeLoginid,
        standalone_routes,
        client,
        has_wallet,
        currency,
        localize,
        activeAccount,
        is_virtual,
        is_tmb_enabled,
        tmUser,
        authModal,
    ]);

    if (client?.should_hide_header) return null;

    return (
        <>
            <Header
                className={clsx('app-header', {
                    'app-header--desktop': isDesktop,
                    'app-header--mobile': !isDesktop,
                })}
            >
                {/* Top row: Logo + Auth buttons */}
                <div className='app-header__top-row'>
                    <div className='app-header__top-left'>
                        <div className='app-header__brand'>
                            <img
                                src='/trademasters-logo.png'
                                alt='TradeMasters'
                                className='app-header__brand-logo'
                            />
                            <span className='app-header__brand-name'>TRADEMASTERS</span>
                        </div>
                    </div>
                    <div className='app-header__top-right'>
                        {!isDesktop && <PWAInstallButton variant='primary' size='medium' />}
                        {renderAccountSection()}
                    </div>
                </div>

                {/* Bottom nav row */}
                {isDesktop && (
                    <div className='app-header__nav-row'>
                        <MenuItems.TradershubLink />
                        <MenuItems />
                        <PlatformSwitcher />
                    </div>
                )}
            </Header>

            {authModal && (
                <TmAuthModal
                    mode={authModal}
                    onClose={() => setAuthModal(null)}
                    onSuccess={user => { setTmUser(user); setAuthModal(null); }}
                />
            )}
        </>
    );
});

export default AppHeader;
