import express from "express";
import { upload } from "../middleware/upload.js";
import { getSupabase } from "../config/database.js";
import {
  getOpenAI,
  getGenAI,
  DEFAULT_MODEL_CONFIGS,
  TEMPLATE_MODE,
  CURRENT_TEMPLATE_MODE,
  BATCH_SIZE,
} from "../config/ai.js";
import {
  fetchImageAsBuffer,
  generateWithGemini,
  generateWithGeminiImg2Img,
  processGeneratedImage,
  fetchTemplateImagesWithSimilar,
} from "../utils/imageUtils.js";

const router = express.Router();

// Generate images endpoint
router.post("/generate-images", async (req, res) => {
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

    if (model === "seedream" && !process.env.FAL_API_KEY) {
      console.error("❌ Error: Missing FAL API key for SeeDream");
      return res
        .status(500)
        .json({ error: "Missing FAL API key for SeeDream" });
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

            const { data: photoData, error: photoError } = await getSupabase()
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
            } else if (model === "seedream") {
              // Use SeeDream API via fal.ai

              console.log(
                `🌱 [Seedream] Starting image generation with seedream-4.0`
              );

              // Parse size string to width/height object for SeeDream API
              const parseSizeToDimensions = (sizeStr) => {
                // Normalize to use × for comparison (handle both "x" and "×")
                const normalized = sizeStr.replace(/x/gi, "×");
                
                if (normalized === "1024×1024") {
                  return { width: 1024, height: 1024 };
                } else if (normalized === "1024×1536") {
                  return { width: 1024, height: 1536 };
                } else if (normalized === "1536×1024") {
                  return { width: 1536, height: 1024 };
                } else if (normalized === "1440×2560") {
                  return { width: 1440, height: 2560 };
                } else {
                  // Default to square for "auto" or unknown sizes
                  return { width: 1024, height: 1024 };
                }
              };

              // Get target dimensions from user selection
              const imageSize = parseSizeToDimensions(size);
              console.log("🌱 ======[Seedream] Using size:", size, "→ dimensions:", imageSize);

              // Build prompt with background requirements
              let enhancedPrompt = prompt;
              if (background === "transparent") {
                enhancedPrompt += `
                Requirements:
                - Use the pet only and no other elements from the photo.
                - Background: Background must be transparent with a white/gray checkerboard pattern.
                - Elements: all elements must be connected and attached to the pet, like the pet name if provided.
                - Composition: Clean, centered design that works on different product formats. Ensure some empty space around the pet and nothing is cutoff.
                - Quality: High quality designs that print well on merchandise.`;
              } else if (background === "opaque") {
                enhancedPrompt += `
                Requirements:
                - Use the pet only and no other elements from the photo.
                - Background: background should match the general theme and style.
                - Composition: Clean, centered design that works on different product formats.
                - Quality: High quality designs with beautiful pet and detailed background.`;
              }

              // Convert reference image to base64
              const imageBase64 = petBuffer.toString("base64");
              const imageDataUrl = `data:image/png;base64,${imageBase64}`;

              // Prepare request payload for fal.ai Seedream v4 edit
              const requestPayload = {
                prompt: enhancedPrompt,
                image_urls: [imageDataUrl],
                image_size: imageSize,
                num_images: 1,
                enable_safety_checker: false,
              };
              console.log("🌱 ======[Seedream] Image size:", imageSize);
              console.log("🌱 ======[Seedream] Prompt:", enhancedPrompt);

              // Make API request to fal.ai
              const response = await fetch(
                "https://fal.run/fal-ai/bytedance/seedream/v4/edit",
                {
                  method: "POST",
                  headers: {
                    Authorization: `Key ${process.env.FAL_API_KEY}`,
                    "Content-Type": "application/json",
                  },
                  body: JSON.stringify(requestPayload),
                }
              );

              if (!response.ok) {
                const errorText = await response.text();
                console.error(`❌ Seedream API error:`, {
                  status: response.status,
                  statusText: response.statusText,
                  error: errorText,
                });
                return null;
              }

              const responseData = await response.json();

              // Extract image from response
              if (!responseData.images || !responseData.images[0]) {
                console.error(
                  "❌ Error: No image data returned from Seedream API"
                );
                return null;
              }

              // Get the generated image URL and convert to base64
              const generatedImageUrl = responseData.images[0].url;
              const imageResponse = await fetch(generatedImageUrl);
              const imageArrayBuffer = await imageResponse.arrayBuffer();
              b64Image = Buffer.from(imageArrayBuffer).toString("base64");
              mimeType = "image/png";
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
router.post("/evaluate-image", async (req, res) => {
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

      const response = await getOpenAI().chat.completions.create({
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
router.post("/evaluate-photo-similarity", async (req, res) => {
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

// Gemini Vision Evaluation endpoint
router.post("/evaluate-gpt4-vision", async (req, res) => {
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

    console.log("🤖 Initializing Gemini model 33333...");
    const model = getGenAI().getGenerativeModel({
      model: "gemini-3-pro-image-preview",
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
          model: "gemini-3-pro-image-preview",
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
          model: "gemini-3-pro-image-preview",
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
router.post("/evaluate-samples", async (req, res) => {
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
        const response = await getOpenAI().chat.completions.create({
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

export default router;
