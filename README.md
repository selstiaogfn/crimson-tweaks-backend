# Crimson Tweaks Backend Server

Full-featured backend API for Crimson Tweaks Pro license management.

## Features

- ✅ SQLite Database (easy setup, no external DB needed)
- ✅ JWT Authentication
- ✅ Discord OAuth Integration
- ✅ Rate Limiting & Security (Helmet)
- ✅ Hardware ID (HWID) Binding
- ✅ License Generation & Management
- ✅ Activation Logging
- ✅ Admin Dashboard API
- ✅ Discord Bot Webhook Support

## Quick Start

### 1. Install Dependencies

```bash
cd backend
npm install
```

### 2. Configure Environment

```bash
cp .env.example .env
# Edit .env with your settings
```

### 3. Setup Admin User

```bash
npm run setup
```

### 4. Start Server

```bash
npm start
# or for development with auto-reload:
npm run dev
```

## API Endpoints

### Public Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/ping` | Health check |
| GET | `/version` | Get app version |
| POST | `/verify` | Verify license key |
| POST | `/auth/discord` | Discord OAuth callback |

### Protected Endpoints (JWT Required)

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/my-licenses` | Get user's licenses |

### Admin Endpoints (JWT + Admin Required)

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/admin/licenses` | Generate new license |
| GET | `/admin/licenses` | List all licenses |
| GET | `/admin/licenses/:key` | Get license details |
| DELETE | `/admin/licenses/:key` | Revoke license |
| GET | `/admin/stats` | Get statistics |
| GET | `/admin/activations` | Get activation logs |

## Database Schema

### Tables

- **licenses** - License keys and their status
- **users** - User accounts (Discord-linked)
- **activations** - Activation attempt logs
- **settings** - App configuration

## Environment Variables

```env
PORT=3000
JWT_SECRET=your-secret-key
DISCORD_CLIENT_ID=your-client-id
DISCORD_CLIENT_SECRET=your-secret
DISCORD_REDIRECT_URI=http://localhost:3000/auth/discord/callback
DISCORD_BOT_TOKEN=bot-token-for-optional-features
ADMIN_ROLE_ID=discord-admin-role-id
DOWNLOAD_URL=https://your-site.com/download
```

## License Verification Flow

1. App sends `POST /verify` with `license_key`, `hwid`, `version`
2. Server validates the license:
   - Check if key exists
   - Check if revoked
   - Check if expired
   - Check HWID binding (if already activated)
3. Server responds with:
   - `success: true` + JWT token (if valid)
   - `success: false` + error message (if invalid)
4. App stores JWT token for future authenticated requests

## Discord Integration

The backend supports Discord OAuth for user authentication:

1. User clicks "Login with Discord" in app
2. App opens Discord OAuth URL
3. User authorizes app
4. Discord redirects to callback with code
5. App sends code to `POST /auth/discord`
6. Backend exchanges code for access token
7. Backend fetches user info from Discord API
8. Backend creates/updates user in database
9. Backend returns JWT token + user licenses

## Security Features

- Rate limiting (100 requests per 15 minutes per IP)
- Helmet.js for security headers
- bcrypt for password hashing
- JWT tokens with expiration
- HWID binding prevents license sharing
- SQLite database (no external dependencies)

## Production Deployment

### Option 1: Render (Recommended - Free Hosting)

1. **Push to GitHub**
   ```bash
   git init
   git add .
   git commit -m "Initial backend"
   git remote add origin <your-github-repo>
   git push -u origin main
   ```

2. **Deploy to Render**
   - Go to [render.com](https://render.com) and signup
   - Click "New +" → "Web Service"
   - Connect your GitHub repository
   - Configure:
     - **Name**: crimson-tweaks-backend
     - **Runtime**: Node
     - **Build Command**: `npm install`
     - **Start Command**: `npm start`
     - **Instance Type**: Free

3. **Add Environment Variables** in Render dashboard:
   ```
   NODE_ENV=production
   JWT_SECRET=your-secure-jwt-secret-here
   SESSION_SECRET=your-secure-session-secret-here
   BOT_REGISTER_SECRET=crimson-register-secret-2024
   BOT_ADMIN_SECRET=crimson-admin-secret-2024
   DISCORD_BOT_TOKEN=your-discord-bot-token
   DISCORD_CLIENT_ID=your-discord-client-id
   DISCORD_CLIENT_SECRET=your-discord-client-secret
   DISCORD_REDIRECT_URI=https://your-app.onrender.com/auth/discord/callback
   DISCORD_GUILD_ID=your-discord-guild-id
   ADMIN_ROLE_ID=your-admin-role-id
   ```

4. **Add PostgreSQL Database**:
   - In Render, add "PostgreSQL" database
   - Copy the connection string
   - Add `DATABASE_URL` environment variable

5. **Update Frontend URLs** to your Render URL: `https://your-app.onrender.com`

### Option 2: PM2

```bash
npm install -g pm2
pm2 start server.js --name crimson-backend
pm2 save
pm2 startup
```

### Using Docker

```dockerfile
FROM node:18-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY . .
EXPOSE 3000
CMD ["node", "server.js"]
```

### Reverse Proxy (Nginx)

```nginx
server {
    listen 80;
    server_name api.yourdomain.com;
    
    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }
}
```

## License Key Format

Keys are generated in format: `XXXX-XXXX-XXXX-XXXX`

Example: `A1B2-C3D4-E5F6-G7H8`

## Support

For support, join our Discord: https://discord.com/invite/crimsonservices
"# crimson-tweaks-backend" 
