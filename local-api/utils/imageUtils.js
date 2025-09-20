import fetch from "node-fetch";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { getSupabase } from "../config/database.js";
import {
  getGenAI,
  getStorageClient,
  DEFAULT_MODEL_CONFIGS,
  TEMPLATE_MODE,
  CURRENT_TEMPLATE_MODE
} from "../config/ai.js";

/**
 * Fetches an image from a URL and returns it as a buffer
 * @param {string} url - The URL of the image to fetch
 * @returns {Promise<Buffer>} - The image data as a buffer
 */
export async function fetchImageAsBuffer(url) {
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

/**
 * Converts a buffer to base64 string
 * @param {Buffer} buffer - The buffer to convert
 * @returns {string} - Base64 encoded string
 */
export function bufferToBase64(buffer) {
  return buffer.toString("base64");
}

/**
 * Uploads an image from Google Cloud Storage to Supabase storage
 * @param {string} gcsUrl - The GCS URL of the image
 * @param {string} imageId - Unique identifier for the image
 * @returns {Promise<string>} - The public URL of the uploaded image in Supabase
 */
export async function uploadGCSImageToSupabase(gcsUrl, imageId) {
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
    const bucket = getStorageClient().bucket(bucketName);
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
    const { data, error } = await getSupabase().storage
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
    } = getSupabase().storage.from("cloud-images").getPublicUrl(fileName);

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

/**
 * Fetches template images with their similar examples
 * @param {number[]} templateNumbers - Array of template numbers to fetch
 * @returns {Promise<Array>} - Array of template groups with base template and similar examples
 */
export async function fetchTemplateImagesWithSimilar(templateNumbers) {
  // First get the base template to extract similar_examples
  const { data: baseTemplateData, error: baseTemplateError } = await getSupabase()
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
      const { data: similarData, error: similarError } = await getSupabase()
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

/**
 * Generates a detailed description of an image using Gemini API
 * @param {string} imageUrl - The URL of the image to describe
 * @param {string} imageType - The type of image ("source" by default)
 * @returns {Promise<string>} - The generated description
 */
export async function generateImageDescription(imageUrl, imageType = "source") {
  try {
    console.log(
      `🔍 Generating description for ${imageType} image: ${imageUrl}`
    );

    // Check if description is already cached in Supabase
    const { data: cachedDescription, error: cacheError } = await getSupabase()
      .from("image_descriptions")
      .select("description")
      .eq("image_url", imageUrl)
      .eq("image_type", imageType)
      .single();

    if (!cacheError && cachedDescription) {
      console.log(`✅ Found cached description for ${imageType} image`);
      return cachedDescription.description;
    }

    // Initialize Gemini AI
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    const model = getGenAI().getGenerativeModel({ model: "gemini-1.5-flash" });

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

    // Generate different prompts based on image type
    let prompt;
    if (imageType === "pet_analysis") {
      prompt = `Analyze this pet photo for detailed characteristics. Focus on:
1. Pet type and breed (specific breed identification if possible)
2. Physical characteristics: size, build, coat type and texture
3. Color and markings: exact colors, patterns, spots, stripes, distinctive features
4. Facial features: eye color/shape, nose color/shape, ear type/position
5. Pose and body language: stance, expression, personality traits visible
6. Current photo quality: lighting, angle, background elements
7. Distinctive features that make this pet unique

Provide a comprehensive analysis that captures all the essential characteristics needed to recreate this pet's likeness accurately.`;
    } else {
      prompt = `Please provide a detailed description of this image. Focus on:
1. The main subject (pet type, breed, pose, expression)
2. Visual style and artistic approach (realistic, artistic, watercolor, etc.)
3. Colors, lighting, and mood
4. Background and setting
5. Overall composition and quality

Provide a detailed and comprehensive description that captures all the important visual elements, artistic techniques, and aesthetic qualities.`;
    }

    const result = await model.generateContent([prompt, imagePart]);
    const description = result.response.text();

    // Cache the description in Supabase
    try {
      await getSupabase().from("image_descriptions").insert({
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

/**
 * Generates a detailed descriptive target for standalone evaluation mode
 * @param {string} imageUrl - The URL of the source pet image
 * @param {string} petAnalysis - The detailed analysis of the pet
 * @returns {Promise<string>} - The generated descriptive target
 */
export async function generateQualitySpecification(imageUrl, petAnalysis) {
  try {
    console.log(`🎯 Generating descriptive target for image: ${imageUrl}`);

    // Check if descriptive target is already cached
    const cacheKey = `${imageUrl}_descriptive_target`;
    const { data: cachedTarget, error: cacheError } = await getSupabase()
      .from("image_descriptions")
      .select("description")
      .eq("image_url", cacheKey)
      .eq("image_type", "descriptive_target")
      .single();

    if (!cacheError && cachedTarget) {
      console.log(`✅ Found cached descriptive target`);
      return cachedTarget.description;
    }

    // Initialize Gemini AI to generate descriptive target
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    const model = getGenAI().getGenerativeModel({ model: "gemini-1.5-flash" });

    // Create a prompt to generate a detailed description of the ideal image
    const targetGenerationPrompt = `Based on this pet analysis, create a detailed, descriptive target that describes what a perfect, high-quality commercial pet portrait would look like.

Pet Analysis: ${petAnalysis}

Write a comprehensive, detailed description of the ideal commercial pet portrait as if you're describing an actual high-quality image. Include:

1. **Physical Accuracy**: Exactly how the pet should look (breed characteristics, colors, markings, features)
2. **Pose & Expression**: The ideal pose, facial expression, and body language
3. **Artistic Style**: Professional artistic approach and visual treatment
4. **Lighting & Colors**: Perfect lighting setup and color palette
5. **Composition**: Ideal framing, positioning, and background
6. **Quality Details**: Professional execution, sharp details, smooth rendering
7. **Commercial Appeal**: Elements that make it gift-worthy and marketable

Write this as a flowing, detailed description (like describing a reference image) rather than a list. Focus on what the perfect final image would actually look like, capturing all the visual elements that would make it commercially successful.

Start your description with: "A professional, high-quality commercial pet portrait featuring..."`;

    const result = await model.generateContent([targetGenerationPrompt]);
    const descriptiveTarget = result.response.text();

    // Cache the descriptive target
    try {
      await getSupabase().from("image_descriptions").insert({
        image_url: cacheKey,
        description: descriptiveTarget,
        image_type: "descriptive_target",
      });
      console.log(`💾 Cached descriptive target`);
    } catch (insertError) {
      console.log(`⚠️ Failed to cache descriptive target: ${insertError.message}`);
    }

    return descriptiveTarget;
  } catch (error) {
    console.error(`❌ Failed to generate descriptive target:`, error);
    throw error;
  }
}

/**
 * Generates an image using Gemini API
 * @param {Buffer} petBuffer - The pet image buffer
 * @param {string} prompt - The generation prompt
 * @param {string} background - Background type ("transparent" or "opaque")
 * @param {string} size - Image size specification
 * @param {string} geminiApiKey - Gemini API key
 * @param {Object} modelConfig - Model configuration
 * @returns {Promise<Object>} - Generated image data with base64 and mimeType
 */
export async function generateWithGemini(
  petBuffer,
  prompt,
  background,
  size,
  geminiApiKey,
  modelConfig = DEFAULT_MODEL_CONFIGS.gemini
) {
  const model = getGenAI().getGenerativeModel({
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

/**
 * Generates an image using Gemini API with image-to-image approach
 * @param {Buffer} petBuffer - The pet image buffer
 * @param {Array} templateImages - Array of template images with buffers
 * @param {string} prompt - The generation prompt
 * @param {string} background - Background type
 * @param {string} size - Image size specification
 * @param {string} geminiApiKey - Gemini API key
 * @param {string} templatePrompt - Template-specific prompt
 * @param {Object} modelConfig - Model configuration
 * @returns {Promise<Object>} - Generated image data with base64, mimeType, and prompt
 */
export async function generateWithGeminiImg2Img(
  petBuffer,
  templateImages,
  prompt,
  background,
  size,
  geminiApiKey,
  templatePrompt,
  modelConfig = DEFAULT_MODEL_CONFIGS["gemini-img2img"]
) {
  const model = getGenAI().getGenerativeModel({
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

/**
 * Processes generated image data and saves it to database and storage
 * @param {Object} params - Parameters object
 * @param {string} params.b64Image - Base64 encoded image data
 * @param {string} params.photoId - Photo ID
 * @param {string} params.prompt - Generation prompt
 * @param {string} params.initialPrompt - Initial prompt
 * @param {string} params.size - Image size
 * @param {string} params.background - Background type
 * @param {string} params.model - Model used
 * @param {string} params.originalPhotoUrl - Original photo URL
 * @param {string} params.templatePrompt - Template prompt
 * @param {Object} params.modelConfig - Model configuration
 * @returns {Promise<Object|null>} - Processed image data or null if failed
 */
export async function processGeneratedImage({
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

    const { data: uploadData, error: uploadError } = await getSupabase().storage
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

    const { data: insertData, error: insertError } = await getSupabase()
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