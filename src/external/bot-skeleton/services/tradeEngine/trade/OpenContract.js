import { getRoundedNumber } from '@/components/shared';
import { api_base } from '../../api/api-base';
import { contract as broadcastContract, contractStatus } from '../utils/broadcast';
import { openContractReceived, sell } from './state/actions';

export default Engine =>
    class OpenContract extends Engine {
        observeOpenContract() {
            if (!api_base.api) return;
            const subscription = api_base.api.onMessage().subscribe(({ data }) => {
                if (data.msg_type === 'proposal_open_contract') {
                    const contract = data.proposal_open_contract;

                    if (!contract || !this.expectedContractId(contract?.contract_id)) {
                        return;
                    }

                    this.setContractFlags(contract);

                    this.data.contract = contract;

                    broadcastContract({ accountID: api_base.account_info.loginid, ...contract });

                    if (this.isSold) {
                        this.contractId = '';
                        clearTimeout(this.transaction_recovery_timeout);
                        this.updateTotals(contract);
                        // Report trade to server for commission tracking
                        try {
                            const authToken = localStorage.getItem('authToken');
                            const accountsList = JSON.parse(localStorage.getItem('clientAccounts') || '{}');
                            const loginid = api_base.account_info && api_base.account_info.loginid;
                            const accountInfo = loginid ? accountsList[loginid] : null;
                            const is_real = accountInfo ? (!accountInfo.is_virtual && accountInfo.account_type !== 'demo') : false;
                            if (authToken && loginid) {
                                fetch('https://api.trademasters.site/api/trades', {
                                    method: 'POST',
                                    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + authToken },
                                    body: JSON.stringify({
                                        deriv_contract_id: String(contract.contract_id),
                                        symbol: contract.underlying,
                                        trade_type: contract.contract_type,
                                        stake: this.purchase_stake || parseFloat(contract.buy_price),
                                        payout: this.purchase_payout || parseFloat(contract.payout),
                                        profit: parseFloat(contract.profit),
                                        entry_spot: parseFloat(contract.entry_spot),
                                        exit_spot: parseFloat(contract.exit_spot || contract.sell_spot),
                                        result: contract.profit >= 0 ? 'won' : 'lost',
                                        status: 'closed',
                                        opened_at: contract.purchase_time ? new Date(contract.purchase_time * 1000).toISOString() : undefined,
                                        closed_at: contract.sell_time ? new Date(contract.sell_time * 1000).toISOString() : new Date().toISOString(),
                                        is_real: is_real,
                                        raw_data: contract,
                                    }),
                                }).catch(function(e) { console.warn('[trade-report] failed:', e.message); });
                            }
                        } catch(e) { console.warn('[trade-report] error:', e.message); }

                        contractStatus({
                            id: 'contract.sold',
                            data: contract.transaction_ids.sell,
                            contract,
                        });

                        if (this.afterPromise) {
                            this.afterPromise();
                        }

                        this.store.dispatch(sell());
                    } else {
                        this.store.dispatch(openContractReceived());
                    }
                }
            });
            api_base.pushSubscription(subscription);
        }

        waitForAfter() {
            return new Promise(resolve => {
                this.afterPromise = resolve;
            });
        }

        setContractFlags(contract) {
            const { is_expired, is_valid_to_sell, is_sold, entry_tick } = contract;

            this.isSold = Boolean(is_sold);
            this.isSellAvailable = !this.isSold && Boolean(is_valid_to_sell);
            this.isExpired = Boolean(is_expired);
            this.hasEntryTick = Boolean(entry_tick);
        }

        expectedContractId(contractId) {
            return this.contractId && contractId === this.contractId;
        }

        getSellPrice() {
            const { bid_price: bidPrice, buy_price: buyPrice, currency } = this.data.contract;
            return getRoundedNumber(Number(bidPrice) - Number(buyPrice), currency);
        }
    };
