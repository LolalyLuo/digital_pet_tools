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

        # Extract the prompt and input data from Vertex AI format
        optimized_prompt = data.get('prompt', '')
        input_data = data.get('input', '')
        unique_id = data.get('unique_id', 'unknown')

        # Parse input to extract source URL and source description
        if ',' in input_data:
            input_image_url, source_description = input_data.split(',', 1)
        else:
            input_image_url = input_data
            source_description = None

        # Parse target to extract reference URL and reference description
        target_data = data.get('target', '')
        if ',' in target_data:
            reference_image_url, reference_description = target_data.split(',', 1)
        else:
            reference_image_url = target_data
            reference_description = None

        print(f"Evaluating optimized prompt: {optimized_prompt}")
        print(f"Input image URL: {input_image_url}")
        print(f"Source description: {source_description}")
        print(f"Reference image URL: {reference_image_url}")
        print(f"Reference description: {reference_description}")
        print(f"Unique ID: {unique_id}")

        if not input_image_url:
            raise Exception("No input image URL provided")

        # Step 1: Evaluate the single sample
        score = evaluate_single_sample(optimized_prompt, input_image_url, unique_id, reference_image_url)

        if score is None:
            raise Exception("Evaluation failed for the sample")

        # Clamp score between 0-1
        score = max(0.0, min(1.0, score))

        result = {
            'image_similarity_score': score,
            'details': {
                'samples_evaluated': 1,
                'individual_scores': [score],
                'prompt_evaluated': optimized_prompt,
                'input_image_url': input_image_url,
                'unique_id': unique_id
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


def evaluate_single_sample(optimized_prompt, input_image_url, unique_id, reference_image_url):
    """
    Evaluate a single training sample by:
    1. Using the input image with the optimized prompt to generate a new image
    2. Scoring the generated image
    """
    try:
        print(f"Evaluating sample {unique_id} with image: {input_image_url}")

        # Generate image using Gemini with the input image and optimized prompt (with image generation prefix)
        full_prompt = f"Generate an image: {optimized_prompt}"
        generated_image_bytes = generate_image_with_gemini(input_image_url, full_prompt)

        if not generated_image_bytes:
            print(f"CRITICAL ERROR: Failed to generate image for sample {unique_id}")
            return None

        # Save generated image to Cloud Storage and get URL
        generated_image_url = save_generated_image_to_storage(generated_image_bytes)

        # Store the generation record in database for download by test script
        store_generation_record(optimized_prompt, generated_image_url, unique_id, input_image_url, reference_image_url)

        # Evaluate the generated image against the reference image
        evaluation_score = evaluate_with_gemini_bytes(generated_image_bytes, reference_image_url)

        print(f"Sample {unique_id} evaluation score: {evaluation_score}")
        return evaluation_score

    except Exception as e:
        print(f"CRITICAL ERROR: Single sample evaluation failed: {e}")
        return None


def store_generation_record(prompt, generated_image_url, unique_id, input_image_url, reference_image_url):
    """Store generation record in database for download by test script"""
    try:
        # Initialize Supabase client
        supabase_url = os.environ.get('SUPABASE_URL')
        supabase_key = os.environ.get('SUPABASE_SERVICE_ROLE_KEY')

        if not supabase_url or not supabase_key:
            print("WARNING: Missing Supabase credentials - skipping database record")
            return

        supabase: Client = create_client(supabase_url, supabase_key)

        # Extract the actual training sample ID from the unique_id
        training_sample_id = None
        if '_sample_' in unique_id:
            sample_id_str = unique_id.split('_sample_')[-1]
            training_sample_id = int(sample_id_str) if sample_id_str.isdigit() else None

        # Insert generation record
        generation_record = {
            'training_sample_id': training_sample_id,
            'prompt_used': prompt,
            'generated_image_url': generated_image_url,
            'uploaded_image_url': input_image_url,  # Add the required input image URL
            'reference_image_url': reference_image_url,
            'generated_by': 'vertex-ai-optimizer-single-evaluation',
            'evaluation_unique_id': unique_id
        }

        response = supabase.table('optimizer_generations').insert(generation_record).execute()
        print(f"Generation record saved for {unique_id}")

    except Exception as e:
        print(f"WARNING: Failed to save generation record: {e}")




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
        uploaded_image_part = {
            "inline_data": {
                "data": image_base64,
                "mime_type": "image/jpeg"
            }
        }

        # Generate image using Gemini with only the uploaded image and prompt
        response = model.generate_content([prompt, uploaded_image_part])

        # Print response metadata (without the actual image data)
        print(f"Gemini response - Candidates: {len(response.candidates) if response.candidates else 0}")
        if response.candidates and len(response.candidates) > 0:
            candidate = response.candidates[0]
            print(f"Candidate finish_reason: {candidate.finish_reason}")
            print(f"Candidate content parts: {len(candidate.content.parts) if candidate.content and candidate.content.parts else 0}")
            if candidate.content and candidate.content.parts:
                for i, part in enumerate(candidate.content.parts):
                    if hasattr(part, 'text') and part.text:
                        print(f"Part {i}: text ({len(part.text)} chars): {part.text}")
                    elif hasattr(part, 'inline_data') and part.inline_data:
                        print(f"Part {i}: inline_data ({len(part.inline_data.data)} bytes, {part.inline_data.mime_type})")
                    else:
                        print(f"Part {i}: unknown type")

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



