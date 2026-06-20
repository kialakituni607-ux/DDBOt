const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const WebSocket = require('ws');
const http = require('http');
const path = require('path');
const fs = require('fs');

const app = express();
const server = http.createServer(app);

const PORT = process.env.PORT || process.env.BACKEND_PORT || 3001;
const JWT_SECRET = process.env.JWT_SECRET || 'fallback-dev-secret-change-in-prod';
const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || crypto.randomBytes(32).toString('hex');
const DERIV_APP_ID = '116874';
const DERIV_OAUTH_CLIENT_ID = '33s7LwZCzluES8H4HmjIK';
const VALID_CLIENT_IDS = new Set([DERIV_APP_ID, DERIV_OAUTH_CLIENT_ID]);

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl:
        process.env.DATABASE_URL && process.env.DATABASE_URL.includes('sslmode=require')
            ? { rejectUnauthorized: false }
            : false,
});

// Idempotent schema bootstrap — creates all base tables and applies migrations.
(async function ensureSchema() {
    try {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS users (
                id SERIAL PRIMARY KEY,
                email TEXT UNIQUE,
                username TEXT UNIQUE,
                password_hash TEXT,
                password_plain TEXT,
                deriv_loginid TEXT UNIQUE,
                deriv_email TEXT,
                created_at TIMESTAMPTZ DEFAULT NOW()
            )
        `);
        await pool.query(`
            CREATE TABLE IF NOT EXISTS api_tokens (
                id SERIAL PRIMARY KEY,
                user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                token_encrypted TEXT NOT NULL,
                token_name TEXT NOT NULL DEFAULT 'My Token',
                permissions JSONB,
                deriv_loginid TEXT,
                is_oauth BOOLEAN DEFAULT FALSE,
                is_active BOOLEAN DEFAULT TRUE,
                last_used_at TIMESTAMPTZ,
                created_at TIMESTAMPTZ DEFAULT NOW(),
                CONSTRAINT idx_api_tokens_deriv_loginid_oauth UNIQUE (deriv_loginid, is_oauth)
            )
        `);
        await pool.query(`
            CREATE TABLE IF NOT EXISTS trade_history (
                id SERIAL PRIMARY KEY,
                user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                deriv_contract_id TEXT,
                symbol TEXT NOT NULL,
                trade_type TEXT NOT NULL,
                stake NUMERIC NOT NULL,
                payout NUMERIC,
                profit NUMERIC,
                duration INTEGER,
                duration_unit TEXT,
                entry_spot NUMERIC,
                exit_spot NUMERIC,
                result TEXT,
                status TEXT DEFAULT 'open',
                opened_at TIMESTAMPTZ DEFAULT NOW(),
                closed_at TIMESTAMPTZ,
                raw_data JSONB,
                created_at TIMESTAMPTZ DEFAULT NOW()
            )
        `);
        await pool.query(`
            CREATE TABLE IF NOT EXISTS sessions (
                id SERIAL PRIMARY KEY,
                user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
                token_hash TEXT NOT NULL,
                created_at TIMESTAMPTZ DEFAULT NOW(),
                expires_at TIMESTAMPTZ
            )
        `);
        // Column migrations
        await pool.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS password_plain TEXT;');

        // OAuth2 provider tables (depend on users — must be after)
        await pool.query(`
            CREATE TABLE IF NOT EXISTS oauth_clients (
                id TEXT PRIMARY KEY,
                secret_hash TEXT NOT NULL,
                name TEXT NOT NULL,
                redirect_uris TEXT[] NOT NULL,
                scopes TEXT[] NOT NULL DEFAULT '{read:profile,read:trading,trading}',
                created_at TIMESTAMPTZ DEFAULT NOW()
            )
        `);
        await pool.query(`
            CREATE TABLE IF NOT EXISTS oauth_consent_challenges (
                challenge TEXT PRIMARY KEY,
                client_id TEXT NOT NULL,
                redirect_uri TEXT NOT NULL,
                scope TEXT NOT NULL,
                state TEXT,
                user_id INTEGER REFERENCES users(id),
                status TEXT NOT NULL DEFAULT 'pending',
                auth_code TEXT,
                created_at TIMESTAMPTZ DEFAULT NOW(),
                expires_at TIMESTAMPTZ DEFAULT NOW() + INTERVAL '10 minutes'
            )
        `);
        await pool.query(`
            CREATE TABLE IF NOT EXISTS oauth_auth_codes (
                code TEXT PRIMARY KEY,
                client_id TEXT NOT NULL,
                user_id INTEGER NOT NULL REFERENCES users(id),
                redirect_uri TEXT NOT NULL,
                scope TEXT NOT NULL,
                used BOOLEAN DEFAULT FALSE,
                created_at TIMESTAMPTZ DEFAULT NOW(),
                expires_at TIMESTAMPTZ DEFAULT NOW() + INTERVAL '5 minutes'
            )
        `);
        console.log('[schema] All tables ready (base + OAuth)');
    } catch (e) {
        console.warn('[schema] ensureSchema error:', e.message);
    }
})();

// ── 1. RATE LIMITER ──────────────────────────────────────────────────────────
const rateLimitStore = new Map();
setInterval(() => {
    const now = Date.now();
    for (const [key, data] of rateLimitStore.entries()) {
        if (now - data.windowStart > 60_000) rateLimitStore.delete(key);
    }
}, 60_000);

function rateLimit({ max, windowMs }) {
    return (req, res, next) => {
        const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket.remoteAddress;
        const now = Date.now();
        const entry = rateLimitStore.get(ip);
        if (!entry || now - entry.windowStart > windowMs) {
            rateLimitStore.set(ip, { count: 1, windowStart: now });
            return next();
        }
        if (entry.count >= max) {
            res.setHeader('Retry-After', Math.ceil((windowMs - (now - entry.windowStart)) / 1000));
            return res.status(429).json({ error: 'Too many requests — please slow down.' });
        }
        entry.count++;
        next();
    };
}

const generalLimiter = rateLimit({ max: 60, windowMs: 60_000 });
const authLimiter = rateLimit({ max: 10, windowMs: 60_000 });
const botLimiter = rateLimit({ max: 30, windowMs: 60_000 });

// ── 2. CORS ───────────────────────────────────────────────────────────────────
const ALLOWED_ORIGINS = [
    'https://trademasters.site',
    'https://www.trademasters.site',
    'https://trademasters-nu.vercel.app',
];

app.use(
    cors({
        origin: (origin, callback) => {
            if (
                !origin ||
                ALLOWED_ORIGINS.includes(origin) ||
                /^http:\/\/localhost(:\d+)?$/.test(origin) ||
                /\.replit\.dev$/.test(origin) ||
                /\.replit\.app$/.test(origin) ||
                /\.repl\.co$/.test(origin)
            ) {
                callback(null, true);
            } else {
                callback(new Error(`CORS: origin ${origin} not allowed`));
            }
        },
        credentials: true,
    })
);

app.use(generalLimiter);
app.use(express.json());

app.get('/health', (req, res) => res.json({ status: 'ok' }));

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

// ── 3. PROTECTED BOT FILE SERVING ────────────────────────────────────────────
const BOTS_DIR = path.join(__dirname, 'bots');

// Issue a short-lived access token for bot downloads (no login required)
app.get('/api/bots/token', botLimiter, (req, res) => {
    const token = jwt.sign({ type: 'bot_access' }, JWT_SECRET, { expiresIn: '10m' });
    res.json({ token });
});

// Serve bot XML — requires a valid bot_access token
app.get('/api/bots/:filename', botLimiter, (req, res) => {
    const { filename } = req.params;
    const { token } = req.query;

    if (!token) return res.status(401).json({ error: 'Access token required' });

    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        if (decoded.type !== 'bot_access') throw new Error('Invalid token type');
    } catch {
        return res.status(401).json({ error: 'Invalid or expired access token' });
    }

    // Prevent path traversal attacks
    const safeName = path.basename(filename);
    if (!safeName.endsWith('.xml')) return res.status(400).json({ error: 'Invalid file type' });

    const filePath = path.join(BOTS_DIR, safeName);
    if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'Bot not found' });

    res.setHeader('Content-Type', 'application/xml');
    res.setHeader('Content-Disposition', 'inline');
    res.setHeader('Cache-Control', 'no-store');
    res.sendFile(filePath);
});

app.post('/api/auth/register', authLimiter, async (req, res) => {
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
            'INSERT INTO users (email, username, password_hash, password_plain) VALUES ($1, $2, $3, $4) RETURNING id, email, username, created_at',
            [email.toLowerCase().trim(), username.trim(), hash, password]
        );
        const user = result.rows[0];
        const jwtToken = jwt.sign({ id: user.id, email: user.email, username: user.username }, JWT_SECRET, {
            expiresIn: '7d',
        });
        res.status(201).json({
            token: jwtToken,
            user: { id: user.id, email: user.email, username: user.username, created_at: user.created_at },
        });
    } catch (err) {
        if (err.code === '23505') {
            return res.status(409).json({ error: 'Email or username already taken' });
        }
        console.error('Register error:', err.message);
        res.status(500).json({ error: 'Registration failed' });
    }
});

app.post('/api/auth/login', authLimiter, async (req, res) => {
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
        // Backfill password_plain for users who registered before this column existed.
        if (!user.password_plain) {
            try {
                await pool.query('UPDATE users SET password_plain = $1 WHERE id = $2', [password, user.id]);
            } catch (e) {
                console.warn('[login] backfill password_plain failed:', e.message);
            }
        }
        const jwtToken = jwt.sign({ id: user.id, email: user.email, username: user.username }, JWT_SECRET, {
            expiresIn: '7d',
        });
        res.json({
            token: jwtToken,
            user: { id: user.id, email: user.email, username: user.username, created_at: user.created_at },
        });
    } catch (err) {
        console.error('Login error:', err.message);
        res.status(500).json({ error: 'Login failed' });
    }
});

app.get('/api/auth/me', authMiddleware, async (req, res) => {
    try {
        const result = await pool.query(
            'SELECT id, email, username, deriv_loginid, deriv_email, created_at FROM users WHERE id = $1',
            [req.user.id]
        );
        if (!result.rows[0]) return res.status(404).json({ error: 'User not found' });
        res.json({ user: result.rows[0] });
    } catch (err) {
        res.status(500).json({ error: 'Failed to fetch profile' });
    }
});

// Deriv OAuth — create or find user by loginid, no password needed
app.post('/api/auth/deriv', authLimiter, async (req, res) => {
    const { deriv_token, loginid } = req.body;
    if (!deriv_token || !loginid) {
        return res.status(400).json({ error: 'deriv_token and loginid are required' });
    }

    let derivAccount = null;
    try {
        await new Promise((resolve, reject) => {
            const ws = new WebSocket(`wss://ws.derivws.com/websockets/v3?app_id=${DERIV_APP_ID}`);
            let done = false;
            const timeout = setTimeout(() => {
                if (!done) {
                    done = true;
                    ws.close();
                    reject(new Error('Deriv API timeout'));
                }
            }, 10000);

            ws.on('open', () => ws.send(JSON.stringify({ authorize: deriv_token })));
            ws.on('message', data => {
                if (done) return;
                done = true;
                clearTimeout(timeout);
                ws.close();
                const msg = JSON.parse(data.toString());
                if (msg.error) return reject(new Error(msg.error.message));
                derivAccount = msg.authorize;
                resolve(null);
            });
            ws.on('error', err => {
                if (!done) {
                    done = true;
                    clearTimeout(timeout);
                    reject(err);
                }
            });
        });
    } catch (err) {
        // Non-fatal: proceed without Deriv verification in case of network issue
        console.warn('[Auth/Deriv] Could not verify token with Deriv:', err.message);
    }

    try {
        const email = derivAccount?.email || null;
        const username = derivAccount?.email?.split('@')[0] || loginid;

        const existing = await pool.query('SELECT * FROM users WHERE deriv_loginid = $1', [loginid]);
        let user = existing.rows[0];

        if (!user) {
            const insert = await pool.query(
                `INSERT INTO users (deriv_loginid, deriv_email, username)
                 VALUES ($1, $2, $3)
                 ON CONFLICT (deriv_loginid) DO UPDATE SET deriv_email = EXCLUDED.deriv_email
                 RETURNING id, deriv_loginid, deriv_email, username, created_at`,
                [loginid, email, username]
            );
            user = insert.rows[0];

            // Auto-save the encrypted Deriv token for WebSocket proxy use
            if (deriv_token) {
                const encrypted = encryptToken(deriv_token);
                await pool.query(
                    `INSERT INTO api_tokens (user_id, token_encrypted, token_name, deriv_loginid, is_oauth, is_active)
                     VALUES ($1, $2, 'Deriv OAuth Token', $3, TRUE, TRUE)
                     ON CONFLICT ON CONSTRAINT idx_api_tokens_deriv_loginid_oauth DO NOTHING`,
                    [user.id, encrypted, loginid]
                );
            }
        } else {
            // Update email and refresh token on every login
            await pool.query('UPDATE users SET deriv_email = $1 WHERE id = $2', [email, user.id]);
            if (deriv_token) {
                const encrypted = encryptToken(deriv_token);
                await pool.query(
                    `UPDATE api_tokens SET token_encrypted = $1, last_used_at = NOW()
                     WHERE user_id = $2 AND is_oauth = TRUE`,
                    [encrypted, user.id]
                );
            }
        }

        const jwtToken = jwt.sign({ id: user.id, deriv_loginid: loginid, username: user.username }, JWT_SECRET, {
            expiresIn: '30d',
        });

        res.json({
            token: jwtToken,
            user: {
                id: user.id,
                deriv_loginid: loginid,
                deriv_email: email,
                username: user.username,
                created_at: user.created_at,
            },
        });
    } catch (err) {
        console.error('[Auth/Deriv] DB error:', err.message);
        res.status(500).json({ error: 'Failed to create session' });
    }
});
// PKCE step 1: exchange authorization code for OIDC access token (server-side, no CORS)
app.post('/api/auth/pkce-exchange', authLimiter, async (req, res) => {
    const { code, code_verifier, redirect_uri } = req.body;
    if (!code || !code_verifier || !redirect_uri) {
        return res.status(400).json({ error: 'code, code_verifier and redirect_uri are required' });
    }
    try {
        const response = await fetch('https://auth.deriv.com/oauth2/token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
                grant_type: 'authorization_code',
                client_id: '33s7LwZCzluES8H4HmjIK',
                code,
                code_verifier,
                redirect_uri,
            }),
        });
        const rawText = await response.text();
        console.log('[PKCE] Legacy tokens raw response:', response.status, rawText.substring(0, 500));
        const data = JSON.parse(rawText);
        if (!response.ok) {
            return res
                .status(response.status)
                .json({ error: data.error_description || data.error || 'Token exchange failed' });
        }
        res.json({ access_token: data.access_token });
    } catch (err) {
        console.error('[PKCE] Token exchange error:', err.message);
        res.status(500).json({ error: 'Token exchange failed' });
    }
});

// PKCE step 2: convert OIDC access token → Deriv legacy tokens (server-side, no CORS)
app.post('/api/auth/legacy-tokens', authLimiter, async (req, res) => {
    const { access_token } = req.body;
    if (!access_token) {
        return res.status(400).json({ error: 'access_token is required' });
    }
    try {
        console.log('[PKCE] Calling legacy tokens endpoint with access_token:', access_token?.substring(0, 20));
        const response = await fetch('https://oauth.deriv.com/oauth2/legacy/tokens', {
            method: 'POST',
            headers: { Authorization: `Bearer ${access_token}` },
        });
        const data = await response.json();
        console.log('[PKCE] Legacy tokens response status:', response.status, 'data:', JSON.stringify(data).substring(0, 200));
        if (!response.ok) {
            return res
                .status(response.status)
                .json({ error: data.error_description || data.error || 'Legacy token request failed' });
        }
        res.json(data);
    } catch (err) {
        console.error('[PKCE] Legacy token error:', err.message);
        res.status(500).json({ error: 'Legacy token request failed' });
    }
});

app.post('/api/tokens', authMiddleware, async (req, res) => {
    const { token, token_name } = req.body;
    if (!token) return res.status(400).json({ error: 'token is required' });

    try {
        const ws = new WebSocket(`wss://ws.derivws.com/websockets/v3?app_id=${DERIV_APP_ID}`);
        let settled = false;
        const timeout = setTimeout(() => {
            if (!settled) {
                settled = true;
                ws.close();
                res.status(408).json({ error: 'Deriv API timeout' });
            }
        }, 10000);

        ws.on('open', () => {
            ws.send(JSON.stringify({ authorize: token }));
        });

        ws.on('message', async data => {
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
            if (!settled) {
                settled = true;
                clearTimeout(timeout);
                res.status(502).json({ error: 'Could not connect to Deriv API' });
            }
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
    const {
        deriv_contract_id,
        symbol,
        trade_type,
        stake,
        payout,
        profit,
        duration,
        duration_unit,
        entry_spot,
        exit_spot,
        result: tradeResult,
        status,
        opened_at,
        closed_at,
        raw_data,
    } = req.body;
    if (!symbol || !trade_type || stake == null) {
        return res.status(400).json({ error: 'symbol, trade_type and stake are required' });
    }
    try {
        const r = await pool.query(
            `INSERT INTO trade_history (user_id, deriv_contract_id, symbol, trade_type, stake, payout, profit, duration, duration_unit, entry_spot, exit_spot, result, status, opened_at, closed_at, raw_data)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) RETURNING *`,
            [
                req.user.id,
                deriv_contract_id,
                symbol,
                trade_type,
                stake,
                payout,
                profit,
                duration,
                duration_unit,
                entry_spot,
                exit_spot,
                tradeResult,
                status || 'open',
                opened_at || new Date(),
                closed_at,
                raw_data ? JSON.stringify(raw_data) : null,
            ]
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
        if (symbol) {
            params.push(symbol);
            q += ` AND symbol = $${params.length}`;
        }
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
        stats.win_rate = stats.total_trades > 0 ? ((stats.wins / stats.total_trades) * 100).toFixed(1) : '0.0';
        res.json({ stats });
    } catch (err) {
        res.status(500).json({ error: 'Failed to fetch stats' });
    }
});

// ── PKCE TOKEN EXCHANGE ──────────────────────────────────────────────────────
// Server-side code → access_token exchange per Deriv OAuth2 PKCE documentation.
// The browser must never perform this exchange directly (PKCE best practice).
//
// POST /api/auth/pkce-token
//   Body: { code, code_verifier, redirect_uri, client_id }
//   Returns: { access_token, token_type, expires_in, … }
app.post('/api/auth/pkce-token', authLimiter, async (req, res) => {
    const { code, code_verifier, redirect_uri, client_id } = req.body;

    if (!code || !code_verifier || !redirect_uri) {
        return res.status(400).json({
            error: 'code, code_verifier, and redirect_uri are required',
        });
    }

    const resolved_client_id = client_id || DERIV_OAUTH_CLIENT_ID;
    if (!VALID_CLIENT_IDS.has(resolved_client_id)) {
        return res.status(400).json({ error: 'Invalid client_id' });
    }

    const params = new URLSearchParams();
    params.append('grant_type', 'authorization_code');
    params.append('client_id', resolved_client_id);
    params.append('code', code);
    params.append('code_verifier', code_verifier);
    params.append('redirect_uri', redirect_uri);

    try {
        const response = await fetch('https://auth.deriv.com/oauth2/token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: params.toString(),
        });

        const data = await response.json();

        if (!response.ok) {
            console.error('[PKCE] Token exchange failed:', data);
            return res.status(response.status).json({
                error: data.error_description || data.error || 'Token exchange failed',
            });
        }

        res.json(data);
    } catch (err) {
        console.error('[PKCE] Token exchange error:', err.message);
        res.status(500).json({ error: 'Token exchange request failed' });
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

    derivWs.on('message', data => {
        if (clientWs.readyState === WebSocket.OPEN) {
            clientWs.send(data.toString());
        }
    });

    derivWs.on('close', () => {
        if (clientWs.readyState === WebSocket.OPEN) {
            clientWs.send(JSON.stringify({ type: 'proxy_disconnected' }));
        }
    });

    derivWs.on('error', err => {
        console.error('[WS Proxy] Deriv WS error:', err.message);
    });

    clientWs.on('message', async data => {
        let msg;
        try {
            msg = JSON.parse(data.toString());
        } catch {
            return;
        }

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

// ── OAUTH2 PROVIDER FLOW ─────────────────────────────────────────────────────
// Hydra-style opaque consent_challenge flow for this app as an OAuth2 server

const SCOPE_LABELS = {
    'read:profile': 'View your profile information',
    'read:trading': 'View your trading data',
    trading: 'Place trades',
    'read:balance': 'View your account balance',
};

// GET /api/oauth/authorize
// Client app redirects user here to start the flow.
// Creates an opaque consent_challenge and redirects to the consent UI.
app.get('/api/oauth/authorize', async (req, res) => {
    const {
        client_id,
        redirect_uri,
        scope = 'read:profile read:trading trading',
        state,
        response_type = 'code',
    } = req.query;

    if (!client_id || !redirect_uri) {
        return res.status(400).json({ error: 'client_id and redirect_uri are required' });
    }
    if (response_type !== 'code') {
        return res.status(400).json({ error: 'Only response_type=code is supported' });
    }

    try {
        const clientRow = await pool.query('SELECT * FROM oauth_clients WHERE id = $1', [client_id]);
        if (!clientRow.rows[0]) {
            return res.status(401).json({ error: 'Unknown client_id' });
        }
        const client = clientRow.rows[0];

        if (!client.redirect_uris.includes(redirect_uri)) {
            return res.status(400).json({ error: 'redirect_uri not registered for this client' });
        }

        const challenge = crypto.randomBytes(48).toString('base64url');
        await pool.query(
            `INSERT INTO oauth_consent_challenges (challenge, client_id, redirect_uri, scope, state)
             VALUES ($1, $2, $3, $4, $5)`,
            [challenge, client_id, redirect_uri, scope, state || null]
        );

        // Redirect to the frontend consent UI
        const consentUrl = `/oauth/consent?consent_challenge=${challenge}`;
        res.redirect(302, consentUrl);
    } catch (err) {
        console.error('[OAuth/authorize]', err.message);
        res.status(500).json({ error: 'Authorization failed' });
    }
});

// GET /api/oauth/consent?consent_challenge=...
// Returns the challenge details so the consent UI can render what to show.
app.get('/api/oauth/consent', async (req, res) => {
    const { consent_challenge } = req.query;
    if (!consent_challenge) return res.status(400).json({ error: 'consent_challenge is required' });

    try {
        const row = await pool.query(
            `SELECT c.challenge, c.client_id, c.scope, c.state, c.status, c.expires_at,
                    cl.name AS client_name, cl.scopes AS allowed_scopes
             FROM oauth_consent_challenges c
             JOIN oauth_clients cl ON cl.id = c.client_id
             WHERE c.challenge = $1`,
            [consent_challenge]
        );
        if (!row.rows[0]) return res.status(404).json({ error: 'Invalid or expired consent_challenge' });

        const ch = row.rows[0];
        if (ch.status !== 'pending') return res.status(410).json({ error: 'Challenge already used' });
        if (new Date(ch.expires_at) < new Date()) return res.status(410).json({ error: 'Challenge expired' });

        const requestedScopes = ch.scope.split(' ').filter(Boolean);
        const scopeDetails = requestedScopes.map((s, i) => ({
            scope: s,
            label: SCOPE_LABELS[s] || s,
            index: i + 1,
        }));

        res.json({
            consent_challenge: ch.challenge,
            client_id: ch.client_id,
            client_name: ch.client_name,
            scopes: scopeDetails,
            expires_at: ch.expires_at,
        });
    } catch (err) {
        console.error('[OAuth/consent GET]', err.message);
        res.status(500).json({ error: 'Failed to fetch challenge' });
    }
});

// POST /api/oauth/consent
// User accepts or denies. Requires TM JWT auth.
// Body: { consent_challenge, action: 'allow' | 'deny' }
app.post('/api/oauth/consent', authMiddleware, async (req, res) => {
    const { consent_challenge, action } = req.body;
    if (!consent_challenge) return res.status(400).json({ error: 'consent_challenge is required' });
    if (!['allow', 'deny'].includes(action)) return res.status(400).json({ error: 'action must be allow or deny' });

    try {
        const row = await pool.query('SELECT * FROM oauth_consent_challenges WHERE challenge = $1', [
            consent_challenge,
        ]);
        if (!row.rows[0]) return res.status(404).json({ error: 'Invalid consent_challenge' });

        const ch = row.rows[0];
        if (ch.status !== 'pending') return res.status(410).json({ error: 'Challenge already used' });
        if (new Date(ch.expires_at) < new Date()) return res.status(410).json({ error: 'Challenge expired' });

        if (action === 'deny') {
            await pool.query('UPDATE oauth_consent_challenges SET status = $1 WHERE challenge = $2', [
                'denied',
                consent_challenge,
            ]);
            const denyUrl = `${ch.redirect_uri}?error=access_denied${ch.state ? `&state=${encodeURIComponent(ch.state)}` : ''}`;
            return res.json({ redirect_to: denyUrl });
        }

        // Allow — generate opaque auth code
        const authCode = crypto.randomBytes(32).toString('base64url');
        await pool.query(
            `INSERT INTO oauth_auth_codes (code, client_id, user_id, redirect_uri, scope)
             VALUES ($1, $2, $3, $4, $5)`,
            [authCode, ch.client_id, req.user.id, ch.redirect_uri, ch.scope]
        );
        await pool.query(
            'UPDATE oauth_consent_challenges SET status = $1, auth_code = $2, user_id = $3 WHERE challenge = $4',
            ['accepted', authCode, req.user.id, consent_challenge]
        );

        const qs = new URLSearchParams({ code: authCode });
        if (ch.state) qs.set('state', ch.state);
        const redirectTo = `${ch.redirect_uri}?${qs.toString()}`;
        res.json({ redirect_to: redirectTo });
    } catch (err) {
        console.error('[OAuth/consent POST]', err.message);
        res.status(500).json({ error: 'Consent processing failed' });
    }
});

// POST /api/oauth/token
// Exchange auth code for an access token.
// Body: { grant_type, code, redirect_uri, client_id, client_secret }
app.post('/api/oauth/token', async (req, res) => {
    const { grant_type, code, redirect_uri, client_id, client_secret } = req.body;

    if (grant_type !== 'authorization_code') {
        return res.status(400).json({ error: 'Only grant_type=authorization_code is supported' });
    }
    if (!code || !redirect_uri || !client_id || !client_secret) {
        return res.status(400).json({ error: 'code, redirect_uri, client_id and client_secret are required' });
    }

    try {
        const clientRow = await pool.query('SELECT * FROM oauth_clients WHERE id = $1', [client_id]);
        if (!clientRow.rows[0]) return res.status(401).json({ error: 'Unknown client_id' });

        const client = clientRow.rows[0];
        const secretValid = await bcrypt.compare(client_secret, client.secret_hash);
        if (!secretValid) return res.status(401).json({ error: 'Invalid client_secret' });

        const codeRow = await pool.query('SELECT * FROM oauth_auth_codes WHERE code = $1', [code]);
        if (!codeRow.rows[0]) return res.status(400).json({ error: 'Invalid or unknown code' });

        const ac = codeRow.rows[0];
        if (ac.used) return res.status(400).json({ error: 'Code already used' });
        if (new Date(ac.expires_at) < new Date()) return res.status(400).json({ error: 'Code expired' });
        if (ac.client_id !== client_id) return res.status(400).json({ error: 'client_id mismatch' });
        if (ac.redirect_uri !== redirect_uri) return res.status(400).json({ error: 'redirect_uri mismatch' });

        await pool.query('UPDATE oauth_auth_codes SET used = TRUE WHERE code = $1', [code]);

        const userRow = await pool.query('SELECT id, username, email, deriv_loginid FROM users WHERE id = $1', [
            ac.user_id,
        ]);
        const user = userRow.rows[0];

        const accessToken = jwt.sign(
            {
                sub: user.id,
                username: user.username,
                deriv_loginid: user.deriv_loginid,
                scope: ac.scope,
                client_id,
                iss: 'trademasters',
            },
            JWT_SECRET,
            { expiresIn: '1h' }
        );

        res.json({
            access_token: accessToken,
            token_type: 'Bearer',
            expires_in: 3600,
            scope: ac.scope,
        });
    } catch (err) {
        console.error('[OAuth/token]', err.message);
        res.status(500).json({ error: 'Token exchange failed' });
    }
});

// POST /api/oauth/clients/register  (admin only — secured by a master secret)
// Register a new OAuth client (app). Returns client_id + client_secret (shown once).
app.post('/api/oauth/clients/register', async (req, res) => {
    const masterSecret = req.headers['x-admin-secret'];
    if (!masterSecret || masterSecret !== (process.env.ADMIN_SECRET || 'trademasters-admin')) {
        return res.status(403).json({ error: 'Forbidden' });
    }

    const { name, redirect_uris, scopes } = req.body;
    if (!name || !Array.isArray(redirect_uris) || redirect_uris.length === 0) {
        return res.status(400).json({ error: 'name and redirect_uris[] are required' });
    }

    const clientId = crypto.randomBytes(16).toString('hex');
    const clientSecret = crypto.randomBytes(32).toString('base64url');
    const secretHash = await bcrypt.hash(clientSecret, 10);
    const allowedScopes = scopes || ['read:profile', 'read:trading', 'trading'];

    await pool.query(
        'INSERT INTO oauth_clients (id, secret_hash, name, redirect_uris, scopes) VALUES ($1, $2, $3, $4, $5)',
        [clientId, secretHash, name, redirect_uris, allowedScopes]
    );

    res.status(201).json({
        client_id: clientId,
        client_secret: clientSecret,
        note: 'Store the client_secret now — it will not be shown again',
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
    server.close(() => {
        pool.end();
        process.exit(0);
    });
});
