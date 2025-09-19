#!/bin/bash

# Deploy the Cloud Function for image evaluation (with session support)
echo "🚀 Deploying Cloud Function for Vertex AI image evaluation..."

# Check required environment variables
if [ -z "$SUPABASE_URL" ] || [ -z "$SUPABASE_SERVICE_ROLE_KEY" ] || [ -z "$GEMINI_API_KEY" ]; then
    echo "❌ Error: Please set SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, and GEMINI_API_KEY environment variables"
    exit 1
fi

# Determine function name based on session ID
FUNCTION_NAME="evaluate-image-prompt"
if [ ! -z "$SESSION_ID" ]; then
    # Extract timestamp and random part from session ID
    if [[ $SESSION_ID =~ ^opt-([0-9]+)-([a-z0-9]+)$ ]]; then
        TIMESTAMP=${BASH_REMATCH[1]}
        RANDOM_PART=${BASH_REMATCH[2]}
        FUNCTION_NAME="evaluate-image-prompt-${TIMESTAMP}-${RANDOM_PART}"
        echo "📋 Using session-specific function name: $FUNCTION_NAME"
    else
        echo "⚠️ Invalid session ID format, using default function name"
    fi
else
    echo "📋 No session ID provided, using default function name"
fi

# Deploy the function and capture the exit code
gcloud functions deploy $FUNCTION_NAME \
  --gen2 \
  --runtime=python311 \
  --region=us-central1 \
  --source=. \
  --entry-point=evaluate_image_prompt \
  --trigger-http \
  --timeout=540 \
  --memory=2Gi \
  --no-allow-unauthenticated \
  --set-env-vars="GOOGLE_CLOUD_PROJECT=instame-470206,SUPABASE_URL=${SUPABASE_URL},SUPABASE_SERVICE_ROLE_KEY=${SUPABASE_SERVICE_ROLE_KEY},GEMINI_API_KEY=${GEMINI_API_KEY},SESSION_ID=${SESSION_ID},EVALUATION_CRITERIA=${EVALUATION_CRITERIA:-comprehensive}" \
  --project=instame-470206

# Check if the deployment actually succeeded
if [ $? -eq 0 ]; then
    echo "✅ Cloud Function deployed successfully!"
    echo "📋 Function Name: $FUNCTION_NAME"
    echo "📋 Function URL: https://us-central1-instame-470206.cloudfunctions.net/$FUNCTION_NAME"
else
    echo "❌ Cloud Function deployment FAILED!"
    exit 1
fi