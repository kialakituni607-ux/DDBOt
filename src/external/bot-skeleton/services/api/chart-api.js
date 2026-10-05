import { generateDerivApiInstance } from './appId';

class ChartAPI {
    api;

    onsocketclose() {
        this.reconnectIfNotConnected();
    }

    init = async (force_create_connection = false) => {
        if (!this.api || force_create_connection) {
            if (this.api?.connection) {
                this.api.disconnect();
                this.api.connection.removeEventListener('close', this.onsocketclose.bind(this));
            }
            this.api = await generateDerivApiInstance();
            this.api?.connection.addEventListener('close', this.onsocketclose.bind(this));
            this.api?.connection.addEventListener('open', () => { this.retry_count = 0; });
        }
        this.getTime();
    };

    getTime() {
        if (!this.time_interval) {
            this.time_interval = setInterval(() => {
                this.api.send({ time: 1 });
            }, 30000);
        }
    }

    reconnectIfNotConnected = () => {
        // eslint-disable-next-line no-console
        console.log('chart connection state: ', this.api?.connection?.readyState);
        if (this.api?.connection?.readyState && this.api?.connection?.readyState > 1) {
            // eslint-disable-next-line no-console
            console.log('Info: Chart connection to the server was closed, trying to reconnect.');
            this.retry_count = (this.retry_count || 0) + 1;
            if (this.retry_count > 8) {
                console.warn('[chart-api] giving up reconnecting after 8 attempts');
                return;
            }
            clearTimeout(this.retry_timer);
            this.retry_timer = setTimeout(() => this.init(true), Math.min(2000 * this.retry_count, 15000));
        }
    };
}

const chart_api = new ChartAPI();

export default chart_api;
