# Local API Server Setup

This guide will help you set up the local API server to handle image generation instead of using Supabase edge functions.

## Prerequisites

- Node.js 18+ installed
- API keys for OpenAI and/or Google Gemini
- Supabase project with service role key

## Setup Steps

### 1. Install Dependencies

Navigate to the `local-api` directory and install dependencies:

```bash
cd local-api
npm install
```

### 2. Environment Configuration

Create a `.env` file in the `local-api` directory with the following variables:

```env
# API Keys
OPENAI_API_KEY=your_openai_api_key_here
GEMINI_API_KEY=your_gemini_api_key_here

# Supabase Configuration
SUPABASE_URL=your_supabase_url_here
SUPABASE_SERVICE_ROLE_KEY=your_supabase_service_role_key_here

# Server Configuration
PORT=3001
```

**Important:** You need the `SUPABASE_SERVICE_ROLE_KEY` (not the anon key) for the local server to access Supabase storage and database.

### 3. Frontend Environment (Optional)

If you want to use a different local API URL, add this to your frontend `.env.local` file:

```env
VITE_LOCAL_API_URL=http://localhost:3001
```

If not set, it defaults to `http://localhost:3001`.

### 4. Start the Local Server

```bash
# Development mode with auto-restart
npm run dev

# Or production mode
npm start
```

The server will start on port 3001 by default.

### 5. Test the Setup

Visit `http://localhost:3001/api/health` to verify the server is running.

## How It Works

### What Changed

1. **Image Generation**: Now handled by local server instead of Supabase edge function
2. **Database Storage**: Still uses Supabase for storing generated images and metadata
3. **API Calls**: OpenAI and Gemini API calls now happen from your local machine
4. **File Processing**: Image processing and uploads handled locally

### Supported Models

- **OpenAI**: Uses DALL-E 2 for image editing
- **Google Gemini**: Uses Gemini 2.5 Flash for image generation
- **Gemini Image-to-Image**: Uses Gemini for template-based generation

### API Endpoints

- `POST /api/generate-images`: Main image generation endpoint
- `GET /api/health`: Health check endpoint

## Troubleshooting

### Common Issues

1. **Port Already in Use**: Change the `PORT` in your `.env` file
2. **API Key Errors**: Verify your API keys are correct and have sufficient credits
3. **Supabase Connection**: Ensure your service role key has proper permissions
4. **CORS Issues**: The server includes CORS headers, but check browser console for errors

### Logs

The server provides detailed console logs for debugging:

- Image processing progress
- API call status
- Error details
- Batch processing information

### Performance

- Images are processed in batches of 3 to avoid overwhelming APIs
- 1-second delay between batches to respect rate limits
- Timeout handling for long-running requests

## Benefits

- **No CPU Limits**: Avoid Supabase edge function CPU restrictions
- **Better Debugging**: Full access to server logs and debugging tools
- **Cost Control**: Direct API usage without edge function overhead
- **Flexibility**: Easy to modify and extend functionality

## Security Notes

- Keep your `.env` file secure and never commit it to version control
- The service role key has full database access - use carefully
- Consider using environment-specific configurations for production
