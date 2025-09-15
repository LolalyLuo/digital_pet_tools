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
// Import Vertex AI libraries
import {
  JobServiceClient,
  PredictionServiceClient,
} from "@google-cloud/aiplatform";
import { Storage } from "@google-cloud/storage";

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
    if (file.mimetype.startsWith("image/")) {
      cb(null, true);
    } else {
      cb(new Error("Only image files are allowed"), false);
    }
  },
});

// Initialize Supabase client
console.log("🔧 Initializing Supabase client...");
console.log("📍 Supabase URL:", process.env.SUPABASE_URL);
console.log(
  "🔑 Service Role Key (first 20 chars):",
  process.env.SUPABASE_SERVICE_ROLE_KEY?.substring(0, 20) + "..."
);

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Production database client for training sample generation
const prodSupabase = createClient(
  process.env.PROD_SUPABASE_URL,
  process.env.PROD_SUPABASE_SERVICE_ROLE_KEY
);

console.log("✅ Supabase client initialized");
console.log("✅ Production Supabase client initialized");

// Initialize Vertex AI client
const projectId = process.env.GOOGLE_CLOUD_PROJECT_ID;
const location = process.env.VERTEX_AI_LOCATION || "us-central1";

console.log("🔧 Initializing Vertex AI client...");
console.log("📍 Project ID:", projectId);
console.log("📍 Location:", location);

// Initialize clients with explicit configuration
const clientOptions = {
  projectId: projectId,
  apiEndpoint: `${location}-aiplatform.googleapis.com`,
};

const jobServiceClient = new JobServiceClient(clientOptions);
const predictionClient = new PredictionServiceClient(clientOptions);
const storageClient = new Storage({
  projectId: projectId,
});

console.log("✅ Vertex AI client initialized");

// Initialize database tables
async function initializeDatabase() {
  console.log("🔧 Checking database table...");
  // Test if the table exists by trying to select from it
  const { data, error } = await supabase
    .from("current_working_samples")
    .select("id")
    .limit(1);

  if (error) {
    console.log(
      "⚠️  Table current_working_samples does not exist. Please create it manually in Supabase with this SQL:"
    );
    console.log(`
      CREATE TABLE current_working_samples (
        id SERIAL PRIMARY KEY,
        generated_image_url TEXT NOT NULL,
        reference_image_url TEXT NOT NULL,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );
    `);
  } else {
    console.log("✅ Current working samples table exists and is accessible");
  }

  // Check training samples table
  const { data: trainingData, error: trainingError } = await supabase
    .from("training_samples")
    .select("id")
    .limit(1);

  if (trainingError) {
    console.log(
      "⚠️  Table training_samples does not exist. Please create it manually in Supabase with this SQL:"
    );
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
    console.log("✅ Training samples table exists and is accessible");
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
      console.error(
        `❌ Failed to fetch image: ${response.status} ${response.statusText}`
      );
      throw new Error(`Failed to fetch image: ${response.statusText}`);
    }
    console.log(
      `✅ Image fetched successfully, size: ${response.headers.get(
        "content-length"
      )} bytes`
    );
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

// Helper function to upload GCS image to Supabase cloud-images bucket
async function uploadGCSImageToSupabase(gcsUrl, imageId) {
  try {
    console.log(`📤 Uploading image ${imageId} from GCS to Supabase...`);

    // Parse HTTPS GCS URL: https://storage.googleapis.com/bucket-name/path/to/file
    const httpsMatch = gcsUrl.match(
      /https:\/\/storage\.googleapis\.com\/([^\/]+)\/(.+)/
    );
    if (!httpsMatch) {
      throw new Error("Invalid GCS HTTPS URL format");
    }

    const bucketName = httpsMatch[1];
    const filePath = httpsMatch[2];

    // Download from GCS using storage client
    const bucket = storageClient.bucket(bucketName);
    const file = bucket.file(filePath);

    const [exists] = await file.exists();
    if (!exists) {
      throw new Error("File does not exist in GCS");
    }

    // Get file extension
    const fileExtension = filePath.split(".").pop() || "jpg";
    const fileName = `vertex-ai-${imageId}.${fileExtension}`;

    // Download file content
    const [fileBuffer] = await file.download();

    // Upload to Supabase storage
    const { data, error } = await supabase.storage
      .from("cloud-images")
      .upload(fileName, fileBuffer, {
        contentType: `image/${fileExtension}`,
        upsert: true,
      });

    if (error) {
      throw new Error(`Supabase upload failed: ${error.message}`);
    }

    // Get public URL
    const {
      data: { publicUrl },
    } = supabase.storage.from("cloud-images").getPublicUrl(fileName);

    console.log(
      `✅ Successfully uploaded image ${imageId} to Supabase: ${publicUrl}`
    );
    return publicUrl;
  } catch (error) {
    console.error(
      `❌ Failed to upload image ${imageId} to Supabase:`,
      error.message
    );
    throw error;
  }
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

// Generate detailed description of an image using Gemini API
async function generateImageDescription(imageUrl, imageType = "source") {
  try {
    console.log(
      `🔍 Generating description for ${imageType} image: ${imageUrl}`
    );

    // Check if description is already cached in Supabase
    const { data: cachedDescription, error: cacheError } = await supabase
      .from("image_descriptions")
      .select("description")
      .eq("image_url", imageUrl)
      .single();

    if (!cacheError && cachedDescription) {
      console.log(`✅ Found cached description for ${imageType} image`);
      return cachedDescription.description;
    }

    // Initialize Gemini AI
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

    // Fetch image
    const response = await fetch(imageUrl);
    if (!response.ok) {
      throw new Error(`Failed to fetch image: ${response.statusText}`);
    }
    const imageBuffer = await response.buffer();

    // Create image part for Gemini
    const imagePart = {
      inlineData: {
        data: imageBuffer.toString("base64"),
        mimeType: response.headers.get("content-type") || "image/jpeg",
      },
    };

    // Generate detailed description
    const prompt = `Please provide a detailed description of this image. Focus on:
1. The main subject (pet type, breed, pose, expression)
2. Visual style and artistic approach (realistic, artistic, watercolor, etc.)
3. Colors, lighting, and mood
4. Background and setting
5. Overall composition and quality

Provide a detailed and comprehensive description that captures all the important visual elements, artistic techniques, and aesthetic qualities.`;

    const result = await model.generateContent([prompt, imagePart]);
    const description = result.response.text();

    // Cache the description in Supabase
    try {
      await supabase.from("image_descriptions").insert({
        image_url: imageUrl,
        description: description,
        image_type: imageType,
      });
      console.log(`💾 Cached description for ${imageType} image`);
    } catch (insertError) {
      console.log(`⚠️ Failed to cache description: ${insertError.message}`);
    }

    return description;
  } catch (error) {
    console.error(
      `❌ Failed to generate description for ${imageType} image:`,
      error
    );
    throw error;
  }
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
    console.log(
      `📤 Uploading image to storage: ${fileName} (${imageBuffer.length} bytes)`
    );

    const { data: uploadData, error: uploadError } = await supabase.storage
      .from("generated-images")
      .upload(fileName, imageBuffer, {
        contentType: "image/png",
        cacheControl: "3600",
      });

    if (uploadError) {
      console.error("❌ Error: Failed to upload image to storage:");
      console.error("📋 Upload error details:", {
        message: uploadError.message,
        statusCode: uploadError.statusCode,
        error: uploadError.error,
        fileName: fileName,
        bufferSize: imageBuffer.length,
      });
      return null;
    }

    console.log("✅ Image uploaded successfully to storage:", uploadData?.path);

    console.log("Image stored successfully");

    // Store result in database
    console.log("💾 Storing image metadata in database...");

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

    console.log("📋 Insert payload:", insertPayload);

    const { data: insertData, error: insertError } = await supabase
      .from("generated_images")
      .insert(insertPayload)
      .select()
      .single();

    if (insertError) {
      console.error("❌ Error: Failed to store image in database:");
      console.error("📋 Database error details:", {
        message: insertError.message,
        code: insertError.code,
        details: insertError.details,
        hint: insertError.hint,
        payload: insertPayload,
      });
      return null;
    }

    console.log("✅ Image metadata stored in database:", insertData?.id);

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
              console.error("📋 Photo lookup error:", {
                error: photoError,
                photoId: photoId,
              });
              return null;
            }

            console.log(`✅ Found photo data:`, {
              id: photoData.id,
              fileName: photoData.file_name,
              filePath: photoData.file_path,
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
    console.error("📋 Error details:", {
      message: error.message,
      stack: error.stack,
      name: error.name,
    });
    res.status(500).json({
      error: error.message,
      details: "Check server logs for more information",
      timestamp: new Date().toISOString(),
    });
  }
});

// LLM Image Evaluation endpoint
app.post("/api/evaluate-image", async (req, res) => {
  try {
    console.log("🔍 LLM Evaluation Request:", {
      imageUrl: req.body.imageUrl?.substring(0, 100) + "...",
      prompt: req.body.prompt,
      criteria: req.body.criteria,
      model: req.body.model,
    });

    const {
      imageUrl,
      prompt,
      criteria = [],
      model = "gpt-4",
      temperature = 0.3,
      maxTokens = 50,
    } = req.body;

    if (!imageUrl || !prompt) {
      console.error("❌ Missing required parameters:", {
        imageUrl: !!imageUrl,
        prompt: !!prompt,
      });
      return res
        .status(400)
        .json({ error: "Missing required parameters: imageUrl and prompt" });
    }

    // For GPT models, use OpenAI
    if (model.startsWith("gpt")) {
      if (!process.env.OPENAI_API_KEY) {
        return res.status(500).json({ error: "OpenAI API key not configured" });
      }

      const response = await openai.chat.completions.create({
        model: "gpt-4o",
        messages: [
          {
            role: "user",
            content: [
              {
                type: "text",
                text: `${prompt}\n\nPlease evaluate this image and return ONLY a JSON object with this exact format:\n{\n  "overall_score": number (1-10),\n  "criteria_scores": {${criteria
                  .map((c) => `\n    "${c}": number (1-10)`)
                  .join(",")}\n  },\n  "feedback": "brief explanation"\n}`,
              },
              {
                type: "image_url",
                image_url: { url: imageUrl },
              },
            ],
          },
        ],
        max_tokens: maxTokens,
        temperature: temperature,
      });

      const content = response.choices[0]?.message?.content;
      if (!content) {
        throw new Error("No response from OpenAI");
      }

      try {
        const evaluation = JSON.parse(content);
        res.json(evaluation);
      } catch (parseError) {
        // Fallback if JSON parsing fails
        res.json({
          overall_score: 7.0,
          criteria_scores: Object.fromEntries(criteria.map((c) => [c, 7.0])),
          feedback: content,
        });
      }
    } else {
      // For other models, return a mock response for now
      res.json({
        overall_score: Math.random() * 4 + 6,
        criteria_scores: Object.fromEntries(
          criteria.map((c) => [c, Math.random() * 4 + 6])
        ),
        feedback: `Evaluated using ${model} - Mock evaluation for development`,
      });
    }
  } catch (error) {
    console.error("LLM evaluation error:", error);
    res.status(500).json({ error: error.message });
  }
});

// Photo Similarity Evaluation endpoint
app.post("/api/evaluate-photo-similarity", async (req, res) => {
  try {
    const { generatedImageUrl, targetImages = [], threshold = 0.7 } = req.body;

    if (!generatedImageUrl) {
      return res
        .status(400)
        .json({ error: "Missing required parameter: generatedImageUrl" });
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
        content: Math.random() * 0.3 + 0.7,
      },
      best_match: targetImages[0] || null,
      threshold_met: mockSimilarity >= threshold,
    });
  } catch (error) {
    console.error("Photo similarity evaluation error:", error);
    res.status(500).json({ error: error.message });
  }
});

// Testing endpoint for file upload and generation
app.post(
  "/api/test/generate-images",
  upload.array("images", 10),
  async (req, res) => {
    try {
      const { prompts: promptsString, selectedModel = "gemini-img2img" } =
        req.body;
      const files = req.files;

      if (!files || files.length === 0) {
        return res.status(400).json({ error: "No images uploaded" });
      }

      if (!promptsString) {
        return res.status(400).json({ error: "No prompts provided" });
      }

      let prompts;
      try {
        prompts = JSON.parse(promptsString);
      } catch (e) {
        prompts = [promptsString]; // Single prompt as string
      }

      console.log(
        `🧪 Testing: ${files.length} files, ${prompts.length} prompts, model: ${selectedModel}`
      );

      // Convert uploaded files to base64 for processing
      const imageBuffers = files.map((file) => ({
        buffer: file.buffer,
        mimetype: file.mimetype,
        filename: file.filename || "uploaded-image",
      }));

      // Use the same generation logic as the main endpoint
      const results = [];

      for (let i = 0; i < Math.min(files.length, prompts.length); i++) {
        const imageBuffer = imageBuffers[i];
        const prompt = prompts[i];

        try {
          let imageUrl = null;

          if (
            selectedModel === "gemini-img2img" &&
            process.env.GEMINI_API_KEY
          ) {
            // Use Gemini for generation
            const model = genAI.getGenerativeModel({
              model: "gemini-2.5-flash-image-preview",
              generationConfig: DEFAULT_MODEL_CONFIGS["gemini-img2img"],
            });

            const base64Data = imageBuffer.buffer.toString("base64");
            const imagePart = {
              inlineData: {
                data: base64Data,
                mimeType: imageBuffer.mimetype,
              },
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
          } else if (selectedModel === "openai" && process.env.OPENAI_API_KEY) {
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
              index: i,
            });
          }
        } catch (error) {
          console.error(`❌ Generation error for image ${i}:`, error);
          results.push({
            error: error.message,
            prompt: prompt,
            model: selectedModel,
            index: i,
          });
        }
      }

      res.json({
        success: true,
        results: results,
        count: results.length,
        model: selectedModel,
      });
    } catch (error) {
      console.error("❌ Testing generation error:", error);
      res.status(500).json({ error: error.message });
    }
  }
);

// Gemini Vision Evaluation endpoint
app.post("/api/evaluate-gpt4-vision", async (req, res) => {
  try {
    const { generatedImageUrl, referenceImageUrl, customPrompt } = req.body;

    if (!generatedImageUrl || !referenceImageUrl) {
      return res.status(400).json({
        error:
          "Missing required parameters: generatedImageUrl and referenceImageUrl",
      });
    }

    if (!process.env.GEMINI_API_KEY) {
      return res.status(500).json({ error: "Gemini API key not configured" });
    }

    console.log("🔍 Evaluating images with Gemini Vision...");
    console.log("📋 Generated image URL:", generatedImageUrl);
    console.log("📋 Reference image URL:", referenceImageUrl);
    console.log("📝 Using prompt:", customPrompt.substring(0, 100) + "...");

    // Test if images are accessible
    console.log("🔗 Testing image accessibility...");
    try {
      const [genResponse, refResponse] = await Promise.all([
        fetch(generatedImageUrl, { method: "HEAD" }),
        fetch(referenceImageUrl, { method: "HEAD" }),
      ]);
      console.log(
        `📊 Generated image status: ${
          genResponse.status
        } (${genResponse.headers.get("content-type")})`
      );
      console.log(
        `📊 Reference image status: ${
          refResponse.status
        } (${refResponse.headers.get("content-type")})`
      );

      if (!genResponse.ok || !refResponse.ok) {
        console.warn("⚠️ One or both images are not accessible!");
      }
    } catch (fetchError) {
      console.error("❌ Image accessibility test failed:", fetchError.message);
    }

    console.log("🔑 Gemini API Key available:", !!process.env.GEMINI_API_KEY);
    console.log(
      "🔑 API Key first 10 chars:",
      process.env.GEMINI_API_KEY?.substring(0, 10) + "..."
    );

    const evaluationPrompt =
      customPrompt ||
      `Compare these two dog images and provide a detailed evaluation.

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

    // Download images to pass to Gemini
    console.log("📥 Downloading images for Gemini...");
    const [genImageResponse, refImageResponse] = await Promise.all([
      fetch(generatedImageUrl),
      fetch(referenceImageUrl),
    ]);

    console.log(
      `📥 Generated image download: ${genImageResponse.status} ${genImageResponse.statusText}`
    );
    console.log(
      `📥 Reference image download: ${refImageResponse.status} ${refImageResponse.statusText}`
    );

    if (!genImageResponse.ok || !refImageResponse.ok) {
      throw new Error("Failed to download images for Gemini evaluation");
    }

    const genImageBuffer = await genImageResponse.arrayBuffer();
    const refImageBuffer = await refImageResponse.arrayBuffer();

    console.log(`📦 Generated image size: ${genImageBuffer.byteLength} bytes`);
    console.log(`📦 Reference image size: ${refImageBuffer.byteLength} bytes`);

    const genMimeType =
      genImageResponse.headers.get("content-type") || "image/jpeg";
    const refMimeType =
      refImageResponse.headers.get("content-type") || "image/jpeg";

    console.log(`🎨 Generated image MIME: ${genMimeType}`);
    console.log(`🎨 Reference image MIME: ${refMimeType}`);

    console.log("🤖 Initializing Gemini model...");
    const model = genAI.getGenerativeModel({
      model: "gemini-2.5-flash-image-preview",
      generationConfig: {
        temperature: 0.1,
        topK: 32,
        topP: 1,
        maxOutputTokens: 1000,
      },
    });

    console.log("📝 Preparing Gemini request payload...");
    const genImageData = {
      inlineData: {
        data: Buffer.from(genImageBuffer).toString("base64"),
        mimeType: genMimeType,
      },
    };

    const refImageData = {
      inlineData: {
        data: Buffer.from(refImageBuffer).toString("base64"),
        mimeType: refMimeType,
      },
    };

    console.log("📤 Payload structure:", {
      hasText: !!evaluationPrompt,
      hasImage1: !!genImageData.inlineData.data,
      hasImage2: !!refImageData.inlineData.data,
      image1Size: genImageData.inlineData.data.length,
      image2Size: refImageData.inlineData.data.length,
    });

    console.log("🚀 Calling Gemini API...");
    const response = await model.generateContent([
      evaluationPrompt,
      genImageData,
      refImageData,
    ]);

    console.log("📨 Gemini response received");
    console.log("📊 Response object keys:", Object.keys(response));
    console.log(
      "📊 Response.response keys:",
      response.response
        ? Object.keys(response.response)
        : "no response property"
    );

    let evaluationText;
    try {
      evaluationText = response.response.text();
      console.log("✅ Successfully extracted text from response");
      console.log("📝 Response length:", evaluationText?.length || 0);
    } catch (textError) {
      console.error("❌ Error extracting text from response:", textError);
      console.log(
        "🔍 Full response object:",
        JSON.stringify(response, null, 2)
      );
      throw new Error(
        `Failed to extract text from Gemini response: ${textError.message}`
      );
    }
    console.log("📝 Gemini Vision evaluation completed, parsing response...");

    // Try to parse JSON from the response
    let evaluation;
    try {
      // Extract JSON from the response if it's wrapped in text
      const jsonMatch = evaluationText.match(/\{[\s\S]*\}/);
      const jsonString = jsonMatch ? jsonMatch[0] : evaluationText;
      evaluation = JSON.parse(jsonString);

      // Validate that we have the required fields
      if (
        !evaluation.visualAppeal ||
        !evaluation.styleSimilarity ||
        !evaluation.technicalQuality
      ) {
        throw new Error("Missing required evaluation fields");
      }
    } catch (parseError) {
      console.error(
        "❌ Failed to parse Gemini Vision response as JSON:",
        parseError
      );
      console.log("📄 Full response text:", evaluationText);

      // Check if Gemini refused to evaluate (common responses)
      if (
        evaluationText.toLowerCase().includes("i'm sorry") ||
        evaluationText.toLowerCase().includes("i can't") ||
        evaluationText.toLowerCase().includes("i cannot") ||
        evaluationText.toLowerCase().includes("unable to")
      ) {
        console.log(
          "🚨 Gemini Vision declined to evaluate - skipping this sample"
        );
        throw new Error("Gemini Vision declined to evaluate this image pair");
      }

      // For other parsing errors, throw with details
      throw new Error(
        `Gemini Vision evaluation failed: ${
          parseError.message
        }. Response: ${evaluationText.substring(0, 100)}...`
      );
    }

    // Check if this is a single-score evaluation (new format)
    if (evaluation.score !== undefined) {
      // Single score format
      const originalScore = evaluation.score;
      evaluation.score = Math.max(0, Math.min(10, evaluation.score));

      if (originalScore !== evaluation.score) {
        console.log(
          `⚠️  Score clamped from ${originalScore} to ${evaluation.score}`
        );
      }

      const result = {
        success: true,
        evaluation: {
          score: evaluation.score,
          reasoning: evaluation.reasoning || "No reasoning provided",
        },
        metadata: {
          model: "gemini-2.5-flash",
          timestamp: new Date().toISOString(),
        },
      };

      console.log("✅ Gemini Vision evaluation completed (single score):", {
        score: result.evaluation.score,
        model: result.metadata.model,
      });
      res.json(result);
    } else {
      // New structured format with separate criteria scores
      // Check if we have valid scores, reject if any are null/undefined
      if (
        (!evaluation.visualAppeal && evaluation.visualAppeal !== 0) ||
        (!evaluation.styleSimilarity && evaluation.styleSimilarity !== 0) ||
        (!evaluation.technicalQuality && evaluation.technicalQuality !== 0)
      ) {
        return res.status(400).json({
          success: false,
          error:
            "Gemini Vision refused to evaluate the images or could not provide valid scores",
          reasoning: evaluation.reasoning,
        });
      }

      evaluation.visualAppeal = Math.max(
        0,
        Math.min(10, evaluation.visualAppeal)
      );
      evaluation.styleSimilarity = Math.max(
        0,
        Math.min(10, evaluation.styleSimilarity)
      );
      evaluation.technicalQuality = Math.max(
        0,
        Math.min(10, evaluation.technicalQuality)
      );

      const result = {
        success: true,
        evaluation: {
          visualAppeal: evaluation.visualAppeal,
          styleSimilarity: evaluation.styleSimilarity,
          technicalQuality: evaluation.technicalQuality,
          reasoning: evaluation.reasoning,
        },
        metadata: {
          model: "gemini-2.5-flash",
          timestamp: new Date().toISOString(),
        },
      };

      console.log(
        "✅ Gemini Vision evaluation completed (structured format):",
        {
          visualAppeal: result.evaluation.visualAppeal,
          styleSimilarity: result.evaluation.styleSimilarity,
          technicalQuality: result.evaluation.technicalQuality,
          model: result.metadata.model,
        }
      );
      res.json(result);
    }
  } catch (error) {
    console.error("❌ Gemini Vision evaluation error:", error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

// Batch Sample Evaluation endpoint
app.post("/api/evaluate-samples", async (req, res) => {
  try {
    const { samples, customPrompt } = req.body;

    if (!samples || samples.length === 0) {
      return res.status(400).json({
        error: "Missing required parameter: samples array",
      });
    }

    if (!process.env.OPENAI_API_KEY) {
      return res.status(500).json({ error: "OpenAI API key not configured" });
    }

    console.log(
      `🔍 Evaluating ${samples.length} samples with Gemini Vision...`
    );

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
                  text: evaluationPrompt,
                },
                {
                  type: "image_url",
                  image_url: {
                    url: sample.generatedImageUrl,
                    detail: "high",
                  },
                },
                {
                  type: "image_url",
                  image_url: {
                    url: sample.referenceImageUrl,
                    detail: "high",
                  },
                },
              ],
            },
          ],
          max_tokens: 300,
          temperature: 0.1,
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
          const visualAppealMatch = evaluationText.match(
            /visualAppeal["\s]*:[\s]*(\d+\.?\d*)/i
          );
          const styleSimilarityMatch = evaluationText.match(
            /styleSimilarity["\s]*:[\s]*(\d+\.?\d*)/i
          );
          const technicalQualityMatch = evaluationText.match(
            /technicalQuality["\s]*:[\s]*(\d+\.?\d*)/i
          );
          const scoreMatch = evaluationText.match(
            /score["\s]*:[\s]*(\d+\.?\d*)/i
          );

          evaluation = {
            visualAppeal: visualAppealMatch
              ? parseFloat(visualAppealMatch[1])
              : null,
            styleSimilarity: styleSimilarityMatch
              ? parseFloat(styleSimilarityMatch[1])
              : null,
            technicalQuality: technicalQualityMatch
              ? parseFloat(technicalQualityMatch[1])
              : null,
            score: scoreMatch ? parseFloat(scoreMatch[1]) : undefined,
            reasoning: evaluationText,
          };

          console.log(
            "🚨 Batch evaluation - Gemini Vision parsing failed for sample:"
          );
          console.log("📄 Full response:", evaluationText);
        }

        // Handle both structured and legacy score formats
        if (evaluation.score !== undefined) {
          // Legacy single score format
          const rawScore = evaluation.score;
          evaluation.score = Math.max(
            0.0,
            Math.min(10.0, parseFloat(rawScore))
          );

          if (rawScore < 0 || rawScore > 10) {
            console.log(
              `⚠️  Score ${rawScore} was out of range, clamped to ${evaluation.score}`
            );
          }

          results.push({
            sampleId: sample.id,
            score: evaluation.score,
            reasoning: evaluation.reasoning || "No reasoning provided",
            samplePair: {
              id: sample.id,
              generated: { url: sample.generatedImageUrl },
              reference: { url: sample.referenceImageUrl },
            },
          });
        } else {
          // New structured format
          // Skip this sample if GPT-4 refused to evaluate (null scores)
          if (
            (!evaluation.visualAppeal && evaluation.visualAppeal !== 0) ||
            (!evaluation.styleSimilarity && evaluation.styleSimilarity !== 0) ||
            (!evaluation.technicalQuality && evaluation.technicalQuality !== 0)
          ) {
            console.log(
              `⚠️  Skipping sample ${sample.id} - Gemini Vision refused to evaluate`
            );
            continue;
          }

          evaluation.visualAppeal = Math.max(
            0.0,
            Math.min(10.0, evaluation.visualAppeal)
          );
          evaluation.styleSimilarity = Math.max(
            0.0,
            Math.min(10.0, evaluation.styleSimilarity)
          );
          evaluation.technicalQuality = Math.max(
            0.0,
            Math.min(10.0, evaluation.technicalQuality)
          );

          results.push({
            sampleId: sample.id,
            visualAppeal: evaluation.visualAppeal,
            styleSimilarity: evaluation.styleSimilarity,
            technicalQuality: evaluation.technicalQuality,
            reasoning: evaluation.reasoning || "No reasoning provided",
            samplePair: {
              id: sample.id,
              generated: { url: sample.generatedImageUrl },
              reference: { url: sample.referenceImageUrl },
            },
          });
        }

        // Add small delay between requests
        await new Promise((resolve) => setTimeout(resolve, 500));
      } catch (sampleError) {
        console.error(`❌ Error evaluating sample ${sample.id}:`, sampleError);
        results.push({
          sampleId: sample.id,
          score: 5.0,
          reasoning: `Evaluation failed: ${sampleError.message}`,
          samplePair: {
            id: sample.id,
            generated: {
              url: sample.generatedImageUrl,
            },
            reference: {
              url: sample.referenceImageUrl,
            },
          },
        });
      }
    }

    console.log(`✅ Completed batch evaluation: ${results.length} results`);
    res.json({
      success: true,
      results: results,
      count: results.length,
    });
  } catch (error) {
    console.error("❌ Batch evaluation error:", error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

// Sample sets - will be moved to database later if needed
let sampleSets = [];
let nextSampleSetId = 1;

// Get saved evaluation prompts
app.get("/api/evaluation-prompts", async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("evaluation_prompts")
      .select("*")
      .order("created_at", { ascending: true });

    if (error) {
      console.error("❌ Error loading evaluation prompts:", error);
      return res.json({
        success: true,
        prompts: [], // Return empty array if table doesn't exist yet
      });
    }

    res.json({
      success: true,
      prompts: data || [],
    });
  } catch (err) {
    console.error("❌ Error fetching evaluation prompts:", err);
    res.json({
      success: true,
      prompts: [], // Fallback to empty array
    });
  }
});

// Save evaluation prompt
app.post("/api/evaluation-prompts", async (req, res) => {
  try {
    const { name, prompt, weights } = req.body;

    if (!name || !prompt) {
      return res.status(400).json({
        error: "Missing required parameters: name and prompt",
      });
    }

    const { data, error } = await supabase
      .from("evaluation_prompts")
      .insert([
        {
          name: name.trim(),
          prompt: prompt.trim(),
          weights: weights || null,
          created_at: new Date().toISOString(),
        },
      ])
      .select()
      .single();

    if (error) {
      console.error("❌ Error saving evaluation prompt:", error);
      return res.status(500).json({
        success: false,
        error: error.message,
      });
    }

    console.log(`💾 Saved evaluation prompt: "${name}"`);
    res.json({
      success: true,
      prompt: data,
    });
  } catch (error) {
    console.error("❌ Error saving prompt:", error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

// Delete evaluation prompt
app.delete("/api/evaluation-prompts/:id", async (req, res) => {
  try {
    const { id } = req.params;

    if (!id) {
      return res.status(400).json({
        error: "Missing prompt ID",
      });
    }

    const { error } = await supabase
      .from("evaluation_prompts")
      .delete()
      .eq("id", id);

    if (error) {
      console.error("❌ Error deleting evaluation prompt:", error);
      return res.status(500).json({
        success: false,
        error: error.message,
      });
    }

    console.log(`🗑️ Deleted evaluation prompt ID: ${id}`);
    res.json({
      success: true,
    });
  } catch (error) {
    console.error("❌ Error deleting prompt:", error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

// Image proxy endpoint to serve GCS images
app.get("/api/image-proxy", async (req, res) => {
  try {
    const { url } = req.query;
    if (!url) {
      return res.status(400).json({ error: "URL parameter required" });
    }

    // Parse GCS URL to extract bucket and file path
    const gcsMatch = url.match(/gs:\/\/([^\/]+)\/(.+)/);
    if (!gcsMatch) {
      return res.status(400).json({ error: "Invalid GCS URL format" });
    }

    const bucketName = gcsMatch[1];
    const filePath = gcsMatch[2];

    console.log(`🖼️ Proxying image: ${bucketName}/${filePath}`);

    // Download image from GCS
    const bucket = storageClient.bucket(bucketName);
    const file = bucket.file(filePath);

    const [exists] = await file.exists();
    if (!exists) {
      return res.status(404).json({ error: "Image not found" });
    }

    // Get file metadata to set proper content type
    const [metadata] = await file.getMetadata();
    const contentType = metadata.contentType || "image/jpeg";

    // Set appropriate headers
    res.set({
      "Content-Type": contentType,
      "Cache-Control": "public, max-age=86400", // Cache for 1 day
    });

    // Stream the file to the response
    const stream = file.createReadStream();
    stream.pipe(res);

    stream.on("error", (error) => {
      console.error("Error streaming image:", error);
      if (!res.headersSent) {
        res.status(500).json({ error: "Failed to stream image" });
      }
    });
  } catch (error) {
    console.error("Image proxy error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Get saved sample sets
app.get("/api/sample-sets", (req, res) => {
  res.json({
    success: true,
    sampleSets: sampleSets,
  });
});

// Get current working set from database
app.get("/api/current-samples", async (req, res) => {
  try {
    const { data: samples, error } = await supabase
      .from("current_working_samples")
      .select("*")
      .order("created_at", { ascending: true });

    if (error) {
      console.error("❌ Error fetching current samples:", error);
      return res.status(500).json({
        success: false,
        error: "Failed to fetch current samples",
      });
    }

    // Transform database format to frontend format
    const formattedSamples = samples.map((sample) => ({
      id: sample.id,
      generated: {
        url: sample.generated_image_url,
      },
      reference: {
        url: sample.reference_image_url,
      },
    }));

    res.json({
      success: true,
      samples: formattedSamples,
    });
  } catch (error) {
    console.error("❌ Error in current-samples endpoint:", error);
    res.status(500).json({
      success: false,
      error: "Failed to fetch current samples",
    });
  }
});

// Upload sample images to Supabase and add to current working set
app.post(
  "/api/upload-sample-images",
  upload.fields([
    { name: "generated", maxCount: 1 },
    { name: "reference", maxCount: 1 },
  ]),
  async (req, res) => {
    try {
      console.log("📤 Upload request received");
      console.log("Files:", req.files);
      console.log("Body:", req.body);

      if (!req.files || !req.files.generated || !req.files.reference) {
        console.log("❌ Missing files in request");
        return res.status(400).json({
          error: "Missing required files: generated and reference images",
          received: req.files ? Object.keys(req.files) : "no files",
        });
      }

      const generatedFile = req.files.generated[0];
      const referenceFile = req.files.reference[0];

      // Upload generated image to Supabase
      const generatedFileName = `evaluation_samples/generated_${Date.now()}_${Math.random()
        .toString(36)
        .substr(2, 9)}.${generatedFile.originalname.split(".").pop()}`;
      const { data: generatedUpload, error: generatedError } =
        await supabase.storage
          .from("generated-images")
          .upload(generatedFileName, generatedFile.buffer, {
            contentType: generatedFile.mimetype,
            cacheControl: "3600",
          });

      if (generatedError) {
        console.error("❌ Error uploading generated image:", generatedError);
        return res
          .status(500)
          .json({ error: "Failed to upload generated image" });
      }

      // Upload reference image to Supabase
      const referenceFileName = `evaluation_samples/reference_${Date.now()}_${Math.random()
        .toString(36)
        .substr(2, 9)}.${referenceFile.originalname.split(".").pop()}`;
      const { data: referenceUpload, error: referenceError } =
        await supabase.storage
          .from("generated-images")
          .upload(referenceFileName, referenceFile.buffer, {
            contentType: referenceFile.mimetype,
            cacheControl: "3600",
          });

      if (referenceError) {
        console.error("❌ Error uploading reference image:", referenceError);
        return res
          .status(500)
          .json({ error: "Failed to upload reference image" });
      }

      // Create public URLs
      const generatedUrl = `${process.env.SUPABASE_URL}/storage/v1/object/public/generated-images/${generatedUpload.path}`;
      const referenceUrl = `${process.env.SUPABASE_URL}/storage/v1/object/public/generated-images/${referenceUpload.path}`;

      // Add sample to database
      const { data: newSample, error: insertError } = await supabase
        .from("current_working_samples")
        .insert({
          generated_image_url: generatedUrl,
          reference_image_url: referenceUrl,
        })
        .select()
        .single();

      if (insertError) {
        console.error("❌ Error saving sample to database:", insertError);
        return res
          .status(500)
          .json({ error: "Failed to save sample to database" });
      }

      // Get current count for response
      const { count } = await supabase
        .from("current_working_samples")
        .select("*", { count: "exact", head: true });

      console.log(`📝 Uploaded and added sample to database (${count} total)`);
      res.json({
        success: true,
        sample: newSample,
        generatedUrl: generatedUrl,
        referenceUrl: referenceUrl,
        totalSamples: count,
      });
    } catch (error) {
      console.error("❌ Error uploading sample images:", error);
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  }
);

// Multer error handling middleware
app.use((error, req, res, next) => {
  if (error instanceof multer.MulterError) {
    console.error("❌ Multer error:", error.message);
    return res.status(400).json({
      error: `File upload error: ${error.message}`,
      code: error.code,
    });
  }
  next(error);
});

// Clear current working set
app.delete("/api/current-samples", async (req, res) => {
  try {
    const { error } = await supabase
      .from("current_working_samples")
      .delete()
      .neq("id", 0); // Delete all rows

    if (error) {
      console.error("❌ Error clearing current samples:", error);
      return res.status(500).json({
        success: false,
        error: "Failed to clear current samples",
      });
    }

    console.log("🗑️ Cleared current working set from database");
    res.json({
      success: true,
      message: "Working set cleared",
    });
  } catch (error) {
    console.error("❌ Error in clear samples endpoint:", error);
    res.status(500).json({
      success: false,
      error: "Failed to clear current samples",
    });
  }
});

// Save current working set as named sample set
app.post("/api/sample-sets", (req, res) => {
  try {
    const { name } = req.body;

    if (!name || !name.trim()) {
      return res.status(400).json({
        error: "Missing required parameter: name",
      });
    }

    if (currentWorkingSet.length === 0) {
      return res.status(400).json({
        error: "No samples in current working set to save",
      });
    }

    const newSampleSet = {
      id: nextSampleSetId++,
      name: name.trim(),
      samples: [...currentWorkingSet], // Copy the current working set
      createdAt: new Date().toISOString(),
    };

    sampleSets.push(newSampleSet);

    console.log(
      `💾 Saved sample set: "${name}" with ${currentWorkingSet.length} samples`
    );
    res.json({
      success: true,
      sampleSet: newSampleSet,
    });
  } catch (error) {
    console.error("❌ Error saving sample set:", error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

// Load saved sample set to current working set
app.post("/api/sample-sets/:id/load", (req, res) => {
  try {
    const sampleSetId = parseInt(req.params.id);
    const sampleSet = sampleSets.find((set) => set.id === sampleSetId);

    if (!sampleSet) {
      return res.status(404).json({
        error: "Sample set not found",
      });
    }

    currentWorkingSet = [...sampleSet.samples]; // Copy samples to working set

    console.log(
      `📂 Loaded sample set "${sampleSet.name}" to working set (${currentWorkingSet.length} samples)`
    );
    res.json({
      success: true,
      message: `Loaded "${sampleSet.name}" to working set`,
      sampleCount: currentWorkingSet.length,
    });
  } catch (error) {
    console.error("❌ Error loading sample set:", error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

// Generate Prompt Variations endpoint
app.post("/api/generate-prompt-variations", async (req, res) => {
  try {
    const { basePrompts, variationStrength = 0.3, count = 10 } = req.body;

    if (!basePrompts || basePrompts.length === 0) {
      return res
        .status(400)
        .json({ error: "Missing required parameter: basePrompts" });
    }

    if (!process.env.OPENAI_API_KEY) {
      return res.status(500).json({ error: "OpenAI API key not configured" });
    }

    const response = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        {
          role: "user",
          content: `Generate ${count} creative variations of these pet photography prompts:\n\n${basePrompts.join(
            "\n"
          )}\n\nVariation strength: ${variationStrength} (0=minimal changes, 1=major changes)\n\nReturn ONLY a JSON array of strings, no other text.`,
        },
      ],
      max_tokens: 500,
      temperature: 0.8,
    });

    const content = response.choices[0]?.message?.content;
    if (!content) {
      throw new Error("No response from OpenAI");
    }

    try {
      const variations = JSON.parse(content);
      res.json({ variations });
    } catch (parseError) {
      // Fallback to base prompts with simple modifications
      const fallbackVariations = basePrompts
        .flatMap((prompt) => [
          `${prompt} with enhanced lighting`,
          `${prompt} in artistic style`,
          `${prompt} with vibrant colors`,
        ])
        .slice(0, count);
      res.json({ variations: fallbackVariations });
    }
  } catch (error) {
    console.error("Prompt variation generation error:", error);
    res.status(500).json({ error: error.message });
  }
});

// Generate Evolutionary Prompts endpoint
app.post("/api/generate-evolutionary-prompts", async (req, res) => {
  try {
    const {
      parentPrompts,
      keepTopPercent = 0.2,
      mutationRate = 0.1,
      count = 10,
    } = req.body;

    if (!parentPrompts || parentPrompts.length === 0) {
      return res
        .status(400)
        .json({ error: "Missing required parameter: parentPrompts" });
    }

    if (!process.env.OPENAI_API_KEY) {
      return res.status(500).json({ error: "OpenAI API key not configured" });
    }

    const response = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        {
          role: "user",
          content: `Using evolutionary algorithm principles, evolve these successful pet photography prompts:\n\n${parentPrompts.join(
            "\n"
          )}\n\nGenerate ${count} evolved prompts that:\n- Keep the best elements from parent prompts\n- Introduce mutations (mutation rate: ${mutationRate})\n- Create diverse offspring\n\nReturn ONLY a JSON array of strings, no other text.`,
        },
      ],
      max_tokens: 600,
      temperature: 0.9,
    });

    const content = response.choices[0]?.message?.content;
    if (!content) {
      throw new Error("No response from OpenAI");
    }

    try {
      const prompts = JSON.parse(content);
      res.json({ prompts });
    } catch (parseError) {
      // Fallback to combining parent prompts
      const fallbackPrompts = [];
      for (let i = 0; i < count; i++) {
        const prompt1 =
          parentPrompts[Math.floor(Math.random() * parentPrompts.length)];
        const prompt2 =
          parentPrompts[Math.floor(Math.random() * parentPrompts.length)];
        fallbackPrompts.push(
          `${prompt1} evolved with elements from ${prompt2}`
        );
      }
      res.json({ prompts: fallbackPrompts });
    }
  } catch (error) {
    console.error("Evolutionary prompt generation error:", error);
    res.status(500).json({ error: error.message });
  }
});

// Generate Random Prompts endpoint
app.post("/api/generate-random-prompts", async (req, res) => {
  try {
    const { count = 10, category = "pet_photography" } = req.body;

    if (!process.env.OPENAI_API_KEY) {
      return res.status(500).json({ error: "OpenAI API key not configured" });
    }

    const response = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        {
          role: "user",
          content: `Generate ${count} creative and diverse pet photography prompts for AI image generation. Focus on different styles, moods, settings, and artistic approaches. Make them specific and inspiring.\n\nReturn ONLY a JSON array of strings, no other text.`,
        },
      ],
      max_tokens: 400,
      temperature: 1.0,
    });

    const content = response.choices[0]?.message?.content;
    if (!content) {
      throw new Error("No response from OpenAI");
    }

    try {
      const prompts = JSON.parse(content);
      res.json({ prompts });
    } catch (parseError) {
      // Fallback to predefined prompts
      const fallbackPrompts = [
        "Adorable pet in golden hour lighting with soft bokeh background",
        "Professional studio portrait of pet with dramatic lighting",
        "Playful pet in natural outdoor setting with vibrant colors",
        "Elegant pet portrait in black and white photography style",
        "Cute pet in cozy home environment with warm lighting",
        "Artistic pet photo with creative composition and unique angle",
        "Pet in beautiful garden setting with flowers and natural light",
        "Candid moment of happy pet with joyful expression",
      ];
      res.json({ prompts: fallbackPrompts.slice(0, count) });
    }
  } catch (error) {
    console.error("Random prompt generation error:", error);
    res.status(500).json({ error: error.message });
  }
});

// Generate Chain Prompts endpoint
app.post("/api/generate-chain-prompts", async (req, res) => {
  try {
    const { basePrompts, iteration, config } = req.body;

    if (!basePrompts || basePrompts.length === 0) {
      return res
        .status(400)
        .json({ error: "Missing required parameter: basePrompts" });
    }

    if (!process.env.OPENAI_API_KEY) {
      return res.status(500).json({ error: "OpenAI API key not configured" });
    }

    const response = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        {
          role: "user",
          content: `This is iteration ${iteration} of an iterative improvement process. Build upon these successful prompts from previous iterations:\n\n${basePrompts.join(
            "\n"
          )}\n\nGenerate improved prompts that:\n- Enhance the successful elements\n- Add refinements based on iteration progress\n- Maintain the core appeal while improving quality\n\nReturn ONLY a JSON array of strings, no other text.`,
        },
      ],
      max_tokens: 500,
      temperature: 0.7,
    });

    const content = response.choices[0]?.message?.content;
    if (!content) {
      throw new Error("No response from OpenAI");
    }

    try {
      const prompts = JSON.parse(content);
      res.json({ prompts });
    } catch (parseError) {
      // Fallback to enhanced versions of base prompts
      const enhancements = [
        "refined",
        "enhanced",
        "improved",
        "polished",
        "optimized",
      ];
      const enhancedPrompts = basePrompts.map((prompt) => {
        const enhancement =
          enhancements[Math.floor(Math.random() * enhancements.length)];
        return `${prompt} (${enhancement} for iteration ${iteration})`;
      });
      res.json({ prompts: enhancedPrompts });
    }
  } catch (error) {
    console.error("Chain prompt generation error:", error);
    res.status(500).json({ error: error.message });
  }
});

// Training Sample Generation Endpoints

// Get customers with single uploaded images
app.get("/api/prod/customers", async (req, res) => {
  try {
    console.log("🔍 Scanning production storage for single-image customers...");

    // List all customer folders in product-images bucket
    const { data: customerFolders, error: listError } =
      await prodSupabase.storage
        .from("product-images")
        .list("", { limit: 1000 });

    if (listError) {
      console.error("❌ Error listing customer folders:", listError);
      return res.status(500).json({ error: "Failed to list customer folders" });
    }

    const singleImageCustomers = [];

    // Check each customer folder for uploaded images
    for (const folder of customerFolders) {
      if (!folder.name || folder.name === ".emptyFolderPlaceholder") continue;

      try {
        // Check if uploaded folder exists and count images
        const { data: uploadedFiles, error: uploadError } =
          await prodSupabase.storage
            .from("product-images")
            .list(`${folder.name}/uploaded`, { limit: 10 });

        if (!uploadError && uploadedFiles) {
          // Filter out folder placeholders and count actual image files
          const imageFiles = uploadedFiles.filter(
            (file) =>
              file.name &&
              !file.name.includes(".emptyFolderPlaceholder") &&
              /\.(jpg|jpeg|png|webp)$/i.test(file.name)
          );

          if (imageFiles.length === 1) {
            singleImageCustomers.push({
              customerId: folder.name,
              uploadedImage: imageFiles[0].name,
              uploadedAt: imageFiles[0].created_at,
            });
          }
        }
      } catch (error) {
        console.log(`⚠️  Skipping customer ${folder.name}: ${error.message}`);
      }
    }

    console.log(
      `✅ Found ${singleImageCustomers.length} customers with single uploaded images`
    );

    res.json({
      success: true,
      customers: singleImageCustomers,
      totalCount: singleImageCustomers.length,
    });
  } catch (error) {
    console.error("❌ Error scanning customers:", error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

// Get available product types
app.get("/api/prod/products", async (req, res) => {
  try {
    console.log("🔍 Scanning for available product types...");

    // Get a sample customer to see what product folders exist
    const { data: customerFolders, error: listError } =
      await prodSupabase.storage.from("product-images").list("", { limit: 10 });

    if (listError) {
      return res.status(500).json({ error: "Failed to list customer folders" });
    }

    const productTypes = new Set();

    // Check first few customers to find available product types
    for (const folder of customerFolders.slice(0, 5)) {
      if (!folder.name || folder.name === ".emptyFolderPlaceholder") continue;

      try {
        const { data: subFolders, error } = await prodSupabase.storage
          .from("product-images")
          .list(folder.name, { limit: 20 });

        if (!error && subFolders) {
          subFolders.forEach((subFolder) => {
            if (
              subFolder.name &&
              subFolder.name !== "uploaded" &&
              !subFolder.name.includes(".emptyFolderPlaceholder")
            ) {
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
      products: products,
    });
  } catch (error) {
    console.error("❌ Error scanning products:", error);
    res.status(500).json({
      success: false,
      error: error.message,
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
        reason: "Missing required parameters",
      });
    }

    console.log(
      `🔍 Validating customer ${customerId} for product ${productType}`
    );

    // Check uploaded folder - should have exactly 1 image
    const { data: uploadedFiles, error: uploadedError } =
      await prodSupabase.storage
        .from("product-images")
        .list(`${customerId}/uploaded`);

    if (uploadedError) {
      console.log(
        `❌ Error checking uploaded folder for ${customerId}:`,
        uploadedError
      );
      return res.json({
        success: false,
        reason: `Uploaded folder error: ${uploadedError.message}`,
      });
    }

    // Filter to actual image files
    const uploadedImageFiles =
      uploadedFiles &&
      uploadedFiles.filter(
        (file) =>
          file.name &&
          !file.name.includes(".emptyFolderPlaceholder") &&
          /\.(jpg|jpeg|png|webp)$/i.test(file.name)
      );

    if (!uploadedImageFiles || uploadedImageFiles.length === 0) {
      console.log(`❌ No uploaded images found for customer ${customerId}`);
      return res.json({
        success: false,
        reason: "No uploaded images found",
      });
    }

    if (uploadedImageFiles.length > 1) {
      console.log(
        `❌ Customer ${customerId} has ${uploadedImageFiles.length} uploaded images, should have exactly 1`
      );
      return res.json({
        success: false,
        reason: `Customer has ${uploadedImageFiles.length} uploaded images, expected 1`,
      });
    }

    // Use the single uploaded image
    const actualUploadedImage = uploadedImageFiles[0].name;
    console.log(
      `📋 Customer ${customerId} has uploaded image: ${actualUploadedImage}`
    );

    // Check if generated image exists by listing the product folder
    const { data: generatedFiles, error: generatedError } =
      await prodSupabase.storage
        .from("product-images")
        .list(`${customerId}/${productType}`);

    if (generatedError) {
      console.log(
        `❌ Error checking generated folder for ${customerId}/${productType}:`,
        generatedError
      );
      return res.json({
        success: false,
        reason: `Generated folder error: ${generatedError.message}`,
      });
    }

    // Check if there's at least one generated image (any filename is fine)
    const imageFiles =
      generatedFiles &&
      generatedFiles.filter(
        (file) =>
          file.name &&
          !file.name.includes(".emptyFolderPlaceholder") &&
          /\.(jpg|jpeg|png|webp)$/i.test(file.name)
      );

    if (!imageFiles || imageFiles.length === 0) {
      console.log(
        `❌ No generated images found in ${customerId}/${productType}`
      );
      console.log(
        `📝 Available files in ${customerId}/${productType}:`,
        generatedFiles?.map((f) => f.name) || []
      );
      return res.json({
        success: false,
        reason: `No generated images found in ${productType} folder`,
      });
    }

    // Use the first available generated image
    const generatedImageName = imageFiles[0].name;
    console.log(
      `✅ Found uploaded image: ${actualUploadedImage} and generated image: ${generatedImageName} for customer ${customerId}`
    );

    // If both exist, generate the public URLs
    const uploadedPath = `${customerId}/uploaded/${actualUploadedImage}`;
    const generatedPath = `${customerId}/${productType}/${generatedImageName}`;

    const { data: uploadedUrl } = prodSupabase.storage
      .from("product-images")
      .getPublicUrl(uploadedPath);

    const { data: generatedUrl } = prodSupabase.storage
      .from("product-images")
      .getPublicUrl(generatedPath);

    res.json({
      success: true,
      uploadedImageUrl: uploadedUrl.publicUrl,
      generatedImageUrl: generatedUrl.publicUrl,
      customerId,
      productType,
    });
  } catch (error) {
    console.error("❌ Error validating customer:", error);
    res.status(500).json({
      success: false,
      reason: error.message,
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
        error: "Missing required parameters: productType and customers",
      });
    }

    console.log(
      `🚀 Starting training sample generation for ${customers.length} customers with product: ${productType}`
    );

    const results = [];
    const errors = [];

    // Process customers in batches
    for (let i = 0; i < customers.length; i++) {
      const customer = customers[i];

      try {
        console.log(
          `📥 Processing customer ${i + 1}/${customers.length}: ${
            customer.customerId
          }`
        );

        // Download uploaded image from production
        const uploadedPath = `${customer.customerId}/uploaded/${customer.uploadedImage}`;
        const { data: uploadedImageData, error: uploadedError } =
          await prodSupabase.storage
            .from("product-images")
            .download(uploadedPath);

        if (uploadedError) {
          throw new Error(
            `Failed to download uploaded image: ${uploadedError.message}`
          );
        }

        // Find and download product image
        const { data: productFiles, error: productListError } =
          await prodSupabase.storage
            .from("product-images")
            .list(`${customer.customerId}/${productType}`, { limit: 10 });

        if (productListError || !productFiles || productFiles.length === 0) {
          throw new Error(`No product images found for ${productType}`);
        }

        // Get the first product image (or you could add logic to select specific ones)
        const productImage = productFiles.find(
          (file) => file.name && /\.(jpg|jpeg|png|webp)$/i.test(file.name)
        );

        if (!productImage) {
          throw new Error(`No valid product image found for ${productType}`);
        }

        const productPath = `${customer.customerId}/${productType}/${productImage.name}`;
        const { data: productImageData, error: productError } =
          await prodSupabase.storage
            .from("product-images")
            .download(productPath);

        if (productError) {
          throw new Error(
            `Failed to download product image: ${productError.message}`
          );
        }

        // Upload images to local Supabase storage
        const timestamp = Date.now();
        const uploadedFileName = `training_samples/uploaded_${
          customer.customerId
        }_${timestamp}.${customer.uploadedImage.split(".").pop()}`;
        const productFileName = `training_samples/generated_${
          customer.customerId
        }_${productType}_${timestamp}.${productImage.name.split(".").pop()}`;

        // Upload uploaded image
        const { data: uploadedUpload, error: uploadedUploadError } =
          await supabase.storage
            .from("generated-images")
            .upload(uploadedFileName, uploadedImageData, {
              contentType: `image/${customer.uploadedImage.split(".").pop()}`,
              cacheControl: "3600",
            });

        if (uploadedUploadError) {
          throw new Error(
            `Failed to upload uploaded image: ${uploadedUploadError.message}`
          );
        }

        // Upload product image
        const { data: productUpload, error: productUploadError } =
          await supabase.storage
            .from("generated-images")
            .upload(productFileName, productImageData, {
              contentType: `image/${productImage.name.split(".").pop()}`,
              cacheControl: "3600",
            });

        if (productUploadError) {
          throw new Error(
            `Failed to upload product image: ${productUploadError.message}`
          );
        }

        // Create public URLs
        const uploadedUrl = `${process.env.SUPABASE_URL}/storage/v1/object/public/generated-images/${uploadedUpload.path}`;
        const productUrl = `${process.env.SUPABASE_URL}/storage/v1/object/public/generated-images/${productUpload.path}`;

        // Save to training samples database
        const { data: trainingSample, error: dbError } = await supabase
          .from("training_samples")
          .insert({
            customer_id: customer.customerId,
            product_type: productType,
            uploaded_image_url: uploadedUrl,
            generated_image_url: productUrl,
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
          productUrl,
        });

        console.log(
          `✅ Successfully processed customer ${customer.customerId}`
        );
      } catch (error) {
        console.error(
          `❌ Error processing customer ${customer.customerId}:`,
          error
        );
        errors.push({
          customerId: customer.customerId,
          error: error.message,
        });

        results.push({
          customerId: customer.customerId,
          success: false,
          error: error.message,
        });
      }

      // Add small delay to avoid overwhelming the API
      await new Promise((resolve) => setTimeout(resolve, 200));
    }

    console.log(
      `🎉 Training sample generation complete: ${
        results.filter((r) => r.success).length
      } successful, ${errors.length} failed`
    );

    res.json({
      success: true,
      results,
      summary: {
        total: customers.length,
        successful: results.filter((r) => r.success).length,
        failed: errors.length,
        productType,
      },
    });
  } catch (error) {
    console.error("❌ Training sample generation error:", error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

// Get training samples
app.get("/api/training/samples", async (req, res) => {
  try {
    const { data: samples, error } = await supabase
      .from("training_samples")
      .select("*")
      .order("created_at", { ascending: false });

    if (error) {
      return res.status(500).json({
        success: false,
        error: "Failed to fetch training samples",
      });
    }

    res.json({
      success: true,
      samples: samples || [],
      count: samples?.length || 0,
    });
  } catch (error) {
    console.error("❌ Error fetching training samples:", error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

// Vertex AI Prompt Optimizer Endpoints
// Submit prompt optimization job to Google Cloud Vertex AI
app.post("/api/vertex-ai/optimize", async (req, res) => {
  console.log("🎯 Vertex AI Prompt Optimizer job submission received");

  try {
    const {
      trainingDataSet,
      basePrompts,
      optimizationMode = "data-driven",
      targetModel = "gemini-2.5-flash",
      evaluationMetrics = ["bleu", "rouge"],
    } = req.body;

    if (!trainingDataSet || !basePrompts || basePrompts.length === 0) {
      return res.status(400).json({
        error: "Missing required parameters",
        details: "trainingDataSet and basePrompts are required",
      });
    }

    console.log(`📊 Training Data Set: ${trainingDataSet}`);
    console.log(`📝 Base Prompts: ${basePrompts.length} prompts`);
    console.log(`⚙️ Optimization Mode: ${optimizationMode}`);
    console.log(`🎯 Target Model: ${targetModel}`);

    // Step 1: Format training data as JSONL inline
    console.log("📋 Formatting training data...");

    if (!trainingDataSet) {
      throw new Error("Training data set is required");
    }

    console.log(`📊 Fetching samples for data set: ${trainingDataSet}`);

    const { data: trainingSamples, error } = await supabase
      .from("training_samples")
      .select("id, uploaded_image_url, openai_image_url, data_set_name")
      .eq("data_set_name", trainingDataSet)
      .order("created_at", { ascending: true });

    if (error) {
      throw new Error(`Failed to fetch training samples: ${error.message}`);
    }

    if (!trainingSamples || trainingSamples.length === 0) {
      throw new Error(
        `No training samples found for data set: ${trainingDataSet}`
      );
    }

    console.log(`📄 Found ${trainingSamples.length} training samples`);

    // Generate descriptions for all images in parallel and format for Vertex AI Prompt Optimizer JSONL
    console.log(
      "🔍 Generating detailed descriptions for training images in parallel..."
    );

    const descriptionPromises = trainingSamples.map(async (sample) => {
      try {
        // Generate descriptions for both source and reference images in parallel
        const [sourceDescription, referenceDescription] = await Promise.all([
          generateImageDescription(sample.uploaded_image_url, "source"),
          generateImageDescription(sample.openai_image_url, "reference"),
        ]);

        console.log(`✅ Processed sample ${sample.id}`);
        return {
          input: `${sample.uploaded_image_url},${sourceDescription}`,
          target: `${sample.openai_image_url},${referenceDescription}`,
          unique_id: `${Date.now()}_${Math.random()
            .toString(36)
            .substr(2, 9)}_sample_${sample.id}`,
        };
      } catch (error) {
        console.error(`❌ Failed to process sample ${sample.id}:`, error);
        return null; // Will be filtered out
      }
    });

    // Wait for all descriptions to complete
    const results = await Promise.all(descriptionPromises);
    const formattedSamples = results.filter((sample) => sample !== null);

    console.log(
      `📋 Successfully formatted ${formattedSamples.length} training samples with descriptions`
    );
    const jsonlData = formattedSamples
      .map((sample) => JSON.stringify(sample))
      .join("\n");

    // Step 2: Upload training data and config to Cloud Storage
    console.log("☁️ Uploading training data and config to Cloud Storage...");
    const bucketName = `vertex-ai-optimizer-${projectId}`;
    const fileName = `training-data-${Date.now()}.jsonl`;
    const configFileName = `config-${Date.now()}.json`;

    try {
      // Create bucket if it doesn't exist
      await storageClient
        .createBucket(bucketName, {
          location: location,
        })
        .catch((error) => {
          if (error.code !== 5) {
            // Ignore "already exists" error
            console.warn("Bucket creation warning:", error.message);
          }
        });

      const bucket = storageClient.bucket(bucketName);

      // Upload JSONL training data
      const dataFile = bucket.file(fileName);
      await dataFile.save(jsonlData, {
        metadata: {
          contentType: "application/jsonl",
        },
      });

      const datasetUri = `gs://${bucketName}/${fileName}`;
      console.log(`📄 Training data uploaded: ${datasetUri}`);

      // Create correct Vertex AI Prompt Optimizer config from Google's specification
      const outputPath = `gs://${bucketName}/results-${Date.now()}`;

      const config = {
        project: projectId,
        target_model: targetModel, // "gemini-2.5-flash" or "gemini-2.5-pro"
        target_model_location: location, // "us-central1"
        input_data_path: datasetUri,
        output_path: outputPath,
        system_instruction: basePrompts[0],
        prompt_template:
          "You are an expert at writing image editing prompts. Your task is to create an editing instruction that would transform the input image (described as: {input}) to match the desired outcome (described as: {target}).\n\nCurrent image: {input}\nDesired result: {target}\n\nCreate a clear, direct image editing prompt that tells an AI how to modify the current image to achieve the desired result. Your output should be a specific instruction focusing on what changes to make to colors, lighting, style, composition, and visual elements. Write as if giving instructions to an image editing AI that can see the current image.",
        optimization_mode: "instruction",
        num_steps: 20,
        num_template_eval_per_step: 1,
        eval_metric: "custom_metric",
        custom_metric_name: "image_similarity_score",
        custom_metric_cloud_function_name: "evaluate-image-prompt",
        target_model_qps: 10.0,
        eval_qps: 10.0,
        thinking_budget: 0,
      };

      console.log(
        `📋 Correct config created:`,
        JSON.stringify(config, null, 2)
      );

      const configFile = bucket.file(configFileName);
      await configFile.save(JSON.stringify(config, null, 2), {
        metadata: {
          contentType: "application/json",
        },
      });

      const configUri = `gs://${bucketName}/${configFileName}`;
      console.log(`📄 Config uploaded: ${configUri}`);

      // Step 3: Submit Vertex AI Prompt Optimizer job
      console.log("🚀 Submitting to Vertex AI Prompt Optimizer...");
      console.log(`🔧 Using Project: ${projectId}`);
      console.log(`🔧 Using Location: ${location}`);

      // NOTE: Vertex AI Prompt Optimizer currently requires Python SDK
      // The Node.js SDK doesn't have direct support for Prompt Optimizer
      // We'll use the Training Custom Job API as a workaround

      const parent = `projects/${projectId}/locations/${location}`;
      console.log(`🔧 Parent resource: ${parent}`);

      const customJobSpec = {
        displayName: `prompt-optimization-${Date.now()}`,
        jobSpec: {
          workerPoolSpecs: [
            {
              machineSpec: {
                machineType: "n1-standard-4",
              },
              diskSpec: {
                bootDiskType: "pd-ssd",
                bootDiskSizeGb: 100,
              },
              containerSpec: {
                // Use Vertex AI Prompt Optimizer container image
                imageUri:
                  "us-docker.pkg.dev/vertex-ai-restricted/builtin-algorithm/apd:preview_v1_0",
                args: [`--config=${configUri}`],
              },
              replicaCount: 1,
            },
          ],
        },
      };

      const request = {
        parent,
        customJob: customJobSpec,
      };

      console.log("🔄 Creating custom training job for prompt optimization...");

      try {
        const [job] = await jobServiceClient.createCustomJob(request);
        const jobId = job.name.split("/").pop();

        console.log(`✅ Vertex AI optimization job created: ${jobId}`);

        // Store job in Supabase for persistence
        try {
          const jobRecord = {
            job_id: jobId,
            display_name: customJobSpec.displayName,
            training_data_set: trainingDataSet,
            base_prompts: basePrompts,
            optimization_mode: optimizationMode,
            target_model: targetModel,
            status: "submitted",
            vertex_job_name: job.name,
            vertex_job_state: job.state || "JOB_STATE_PENDING",
          };

          const { data: insertedJob, error: insertError } = await supabase
            .from("vertex_ai_jobs")
            .insert(jobRecord)
            .select()
            .single();

          if (insertError) {
            console.error("❌ Failed to store job in Supabase:", insertError);
          } else {
            console.log(`💾 Job stored in Supabase with ID: ${insertedJob.id}`);
          }
        } catch (supabaseError) {
          console.error("❌ Supabase job storage error:", supabaseError);
        }

        res.json({
          jobId: jobId,
          status: "submitted",
          trainingDataSet,
          basePrompts: basePrompts.length,
          optimizationMode,
          targetModel,
          evaluationMetrics,
          datasetUri,
          estimatedCompletionTime: "10-30 minutes",
          timestamp: new Date().toISOString(),
          message: "Job submitted successfully to Vertex AI",
        });
      } catch (vertexError) {
        console.error("❌ Vertex AI job creation error:", vertexError);
        throw new Error(
          `Vertex AI job creation failed: ${vertexError.message}`
        );
      }
    } catch (storageError) {
      console.error("❌ Cloud Storage error:", storageError);
      throw new Error(`Cloud Storage failed: ${storageError.message}`);
    }
  } catch (error) {
    console.error("❌ Vertex AI optimization job submission error:", error);
    res.status(500).json({
      error: "Optimization job submission failed",
      details: error.message,
      timestamp: new Date().toISOString(),
    });
  }
});

// Get all jobs from Supabase
app.get("/api/vertex-ai/jobs", async (req, res) => {
  console.log("📋 Getting all Vertex AI jobs from Supabase");

  try {
    const { data: jobs, error } = await supabase
      .from("vertex_ai_jobs")
      .select("*")
      .order("created_at", { ascending: false });

    if (error) {
      console.error("❌ Failed to fetch jobs from Supabase:", error);
      return res
        .status(500)
        .json({ error: "Failed to fetch jobs", details: error.message });
    }

    // Format jobs for UI - fetch totalSteps from GCS config for each job
    const formattedJobs = await Promise.all(
      jobs.map(async (job) => {
        let totalSteps = undefined;

        // Try to get totalSteps and currentStep from GCS config if we have a jobId
        let currentStep = 0;
        if (job.job_id) {
          try {
            const jobName = `projects/${projectId}/locations/${location}/customJobs/${job.job_id}`;
            const [vertexJob] = await jobServiceClient.getCustomJob({
              name: jobName,
            });

            const args =
              vertexJob.jobSpec?.workerPoolSpecs?.[0]?.containerSpec?.args ||
              [];
            const configArg = args.find((arg) =>
              arg.startsWith("--config=gs://")
            );

            if (configArg) {
              const configPath = configArg.replace("--config=", "");
              const gcsMatch = configPath.match(/^gs:\/\/([^\/]+)\/(.+)$/);
              if (gcsMatch) {
                const [, bucketName, fileName] = gcsMatch;
                const storageClient = new Storage();
                const file = storageClient.bucket(bucketName).file(fileName);
                const [configData] = await file.download();
                const config = JSON.parse(configData.toString());
                totalSteps = config.num_steps;

                // Check output directory for current step from templates.json
                const outputPath = config.output_path;
                if (outputPath) {
                  const outputMatch = outputPath.match(
                    /^gs:\/\/([^\/]+)\/(.+)$/
                  );
                  if (outputMatch) {
                    const [, outputBucket, outputPrefix] = outputMatch;
                    try {
                      const bucket = storageClient.bucket(outputBucket);
                      const [files] = await bucket.getFiles({
                        prefix: outputPrefix,
                      });

                      const templatesFile = files.find((f) =>
                        f.name.endsWith("templates.json")
                      );
                      if (templatesFile) {
                        try {
                          const [templatesData] =
                            await templatesFile.download();
                          const templates = JSON.parse(
                            templatesData.toString()
                          );
                          currentStep =
                            templates.length > 0
                              ? Math.max(...templates.map((t) => t.step))
                              : 0;
                        } catch (e) {
                          // Silent fail for templates.json parsing
                        }
                      }
                    } catch (e) {
                      // Silent fail for output directory check
                    }
                  }
                }
              }
            }
          } catch (e) {
            console.log(
              `⚠️ Could not fetch config for job ${job.job_id}: ${e.message}`
            );
          }
        }

        return {
          jobId: job.job_id,
          status: job.status,
          progress: job.progress,
          message: job.message,
          trainingDataSet: job.training_data_set,
          basePrompts: Array.isArray(job.base_prompts)
            ? job.base_prompts.length
            : 1,
          optimizationMode: job.optimization_mode,
          targetModel: job.target_model,
          submittedAt: new Date(job.created_at).toLocaleString(),
          lastChecked: job.updated_at
            ? new Date(job.updated_at).toLocaleString()
            : null,
          startedAt: job.started_at
            ? new Date(job.started_at).toLocaleString()
            : null,
          completedAt: job.completed_at
            ? new Date(job.completed_at).toLocaleString()
            : null,
          totalSteps: totalSteps,
          currentStep: currentStep,
        };
      })
    );

    console.log(`📊 Retrieved ${formattedJobs.length} jobs from Supabase`);
    res.json({ jobs: formattedJobs });
  } catch (err) {
    console.error("❌ Error fetching jobs:", err);
    res
      .status(500)
      .json({ error: "Internal server error", details: err.message });
  }
});

// Get optimization job status
app.get("/api/vertex-ai/jobs/:jobId", async (req, res) => {
  console.log("📊 Vertex AI job status check received");

  try {
    const { jobId } = req.params;

    console.log(`🔍 Checking status for job: ${jobId}`);

    // Query Vertex AI for job status
    const jobName = `projects/${projectId}/locations/${location}/customJobs/${jobId}`;

    try {
      const [job] = await jobServiceClient.getCustomJob({ name: jobName });

      // Extract and log config from GCS
      let totalSteps;
      let currentStep = 0;
      try {
        const args =
          job.jobSpec?.workerPoolSpecs?.[0]?.containerSpec?.args || [];
        const configArg = args.find((arg) => arg.startsWith("--config=gs://"));

        if (configArg) {
          const configPath = configArg.replace("--config=", "");

          // Parse GCS path: gs://bucket/path
          const gcsMatch = configPath.match(/^gs:\/\/([^\/]+)\/(.+)$/);
          if (gcsMatch) {
            const [, bucketName, fileName] = gcsMatch;

            // Fetch config from Google Cloud Storage
            const storageClient = new Storage();

            const file = storageClient.bucket(bucketName).file(fileName);
            const [configData] = await file.download();
            const config = JSON.parse(configData.toString());

            totalSteps = config.num_steps;

            // Check output directory for step progress files
            const outputPath = config.output_path;
            if (outputPath) {
              console.log(`🔍 Checking output directory: ${outputPath}`);

              const outputMatch = outputPath.match(/^gs:\/\/([^\/]+)\/(.+)$/);
              if (outputMatch) {
                const [, outputBucket, outputPrefix] = outputMatch;

                try {
                  const bucket = storageClient.bucket(outputBucket);
                  const [files] = await bucket.getFiles({
                    prefix: outputPrefix,
                  });

                  // Check templates.json for step information
                  const templatesFile = files.find((f) =>
                    f.name.endsWith("templates.json")
                  );
                  if (templatesFile) {
                    try {
                      const [templatesData] = await templatesFile.download();
                      const templates = JSON.parse(templatesData.toString());

                      // Get the current step count from the highest step number
                      currentStep =
                        templates.length > 0
                          ? Math.max(...templates.map((t) => t.step))
                          : 0;
                      console.log(`📊 Current step: ${currentStep}`);
                    } catch (e) {
                      console.log(
                        `⚠️ Could not read templates.json: ${e.message}`
                      );
                    }
                  }
                } catch (e) {
                  console.log(`⚠️ Could not list output files: ${e.message}`);
                }
              }
            }
          }
        }
      } catch (e) {
        console.log(`⚠️ Could not fetch config from GCS: ${e.message}`);
      }

      let status,
        progress = 0;

      // Map Vertex AI job states to our status
      switch (job.state) {
        case "JOB_STATE_QUEUED":
        case "JOB_STATE_PENDING":
          status = "queued";
          progress = 0;
          break;
        case "JOB_STATE_RUNNING":
          status = "running";
          // Estimate progress based on start time
          if (job.startTime) {
            const startTime = new Date(job.startTime.seconds * 1000);
            const elapsed = Date.now() - startTime.getTime();
            const estimated = 20 * 60 * 1000; // 20 minutes estimated
            progress = Math.min(Math.floor((elapsed / estimated) * 95), 95);
          } else {
            progress = 10;
          }
          break;
        case "JOB_STATE_SUCCEEDED":
          status = "completed";
          progress = 100;
          break;
        case "JOB_STATE_FAILED":
          status = "failed";
          progress = 0;
          break;
        case "JOB_STATE_CANCELLED":
          status = "cancelled";
          progress = 0;
          break;
        default:
          status = "unknown";
          progress = 0;
      }

      const response = {
        jobId,
        status,
        progress,
        currentStep,
        totalSteps,
        state: job.state,
        displayName: job.displayName,
        createTime: job.createTime,
        startTime: job.startTime,
        endTime: job.endTime,
        timestamp: new Date().toISOString(),
      };

      // Add error details if failed
      if (job.state === "JOB_STATE_FAILED") {
        response.error = {
          code: job.error?.code || "UNKNOWN",
          message: job.error?.message || "No error message available",
          details: job.error?.details || [],
        };

        // Add job logs and additional debugging info
        response.debugging = {
          jobSpec: job.jobSpec,
          startTime: job.startTime,
          endTime: job.endTime,
          labels: job.labels,
        };

        console.error(`❌ Job ${jobId} failed:`, {
          error: response.error,
          jobName: job.name,
          displayName: job.displayName,
        });
      }

      // Update job status in Supabase
      try {
        const updateData = {
          status,
          progress,
          vertex_job_state: job.state,
          updated_at: new Date().toISOString(),
        };

        if (job.startTime && !job.endTime) {
          updateData.started_at = new Date(
            job.startTime.seconds * 1000
          ).toISOString();
        }

        if (job.endTime) {
          updateData.completed_at = new Date(
            job.endTime.seconds * 1000
          ).toISOString();
        }

        if (job.state === "JOB_STATE_FAILED" && job.error) {
          updateData.message = `Failed: ${
            job.error.message || "Unknown error"
          }`;
        }

        const { error: updateError } = await supabase
          .from("vertex_ai_jobs")
          .update(updateData)
          .eq("job_id", jobId);

        if (updateError) {
          console.error("❌ Failed to update job in Supabase:", updateError);
        } else {
          console.log(
            `💾 Job ${jobId} updated in Supabase with status: ${status}`
          );
        }
      } catch (supabaseError) {
        console.error("❌ Supabase job update error:", supabaseError);
      }

      res.json(response);
    } catch (jobError) {
      if (jobError.code === 5) {
        // NOT_FOUND
        console.log(`❓ Job ${jobId} not found`);
        res.status(404).json({
          error: "Job not found",
          details: `Job ${jobId} does not exist`,
          timestamp: new Date().toISOString(),
        });
      } else {
        throw jobError;
      }
    }
  } catch (error) {
    console.error("❌ Vertex AI job status check error:", error);
    res.status(500).json({
      error: "Job status check failed",
      details: error.message,
      timestamp: new Date().toISOString(),
    });
  }
});

// Get detailed job logs and debugging information
app.get("/api/vertex-ai/jobs/:jobId/logs", async (req, res) => {
  console.log("🔍 Fetching detailed job logs");

  try {
    const { jobId } = req.params;
    const jobName = `projects/${projectId}/locations/${location}/customJobs/${jobId}`;

    try {
      const [job] = await jobServiceClient.getCustomJob({ name: jobName });

      // Return comprehensive job information
      const jobDetails = {
        jobId,
        name: job.name,
        displayName: job.displayName,
        state: job.state,
        createTime: job.createTime,
        startTime: job.startTime,
        endTime: job.endTime,
        updateTime: job.updateTime,
        error: job.error || null,
        jobSpec: job.jobSpec,
        labels: job.labels || {},
        encryptionSpec: job.encryptionSpec || null,
        webAccessUris: job.webAccessUris || {},
      };

      console.log("📋 Full job details:", JSON.stringify(jobDetails, null, 2));

      res.json({
        success: true,
        jobDetails,
        timestamp: new Date().toISOString(),
      });
    } catch (jobError) {
      if (jobError.code === 5) {
        // NOT_FOUND
        res.status(404).json({
          error: "Job not found",
          details: `Job ${jobId} does not exist`,
          timestamp: new Date().toISOString(),
        });
      } else {
        throw jobError;
      }
    }
  } catch (error) {
    console.error("❌ Failed to fetch job logs:", error);
    res.status(500).json({
      error: "Failed to fetch job logs",
      details: error.message,
      timestamp: new Date().toISOString(),
    });
  }
});

// Get optimization results
app.get("/api/vertex-ai/results/:jobId", async (req, res) => {
  console.log("📋 Vertex AI optimization results request received");

  try {
    const { jobId } = req.params;

    console.log(`📄 Getting results for job: ${jobId}`);

    // First, check if the job is completed in our database
    const { data: jobData, error: jobError } = await supabase
      .from("vertex_ai_jobs")
      .select("*")
      .eq("job_id", jobId)
      .single();

    if (jobError) {
      console.error("❌ Failed to fetch job from Supabase:", jobError);
      return res
        .status(404)
        .json({ error: "Job not found", details: jobError.message });
    }

    if (jobData.status !== "completed") {
      return res.status(400).json({
        error: "Job not completed",
        status: jobData.status,
        message: "Job must be completed before results can be retrieved",
      });
    }

    // Clear cached results and always re-fetch from Cloud Storage for debugging
    // TODO: Re-enable caching once results parsing is working correctly
    console.log(
      `🔄 Re-fetching results from Cloud Storage for job: ${jobId} (caching disabled for debugging)`
    );

    // Uncomment below to use cached results:
    // if (jobData.optimized_prompts) {
    //   console.log(`📋 Returning cached results for job: ${jobId}`);
    //   return res.json({
    //     jobId,
    //     status: 'completed',
    //     originalPrompts: jobData.base_prompts,
    //     optimizedPrompts: jobData.optimized_prompts,
    //     performanceMetrics: jobData.performance_metrics || {
    //       averageImprovement: "Unknown",
    //       bleuScore: 0,
    //       rougeScore: 0
    //     },
    //     completedAt: jobData.completed_at,
    //   });
    // }

    // Try to fetch results from Vertex AI job output locations
    try {
      console.log(`📥 Fetching optimization results for job: ${jobId}`);

      const bucketName = `vertex-ai-optimizer-${projectId}`;

      // List all results directories to find the matching one
      const bucket = storageClient.bucket(bucketName);
      const [files] = await bucket.getFiles({ prefix: "results-" });

      let foundResults = null;
      let resultTimestamp = null;

      // Get job creation time from database to match with results
      const jobCreatedTime = new Date(jobData.created_at).getTime();
      console.log(
        `🕐 Job ${jobId} created at: ${jobData.created_at} (${jobCreatedTime})`
      );

      // Look for results directories and find one that matches this job by timestamp
      let bestMatch = null;
      let smallestTimeDiff = Infinity;

      for (const file of files) {
        const fileName = file.name;

        // Check if this is an optimized_results.json file
        if (fileName.endsWith("/instruction/optimized_results.json")) {
          // Extract timestamp from path (results-{timestamp}/instruction/...)
          const timestampMatch = fileName.match(/results-(\d+)\//);
          if (timestampMatch) {
            const resultTimestamp = parseInt(timestampMatch[1]);
            const timeDiff = Math.abs(resultTimestamp - jobCreatedTime);

            console.log(
              `📊 Checking result timestamp ${resultTimestamp}, diff: ${timeDiff}ms`
            );

            // Find the closest match within 24 hours
            if (timeDiff < smallestTimeDiff && timeDiff < 24 * 60 * 60 * 1000) {
              smallestTimeDiff = timeDiff;
              bestMatch = { fileName, resultTimestamp };
            }
          }
        }
      }

      if (bestMatch) {
        const { fileName, resultTimestamp: matchedTimestamp } = bestMatch;
        console.log(
          `🎯 Best timestamp match for job ${jobId}: ${fileName} (diff: ${smallestTimeDiff}ms)`
        );

        // Process the matched results file
        try {
          console.log(`🔍 Processing matched file: ${fileName}`);
          const file = bucket.file(fileName);
          const [contents] = await file.download();
          const optimizedData = JSON.parse(contents.toString());

          // Also get the eval results for additional data
          const evalFileName = fileName.replace(
            "optimized_results.json",
            "eval_results.json"
          );
          const evalFile = bucket.file(evalFileName);
          const [evalExists] = await evalFile.exists();

          let evalData = null;
          if (evalExists) {
            const [evalContents] = await evalFile.download();
            evalData = JSON.parse(evalContents.toString());
          }

          resultTimestamp = matchedTimestamp;

          // Parse all optimization attempts and their results
          const optimizedPrompts = [];
          const allMetrics = {};

          // Start with the final optimized result
          optimizedPrompts.push({
            prompt: optimizedData.prompt,
            step: optimizedData.step || 0,
            confidenceScore:
              optimizedData.metrics?.["image_similarity_score/mean"] || 0,
            isOptimized: true,
            improvements: [
              "Final optimized version using Vertex AI",
              "Enhanced based on training data patterns",
              `Achieved ${(
                optimizedData.metrics?.["image_similarity_score/mean"] * 100 ||
                0
              ).toFixed(1)}% similarity score`,
            ],
          });

          // Parse evaluation data to get all attempted prompts and their scores
          if (evalData && Array.isArray(evalData)) {
            for (const evalSet of evalData) {
              if (evalSet.summary_results) {
                // Store overall metrics
                const setMetrics = evalSet.summary_results;
                for (const [key, value] of Object.entries(setMetrics)) {
                  if (key !== "row_count") {
                    allMetrics[key] = value;
                  }
                }
              }

              // Parse individual prompt attempts from metrics_table
              if (evalSet.metrics_table) {
                try {
                  const metricsTable = JSON.parse(evalSet.metrics_table);

                  // Group by unique prompts to see evolution
                  const promptAttempts = new Map();

                  for (const entry of metricsTable) {
                    const prompt = entry.prompt;
                    if (prompt && prompt !== optimizedData.prompt) {
                      // Don't duplicate the final optimized one

                      if (!promptAttempts.has(prompt)) {
                        promptAttempts.set(prompt, {
                          prompt: prompt,
                          scores: [],
                          samples: [],
                          avgScore: 0,
                          isOptimized: false,
                        });
                      }

                      const attempt = promptAttempts.get(prompt);
                      if (entry["image_similarity_score/score"] !== undefined) {
                        attempt.scores.push(
                          entry["image_similarity_score/score"]
                        );
                        attempt.samples.push({
                          input: entry.input,
                          unique_id: entry.unique_id,
                          response: entry.response,
                          score: entry["image_similarity_score/score"],
                        });
                      }
                    }
                  }

                  // Calculate averages and add to optimized prompts
                  for (const [prompt, data] of promptAttempts) {
                    if (data.scores.length > 0) {
                      data.avgScore =
                        data.scores.reduce((a, b) => a + b, 0) /
                        data.scores.length;
                      data.confidenceScore = data.avgScore;

                      optimizedPrompts.unshift({
                        // Add to beginning to show progression
                        ...data,
                        improvements: [
                          `Tested on ${data.samples.length} samples`,
                          `Average score: ${(data.avgScore * 100).toFixed(1)}%`,
                          "Intermediate optimization attempt",
                        ],
                      });
                    }
                  }
                } catch (parseError) {
                  console.warn(
                    `Warning: Could not parse metrics table: ${parseError.message}`
                  );
                }
              }
            }
          }

          // Sort intermediate attempts by timestamp and assign step numbers
          const intermediateAttempts = optimizedPrompts.filter(
            (p) => !p.isOptimized
          );
          console.log(
            `🔍 Found ${intermediateAttempts.length} intermediate attempts to sort`
          );

          // Get creation timestamps from optimizer_generations table and sort chronologically
          for (const attempt of intermediateAttempts) {
            const { data: generations, error } = await supabase
              .from("optimizer_generations")
              .select("created_at")
              .eq("prompt_used", attempt.prompt)
              .order("created_at", { ascending: true })
              .limit(1);

            if (!error && generations && generations.length > 0) {
              attempt.earliest_created_at = new Date(generations[0].created_at);
            } else {
              attempt.earliest_created_at = new Date(0); // Fallback to epoch
            }
          }

          // Sort by actual creation timestamp (earliest first)
          intermediateAttempts.sort((a, b) => {
            return (
              a.earliest_created_at.getTime() - b.earliest_created_at.getTime()
            );
          });

          // Assign step numbers in chronological order
          intermediateAttempts.forEach((prompt, index) => {
            prompt.step = index + 1; // Step 1, 2, 3...
          });

          // Sort prompts by step number (highest to lowest - latest first)
          optimizedPrompts.sort((a, b) => {
            return (b.step || 0) - (a.step || 0);
          });

          foundResults = {
            jobId,
            originalPrompts: jobData.base_prompts,
            optimizedPrompts,
            performanceMetrics: {
              imageSimilarityScore:
                optimizedData.metrics?.["image_similarity_score/mean"] || 0,
              evaluationSamples:
                evalData?.[0]?.summary_results?.row_count || "Unknown",
              ...allMetrics,
            },
            completedAt: new Date().toISOString(),
            resultTimestamp,
          };

          // Fetch generated images from Supabase optimizer_generations table for this optimization run
          try {
            console.log(
              `🔍 Fetching generated images from Supabase for optimization run...`
            );

            // Get the next job's creation time to set upper boundary
            const { data: nextJob, error: nextJobError } = await supabase
              .from("vertex_ai_jobs")
              .select("created_at")
              .gt("created_at", jobData.created_at)
              .order("created_at", { ascending: true })
              .limit(1);

            const windowStart = new Date(jobData.created_at);
            const windowEnd =
              nextJob?.length > 0
                ? new Date(nextJob[0].created_at)
                : new Date(); // Present time if this is the latest job

            console.log(
              `📅 Fetching images from ${windowStart.toISOString()} to ${windowEnd.toISOString()}`
            );

            const { data: generatedImages, error: imagesError } = await supabase
              .from("optimizer_generations")
              .select("*")
              .gte("created_at", windowStart.toISOString())
              .lt("created_at", windowEnd.toISOString())
              .order("created_at", { ascending: true });

            if (!imagesError && generatedImages && generatedImages.length > 0) {
              console.log(
                `📸 Found ${generatedImages.length} generated images for this optimization run`
              );

              // Process all image uploads in parallel
              console.log(
                `🚀 Processing ${generatedImages.length} images in parallel...`
              );
              const imageUploadPromises = generatedImages.map(async (img) => {
                const promptKey = img.prompt_used || "unknown";
                let supabaseImageUrl = img.generated_image_url; // fallback

                try {
                  if (
                    img.generated_image_url &&
                    img.generated_image_url.includes("storage.googleapis.com")
                  ) {
                    supabaseImageUrl = await uploadGCSImageToSupabase(
                      img.generated_image_url,
                      img.id
                    );

                    // Update the database record with the new Supabase URL for caching
                    try {
                      await supabase
                        .from("optimizer_generations")
                        .update({ generated_image_url: supabaseImageUrl })
                        .eq("id", img.id);
                      console.log(
                        `✅ Updated database record ${img.id} with Supabase URL`
                      );
                    } catch (updateError) {
                      console.warn(
                        `Warning: Failed to update database record ${img.id}: ${updateError.message}`
                      );
                    }
                  }
                } catch (uploadError) {
                  console.warn(
                    `Failed to upload image ${img.id} to Supabase: ${uploadError.message}`
                  );
                }

                return {
                  promptKey,
                  imageData: {
                    id: img.id,
                    generatedImageUrl: supabaseImageUrl,
                    uploadedImageUrl: img.uploaded_image_url,
                    referenceImageUrl: img.reference_image_url,
                    trainingSampleId: img.training_sample_id,
                    createdAt: img.created_at,
                  },
                };
              });

              const uploadedImages = await Promise.all(imageUploadPromises);

              // Group images by prompt used
              const imagesByPrompt = new Map();
              for (const { promptKey, imageData } of uploadedImages) {
                if (!imagesByPrompt.has(promptKey)) {
                  imagesByPrompt.set(promptKey, []);
                }
                imagesByPrompt.get(promptKey).push(imageData);
              }

              // Add images to each optimized prompt
              for (const optimizedPrompt of optimizedPrompts) {
                const matchingImages =
                  imagesByPrompt.get(optimizedPrompt.prompt) || [];
                optimizedPrompt.generatedImages = matchingImages;
                optimizedPrompt.imageCount = matchingImages.length;

                if (matchingImages.length > 0) {
                  optimizedPrompt.improvements.push(
                    `Generated ${matchingImages.length} sample images`
                  );
                }
              }

              // Add total image count to performance metrics
              foundResults.performanceMetrics.totalImagesGenerated =
                generatedImages.length;
            } else {
              console.log(
                `⚠️ No generated images found in Supabase for this optimization run`
              );
            }
          } catch (imagesError) {
            console.warn(
              `Warning: Could not fetch generated images: ${imagesError.message}`
            );
          }

          console.log(
            `✅ Found results for job ${jobId} at timestamp ${resultTimestamp} with ${optimizedPrompts.length} prompt attempts`
          );
        } catch (fileError) {
          console.log(`❌ Error processing ${fileName}: ${fileError.message}`);
        }
      } else {
        console.log(
          `❌ No matching results found for job ${jobId} created at ${jobData.created_at}`
        );
      }

      if (foundResults) {
        // Store results in Supabase for caching
        await supabase
          .from("vertex_ai_jobs")
          .update({
            optimized_prompts: foundResults.optimizedPrompts,
            performance_metrics: foundResults.performanceMetrics,
          })
          .eq("job_id", jobId);

        console.log(`✅ Retrieved and cached results for job: ${jobId}`);

        return res.json({
          jobId,
          status: "completed",
          originalPrompts: jobData.base_prompts,
          optimizedPrompts: foundResults.optimizedPrompts,
          performanceMetrics: foundResults.performanceMetrics,
          completedAt: foundResults.completedAt,
        });
      }
    } catch (fetchError) {
      console.error(`❌ Error fetching results: ${fetchError.message}`);
    }

    // No results available
    console.log(`❌ No optimization results found for job: ${jobId}`);

    return res.status(404).json({
      error: "Results not found",
      message: "Optimization results are not available for this job",
      jobId,
      status: jobData.status,
    });
  } catch (error) {
    console.error("❌ Vertex AI results retrieval error:", error);
    res.status(500).json({
      error: "Results retrieval failed",
      details: error.message,
      timestamp: new Date().toISOString(),
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
