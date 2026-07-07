import Cookies from 'js-cookie';
import CommonStore from '@/stores/common-store';
import { TAuthData } from '@/types/api-types';
import { clearAuthData } from '@/utils/auth-utils';
import { observer as globalObserver } from '../../utils/observer';
import { doUntilDone, socket_state } from '../tradeEngine/utils/helpers';
import {
    CONNECTION_STATUS,
    setAccountList,
    setAuthData,
    setConnectionStatus,
    setIsAuthorized,
    setIsAuthorizing,
} from './observables/connection-status-stream';
import ApiHelpers from './api-helpers';
import { generateDerivApiInstance, V2GetActiveClientId, V2GetActiveToken } from './appId';
import chart_api from './chart-api';

type CurrentSubscription = {
    id: string;
    unsubscribe: () => void;
};

type SubscriptionPromise = Promise<{
    subscription: CurrentSubscription;
}>;

type TApiBaseApi = {
    connection: {
        readyState: keyof typeof socket_state;
        addEventListener: (event: string, callback: () => void) => void;
        removeEventListener: (event: string, callback: () => void) => void;
    };
    send: (data: unknown) => void;
    disconnect: () => void;
    authorize: (token: string) => Promise<{ authorize: TAuthData; error: unknown }>;
    getSelfExclusion: () => Promise<unknown>;
    onMessage: () => {
        subscribe: (callback: (message: unknown) => void) => {
            unsubscribe: () => void;
        };
    };
} & ReturnType<typeof generateDerivApiInstance>;

class APIBase {
    api: TApiBaseApi | null = null;
    token: string = '';
    account_id: string = '';
    pip_sizes = {};
    account_info = {};
    is_running = false;
    subscriptions: CurrentSubscription[] = [];
    time_interval: ReturnType<typeof setInterval> | null = null;
    has_active_symbols = false;
    is_stopping = false;
    active_symbols = [];
    current_auth_subscriptions: SubscriptionPromise[] = [];
    is_authorized = false;
    active_symbols_promise: Promise<void> | null = null;
    common_store: CommonStore | undefined;
    landing_company: string | null = null;

    unsubscribeAllSubscriptions = () => {
        this.current_auth_subscriptions?.forEach(subscription_promise => {
            subscription_promise.then(({ subscription }) => {
                if (subscription?.id) {
                    this.api?.send({
                        forget: subscription.id,
                    });
                }
            });
        });
        this.current_auth_subscriptions = [];
    };

    onsocketopen() {
        setConnectionStatus(CONNECTION_STATUS.OPENED);
    }

    onsocketclose() {
        setConnectionStatus(CONNECTION_STATUS.CLOSED);
        this.reconnectIfNotConnected();
    }

    async init(force_create_connection = false) {
        console.log('[api-base] init() called');
        this.toggleRunButton(true);
        const is_otp_reinit = localStorage.getItem('use_otp_ws') === 'true';
        const had_symbols = is_otp_reinit && (this.has_active_symbols || (this.active_symbols && this.active_symbols.length > 0));
        const preserved_symbols = had_symbols ? [...(this.active_symbols || [])] : [];
        const preserved_pip_sizes = had_symbols ? { ...(this.pip_sizes || {}) } : {};

        if (this.api) {
            this.unsubscribeAllSubscriptions();
        }

        if (!this.api || this.api?.connection.readyState !== 1 || force_create_connection) {
            if (this.api?.connection) {
                if (!is_otp_reinit) ApiHelpers.disposeInstance();
                setConnectionStatus(CONNECTION_STATUS.CLOSED);
                this.api.disconnect();
                this.api.connection.removeEventListener('open', this.onsocketopen.bind(this));
                this.api.connection.removeEventListener('close', this.onsocketclose.bind(this));
            }

            this.api = await generateDerivApiInstance();
        console.log('[api-base] WebSocket created, readyState:', this.api?.connection?.readyState);
            this.api?.connection.addEventListener('open', this.onsocketopen.bind(this));
            this.api?.connection.addEventListener('close', this.onsocketclose.bind(this));

            // Pipe every WS message through globalObserver so the UI can listen
            // independently of React effect timing. This guarantees balance/transaction
            // updates reach the client store regardless of subscription ordering.
            try {
                this.api?.onMessage().subscribe((res: { data?: { msg_type?: string; balance?: unknown; error?: unknown } }) => {
                    const data = res?.data;
                    if (!data) return;
                    if (data.msg_type === 'balance' && !data.error) {
                        globalObserver.emit('balance.update', data.balance);
                        try {
                            const incoming = data.balance as { accounts?: Record<string, unknown>; loginid?: string; balance?: number };
                            const stored = JSON.parse(localStorage.getItem('all_accounts_balance') || '{}');
                            if (incoming?.accounts) {
                                localStorage.setItem('all_accounts_balance', JSON.stringify({ ...incoming, _ts: Date.now() }));
                            } else if (incoming?.loginid && stored?.accounts) {
                                stored.accounts[incoming.loginid] = {
                                    ...stored.accounts[incoming.loginid],
                                    balance: incoming.balance,
                                };
                                localStorage.setItem('all_accounts_balance', JSON.stringify({ ...stored, _ts: Date.now() }));
                            }
                        } catch (e) {
                            console.error('[api-base] failed to persist live balance update:', e);
                        }
                    }
                });
            } catch (e) {
                console.error('[api-base] failed to attach global onMessage pipe:', e);
            }
        }

        console.log('[api-base] about to fetch active_symbols');
        if (had_symbols) {
            this.has_active_symbols = true;
            this.active_symbols = preserved_symbols;
            this.pip_sizes = preserved_pip_sizes;
            console.log('[api-base] preserved active_symbols for OTP reinit');
        } else if (!this.has_active_symbols) {
            this.active_symbols_promise = this.getActiveSymbols();
        }

        this.initEventListeners();

        if (this.time_interval) clearInterval(this.time_interval);
        this.time_interval = null;

        if (V2GetActiveToken()) {
            // Hydrate observables from localStorage IMMEDIATELY so the header can
            // render real account info without waiting for the WS authorize round-trip.
            const hydrated = this.hydrateFromLocalStorage();
            // Only show "authorizing" skeleton if we have NO cached data to render.
            // When we have cached data, let the WS auth happen silently in the background.
            if (!hydrated) {
                setIsAuthorizing(true);
            }
            // Don't await — authorize runs in the background.
            this.authorizeAndSubscribe();
        }

        chart_api.init(force_create_connection);
    }

    hydrateFromLocalStorage(): boolean {
        try {
            const cachedActiveLoginid = localStorage.getItem('active_loginid') || '';
            const cachedClientAccountsRaw = localStorage.getItem('clientAccounts') || '{}';
            const cachedClientAccounts = JSON.parse(cachedClientAccountsRaw) as Record<
                string,
                { loginid: string; token: string; currency: string }
            >;
            const entries = Object.values(cachedClientAccounts);
            if (!cachedActiveLoginid || entries.length === 0) return false;

            const cached_account_list = entries.map(info => ({
                loginid: info.loginid,
                currency: info.currency,
                is_virtual: /^VR/.test(info.loginid) ? 1 : 0,
                is_disabled: 0,
                landing_company_name: /^VR/.test(info.loginid) ? 'virtual' : 'svg',
                trading: {},
            })) as unknown as TAuthData['account_list'];

            setAccountList(cached_account_list);
            setAuthData({
                loginid: cachedActiveLoginid,
                account_list: cached_account_list,
            } as unknown as TAuthData);
            return true;
        } catch (e) {
            console.error('[api-base] hydrateFromLocalStorage failed:', e);
            return false;
        }
    }

    getConnectionStatus() {
        if (this.api?.connection) {
            const ready_state = this.api.connection.readyState;
            return socket_state[ready_state as keyof typeof socket_state] || 'Unknown';
        }
        return 'Socket not initialized';
    }

    terminate() {
        // eslint-disable-next-line no-console
        if (this.api) this.api.disconnect();
    }

    initEventListeners() {
        if (window) {
            window.addEventListener('online', this.reconnectIfNotConnected);
            window.addEventListener('focus', this.reconnectIfNotConnected);
        }
    }

    async createNewInstance(account_id: string) {
        if (this.account_id !== account_id) {
            await this.init();
        }
    }

    reconnectIfNotConnected = () => {
        // eslint-disable-next-line no-console
        console.log('connection state: ', this.api?.connection?.readyState);
        if (this.api?.connection?.readyState && this.api?.connection?.readyState > 1) {
            // eslint-disable-next-line no-console
            console.log('Info: Connection to the server was closed, trying to reconnect.');
            this.init(true);
        }
    };

    async authorizeAndSubscribe() {
        const token = V2GetActiveToken();
        if (!token || !this.api) return;
        this.token = token;
        // NOTE: V2GetActiveClientId() is unreliable for OAuth2/Bearer users, since a single
        // access token can map to multiple accounts in 'accountsList' (all sharing the same token
        // value) — it always resolves to whichever account key happens to come first, regardless
        // of which account is actually selected. Use 'active_loginid' directly instead, which is
        // correctly maintained by every account-switch handler in the app.
        this.account_id = localStorage.getItem('active_loginid') || V2GetActiveClientId() || '';
        setIsAuthorized(false);
        // Hard fallback: even if the WebSocket never responds, flip isAuthorizing
        // to false after 4 seconds so the header doesn't stay stuck on the skeleton.
        const authorizingTimeout = setTimeout(() => {
            setIsAuthorizing(false);
        }, 4000);

        try {
            // Skip WebSocket authorize for Bearer tokens (new OAuth2 flow)
            if (this.token && this.token.startsWith('ory_at_')) {
                setIsAuthorizing(false);
                if (!this.has_active_symbols) {
                    this.active_symbols_promise = this.getActiveSymbols();
                }
                // Set up balance subscription via OTP WebSocket for PKCE users.
                // Always mint a FRESH OTP url instead of reusing a possibly-expired
                // cached one from localStorage, since OTP tokens are single-use/short-lived.
                try {
                    const otpRes = await fetch('/api/auth/otp', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ access_token: this.token, account_id: this.account_id }),
                    });
                    const otpData = await otpRes.json();
                    const otpWsUrl = otpData?.data?.url;
                    console.log('[api-base] OTP fetch response:', otpData);
                    if (otpWsUrl) {
                        console.log('[api-base] Fresh OTP url obtained, opening socket:', otpWsUrl.slice(0, 60));
                        localStorage.setItem('deriv_ws_url', otpWsUrl);
                        const otpSocket = new WebSocket(otpWsUrl);
                        otpSocket.onopen = () => {
                            console.log('[api-base] OTP socket OPEN, sending balance subscribe');
                            // Note: this OTP-scoped endpoint rejects the 'account' property
                            // (it's already scoped to a single account via the OTP token itself)
                            otpSocket.send(JSON.stringify({ balance: 1, subscribe: 1 }));
                        };
                        otpSocket.onmessage = (event) => {
                            try {
                                const data = JSON.parse(event.data);
                                console.log('[api-base] OTP socket message:', data.msg_type, data.error || data.balance);
                                if (data.msg_type === 'balance' && !data.error) {
                                    globalObserver.emit('balance.update', data.balance);
                                }
                            } catch (e) {}
                        };
                        otpSocket.onerror = (err) => { console.log('[api-base] OTP socket ERROR', err); try { otpSocket.close(); } catch(e) {} };
                    } else {
                        console.log('[api-base] No OTP url returned from /api/auth/otp');
                    }
                } catch(e) {
                    console.warn('[api-base] OTP balance subscription failed:', e);
                }
                return;
            }
            const { authorize, error } = await this.api.authorize(this.token);
            if (error) {
                if (error.code === 'InvalidToken') {
                    const is_tmb_enabled = window.is_tmb_enabled === true;
                    const authToken = localStorage.getItem('authToken');
                    if (authToken && authToken.startsWith('ory_at_')) {
                        // Bearer token users - don't logout on InvalidToken
                        setIsAuthorizing(false);
                        return;
                    }
                    if (Cookies.get('logged_state') === 'true' && !is_tmb_enabled) {
                        globalObserver.emit('InvalidToken', { error });
                    } else {
                        clearAuthData();
                    }
                } else {
                    console.error('Authorization error:', error);
                }
                setIsAuthorizing(false);
                return error;
            }

            this.account_info = authorize;
            setAccountList(authorize?.account_list || []);
            setAuthData(authorize);
            setIsAuthorized(true);
            this.is_authorized = true;
            localStorage.setItem('client_account_details', JSON.stringify(authorize?.account_list));
            localStorage.setItem('client.country', authorize?.country);

            if (this.has_active_symbols) {
                this.toggleRunButton(false);
            } else {
                this.active_symbols_promise = this.getActiveSymbols();
            }
            this.subscribe();
            // this.getSelfExclusion(); commented this so we dont call it from two places
        } catch (e) {
            console.error('Authorization failed:', e);
            this.is_authorized = false;
            const authToken = localStorage.getItem('authToken');
            if (!authToken || !authToken.startsWith('ory_at_')) {
                clearAuthData();
            }
            setIsAuthorized(false);
            globalObserver.emit('Error', e);
        } finally {
            clearTimeout(authorizingTimeout);
            setIsAuthorizing(false);
        }
    }

    async getSelfExclusion() {
        if (!this.api || !this.is_authorized) return;
        await this.api.getSelfExclusion();
        // TODO: fix self exclusion
    }

    async subscribe() {
        const subscribeToStream = (streamName: string) => {
            return doUntilDone(
                () => {
                    const subscription = this.api?.send({
                        [streamName]: 1,
                        subscribe: 1,
                        ...(streamName === 'balance' ? { account: 'all' } : {}),
                    });
                    if (subscription) {
                        this.current_auth_subscriptions.push(subscription);
                    }
                    return subscription;
                },
                [],
                this
            );
        };

        const streamsToSubscribe = ['balance', 'transaction', 'proposal_open_contract'];

        await Promise.all(streamsToSubscribe.map(subscribeToStream));
    }

    getActiveSymbols = async () => {
        // Use public WebSocket for market data - no auth needed
        await new Promise<void>((resolve) => {
            const ws = new WebSocket('wss://api.derivws.com/trading/v1/options/ws/public');
            ws.onopen = () => ws.send(JSON.stringify({ active_symbols: 'brief' }));
            ws.onmessage = (msg: MessageEvent) => {
                const data = JSON.parse(msg.data);
                const raw_symbols = data.active_symbols || [];
                const error = data.error || {};
                // Map public WS field names to expected field names
                const active_symbols = raw_symbols.map((s: any) => ({
                    ...s,
                    symbol: s.symbol ?? s.underlying_symbol,
                    display_name: s.display_name ?? s.underlying_symbol_name,
                    market_display_name: s.market_display_name ?? s.market,
                    submarket_display_name: s.submarket_display_name ?? s.submarket,
                    pip: s.pip ?? s.pip_size,
                    exchange_is_open: s.exchange_is_open === 1 || s.exchange_is_open === true,
                }));
                const pip_sizes: Record<string, number> = {};
                if (active_symbols.length) this.has_active_symbols = true;
                active_symbols.forEach(({ symbol, pip }: { symbol: string; pip: string }) => {
                    pip_sizes[symbol] = +(+pip).toExponential().substring(3);
                });
                this.pip_sizes = pip_sizes;
                this.toggleRunButton(false);
                this.active_symbols = active_symbols;
                console.log('[api-base] active_symbols loaded:', active_symbols.length);
                ws.close();
                resolve();
            };
            ws.onerror = (e) => { console.error('[api-base] public WS error:', e); resolve(); };
            setTimeout(() => { ws.close(); resolve(); }, 10000);
        });
        // active_symbols already set by public WebSocket above
    };

    toggleRunButton = (toggle: boolean) => {
        const run_button = document.querySelector('#db-animation__run-button');
        if (!run_button) return;
        (run_button as HTMLButtonElement).disabled = toggle;
    };

    setIsRunning(toggle = false) {
        this.is_running = toggle;
    }

    pushSubscription(subscription: CurrentSubscription) {
        this.subscriptions.push(subscription);
    }

    clearSubscriptions() {
        this.subscriptions.forEach(s => s.unsubscribe());
        this.subscriptions = [];

        // Resetting timeout resolvers
        const global_timeouts = globalObserver.getState('global_timeouts') ?? [];

        global_timeouts.forEach((_: unknown, i: number) => {
            clearTimeout(i);
        });
    }
}

export const api_base = new APIBase();
