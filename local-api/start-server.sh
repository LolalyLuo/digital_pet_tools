#!/bin/bash

# Digital Pet Tools - Local API Server Startup Script

echo "🚀 Starting Digital Pet Tools Local API Server..."

# Check if .env file exists
if [ ! -f ".env" ]; then
    echo "❌ .env file not found!"
    echo "Please create a .env file with your API keys and Supabase configuration."
    echo "See LOCAL_API_SETUP.md for details."
    exit 1
fi

# Check if node_modules exists
if [ ! -d "node_modules" ]; then
    echo "📦 Installing dependencies..."
    npm install
fi

# Start the server
echo "🎨 Starting server on port ${PORT:-3001}..."
npm run dev
