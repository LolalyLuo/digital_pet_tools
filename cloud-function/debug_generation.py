#!/usr/bin/env python3
import os
import base64
import google.generativeai as genai
import requests

# Set environment variables
os.environ['GEMINI_API_KEY'] = 'AIzaSyAPQ-0AId_Wc76gSsCTOeZbNEBC_hRl4xQ'

print("Testing Gemini image generation debug...")

try:
    # Initialize Google AI SDK
    genai.configure(api_key=os.environ.get('GEMINI_API_KEY'))

    # Download test image
    test_image_url = "https://jdihcycihovuzdxnqfdo.supabase.co/storage/v1/object/public/product-images/23289100337516/uploaded/1756160374534_gegtkt.png"
    img_response = requests.get(test_image_url, timeout=30)
    if img_response.status_code != 200:
        raise Exception(f"Failed to download test image: {img_response.status_code}")

    print(f"Downloaded test image: {len(img_response.content)} bytes")

    # Create image part
    image_base64 = base64.b64encode(img_response.content).decode('utf-8')
    image_part = {
        "inline_data": {
            "data": image_base64,
            "mime_type": "image/jpeg"
        }
    }

    # Test prompt
    prompt = "Create a cute baby bodysuit design with soft pastel colors"

    # Use Gemini 2.5 Flash Image Preview
    model = genai.GenerativeModel("gemini-2.5-flash-image-preview")

    print("Calling Gemini...")
    response = model.generate_content([prompt, image_part])

    print(f"Response received, candidates: {len(response.candidates) if response.candidates else 0}")

    if not response.candidates or len(response.candidates) == 0:
        print("ERROR: No candidates returned")
    else:
        candidate = response.candidates[0]
        print(f"Candidate content exists: {candidate.content is not None}")

        if candidate.content and candidate.content.parts:
            print(f"Number of content parts: {len(candidate.content.parts)}")

            for i, part in enumerate(candidate.content.parts):
                print(f"Part {i}:")
                print(f"  Has text: {hasattr(part, 'text') and part.text}")
                print(f"  Has inline_data: {hasattr(part, 'inline_data') and part.inline_data}")

                if hasattr(part, 'text') and part.text:
                    print(f"  Text content: {part.text[:200]}...")

                if hasattr(part, 'inline_data') and part.inline_data:
                    print(f"  Inline data available: {part.inline_data.data is not None}")
                    if part.inline_data.data:
                        print(f"  Data length: {len(part.inline_data.data)}")
                        print(f"  Mime type: {getattr(part.inline_data, 'mime_type', 'unknown')}")

except Exception as e:
    print(f"Debug test failed: {e}")
    import traceback
    traceback.print_exc()