import { useCallback } from 'react';
import clsx from 'clsx';
import { observer } from 'mobx-react-lite';
import PWAInstallButton from '@/components/pwa-install-button';
import { standalone_routes } from '@/components/shared';
import Button from '@/components/shared_ui/button';
import useActiveAccount from '@/hooks/api/account/useActiveAccount';
import { useOauth2 } from '@/hooks/auth/useOauth2';
import { useFirebaseCountriesConfig } from '@/hooks/firebase/useFirebaseCountriesConfig';
import { useApiBase } from '@/hooks/useApiBase';
import { useStore } from '@/hooks/useStore';
import useTMB from '@/hooks/useTMB';
import { StandaloneCircleUserRegularIcon } from '@deriv/quill-icons/Standalone';
import { Localize, useTranslations } from '@deriv-com/translations';
import { Header, useDevice } from '@deriv-com/ui';
import { Tooltip } from '@deriv-com/ui';
import { AppLogo } from '../app-logo';
import AccountsInfoLoader from './account-info-loader';
import AccountSwitcher from './account-switcher';
import MenuItems from './menu-items';
import MobileMenu from './mobile-menu';
import './header.scss';

type TAppHeaderProps = {
    isAuthenticating?: boolean;
};

const AppHeader = observer(({ isAuthenticating }: TAppHeaderProps) => {
    const { isDesktop } = useDevice();
    const { isAuthorizing, activeLoginid } = useApiBase();
    const { client } = useStore() ?? {};

    const { data: activeAccount } = useActiveAccount({ allBalanceData: client?.all_accounts_balance });
    const { accounts, getCurrency, is_virtual } = client ?? {};
    const has_wallet = Object.keys(accounts ?? {}).some(id => accounts?.[id].account_category === 'wallet');

    const currency = getCurrency?.();
    const { localize } = useTranslations();

    const { isSingleLoggingIn } = useOauth2();

    const { hubEnabledCountryList } = useFirebaseCountriesConfig();
    const { isTmbEnabled } = useTMB();
    const is_tmb_enabled = isTmbEnabled() || window.is_tmb_enabled === true;

    // DIAGNOSTIC: persist header state to localStorage so we can see what's happening
    try {
        const balAccts = client?.all_accounts_balance?.accounts;
        const balKeys = balAccts ? Object.keys(balAccts) : [];
        const myBal = activeLoginid && balAccts ? balAccts[activeLoginid]?.balance : undefined;
        const dbg = {
            t: new Date().toLocaleTimeString(),
            isAuthing: isAuthorizing,
            activeLoginid: activeLoginid || '(empty)',
            activeAcct: activeAccount ? `${activeAccount.loginid}/${activeAccount.currency}/${activeAccount.balance}` : '(undef)',
            balanceLoaded: balAccts ? `YES (${balKeys.length} accts)` : 'NO',
            realBal: myBal !== undefined ? String(myBal) : '(none yet)',
            clientLoggedIn: client?.is_logged_in,
        };
        localStorage.setItem('__header_state', JSON.stringify(dbg));
    } catch (e) {}

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
        } else {
            return (
                <div className='auth-actions'>
                    <Button
                        className='auth-actions__login'
                        onClick={() => {
                            window.location.href =
                                'https://oauth.deriv.com/oauth2/authorize?app_id=116874&l=EN&brand=deriv&affiliate_token=_AmUk5tNdldlMjdsyM5hasGNd7ZgqdRLk&utm_campaign=myaffiliates';
                        }}
                    >
                        <Localize i18n_default_text='Log in' />
                    </Button>
                    <Button
                        className='auth-actions__api-token'
                        onClick={() => {
                            window.open(`${standalone_routes.deriv_app}/account/api-token`, '_blank');
                        }}
                    >
                        <Localize i18n_default_text='API Token' />
                    </Button>
                    <Button
                        className='auth-actions__signup'
                        onClick={() => {
                            window.open('https://track.deriv.com/_AmUk5tNdldlMjdsyM5hasGNd7ZgqdRLk/1/', '_blank');
                        }}
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
    ]);

    if (client?.should_hide_header) return null;

    return (
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
                    <MenuItems />
                </div>
            )}
        </Header>
    );
});

export default AppHeader;
