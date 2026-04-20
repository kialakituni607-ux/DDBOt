const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const WebSocket = require('ws');
const http = require('http');

const app = express();
const server = http.createServer(app);

const PORT = process.env.BACKEND_PORT || 3001;
const JWT_SECRET = process.env.JWT_SECRET || 'fallback-dev-secret-change-in-prod';
const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || crypto.randomBytes(32).toString('hex');
const DERIV_APP_ID = '116874';

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_URL && process.env.DATABASE_URL.includes('sslmode=require')
        ? { rejectUnauthorized: false }
        : false,
});

app.use(cors({
    origin: true,
    credentials: true,
}));
app.use(express.json());

const ALGO = 'aes-256-gcm';
const KEY_BUF = Buffer.from(ENCRYPTION_KEY.padEnd(64, '0').slice(0, 64), 'hex');

function encryptToken(plaintext) {
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv(ALGO, KEY_BUF, iv);
    const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return [iv.toString('hex'), tag.toString('hex'), encrypted.toString('hex')].join(':');
}

function decryptToken(ciphertext) {
    const [ivHex, tagHex, encHex] = ciphertext.split(':');
    const iv = Buffer.from(ivHex, 'hex');
    const tag = Buffer.from(tagHex, 'hex');
    const enc = Buffer.from(encHex, 'hex');
    const decipher = crypto.createDecipheriv(ALGO, KEY_BUF, iv);
    decipher.setAuthTag(tag);
    return decipher.update(enc) + decipher.final('utf8');
}

function authMiddleware(req, res, next) {
    const header = req.headers.authorization;
    if (!header || !header.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'Unauthorised' });
    }
    const token = header.slice(7);
    try {
        req.user = jwt.verify(token, JWT_SECRET);
        next();
    } catch {
        return res.status(401).json({ error: 'Invalid or expired token' });
    }
}

app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', time: new Date().toISOString() });
});

app.post('/api/auth/register', async (req, res) => {
    const { email, username, password } = req.body;
    if (!email || !username || !password) {
        return res.status(400).json({ error: 'email, username and password are required' });
    }
    if (password.length < 8) {
        return res.status(400).json({ error: 'Password must be at least 8 characters' });
    }
    try {
        const hash = await bcrypt.hash(password, 12);
        const result = await pool.query(
            'INSERT INTO users (email, username, password_hash) VALUES ($1, $2, $3) RETURNING id, email, username, created_at',
            [email.toLowerCase().trim(), username.trim(), hash]
        );
        const user = result.rows[0];
        const jwtToken = jwt.sign({ id: user.id, email: user.email, username: user.username }, JWT_SECRET, { expiresIn: '7d' });
        res.status(201).json({ token: jwtToken, user: { id: user.id, email: user.email, username: user.username, created_at: user.created_at } });
    } catch (err) {
        if (err.code === '23505') {
            return res.status(409).json({ error: 'Email or username already taken' });
        }
        console.error('Register error:', err.message);
        res.status(500).json({ error: 'Registration failed' });
    }
});

app.post('/api/auth/login', async (req, res) => {
    const { email, password } = req.body;
    if (!email || !password) {
        return res.status(400).json({ error: 'email and password are required' });
    }
    try {
        const result = await pool.query('SELECT * FROM users WHERE email = $1', [email.toLowerCase().trim()]);
        const user = result.rows[0];
        if (!user) return res.status(401).json({ error: 'Invalid credentials' });
        const valid = await bcrypt.compare(password, user.password_hash);
        if (!valid) return res.status(401).json({ error: 'Invalid credentials' });
        const jwtToken = jwt.sign({ id: user.id, email: user.email, username: user.username }, JWT_SECRET, { expiresIn: '7d' });
        res.json({ token: jwtToken, user: { id: user.id, email: user.email, username: user.username, created_at: user.created_at } });
    } catch (err) {
        console.error('Login error:', err.message);
        res.status(500).json({ error: 'Login failed' });
    }
});

app.get('/api/auth/me', authMiddleware, async (req, res) => {
    try {
        const result = await pool.query('SELECT id, email, username, created_at FROM users WHERE id = $1', [req.user.id]);
        if (!result.rows[0]) return res.status(404).json({ error: 'User not found' });
        res.json({ user: result.rows[0] });
    } catch (err) {
        res.status(500).json({ error: 'Failed to fetch profile' });
    }
});

app.post('/api/tokens', authMiddleware, async (req, res) => {
    const { token, token_name } = req.body;
    if (!token) return res.status(400).json({ error: 'token is required' });

    try {
        const ws = new WebSocket(`wss://ws.derivws.com/websockets/v3?app_id=${DERIV_APP_ID}`);
        let settled = false;
        const timeout = setTimeout(() => {
            if (!settled) { settled = true; ws.close(); res.status(408).json({ error: 'Deriv API timeout' }); }
        }, 10000);

        ws.on('open', () => {
            ws.send(JSON.stringify({ authorize: token }));
        });

        ws.on('message', async (data) => {
            if (settled) return;
            settled = true;
            clearTimeout(timeout);
            ws.close();
            const msg = JSON.parse(data.toString());
            if (msg.error) {
                return res.status(400).json({ error: 'Invalid Deriv token: ' + msg.error.message });
            }
            const { loginid, email, scopes } = msg.authorize;
            const encrypted = encryptToken(token);
            await pool.query(
                'INSERT INTO api_tokens (user_id, token_encrypted, token_name, permissions, deriv_loginid) VALUES ($1, $2, $3, $4, $5)',
                [req.user.id, encrypted, token_name || 'My Token', JSON.stringify(scopes || []), loginid]
            );
            res.status(201).json({ message: 'Token saved', loginid, email, scopes });
        });

        ws.on('error', () => {
            if (!settled) { settled = true; clearTimeout(timeout); res.status(502).json({ error: 'Could not connect to Deriv API' }); }
        });
    } catch (err) {
        console.error('Save token error:', err.message);
        res.status(500).json({ error: 'Failed to save token' });
    }
});

app.get('/api/tokens', authMiddleware, async (req, res) => {
    try {
        const result = await pool.query(
            'SELECT id, token_name, permissions, deriv_loginid, created_at, last_used_at, is_active FROM api_tokens WHERE user_id = $1 ORDER BY created_at DESC',
            [req.user.id]
        );
        res.json({ tokens: result.rows });
    } catch (err) {
        res.status(500).json({ error: 'Failed to fetch tokens' });
    }
});

app.delete('/api/tokens/:id', authMiddleware, async (req, res) => {
    try {
        await pool.query('DELETE FROM api_tokens WHERE id = $1 AND user_id = $2', [req.params.id, req.user.id]);
        res.json({ message: 'Token deleted' });
    } catch (err) {
        res.status(500).json({ error: 'Failed to delete token' });
    }
});

app.post('/api/trades', authMiddleware, async (req, res) => {
    const { deriv_contract_id, symbol, trade_type, stake, payout, profit, duration, duration_unit, entry_spot, exit_spot, result: tradeResult, status, opened_at, closed_at, raw_data } = req.body;
    if (!symbol || !trade_type || stake == null) {
        return res.status(400).json({ error: 'symbol, trade_type and stake are required' });
    }
    try {
        const r = await pool.query(
            `INSERT INTO trade_history (user_id, deriv_contract_id, symbol, trade_type, stake, payout, profit, duration, duration_unit, entry_spot, exit_spot, result, status, opened_at, closed_at, raw_data)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) RETURNING *`,
            [req.user.id, deriv_contract_id, symbol, trade_type, stake, payout, profit, duration, duration_unit, entry_spot, exit_spot, tradeResult, status || 'open', opened_at || new Date(), closed_at, raw_data ? JSON.stringify(raw_data) : null]
        );
        res.status(201).json({ trade: r.rows[0] });
    } catch (err) {
        console.error('Save trade error:', err.message);
        res.status(500).json({ error: 'Failed to save trade' });
    }
});

app.get('/api/trades', authMiddleware, async (req, res) => {
    const { symbol, limit = 50, offset = 0 } = req.query;
    try {
        let q = 'SELECT * FROM trade_history WHERE user_id = $1';
        const params = [req.user.id];
        if (symbol) { params.push(symbol); q += ` AND symbol = $${params.length}`; }
        params.push(parseInt(limit), parseInt(offset));
        q += ` ORDER BY opened_at DESC LIMIT $${params.length - 1} OFFSET $${params.length}`;
        const r = await pool.query(q, params);
        res.json({ trades: r.rows });
    } catch (err) {
        res.status(500).json({ error: 'Failed to fetch trades' });
    }
});

app.get('/api/trades/stats', authMiddleware, async (req, res) => {
    try {
        const r = await pool.query(
            `SELECT
                COUNT(*) AS total_trades,
                COUNT(*) FILTER (WHERE result = 'won') AS wins,
                COUNT(*) FILTER (WHERE result = 'lost') AS losses,
                COALESCE(SUM(profit), 0) AS total_profit,
                COALESCE(SUM(stake), 0) AS total_staked,
                COALESCE(AVG(profit) FILTER (WHERE result = 'won'), 0) AS avg_win,
                COALESCE(AVG(ABS(profit)) FILTER (WHERE result = 'lost'), 0) AS avg_loss
             FROM trade_history WHERE user_id = $1`,
            [req.user.id]
        );
        const stats = r.rows[0];
        stats.win_rate = stats.total_trades > 0
            ? ((stats.wins / stats.total_trades) * 100).toFixed(1)
            : '0.0';
        res.json({ stats });
    } catch (err) {
        res.status(500).json({ error: 'Failed to fetch stats' });
    }
});

const wss = new WebSocket.Server({ server, path: '/ws/deriv-proxy' });
const derivConnections = new Map();

wss.on('connection', (clientWs, req) => {
    const url = new URL(req.url, `http://localhost`);
    const jwtToken = url.searchParams.get('token');
    let userId = null;

    if (jwtToken) {
        try {
            const decoded = jwt.verify(jwtToken, JWT_SECRET);
            userId = decoded.id;
        } catch {}
    }

    console.log(`[WS Proxy] Client connected${userId ? ` (user ${userId})` : ' (guest)'}`);

    const derivWs = new WebSocket(`wss://ws.derivws.com/websockets/v3?app_id=${DERIV_APP_ID}`);
    derivConnections.set(clientWs, derivWs);

    derivWs.on('open', () => {
        clientWs.send(JSON.stringify({ type: 'proxy_connected' }));
    });

    derivWs.on('message', (data) => {
        if (clientWs.readyState === WebSocket.OPEN) {
            clientWs.send(data.toString());
        }
    });

    derivWs.on('close', () => {
        if (clientWs.readyState === WebSocket.OPEN) {
            clientWs.send(JSON.stringify({ type: 'proxy_disconnected' }));
        }
    });

    derivWs.on('error', (err) => {
        console.error('[WS Proxy] Deriv WS error:', err.message);
    });

    clientWs.on('message', async (data) => {
        let msg;
        try { msg = JSON.parse(data.toString()); } catch { return; }

        if (msg.__use_stored_token && userId) {
            try {
                const r = await pool.query(
                    'SELECT token_encrypted, id FROM api_tokens WHERE user_id = $1 AND is_active = TRUE LIMIT 1',
                    [userId]
                );
                if (r.rows[0]) {
                    const plain = decryptToken(r.rows[0].token_encrypted);
                    await pool.query('UPDATE api_tokens SET last_used_at = NOW() WHERE id = $1', [r.rows[0].id]);
                    derivWs.send(JSON.stringify({ authorize: plain }));
                    return;
                }
            } catch (err) {
                console.error('[WS Proxy] Token decrypt error:', err.message);
            }
        }

        if (derivWs.readyState === WebSocket.OPEN) {
            derivWs.send(data.toString());
        }
    });

    clientWs.on('close', () => {
        derivWs.close();
        derivConnections.delete(clientWs);
        console.log('[WS Proxy] Client disconnected');
    });
});

pool.connect()
    .then(client => {
        client.release();
        console.log('[DB] PostgreSQL connected');
    })
    .catch(err => console.error('[DB] Connection error:', err.message));

server.listen(PORT, '0.0.0.0', () => {
    console.log(`[TradeMasters API] Running on port ${PORT}`);
    console.log(`[TradeMasters WS]  Proxy at ws://localhost:${PORT}/ws/deriv-proxy`);
});

process.on('SIGTERM', () => {
    server.close(() => { pool.end(); process.exit(0); });
});
