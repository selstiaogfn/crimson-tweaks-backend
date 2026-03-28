const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcrypt');
const path = require('path');
const readline = require('readline');

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

const dbPath = path.join(__dirname, 'database.sqlite');
const db = new sqlite3.Database(dbPath);

console.log('Crimson Tweaks Backend Setup\n');

function question(query) {
    return new Promise(resolve => rl.question(query, resolve));
}

async function setup() {
    console.log('Creating admin user...\n');
    
    const username = await question('Admin username: ');
    const password = await question('Admin password: ');
    const discordId = await question('Discord ID (optional, press Enter to skip): ');
    
    const passwordHash = await bcrypt.hash(password, 10);
    
    db.run(
        `INSERT OR REPLACE INTO users (discord_username, password_hash, discord_id, is_admin) 
         VALUES (?, ?, ?, 1)`,
        [username, passwordHash, discordId || null],
        function(err) {
            if (err) {
                console.error('Error creating admin:', err);
            } else {
                console.log('\n✅ Admin user created successfully!');
                console.log(`Username: ${username}`);
                console.log(`Discord ID: ${discordId || 'Not set'}`);
            }
            rl.close();
            db.close();
        }
    );
}

// Ensure tables exist first
db.run(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    discord_id TEXT UNIQUE,
    discord_username TEXT,
    email TEXT,
    password_hash TEXT,
    is_admin BOOLEAN DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    last_login DATETIME
)`, () => {
    setup();
});
