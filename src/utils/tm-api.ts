const BASE_URL = '/api';

function getToken(): string | null {
    return localStorage.getItem('tm_jwt');
}

function setToken(token: string): void {
    localStorage.setItem('tm_jwt', token);
}

function clearToken(): void {
    localStorage.removeItem('tm_jwt');
    localStorage.removeItem('tm_user');
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
    const token = getToken();
    const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        ...(options.headers as Record<string, string>),
    };
    if (token) headers['Authorization'] = `Bearer ${token}`;

    const res = await fetch(`${BASE_URL}${path}`, { ...options, headers });
    const data = await res.json();

    if (!res.ok) {
        throw new Error(data.error || `Request failed (${res.status})`);
    }
    return data as T;
}

export type TMUser = {
    id: number;
    email?: string;
    username: string;
    deriv_loginid?: string;
    deriv_email?: string;
    created_at: string;
};

export type AuthResponse = {
    token: string;
    user: TMUser;
};

export type TokenInfo = {
    id: number;
    token_name: string;
    permissions: string[];
    deriv_loginid: string;
    created_at: string;
    last_used_at: string | null;
    is_active: boolean;
};

export type Trade = {
    id: number;
    symbol: string;
    trade_type: string;
    stake: string;
    payout: string | null;
    profit: string | null;
    result: string | null;
    status: string;
    opened_at: string;
    closed_at: string | null;
};

export type TradeStats = {
    total_trades: string;
    wins: string;
    losses: string;
    total_profit: string;
    total_staked: string;
    avg_win: string;
    avg_loss: string;
    win_rate: string;
};

const tmApi = {
    getToken,
    setToken,
    clearToken,

    isLoggedIn(): boolean {
        return !!getToken();
    },

    getSavedUser(): TMUser | null {
        const raw = localStorage.getItem('tm_user');
        if (!raw) return null;
        try { return JSON.parse(raw); } catch { return null; }
    },

    saveUser(user: TMUser): void {
        localStorage.setItem('tm_user', JSON.stringify(user));
    },

    async register(email: string, username: string, password: string): Promise<AuthResponse> {
        const res = await request<AuthResponse>('/auth/register', {
            method: 'POST',
            body: JSON.stringify({ email, username, password }),
        });
        setToken(res.token);
        tmApi.saveUser(res.user);
        return res;
    },

    async login(email: string, password: string): Promise<AuthResponse> {
        const res = await request<AuthResponse>('/auth/login', {
            method: 'POST',
            body: JSON.stringify({ email, password }),
        });
        setToken(res.token);
        tmApi.saveUser(res.user);
        return res;
    },

    logout(): void {
        clearToken();
    },

    async getMe(): Promise<TMUser> {
        const res = await request<{ user: TMUser }>('/auth/me');
        tmApi.saveUser(res.user);
        return res.user;
    },

    async saveDerivToken(token: string, tokenName?: string): Promise<{ loginid: string; email: string; scopes: string[] }> {
        return request('/tokens', {
            method: 'POST',
            body: JSON.stringify({ token, token_name: tokenName || 'My Token' }),
        });
    },

    async getTokens(): Promise<TokenInfo[]> {
        const res = await request<{ tokens: TokenInfo[] }>('/tokens');
        return res.tokens;
    },

    async deleteToken(id: number): Promise<void> {
        await request(`/tokens/${id}`, { method: 'DELETE' });
    },

    async getTrades(symbol?: string, limit = 50): Promise<Trade[]> {
        const params = new URLSearchParams({ limit: String(limit) });
        if (symbol) params.set('symbol', symbol);
        const res = await request<{ trades: Trade[] }>(`/trades?${params}`);
        return res.trades;
    },

    async saveTrade(trade: Partial<Trade> & { symbol: string; trade_type: string; stake: number }): Promise<Trade> {
        const res = await request<{ trade: Trade }>('/trades', {
            method: 'POST',
            body: JSON.stringify(trade),
        });
        return res.trade;
    },

    async getStats(): Promise<TradeStats> {
        const res = await request<{ stats: TradeStats }>('/trades/stats');
        return res.stats;
    },

    async loginWithDeriv(derivToken: string, loginid: string): Promise<AuthResponse> {
        const res = await request<AuthResponse>('/auth/deriv', {
            method: 'POST',
            body: JSON.stringify({ deriv_token: derivToken, loginid }),
        });
        setToken(res.token);
        tmApi.saveUser(res.user);
        return res;
    },
};

export default tmApi;
