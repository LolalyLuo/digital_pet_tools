// Follow this setup guide to integrate the Deno language server with your editor:
// https://deno.land/manual/getting_started/setup_your_environment
// This enables autocomplete, go to definition, etc.

// Setup type definitions for built-in Supabase Runtime APIs
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { GoogleGenerativeAI } from "npm:@google/generative-ai";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers":
    "Content-Type, Authorization, x-client-info, apikey",
  "Access-Control-Max-Age": "86400",
};

const IMAGE_SIZE = 1024; // You can adjust this as needed
const BATCH_SIZE = 3; // Process 3 images in parallel at a time

// Fetch image as PNG File (adapted from your working code)
async function fetchImageAsFile(url: string, fileName: string): Promise<File> {
  const resp = await fetch(url);
  const blob = await resp.blob();
  // Force PNG type for OpenAI API
  return new File([blob], fileName, { type: "image/png" });
}

// Convert File to base64 for Gemini API
async function fileToBase64(file: File): Promise<string> {
  const arrayBuffer = await file.arrayBuffer();
  const uint8Array = new Uint8Array(arrayBuffer);

  // Convert in chunks to avoid call stack overflow
  let binaryString = "";
  const chunkSize = 1024; // Smaller chunks to be safe

  for (let i = 0; i < uint8Array.length; i += chunkSize) {
    const chunk = uint8Array.slice(i, i + chunkSize);
    // Convert chunk to string without spread operator
    for (let j = 0; j < chunk.length; j++) {
      binaryString += String.fromCharCode(chunk[j]);
    }
  }

  return btoa(binaryString);
}

// Generate image using Gemini API
async function generateWithGemini(
  petFile: File,
  prompt: string,
  background: string,
  size: string,
  geminiApiKey: string
): Promise<{ imageBase64: string; mimeType: string }> {
  console.log("🤖 Using Gemini for image generation...");

  const genAI = new GoogleGenerativeAI(geminiApiKey);
  const model = genAI.getGenerativeModel({
    model: "gemini-3-pro-image-preview",
    generationConfig: {
      temperature: 0.4,
      topP: 0.9,
      topK: 50,
      candidateCount: 1,
    },
  });

  // Build editing prompt for Gemini
  let editingPrompt = `Using the provided image of the pet, please ${prompt}.`;
  editingPrompt += ` IMPORTANT: Frame the pet as the main subject filling most of the image area. Use a medium close-up shot that captures the pet's full body or portrait with the pet taking up 60-80% of the frame. Avoid distant or wide shots that make the pet appear small.`;

  if (background === "transparent") {
    editingPrompt += `
          Requirements:
          - Use the pet only and no other elements from the photo.
          - Background: The pet is isolated on empty background, no background elements, no setting, transparent background, with pet only.
          - Composition: Clean, centered design that works on different product formats. Ensure some empty space around the pet and nothing is cutoff.
          - Quality: High quality designs that print well on merchandise. `;
  } else if (background === "opaque") {
    editingPrompt += `
          Requirements:
          - Use the pet only and no other elements from the photo.
          - Background: background should match the general theme and style..
          - Composition: Clean, centered design that works on different product formats. 
          - Quality: High quality designs with beautiful pet and detailed background. `;
  }

  // Add aspect ratio guidance
  const aspectInstructions = {
    auto: "Compose the image in a square format",
    "1024x1024": "Compose the image in a square format",
    "1024x1536": "Compose the image in a vertical portrait format",
    "1536x1024": "Compose the image in a horizontal landscape format",
  };

  editingPrompt += ` ${
    aspectInstructions[size] || aspectInstructions["auto"]
  }.`;
  editingPrompt += ` Technical requirements: High-resolution output, sharp details, vibrant colors, professional quality. Ensure clean composition with the pet properly centered and sized within the frame. Nothing should be cut off at the edges. THE MOST IMPROTANT THING IS TO PRESERVE THE UNIQUE CHARACTER OF THE PET. Pay close attention to the color and texture of the fur, the eyes, nose, face, tail, ears and body. It should look just like the pet in the photo but with different styles depending on the prompt!`;

  // Convert image to base64
  const imageBase64 = await fileToBase64(petFile);

  const imageData = {
    inlineData: {
      data: imageBase64,
      mimeType: petFile.type,
    },
  };

  const result = await model.generateContent([editingPrompt, imageData]);
  const response = result.response;

  if (response.candidates && response.candidates[0]) {
    const candidate = response.candidates[0];

    if (candidate.content && candidate.content.parts) {
      for (const part of candidate.content.parts) {
        if (part.inlineData && part.inlineData.data) {
          console.log(
            `✅ Gemini image generation completed (${Math.round(
              part.inlineData.data.length / 1000
            )}KB)`
          );
          return {
            imageBase64: part.inlineData.data,
            mimeType: part.inlineData.mimeType,
          };
        }
      }
    }
  }

  throw new Error("Gemini failed to return edited image");
}

// Generate image using Gemini API with image-to-image (template swapping)
async function generateWithGeminiImg2Img(
  petFile: File,
  templateFile: File,
  prompt: string,
  background: string,
  size: string,
  geminiApiKey: string
): Promise<{ imageBase64: string; mimeType: string }> {
  console.log("🤖 Using Gemini for image-to-image generation...");

  const genAI = new GoogleGenerativeAI(geminiApiKey);
  const model = genAI.getGenerativeModel({
    model: "gemini-3-pro-image-preview",
    generationConfig: {
      temperature: 0.4,
      topP: 0.9,
      topK: 50,
      candidateCount: 1,
    },
  });

  // Build img2img prompt for Gemini with explicit image identification
  let img2imgPrompt = `Task: Replace the pet in the template image with the pet from the user photo.

Instructions:
- The first image is the user's pet photo (source pet)
- The second image is the template with a different pet (target template)
- Replace the pet in the template while preserving the template's style, pose, and setting
- Keep the user's pet's unique features (color, markings, breed characteristics)
- The result should look like the user's pet but in the style and setting of the template image.`;

  if (background === "transparent") {
    img2imgPrompt += `
          Additional Requirements:
          - Replace the pet in the template (second image) with the user's pet (first image)
          - Background: Keep the template's background style but ensure the pet is properly integrated
          - Composition: Maintain the template's composition and framing
          - Quality: High quality result that preserves both the pet's unique features and the template's artistic style. `;
  } else if (background === "opaque") {
    img2imgPrompt += `
          Additional Requirements:
          - Replace the pet in the template (second image) with the user's pet (first image)
          - Background: Keep the template's background and setting
          - Composition: Maintain the template's composition and artistic style
          - Quality: High quality result that seamlessly blends the user's pet into the template's style. `;
  }

  // Add aspect ratio guidance
  const aspectInstructions = {
    auto: "Maintain the template image's aspect ratio and composition",
    "1024x1024": "Maintain a square format like the template",
    "1024x1536": "Maintain a vertical portrait format like the template",
    "1536x1024": "Maintain a horizontal landscape format like the template",
  };

  img2imgPrompt += ` ${
    aspectInstructions[size] || aspectInstructions["auto"]
  }.`;
  img2imgPrompt += ` 

Technical requirements: High-resolution output, sharp details, vibrant colors, professional quality. 

CRITICAL: Remember that the first image is the user's pet (source) and the second image is the template (target). The most important thing is to preserve the unique character and features of the user's pet while adopting the style, pose, and artistic elements from the template image.`;

  // Convert both images to base64
  const petImageBase64 = await fileToBase64(petFile);
  const templateImageBase64 = await fileToBase64(templateFile);

  console.log(
    `📸 Pet image (source): ${petFile.size} bytes, type: ${petFile.type}`
  );
  console.log(
    `🎨 Template image (target): ${templateFile.size} bytes, type: ${templateFile.type}`
  );

  const petImageData = {
    inlineData: {
      data: petImageBase64,
      mimeType: petFile.type,
    },
  };

  const templateImageData = {
    inlineData: {
      data: templateImageBase64,
      mimeType: templateFile.type,
    },
  };

  const result = await model.generateContent([
    img2imgPrompt,
    petImageData,
    templateImageData,
  ]);
  const response = result.response;

  if (response.candidates && response.candidates[0]) {
    const candidate = response.candidates[0];

    if (candidate.content && candidate.content.parts) {
      for (const part of candidate.content.parts) {
        if (part.inlineData && part.inlineData.data) {
          console.log(
            `✅ Gemini img2img generation completed (${Math.round(
              part.inlineData.data.length / 1000
            )}KB)`
          );
          return {
            imageBase64: part.inlineData.data,
            mimeType: part.inlineData.mimeType,
          };
        }
      }
    }
  }

  throw new Error("Gemini failed to return img2img result");
}

Deno.serve(async (req) => {
  console.log("🚀 Image generation function started");

  // Handle CORS preflight requests
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 200,
      headers: corsHeaders,
    });
  }

  try {
    const {
      photoIds,
      prompts,
      size = "auto",
      background = "opaque",
      model = "openai",
      templateNumbers = [],
    } = await req.json();
    console.log(
      `📸 Processing ${photoIds?.length || 0} photos with ${
        prompts?.length || 0
      } prompts, size: ${size}, background: ${background}, model: ${model}${
        templateNumbers?.length > 0
          ? `, template numbers: ${templateNumbers.join(", ")}`
          : ""
      }`
    );

    if (
      !photoIds ||
      !prompts ||
      photoIds.length === 0 ||
      prompts.length === 0
    ) {
      console.error("❌ Missing required parameters:", { photoIds, prompts });
      return new Response(
        JSON.stringify({
          error:
            "Missing required parameters: photoIds and prompts are required",
        }),
        {
          status: 400,
          headers: {
            "Content-Type": "application/json",
            ...corsHeaders,
          },
        }
      );
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const openaiApiKey = Deno.env.get("OPENAI_API_KEY");
    const geminiApiKey = Deno.env.get("GEMINI_API_KEY");

    if (!supabaseUrl || !supabaseServiceKey) {
      console.error("❌ Missing required environment variables:", {
        hasUrl: !!supabaseUrl,
        hasServiceKey: !!supabaseServiceKey,
      });
      return new Response(
        JSON.stringify({ error: "Missing required environment variables" }),
        {
          status: 500,
          headers: {
            "Content-Type": "application/json",
            ...corsHeaders,
          },
        }
      );
    }

    // Check for API keys based on selected model
    if (model === "openai" && !openaiApiKey) {
      console.error("❌ Missing OpenAI API key for OpenAI model");
      return new Response(JSON.stringify({ error: "Missing OpenAI API key" }), {
        status: 500,
        headers: {
          "Content-Type": "application/json",
          ...corsHeaders,
        },
      });
    }

    if ((model === "gemini" || model === "gemini-img2img") && !geminiApiKey) {
      console.error("❌ Missing Gemini API key for Gemini model");
      return new Response(JSON.stringify({ error: "Missing Gemini API key" }), {
        status: 500,
        headers: {
          "Content-Type": "application/json",
          ...corsHeaders,
        },
      });
    }

    // Validate template numbers for img2img model
    if (model === "gemini-img2img") {
      if (!templateNumbers || templateNumbers.length === 0) {
        console.error("❌ Missing template numbers for Gemini img2img model");
        return new Response(
          JSON.stringify({
            error:
              "Template numbers are required for Gemini Image-to-Image mode",
          }),
          {
            status: 400,
            headers: {
              "Content-Type": "application/json",
              ...corsHeaders,
            },
          }
        );
      }
    }

    // Fetch template images for img2img model
    let templateImages: Array<{
      id: number;
      image_url: string;
      public_url: string;
    }> = [];
    if (model === "gemini-img2img") {
      console.log(
        `🔍 Fetching template images for numbers: ${templateNumbers.join(", ")}`
      );

      const templateResponse = await fetch(
        `${supabaseUrl}/rest/v1/generated_images?number=in.(${templateNumbers.join(
          ","
        )})&select=number,image_url`,
        {
          headers: {
            apikey: supabaseServiceKey,
            Authorization: `Bearer ${supabaseServiceKey}`,
            "Content-Type": "application/json",
          },
        }
      );

      if (!templateResponse.ok) {
        console.error(`❌ Failed to fetch template images:`, {
          status: templateResponse.status,
          statusText: templateResponse.statusText,
        });
        return new Response(
          JSON.stringify({ error: "Failed to fetch template images" }),
          {
            status: 500,
            headers: {
              "Content-Type": "application/json",
              ...corsHeaders,
            },
          }
        );
      }

      const templateData = await templateResponse.json();
      templateImages = templateData.map((img: any) => ({
        id: img.number,
        image_url: img.image_url,
        public_url: `${supabaseUrl}/storage/v1/object/public/generated-images/${img.image_url}`,
      }));

      console.log(`✅ Found ${templateImages.length} template images`);
    }

    const results: Array<{
      id: string;
      photo_id: string;
      initial_prompt: string;
      generated_prompt: string;
      image_url: string;
      public_url: string;
      original_photo_url: string;
      created_at: string;
      status: string;
    }> = [];

    // Create all photo-prompt combinations for parallel processing
    const combinations: Array<{
      photoId: string;
      prompt: string;
      size: string;
      background: string;
      model: string;
      templateImage?: { id: number; image_url: string; public_url: string };
    }> = [];

    if (model === "gemini-img2img") {
      // For img2img: combine each pet photo with each template image
      for (const photoId of photoIds) {
        for (const templateImage of templateImages) {
          combinations.push({
            photoId,
            prompt: prompts[0], // Use first prompt for img2img
            size,
            background,
            model,
            templateImage,
          });
        }
      }
    } else {
      // For regular generation: combine each pet photo with each prompt
      for (const photoId of photoIds) {
        for (const prompt of prompts) {
          combinations.push({ photoId, prompt, size, background, model });
        }
      }
    }

    // Process combinations in batches to avoid overwhelming CPU and hitting rate limits
    const resultsArray: Array<any> = [];

    for (let i = 0; i < combinations.length; i += BATCH_SIZE) {
      const batch = combinations.slice(i, i + BATCH_SIZE);
      console.log(
        `🔄 Processing batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(
          combinations.length / BATCH_SIZE
        )} (${batch.length} items)`
      );

      const batchPromises = batch.map(
        async ({ photoId, prompt, size, background, model, templateImage }) => {
          try {
            // Get photo details from database
            const photoResponse = await fetch(
              `${supabaseUrl}/rest/v1/uploaded_photos?id=eq.${photoId}`,
              {
                headers: {
                  apikey: supabaseServiceKey,
                  Authorization: `Bearer ${supabaseServiceKey}`,
                  "Content-Type": "application/json",
                },
              }
            );

            if (!photoResponse.ok) {
              console.error(`❌ Failed to fetch photo ${photoId}:`, {
                status: photoResponse.status,
                statusText: photoResponse.statusText,
              });
              return null;
            }

            const photoData = await photoResponse.json();
            if (photoData.length === 0) {
              console.warn(`⚠️ No photo data found for ID: ${photoId}`);
              return null;
            }

            const photo = photoData[0];

            // Get pet image URL with transformation to ensure proper format and size
            const petImageUrl = `${supabaseUrl}/storage/v1/object/public/uploaded-photos/${photo.file_path}?width=400&height=400&quality=80&format=webp`;

            console.log(
              `🎨 Processing prompt: "${prompt}" for photo ${photoId}`
            );

            const additionalPromptOpaque = `
          Requirements:
          - Use the pet only and no other elements from the photo.
          - Background: background should match the general theme and style..
          - Composition: Clean, centered design that works on different product formats. 
          - Quality: High quality designs with beautiful pet and detailed background. `;

            const additionalPromptTransparent = `
          Requirements:
          - Use the pet only and no other elements from the photo.
          - Background: The pet is isolated on empty background, no background elements, no setting, transparent background, with pet only.
          - Composition: Clean, centered design that works on different product formats. Ensure some empty space around the pet and nothing is cutoff.
          - Quality: High quality designs that print well on merchandise. `;

            // Fetch pet image as file
            const petFile = await fetchImageAsFile(petImageUrl, "pet.png");
            console.log(
              `📁 Pet image: ${petFile.size} bytes, type: ${petFile.type}`
            );

            let b64Image: string | undefined;
            let mimeType = "image/png";

            if (model === "gemini-img2img") {
              // Use Gemini API for image-to-image generation
              console.log(
                "🤖 Using Gemini API for image-to-image generation..."
              );

              if (!templateImage) {
                console.error(
                  "❌ No template image provided for img2img generation"
                );
                return null;
              }

              // Fetch template image as file
              const templateFile = await fetchImageAsFile(
                templateImage.public_url,
                "template.png"
              );
              console.log(
                `📁 Template image: ${templateFile.size} bytes, type: ${templateFile.type}`
              );

              const geminiResult = await generateWithGeminiImg2Img(
                petFile,
                templateFile,
                prompt,
                background,
                size,
                geminiApiKey!
              );
              b64Image = geminiResult.imageBase64;
              mimeType = geminiResult.mimeType;
            } else if (model === "gemini") {
              // Use Gemini API
              console.log("🤖 Using Gemini API for image generation...");
              const geminiResult = await generateWithGemini(
                petFile,
                prompt,
                background,
                size,
                geminiApiKey!
              );
              b64Image = geminiResult.imageBase64;
              mimeType = geminiResult.mimeType;
            } else {
              // Use OpenAI API (default)
              console.log("🤖 Using OpenAI API for image generation...");

              const form = new FormData();
              form.append("image", petFile);
              form.append("model", "gpt-image-1");
              form.append(
                "prompt",
                prompt +
                  (background === "opaque"
                    ? additionalPromptOpaque
                    : additionalPromptTransparent)
              );
              form.append("size", size);
              form.append("background", background);

              const openaiResponse = await fetch(
                "https://api.openai.com/v1/images/edits",
                {
                  method: "POST",
                  headers: {
                    Authorization: `Bearer ${openaiApiKey}`,
                  },
                  body: form,
                }
              );

              if (!openaiResponse.ok) {
                const errorText = await openaiResponse.text();
                console.error(`❌ OpenAI API error for prompt "${prompt}":`, {
                  status: openaiResponse.status,
                  statusText: openaiResponse.statusText,
                  error: errorText,
                });
                return null;
              }

              const openaiData = await openaiResponse.json();

              if (openaiData.usage) {
                console.log(
                  "[EdgeFunction] OpenAI API Usage:",
                  openaiData.usage
                );
              }

              // Get the generated image - check for both b64_json and url formats
              if (openaiData.data?.[0]?.url) {
                console.log("✅ Got image URL from OpenAI");
                // For URL responses, we'd need to fetch and convert to base64
                // For now, we'll handle base64 responses
                console.error(
                  "❌ URL responses not yet supported, need base64"
                );
                return null;
              } else if (openaiData.data?.[0]?.b64_json) {
                b64Image = openaiData.data[0].b64_json;
                console.log("✅ Got base64 image from OpenAI");
              } else {
                console.error("❌ No image returned from OpenAI API");
                return null;
              }
            }

            // Process and upload the generated image
            const result = await processGeneratedImage({
              b64Image,
              photoId,
              prompt:
                model === "gemini-img2img" && templateImage
                  ? `(Template: #${templateImage.id}) ${prompt}`
                  : prompt,
              initialPrompt: prompts[0],
              // Convert size from API format (1024x1024) to database format (1024×1024)
              size: size === "auto" ? "auto" : size.replace("x", "×"),
              background,
              model,
              supabaseUrl,
              supabaseServiceKey,
              originalPhotoUrl: petImageUrl,
            });

            console.log(
              `🔧 Size conversion: API received "${size}" -> Database will store "${
                size === "auto" ? "auto" : size.replace("x", "×")
              }"`
            );

            return result;
          } catch (error) {
            console.error(
              `💥 Error processing photo ${photoId} with prompt "${prompt}":`,
              {
                error: error.message,
                stack: error.stack,
                photoId,
                prompt,
              }
            );
            return null;
          }
        }
      );

      // Wait for current batch to complete before moving to next batch
      const batchResults = await Promise.all(batchPromises);
      resultsArray.push(...batchResults.filter((result) => result !== null));

      // Add a small delay between batches to be respectful to OpenAI API
      if (i + BATCH_SIZE < combinations.length) {
        console.log(`⏳ Batch complete. Waiting 1 second before next batch...`);
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    }

    // Filter out null results and add to results array
    results.push(...resultsArray.filter((result) => result !== null));

    return new Response(
      JSON.stringify({
        success: true,
        results,
        processed: results.length,
        message: `Successfully processed ${results.length} images`,
      }),
      {
        headers: {
          "Content-Type": "application/json",
          ...corsHeaders,
        },
      }
    );
  } catch (error) {
    console.error("💥 Function error:", {
      message: error.message,
      stack: error.stack,
      name: error.name,
    });
    return new Response(
      JSON.stringify({
        error: error.message,
        details: "Check function logs for more information",
      }),
      {
        status: 500,
        headers: {
          "Content-Type": "application/json",
          ...corsHeaders,
        },
      }
    );
  }
});

// Helper function to process generated image and save to database
async function processGeneratedImage({
  b64Image,
  photoId,
  prompt,
  initialPrompt,
  size,
  background,
  model,
  supabaseUrl,
  supabaseServiceKey,
  originalPhotoUrl,
}: {
  b64Image?: string;
  photoId: string;
  prompt: string;
  initialPrompt: string;
  size: string;
  background: string;
  model: string;
  supabaseUrl: string;
  supabaseServiceKey: string;
  originalPhotoUrl: string;
}): Promise<{
  id: string;
  photo_id: string;
  initial_prompt: string;
  generated_prompt: string;
  image_url: string;
  public_url: string;
  original_photo_url: string;
  created_at: string;
  status: string;
} | null> {
  try {
    console.log("📥 Processing generated image...");

    let imageBuffer: Uint8Array;

    if (b64Image) {
      // Convert from base64
      imageBuffer = Uint8Array.from(atob(b64Image), (c) => c.charCodeAt(0));
    } else {
      console.error("❌ No image data provided");
      return null; // Return null to indicate failure
    }

    // Generate unique filename
    const fileName = `generated_${photoId}_${Date.now()}_${Math.random()
      .toString(36)
      .substr(2, 9)}.png`;

    console.log("☁️ Uploading to Supabase storage...");

    // Upload to Supabase Storage bucket 'generated-images'
    const uploadResponse = await fetch(
      `${supabaseUrl}/storage/v1/object/generated-images/${fileName}`,
      {
        method: "POST",
        headers: {
          apikey: supabaseServiceKey,
          Authorization: `Bearer ${supabaseServiceKey}`,
          "Content-Type": "image/png",
          "Cache-Control": "3600",
        },
        body: imageBuffer,
      }
    );

    if (!uploadResponse.ok) {
      const errorText = await uploadResponse.text();
      console.error(`❌ Failed to upload image to Supabase storage:`, {
        status: uploadResponse.status,
        statusText: uploadResponse.statusText,
        error: errorText,
        fileName: fileName,
      });
      return null; // Return null to indicate failure
    }

    console.log(
      `✅ Successfully uploaded ${fileName} to generated-images bucket`
    );

    // The image_url should just be the fileName since it references the generated-images bucket
    const imageUrl = fileName;

    console.log("💾 Saving to database...");
    console.log(
      `📊 Database insertion payload - size: "${size}", background: "${background}"`
    );

    // Store result in database - matching exact schema
    const insertResponse = await fetch(
      `${supabaseUrl}/rest/v1/generated_images`,
      {
        method: "POST",
        headers: {
          apikey: supabaseServiceKey,
          Authorization: `Bearer ${supabaseServiceKey}`,
          "Content-Type": "application/json",
          Prefer: "return=representation",
        },
        body: JSON.stringify({
          photo_id: photoId,
          initial_prompt: initialPrompt,
          generated_prompt: prompt,
          image_url: imageUrl, // Just the filename, not full URL
          size: size,
          background: background,
          model: model,
        }),
      }
    );

    if (insertResponse.ok) {
      const insertData = await insertResponse.json();

      // Build full public URL for response
      const publicUrl = `${supabaseUrl}/storage/v1/object/public/generated-images/${imageUrl}`;

      return {
        id: insertData[0].id,
        photo_id: photoId,
        initial_prompt: initialPrompt,
        generated_prompt: prompt,
        image_url: imageUrl, // Storage path as stored in DB
        public_url: publicUrl, // Full URL for client usage
        original_photo_url: originalPhotoUrl,
        created_at: insertData[0].created_at,
        status: "success",
      };
    } else {
      const errorText = await insertResponse.text();
      console.error(`❌ Failed to store generated image in database:`, {
        status: insertResponse.status,
        statusText: insertResponse.statusText,
        error: errorText,
        payload: {
          photo_id: photoId,
          initial_prompt: initialPrompt,
          generated_prompt: prompt,
          image_url: imageUrl,
        },
      });
      return null; // Return null to indicate failure
    }
  } catch (error) {
    console.error("💥 Error processing generated image:", error);
    return null; // Return null to indicate failure
  }
}
