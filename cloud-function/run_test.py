#!/usr/bin/env python3
import subprocess
import json
import os
import tempfile
from datetime import datetime
from supabase import create_client, Client
from dotenv import load_dotenv

# Load environment variables from .env file
load_dotenv()

def find_gcloud():
    """Find gcloud executable"""
    possible_paths = [
        r"C:\Program Files (x86)\Google\Cloud SDK\google-cloud-sdk\bin\gcloud.cmd",
        r"C:\Program Files\Google\Cloud SDK\google-cloud-sdk\bin\gcloud.cmd",
        r"C:\Users\%USERNAME%\AppData\Local\Google\Cloud SDK\google-cloud-sdk\bin\gcloud.cmd",
        "gcloud.cmd",
        "gcloud"
    ]

    for path in possible_paths:
        try:
            if os.path.exists(path):
                return path
            # Try running it
            result = subprocess.run([path, "--version"], capture_output=True, timeout=5)
            if result.returncode == 0:
                return path
        except:
            continue

    return "gcloud"  # Fallback

def main():
    print("Testing Vertex AI Prompt Optimizer Cloud Function")
    print("=" * 50)

    # Step 1: Deploy the cloud function first to ensure we have latest code
    print("Deploying cloud function with latest code...")
    try:
        # Set required environment variables from current environment
        env = os.environ.copy()
        required_vars = ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'GEMINI_API_KEY']

        for var in required_vars:
            if var not in env:
                print(f"Error: {var} environment variable not set")
                return

        deploy_result = subprocess.run("bash deploy.sh", shell=True, capture_output=True, text=True, timeout=300, env=env)

        if deploy_result.returncode == 0:
            print("Cloud function deployed successfully")
        else:
            print(f"Deployment failed: {deploy_result.stderr}")
            return

    except subprocess.TimeoutExpired:
        print("Deployment timed out")
        return
    except Exception as e:
        print(f"Deployment error: {e}")
        return

    print()

    # Step 2: Get a sample image from Supabase
    print("Fetching a training sample from Supabase...")
    try:
        # Initialize Supabase client
        supabase_url = os.getenv("SUPABASE_URL")
        supabase_key = os.getenv("SUPABASE_SERVICE_ROLE_KEY")

        if not supabase_url or not supabase_key:
            print("Error: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY environment variables must be set")
            return

        supabase: Client = create_client(supabase_url, supabase_key)

        # Get a sample from the Bodysuit dataset
        response = supabase.table('training_samples').select(
            'id, uploaded_image_url, openai_image_url, data_set_name'
        ).eq('data_set_name', 'Bodysuit').limit(1).execute()

        if not response.data or len(response.data) == 0:
            print("No training samples found in Bodysuit dataset")
            return

        sample = response.data[0]
        sample_id = sample['id']
        image_url = sample['uploaded_image_url']
        reference_image_url = sample['openai_image_url']

        print(f"Found sample {sample_id}")
        print(f"   Image URL: {image_url}")
        print(f"   Reference URL: {reference_image_url}")
        print()

    except Exception as e:
        print(f"Failed to fetch training sample: {e}")
        return

    # Test prompt
    prompt = "Recreate the provided pet photo using a soft watercolor aesthetic with hand-drawn texture. The pet should be depicted in a tranquil setting with a gentle smile on its face, conveying a sense of peace and contentment. Use gentle, pastel colors, and make sure to keep the brushstrokes visible to maintain the hand-painted look. The final image should have a dreamy quality, with soft blends and delicate details that would make it perfect for print on a range of products."

    print(f"Testing prompt: {prompt[:60]}...")
    print()

    gcloud = find_gcloud()
    print(f"Using gcloud at: {gcloud}")
    print()

    # Call the Cloud Function with single sample format
    print("Calling Cloud Function...")
    # Generate a proper unique ID for this evaluation
    import time
    import random
    import string

    timestamp = int(time.time() * 1000)
    random_string = ''.join(random.choices(string.ascii_lowercase + string.digits, k=9))
    unique_evaluation_id = f"{timestamp}_{random_string}_sample_{sample_id}"

    data = {
        "prompt": prompt,
        "input": f"{image_url},{reference_image_url}",
        "target": "{}",
        "unique_id": unique_evaluation_id
    }

    try:
        # Use shell=True and format command as string
        cmd = f'"{gcloud}" functions call evaluate-image-prompt --data="{json.dumps(data).replace(chr(34), chr(92)+chr(34))}"'
        result = subprocess.run(cmd, capture_output=True, text=True, shell=True, timeout=300)

        if result.returncode != 0:
            print(f"Function call failed: {result.stderr}")
            return

        # Parse response (remove gcloud output prefix)
        raw_output = result.stdout.strip()
        print(f"Raw gcloud output: {raw_output}")

        if raw_output.startswith('|'):
            raw_output = raw_output[1:].strip()

        print(f"Cleaned output: {raw_output}")

        response_data = json.loads(raw_output)
        print("Function call successful!")

        score = response_data['image_similarity_score']
        print(f"Overall Score: {score:.3f} ({score*100:.1f}%)")
        print(f"Sample ID: {response_data['details']['unique_id']}")
        print(f"Input Image: {response_data['details']['input_image_url']}")
        print()

        # Get the latest generated images from Supabase
        print("Fetching latest generation records from database...")
        try:
            # Initialize Supabase client
            supabase_url = os.getenv("SUPABASE_URL")
            supabase_key = os.getenv("SUPABASE_SERVICE_ROLE_KEY")

            if not supabase_url or not supabase_key:
                print("Error: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY environment variables must be set")
                return

            supabase: Client = create_client(supabase_url, supabase_key)

            # Look for the specific generation record using the unique evaluation ID
            from datetime import datetime, timedelta
            cutoff_time = (datetime.now() - timedelta(minutes=2)).isoformat()

            generation_records = supabase.table('optimizer_generations').select(
                'id, prompt_used, generated_image_url, training_sample_id, evaluation_unique_id, created_at'
            ).eq('evaluation_unique_id', unique_evaluation_id).gte('created_at', cutoff_time).order('created_at', desc=True).limit(1).execute()

            if generation_records.data and len(generation_records.data) > 0:
                record = generation_records.data[0]
                print(f"Found generation record for evaluation {unique_evaluation_id}")

                # Create download directory
                timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
                download_dir = f"test_results/test_results_{timestamp}"
                os.makedirs(download_dir, exist_ok=True)

                # Extract filename from the generated_image_url
                image_url = record['generated_image_url']
                if 'vertex-ai-optimizer-instame-470206' in image_url:
                    # Extract just the filename
                    filename = image_url.split('/')[-1]
                    gs_url = f"gs://vertex-ai-optimizer-instame-470206/generated-images/{filename}"

                    print(f"Downloading generated image: {filename}")
                    # Download the generated image
                    download_cmd = f'"{gcloud}" storage cp "{gs_url}" "{download_dir}/"'
                    result = subprocess.run(download_cmd, capture_output=True, text=True, shell=True, timeout=30)

                    if result.returncode == 0:
                        print(f"   Downloaded: {filename}")
                        print(f"   Saved to: {os.path.abspath(download_dir)}")

                        # Get file info
                        file_path = os.path.join(download_dir, filename)
                        file_size = os.path.getsize(file_path) // 1024
                        print(f"   File size: {file_size} KB")

                        # Open the directory in Explorer
                        try:
                            os.startfile(os.path.abspath(download_dir))
                            print(f"\nOpened {download_dir} in Windows Explorer")
                        except:
                            print(f"\nFiles are in: {os.path.abspath(download_dir)}")
                    else:
                        print(f"   Failed to download: {filename}")
                        print(f"   Error: {result.stderr}")
                else:
                    print("Generated image URL doesn't match expected bucket pattern")

            else:
                print(f"No generation record found for evaluation {unique_evaluation_id}")
                print("   The cloud function may not have successfully saved the record")

        except Exception as e:
            print(f"FAILED to fetch from database: {e}")
            print("No images downloaded - database lookup failed!")
            return

        print("\nSummary:")
        print(f"   Overall score: {response_data['image_similarity_score']:.3f}")
        print(f"   Sample tested: {response_data['details']['unique_id']}")
        print(f"   Prompt used: {response_data['details']['prompt_evaluated'][:50]}...")

    except subprocess.TimeoutExpired:
        print("Command timed out")
    except json.JSONDecodeError as e:
        print(f"Failed to parse response: {e}")
        print(f"Raw output: {result.stdout}")
    except Exception as e:
        print(f"Error: {e}")

if __name__ == "__main__":
    main()