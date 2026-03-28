# Crimson Tweaks Backend - Railway Deployment

## 🚀 Quick Deploy to Railway

### Step 1: Push to GitHub
```bash
git init
git add .
git commit -m "Initial commit for Railway"
git remote add origin https://github.com/YOUR_USERNAME/crimson-backend.git
git push -u origin main
```

### Step 2: Deploy on Railway
1. Go to [railway.app](https://railway.app)
2. Sign up/login
3. Click **"New Project"**
4. Select **"Deploy from GitHub repo"**
5. Connect your GitHub account
6. Select your repository
7. Railway will auto-deploy!

### Step 3: Add Environment Variables
In Railway Dashboard → Your Service → Variables, add:

```
NODE_ENV=production
JWT_SECRET=crimson-jwt-secret-2024-secure
BOT_REGISTER_SECRET=crimson-register-secret-2024
BOT_ADMIN_SECRET=crimson-admin-secret-2024
DISCORD_BOT_TOKEN=your-discord-bot-token
DISCORD_CLIENT_ID=your-discord-client-id
DISCORD_CLIENT_SECRET=your-discord-client-secret
DISCORD_GUILD_ID=your-discord-guild-id
ADMIN_ROLE_ID=your-admin-role-id
```

### Step 4: Get Your URL
Once deployed, Railway gives you a URL like:
`https://your-app.up.railway.app`

Use this URL in your desktop app!

## 📁 Files Included

- `server.js` - Main backend server
- `package.json` - Dependencies
- `railway.toml` - Railway configuration
- `README.md` - Documentation
- `database.sqlite` - Empty database (optional)

## 🔧 What This Backend Does

- ✅ User authentication (login/register)
- ✅ License verification
- ✅ Discord OAuth integration
- ✅ Admin commands for bot
- ✅ SQLite database (persistent storage)

## 🌐 API Endpoints

- `POST /auth/login` - User login
- `POST /auth/register` - User registration (bot only)
- `POST /auth/admin/delete-account` - Delete account (admin only)
- `POST /auth/admin/reset-password` - Reset password (admin only)
- `POST /verify` - Verify license key
- `GET /ping` - Health check

## 🎯 For Desktop App

Update these URLs in your Tauri app:
- Backend: `https://your-railway-url.up.railway.app`
- Port: Uses standard HTTPS (443)

## 💡 Troubleshooting

**App can't connect?**
- Check if Railway service is running
- Verify the URL is correct
- Check CORS settings in server.js

**Database issues?**
- Railway provides ephemeral storage
- For persistent data, use Railway's volume feature

## 📞 Support

Join Discord: https://discord.gg/crimsonservices
