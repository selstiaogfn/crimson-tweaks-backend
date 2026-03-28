#!/bin/bash

echo "🚀 Deploying Crimson Tweaks Backend to Render"

# Check if git is initialized
if [ ! -d ".git" ]; then
    echo "📦 Initializing git repository..."
    git init
    git add .
    git commit -m "Initial backend setup with Render support"
    echo "✅ Git repository initialized"
else
    echo "📦 Git repository already exists"
fi

# Check if remote is set
if ! git remote get-url origin >/dev/null 2>&1; then
    echo "🔗 Please set up GitHub repository:"
    echo "1. Create a new repository on GitHub"
    echo "2. Run: git remote add origin <your-github-repo-url>"
    echo "3. Run: git push -u origin main"
    echo ""
    echo "Then go to render.com to deploy!"
else
    echo "🔄 Pushing to GitHub..."
    git add .
    git commit -m "Update backend for Render deployment"
    git push origin main
    echo "✅ Pushed to GitHub"
fi

echo ""
echo "📋 Next Steps:"
echo "1. Go to https://render.com"
echo "2. Click 'New +' → 'Web Service'"
echo "3. Connect your GitHub repository"
echo "4. Use these settings:"
echo "   - Name: crimson-tweaks-backend"
echo "   - Runtime: Node"
echo "   - Build Command: npm install"
echo "   - Start Command: npm start"
echo "   - Instance Type: Free"
echo ""
echo "5. Add environment variables (see README.md)"
echo "6. Add PostgreSQL database"
echo ""
echo "🎉 Your backend will be live at: https://your-app.onrender.com"
