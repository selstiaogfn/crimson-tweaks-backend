const express = require('express');
const cors = require('cors');
const sqlite3 = require('sqlite3').verbose();
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const rateLimit = require('express-rate-limit');
const helmet = require('helmet');
const path = require('path');
const fs = require('fs');
const session = require('express-session');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3001;
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-this';
const BOT_REGISTER_SECRET = process.env.BOT_REGISTER_SECRET || 'crimson-register-secret-2024';
const BOT_ADMIN_SECRET = process.env.BOT_ADMIN_SECRET || 'crimson-admin-secret-2024';
const DISCORD_CLIENT_ID = process.env.DISCORD_CLIENT_ID || 'YOUR_DISCORD_CLIENT_ID';
const DISCORD_CLIENT_SECRET = process.env.DISCORD_CLIENT_SECRET || 'YOUR_DISCORD_CLIENT_SECRET';
const DISCORD_REDIRECT_URI = process.env.DISCORD_REDIRECT_URI || 'http://localhost:3001/auth/discord/callback';

// Load licenses from bot's JSON file
const LICENSES_FILE = path.join(__dirname, '..', 'discord-bot', 'licenses.json');
console.log('License file path:', LICENSES_FILE);
console.log('File exists:', fs.existsSync(LICENSES_FILE));

function loadLicenses() {
    try {
        if (fs.existsSync(LICENSES_FILE)) {
            const data = JSON.parse(fs.readFileSync(LICENSES_FILE, 'utf8'));
            console.log('Loaded licenses:', Object.keys(data.licenses || {}));
            return data.licenses || {};
        } else {
            console.log('License file not found at:', LICENSES_FILE);
        }
    } catch (err) {
        console.error('Error loading licenses:', err);
    }
    return {};
}

function saveLicenses(licenses) {
    try {
        const data = { licenses, users: {}, logs: [] };
        fs.writeFileSync(LICENSES_FILE, JSON.stringify(data, null, 2));
    } catch (err) {
        console.error('Error saving licenses:', err);
    }
}

function normalizeHwid(value) {
    return String(value || '').trim().toLowerCase();
}

function generateTempPassword() {
    return crypto.randomBytes(16).toString('hex');
}

// Middleware
app.use(helmet());
app.use(cors({
    origin: ['http://localhost:3000', 'tauri://localhost'],
    credentials: true
}));
app.use(express.json());

// Session middleware
app.use(session({
    secret: process.env.SESSION_SECRET || 'your-session-secret',
    resave: false,
    saveUninitialized: false,
    cookie: {
        secure: false, // Set to true in production with HTTPS
        maxAge: 1000 * 60 * 60 * 24 // 24 hours
    }
}));

// Rate limiting
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100 // limit each IP to 100 requests per windowMs
});
app.use('/api/', limiter);

// Database setup
const dbPath = path.join(__dirname, 'database.sqlite');
const db = new sqlite3.Database(dbPath, (err) => {
    if (err) {
        console.error('Error opening database:', err);
    } else {
        console.log('Connected to SQLite database');
        initDatabase();
    }
});

// Initialize database tables
function initDatabase() {
    db.run(`
        CREATE TABLE IF NOT EXISTS licenses (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            key TEXT UNIQUE NOT NULL,
            discord_id TEXT,
            discord_username TEXT,
            hwid TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            expires_at DATETIME,
            activated BOOLEAN DEFAULT 0,
            activations INTEGER DEFAULT 0,
            last_activation DATETIME,
            revoked BOOLEAN DEFAULT 0,
            notes TEXT
        )
    `);

    db.run(`
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            discord_id TEXT UNIQUE,
            discord_username TEXT,
            email TEXT,
            password_hash TEXT,
            is_admin BOOLEAN DEFAULT 0,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            last_login DATETIME
        )
    `);

    db.run(`
        CREATE TABLE IF NOT EXISTS activations (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            license_key TEXT,
            hwid TEXT,
            ip_address TEXT,
            timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
            success BOOLEAN,
            error_message TEXT
        )
    `);

    db.run(`
        CREATE TABLE IF NOT EXISTS settings (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            key TEXT UNIQUE NOT NULL,
            value TEXT
        )
    `);

    // Insert default version
    db.run(`
        INSERT OR IGNORE INTO settings (key, value) VALUES 
        ('app_version', '1.0.0'),
        ('minimum_version', '1.0.0'),
        ('maintenance_mode', 'false')
    `);

    console.log('Database tables initialized');
}

// Generate license key
function generateLicenseKey() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let key = '';
    for (let i = 0; i < 4; i++) {
        for (let j = 0; j < 4; j++) {
            key += chars.charAt(Math.floor(Math.random() * chars.length));
        }
        if (i < 3) key += '-';
    }
    return key;
}

// Authentication middleware
const authenticateToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
        return res.status(401).json({ error: 'Access token required' });
    }

    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) {
            return res.status(403).json({ error: 'Invalid token' });
        }
        req.user = user;
        next();
    });
};

// Admin middleware
const requireAdmin = (req, res, next) => {
    if (!req.user || !req.user.is_admin) {
        return res.status(403).json({ error: 'Admin access required' });
    }
    next();
};

// Routes

// Register with email/password
app.post('/auth/register', async (req, res) => {
    const providedSecret = req.headers['x-bot-register-key'];
    if (!BOT_REGISTER_SECRET || providedSecret !== BOT_REGISTER_SECRET) {
        return res.status(403).json({ success: false, message: 'Registration is only available through Discord bot' });
    }

    const { email, password, username, discord_id } = req.body;

    if (!email || !password) {
        return res.status(400).json({ success: false, message: 'Email and password are required' });
    }

    const normalizedEmail = String(email).trim().toLowerCase();
    const normalizedUsername = String(username || normalizedEmail.split('@')[0]).trim().slice(0, 64);

    if (password.length < 6) {
        return res.status(400).json({ success: false, message: 'Password must be at least 6 characters' });
    }

    db.get('SELECT id FROM users WHERE email = ?', [normalizedEmail], async (err, existing) => {
        if (err) {
            return res.status(500).json({ success: false, message: 'Database error' });
        }
        if (existing) {
            // If this email already exists but Discord id was not saved yet, update it.
            if (!discord_id) {
                return res.status(409).json({ success: false, message: 'Email already registered' });
            }

            try {
                const passwordHash = await bcrypt.hash(password, 10);
                const normalizedDiscordId = discord_id ? String(discord_id).trim() : '';
                const discordIdValue = normalizedDiscordId || null;

                db.run(
                    `UPDATE users SET discord_id = ?, discord_username = ?, password_hash = ? WHERE id = ?`,
                    [discordIdValue, normalizedUsername, passwordHash, existing.id],
                    function(updateErr) {
                        if (updateErr) {
                            return res.status(500).json({ success: false, message: 'Failed to update account' });
                        }

                        const token = jwt.sign(
                            {
                                user_id: existing.id,
                                email: normalizedEmail,
                                username: normalizedUsername,
                                is_admin: false,
                                auth_type: 'local'
                            },
                            JWT_SECRET,
                            { expiresIn: '7d' }
                        );

                        return res.json({
                            success: true,
                            token,
                            user: {
                                id: existing.id,
                                email: normalizedEmail,
                                username: normalizedUsername
                            }
                        });
                    }
                );
            } catch {
                return res.status(500).json({ success: false, message: 'Failed to secure password' });
            }
            return;
        }

        try {
            const passwordHash = await bcrypt.hash(password, 10);
            const normalizedDiscordId = discord_id ? String(discord_id).trim() : '';
            const discordIdValue = normalizedDiscordId || null;
            db.run(
                `INSERT INTO users (discord_id, discord_username, email, password_hash, is_admin)
                 VALUES (?, ?, ?, ?, 0)`,
                [discordIdValue, normalizedUsername, normalizedEmail, passwordHash],
                function(insertErr) {
                    if (insertErr) {
                        return res.status(500).json({ success: false, message: 'Failed to create account' });
                    }

                    const token = jwt.sign(
                        {
                            user_id: this.lastID,
                            email: normalizedEmail,
                            username: normalizedUsername,
                            is_admin: false,
                            auth_type: 'local'
                        },
                        JWT_SECRET,
                        { expiresIn: '7d' }
                    );

                    return res.json({
                        success: true,
                        token,
                        user: {
                            id: this.lastID,
                            email: normalizedEmail,
                            username: normalizedUsername
                        }
                    });
                }
            );
        } catch (hashErr) {
            return res.status(500).json({ success: false, message: 'Failed to secure password' });
        }
    });
});

// Login with email/password
app.post('/auth/login', (req, res) => {
    const { email, password } = req.body;
    if (!email || !password) {
        return res.status(400).json({ success: false, message: 'Email and password are required' });
    }

    const normalizedEmail = String(email).trim().toLowerCase();
    db.get(
        `SELECT id, email, discord_username, password_hash, is_admin
         FROM users WHERE email = ?`,
        [normalizedEmail],
        async (err, user) => {
            if (err) {
                return res.status(500).json({ success: false, message: 'Database error' });
            }
            if (!user || !user.password_hash) {
                return res.status(401).json({ success: false, message: 'Invalid credentials' });
            }

            const ok = await bcrypt.compare(password, user.password_hash);
            if (!ok) {
                return res.status(401).json({ success: false, message: 'Invalid credentials' });
            }

            db.run('UPDATE users SET last_login = CURRENT_TIMESTAMP WHERE id = ?', [user.id]);

            const token = jwt.sign(
                {
                    user_id: user.id,
                    email: user.email,
                    username: user.discord_username,
                    is_admin: !!user.is_admin,
                    auth_type: 'local'
                },
                JWT_SECRET,
                { expiresIn: '7d' }
            );

            return res.json({
                success: true,
                token,
                user: {
                    id: user.id,
                    email: user.email,
                    username: user.discord_username
                }
            });
        }
    );
});

// Validate current auth session
app.get('/auth/me', authenticateToken, (req, res) => {
    if (req.user.auth_type === 'local') {
        db.get(
            `SELECT discord_id, discord_username FROM users WHERE id = ?`,
            [req.user.user_id],
            (err, row) => {
                if (err) {
                    return res.status(500).json({ success: false, message: 'Database error' });
                }
                return res.json({
                    success: true,
                    user: {
                        id: req.user.user_id,
                        email: req.user.email,
                        username: req.user.username,
                        discord_id: row?.discord_id || null,
                        discord_username: row?.discord_username || null
                    }
                });
            }
        );
        return;
    }

    return res.json({ success: true, user: req.user });
});

// Simple password reset for bot-registered accounts
app.post('/auth/set-password', async (req, res) => {
    const { email, password } = req.body;
    
    if (!email || !password) {
        return res.status(400).json({ success: false, message: 'Email and password are required' });
    }

    if (password.length < 6) {
        return res.status(400).json({ success: false, message: 'Password must be at least 6 characters' });
    }

    const normalizedEmail = String(email).trim().toLowerCase();

    try {
        const passwordHash = await bcrypt.hash(password, 10);
        
        db.run(
            'UPDATE users SET password_hash = ? WHERE email = ?',
            [passwordHash, normalizedEmail],
            function(err) {
                if (err) {
                    return res.status(500).json({ success: false, message: 'Database error' });
                }
                if (this.changes === 0) {
                    return res.status(404).json({ success: false, message: 'Email not found' });
                }
                return res.json({ 
                    success: true, 
                    message: 'Password set successfully. You can now login.' 
                });
            }
        );
    } catch {
        return res.status(500).json({ success: false, message: 'Failed to set password' });
    }
});

// Bot/admin password reset endpoint (owner/dev command path)
app.post('/auth/admin/reset-password', async (req, res) => {
    const providedSecret = req.headers['x-bot-admin-key'];
    if (!BOT_ADMIN_SECRET || providedSecret !== BOT_ADMIN_SECRET) {
        return res.status(403).json({ success: false, message: 'Forbidden' });
    }

    const { email, new_password, username } = req.body;
    const normalizedEmail = String(email || '').trim().toLowerCase();
    const normalizedUsername = String(username || '').trim();
    const passwordToSet = String(new_password || generateTempPassword()).trim().toLowerCase();
    const hexPasswordPattern = /^[0-9a-f]{32}$/;
    if (!hexPasswordPattern.test(passwordToSet)) {
        return res.status(400).json({ success: false, message: 'Password must be a 32-character lowercase hex string' });
    }

    const whereClause = normalizedEmail ? 'email = ?' : 'discord_username = ?';
    const whereValue = normalizedEmail || normalizedUsername;
    if (!whereValue) {
        return res.status(400).json({ success: false, message: 'Email or username is required' });
    }

    try {
        const passwordHash = await bcrypt.hash(passwordToSet, 10);
        db.run(
            `UPDATE users SET password_hash = ? WHERE ${whereClause}`,
            [passwordHash, whereValue],
            function(err) {
                if (err) {
                    return res.status(500).json({ success: false, message: 'Database error' });
                }
                if (this.changes === 0) {
                    return res.status(404).json({ success: false, message: 'User not found' });
                }
                return res.json({
                    success: true,
                    message: 'Password reset successfully',
                    temporary_password: passwordToSet
                });
            }
        );
    } catch {
        return res.status(500).json({ success: false, message: 'Failed to reset password' });
    }
});

// User delete endpoint (for bot commands)
app.post('/auth/delete-account', async (req, res) => {
    const providedSecret = req.headers['x-bot-register-key'];
    if (!BOT_REGISTER_SECRET || providedSecret !== BOT_REGISTER_SECRET) {
        return res.status(403).json({ success: false, message: 'Forbidden' });
    }

    const { email, username } = req.body;
    const normalizedEmail = String(email || '').trim().toLowerCase();
    const normalizedUsername = String(username || '').trim();
    const whereClause = normalizedEmail ? 'email = ?' : 'discord_username = ?';
    const whereValue = normalizedEmail || normalizedUsername;

    if (!whereValue) {
        return res.status(400).json({ success: false, message: 'Email or username is required' });
    }

    db.run(
        `DELETE FROM users WHERE ${whereClause}`,
        [whereValue],
        function(err) {
            if (err) {
                return res.status(500).json({ success: false, message: 'Failed to delete account' });
            }
            if (this.changes === 0) {
                return res.status(404).json({ success: false, message: 'Account not found' });
            }
            return res.json({ 
                success: true, 
                message: 'Account deleted successfully' 
            });
        }
    );
});

// Developer and Admin delete account endpoint
app.post('/auth/admin/delete-account', async (req, res) => {
    const providedSecret = req.headers['x-bot-admin-key'];
    if (!BOT_ADMIN_SECRET || providedSecret !== BOT_ADMIN_SECRET) {
        return res.status(403).json({ success: false, message: 'Forbidden' });
    }

    const { email, username } = req.body;
    const normalizedEmail = String(email || '').trim().toLowerCase();
    const normalizedUsername = String(username || '').trim();
    const whereClause = normalizedEmail ? 'email = ?' : 'discord_username = ?';
    const whereValue = normalizedEmail || normalizedUsername;

    if (!whereValue) {
        return res.status(400).json({ success: false, message: 'Email or username is required' });
    }

    db.run(
        `DELETE FROM users WHERE ${whereClause}`,
        [whereValue],
        function(err) {
            if (err) {
                return res.status(500).json({ success: false, message: 'Database error' });
            }
            if (this.changes === 0) {
                return res.status(404).json({ success: false, message: 'Account not found' });
            }
            return res.json({ success: true, message: 'Account deleted successfully' });
        }
    );
});

// Health check
app.get('/ping', (req, res) => {
    res.json({ 
        status: 'ok', 
        timestamp: new Date().toISOString(),
        version: '1.0.0'
    });
});

// Get app version
app.get('/version', (req, res) => {
    db.get('SELECT value FROM settings WHERE key = ?', ['app_version'], (err, row) => {
        if (err) {
            return res.status(500).json({ error: 'Database error' });
        }
        res.json({ 
            latest: row?.value || '1.0.0',
            minimum: '1.0.0',
            download_url: process.env.DOWNLOAD_URL || null
        });
    });
});

// Verify license
app.post('/verify', async (req, res) => {
    const { license_key, hwid, version, discord_id } = req.body;
    const ipAddress = req.ip || req.connection.remoteAddress;

    if (!license_key || !hwid) {
        return res.status(400).json({ 
            success: false, 
            message: 'License key and HWID required' 
        });
    }

    const key = license_key.toUpperCase().trim();
    const normalizedHwid = normalizeHwid(hwid);
    if (!normalizedHwid || normalizedHwid === 'unknown') {
        return res.status(400).json({
            success: false,
            message: 'Invalid HWID'
        });
    }

    const licenses = loadLicenses();
    const license = licenses[key];

    if (!license) {
        logActivation(key, hwid, ipAddress, false, 'Invalid license key');
        return res.json({ 
            success: false, 
            message: 'Invalid license key' 
        });
    }

    if (license.revoked) {
        logActivation(key, hwid, ipAddress, false, 'License revoked');
        return res.json({ 
            success: false, 
            message: 'License has been revoked' 
        });
    }

    if (license.expiresAt && new Date(license.expiresAt) < new Date()) {
        logActivation(key, hwid, ipAddress, false, 'License expired');
        return res.json({ 
            success: false, 
            message: 'License has expired' 
        });
    }

    // Migrate legacy field names if present.
    const existingHwid = normalizeHwid(license.hwid || license.machineId || license.hardwareId);

    // Lock license activation to the Discord account that owns it.
    const normalizedDiscordId = String(discord_id || '').trim();
    const licenseDiscordId = String(license.discordId || '').trim();
    if (!normalizedDiscordId) {
        return res.status(400).json({
            success: false,
            message: 'discord_id is required for activation'
        });
    }
    if (!licenseDiscordId) {
        return res.status(403).json({
            success: false,
            message: 'This license is not linked to a Discord account'
        });
    }
    if (licenseDiscordId !== normalizedDiscordId) {
        return res.status(403).json({
            success: false,
            message: 'License bound to a different Discord account'
        });
    }

    // Check HWID binding (strict lock to first activation machine)
    if (existingHwid && existingHwid !== normalizedHwid) {
        logActivation(key, hwid, ipAddress, false, 'HWID mismatch');
        return res.json({ 
            success: false, 
            message: 'License bound to different hardware' 
        });
    }

    // Success - update license
    const token = jwt.sign(
        { 
            license_key: key, 
            hwid: normalizedHwid, 
            discord_id: license.discordId 
        },
        JWT_SECRET,
        { expiresIn: '7d' }
    );

    // Update license in JSON
    licenses[key].hwid = normalizedHwid;
    licenses[key].activated = true;
    licenses[key].activations = (licenses[key].activations || 0) + 1;
    licenses[key].lastActivation = new Date().toISOString();
    if (!licenses[key].hwidLockedAt) {
        licenses[key].hwidLockedAt = new Date().toISOString();
    }
    saveLicenses(licenses);

    logActivation(key, hwid, ipAddress, true, null);

    res.json({
        success: true,
        message: 'License activated successfully',
        token,
        discord_id: license.discordId,
        discord_username: license.discordUsername,
        discord_avatar: license.discordId ? `https://cdn.discordapp.com/avatars/${license.discordId}/${license.discordId}.png` : null,
        expires_at: license.expiresAt,
        activated: true
    });
});

// Log activation
function logActivation(licenseKey, hwid, ipAddress, success, errorMessage) {
    db.run(
        'INSERT INTO activations (license_key, hwid, ip_address, success, error_message) VALUES (?, ?, ?, ?, ?)',
        [licenseKey, hwid, ipAddress, success, errorMessage]
    );
}

// Admin: Generate license
app.post('/admin/licenses', authenticateToken, requireAdmin, (req, res) => {
    const { discord_id, discord_username, days, notes } = req.body;

    const key = generateLicenseKey();
    const expiresAt = days ? new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString() : null;

    db.run(
        `INSERT INTO licenses (key, discord_id, discord_username, expires_at, notes) 
         VALUES (?, ?, ?, ?, ?)`,
        [key, discord_id || null, discord_username || null, expiresAt, notes || null],
        function(err) {
            if (err) {
                console.error('Insert error:', err);
                return res.status(500).json({ error: 'Failed to create license' });
            }

            res.json({
                success: true,
                license: {
                    id: this.lastID,
                    key,
                    discord_id,
                    discord_username,
                    expires_at: expiresAt,
                    notes
                }
            });
        }
    );
});

// Admin: Get all licenses
app.get('/admin/licenses', authenticateToken, requireAdmin, (req, res) => {
    const { page = 1, limit = 50, search } = req.query;
    const offset = (page - 1) * limit;

    let query = 'SELECT * FROM licenses';
    let params = [];

    if (search) {
        query += ' WHERE key LIKE ? OR discord_username LIKE ? OR discord_id LIKE ?';
        params = [`%${search}%`, `%${search}%`, `%${search}%`];
    }

    query += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
    params.push(parseInt(limit), parseInt(offset));

    db.all(query, params, (err, rows) => {
        if (err) {
            return res.status(500).json({ error: 'Database error' });
        }

        db.get('SELECT COUNT(*) as total FROM licenses', [], (err, countRow) => {
            res.json({
                licenses: rows,
                pagination: {
                    page: parseInt(page),
                    limit: parseInt(limit),
                    total: countRow?.total || 0
                }
            });
        });
    });
});

// Admin: Revoke license
app.delete('/admin/licenses/:key', authenticateToken, requireAdmin, (req, res) => {
    const { key } = req.params;

    db.run(
        'UPDATE licenses SET revoked = 1 WHERE key = ?',
        [key.toUpperCase()],
        function(err) {
            if (err) {
                return res.status(500).json({ error: 'Database error' });
            }

            if (this.changes === 0) {
                return res.status(404).json({ error: 'License not found' });
            }

            res.json({ success: true, message: 'License revoked' });
        }
    );
});

// Admin: Get license details
app.get('/admin/licenses/:key', authenticateToken, requireAdmin, (req, res) => {
    const { key } = req.params;

    db.get('SELECT * FROM licenses WHERE key = ?', [key.toUpperCase()], (err, license) => {
        if (err) {
            return res.status(500).json({ error: 'Database error' });
        }

        if (!license) {
            return res.status(404).json({ error: 'License not found' });
        }

        // Get activation history
        db.all(
            'SELECT * FROM activations WHERE license_key = ? ORDER BY timestamp DESC LIMIT 50',
            [key.toUpperCase()],
            (err, activations) => {
                res.json({
                    license,
                    activations: activations || []
                });
            }
        );
    });
});

// Admin: Get statistics
app.get('/admin/stats', authenticateToken, requireAdmin, (req, res) => {
    db.get('SELECT COUNT(*) as total FROM licenses', [], (err, totalRow) => {
        db.get('SELECT COUNT(*) as activated FROM licenses WHERE activated = 1', [], (err, activatedRow) => {
            db.get('SELECT COUNT(*) as revoked FROM licenses WHERE revoked = 1', [], (err, revokedRow) => {
                db.get('SELECT COUNT(*) as expired FROM licenses WHERE expires_at < datetime("now")', [], (err, expiredRow) => {
                    db.all(
                        'SELECT date(timestamp) as date, COUNT(*) as count FROM activations WHERE success = 1 GROUP BY date(timestamp) ORDER BY date DESC LIMIT 7',
                        [],
                        (err, dailyActivations) => {
                            res.json({
                                total: totalRow?.total || 0,
                                activated: activatedRow?.activated || 0,
                                revoked: revokedRow?.revoked || 0,
                                expired: expiredRow?.expired || 0,
                                daily_activations: dailyActivations || []
                            });
                        }
                    );
                });
            });
        });
    });
});

// Admin: Get recent activations
app.get('/admin/activations', authenticateToken, requireAdmin, (req, res) => {
    const { limit = 100 } = req.query;

    db.all(
        'SELECT * FROM activations ORDER BY timestamp DESC LIMIT ?',
        [parseInt(limit)],
        (err, rows) => {
            if (err) {
                return res.status(500).json({ error: 'Database error' });
            }
            res.json({ activations: rows });
        }
    );
});

// Discord OAuth callback
app.post('/auth/discord', async (req, res) => {
    const { code } = req.body;

    if (!code) {
        return res.status(400).json({ error: 'Authorization code required' });
    }

    try {
        // Exchange code for access token
        const tokenResponse = await fetch('https://discord.com/api/oauth2/token', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
            },
            body: new URLSearchParams({
                client_id: process.env.DISCORD_CLIENT_ID,
                client_secret: process.env.DISCORD_CLIENT_SECRET,
                grant_type: 'authorization_code',
                code,
                redirect_uri: process.env.DISCORD_REDIRECT_URI,
            }),
        });

        const tokenData = await tokenResponse.json();

        if (!tokenResponse.ok) {
            return res.status(400).json({ error: 'Failed to authenticate with Discord' });
        }

        // Get user info
        const userResponse = await fetch('https://discord.com/api/users/@me', {
            headers: {
                Authorization: `Bearer ${tokenData.access_token}`,
            },
        });

        const userData = await userResponse.json();

        // Check if user has license
        db.all(
            'SELECT * FROM licenses WHERE discord_id = ? AND revoked = 0 AND (expires_at IS NULL OR expires_at > datetime("now"))',
            [userData.id],
            (err, licenses) => {
                if (err) {
                    return res.status(500).json({ error: 'Database error' });
                }

                // Create or update user
                db.run(
                    `INSERT INTO users (discord_id, discord_username, email) 
                     VALUES (?, ?, ?)
                     ON CONFLICT(discord_id) DO UPDATE SET 
                     discord_username = excluded.discord_username,
                     last_login = CURRENT_TIMESTAMP`,
                    [userData.id, userData.username, userData.email]
                );

                // Generate JWT
                const token = jwt.sign(
                    {
                        discord_id: userData.id,
                        username: userData.username,
                        avatar: userData.avatar,
                    },
                    JWT_SECRET,
                    { expiresIn: '7d' }
                );

                res.json({
                    success: true,
                    user: {
                        id: userData.id,
                        username: userData.username,
                        avatar: userData.avatar,
                        email: userData.email,
                    },
                    licenses,
                    token,
                });
            }
        );
    } catch (error) {
        console.error('Discord auth error:', error);
        res.status(500).json({ error: 'Authentication failed' });
    }
});

// User: Get my licenses
app.get('/my-licenses', authenticateToken, (req, res) => {
    const { discord_id } = req.user;

    db.all(
        `SELECT key, created_at, expires_at, activated, activations, last_activation 
         FROM licenses 
         WHERE discord_id = ? AND revoked = 0
         ORDER BY created_at DESC`,
        [discord_id],
        (err, rows) => {
            if (err) {
                return res.status(500).json({ error: 'Database error' });
            }
            res.json({ licenses: rows });
        }
    );
});

// Discord OAuth Routes
app.get('/auth/discord', (req, res) => {
    const state = crypto.randomBytes(16).toString('hex');
    req.session = req.session || {};
    req.session.discordState = state;
    
    const authUrl = `https://discord.com/api/oauth2/authorize?` +
        `client_id=${DISCORD_CLIENT_ID}&` +
        `redirect_uri=${encodeURIComponent(DISCORD_REDIRECT_URI)}&` +
        `response_type=code&` +
        `scope=${encodeURIComponent('identify email')}&` +
        `state=${state}`;
    
    res.redirect(authUrl);
});

app.get('/auth/discord/callback', async (req, res) => {
    const { code, state, error } = req.query;
    
    if (error) {
        return res.send(`
            <script>
                window.opener.postMessage({
                    type: 'DISCORD_AUTH_ERROR',
                    error: '${error}'
                }, 'http://localhost:3000');
                window.close();
            </script>
        `);
    }
    
    if (!code || !state) {
        return res.send(`
            <script>
                window.opener.postMessage({
                    type: 'DISCORD_AUTH_ERROR',
                    error: 'Missing authorization code or state'
                }, 'http://localhost:3000');
                window.close();
            </script>
        `);
    }
    
    try {
        // Exchange code for access token
        const tokenResponse = await fetch('https://discord.com/api/oauth2/token', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
            },
            body: new URLSearchParams({
                client_id: DISCORD_CLIENT_ID,
                client_secret: DISCORD_CLIENT_SECRET,
                grant_type: 'authorization_code',
                code: code,
                redirect_uri: DISCORD_REDIRECT_URI,
            }),
        });
        
        const tokenData = await tokenResponse.json();
        
        if (tokenData.error) {
            throw new Error(tokenData.error_description);
        }
        
        // Get user info
        const userResponse = await fetch('https://discord.com/api/users/@me', {
            headers: {
                'Authorization': `Bearer ${tokenData.access_token}`,
            },
        });
        
        const userData = await userResponse.json();
        
        // Generate JWT token for our app
        const appToken = jwt.sign(
            { 
                discord_id: userData.id,
                discord_username: userData.username,
                discord_avatar: userData.avatar,
                type: 'discord_auth'
            },
            JWT_SECRET,
            { expiresIn: '7d' }
        );
        
        // Send success message to opener
        res.send(`
            <script>
                window.opener.postMessage({
                    type: 'DISCORD_AUTH_SUCCESS',
                    user: ${JSON.stringify(userData)},
                    token: '${appToken}'
                }, 'http://localhost:3000');
                window.close();
            </script>
        `);
        
    } catch (error) {
        console.error('Discord OAuth error:', error);
        res.send(`
            <script>
                window.opener.postMessage({
                    type: 'DISCORD_AUTH_ERROR',
                    error: '${error.message}'
                }, 'http://localhost:3000');
                window.close();
            </script>
        `);
    }
});

// Error handling
app.use((err, req, res, next) => {
    console.error(err.stack);
    res.status(500).json({ error: 'Internal server error' });
});

// 404 handler
app.use((req, res) => {
    res.status(404).json({ error: 'Not found' });
});

// Start server
app.listen(PORT, () => {
    console.log(`Crimson Tweaks Backend Server running on port ${PORT}`);
    console.log(`API Documentation:`);
    console.log(`  POST /verify - Verify license key`);
    console.log(`  GET  /version - Get app version`);
    console.log(`  GET  /ping - Health check`);
    console.log(`  POST /auth/discord - Discord OAuth`);
    console.log(`  GET  /my-licenses - Get user licenses (auth required)`);
    console.log(`  Admin endpoints require JWT token`);
});

// Graceful shutdown
process.on('SIGINT', () => {
    console.log('\nShutting down gracefully...');
    db.close((err) => {
        if (err) {
            console.error('Error closing database:', err);
        } else {
            console.log('Database closed');
        }
        process.exit(0);
    });
});
