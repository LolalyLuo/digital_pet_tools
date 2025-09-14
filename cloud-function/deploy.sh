#!/bin/bash

# Deploy the Cloud Function for image evaluation
echo "🚀 Deploying Cloud Function for Vertex AI image evaluation..."

# Check required environment variables
if [ -z "$SUPABASE_URL" ] || [ -z "$SUPABASE_SERVICE_ROLE_KEY" ] || [ -z "$GEMINI_API_KEY" ]; then
    echo "❌ Error: Please set SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, and GEMINI_API_KEY environment variables"
    exit 1
fi

gcloud functions deploy evaluate-image-prompt \
  --gen2 \
  --runtime=python311 \
  --region=us-central1 \
  --source=. \
  --entry-point=evaluate_image_prompt \
  --trigger-http \
  --timeout=540 \
  --memory=2Gi \
  --set-env-vars="GOOGLE_CLOUD_PROJECT=instame-470206,SUPABASE_URL=${SUPABASE_URL},SUPABASE_SERVICE_ROLE_KEY=${SUPABASE_SERVICE_ROLE_KEY},GEMINI_API_KEY=${GEMINI_API_KEY}" \
  --project=instame-470206

echo "✅ Cloud Function deployed successfully!"
echo "📋 Function URL: https://us-central1-instame-470206.cloudfunctions.net/evaluate-image-prompt"