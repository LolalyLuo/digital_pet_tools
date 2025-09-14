#!/usr/bin/env python3
import sys
import os

# Set environment variables for testing
os.environ['SUPABASE_URL'] = 'https://njxpguzxsodxtrbkxusz.supabase.co'
os.environ['SUPABASE_SERVICE_ROLE_KEY'] = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5qeHBndXp4c29keHRyYmt4dXN6Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc1NzU2OTQ1NywiZXhwIjoyMDczMTQ1NDU3fQ.dM01I07kRotVmh3kaZ3Oe76VxcLtx6PLanbJ8PasUv4'
os.environ['GOOGLE_CLOUD_PROJECT'] = 'instame-470206'

print("Testing imports...")

try:
    # Test basic imports
    import functions_framework
    import json
    import requests
    print("Basic imports successful")

    # Test Google Cloud imports
    from google.cloud import aiplatform
    from google.cloud import storage
    print("Google Cloud imports successful")

    # Test Supabase
    from supabase import create_client, Client
    print("Supabase import successful")

    # Test Vertex AI
    import vertexai
    from vertexai.generative_models import GenerativeModel, Part, Image
    print("Vertex AI imports successful")

    print("All imports successful!")

except Exception as e:
    print(f"Import failed: {e}")
    sys.exit(1)

print("Testing Supabase connection...")
try:
    from main import get_training_samples_from_supabase
    samples = get_training_samples_from_supabase("Bodysuit")
    print(f"Supabase test successful - found {len(samples)} training samples")
    if samples:
        sample = samples[0]
        print(f"Sample keys: {list(sample.keys())}")
        print(f"First sample ID: {sample.get('id')}")
        print(f"Uploaded image URL: {sample.get('uploaded_image_url')}")
        print(f"Reference image URL: {sample.get('openai_image_url')}")
except Exception as e:
    print(f"Supabase test failed: {e}")
    sys.exit(1)

print("All local tests passed!")