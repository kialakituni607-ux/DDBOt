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
            const entry_spot = parseFloat(to_buy.spot ?? 0);
            const currency = this.trade_option?.currency || 'USD';
            const now = Math.floor(Date.now() / 1000);

            let openTrade;
            try {
                openTrade = await tmApi.openVirtualTrade({
                    symbol,
                    trade_type: contract_type,
                    stake,
                    payout,
                    duration: this.trade_option?.duration,
                    duration_unit: this.trade_option?.duration_unit,
                    entry_spot,
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
                entry_spot,
                entry_spot_display_value: String(entry_spot),
                entry_tick: entry_spot,
                entry_tick_display_value: String(entry_spot),
                entry_tick_time: now,
                date_start: now,
                purchase_time: now,
                status: 'open',
                is_sold: false,
                is_expired: false,
                is_valid_to_sell: false,
                longcode: `Virtual ${contract_type} on ${symbol}`,
                shortcode: `${contract_type}_${symbol}`,
            };
            broadcastContract({ accountID: this.accountInfo.loginid, ...base_contract });

            if (this.is_proposal_subscription_required) {
                this.renewProposalsOnPurchase();
            }

            // Capture trade parameters NOW, at purchase time — this.trade_option is
            // shared, mutable engine state that the bot may overwrite with the NEXT
            // trade's values before this settlement (async, runs after purchase
            // returns) gets a chance to read it. Passing them explicitly avoids a
            // stale/wrong-value read that silently breaks settlement.
            const settle_duration = this.trade_option?.duration;
            const settle_duration_unit = this.trade_option?.duration_unit;
            const settle_prediction = this.trade_option?.prediction;

            this.settleVirtualContract(
                contract_type,
                symbol,
                entry_spot,
                stake,
                payout,
                fake_buy_transaction_id,
                base_contract,
                openTrade.trade.id,
                settle_duration,
                settle_duration_unit,
                settle_prediction
            ).catch(e => {
                logError(e?.message || 'Virtual settlement failed');
            });

            return Promise.resolve();
        }

        async settleVirtualContract(
            contract_type,
            symbol,
            entry_spot,
            stake,
            payout,
            buy_transaction_id,
            base_contract,
            virtual_trade_id,
            duration,
            duration_unit,
            prediction
        ) {

            let exit_spot;
            let exit_epoch;

            if (duration_unit === 't') {
                // NOTE: intentionally not using the shared getDelayTickValue()
                // helper here — it has a pre-existing bug where it resolves
                // its promise with a live reference to its internal ticks
                // array, then immediately clears that same array (ticks.length
                // = 0) right after resolving. Since that happens synchronously,
                // before our await continuation runs, we'd always read back an
                // empty array. No other caller in this codebase was affected
                // since none of them read the resolved tick data itself, only
                // used it as a timing signal. We collect ticks ourselves here,
                // using the same underlying ticksService primitives, returning
                // a safe snapshot instead.
                const symbol = this.symbol;
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
                const last_tick_obj = exit_data[exit_data.length - 1];
                exit_spot = parseFloat(last_tick_obj?.quote ?? last_tick_obj);
                exit_epoch = last_tick_obj?.epoch ?? Math.floor(Date.now() / 1000);
            } else {
                const unit_ms = { s: 1000, m: 60000, h: 3600000, d: 86400000 };
                const ms = (duration || 0) * (unit_ms[duration_unit] || 1000);
                await new Promise(resolve => setTimeout(resolve, ms));
                const last_tick = await this.getLastTick(true);
                exit_spot = parseFloat(last_tick?.quote ?? last_tick);
                exit_epoch = last_tick?.epoch ?? Math.floor(Date.now() / 1000);
            }

            const pip_size = this.getPipSize() ?? 2;
            const exit_spot_rounded = Number(exit_spot.toFixed(pip_size));
            const last_digit = Number(exit_spot_rounded.toFixed(pip_size).slice(-1));

            let won;
            switch (contract_type) {
                case 'CALL':
                    won = exit_spot_rounded > entry_spot;
                    break;
                case 'CALLE':
                    won = exit_spot_rounded >= entry_spot;
                    break;
                case 'PUT':
                    won = exit_spot_rounded < entry_spot;
                    break;
                case 'PUTE':
                    won = exit_spot_rounded <= entry_spot;
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

            // The backend is the source of truth for the final result — if admin
            // has a forced win/loss sequence enabled (testing tool), it overrides
            // whatever we computed locally from real ticks. Use whatever the
            // backend actually persisted for display, not our local guess, so the
            // UI never shows a different outcome than what was actually settled
            // and applied to the virtual balance.
            let final_won = won;
            let final_profit = locally_computed_profit;
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
            } catch (e) {
                logError(e?.message || 'Failed to settle virtual trade');
            }
            globalObserver.emit('virtual_balance.update');
            const fake_sell_transaction_id = -Date.now();
            const final_contract = {
                ...base_contract,
                exit_spot: exit_spot_rounded,
                exit_spot_display_value: String(exit_spot_rounded),
                exit_tick: exit_spot_rounded,
                exit_tick_display_value: String(exit_spot_rounded),
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
