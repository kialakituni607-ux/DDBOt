const fs = require('fs');

const path = 'src/external/bot-skeleton/services/api/contracts-for.js';
let content = fs.readFileSync(path, 'utf8');

const oldBlock = `        const getContractsForFromApi = async () => {
            if (this.retrieving_contracts_for[symbol]) {
                await this.retrieving_contracts_for[symbol];
                return this.contracts_for[symbol].contracts;
            }
            this.retrieving_contracts_for[symbol] = new PendingPromise();
            const response = await api_base.api.send({ contracts_for: symbol });
            if (response.error) {
                return [];
            }
            const {
                contracts_for: { available: contracts },
            } = response;
            // We don't offer forward-starting contracts in bot.
            const filtered_contracts = contracts.filter(c => c.start_type !== 'forward');
            this.contracts_for[symbol] = {
                contracts: filtered_contracts,
                timestamp: this.server_time.unix(),
            };
            this.retrieving_contracts_for[symbol].resolve();
            delete this.retrieving_contracts_for[symbol];
            return filtered_contracts;
        };`;

const newBlock = `        const getContractsForFromApi = async () => {
            if (this.retrieving_contracts_for[symbol]) {
                await this.retrieving_contracts_for[symbol];
                return this.contracts_for[symbol]?.contracts ?? [];
            }
            this.retrieving_contracts_for[symbol] = new PendingPromise();
            try {
                const response = await api_base.api.send({ contracts_for: symbol });
                if (response.error) {
                    return [];
                }
                const {
                    contracts_for: { available: contracts },
                } = response;
                // We don't offer forward-starting contracts in bot.
                const filtered_contracts = contracts.filter(c => c.start_type !== 'forward');
                this.contracts_for[symbol] = {
                    contracts: filtered_contracts,
                    timestamp: this.server_time.unix(),
                };
                return filtered_contracts;
            } finally {
                // Always resolve + clear the lock, whether the request succeeded,
                // returned an error, or threw — otherwise this symbol stays stuck
                // ("Not available") until a full page refresh.
                this.retrieving_contracts_for[symbol].resolve();
                delete this.retrieving_contracts_for[symbol];
            }
        };`;

if (!content.includes(oldBlock)) {
  console.log('NO MATCH — aborting without changes.');
  process.exit(1);
}

content = content.replace(oldBlock, newBlock);
fs.writeFileSync(path, content, 'utf8');
console.log('Patched successfully.');
