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
        "gcloud",
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
    print("Testing Standalone Quality Mode for Vertex AI Cloud Function")
    print("=" * 60)

    # Step 1: Deploy the cloud function with standalone mode settings
    print("Deploying cloud function with standalone mode settings...")
    try:
        # Set required environment variables from current environment
        env = os.environ.copy()
        required_vars = ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "GEMINI_API_KEY"]

        for var in required_vars:
            if var not in env:
                print(f"Error: {var} environment variable not set")
                return

        # Set standalone mode environment variables for deployment
        env["EVALUATION_MODE"] = "standalone_quality"
        env["EVALUATION_CRITERIA"] = "comprehensive"
        env["SESSION_ID"] = "test-standalone-session"

        deploy_result = subprocess.run(
            "bash deploy.sh",
            shell=True,
            capture_output=True,
            text=True,
            timeout=300,
            env=env,
        )

        if deploy_result.returncode == 0:
            print("Cloud function deployed successfully with standalone mode")
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
            print(
                "Error: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY environment variables must be set"
            )
            return

        supabase: Client = create_client(supabase_url, supabase_key)

        # Get a sample from the Bodysuit dataset
        response = (
            supabase.table("training_samples")
            .select("id, uploaded_image_url, openai_image_url, data_set_name")
            .eq("data_set_name", "Bodysuit")
            .limit(1)
            .execute()
        )

        if not response.data or len(response.data) == 0:
            print("No training samples found in Bodysuit dataset")
            return

        sample = response.data[0]
        sample_id = sample["id"]
        image_url = sample["uploaded_image_url"]

        print(f"Found sample {sample_id}")
        print(f"   Image URL: {image_url}")
        print()

    except Exception as e:
        print(f"Failed to fetch training sample: {e}")
        return

    # Test prompt
    prompt = "Create a beautiful, high-quality commercial pet portrait in watercolor style"

    print(f"Testing prompt: {prompt}")
    print()

    gcloud = find_gcloud()
    print(f"Using gcloud at: {gcloud}")
    print()

    # Call the Cloud Function with standalone quality mode format
    print("Calling Cloud Function in standalone quality mode...")
    # Generate a proper unique ID for this evaluation
    import time
    import random
    import string

    timestamp = int(time.time() * 1000)
    random_string = "".join(random.choices(string.ascii_lowercase + string.digits, k=9))
    unique_evaluation_id = f"{timestamp}_{random_string}_sample_{sample_id}"

    # Create pet analysis description (simulating what the server would generate)
    pet_analysis = f"This is a {sample['data_set_name']} pet photo showing a domestic animal with distinctive features that would make an excellent commercial portrait subject."

    # Create quality specification (simulating what the server would generate)
    quality_specification = """A professional, high-quality commercial pet portrait featuring the specific pet from the source image, rendered in beautiful watercolor style with soft, flowing brushstrokes and vibrant yet natural colors. The pet should be positioned as the main subject taking up 60-80% of the frame, with a clean background that complements the artistic style. The image should have professional lighting that enhances the pet's features, sharp details in the eyes and facial features, and an overall composition that would be perfect for print-on-demand products. The artistic execution should be smooth and refined, with consistent watercolor technique throughout, creating an immediately appealing image that customers would want to purchase as a gift or keepsake."""

    # Standalone mode uses different target format
    data = {
        "prompt": prompt,
        "input": f"{image_url},{pet_analysis}",
        "target": f"quality_specification:{quality_specification}",
        "unique_id": unique_evaluation_id,
    }

    print("Test data format:")
    print(f"   Input: {data['input'][:100]}...")
    print(f"   Target: {data['target'][:100]}...")
    print()

    try:
        # Use shell=True and format command as string
        cmd = f'"{gcloud}" functions call evaluate-image-prompt --data="{json.dumps(data).replace(chr(34), chr(92)+chr(34))}"'
        result = subprocess.run(
            cmd, capture_output=True, text=True, shell=True, timeout=300
        )

        if result.returncode != 0:
            print(f"Function call failed: {result.stderr}")
            print("This might show the exact error causing the 500 status code!")
            return

        # Parse response (remove gcloud output prefix)
        raw_output = result.stdout.strip()
        print(f"Raw gcloud output: {raw_output}")

        if raw_output.startswith("|"):
            raw_output = raw_output[1:].strip()

        print(f"Cleaned output: {raw_output}")

        response_data = json.loads(raw_output)
        print("✅ Function call successful!")

        score = response_data["image_similarity_score"]
        print(f"Overall Score: {score:.3f} ({score*100:.1f}%)")
        print(f"Sample ID: {response_data['details']['unique_id']}")
        print(f"Input Image: {response_data['details']['input_image_url']}")
        print()

        # Get the latest generated images from Supabase
        print("Fetching generation record from database...")
        try:
            # Look for the specific generation record using the unique evaluation ID
            from datetime import datetime, timedelta

            cutoff_time = (datetime.now() - timedelta(minutes=2)).isoformat()

            generation_records = (
                supabase.table("optimizer_generations")
                .select(
                    "id, prompt_used, generated_image_url, training_sample_id, evaluation_unique_id, created_at"
                )
                .eq("evaluation_unique_id", unique_evaluation_id)
                .gte("created_at", cutoff_time)
                .order("created_at", desc=True)
                .limit(1)
                .execute()
            )

            if generation_records.data and len(generation_records.data) > 0:
                record = generation_records.data[0]
                print(f"✅ Found generation record for evaluation {unique_evaluation_id}")
                print(f"   Image URL: {record['generated_image_url']}")
                print(f"   Database ID: {record['id']}")
                print(f"   Created: {record['created_at']}")
            else:
                print(f"❌ No generation record found for evaluation {unique_evaluation_id}")
                print("   This indicates the image storage failed!")

        except Exception as e:
            print(f"❌ Database lookup failed: {e}")

        print("\n✅ Standalone Quality Mode Test Summary:")
        print(f"   Score: {response_data['image_similarity_score']:.3f}")
        print(f"   Sample tested: {response_data['details']['unique_id']}")
        print(f"   Evaluation mode: Standalone Quality")
        print(f"   Images stored: {'Yes' if generation_records.data else 'No'}")

    except subprocess.TimeoutExpired:
        print("❌ Command timed out")
    except json.JSONDecodeError as e:
        print(f"❌ Failed to parse response: {e}")
        print(f"Raw output: {result.stdout}")
        print("This indicates the cloud function returned invalid JSON (likely an error)")
    except Exception as e:
        print(f"❌ Error: {e}")


if __name__ == "__main__":
    main()