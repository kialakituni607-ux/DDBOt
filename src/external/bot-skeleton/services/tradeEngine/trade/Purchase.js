import { isAdminLoginid } from '@/constants/admin';
import tmApi from '@/utils/tm-api';
import { LogTypes } from '../../../constants/messages';
import { observer as globalObserver } from '../../../utils/observer';
import { api_base } from '../../api/api-base';
import { contract as broadcastContract, contractStatus, error as logError, info, log } from '../utils/broadcast';
import { doUntilDone, getUUID, recoverFromError, tradeOptionToBuy } from '../utils/helpers';
import { purchaseSuccessful } from './state/actions';
import { sell } from './state/actions';
import { BEFORE_PURCHASE } from './state/constants';

let delayIndex = 0;
let purchase_reference;

// Contract types supported for virtual (admin paper-trading) purchase.
// Kept intentionally narrow: settlement rules for these are simple enough
// to replicate correctly ourselves. Anything else falls through to the
// real Deriv purchase flow, even for admin.
const VIRTUAL_SUPPORTED_TYPES = [
    'CALL', 'PUT', 'CALLE', 'PUTE',
    'DIGITMATCH', 'DIGITDIFF', 'DIGITOVER', 'DIGITUNDER', 'DIGITODD', 'DIGITEVEN',
];

export default Engine =>
    class Purchase extends Engine {
        purchase(contract_type) {
            // Prevent calling purchase twice
            if (this.store.getState().scope !== BEFORE_PURCHASE) {
                return Promise.resolve();
            }

            if (this.shouldUseVirtualTrading(contract_type)) {
                return this.purchaseVirtual(contract_type);
            }

            return this.purchaseReal(contract_type);
        }

        shouldUseVirtualTrading(contract_type) {
            if (!this.is_proposal_subscription_required) return false;
            if (!VIRTUAL_SUPPORTED_TYPES.includes(contract_type)) return false;
            const loginid = localStorage.getItem('active_loginid');
            return isAdminLoginid(loginid);
        }

        purchaseReal(contract_type) {
            const onSuccess = response => {
                // Don't unnecessarily send a forget request for a purchased contract.
                const { buy } = response;

                contractStatus({
                    id: 'contract.purchase_received',
                    data: buy.transaction_id,
                    buy,
                });

                this.contractId = buy.contract_id;
                this.purchase_payout = buy.payout ? parseFloat(buy.payout) : 0;
                this.purchase_stake = buy.buy_price ? parseFloat(buy.buy_price) : 0;
                this.store.dispatch(purchaseSuccessful());
                api_base.api.send({ proposal_open_contract: 1, contract_id: buy.contract_id, subscribe: 1 });
                const poll = setInterval(() => {
                    if (!this.contractId) { clearInterval(poll); return; }
                    api_base.api.send({ proposal_open_contract: 1, contract_id: buy.contract_id });
                }, 1000);
                setTimeout(() => clearInterval(poll), 30000);

                if (this.is_proposal_subscription_required) {
                    this.renewProposalsOnPurchase();
                }

                delayIndex = 0;
                log(LogTypes.PURCHASE, { longcode: buy.longcode, transaction_id: buy.transaction_id });
                info({
                    accountID: this.accountInfo.loginid,
                    totalRuns: this.updateAndReturnTotalRuns(),
                    transaction_ids: { buy: buy.transaction_id },
                    contract_type,
                    buy_price: buy.buy_price,
                });
            };

            if (this.is_proposal_subscription_required) {
                const { id, askPrice } = this.selectProposal(contract_type);

                const action = () => api_base.api.send({ buy: id, price: askPrice });

                this.isSold = false;

                contractStatus({
                    id: 'contract.purchase_sent',
                    data: askPrice,
                });

                if (!this.options.timeMachineEnabled) {
                    return doUntilDone(action).then(onSuccess);
                }

                return recoverFromError(
                    action,
                    (errorCode, makeDelay) => {
                        // if disconnected no need to resubscription (handled by live-api)
                        if (errorCode !== 'DisconnectError') {
                            this.renewProposalsOnPurchase();
                        } else {
                            this.clearProposals();
                        }

                        const unsubscribe = this.store.subscribe(() => {
                            const { scope, proposalsReady } = this.store.getState();
                            if (scope === BEFORE_PURCHASE && proposalsReady) {
                                makeDelay().then(() => this.observer.emit('REVERT', 'before'));
                                unsubscribe();
                            }
                        });
                    },
                    ['PriceMoved', 'InvalidContractProposal'],
                    delayIndex++
                ).then(onSuccess);
            }
            const trade_option = tradeOptionToBuy(contract_type, this.tradeOptions);
            const action = () => api_base.api.send(trade_option);

            this.isSold = false;

            contractStatus({
                id: 'contract.purchase_sent',
                data: this.tradeOptions.amount,
            });

            if (!this.options.timeMachineEnabled) {
                return doUntilDone(action).then(onSuccess);
            }

            return recoverFromError(
                action,
                (errorCode, makeDelay) => {
                    if (errorCode === 'DisconnectError') {
                        this.clearProposals();
                    }
                    const unsubscribe = this.store.subscribe(() => {
                        const { scope } = this.store.getState();
                        if (scope === BEFORE_PURCHASE) {
                            makeDelay().then(() => this.observer.emit('REVERT', 'before'));
                            unsubscribe();
                        }
                    });
                },
                ['PriceMoved', 'InvalidContractProposal'],
                delayIndex++
            ).then(onSuccess);
        }
        async purchaseVirtual(contract_type) {
            this.isSold = false;

            contractStatus({
                id: 'contract.purchase_sent',
                data: this.tradeOptions?.amount,
            });

            let to_buy;
            try {
                const { proposals } = this.data;
                to_buy = proposals.find(
                    p => p.contract_type === contract_type && p.purchase_reference === this.getPurchaseReference()
                );
                if (!to_buy) throw new Error('Selected proposal does not exist');
                if (to_buy.error) throw to_buy.error;
            } catch (e) {
                logError(e?.message || 'Failed to get proposal for virtual trade');
                throw e;
            }

            const stake = parseFloat(to_buy.ask_price ?? this.trade_option?.amount ?? 0);
            const payout = parseFloat(to_buy.payout ?? 0);
            const symbol = this.trade_option?.symbol || this.symbol;
            const currency = this.trade_option?.currency || 'USD';

            // Capture trade parameters NOW, before any waiting — this.trade_option
            // is shared, mutable engine state that the bot may overwrite with the
            // NEXT trade's values while we're waiting for ticks below.
            const duration = this.trade_option?.duration;
            const duration_unit = this.trade_option?.duration_unit;
            const prediction = this.trade_option?.prediction;
            const pip_size = this.getPipSize() ?? 2;

            // Per Deriv's real contract rules: entry spot is the next tick after
            // the contract is processed, and exit spot is the last tick when the
            // contract ends. For a 1-tick contract there is only ONE tick in the
            // whole contract — that same tick is both entry and exit. We collect
            // `duration` real ticks and use the first as entry, the last as exit
            // (identical when duration is 1), instead of treating the cached
            // proposal price as "entry" and a separately-fetched later tick as
            // "exit" — which measured two different points in time and produced
            // exit values not matching Deriv's real definition.
            let entry_spot;
            let exit_spot;
            let entry_epoch;
            let exit_epoch;

            try {
                if (duration_unit === 't') {
                    const collected_ticks = [];
                    const exit_data = await new Promise((resolve, reject) => {
                        try {
                            const callback = tick_list => {
                                const latest = Array.isArray(tick_list) ? tick_list[tick_list.length - 1] : tick_list;
                                if (latest) collected_ticks.push(latest);
                                if (collected_ticks.length >= duration) {
                                    this.$scope.ticksService.stopMonitor({ symbol, key: '' });
                                    resolve(collected_ticks.slice());
                                }
                            };
                            this.$scope.ticksService.monitor({ symbol, callback });
                        } catch (e) {
                            reject(e);
                        }
                    });
                    const first_tick = exit_data[0];
                    const last_tick = exit_data[exit_data.length - 1];
                    entry_spot = parseFloat(first_tick?.quote ?? first_tick);
                    entry_epoch = first_tick?.epoch ?? Math.floor(Date.now() / 1000);
                    exit_spot = parseFloat(last_tick?.quote ?? last_tick);
                    exit_epoch = last_tick?.epoch ?? Math.floor(Date.now() / 1000);
                } else {
                    const first_tick = await this.getLastTick(true);
                    entry_spot = parseFloat(first_tick?.quote ?? first_tick);
                    entry_epoch = first_tick?.epoch ?? Math.floor(Date.now() / 1000);
                    const unit_ms = { s: 1000, m: 60000, h: 3600000, d: 86400000 };
                    const ms = (duration || 0) * (unit_ms[duration_unit] || 1000);
                    await new Promise(resolve => setTimeout(resolve, ms));
                    const last_tick = await this.getLastTick(true);
                    exit_spot = parseFloat(last_tick?.quote ?? last_tick);
                    exit_epoch = last_tick?.epoch ?? Math.floor(Date.now() / 1000);
                }
            } catch (e) {
                logError(e?.message || 'Failed to read market ticks for virtual trade');
                throw e;
            }

            const entry_spot_rounded = Number(entry_spot.toFixed(pip_size));
            const exit_spot_rounded = Number(exit_spot.toFixed(pip_size));
            const last_digit = Number(exit_spot_rounded.toFixed(pip_size).slice(-1));

            let won;
            switch (contract_type) {
                case 'CALL':
                    won = exit_spot_rounded > entry_spot_rounded;
                    break;
                case 'CALLE':
                    won = exit_spot_rounded >= entry_spot_rounded;
                    break;
                case 'PUT':
                    won = exit_spot_rounded < entry_spot_rounded;
                    break;
                case 'PUTE':
                    won = exit_spot_rounded <= entry_spot_rounded;
                    break;
                case 'DIGITMATCH':
                    won = last_digit === Number(prediction);
                    break;
                case 'DIGITDIFF':
                    won = last_digit !== Number(prediction);
                    break;
                case 'DIGITOVER':
                    won = last_digit > Number(prediction);
                    break;
                case 'DIGITUNDER':
                    won = last_digit < Number(prediction);
                    break;
                case 'DIGITODD':
                    won = last_digit % 2 === 1;
                    break;
                case 'DIGITEVEN':
                    won = last_digit % 2 === 0;
                    break;
                default:
                    won = false;
            }

            const locally_computed_profit = won ? Number((payout - stake).toFixed(2)) : Number((-stake).toFixed(2));

            let openTrade;
            try {
                openTrade = await tmApi.openVirtualTrade({
                    symbol,
                    trade_type: contract_type,
                    stake,
                    payout,
                    duration,
                    duration_unit,
                    entry_spot: entry_spot_rounded,
                    raw_data: { prediction },
                });
            } catch (e) {
                logError(e?.message || 'Insufficient virtual balance');
                throw e;
            }

            globalObserver.emit('virtual_balance.update');

            const fake_buy_transaction_id = -Date.now();
            this.contractId = `virtual-${openTrade.trade.id}`;
            this.purchase_payout = payout;
            this.purchase_stake = stake;
            this.store.dispatch(purchaseSuccessful());

            contractStatus({
                id: 'contract.purchase_received',
                data: fake_buy_transaction_id,
                buy: {
                    transaction_id: fake_buy_transaction_id,
                    buy_price: stake,
                    payout,
                    longcode: `Virtual ${contract_type} on ${symbol}`,
                    contract_id: this.contractId,
                },
            });

            delayIndex = 0;
            log(LogTypes.PURCHASE, {
                longcode: `Virtual ${contract_type} on ${symbol}`,
                transaction_id: fake_buy_transaction_id,
            });
            info({
                accountID: this.accountInfo.loginid,
                totalRuns: this.updateAndReturnTotalRuns(),
                transaction_ids: { buy: fake_buy_transaction_id },
                contract_type,
                buy_price: stake,
            });

            const base_contract = {
                transaction_ids: { buy: fake_buy_transaction_id },
                contract_id: this.contractId,
                underlying: symbol,
                contract_type,
                buy_price: stake,
                payout,
                currency,
                entry_spot: entry_spot_rounded,
                entry_spot_display_value: entry_spot_rounded.toFixed(pip_size),
                entry_tick: entry_spot_rounded,
                entry_tick_display_value: entry_spot_rounded.toFixed(pip_size),
                entry_tick_time: entry_epoch,
                date_start: entry_epoch,
                purchase_time: entry_epoch,
                status: 'open',
                is_sold: false,
                is_expired: false,
                is_valid_to_sell: false,
                longcode: `Virtual ${contract_type} on ${symbol}`,
                shortcode: `${contract_type}_${symbol}`,
            };

            if (this.is_proposal_subscription_required) {
                this.renewProposalsOnPurchase();
            }

            // We already know the outcome — we waited for all the ticks needed
            // before opening the trade above — so settle right away rather than
            // deferring to a separate later wait.
            this.settleVirtualContract(
                openTrade.trade.id,
                won,
                locally_computed_profit,
                exit_spot_rounded,
                exit_epoch,
                fake_buy_transaction_id,
                base_contract,
                payout
            ).catch(e => {
                logError(e?.message || 'Virtual settlement failed');
            });

            return Promise.resolve();
        }

        async settleVirtualContract(
            virtual_trade_id,
            won,
            locally_computed_profit,
            exit_spot_rounded,
            exit_epoch,
            buy_transaction_id,
            base_contract,
            payout
        ) {
            const pip_size = this.getPipSize() ?? 2;

            let final_won = won;
            let final_profit = locally_computed_profit;
            // Default to our own real-tick-based exit spot; if the backend
            // overrode the result via a forced win/loss sequence (a testing
            // tool), it also returns a synthesized exit spot consistent with
            // that forced outcome (e.g. a forced win on "Over 5" genuinely has
            // a last digit over 5) — use that instead so the display never
            // contradicts the actual result.
            let final_exit_spot = exit_spot_rounded;
            // If the backend synthesized a new entry spot too (digit
            // contracts: entry and exit are the same tick, so both get
            // adjusted together to stay consistent with a forced result),
            // reflect that in the displayed entry fields as well — otherwise
            // entry and exit would visibly disagree even though they should
            // always match for a 1-tick digit contract.
            let final_entry_spot = base_contract.entry_spot;
            try {
                const settled = await tmApi.settleVirtualTrade(virtual_trade_id, {
                    result: won ? 'won' : 'lost',
                    exit_spot: exit_spot_rounded,
                    profit: locally_computed_profit,
                });
                if (settled?.trade?.result) {
                    final_won = settled.trade.result === 'won';
                    final_profit = parseFloat(settled.trade.profit ?? locally_computed_profit);
                }
                if (settled?.trade?.exit_spot !== undefined && settled.trade.exit_spot !== null) {
                    final_exit_spot = parseFloat(settled.trade.exit_spot);
                }
                if (settled?.trade?.entry_spot !== undefined && settled.trade.entry_spot !== null) {
                    final_entry_spot = parseFloat(settled.trade.entry_spot);
                }
            } catch (e) {
                logError(e?.message || 'Failed to settle virtual trade');
            }

            globalObserver.emit('virtual_balance.update');

            const fake_sell_transaction_id = -Date.now();
            const final_contract = {
                ...base_contract,
                entry_spot: final_entry_spot,
                entry_spot_display_value: final_entry_spot.toFixed(pip_size),
                entry_tick: final_entry_spot,
                entry_tick_display_value: final_entry_spot.toFixed(pip_size),
                exit_spot: final_exit_spot,
                exit_spot_display_value: final_exit_spot.toFixed(pip_size),
                exit_tick: final_exit_spot,
                exit_tick_display_value: final_exit_spot.toFixed(pip_size),
                exit_tick_time: exit_epoch,
                sell_time: exit_epoch,
                profit: final_profit,
                payout,
                sell_price: final_won ? payout : 0,
                bid_price: final_won ? payout : 0,
                status: final_won ? 'won' : 'lost',
                is_sold: true,
                is_expired: true,
                is_valid_to_sell: false,
                transaction_ids: { buy: buy_transaction_id, sell: fake_sell_transaction_id },
            };

            this.isSold = true;
            this.contractId = '';

            broadcastContract({ accountID: this.accountInfo.loginid, ...final_contract });

            contractStatus({
                id: 'contract.sold',
                data: fake_sell_transaction_id,
                contract: final_contract,
            });

            if (this.afterPromise) {
                this.afterPromise();
            }

            this.store.dispatch(sell());
        }


        getPurchaseReference = () => purchase_reference;
        regeneratePurchaseReference = () => {
            purchase_reference = getUUID();
        };
    };
