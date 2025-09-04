import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";
import { GoogleGenerativeAI } from "@google/generative-ai";
import OpenAI from "openai";
import fetch from "node-fetch";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

// Load environment variables
dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors());
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ extended: true, limit: "50mb" }));

// Initialize Supabase client
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Initialize AI clients
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// Constants
const IMAGE_SIZE = 1024;
const BATCH_SIZE = 3;

// Helper function to fetch image as buffer
async function fetchImageAsBuffer(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch image: ${response.statusText}`);
  }
  return await response.buffer();
}

// Helper function to convert buffer to base64
function bufferToBase64(buffer) {
  return buffer.toString("base64");
}

// Generate image using Gemini API
async function generateWithGemini(
  petBuffer,
  prompt,
  background,
  size,
  geminiApiKey
) {
  const model = genAI.getGenerativeModel({
    model: "gemini-2.5-flash-image-preview",
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
  const imageBase64 = bufferToBase64(petBuffer);

  const imageData = {
    inlineData: {
      data: imageBase64,
      mimeType: "image/png",
    },
  };

  const result = await model.generateContent([editingPrompt, imageData]);
  const response = result.response;

  if (response.candidates && response.candidates[0]) {
    const candidate = response.candidates[0];

    if (candidate.content && candidate.content.parts) {
      for (const part of candidate.content.parts) {
        if (part.inlineData && part.inlineData.data) {
          console.log("Image generated successfully");
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
  petBuffer,
  templateBuffer,
  prompt,
  background,
  size,
  geminiApiKey,
  templatePrompt
) {
  const model = genAI.getGenerativeModel({
    model: "gemini-2.5-flash-image-preview",
    generationConfig: {
      temperature: 0.4,
      topP: 0.9,
      topK: 50,
      candidateCount: 1,
    },
  });

  // Build img2img prompt for Gemini with explicit image identification
  let img2imgPrompt = `You are a master artist creating an original portrait. Study the pet photo carefully and paint this specific animal from scratch in the artistic style shown. Do NOT copy or paste any elements.
CRITICAL: Paint the pet completely in the same artistic technique as the template - matching brushstrokes, texture, and painterly quality throughout the entire animal.

Pet to Paint:
Study these specific characteristics and recreate them artistically:
Exact fur colors and markings (capture every spot, stripe, or pattern)
Eye and nose color and shape
Close attention to ear details, the color, the shape, the position and the size.
Facial expression and personality
Body proportions and size

Artistic Technique Requirements:
Paint the pet with the same style and technique as the template
Use brushstrokes and texture that match the template's artistic quality
Apply colors and blending that harmonize with the template
Create depth and dimension using the template's artistic approach
Match the painterly treatment shown in the template

Composition:
Center the pet portrait appropriately within the frame
Size the pet to fill the space naturally and proportionally
Maintain the background and framing elements from the template
Keep existing decorative elements unchanged

The result must look like you painted this specific pet directly in the template's artistic style. Every part of the pet should have the same artistic treatment as the other painted elements.

Style Application:
Apply ${
    templatePrompt || "the template's artistic style"
  } while preserving the pet's individual identity. `;

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

  // Convert both images to base64
  const petImageBase64 = bufferToBase64(petBuffer);
  const templateImageBase64 = bufferToBase64(templateBuffer);

  const petImageData = {
    inlineData: {
      data: petImageBase64,
      mimeType: "image/png",
    },
  };

  const templateImageData = {
    inlineData: {
      data: templateImageBase64,
      mimeType: "image/png",
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
          console.log("Image generated successfully");
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

// Helper function to process generated image and save to database
async function processGeneratedImage({
  b64Image,
  photoId,
  prompt,
  initialPrompt,
  size,
  background,
  model,
  originalPhotoUrl,
}) {
  try {
    if (!b64Image) {
      console.error("❌ Error: No image data provided");
      return null;
    }

    // Convert from base64 to buffer
    const imageBuffer = Buffer.from(b64Image, "base64");

    // Generate unique filename
    const fileName = `generated_${photoId}_${Date.now()}_${Math.random()
      .toString(36)
      .substr(2, 9)}.png`;

    // Upload to Supabase Storage bucket 'generated-images'
    const { data: uploadData, error: uploadError } = await supabase.storage
      .from("generated-images")
      .upload(fileName, imageBuffer, {
        contentType: "image/png",
        cacheControl: "3600",
      });

    if (uploadError) {
      console.error(
        "❌ Error: Failed to upload image to storage:",
        uploadError.message
      );
      return null;
    }

    console.log("Image stored successfully");

    // Store result in database
    const { data: insertData, error: insertError } = await supabase
      .from("generated_images")
      .insert({
        photo_id: photoId,
        initial_prompt: initialPrompt,
        generated_prompt: prompt,
        image_url: fileName,
        size: size,
        background: background,
        model: model,
      })
      .select()
      .single();

    if (insertError) {
      console.error(
        "❌ Error: Failed to store image in database:",
        insertError.message
      );
      return null;
    }

    // Build full public URL for response
    const publicUrl = `${process.env.SUPABASE_URL}/storage/v1/object/public/generated-images/${fileName}`;

    return {
      id: insertData.id,
      photo_id: photoId,
      initial_prompt: initialPrompt,
      generated_prompt: prompt,
      image_url: fileName,
      public_url: publicUrl,
      original_photo_url: originalPhotoUrl,
      created_at: insertData.created_at,
      status: "success",
    };
  } catch (error) {
    console.error("❌ Error processing generated image:", error.message);
    return null;
  }
}

// Generate images endpoint
app.post("/api/generate-images", async (req, res) => {
  try {
    const {
      photoIds,
      prompts,
      size = "auto",
      background = "opaque",
      sizes = [],
      backgrounds = [],
      model = "openai",
      templateNumbers = [],
    } = req.body;

    console.log(
      `Input: ${photoIds?.length || 0} photos, ${
        prompts?.length || 0
      } prompts, model: ${model}, size: ${size}, background: ${background}${
        templateNumbers?.length > 0
          ? `, templates: ${templateNumbers.join(", ")}`
          : ""
      }`
    );

    if (
      !photoIds ||
      !prompts ||
      photoIds.length === 0 ||
      prompts.length === 0
    ) {
      console.error("❌ Error: Missing required parameters");
      return res.status(400).json({
        error: "Missing required parameters: photoIds and prompts are required",
      });
    }

    // Check for API keys based on selected model
    if (model === "openai" && !process.env.OPENAI_API_KEY) {
      console.error("❌ Error: Missing OpenAI API key");
      return res.status(500).json({ error: "Missing OpenAI API key" });
    }

    if (
      (model === "gemini" || model === "gemini-img2img") &&
      !process.env.GEMINI_API_KEY
    ) {
      console.error("❌ Error: Missing Gemini API key");
      return res.status(500).json({ error: "Missing Gemini API key" });
    }

    // Validate template numbers for img2img model
    if (model === "gemini-img2img") {
      if (!templateNumbers || templateNumbers.length === 0) {
        console.error("❌ Error: Missing template numbers for img2img model");
        return res.status(400).json({
          error: "Template numbers are required for Gemini Image-to-Image mode",
        });
      }
    }

    // Fetch template images for img2img model
    let templateImages = [];
    if (model === "gemini-img2img") {
      const { data: templateData, error: templateError } = await supabase
        .from("generated_images")
        .select("number, image_url, generated_prompt")
        .in("number", templateNumbers);

      if (templateError) {
        console.error(
          "❌ Error: Failed to fetch template images:",
          templateError.message
        );
        return res
          .status(500)
          .json({ error: "Failed to fetch template images" });
      }

      templateImages = templateData.map((img) => ({
        id: img.number,
        image_url: img.image_url,
        generated_prompt: img.generated_prompt,
        public_url: `${process.env.SUPABASE_URL}/storage/v1/object/public/generated-images/${img.image_url}`,
      }));
    }

    const results = [];

    // Create all photo-prompt combinations for parallel processing
    const combinations = [];

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
        for (let i = 0; i < prompts.length; i++) {
          const prompt = prompts[i];
          // Use individual size/background if arrays are provided and match length
          const promptSize = sizes.length === prompts.length ? sizes[i] : size;
          const promptBackground =
            backgrounds.length === prompts.length ? backgrounds[i] : background;

          combinations.push({
            photoId,
            prompt,
            size: promptSize,
            background: promptBackground,
            model,
          });
        }
      }
    }

    // Process combinations in batches to avoid overwhelming CPU and hitting rate limits
    const resultsArray = [];

    for (let i = 0; i < combinations.length; i += BATCH_SIZE) {
      const batch = combinations.slice(i, i + BATCH_SIZE);

      const batchPromises = batch.map(
        async ({ photoId, prompt, size, background, model, templateImage }) => {
          try {
            // Get photo details from database
            const { data: photoData, error: photoError } = await supabase
              .from("uploaded_photos")
              .select("*")
              .eq("id", photoId)
              .single();

            if (photoError || !photoData) {
              console.error(`❌ Error: No photo data found for ID: ${photoId}`);
              return null;
            }

            // Get pet image URL with transformation to ensure proper format and size
            const petImageUrl = `${process.env.SUPABASE_URL}/storage/v1/object/public/uploaded-photos/${photoData.file_path}?width=400&height=400&quality=80&format=webp`;

            // Fetch pet image as buffer
            const petBuffer = await fetchImageAsBuffer(petImageUrl);

            let b64Image;
            let mimeType = "image/png";

            if (model === "gemini-img2img") {
              // Use Gemini API for image-to-image generation

              if (!templateImage) {
                console.error(
                  "❌ Error: No template image provided for img2img generation"
                );
                return null;
              }

              // Fetch template image as buffer
              const templateBuffer = await fetchImageAsBuffer(
                templateImage.public_url
              );

              const geminiResult = await generateWithGeminiImg2Img(
                petBuffer,
                templateBuffer,
                prompt,
                background,
                size,
                process.env.GEMINI_API_KEY,
                templateImage.generated_prompt
              );
              b64Image = geminiResult.imageBase64;
              mimeType = geminiResult.mimeType;
            } else if (model === "gemini") {
              // Use Gemini API

              const geminiResult = await generateWithGemini(
                petBuffer,
                prompt,
                background,
                size,
                process.env.GEMINI_API_KEY
              );
              b64Image = geminiResult.imageBase64;
              mimeType = geminiResult.mimeType;
            } else {
              // Use OpenAI API (default)

              // Convert buffer to File-like object for OpenAI
              const petFile = new File([petBuffer], "pet.png", {
                type: "image/png",
              });

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
              form.append("size", size.replace("×", "x"));
              form.append("background", background);

              const openaiResponse = await fetch(
                "https://api.openai.com/v1/images/edits",
                {
                  method: "POST",
                  headers: {
                    Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
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

              if (openaiData.data?.[0]?.b64_json) {
                b64Image = openaiData.data[0].b64_json;
              } else {
                console.error("❌ Error: No image returned from OpenAI API");
                return null;
              }
            }

            // Process and upload the generated image
            const result = await processGeneratedImage({
              b64Image,
              photoId,
              prompt:
                model === "gemini-img2img" && templateImage
                  ? `(V4 Template: #${templateImage.id}) ${prompt}`
                  : prompt,
              initialPrompt: prompts[0],
              size: size === "auto" ? "auto" : size.replace("x", "×"),
              background,
              model,
              originalPhotoUrl: petImageUrl,
            });

            return result;
          } catch (error) {
            console.error(
              `❌ Error processing photo ${photoId}:`,
              error.message
            );
            return null;
          }
        }
      );

      // Wait for current batch to complete before moving to next batch
      const batchResults = await Promise.all(batchPromises);
      resultsArray.push(...batchResults.filter((result) => result !== null));

      // Add a small delay between batches to be respectful to APIs
      if (i + BATCH_SIZE < combinations.length) {
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    }

    // Filter out null results and add to results array
    results.push(...resultsArray.filter((result) => result !== null));

    console.log(
      `✅ Completed: ${results.length} images processed successfully`
    );
    res.json({
      success: true,
      results,
      processed: results.length,
      message: `Successfully processed ${results.length} images`,
    });
  } catch (error) {
    console.error("❌ Error:", error.message);
    res.status(500).json({
      error: error.message,
      details: "Check server logs for more information",
    });
  }
});

// Health check endpoint
app.get("/api/health", (req, res) => {
  res.json({ status: "OK", timestamp: new Date().toISOString() });
});

// Start server
app.listen(PORT, () => {
  console.log(`🚀 Local API server running on port ${PORT}`);
  console.log(`📡 Health check: http://localhost:${PORT}/api/health`);
  console.log(
    `🎨 Image generation: http://localhost:${PORT}/api/generate-images`
  );
});
