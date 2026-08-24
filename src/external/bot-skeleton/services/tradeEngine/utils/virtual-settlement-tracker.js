// Tracks virtual trade settlements that are still in flight (waiting on
// real ticks + a backend confirmation) so bot-stop logic can wait for them
// specifically before tearing down the listener that displays trade
// history — without delaying anything else about stopping the bot.
let pending_count = 0;
let resolvers = [];

export function trackVirtualSettlement(promise) {
    pending_count++;
    const done = () => {
        pending_count = Math.max(0, pending_count - 1);
        if (pending_count === 0) {
            resolvers.forEach(r => r());
            resolvers = [];
        }
    };
    promise.then(done, done);
}

export function waitForPendingVirtualSettlements(timeout_ms = 10000) {
    if (pending_count <= 0) return Promise.resolve();
    return new Promise(resolve => {
        const timer = setTimeout(resolve, timeout_ms);
        resolvers.push(() => {
            clearTimeout(timer);
            resolve();
        });
    });
}
