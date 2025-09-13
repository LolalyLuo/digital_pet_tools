import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";
import { GoogleGenerativeAI } from "@google/generative-ai";
import OpenAI from "openai";
import fetch from "node-fetch";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import multer from "multer";

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

// Multer configuration for file uploads
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 50 * 1024 * 1024, // 50MB limit
  },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Only image files are allowed'), false);
    }
  }
});

// Initialize Supabase client
console.log('🔧 Initializing Supabase client...');
console.log('📍 Supabase URL:', process.env.SUPABASE_URL);
console.log('🔑 Service Role Key (first 20 chars):', process.env.SUPABASE_SERVICE_ROLE_KEY?.substring(0, 20) + '...');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Production database client for training sample generation
const prodSupabase = createClient(
  process.env.PROD_SUPABASE_URL,
  process.env.PROD_SUPABASE_SERVICE_ROLE_KEY
);

console.log('✅ Supabase client initialized');
console.log('✅ Production Supabase client initialized');

// Initialize database tables
async function initializeDatabase() {
  console.log('🔧 Checking database table...');
  // Test if the table exists by trying to select from it
  const { data, error } = await supabase
    .from('current_working_samples')
    .select('id')
    .limit(1);

  if (error) {
    console.log('⚠️  Table current_working_samples does not exist. Please create it manually in Supabase with this SQL:');
    console.log(`
      CREATE TABLE current_working_samples (
        id SERIAL PRIMARY KEY,
        generated_image_url TEXT NOT NULL,
        reference_image_url TEXT NOT NULL,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );
    `);
  } else {
    console.log('✅ Current working samples table exists and is accessible');
  }

  // Check training samples table
  const { data: trainingData, error: trainingError } = await supabase
    .from('training_samples')
    .select('id')
    .limit(1);

  if (trainingError) {
    console.log('⚠️  Table training_samples does not exist. Please create it manually in Supabase with this SQL:');
    console.log(`
      CREATE TABLE training_samples (
        id SERIAL PRIMARY KEY,
        customer_id TEXT NOT NULL,
        product_type TEXT NOT NULL,
        uploaded_image_url TEXT NOT NULL,
        generated_image_url TEXT NOT NULL,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );
    `);
  } else {
    console.log('✅ Training samples table exists and is accessible');
  }
}

initializeDatabase();

// Initialize AI clients
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// Constants
const IMAGE_SIZE = 1024;
const BATCH_SIZE = 3;

// Default model configurations
const DEFAULT_MODEL_CONFIGS = {
  gemini: {
    temperature: 1.0,
    topP: 0.99,
    topK: 50,
    candidateCount: 1,
  },
  "gemini-img2img": {
    temperature: 0.9,
    topP: 0.9,
    topK: 50,
    candidateCount: 1,
  },
  openai: {
    // OpenAI doesn't use these parameters, but we can store other config here
    model: "gpt-image-1",
  },
};

// Template selection modes
const TEMPLATE_MODE = {
  BASE: "BASE",
  EXAMPLE_ONE: "EXAMPLE_ONE",
  ALL_EXAMPLES: "ALL_EXAMPLES",
};

// Current template mode - change this to switch between modes
const CURRENT_TEMPLATE_MODE = TEMPLATE_MODE.BASE;

// Helper function to fetch image as buffer
async function fetchImageAsBuffer(url) {
  console.log(`🖼️  Fetching image from: ${url}`);
  try {
    const response = await fetch(url);
    if (!response.ok) {
      console.error(`❌ Failed to fetch image: ${response.status} ${response.statusText}`);
      throw new Error(`Failed to fetch image: ${response.statusText}`);
    }
    console.log(`✅ Image fetched successfully, size: ${response.headers.get('content-length')} bytes`);
    return await response.buffer();
  } catch (error) {
    console.error(`❌ Error fetching image from ${url}:`, error.message);
    throw error;
  }
}

// Helper function to convert buffer to base64
function bufferToBase64(buffer) {
  return buffer.toString("base64");
}

// Helper function to fetch template images with similar examples
async function fetchTemplateImagesWithSimilar(templateNumbers) {
  // First get the base template to extract similar_examples
  const { data: baseTemplateData, error: baseTemplateError } = await supabase
    .from("generated_images")
    .select("number, image_url, generated_prompt, similar_examples")
    .in("number", templateNumbers);

  if (baseTemplateError) {
    console.error(
      "❌ Error: Failed to fetch base template images:",
      baseTemplateError.message
    );
    throw new Error("Failed to fetch base template images");
  }

  const templateGroups = [];

  // Process each base template to get its similar examples
  for (const baseTemplate of baseTemplateData) {
    if (baseTemplate.similar_examples) {
      // Parse the similar_examples string (e.g., "467,561,566,485")
      const similarNumbers = baseTemplate.similar_examples
        .split(",")
        .map((num) => parseInt(num.trim()))
        .filter((num) => !isNaN(num));

      // Fetch the similar example images
      const { data: similarData, error: similarError } = await supabase
        .from("generated_images")
        .select("number, image_url, generated_prompt")
        .in("number", similarNumbers);

      if (similarError) {
        console.error(
          "❌ Error: Failed to fetch similar example images:",
          similarError.message
        );
        throw new Error("Failed to fetch similar example images");
      }

      // Add the similar examples to templateGroups with buffer data
      const similarImagesWithBuffers = await Promise.all(
        similarData.map(async (img) => {
          const publicUrl = `${process.env.SUPABASE_URL}/storage/v1/object/public/generated-images/${img.image_url}`;
          const buffer = await fetchImageAsBuffer(publicUrl);
          return {
            id: img.number,
            image_url: img.image_url,
            generated_prompt: img.generated_prompt,
            public_url: publicUrl,
            buffer: buffer,
          };
        })
      );

      templateGroups.push({
        baseTemplate: {
          id: baseTemplate.number,
          image_url: baseTemplate.image_url,
          generated_prompt: baseTemplate.generated_prompt,
          public_url: `${process.env.SUPABASE_URL}/storage/v1/object/public/generated-images/${baseTemplate.image_url}`,
        },
        similarExamples: similarImagesWithBuffers,
      });
    } else {
      // Fallback to original behavior if no similar_examples
      templateGroups.push({
        baseTemplate: {
          id: baseTemplate.number,
          image_url: baseTemplate.image_url,
          generated_prompt: baseTemplate.generated_prompt,
          public_url: `${process.env.SUPABASE_URL}/storage/v1/object/public/generated-images/${baseTemplate.image_url}`,
        },
        similarExamples: [],
      });
    }
  }

  return templateGroups;
}

// Generate image using Gemini API
async function generateWithGemini(
  petBuffer,
  prompt,
  background,
  size,
  geminiApiKey,
  modelConfig = DEFAULT_MODEL_CONFIGS.gemini
) {
  const model = genAI.getGenerativeModel({
    model: "gemini-2.5-flash-image-preview",
    generationConfig: {
      temperature: modelConfig.temperature,
      topP: modelConfig.topP,
      topK: modelConfig.topK,
      candidateCount: modelConfig.candidateCount,
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
  templateImages,
  prompt,
  background,
  size,
  geminiApiKey,
  templatePrompt,
  modelConfig = DEFAULT_MODEL_CONFIGS["gemini-img2img"]
) {
  const model = genAI.getGenerativeModel({
    model: "gemini-2.5-flash-image-preview",
    generationConfig: {
      temperature: modelConfig.temperature,
      topP: modelConfig.topP,
      topK: modelConfig.topK,
      candidateCount: modelConfig.candidateCount,
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

CRITICAL: Paint the pet in the same artistic technique as the template - matching brushstrokes, texture, and painterly quality throughout the entire animal. The pet should completely blend in and has the same style.

Here is the style we want to transform the pet into: ${templatePrompt}`;

  // Convert pet image to base64
  const petImageBase64 = bufferToBase64(petBuffer);

  const petImageData = {
    inlineData: {
      data: petImageBase64,
      mimeType: "image/png",
    },
  };

  // Handle different template modes
  let templateImageDataArray = [];

  if (CURRENT_TEMPLATE_MODE === TEMPLATE_MODE.ALL_EXAMPLES) {
    // Use all template images
    if (templateImages.length === 0) {
      throw new Error("No template images provided");
    }

    templateImageDataArray = templateImages.map((templateImage) => ({
      inlineData: {
        data: bufferToBase64(templateImage.buffer),
        mimeType: "image/png",
      },
    }));
  } else {
    // Use only the first template image (BASE or EXAMPLE_ONE)
    const firstTemplate = templateImages[0];
    if (!firstTemplate) {
      throw new Error("No template images provided");
    }

    templateImageDataArray = [
      {
        inlineData: {
          data: bufferToBase64(firstTemplate.buffer),
          mimeType: "image/png",
        },
      },
    ];
  }

  // Build content array with prompt, pet image, and template image(s)
  const contentArray = [img2imgPrompt, petImageData, ...templateImageDataArray];

  const result = await model.generateContent(contentArray);
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
            img2imgPrompt: img2imgPrompt,
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
  templatePrompt,
  modelConfig,
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
    console.log(`📤 Uploading image to storage: ${fileName} (${imageBuffer.length} bytes)`);
    
    const { data: uploadData, error: uploadError } = await supabase.storage
      .from("generated-images")
      .upload(fileName, imageBuffer, {
        contentType: "image/png",
        cacheControl: "3600",
      });

    if (uploadError) {
      console.error("❌ Error: Failed to upload image to storage:");
      console.error('📋 Upload error details:', {
        message: uploadError.message,
        statusCode: uploadError.statusCode,
        error: uploadError.error,
        fileName: fileName,
        bufferSize: imageBuffer.length
      });
      return null;
    }
    
    console.log('✅ Image uploaded successfully to storage:', uploadData?.path);

    console.log("Image stored successfully");

    // Store result in database
    console.log('💾 Storing image metadata in database...');
    
    const insertPayload = {
      photo_id: photoId,
      initial_prompt: initialPrompt,
      generated_prompt: templatePrompt || prompt,
      image_url: fileName,
      size: size,
      background: background,
      model: model,
      model_config: modelConfig,
    };
    
    console.log('📋 Insert payload:', insertPayload);
    
    const { data: insertData, error: insertError } = await supabase
      .from("generated_images")
      .insert(insertPayload)
      .select()
      .single();

    if (insertError) {
      console.error("❌ Error: Failed to store image in database:");
      console.error('📋 Database error details:', {
        message: insertError.message,
        code: insertError.code,
        details: insertError.details,
        hint: insertError.hint,
        payload: insertPayload
      });
      return null;
    }
    
    console.log('✅ Image metadata stored in database:', insertData?.id);

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
      modelConfig = null,
    } = req.body;

    // Merge provided modelConfig with defaults
    const finalModelConfig = modelConfig
      ? { ...DEFAULT_MODEL_CONFIGS[model], ...modelConfig }
      : DEFAULT_MODEL_CONFIGS[model];

    console.log(
      `Input: ${photoIds?.length || 0} photos, ${
        prompts?.length || 0
      } prompts, model: ${model}, size: ${size}, background: ${background}${
        templateNumbers?.length > 0
          ? `, templates: ${templateNumbers.join(", ")}`
          : ""
      }${modelConfig ? `, modelConfig: ${JSON.stringify(modelConfig)}` : ""}`
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
      try {
        const templateGroups = await fetchTemplateImagesWithSimilar(
          templateNumbers
        );
        templateImages = templateGroups;
      } catch (error) {
        console.error("❌ Error fetching template images:", error.message);
        return res.status(500).json({ error: error.message });
      }
    }

    const results = [];

    // Create all photo-prompt combinations for parallel processing
    const combinations = [];

    if (model === "gemini-img2img") {
      // For img2img: combine each pet photo with each template group
      for (const photoId of photoIds) {
        for (const templateGroup of templateImages) {
          combinations.push({
            photoId,
            prompt: prompts[0], // Use first prompt for img2img
            size,
            background,
            model,
            templateGroup,
            modelConfig: finalModelConfig,
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
            modelConfig: finalModelConfig,
          });
        }
      }
    }

    // Process combinations in batches to avoid overwhelming CPU and hitting rate limits
    const resultsArray = [];

    for (let i = 0; i < combinations.length; i += BATCH_SIZE) {
      const batch = combinations.slice(i, i + BATCH_SIZE);

      const batchPromises = batch.map(
        async ({
          photoId,
          prompt,
          size,
          background,
          model,
          templateGroup,
          modelConfig,
        }) => {
          try {
            // Get photo details from database
            console.log(`🔍 Looking up photo data for ID: ${photoId}`);
            
            const { data: photoData, error: photoError } = await supabase
              .from("uploaded_photos")
              .select("*")
              .eq("id", photoId)
              .single();

            if (photoError || !photoData) {
              console.error(`❌ Error: No photo data found for ID: ${photoId}`);
              console.error('📋 Photo lookup error:', {
                error: photoError,
                photoId: photoId
              });
              return null;
            }
            
            console.log(`✅ Found photo data:`, {
              id: photoData.id,
              fileName: photoData.file_name,
              filePath: photoData.file_path
            });

            // Get pet image URL with transformation to ensure proper format and size
            const petImageUrl = `${process.env.SUPABASE_URL}/storage/v1/object/public/uploaded-photos/${photoData.file_path}?width=400&height=400&quality=80&format=webp`;
            console.log(`🖼️  Pet image URL: ${petImageUrl}`);

            // Fetch pet image as buffer
            const petBuffer = await fetchImageAsBuffer(petImageUrl);
            console.log(`✅ Pet image buffer size: ${petBuffer.length} bytes`);

            let b64Image;
            let mimeType = "image/png";
            let img2imgPrompt = undefined;

            if (model === "gemini-img2img") {
              // Use Gemini API for image-to-image generation

              if (!templateGroup) {
                console.error(
                  "❌ Error: No template group provided for img2img generation"
                );
                return null;
              }

              let templateImages = [];
              // Always use base template prompt for AI generation since similar examples have corrupted prompts
              const templatePrompt =
                templateGroup.baseTemplate.generated_prompt;

              if (CURRENT_TEMPLATE_MODE === TEMPLATE_MODE.BASE) {
                // Use the base template image directly
                const baseTemplateBuffer = await fetchImageAsBuffer(
                  templateGroup.baseTemplate.public_url
                );
                console.log(
                  "Using BASE template:",
                  templateGroup.baseTemplate.public_url
                );
                templateImages = [{ buffer: baseTemplateBuffer }];
              } else if (CURRENT_TEMPLATE_MODE === TEMPLATE_MODE.EXAMPLE_ONE) {
                // Use the first similar example
                if (templateGroup.similarExamples.length === 0) {
                  console.error(
                    "❌ Error: No similar examples found for EXAMPLE_ONE mode"
                  );
                  return null;
                }
                console.log(
                  "Using EXAMPLE_ONE:",
                  templateGroup.similarExamples[0].public_url
                );
                templateImages = [templateGroup.similarExamples[0]];
              } else if (CURRENT_TEMPLATE_MODE === TEMPLATE_MODE.ALL_EXAMPLES) {
                // Use all similar examples
                if (templateGroup.similarExamples.length === 0) {
                  console.error(
                    "❌ Error: No similar examples found for ALL_EXAMPLES mode"
                  );
                  return null;
                }
                console.log(
                  `Using ALL_EXAMPLES: ${templateGroup.similarExamples.length} templates`
                );
                templateImages = templateGroup.similarExamples;
              }

              const geminiResult = await generateWithGeminiImg2Img(
                petBuffer,
                templateImages,
                prompt,
                background,
                size,
                process.env.GEMINI_API_KEY,
                templatePrompt,
                modelConfig
              );
              b64Image = geminiResult.imageBase64;
              mimeType = geminiResult.mimeType;

              // Store the actual img2img prompt that was used for generation
              img2imgPrompt = geminiResult.img2imgPrompt;
            } else if (model === "gemini") {
              // Use Gemini API

              const geminiResult = await generateWithGemini(
                petBuffer,
                prompt,
                background,
                size,
                process.env.GEMINI_API_KEY,
                modelConfig
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
                model === "gemini-img2img" && templateGroup
                  ? `(V7 ${CURRENT_TEMPLATE_MODE} mode: #${templateGroup.baseTemplate.id}) ${prompt}`
                  : prompt,
              initialPrompt: prompts[0],
              size: size === "auto" ? "auto" : size.replace("x", "×"),
              background,
              model,
              originalPhotoUrl: petImageUrl,
              templatePrompt:
                model === "gemini-img2img" && templateGroup
                  ? img2imgPrompt
                  : undefined,
              modelConfig,
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
    console.error("❌ Error in generate-images endpoint:");
    console.error('📋 Error details:', {
      message: error.message,
      stack: error.stack,
      name: error.name
    });
    res.status(500).json({
      error: error.message,
      details: "Check server logs for more information",
      timestamp: new Date().toISOString()
    });
  }
});

// LLM Image Evaluation endpoint
app.post("/api/evaluate-image", async (req, res) => {
  try {
    console.log('🔍 LLM Evaluation Request:', {
      imageUrl: req.body.imageUrl?.substring(0, 100) + '...',
      prompt: req.body.prompt,
      criteria: req.body.criteria,
      model: req.body.model
    });

    const { imageUrl, prompt, criteria = [], model = 'gpt-4', temperature = 0.3, maxTokens = 50 } = req.body;

    if (!imageUrl || !prompt) {
      console.error('❌ Missing required parameters:', { imageUrl: !!imageUrl, prompt: !!prompt });
      return res.status(400).json({ error: 'Missing required parameters: imageUrl and prompt' });
    }

    // For GPT models, use OpenAI
    if (model.startsWith('gpt')) {
      if (!process.env.OPENAI_API_KEY) {
        return res.status(500).json({ error: 'OpenAI API key not configured' });
      }

      const response = await openai.chat.completions.create({
        model: 'gpt-4o',
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'text',
                text: `${prompt}\n\nPlease evaluate this image and return ONLY a JSON object with this exact format:\n{\n  "overall_score": number (1-10),\n  "criteria_scores": {${criteria.map(c => `\n    "${c}": number (1-10)`).join(',')}\n  },\n  "feedback": "brief explanation"\n}`
              },
              {
                type: 'image_url',
                image_url: { url: imageUrl }
              }
            ]
          }
        ],
        max_tokens: maxTokens,
        temperature: temperature
      });

      const content = response.choices[0]?.message?.content;
      if (!content) {
        throw new Error('No response from OpenAI');
      }

      try {
        const evaluation = JSON.parse(content);
        res.json(evaluation);
      } catch (parseError) {
        // Fallback if JSON parsing fails
        res.json({
          overall_score: 7.0,
          criteria_scores: Object.fromEntries(criteria.map(c => [c, 7.0])),
          feedback: content
        });
      }
    } else {
      // For other models, return a mock response for now
      res.json({
        overall_score: Math.random() * 4 + 6,
        criteria_scores: Object.fromEntries(criteria.map(c => [c, Math.random() * 4 + 6])),
        feedback: `Evaluated using ${model} - Mock evaluation for development`
      });
    }
  } catch (error) {
    console.error('LLM evaluation error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Photo Similarity Evaluation endpoint
app.post("/api/evaluate-photo-similarity", async (req, res) => {
  try {
    const { generatedImageUrl, targetImages = [], threshold = 0.7 } = req.body;

    if (!generatedImageUrl) {
      return res.status(400).json({ error: 'Missing required parameter: generatedImageUrl' });
    }

    // This is a placeholder implementation
    // In a real implementation, you would use computer vision APIs like:
    // - Google Vision API
    // - Azure Computer Vision
    // - AWS Rekognition
    // - Or a custom ML model
    
    const mockSimilarity = Math.random() * 0.4 + 0.6; // 0.6 to 1.0
    
    res.json({
      overall_similarity: mockSimilarity,
      similarity_scores: {
        composition: Math.random() * 0.3 + 0.7,
        style: Math.random() * 0.3 + 0.7,
        content: Math.random() * 0.3 + 0.7
      },
      best_match: targetImages[0] || null,
      threshold_met: mockSimilarity >= threshold
    });
  } catch (error) {
    console.error('Photo similarity evaluation error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Testing endpoint for file upload and generation
app.post("/api/test/generate-images", upload.array('images', 10), async (req, res) => {
  try {
    const { prompts: promptsString, selectedModel = 'gemini-img2img' } = req.body;
    const files = req.files;

    if (!files || files.length === 0) {
      return res.status(400).json({ error: 'No images uploaded' });
    }

    if (!promptsString) {
      return res.status(400).json({ error: 'No prompts provided' });
    }

    let prompts;
    try {
      prompts = JSON.parse(promptsString);
    } catch (e) {
      prompts = [promptsString]; // Single prompt as string
    }

    console.log(`🧪 Testing: ${files.length} files, ${prompts.length} prompts, model: ${selectedModel}`);

    // Convert uploaded files to base64 for processing
    const imageBuffers = files.map(file => ({
      buffer: file.buffer,
      mimetype: file.mimetype,
      filename: file.filename || 'uploaded-image'
    }));

    // Use the same generation logic as the main endpoint
    const results = [];
    
    for (let i = 0; i < Math.min(files.length, prompts.length); i++) {
      const imageBuffer = imageBuffers[i];
      const prompt = prompts[i];
      
      try {
        let imageUrl = null;
        
        if (selectedModel === 'gemini-img2img' && process.env.GEMINI_API_KEY) {
          // Use Gemini for generation
          const model = genAI.getGenerativeModel({ 
            model: "gemini-2.5-flash-image-preview",
            generationConfig: DEFAULT_MODEL_CONFIGS["gemini-img2img"]
          });
          
          const base64Data = imageBuffer.buffer.toString('base64');
          const imagePart = {
            inlineData: {
              data: base64Data,
              mimeType: imageBuffer.mimetype
            }
          };
          
          const result = await model.generateContent([prompt, imagePart]);
          const response = await result.response;
          
          // Handle Gemini response properly - look for inline image data
          if (response.candidates && response.candidates[0]) {
            const candidate = response.candidates[0];
            if (candidate.content && candidate.content.parts) {
              for (const part of candidate.content.parts) {
                if (part.inlineData && part.inlineData.data) {
                  console.log("✅ Gemini image generated successfully");
                  imageUrl = `data:${part.inlineData.mimeType};base64,${part.inlineData.data}`;
                  break;
                }
              }
            }
          }
        } else if (selectedModel === 'openai' && process.env.OPENAI_API_KEY) {
          // Use OpenAI DALL-E for generation
          const response = await openai.images.generate({
            model: "dall-e-3",
            prompt: prompt,
            n: 1,
            size: "1024x1024",
            quality: "standard",
          });
          
          imageUrl = response.data[0]?.url;
        }
        
        if (imageUrl) {
          results.push({
            imageUrl: imageUrl,
            prompt: prompt,
            model: selectedModel,
            index: i
          });
        }
      } catch (error) {
        console.error(`❌ Generation error for image ${i}:`, error);
        results.push({
          error: error.message,
          prompt: prompt,
          model: selectedModel,
          index: i
        });
      }
    }
    
    res.json({
      success: true,
      results: results,
      count: results.length,
      model: selectedModel
    });
    
  } catch (error) {
    console.error('❌ Testing generation error:', error);
    res.status(500).json({ error: error.message });
  }
});

// GPT-4 Vision Evaluation endpoint
app.post("/api/evaluate-gpt4-vision", async (req, res) => {
  try {
    const { generatedImageUrl, referenceImageUrl, customPrompt } = req.body;

    if (!generatedImageUrl || !referenceImageUrl) {
      return res.status(400).json({
        error: 'Missing required parameters: generatedImageUrl and referenceImageUrl'
      });
    }

    if (!process.env.OPENAI_API_KEY) {
      return res.status(500).json({ error: 'OpenAI API key not configured' });
    }

    console.log('🔍 Evaluating images with GPT-4 Vision...');
    console.log('📊 Generated image: [IMAGE DATA]');
    console.log('📋 Reference image: [IMAGE DATA]');

    const evaluationPrompt = customPrompt || `Compare these two dog images and provide a detailed evaluation.

Rate the generated image (first image) compared to the reference image (second image) on:
1. Overall cuteness (1-10) - How appealing, adorable, and charming is the generated image?
2. Similarity to reference style (1-10) - How well does it maintain the style, composition, and characteristics of the reference?
3. Image quality (1-10) - Technical quality including sharpness, lighting, composition, and overall visual appeal?

Return your response as a JSON object with this exact format:
{
  "cuteness": <number>,
  "similarity": <number>,
  "quality": <number>,
  "reasoning": "<detailed explanation of your ratings and observations>"
}`;

    const response = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: evaluationPrompt
            },
            {
              type: "image_url",
              image_url: {
                url: generatedImageUrl,
                detail: "high"
              }
            },
            {
              type: "image_url", 
              image_url: {
                url: referenceImageUrl,
                detail: "high"
              }
            }
          ]
        }
      ],
      max_tokens: 500,
      temperature: 0.1
    });

    const evaluationText = response.choices[0].message.content;
    console.log('📝 GPT-4 Vision evaluation completed, parsing response...');

    // Try to parse JSON from the response
    let evaluation;
    try {
      // Extract JSON from the response if it's wrapped in text
      const jsonMatch = evaluationText.match(/\{[\s\S]*\}/);
      const jsonString = jsonMatch ? jsonMatch[0] : evaluationText;
      evaluation = JSON.parse(jsonString);
    } catch (parseError) {
      console.error('❌ Failed to parse GPT-4 Vision response as JSON:', parseError);

      // Fallback: extract scores manually if JSON parsing fails
      const visualAppealMatch = evaluationText.match(/visualAppeal["\s]*:[\s]*(\d+\.?\d*)/i);
      const styleSimilarityMatch = evaluationText.match(/styleSimilarity["\s]*:[\s]*(\d+\.?\d*)/i);
      const technicalQualityMatch = evaluationText.match(/technicalQuality["\s]*:[\s]*(\d+\.?\d*)/i);
      const scoreMatch = evaluationText.match(/score["\s]*:[\s]*(\d+\.?\d*)/i);

      evaluation = {
        visualAppeal: visualAppealMatch ? Math.min(10, parseFloat(visualAppealMatch[1])) : null,
        styleSimilarity: styleSimilarityMatch ? Math.min(10, parseFloat(styleSimilarityMatch[1])) : null,
        technicalQuality: technicalQualityMatch ? Math.min(10, parseFloat(technicalQualityMatch[1])) : null,
        score: scoreMatch ? Math.min(10, parseFloat(scoreMatch[1])) : undefined,
        reasoning: evaluationText
      };

      console.log('🚨 GPT-4 Vision refused or failed to provide proper evaluation:');
      console.log('📄 Full response:', evaluationText);
    }

    // Check if this is a single-score evaluation (new format)
    if (evaluation.score !== undefined) {
      // Single score format
      const originalScore = evaluation.score;
      evaluation.score = Math.max(0, Math.min(10, evaluation.score));

      if (originalScore !== evaluation.score) {
        console.log(`⚠️  Score clamped from ${originalScore} to ${evaluation.score}`);
      }

      const result = {
        success: true,
        evaluation: {
          score: evaluation.score,
          reasoning: evaluation.reasoning || 'No reasoning provided'
        },
        metadata: {
          model: "gpt-4o",
          timestamp: new Date().toISOString()
        }
      };

      console.log('✅ GPT-4 Vision evaluation completed (single score):', {
        score: result.evaluation.score,
        model: result.metadata.model
      });
      res.json(result);
    } else {
      // New structured format with separate criteria scores
      // Check if we have valid scores, reject if any are null/undefined
      if (!evaluation.visualAppeal && evaluation.visualAppeal !== 0 ||
          !evaluation.styleSimilarity && evaluation.styleSimilarity !== 0 ||
          !evaluation.technicalQuality && evaluation.technicalQuality !== 0) {
        return res.status(400).json({
          success: false,
          error: 'GPT-4 Vision refused to evaluate the images or could not provide valid scores',
          reasoning: evaluation.reasoning
        });
      }

      evaluation.visualAppeal = Math.max(0, Math.min(10, evaluation.visualAppeal));
      evaluation.styleSimilarity = Math.max(0, Math.min(10, evaluation.styleSimilarity));
      evaluation.technicalQuality = Math.max(0, Math.min(10, evaluation.technicalQuality));

      const result = {
        success: true,
        evaluation: {
          visualAppeal: evaluation.visualAppeal,
          styleSimilarity: evaluation.styleSimilarity,
          technicalQuality: evaluation.technicalQuality,
          reasoning: evaluation.reasoning
        },
        metadata: {
          model: "gpt-4o",
          timestamp: new Date().toISOString()
        }
      };

      console.log('✅ GPT-4 Vision evaluation completed (structured format):', {
        visualAppeal: result.evaluation.visualAppeal,
        styleSimilarity: result.evaluation.styleSimilarity,
        technicalQuality: result.evaluation.technicalQuality,
        model: result.metadata.model
      });
      res.json(result);
    }

  } catch (error) {
    console.error('❌ GPT-4 Vision evaluation error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Batch Sample Evaluation endpoint
app.post("/api/evaluate-samples", async (req, res) => {
  try {
    const { samples, customPrompt } = req.body;

    if (!samples || samples.length === 0) {
      return res.status(400).json({
        error: 'Missing required parameter: samples array'
      });
    }

    if (!process.env.OPENAI_API_KEY) {
      return res.status(500).json({ error: 'OpenAI API key not configured' });
    }

    console.log(`🔍 Evaluating ${samples.length} samples with GPT-4 Vision...`);

    const defaultPrompt = `Evaluate this AI-generated dog image compared to the reference image.

Analyze these specific criteria and give each a score from 0.0 to 10.0:
1. Visual Appeal & Cuteness - How appealing and cute is the generated image?
2. Style Similarity - How well does it match the reference image's style and composition?
3. Technical Quality - Assess sharpness, lighting, and overall technical execution

Return ONLY a JSON object with this exact format:
{
  "visualAppeal": 7.5,
  "styleSimilarity": 6.0,
  "technicalQuality": 8.2,
  "reasoning": "Brief explanation of your scoring rationale"
}`;

    const evaluationPrompt = customPrompt || defaultPrompt;

    const results = [];

    // Process samples one by one to avoid rate limits
    for (const sample of samples) {
      try {
        const response = await openai.chat.completions.create({
          model: "gpt-4o",
          messages: [
            {
              role: "user",
              content: [
                {
                  type: "text",
                  text: evaluationPrompt
                },
                {
                  type: "image_url",
                  image_url: {
                    url: sample.generatedImageUrl,
                    detail: "high"
                  }
                },
                {
                  type: "image_url",
                  image_url: {
                    url: sample.referenceImageUrl,
                    detail: "high"
                  }
                }
              ]
            }
          ],
          max_tokens: 300,
          temperature: 0.1
        });

        const evaluationText = response.choices[0].message.content;

        // Parse the evaluation result
        let evaluation;
        try {
          const jsonMatch = evaluationText.match(/\{[\s\S]*\}/);
          const jsonString = jsonMatch ? jsonMatch[0] : evaluationText;
          evaluation = JSON.parse(jsonString);
        } catch (parseError) {
          // Fallback: extract scores manually
          const visualAppealMatch = evaluationText.match(/visualAppeal["\s]*:[\s]*(\d+\.?\d*)/i);
          const styleSimilarityMatch = evaluationText.match(/styleSimilarity["\s]*:[\s]*(\d+\.?\d*)/i);
          const technicalQualityMatch = evaluationText.match(/technicalQuality["\s]*:[\s]*(\d+\.?\d*)/i);
          const scoreMatch = evaluationText.match(/score["\s]*:[\s]*(\d+\.?\d*)/i);

          evaluation = {
            visualAppeal: visualAppealMatch ? parseFloat(visualAppealMatch[1]) : null,
            styleSimilarity: styleSimilarityMatch ? parseFloat(styleSimilarityMatch[1]) : null,
            technicalQuality: technicalQualityMatch ? parseFloat(technicalQualityMatch[1]) : null,
            score: scoreMatch ? parseFloat(scoreMatch[1]) : undefined,
            reasoning: evaluationText
          };

          console.log('🚨 Batch evaluation - GPT-4 Vision parsing failed for sample:');
          console.log('📄 Full response:', evaluationText);
        }

        // Handle both structured and legacy score formats
        if (evaluation.score !== undefined) {
          // Legacy single score format
          const rawScore = evaluation.score;
          evaluation.score = Math.max(0.0, Math.min(10.0, parseFloat(rawScore)));

          if (rawScore < 0 || rawScore > 10) {
            console.log(`⚠️  Score ${rawScore} was out of range, clamped to ${evaluation.score}`);
          }

          results.push({
            sampleId: sample.id,
            score: evaluation.score,
            reasoning: evaluation.reasoning || 'No reasoning provided',
            samplePair: {
              id: sample.id,
              generated: { url: sample.generatedImageUrl },
              reference: { url: sample.referenceImageUrl }
            }
          });
        } else {
          // New structured format
          // Skip this sample if GPT-4 refused to evaluate (null scores)
          if (!evaluation.visualAppeal && evaluation.visualAppeal !== 0 ||
              !evaluation.styleSimilarity && evaluation.styleSimilarity !== 0 ||
              !evaluation.technicalQuality && evaluation.technicalQuality !== 0) {
            console.log(`⚠️  Skipping sample ${sample.id} - GPT-4 Vision refused to evaluate`);
            continue;
          }

          evaluation.visualAppeal = Math.max(0.0, Math.min(10.0, evaluation.visualAppeal));
          evaluation.styleSimilarity = Math.max(0.0, Math.min(10.0, evaluation.styleSimilarity));
          evaluation.technicalQuality = Math.max(0.0, Math.min(10.0, evaluation.technicalQuality));

          results.push({
            sampleId: sample.id,
            visualAppeal: evaluation.visualAppeal,
            styleSimilarity: evaluation.styleSimilarity,
            technicalQuality: evaluation.technicalQuality,
            reasoning: evaluation.reasoning || 'No reasoning provided',
            samplePair: {
              id: sample.id,
              generated: { url: sample.generatedImageUrl },
              reference: { url: sample.referenceImageUrl }
            }
          });
        }

        // Add small delay between requests
        await new Promise(resolve => setTimeout(resolve, 500));

      } catch (sampleError) {
        console.error(`❌ Error evaluating sample ${sample.id}:`, sampleError);
        results.push({
          sampleId: sample.id,
          score: 5.0,
          reasoning: `Evaluation failed: ${sampleError.message}`,
          samplePair: {
            id: sample.id,
            generated: {
              url: sample.generatedImageUrl
            },
            reference: {
              url: sample.referenceImageUrl
            }
          }
        });
      }
    }

    console.log(`✅ Completed batch evaluation: ${results.length} results`);
    res.json({
      success: true,
      results: results,
      count: results.length
    });

  } catch (error) {
    console.error('❌ Batch evaluation error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// In-memory storage for evaluation prompts and sample sets (in production, use a database)
let evaluationPrompts = [];
let nextPromptId = 1;
let sampleSets = [];
let nextSampleSetId = 1;

// Get saved evaluation prompts
app.get("/api/evaluation-prompts", (req, res) => {
  res.json({
    success: true,
    prompts: evaluationPrompts
  });
});

// Save evaluation prompt
app.post("/api/evaluation-prompts", (req, res) => {
  try {
    const { name, content } = req.body;

    if (!name || !content) {
      return res.status(400).json({
        error: 'Missing required parameters: name and content'
      });
    }

    const newPrompt = {
      id: nextPromptId++,
      name: name.trim(),
      content: content.trim(),
      createdAt: new Date().toISOString()
    };

    evaluationPrompts.push(newPrompt);

    console.log(`💾 Saved evaluation prompt: "${name}"`);
    res.json({
      success: true,
      prompt: newPrompt
    });

  } catch (error) {
    console.error('❌ Error saving prompt:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Get saved sample sets
app.get("/api/sample-sets", (req, res) => {
  res.json({
    success: true,
    sampleSets: sampleSets
  });
});

// Get current working set from database
app.get("/api/current-samples", async (req, res) => {
  try {
    const { data: samples, error } = await supabase
      .from('current_working_samples')
      .select('*')
      .order('created_at', { ascending: true });

    if (error) {
      console.error('❌ Error fetching current samples:', error);
      return res.status(500).json({
        success: false,
        error: 'Failed to fetch current samples'
      });
    }

    // Transform database format to frontend format
    const formattedSamples = samples.map(sample => ({
      id: sample.id,
      generated: {
        url: sample.generated_image_url
      },
      reference: {
        url: sample.reference_image_url
      }
    }));

    res.json({
      success: true,
      samples: formattedSamples
    });
  } catch (error) {
    console.error('❌ Error in current-samples endpoint:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch current samples'
    });
  }
});

// Upload sample images to Supabase and add to current working set
app.post("/api/upload-sample-images", upload.fields([
  { name: 'generated', maxCount: 1 },
  { name: 'reference', maxCount: 1 }
]), async (req, res) => {
  try {
    console.log('📤 Upload request received');
    console.log('Files:', req.files);
    console.log('Body:', req.body);

    if (!req.files || !req.files.generated || !req.files.reference) {
      console.log('❌ Missing files in request');
      return res.status(400).json({
        error: 'Missing required files: generated and reference images',
        received: req.files ? Object.keys(req.files) : 'no files'
      });
    }

    const generatedFile = req.files.generated[0];
    const referenceFile = req.files.reference[0];

    // Upload generated image to Supabase
    const generatedFileName = `evaluation_samples/generated_${Date.now()}_${Math.random().toString(36).substr(2, 9)}.${generatedFile.originalname.split('.').pop()}`;
    const { data: generatedUpload, error: generatedError } = await supabase.storage
      .from("generated-images")
      .upload(generatedFileName, generatedFile.buffer, {
        contentType: generatedFile.mimetype,
        cacheControl: "3600",
      });

    if (generatedError) {
      console.error("❌ Error uploading generated image:", generatedError);
      return res.status(500).json({ error: 'Failed to upload generated image' });
    }

    // Upload reference image to Supabase
    const referenceFileName = `evaluation_samples/reference_${Date.now()}_${Math.random().toString(36).substr(2, 9)}.${referenceFile.originalname.split('.').pop()}`;
    const { data: referenceUpload, error: referenceError } = await supabase.storage
      .from("generated-images")
      .upload(referenceFileName, referenceFile.buffer, {
        contentType: referenceFile.mimetype,
        cacheControl: "3600",
      });

    if (referenceError) {
      console.error("❌ Error uploading reference image:", referenceError);
      return res.status(500).json({ error: 'Failed to upload reference image' });
    }

    // Create public URLs
    const generatedUrl = `${process.env.SUPABASE_URL}/storage/v1/object/public/generated-images/${generatedUpload.path}`;
    const referenceUrl = `${process.env.SUPABASE_URL}/storage/v1/object/public/generated-images/${referenceUpload.path}`;

    // Add sample to database
    const { data: newSample, error: insertError } = await supabase
      .from('current_working_samples')
      .insert({
        generated_image_url: generatedUrl,
        reference_image_url: referenceUrl
      })
      .select()
      .single();

    if (insertError) {
      console.error('❌ Error saving sample to database:', insertError);
      return res.status(500).json({ error: 'Failed to save sample to database' });
    }

    // Get current count for response
    const { count } = await supabase
      .from('current_working_samples')
      .select('*', { count: 'exact', head: true });

    console.log(`📝 Uploaded and added sample to database (${count} total)`);
    res.json({
      success: true,
      sample: newSample,
      generatedUrl: generatedUrl,
      referenceUrl: referenceUrl,
      totalSamples: count
    });

  } catch (error) {
    console.error('❌ Error uploading sample images:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Multer error handling middleware
app.use((error, req, res, next) => {
  if (error instanceof multer.MulterError) {
    console.error('❌ Multer error:', error.message);
    return res.status(400).json({
      error: `File upload error: ${error.message}`,
      code: error.code
    });
  }
  next(error);
});

// Clear current working set
app.delete("/api/current-samples", async (req, res) => {
  try {
    const { error } = await supabase
      .from('current_working_samples')
      .delete()
      .neq('id', 0); // Delete all rows

    if (error) {
      console.error('❌ Error clearing current samples:', error);
      return res.status(500).json({
        success: false,
        error: 'Failed to clear current samples'
      });
    }

    console.log('🗑️ Cleared current working set from database');
    res.json({
      success: true,
      message: 'Working set cleared'
    });
  } catch (error) {
    console.error('❌ Error in clear samples endpoint:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to clear current samples'
    });
  }
});

// Save current working set as named sample set
app.post("/api/sample-sets", (req, res) => {
  try {
    const { name } = req.body;

    if (!name || !name.trim()) {
      return res.status(400).json({
        error: 'Missing required parameter: name'
      });
    }

    if (currentWorkingSet.length === 0) {
      return res.status(400).json({
        error: 'No samples in current working set to save'
      });
    }

    const newSampleSet = {
      id: nextSampleSetId++,
      name: name.trim(),
      samples: [...currentWorkingSet], // Copy the current working set
      createdAt: new Date().toISOString()
    };

    sampleSets.push(newSampleSet);

    console.log(`💾 Saved sample set: "${name}" with ${currentWorkingSet.length} samples`);
    res.json({
      success: true,
      sampleSet: newSampleSet
    });

  } catch (error) {
    console.error('❌ Error saving sample set:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Load saved sample set to current working set
app.post("/api/sample-sets/:id/load", (req, res) => {
  try {
    const sampleSetId = parseInt(req.params.id);
    const sampleSet = sampleSets.find(set => set.id === sampleSetId);

    if (!sampleSet) {
      return res.status(404).json({
        error: 'Sample set not found'
      });
    }

    currentWorkingSet = [...sampleSet.samples]; // Copy samples to working set

    console.log(`📂 Loaded sample set "${sampleSet.name}" to working set (${currentWorkingSet.length} samples)`);
    res.json({
      success: true,
      message: `Loaded "${sampleSet.name}" to working set`,
      sampleCount: currentWorkingSet.length
    });

  } catch (error) {
    console.error('❌ Error loading sample set:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Generate Prompt Variations endpoint
app.post("/api/generate-prompt-variations", async (req, res) => {
  try {
    const { basePrompts, variationStrength = 0.3, count = 10 } = req.body;

    if (!basePrompts || basePrompts.length === 0) {
      return res.status(400).json({ error: 'Missing required parameter: basePrompts' });
    }

    if (!process.env.OPENAI_API_KEY) {
      return res.status(500).json({ error: 'OpenAI API key not configured' });
    }

    const response = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        {
          role: 'user',
          content: `Generate ${count} creative variations of these pet photography prompts:\n\n${basePrompts.join('\n')}\n\nVariation strength: ${variationStrength} (0=minimal changes, 1=major changes)\n\nReturn ONLY a JSON array of strings, no other text.`
        }
      ],
      max_tokens: 500,
      temperature: 0.8
    });

    const content = response.choices[0]?.message?.content;
    if (!content) {
      throw new Error('No response from OpenAI');
    }

    try {
      const variations = JSON.parse(content);
      res.json({ variations });
    } catch (parseError) {
      // Fallback to base prompts with simple modifications
      const fallbackVariations = basePrompts.flatMap(prompt => [
        `${prompt} with enhanced lighting`,
        `${prompt} in artistic style`,
        `${prompt} with vibrant colors`
      ]).slice(0, count);
      res.json({ variations: fallbackVariations });
    }
  } catch (error) {
    console.error('Prompt variation generation error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Generate Evolutionary Prompts endpoint
app.post("/api/generate-evolutionary-prompts", async (req, res) => {
  try {
    const { parentPrompts, keepTopPercent = 0.2, mutationRate = 0.1, count = 10 } = req.body;

    if (!parentPrompts || parentPrompts.length === 0) {
      return res.status(400).json({ error: 'Missing required parameter: parentPrompts' });
    }

    if (!process.env.OPENAI_API_KEY) {
      return res.status(500).json({ error: 'OpenAI API key not configured' });
    }

    const response = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        {
          role: 'user',
          content: `Using evolutionary algorithm principles, evolve these successful pet photography prompts:\n\n${parentPrompts.join('\n')}\n\nGenerate ${count} evolved prompts that:\n- Keep the best elements from parent prompts\n- Introduce mutations (mutation rate: ${mutationRate})\n- Create diverse offspring\n\nReturn ONLY a JSON array of strings, no other text.`
        }
      ],
      max_tokens: 600,
      temperature: 0.9
    });

    const content = response.choices[0]?.message?.content;
    if (!content) {
      throw new Error('No response from OpenAI');
    }

    try {
      const prompts = JSON.parse(content);
      res.json({ prompts });
    } catch (parseError) {
      // Fallback to combining parent prompts
      const fallbackPrompts = [];
      for (let i = 0; i < count; i++) {
        const prompt1 = parentPrompts[Math.floor(Math.random() * parentPrompts.length)];
        const prompt2 = parentPrompts[Math.floor(Math.random() * parentPrompts.length)];
        fallbackPrompts.push(`${prompt1} evolved with elements from ${prompt2}`);
      }
      res.json({ prompts: fallbackPrompts });
    }
  } catch (error) {
    console.error('Evolutionary prompt generation error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Generate Random Prompts endpoint
app.post("/api/generate-random-prompts", async (req, res) => {
  try {
    const { count = 10, category = 'pet_photography' } = req.body;

    if (!process.env.OPENAI_API_KEY) {
      return res.status(500).json({ error: 'OpenAI API key not configured' });
    }

    const response = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        {
          role: 'user',
          content: `Generate ${count} creative and diverse pet photography prompts for AI image generation. Focus on different styles, moods, settings, and artistic approaches. Make them specific and inspiring.\n\nReturn ONLY a JSON array of strings, no other text.`
        }
      ],
      max_tokens: 400,
      temperature: 1.0
    });

    const content = response.choices[0]?.message?.content;
    if (!content) {
      throw new Error('No response from OpenAI');
    }

    try {
      const prompts = JSON.parse(content);
      res.json({ prompts });
    } catch (parseError) {
      // Fallback to predefined prompts
      const fallbackPrompts = [
        'Adorable pet in golden hour lighting with soft bokeh background',
        'Professional studio portrait of pet with dramatic lighting',
        'Playful pet in natural outdoor setting with vibrant colors',
        'Elegant pet portrait in black and white photography style',
        'Cute pet in cozy home environment with warm lighting',
        'Artistic pet photo with creative composition and unique angle',
        'Pet in beautiful garden setting with flowers and natural light',
        'Candid moment of happy pet with joyful expression'
      ];
      res.json({ prompts: fallbackPrompts.slice(0, count) });
    }
  } catch (error) {
    console.error('Random prompt generation error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Generate Chain Prompts endpoint
app.post("/api/generate-chain-prompts", async (req, res) => {
  try {
    const { basePrompts, iteration, config } = req.body;

    if (!basePrompts || basePrompts.length === 0) {
      return res.status(400).json({ error: 'Missing required parameter: basePrompts' });
    }

    if (!process.env.OPENAI_API_KEY) {
      return res.status(500).json({ error: 'OpenAI API key not configured' });
    }

    const response = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        {
          role: 'user',
          content: `This is iteration ${iteration} of an iterative improvement process. Build upon these successful prompts from previous iterations:\n\n${basePrompts.join('\n')}\n\nGenerate improved prompts that:\n- Enhance the successful elements\n- Add refinements based on iteration progress\n- Maintain the core appeal while improving quality\n\nReturn ONLY a JSON array of strings, no other text.`
        }
      ],
      max_tokens: 500,
      temperature: 0.7
    });

    const content = response.choices[0]?.message?.content;
    if (!content) {
      throw new Error('No response from OpenAI');
    }

    try {
      const prompts = JSON.parse(content);
      res.json({ prompts });
    } catch (parseError) {
      // Fallback to enhanced versions of base prompts
      const enhancements = ['refined', 'enhanced', 'improved', 'polished', 'optimized'];
      const enhancedPrompts = basePrompts.map(prompt => {
        const enhancement = enhancements[Math.floor(Math.random() * enhancements.length)];
        return `${prompt} (${enhancement} for iteration ${iteration})`;
      });
      res.json({ prompts: enhancedPrompts });
    }
  } catch (error) {
    console.error('Chain prompt generation error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Training Sample Generation Endpoints

// Get customers with single uploaded images
app.get("/api/prod/customers", async (req, res) => {
  try {
    console.log('🔍 Scanning production storage for single-image customers...');

    // List all customer folders in product-images bucket
    const { data: customerFolders, error: listError } = await prodSupabase.storage
      .from('product-images')
      .list('', { limit: 1000 });

    if (listError) {
      console.error('❌ Error listing customer folders:', listError);
      return res.status(500).json({ error: 'Failed to list customer folders' });
    }

    const singleImageCustomers = [];

    // Check each customer folder for uploaded images
    for (const folder of customerFolders) {
      if (!folder.name || folder.name === '.emptyFolderPlaceholder') continue;

      try {
        // Check if uploaded folder exists and count images
        const { data: uploadedFiles, error: uploadError } = await prodSupabase.storage
          .from('product-images')
          .list(`${folder.name}/uploaded`, { limit: 10 });

        if (!uploadError && uploadedFiles) {
          // Filter out folder placeholders and count actual image files
          const imageFiles = uploadedFiles.filter(file =>
            file.name &&
            !file.name.includes('.emptyFolderPlaceholder') &&
            /\.(jpg|jpeg|png|webp)$/i.test(file.name)
          );

          if (imageFiles.length === 1) {
            singleImageCustomers.push({
              customerId: folder.name,
              uploadedImage: imageFiles[0].name,
              uploadedAt: imageFiles[0].created_at
            });
          }
        }
      } catch (error) {
        console.log(`⚠️  Skipping customer ${folder.name}: ${error.message}`);
      }
    }

    console.log(`✅ Found ${singleImageCustomers.length} customers with single uploaded images`);

    res.json({
      success: true,
      customers: singleImageCustomers,
      totalCount: singleImageCustomers.length
    });

  } catch (error) {
    console.error('❌ Error scanning customers:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Get available product types
app.get("/api/prod/products", async (req, res) => {
  try {
    console.log('🔍 Scanning for available product types...');

    // Get a sample customer to see what product folders exist
    const { data: customerFolders, error: listError } = await prodSupabase.storage
      .from('product-images')
      .list('', { limit: 10 });

    if (listError) {
      return res.status(500).json({ error: 'Failed to list customer folders' });
    }

    const productTypes = new Set();

    // Check first few customers to find available product types
    for (const folder of customerFolders.slice(0, 5)) {
      if (!folder.name || folder.name === '.emptyFolderPlaceholder') continue;

      try {
        const { data: subFolders, error } = await prodSupabase.storage
          .from('product-images')
          .list(folder.name, { limit: 20 });

        if (!error && subFolders) {
          subFolders.forEach(subFolder => {
            if (subFolder.name &&
                subFolder.name !== 'uploaded' &&
                !subFolder.name.includes('.emptyFolderPlaceholder')) {
              productTypes.add(subFolder.name);
            }
          });
        }
      } catch (error) {
        console.log(`⚠️  Error checking ${folder.name}:`, error.message);
      }
    }

    const products = Array.from(productTypes).sort();
    console.log(`✅ Found product types:`, products);

    res.json({
      success: true,
      products: products
    });

  } catch (error) {
    console.error('❌ Error scanning products:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Validate customer data for import - check if both uploaded and generated images exist
app.post("/api/prod/validate-customer", async (req, res) => {
  try {
    const { customerId, uploadedImage, productType } = req.body;

    if (!customerId || !uploadedImage || !productType) {
      return res.status(400).json({
        success: false,
        reason: 'Missing required parameters'
      });
    }

    console.log(`🔍 Validating customer ${customerId} for product ${productType}`);

    // Check uploaded folder - should have exactly 1 image
    const { data: uploadedFiles, error: uploadedError } = await prodSupabase.storage
      .from('product-images')
      .list(`${customerId}/uploaded`);

    if (uploadedError) {
      console.log(`❌ Error checking uploaded folder for ${customerId}:`, uploadedError);
      return res.json({
        success: false,
        reason: `Uploaded folder error: ${uploadedError.message}`
      });
    }

    // Filter to actual image files
    const uploadedImageFiles = uploadedFiles && uploadedFiles.filter(file =>
      file.name &&
      !file.name.includes('.emptyFolderPlaceholder') &&
      /\.(jpg|jpeg|png|webp)$/i.test(file.name)
    );

    if (!uploadedImageFiles || uploadedImageFiles.length === 0) {
      console.log(`❌ No uploaded images found for customer ${customerId}`);
      return res.json({
        success: false,
        reason: 'No uploaded images found'
      });
    }

    if (uploadedImageFiles.length > 1) {
      console.log(`❌ Customer ${customerId} has ${uploadedImageFiles.length} uploaded images, should have exactly 1`);
      return res.json({
        success: false,
        reason: `Customer has ${uploadedImageFiles.length} uploaded images, expected 1`
      });
    }

    // Use the single uploaded image
    const actualUploadedImage = uploadedImageFiles[0].name;
    console.log(`📋 Customer ${customerId} has uploaded image: ${actualUploadedImage}`);

    // Check if generated image exists by listing the product folder
    const { data: generatedFiles, error: generatedError } = await prodSupabase.storage
      .from('product-images')
      .list(`${customerId}/${productType}`);

    if (generatedError) {
      console.log(`❌ Error checking generated folder for ${customerId}/${productType}:`, generatedError);
      return res.json({
        success: false,
        reason: `Generated folder error: ${generatedError.message}`
      });
    }

    // Check if there's at least one generated image (any filename is fine)
    const imageFiles = generatedFiles && generatedFiles.filter(file =>
      file.name &&
      !file.name.includes('.emptyFolderPlaceholder') &&
      /\.(jpg|jpeg|png|webp)$/i.test(file.name)
    );

    if (!imageFiles || imageFiles.length === 0) {
      console.log(`❌ No generated images found in ${customerId}/${productType}`);
      console.log(`📝 Available files in ${customerId}/${productType}:`, generatedFiles?.map(f => f.name) || []);
      return res.json({
        success: false,
        reason: `No generated images found in ${productType} folder`
      });
    }

    // Use the first available generated image
    const generatedImageName = imageFiles[0].name;
    console.log(`✅ Found uploaded image: ${actualUploadedImage} and generated image: ${generatedImageName} for customer ${customerId}`);

    // If both exist, generate the public URLs
    const uploadedPath = `${customerId}/uploaded/${actualUploadedImage}`;
    const generatedPath = `${customerId}/${productType}/${generatedImageName}`;

    const { data: uploadedUrl } = prodSupabase.storage
      .from('product-images')
      .getPublicUrl(uploadedPath);

    const { data: generatedUrl } = prodSupabase.storage
      .from('product-images')
      .getPublicUrl(generatedPath);

    res.json({
      success: true,
      uploadedImageUrl: uploadedUrl.publicUrl,
      generatedImageUrl: generatedUrl.publicUrl,
      customerId,
      productType
    });

  } catch (error) {
    console.error('❌ Error validating customer:', error);
    res.status(500).json({
      success: false,
      reason: error.message
    });
  }
});

// Generate training samples - batch download and process
app.post("/api/training/generate", async (req, res) => {
  try {
    const { productType, customers } = req.body;

    if (!productType || !customers || customers.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'Missing required parameters: productType and customers'
      });
    }

    console.log(`🚀 Starting training sample generation for ${customers.length} customers with product: ${productType}`);

    const results = [];
    const errors = [];

    // Process customers in batches
    for (let i = 0; i < customers.length; i++) {
      const customer = customers[i];

      try {
        console.log(`📥 Processing customer ${i + 1}/${customers.length}: ${customer.customerId}`);

        // Download uploaded image from production
        const uploadedPath = `${customer.customerId}/uploaded/${customer.uploadedImage}`;
        const { data: uploadedImageData, error: uploadedError } = await prodSupabase.storage
          .from('product-images')
          .download(uploadedPath);

        if (uploadedError) {
          throw new Error(`Failed to download uploaded image: ${uploadedError.message}`);
        }

        // Find and download product image
        const { data: productFiles, error: productListError } = await prodSupabase.storage
          .from('product-images')
          .list(`${customer.customerId}/${productType}`, { limit: 10 });

        if (productListError || !productFiles || productFiles.length === 0) {
          throw new Error(`No product images found for ${productType}`);
        }

        // Get the first product image (or you could add logic to select specific ones)
        const productImage = productFiles.find(file =>
          file.name && /\.(jpg|jpeg|png|webp)$/i.test(file.name)
        );

        if (!productImage) {
          throw new Error(`No valid product image found for ${productType}`);
        }

        const productPath = `${customer.customerId}/${productType}/${productImage.name}`;
        const { data: productImageData, error: productError } = await prodSupabase.storage
          .from('product-images')
          .download(productPath);

        if (productError) {
          throw new Error(`Failed to download product image: ${productError.message}`);
        }

        // Upload images to local Supabase storage
        const timestamp = Date.now();
        const uploadedFileName = `training_samples/uploaded_${customer.customerId}_${timestamp}.${customer.uploadedImage.split('.').pop()}`;
        const productFileName = `training_samples/generated_${customer.customerId}_${productType}_${timestamp}.${productImage.name.split('.').pop()}`;

        // Upload uploaded image
        const { data: uploadedUpload, error: uploadedUploadError } = await supabase.storage
          .from('generated-images')
          .upload(uploadedFileName, uploadedImageData, {
            contentType: `image/${customer.uploadedImage.split('.').pop()}`,
            cacheControl: '3600'
          });

        if (uploadedUploadError) {
          throw new Error(`Failed to upload uploaded image: ${uploadedUploadError.message}`);
        }

        // Upload product image
        const { data: productUpload, error: productUploadError } = await supabase.storage
          .from('generated-images')
          .upload(productFileName, productImageData, {
            contentType: `image/${productImage.name.split('.').pop()}`,
            cacheControl: '3600'
          });

        if (productUploadError) {
          throw new Error(`Failed to upload product image: ${productUploadError.message}`);
        }

        // Create public URLs
        const uploadedUrl = `${process.env.SUPABASE_URL}/storage/v1/object/public/generated-images/${uploadedUpload.path}`;
        const productUrl = `${process.env.SUPABASE_URL}/storage/v1/object/public/generated-images/${productUpload.path}`;

        // Save to training samples database
        const { data: trainingSample, error: dbError } = await supabase
          .from('training_samples')
          .insert({
            customer_id: customer.customerId,
            product_type: productType,
            uploaded_image_url: uploadedUrl,
            generated_image_url: productUrl
          })
          .select()
          .single();

        if (dbError) {
          throw new Error(`Failed to save training sample: ${dbError.message}`);
        }

        results.push({
          customerId: customer.customerId,
          success: true,
          trainingSampleId: trainingSample.id,
          uploadedUrl,
          productUrl
        });

        console.log(`✅ Successfully processed customer ${customer.customerId}`);

      } catch (error) {
        console.error(`❌ Error processing customer ${customer.customerId}:`, error);
        errors.push({
          customerId: customer.customerId,
          error: error.message
        });

        results.push({
          customerId: customer.customerId,
          success: false,
          error: error.message
        });
      }

      // Add small delay to avoid overwhelming the API
      await new Promise(resolve => setTimeout(resolve, 200));
    }

    console.log(`🎉 Training sample generation complete: ${results.filter(r => r.success).length} successful, ${errors.length} failed`);

    res.json({
      success: true,
      results,
      summary: {
        total: customers.length,
        successful: results.filter(r => r.success).length,
        failed: errors.length,
        productType
      }
    });

  } catch (error) {
    console.error('❌ Training sample generation error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Get training samples
app.get("/api/training/samples", async (req, res) => {
  try {
    const { data: samples, error } = await supabase
      .from('training_samples')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) {
      return res.status(500).json({
        success: false,
        error: 'Failed to fetch training samples'
      });
    }

    res.json({
      success: true,
      samples: samples || [],
      count: samples?.length || 0
    });

  } catch (error) {
    console.error('❌ Error fetching training samples:', error);
    res.status(500).json({
      success: false,
      error: error.message
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
