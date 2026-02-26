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
        optimized_prompt = data.get("prompt", "")
        input_data = data.get("input", "")
        unique_id = data.get("unique_id", "unknown")

        # Parse input to extract source URL and source description
        if "," in input_data:
            input_image_url, source_description = input_data.split(",", 1)
        else:
            input_image_url = input_data
            source_description = None

        # Parse target based on evaluation mode
        target_data = data.get("target", "")
        mode_type, mode = get_evaluation_mode()

        if mode_type == "standalone_quality":
            # Standalone mode: target is a quality specification
            if target_data.startswith("quality_specification:"):
                quality_specification = target_data.replace("quality_specification:", "", 1)
                reference_image_url = None
            else:
                quality_specification = target_data
                reference_image_url = None

            print(f"Evaluating optimized prompt: {optimized_prompt}")
            print(f"Input image URL: {input_image_url}")
            print(f"Source description: {source_description}")
            print(f"Quality specification: {quality_specification[:200]}...")
            print(f"Unique ID: {unique_id}")
            print(f"Evaluation mode: {mode_type}")
        else:
            # Reference comparison mode: target is reference image + description
            if "," in target_data:
                reference_image_url, reference_description = target_data.split(",", 1)
            else:
                reference_image_url = target_data
                reference_description = None

            print(f"Evaluating optimized prompt: {optimized_prompt}")
            print(f"Input image URL: {input_image_url}")
            print(f"Source description: {source_description}")
            print(f"Reference image URL: {reference_image_url}")
            print(f"Reference description: {reference_description}")
            print(f"Unique ID: {unique_id}")
            print(f"Evaluation mode: {mode_type}")

        if not input_image_url:
            raise Exception("No input image URL provided")

        # Step 1: Evaluate the single sample
        if mode_type == "standalone_quality":
            score, explanation = evaluate_single_sample(
                optimized_prompt, input_image_url, unique_id, None, quality_specification
            )
        else:
            score, explanation = evaluate_single_sample(
                optimized_prompt, input_image_url, unique_id, reference_image_url
            )

        if score is None:
            raise Exception("Evaluation failed for the sample")

        # Clamp score between 0-1
        score = max(0.0, min(1.0, score))

        result = {
            "image_similarity_score": score,
            "explanation": explanation,
            "details": {
                "samples_evaluated": 1,
                "individual_scores": [score],
                "prompt_evaluated": optimized_prompt,
                "input_image_url": input_image_url,
                "unique_id": unique_id,
            },
        }

        print(f"Final evaluation result: {result}")
        return result

    except Exception as e:
        print(f"CRITICAL ERROR: Evaluation function failed: {e}")
        print(f"Exception type: {type(e).__name__}")
        import traceback
        print(f"Full traceback: {traceback.format_exc()}")
        raise e  # Fail loudly instead of returning fake results


def evaluate_single_sample(
    optimized_prompt, input_image_url, unique_id, reference_image_url=None, quality_specification=None
):
    """
    Evaluate a single training sample by:
    1. Using the input image with the optimized prompt to generate a new image
    2. Scoring the generated image based on evaluation mode
    """
    try:
        print(f"Evaluating sample {unique_id} with image: {input_image_url}")

        # Generate image using Gemini with the input image and optimized prompt (with image generation prefix)
        full_prompt = f"Generate an image: {optimized_prompt}"
        print(f"🎨 About to generate image with prompt: {full_prompt[:100]}...")
        print(f"📸 Using input image: {input_image_url}")

        try:
            generated_image_bytes = generate_image_with_gemini(input_image_url, full_prompt)
            print(f"✅ Image generation completed. Bytes received: {len(generated_image_bytes) if generated_image_bytes else 0}")
        except Exception as e:
            print(f"CRITICAL ERROR: Image generation failed for sample {unique_id}: {e}")
            print("📉 Returning score of 0.0 to penalize failed image generation")
            return 0.0, f"Image generation failed: {str(e)}"

        if not generated_image_bytes:
            print(f"CRITICAL ERROR: Failed to generate image for sample {unique_id}")
            print("📉 Returning score of 0.0 to penalize failed image generation")
            return 0.0, "Image generation failed - no image was produced"

        # Save generated image to Cloud Storage and get URL
        generated_image_url = save_generated_image_to_storage(generated_image_bytes)

        if not generated_image_url:
            print(f"CRITICAL ERROR: Failed to save image to storage for sample {unique_id}")
            print("📉 Returning score of 0.0 to penalize failed image storage")
            return 0.0, "Image storage failed - could not save generated image"

        # Store the generation record in database for download by test script
        # For standalone mode, reference_image_url will be None
        store_generation_record(
            optimized_prompt,
            generated_image_url,
            unique_id,
            input_image_url,
            reference_image_url,  # This might be None in standalone mode
        )

        # Evaluate the generated image based on the evaluation mode
        try:
            mode_type, mode = get_evaluation_mode()

            if mode_type == "standalone_quality":
                # Standalone quality evaluation - uses quality specification instead of reference
                evaluation_score, evaluation_explanation = evaluate_standalone_quality(
                    generated_image_bytes, input_image_url, optimized_prompt, quality_specification
                )
            else:
                # Reference comparison mode - compare against reference image
                evaluation_score, evaluation_explanation = evaluate_with_gemini_bytes(
                    generated_image_bytes, reference_image_url
                )

            print(f"Sample {unique_id} evaluation score: {evaluation_score}")
            return evaluation_score, evaluation_explanation

        except Exception as eval_error:
            print(f"CRITICAL ERROR: Evaluation failed for sample {unique_id}: {eval_error}")
            print("📉 Returning score of 0.0 to penalize failed evaluation")
            return 0.0, f"Evaluation failed: {str(eval_error)}"

    except Exception as e:
        print(f"CRITICAL ERROR: Single sample evaluation failed: {e}")
        print(f"Exception type: {type(e).__name__}")
        import traceback
        print(f"Full traceback: {traceback.format_exc()}")
        print("📉 Returning score of 0.0 to penalize failed sample evaluation")
        return 0.0, f"Sample evaluation failed: {str(e)}"


def store_generation_record(
    prompt, generated_image_url, unique_id, input_image_url, reference_image_url
):
    """Store generation record in database for download by test script"""
    try:
        # Initialize Supabase client
        supabase_url = os.environ.get("SUPABASE_URL")
        supabase_key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")

        if not supabase_url or not supabase_key:
            error_msg = f"CRITICAL ERROR: Missing Supabase credentials for image storage. URL: {bool(supabase_url)}, Key: {bool(supabase_key)}"
            print(error_msg)
            raise Exception(error_msg)

        supabase: Client = create_client(supabase_url, supabase_key)

        # Extract the actual training sample ID from the unique_id
        training_sample_id = None
        if "_sample_" in unique_id:
            sample_id_str = unique_id.split("_sample_")[-1]
            training_sample_id = int(sample_id_str) if sample_id_str.isdigit() else None

        # Get session ID from environment for data organization
        session_id = os.environ.get("SESSION_ID", "default-session")

        # Insert generation record with session ID
        generation_record = {
            "training_sample_id": training_sample_id,
            "prompt_used": prompt,
            "generated_image_url": generated_image_url,
            "uploaded_image_url": input_image_url,
            "reference_image_url": reference_image_url,  # Can be None for standalone mode
            "generated_by": "vertex-ai-optimizer-single-evaluation",
            "evaluation_unique_id": unique_id,
            "session_id": session_id,
        }

        response = (
            supabase.table("optimizer_generations").insert(generation_record).execute()
        )
        print(f"Generation record saved for {unique_id}")

    except Exception as e:
        print(f"CRITICAL ERROR: Failed to save generation record: {e}")
        print(f"Exception type: {type(e).__name__}")
        import traceback
        print(f"Full traceback: {traceback.format_exc()}")
        raise e  # Fail loudly instead of silently continuing


def generate_image_with_gemini(uploaded_image_url, prompt):
    """
    Use Gemini 2.5 Flash Image Preview to generate image based on uploaded image and prompt
    """
    try:
        print(f"🔧 Starting image generation with Gemini...")

        # Initialize Google AI SDK
        gemini_api_key = os.environ.get("GEMINI_API_KEY")
        if not gemini_api_key:
            raise Exception("GEMINI_API_KEY environment variable not set")

        print(f"🔑 Gemini API key found: {gemini_api_key[:20]}...")
        genai.configure(api_key=gemini_api_key)

        # Download uploaded image
        print(f"⬇️ Downloading image from: {uploaded_image_url}")
        img_response = requests.get(uploaded_image_url, timeout=30)
        print(f"📥 Image download response: {img_response.status_code}")

        if img_response.status_code != 200:
            raise Exception(
                f"Failed to download uploaded image: {img_response.status_code}"
            )

        # Use Gemini 2.5 Flash Image Preview to GENERATE image
        model = genai.GenerativeModel("gemini-3-pro-image-preview")

        # Create image part from uploaded image (Google AI SDK format)
        image_base64 = base64.b64encode(img_response.content).decode("utf-8")
        uploaded_image_part = {
            "inline_data": {"data": image_base64, "mime_type": "image/jpeg"}
        }

        # Force image output only - do not modify the actual prompt
        enhanced_prompt = f"""{prompt}

CRITICAL: You MUST respond with a single generated image file only. Do not provide text descriptions, explanations, or anything other than the actual image."""

        print(f"🎨 Enhanced prompt: {enhanced_prompt[:150]}...")

        # Generate image using Gemini with enhanced prompt
        response = model.generate_content([enhanced_prompt, uploaded_image_part])

        # Print response metadata (without the actual image data)
        print(
            f"Gemini response - Candidates: {len(response.candidates) if response.candidates else 0}"
        )
        if response.candidates and len(response.candidates) > 0:
            candidate = response.candidates[0]
            print(f"Candidate finish_reason: {candidate.finish_reason}")
            print(
                f"Candidate content parts: {len(candidate.content.parts) if candidate.content and candidate.content.parts else 0}"
            )
            if candidate.content and candidate.content.parts:
                for i, part in enumerate(candidate.content.parts):
                    if hasattr(part, "text") and part.text:
                        print(f"Part {i}: text ({len(part.text)} chars): {part.text}")
                    elif hasattr(part, "inline_data") and part.inline_data:
                        print(
                            f"Part {i}: inline_data ({len(part.inline_data.data)} bytes, {part.inline_data.mime_type})"
                        )
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
            if (
                hasattr(part, "inline_data")
                and part.inline_data
                and part.inline_data.data
            ):
                generated_image_data = part.inline_data.data
                break

        if not generated_image_data:
            raise Exception("Gemini did not return generated image data")

        # The data is already in bytes format, not base64
        generated_image_bytes = generated_image_data

        print(f"Generated image successfully ({len(generated_image_bytes)} bytes)")
        return generated_image_bytes

    except Exception as e:
        print(f"CRITICAL ERROR: Gemini image generation failed: {e}")
        raise Exception(f"Gemini image generation failed: {e}")


def smart_normalize_score_difference(score_difference):
    """
    Smart normalization function that converts score differences to 0-1 scale.

    Uses a sigmoid-like function that:
    - Maps 0 difference to 0.5 (equal quality)
    - Maps positive differences (generated > reference) to > 0.5
    - Maps negative differences (generated < reference) to < 0.5
    - Uses a steeper curve around 0 so small differences matter more
    - Asymptotically approaches 0 and 1 for large differences

    Score difference range: -100 to +100 (since each image can score 0-100 total)
    Output range: 0 to 1
    """
    import math

    # Scale factor - controls how steep the curve is
    # Smaller values = steeper curve around 0, larger values = gentler curve
    scale_factor = 20.0

    # Apply sigmoid function: 1 / (1 + e^(-x/scale))
    # This maps (-∞, +∞) to (0, 1) with midpoint at 0.5
    normalized_score = 1.0 / (1.0 + math.exp(-score_difference / scale_factor))

    return normalized_score


# Evaluation criteria definitions
EVALUATION_CRITERIA = {
    "comprehensive": {
        "name": "Comprehensive Pet Portrait Evaluation",
        "description": "10-category evaluation focusing on gift appeal and marketability",
        "categories": [
            "pet_likeness", "pose_expression", "art_style_consistency",
            "color_harmony", "background_quality", "technical_execution",
            "visual_appeal", "composition_proportion", "detail_balance", "gift_marketability"
        ],
        "prompt": """
You are evaluating AI-generated pet portraits for InstaMe's print-on-demand products. The best image is the one most likely to become a purchase. You will receive:

- **image1.png**: AI-generated stylized version (to evaluate)
- **image2.png**: Reference image (target quality)

**Step 1: Initial Analysis**

First, analyze each image and identify:

**IMAGE 1 ANALYSIS:**
- **Top 2 Strengths**: What makes this image successful?
- **Top 2 Weaknesses**: What needs improvement?

**IMAGE 2 ANALYSIS:**
- **Top 2 Strengths**: What makes this image successful?
- **Top 2 Weaknesses**: What needs improvement?

**Step 2: Detailed Category Scoring**

Rate each image in all categories using a scale of **0-10** (where 0 = terrible, 5 = average, 10 = perfect). Try to increase the range of these scores, you should have some scores in the range of 0-5 and some scores in the range of 5-10.

**A. PET LIKENESS (0-10)**
*Does the stylized pet retain the key features and characteristics of the original pet?*
- **Image 1**: [Score]/10 - Brief explanation
- **Image 2**: [Score]/10 - Brief explanation

**B. POSE & EXPRESSION (0-10)**
*Pet pose and expression should be natural, inviting and cute*
- **Image 1**: [Score]/10 - Brief explanation
- **Image 2**: [Score]/10 - Brief explanation

**C. ART STYLE CONSISTENCY (0-10)**
*Consistent artistic style throughout the image*
- **Image 1**: [Score]/10 - Brief explanation
- **Image 2**: [Score]/10 - Brief explanation

**D. COLOR HARMONY (0-10)**
*Colors work well together and enhance the overall appeal*
- **Image 1**: [Score]/10 - Brief explanation
- **Image 2**: [Score]/10 - Brief explanation

**E. BACKGROUND QUALITY (0-10)**
*Background complements the pet without being distracting*
- **Image 1**: [Score]/10 - Brief explanation
- **Image 2**: [Score]/10 - Brief explanation

**F. TECHNICAL EXECUTION (0-10)**
*Overall craftsmanship and technical quality*
- **Image 1**: [Score]/10 - Brief explanation
- **Image 2**: [Score]/10 - Brief explanation

**G. VISUAL APPEAL (0-10)**
*How aesthetically pleasing and attractive the image is*
- **Image 1**: [Score]/10 - Brief explanation
- **Image 2**: [Score]/10 - Brief explanation

**H. COMPOSITION & PROPORTION (0-10)**
*Pet centered, all elements well-proportioned for visual appeal*
- **Image 1**: [Score]/10 - Brief explanation
- **Image 2**: [Score]/10 - Brief explanation

**I. DETAIL BALANCE (0-10)**
*Sufficient detail for quality prints without overwhelming the composition*
- **Image 1**: [Score]/10 - Brief explanation
- **Image 2**: [Score]/10 - Brief explanation

**J. GIFT & MARKETABILITY APPEAL (0-10)**
*Would customers immediately want to buy this as a gift or keepsake? Does it evoke "I want to buy this" emotions?*
- **Image 1**: [Score]/10 - Brief explanation
- **Image 2**: [Score]/10 - Brief explanation

Return your response in this exact JSON format:
{
    "image1_analysis": {
        "strengths": ["strength1", "strength2"],
        "weaknesses": ["weakness1", "weakness2"]
    },
    "image2_analysis": {
        "strengths": ["strength1", "strength2"],
        "weaknesses": ["weakness1", "weakness2"]
    },
    "scores": {
        "image1": {
            "pet_likeness": X,
            "pose_expression": X,
            "art_style_consistency": X,
            "color_harmony": X,
            "background_quality": X,
            "technical_execution": X,
            "visual_appeal": X,
            "composition_proportion": X,
            "detail_balance": X,
            "gift_marketability": X
        },
        "image2": {
            "pet_likeness": X,
            "pose_expression": X,
            "art_style_consistency": X,
            "color_harmony": X,
            "background_quality": X,
            "technical_execution": X,
            "visual_appeal": X,
            "composition_proportion": X,
            "detail_balance": X,
            "gift_marketability": X
        }
    }
}
        """
    },
    "simplified": {
        "name": "Simplified Pet Portrait Evaluation",
        "description": "5-category evaluation focusing on core visual qualities",
        "categories": [
            "pet_likeness", "visual_appeal", "technical_execution",
            "composition_proportion", "gift_marketability"
        ],
        "prompt": """
You are evaluating AI-generated pet portraits for InstaMe's print-on-demand products. You will receive:

- **image1.png**: AI-generated stylized version (to evaluate)
- **image2.png**: Reference image (target quality)

Rate each image in the following 5 core categories using a scale of **0-10** (where 0 = terrible, 5 = average, 10 = perfect):

**A. PET LIKENESS (0-10)**
*Does the stylized pet retain the key features and characteristics of the original pet?*
- **Image 1**: [Score]/10 - Brief explanation
- **Image 2**: [Score]/10 - Brief explanation

**B. VISUAL APPEAL (0-10)**
*How aesthetically pleasing and attractive the image is overall*
- **Image 1**: [Score]/10 - Brief explanation
- **Image 2**: [Score]/10 - Brief explanation

**C. TECHNICAL EXECUTION (0-10)**
*Overall craftsmanship, quality, and professional appearance*
- **Image 1**: [Score]/10 - Brief explanation
- **Image 2**: [Score]/10 - Brief explanation

**D. COMPOSITION & PROPORTION (0-10)**
*Pet centered, well-framed, and proportioned for visual impact*
- **Image 1**: [Score]/10 - Brief explanation
- **Image 2**: [Score]/10 - Brief explanation

**E. GIFT & MARKETABILITY APPEAL (0-10)**
*Would customers want to buy this as a gift? Commercial appeal?*
- **Image 1**: [Score]/10 - Brief explanation
- **Image 2**: [Score]/10 - Brief explanation

Return your response in this exact JSON format:
{
    "image1_analysis": {
        "strengths": ["strength1", "strength2"],
        "weaknesses": ["weakness1", "weakness2"]
    },
    "image2_analysis": {
        "strengths": ["strength1", "strength2"],
        "weaknesses": ["weakness1", "weakness2"]
    },
    "scores": {
        "image1": {
            "pet_likeness": X,
            "visual_appeal": X,
            "technical_execution": X,
            "composition_proportion": X,
            "gift_marketability": X
        },
        "image2": {
            "pet_likeness": X,
            "visual_appeal": X,
            "technical_execution": X,
            "composition_proportion": X,
            "gift_marketability": X
        }
    }
}
        """
    },
    "artistic": {
        "name": "Artistic Quality Evaluation",
        "description": "6-category evaluation focusing on artistic merit and style",
        "categories": [
            "art_style_consistency", "color_harmony", "visual_appeal",
            "technical_execution", "composition_proportion", "creative_interpretation"
        ],
        "prompt": """
You are evaluating AI-generated pet portraits from an artistic perspective. Focus on artistic merit, style consistency, and creative interpretation. You will receive:

- **image1.png**: AI-generated stylized version (to evaluate)
- **image2.png**: Reference image (target quality)

Rate each image in the following artistic categories using a scale of **0-10**:

**A. ART STYLE CONSISTENCY (0-10)**
*Consistent artistic style and technique throughout the image*
- **Image 1**: [Score]/10 - Brief explanation
- **Image 2**: [Score]/10 - Brief explanation

**B. COLOR HARMONY (0-10)**
*Colors work well together and create pleasing visual combinations*
- **Image 1**: [Score]/10 - Brief explanation
- **Image 2**: [Score]/10 - Brief explanation

**C. VISUAL APPEAL (0-10)**
*Overall aesthetic beauty and artistic attractiveness*
- **Image 1**: [Score]/10 - Brief explanation
- **Image 2**: [Score]/10 - Brief explanation

**D. TECHNICAL EXECUTION (0-10)**
*Skill in rendering, detail work, and artistic craftsmanship*
- **Image 1**: [Score]/10 - Brief explanation
- **Image 2**: [Score]/10 - Brief explanation

**E. COMPOSITION & PROPORTION (0-10)**
*Artistic arrangement of elements and visual balance*
- **Image 1**: [Score]/10 - Brief explanation
- **Image 2**: [Score]/10 - Brief explanation

**F. CREATIVE INTERPRETATION (0-10)**
*Artistic creativity and unique stylistic interpretation*
- **Image 1**: [Score]/10 - Brief explanation
- **Image 2**: [Score]/10 - Brief explanation

Return your response in this exact JSON format:
{
    "image1_analysis": {
        "strengths": ["strength1", "strength2"],
        "weaknesses": ["weakness1", "weakness2"]
    },
    "image2_analysis": {
        "strengths": ["strength1", "strength2"],
        "weaknesses": ["weakness1", "weakness2"]
    },
    "scores": {
        "image1": {
            "art_style_consistency": X,
            "color_harmony": X,
            "visual_appeal": X,
            "technical_execution": X,
            "composition_proportion": X,
            "creative_interpretation": X
        },
        "image2": {
            "art_style_consistency": X,
            "color_harmony": X,
            "visual_appeal": X,
            "technical_execution": X,
            "composition_proportion": X,
            "creative_interpretation": X
        }
    }
}
        """
    }
}


# Evaluation mode definitions
EVALUATION_MODES = {
    "reference_comparison": {
        "name": "Reference Comparison Mode",
        "description": "Compare generated image against OpenAI reference image",
        "requires_reference": True
    },
    "standalone_quality": {
        "name": "Standalone Quality Mode",
        "description": "Evaluate generated image quality independently using ideal criteria",
        "requires_reference": False
    }
}


def get_evaluation_criteria():
    """
    Get the evaluation criteria based on environment variable.
    Default to 'comprehensive' if not specified.
    """
    criteria_type = os.environ.get("EVALUATION_CRITERIA", "comprehensive")

    if criteria_type not in EVALUATION_CRITERIA:
        print(f"⚠️ Warning: Unknown evaluation criteria '{criteria_type}', using 'comprehensive'")
        criteria_type = "comprehensive"

    criteria = EVALUATION_CRITERIA[criteria_type]
    print(f"📋 Using evaluation criteria: {criteria['name']}")
    return criteria


def get_evaluation_mode():
    """
    Get the evaluation mode based on environment variable.
    Default to 'reference_comparison' if not specified.
    """
    mode_type = os.environ.get("EVALUATION_MODE", "reference_comparison")

    if mode_type not in EVALUATION_MODES:
        print(f"⚠️ Warning: Unknown evaluation mode '{mode_type}', using 'reference_comparison'")
        mode_type = "reference_comparison"

    mode = EVALUATION_MODES[mode_type]
    print(f"📋 Using evaluation mode: {mode['name']}")
    return mode_type, mode


def evaluate_with_gemini_bytes(generated_image_bytes, reference_image_url):
    """
    Use Gemini to evaluate generated image bytes vs reference image URL
    """
    try:
        # Initialize Google AI SDK
        gemini_api_key = os.environ.get("GEMINI_API_KEY")
        if not gemini_api_key:
            raise Exception("GEMINI_API_KEY environment variable not set")

        genai.configure(api_key=gemini_api_key)

        # Download reference image for evaluation
        reference_response = requests.get(reference_image_url, timeout=30)

        # Create image parts for Gemini (Google AI SDK format)
        generated_base64 = base64.b64encode(generated_image_bytes).decode("utf-8")
        reference_base64 = base64.b64encode(reference_response.content).decode("utf-8")

        generated_part = {
            "inline_data": {"data": generated_base64, "mime_type": "image/png"}
        }
        reference_part = {
            "inline_data": {"data": reference_base64, "mime_type": "image/jpeg"}
        }

        # Get evaluation criteria and prompt
        criteria = get_evaluation_criteria()
        evaluation_prompt = criteria["prompt"]

        # Call Gemini for evaluation
        model = genai.GenerativeModel("gemini-3-pro-image-preview")

        response = model.generate_content(
            [
                evaluation_prompt,
                "Generated image:",
                generated_part,
                "Reference image:",
                reference_part,
            ]
        )

        # Parse the JSON response
        try:
            evaluation_text = response.text.strip()
            print(f"Raw Gemini evaluation response: {evaluation_text}")

            # Extract JSON from response
            start_idx = evaluation_text.find("{")
            end_idx = evaluation_text.rfind("}") + 1
            if start_idx >= 0 and end_idx > start_idx:
                json_str = evaluation_text[start_idx:end_idx]
                evaluation_data = json.loads(json_str)
            else:
                raise ValueError("No valid JSON found in response")

        except (json.JSONDecodeError, ValueError) as e:
            print(f"CRITICAL ERROR: Failed to parse Gemini evaluation response: {e}")
            raise Exception(f"Failed to parse Gemini evaluation response: {e}")

        # Extract scores for both images
        if (
            "scores" not in evaluation_data
            or "image1" not in evaluation_data["scores"]
            or "image2" not in evaluation_data["scores"]
        ):
            raise ValueError("Missing required score data in evaluation response")

        image1_scores = evaluation_data["scores"]["image1"]
        image2_scores = evaluation_data["scores"]["image2"]

        # Get the score categories from the current evaluation criteria
        criteria = get_evaluation_criteria()
        score_categories = criteria["categories"]

        # Calculate total scores for each image (sum of all categories in the criteria)
        image1_total = sum(
            image1_scores.get(category, 0) for category in score_categories
        )
        image2_total = sum(
            image2_scores.get(category, 0) for category in score_categories
        )

        # Calculate the difference (generated - reference)
        score_difference = image1_total - image2_total

        # Smart normalization using sigmoid function
        # This creates a smoother curve where small differences matter more
        final_score = smart_normalize_score_difference(score_difference)

        print(f"Image1 (generated) total score: {image1_total}/100")
        print(f"Image2 (reference) total score: {image2_total}/100")
        print(f"Score difference: {score_difference}")
        print(f"Final normalized score: {final_score}")

        return final_score, evaluation_text

    except Exception as e:
        print(f"CRITICAL ERROR: Gemini evaluation failed: {e}")
        raise Exception(f"Gemini evaluation failed: {e}")


def evaluate_standalone_quality(generated_image_bytes, input_image_url, prompt, quality_specification=None):
    """
    Evaluate generated image quality independently without reference comparison.
    Uses provided quality specification or creates ideal quality standards.
    """
    try:
        # Initialize Google AI SDK
        gemini_api_key = os.environ.get("GEMINI_API_KEY")
        if not gemini_api_key:
            raise Exception("GEMINI_API_KEY environment variable not set")

        genai.configure(api_key=gemini_api_key)

        # Download input image for context
        input_response = requests.get(input_image_url, timeout=30)

        # Create image parts for Gemini (Google AI SDK format)
        generated_base64 = base64.b64encode(generated_image_bytes).decode("utf-8")
        input_base64 = base64.b64encode(input_response.content).decode("utf-8")

        generated_part = {
            "inline_data": {"data": generated_base64, "mime_type": "image/png"}
        }
        input_part = {
            "inline_data": {"data": input_base64, "mime_type": "image/jpeg"}
        }

        # Get evaluation criteria and create standalone evaluation prompt
        criteria = get_evaluation_criteria()

        # Create standalone evaluation prompt using descriptive target
        if quality_specification:
            # Use the descriptive target for evaluation
            standalone_prompt = f"""
You are evaluating an AI-generated pet portrait for InstaMe's print-on-demand products. You will receive:

- **Original Image**: The source pet photo provided by the customer
- **Generated Image**: The AI-generated stylized version to evaluate
- **Prompt Used**: "{prompt}"
- **Ideal Target Description**: A detailed description of what the perfect commercial pet portrait should look like

**Ideal Target Description:**
{quality_specification}

**Your Task**: Rate how well the generated image matches this ideal target description. Compare the generated image against both the original pet characteristics and the ideal target description.

**Evaluation Categories** (Rate each 0-10, where 0=terrible, 5=average, 10=perfect):

{chr(10).join([f"**{cat.upper().replace('_', ' ')} (0-10)**" for cat in criteria["categories"]])}

**Rating Instructions:**
- **10**: Generated image perfectly matches the ideal target description
- **8-9**: Generated image closely matches the ideal with minor differences
- **6-7**: Generated image partially matches the ideal with some notable differences
- **4-5**: Generated image somewhat matches but has significant differences from ideal
- **2-3**: Generated image poorly matches the ideal target description
- **0-1**: Generated image fails to match the ideal target description

**Evaluation Focus:**
1. How closely does the generated image match the ideal target description?
2. Does it capture the pet's unique characteristics as described in the ideal?
3. Does it achieve the commercial quality and appeal described in the target?
4. Does it have the artistic style, composition, and technical execution described?

Return your response in this exact JSON format:
{{
    "analysis": {{
        "target_matching": "How well does the generated image match the ideal target description?",
        "pet_accuracy": "How accurately does it represent the pet as described in the ideal?",
        "commercial_quality": "How well does it achieve the commercial standards described in the target?",
        "overall_assessment": "Overall assessment comparing generated vs ideal target"
    }},
    "scores": {{
{chr(10).join([f'        "{cat}": X,' for cat in criteria["categories"]])}
    }}
}}
            """
        else:
            # Fallback if no quality specification provided
            standalone_prompt = f"""
You are evaluating an AI-generated pet portrait for InstaMe's print-on-demand products. You will receive:

- **Original Image**: The source pet photo provided by the customer
- **Generated Image**: The AI-generated stylized version to evaluate
- **Prompt Used**: "{prompt}"

**Your Task**: Evaluate the generated image for commercial pet portrait quality, considering the original pet's characteristics.

Rate each category 0-10 (where 0=terrible, 5=average, 10=perfect):

{chr(10).join([f"**{cat.upper().replace('_', ' ')} (0-10)**" for cat in criteria["categories"]])}

Return your response in this exact JSON format:
{{
    "analysis": {{
        "prompt_fulfillment": "How well does the generated image fulfill the prompt?",
        "pet_accuracy": "How accurately does it represent the original pet?",
        "commercial_appeal": "How appealing is this for commercial products?",
        "overall_assessment": "Overall quality assessment"
    }},
    "scores": {{
{chr(10).join([f'        "{cat}": X,' for cat in criteria["categories"]])}
    }}
}}
            """

        # Call Gemini for evaluation
        model = genai.GenerativeModel("gemini-3-pro-image-preview")

        response = model.generate_content([
            standalone_prompt,
            "Original pet image:",
            input_part,
            "Generated image to evaluate:",
            generated_part,
        ])

        # Parse the JSON response
        try:
            evaluation_text = response.text.strip()
            print(f"Raw Gemini standalone evaluation response: {evaluation_text}")

            # Extract JSON from response
            start_idx = evaluation_text.find("{")
            end_idx = evaluation_text.rfind("}") + 1
            if start_idx >= 0 and end_idx > start_idx:
                json_str = evaluation_text[start_idx:end_idx]
                evaluation_data = json.loads(json_str)
            else:
                raise ValueError("No valid JSON found in response")

        except (json.JSONDecodeError, ValueError) as e:
            print(f"CRITICAL ERROR: Failed to parse Gemini standalone evaluation response: {e}")
            raise Exception(f"Failed to parse Gemini standalone evaluation response: {e}")

        # Extract scores
        if "scores" not in evaluation_data:
            raise ValueError("Missing required score data in evaluation response")

        scores = evaluation_data["scores"]

        # Calculate total score (sum of all categories)
        score_categories = criteria["categories"]
        total_score = sum(scores.get(category, 0) for category in score_categories)
        max_possible_score = len(score_categories) * 10

        # Normalize to 0-1 scale
        final_score = total_score / max_possible_score if max_possible_score > 0 else 0

        print(f"Standalone evaluation total score: {total_score}/{max_possible_score}")
        print(f"Final normalized score: {final_score}")

        return final_score, evaluation_text

    except Exception as e:
        print(f"CRITICAL ERROR: Gemini standalone evaluation failed: {e}")
        raise Exception(f"Gemini standalone evaluation failed: {e}")


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

        # Get session ID for organized storage
        session_id = os.environ.get("SESSION_ID", "default-session")

        # Upload image with session-specific path
        filename = f"generated-images/{session_id}/{int(os.urandom(8).hex(), 16)}.jpg"
        blob = bucket.blob(filename)
        blob.upload_from_string(image_bytes, content_type="image/jpeg")

        # Return public URL (bucket should already have public access configured)
        return f"https://storage.googleapis.com/{bucket_name}/{filename}"

    except Exception as e:
        print(f"CRITICAL ERROR: Storage upload failed: {e}")
        raise Exception(f"Storage upload failed: {e}")
