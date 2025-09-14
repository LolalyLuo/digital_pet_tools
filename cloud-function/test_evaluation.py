#!/usr/bin/env python3
import os
import json

# Set environment variables
os.environ['SUPABASE_URL'] = 'https://njxpguzxsodxtrbkxusz.supabase.co'
os.environ['SUPABASE_SERVICE_ROLE_KEY'] = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5qeHBndXp4c29keHRyYmt4dXN6Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc1NzU2OTQ1NywiZXhwIjoyMDczMTQ1NDU3fQ.dM01I07kRotVmh3kaZ3Oe76VxcLtx6PLanbJ8PasUv4'
os.environ['GOOGLE_CLOUD_PROJECT'] = 'instame-470206'
os.environ['GEMINI_API_KEY'] = 'AIzaSyAPQ-0AId_Wc76gSsCTOeZbNEBC_hRl4xQ'

print("Testing complete evaluation pipeline with a single sample...")

try:
    from main import get_training_samples_from_supabase, evaluate_single_sample

    # Get training samples
    samples = get_training_samples_from_supabase("Bodysuit")
    print(f"Retrieved {len(samples)} training samples")

    if not samples:
        print("ERROR: No samples found")
        exit(1)

    # Test with first sample and a simple prompt
    sample = samples[0]
    test_prompt = "Create a cute baby bodysuit design with soft pastel colors"

    print(f"Testing evaluation with sample ID {sample.get('id')}")
    print(f"Test prompt: {test_prompt}")
    print(f"Uploaded image: {sample.get('uploaded_image_url')}")
    print(f"Reference image: {sample.get('openai_image_url')}")

    print("\nRunning single sample evaluation...")
    score = evaluate_single_sample(test_prompt, sample)
    print(f"Evaluation score: {score}")

    if 0.0 <= score <= 1.0:
        print("SUCCESS: Score is in valid range [0.0, 1.0]")
    else:
        print(f"ERROR: Score {score} is outside valid range")

except Exception as e:
    print(f"Evaluation test failed: {e}")
    import traceback
    traceback.print_exc()