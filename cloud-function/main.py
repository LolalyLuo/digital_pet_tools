import functions_framework
import json
import requests
import os
from google.cloud import storage
import asyncio
import concurrent.futures
import base64
from io import BytesIO
from supabase import create_client, Client
import google.generativeai as genai

@functions_framework.http
def evaluate_image_prompt(request):
    """
    Custom evaluation function for Vertex AI Prompt Optimizer
    Evaluates prompts by:
    1. Getting training data samples
    2. For each sample: user image + prompt → generate with Gemini → evaluate against reference
    3. Return average score across all samples
    """
    try:

        # Parse request from Vertex AI APD container
        data = request.get_json()
        print(f"Received evaluation request: {json.dumps(data, indent=2)}")

        # Extract the optimized prompt and target reference data
        optimized_prompt = data.get('generated_text', '')
        target_data_str = data.get('target', '{}')

        try:
            target_data = json.loads(target_data_str)
        except json.JSONDecodeError:
            target_data = {}

        print(f"Evaluating optimized prompt: {optimized_prompt}")

        # Step 1: Get training data samples from the target data
        training_samples = get_training_samples_from_supabase()

        if not training_samples:
            print("CRITICAL ERROR: No training samples found - FAILING IMMEDIATELY")
            raise Exception("No training samples found - Supabase connection failed")

        print(f"Found {len(training_samples)} training samples")

        # Step 2: Evaluate prompt against all training samples in parallel
        scores = evaluate_prompt_parallel(optimized_prompt, training_samples)

        # Step 3: Calculate average score
        if not scores:
            raise Exception("No evaluation scores returned - all samples failed")

        average_score = sum(scores) / len(scores)
        average_score = max(0.0, min(1.0, average_score))  # Clamp between 0-1

        result = {
            'image_similarity_score': average_score,
            'details': {
                'samples_evaluated': len(training_samples),
                'individual_scores': scores[:5],  # Show first 5 scores
                'prompt_evaluated': optimized_prompt
            }
        }

        print(f"Final evaluation result: {result}")
        return result

    except Exception as e:
        print(f"Evaluation function error: {e}")
        return {
            'image_similarity_score': 0.0,
            'error': str(e),
            'details': 'Function execution failed'
        }


def get_training_samples_from_supabase(data_set_name="Bodysuit"):
    """Get training samples from Supabase database"""
    try:
        # Initialize Supabase client
        supabase_url = os.environ.get('SUPABASE_URL')
        supabase_key = os.environ.get('SUPABASE_SERVICE_ROLE_KEY')

        if not supabase_url or not supabase_key:
            print("CRITICAL ERROR: Missing Supabase credentials")
            raise Exception(f"Missing Supabase credentials: URL={bool(supabase_url)}, KEY={bool(supabase_key)}")

        supabase: Client = create_client(supabase_url, supabase_key)

        # Query training samples
        response = supabase.table('training_samples').select(
            'id, uploaded_image_url, openai_image_url, data_set_name, created_at'
        ).eq('data_set_name', data_set_name).execute()

        if response.data:
            print(f"Fetched {len(response.data)} training samples from Supabase")
            return response.data
        else:
            print("CRITICAL ERROR: No training samples found in Supabase")
            raise Exception(f"No training samples found for data set: {data_set_name}")

    except Exception as e:
        print(f"CRITICAL ERROR: Supabase connection failed: {e}")
        raise Exception(f"Supabase connection failed: {e}")


def evaluate_prompt_parallel(prompt, training_samples):
    """Evaluate prompt against all training samples in parallel"""
    try:
        # Use ThreadPoolExecutor for parallel processing
        with concurrent.futures.ThreadPoolExecutor(max_workers=20) as executor:
            # Submit all evaluation tasks
            future_to_sample = {
                executor.submit(evaluate_single_sample, prompt, sample): sample
                for sample in training_samples
            }

            scores = []
            for future in concurrent.futures.as_completed(future_to_sample):
                sample = future_to_sample[future]
                try:
                    score = future.result()
                    scores.append(score)
                    print(f"Sample {sample.get('id', 'unknown')} scored: {score}")
                except Exception as e:
                    print(f"CRITICAL ERROR: Sample evaluation failed for {sample.get('id', 'unknown')}: {e}")
                    raise Exception(f"Sample evaluation failed: {e}")

            return scores

    except Exception as e:
        print(f"CRITICAL ERROR: Parallel evaluation failed: {e}")
        raise Exception(f"Parallel evaluation failed: {e}")


def evaluate_single_sample(prompt, sample):
    """
    Evaluate prompt for a single training sample:
    1. Generate image with Gemini using user image + prompt
    2. Evaluate generated image vs reference image using Gemini evaluation
    3. Return score
    """
    try:
        uploaded_image_url = sample.get('uploaded_image_url')
        reference_image_url = sample.get('openai_image_url')

        if not uploaded_image_url or not reference_image_url:
            print(f"CRITICAL ERROR: Missing image URLs for sample {sample.get('id')}")
            raise Exception(f"Missing image URLs for sample {sample.get('id')}: uploaded={uploaded_image_url}, reference={reference_image_url}")

        # Step 1: Generate image with Gemini 2.5 Flash using uploaded image + prompt
        generated_image_bytes = generate_image_with_gemini(uploaded_image_url, prompt)

        if not generated_image_bytes:
            print(f"CRITICAL ERROR: Failed to generate image for sample {sample.get('id')}")
            raise Exception(f"Failed to generate image for sample {sample.get('id')}")

        # Step 2: Evaluate generated vs reference using Gemini evaluation
        evaluation_score = evaluate_with_gemini_bytes(generated_image_bytes, reference_image_url)

        return evaluation_score

    except Exception as e:
        print(f"CRITICAL ERROR: Single sample evaluation failed: {e}")
        raise Exception(f"Single sample evaluation failed: {e}")


def generate_image_with_gemini(uploaded_image_url, prompt):
    """
    Use Gemini 2.5 Flash Image Preview to generate image based on uploaded image and prompt
    """
    try:
        # Initialize Google AI SDK
        gemini_api_key = os.environ.get('GEMINI_API_KEY')
        if not gemini_api_key:
            raise Exception("GEMINI_API_KEY environment variable not set")

        genai.configure(api_key=gemini_api_key)

        # Download uploaded image
        img_response = requests.get(uploaded_image_url, timeout=30)
        if img_response.status_code != 200:
            raise Exception(f"Failed to download uploaded image: {img_response.status_code}")

        # Use Gemini 2.5 Flash Image Preview to GENERATE image
        model = genai.GenerativeModel("gemini-2.5-flash-image-preview")

        # Create image part from uploaded image (Google AI SDK format)
        image_base64 = base64.b64encode(img_response.content).decode('utf-8')
        image_part = {
            "inline_data": {
                "data": image_base64,
                "mime_type": "image/jpeg"
            }
        }

        # Generate image using Gemini
        response = model.generate_content([prompt, image_part])

        # Extract generated image from response
        if not response.candidates or len(response.candidates) == 0:
            raise Exception("Gemini returned no candidates")

        candidate = response.candidates[0]
        if not candidate.content or not candidate.content.parts:
            raise Exception("Gemini returned no content parts")

        # Find the generated image data
        generated_image_data = None
        for part in candidate.content.parts:
            if hasattr(part, 'inline_data') and part.inline_data and part.inline_data.data:
                generated_image_data = part.inline_data.data
                break

        if not generated_image_data:
            raise Exception("Gemini did not return generated image data")

        # The data is already in bytes format, not base64
        generated_image_bytes = generated_image_data

        print(f"Generated image successfully ({len(generated_image_bytes)} bytes)")
        return generated_image_bytes

    except Exception as e:
        print(f"CRITICAL ERROR: Gemini vision analysis failed: {e}")
        raise Exception(f"Gemini vision analysis failed: {e}")


def evaluate_with_gemini_bytes(generated_image_bytes, reference_image_url):
    """
    Use Gemini to evaluate generated image bytes vs reference image URL
    """
    try:
        # Initialize Google AI SDK
        gemini_api_key = os.environ.get('GEMINI_API_KEY')
        if not gemini_api_key:
            raise Exception("GEMINI_API_KEY environment variable not set")

        genai.configure(api_key=gemini_api_key)

        # Download reference image for evaluation
        reference_response = requests.get(reference_image_url, timeout=30)

        # Create image parts for Gemini (Google AI SDK format)
        generated_base64 = base64.b64encode(generated_image_bytes).decode('utf-8')
        reference_base64 = base64.b64encode(reference_response.content).decode('utf-8')

        generated_part = {
            "inline_data": {
                "data": generated_base64,
                "mime_type": "image/png"
            }
        }
        reference_part = {
            "inline_data": {
                "data": reference_base64,
                "mime_type": "image/jpeg"
            }
        }

        # Create evaluation prompt (same as your evaluation test tab)
        evaluation_prompt = """
        Please evaluate the first image (generated) compared to the second image (reference) on the following criteria:

        1. Style Consistency (1-10): How well does the generated image match the artistic style of the reference?
        2. Subject Accuracy (1-10): How accurately is the subject represented compared to the reference?
        3. Quality (1-10): Overall image quality and technical execution
        4. Adherence to Prompt (1-10): How well does it follow the artistic direction shown in the reference?

        Consider that both images should have a soft watercolor aesthetic with hand-drawn texture, visible brushstrokes, pastel colors, and a dreamy quality.

        Return your response in this exact JSON format:
        {
            "style_consistency": X,
            "subject_accuracy": X,
            "quality": X,
            "adherence_to_prompt": X,
            "reasoning": "Brief explanation"
        }
        """

        # Call Gemini for evaluation
        model = genai.GenerativeModel("gemini-2.5-flash-image-preview")

        response = model.generate_content([
            evaluation_prompt,
            "Generated image:",
            generated_part,
            "Reference image:",
            reference_part
        ])

        # Parse the JSON response
        try:
            evaluation_text = response.text.strip()
            print(f"Raw Gemini evaluation response: {evaluation_text}")

            # Extract JSON from response
            start_idx = evaluation_text.find('{')
            end_idx = evaluation_text.rfind('}') + 1
            if start_idx >= 0 and end_idx > start_idx:
                json_str = evaluation_text[start_idx:end_idx]
                evaluation_scores = json.loads(json_str)
            else:
                raise ValueError("No valid JSON found in response")

        except (json.JSONDecodeError, ValueError) as e:
            print(f"CRITICAL ERROR: Failed to parse Gemini evaluation response: {e}")
            raise Exception(f"Failed to parse Gemini evaluation response: {e}")

        # Calculate weighted score (same as evaluation test tab)
        weights = {
            "style_consistency": 0.3,
            "subject_accuracy": 0.3,
            "quality": 0.2,
            "adherence_to_prompt": 0.2
        }

        weighted_score = sum(
            evaluation_scores[criterion] * weight
            for criterion, weight in weights.items()
            if criterion in evaluation_scores
        )

        # Normalize to 0-1 scale
        final_score = weighted_score / 10.0

        print(f"Evaluation scores: {evaluation_scores}")
        print(f"Final weighted score: {final_score}")

        return final_score

    except Exception as e:
        print(f"CRITICAL ERROR: Gemini evaluation failed: {e}")
        raise Exception(f"Gemini evaluation failed: {e}")


def evaluate_with_gemini(generated_image_url, reference_image_url):
    """
    Use Gemini to evaluate generated image vs reference image
    Same logic as in your evaluation test tab
    """
    try:
        # Initialize Google AI SDK
        gemini_api_key = os.environ.get('GEMINI_API_KEY')
        if not gemini_api_key:
            raise Exception("GEMINI_API_KEY environment variable not set")

        genai.configure(api_key=gemini_api_key)

        # Download images for evaluation
        generated_response = requests.get(generated_image_url, timeout=30)
        reference_response = requests.get(reference_image_url, timeout=30)

        # Create image parts for Gemini (Google AI SDK format)
        generated_base64 = base64.b64encode(generated_response.content).decode('utf-8')
        reference_base64 = base64.b64encode(reference_response.content).decode('utf-8')

        generated_part = {
            "inline_data": {
                "data": generated_base64,
                "mime_type": "image/jpeg"
            }
        }
        reference_part = {
            "inline_data": {
                "data": reference_base64,
                "mime_type": "image/jpeg"
            }
        }

        # Create evaluation prompt (same as your evaluation test tab)
        evaluation_prompt = """
        Please evaluate the first image (generated) compared to the second image (reference) on the following criteria:

        1. Style Consistency (1-10): How well does the generated image match the artistic style of the reference?
        2. Subject Accuracy (1-10): How accurately is the subject represented compared to the reference?
        3. Quality (1-10): Overall image quality and technical execution
        4. Adherence to Prompt (1-10): How well does it follow the artistic direction shown in the reference?

        Consider that both images should have a soft watercolor aesthetic with hand-drawn texture, visible brushstrokes, pastel colors, and a dreamy quality.

        Return your response in this exact JSON format:
        {
            "style_consistency": X,
            "subject_accuracy": X,
            "quality": X,
            "adherence_to_prompt": X,
            "reasoning": "Brief explanation"
        }
        """

        # Call Gemini for evaluation
        model = genai.GenerativeModel("gemini-2.5-flash-image-preview")

        response = model.generate_content([
            evaluation_prompt,
            "Generated image:",
            generated_part,
            "Reference image:",
            reference_part
        ])

        # Parse the JSON response
        try:
            evaluation_text = response.text.strip()
            print(f"Raw Gemini evaluation response: {evaluation_text}")

            # Extract JSON from response
            start_idx = evaluation_text.find('{')
            end_idx = evaluation_text.rfind('}') + 1
            if start_idx >= 0 and end_idx > start_idx:
                json_str = evaluation_text[start_idx:end_idx]
                evaluation_scores = json.loads(json_str)
            else:
                raise ValueError("No valid JSON found in response")

        except (json.JSONDecodeError, ValueError) as e:
            print(f"CRITICAL ERROR: Failed to parse Gemini evaluation response: {e}")
            raise Exception(f"Failed to parse Gemini evaluation response: {e}")

        # Calculate weighted score (same as evaluation test tab)
        weights = {
            "style_consistency": 0.3,
            "subject_accuracy": 0.3,
            "quality": 0.2,
            "adherence_to_prompt": 0.2
        }

        weighted_score = sum(
            evaluation_scores[criterion] * weight
            for criterion, weight in weights.items()
            if criterion in evaluation_scores
        )

        # Normalize to 0-1 scale
        final_score = weighted_score / 10.0

        print(f"Evaluation scores: {evaluation_scores}")
        print(f"Final weighted score: {final_score}")

        return final_score

    except Exception as e:
        print(f"CRITICAL ERROR: Gemini evaluation failed: {e}")
        raise Exception(f"Gemini evaluation failed: {e}")


def save_generated_image_to_storage(image_bytes):
    """Save generated image to Cloud Storage and return public URL"""
    try:
        storage_client = storage.Client()
        bucket_name = f"vertex-ai-optimizer-{os.environ.get('GOOGLE_CLOUD_PROJECT', 'instame-470206')}"

        # Create bucket if it doesn't exist
        try:
            bucket = storage_client.bucket(bucket_name)
            if not bucket.exists():
                bucket = storage_client.create_bucket(bucket_name)
        except Exception as e:
            print(f"CRITICAL ERROR: Bucket creation/access failed: {e}")
            raise Exception(f"Bucket creation/access failed: {e}")

        # Upload image
        filename = f"generated-images/{int(os.urandom(8).hex(), 16)}.jpg"
        blob = bucket.blob(filename)
        blob.upload_from_string(image_bytes, content_type='image/jpeg')

        # Return public URL (bucket should already have public access configured)
        return f"https://storage.googleapis.com/{bucket_name}/{filename}"

    except Exception as e:
        print(f"CRITICAL ERROR: Storage upload failed: {e}")
        raise Exception(f"Storage upload failed: {e}")


