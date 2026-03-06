import express from "express";
import { generateWithGemini } from "../utils/imageUtils.js";
import { getSupabase } from "../config/database.js";

const router = express.Router();

// Build the enhanced prompt based on pet names and background settings
function buildEnhancedPrompt(prompt, background, petNames, needpetname) {
  let finalPrompt = prompt;

  if (needpetname && petNames.length > 0) {
    const namesStr = petNames.join(", ");
    finalPrompt = `${prompt} The pet${petNames.length > 1 ? "s'" : "'s"} name${petNames.length > 1 ? "s are" : " is"} ${namesStr}. Include the pet name${petNames.length > 1 ? "s" : ""} in the image using the same style, color scheme, and texture. Keep the name${petNames.length > 1 ? "s" : ""} subtle so ${petNames.length > 1 ? "they complement" : "it complements"} the image`;
  }

  if (background === "transparent") {
    finalPrompt += `
Requirements:
- Use the pet${petNames.length > 1 ? "s" : ""} only and no other elements from the photo.
- Background: Background must be transparent with a white/gray checkerboard pattern.
- Elements: all elements must be connected and attached to the pet${petNames.length > 1 ? "s" : ""}, like the pet name if provided.
- Composition: Clean, centered design that works on different product formats. Ensure some empty space around the pet${petNames.length > 1 ? "s" : ""} and nothing is cutoff.
- Quality: High quality designs that print well on merchandise.`;
  } else if (background === "opaque") {
    finalPrompt += `
Requirements:
- Use the pet${petNames.length > 1 ? "s" : ""} only and no other elements from the photo.
- Background: background should match the general theme and style.
- Composition: Clean, centered design that works on different product formats.
- Quality: High quality designs with beautiful pet${petNames.length > 1 ? "s" : ""} and detailed background.`;
  }

  return finalPrompt;
}

// POST /api/pet-photo-generator/generate-one
// Generates a single image, saves to Dragon DB, returns result
// Body: { photos: [{base64, mimeType, petName}], prompt, provider, size, background, needpetname }
router.post("/generate-one", async (req, res) => {
  try {
    const {
      photos = [],
      prompt,
      provider = "openai",
      size = "1024x1024",
      background = "opaque",
      needpetname = false,
      photoId = null, // optional: link to uploaded_photos record
    } = req.body;

    if (!photos.length || !prompt) {
      return res.status(400).json({ error: "photos and prompt are required" });
    }

    const petNames = photos.map((p) => p.petName).filter(Boolean);
    const enhancedPrompt = buildEnhancedPrompt(prompt, background, petNames, needpetname);

    // Convert all photos to buffers
    const photoBuffers = photos.map((p) => Buffer.from(p.base64, "base64"));

    let b64Image, mimeType;

    if (provider === "gemini") {
      // Gemini supports multiple images natively via content parts
      const geminiResult = await generateWithGemini(
        photoBuffers[0], // primary image
        enhancedPrompt,
        background,
        size,
        process.env.GEMINI_API_KEY,
        null, // modelConfig
        photoBuffers.length > 1 ? photoBuffers.slice(1) : undefined // additional images
      );
      b64Image = geminiResult.imageBase64;
      mimeType = geminiResult.mimeType;
    } else if (provider === "seedream") {
      // SeeDream via fal.ai
      const parseSizeToDimensions = (sizeStr) => {
        const normalized = sizeStr.replace(/x/gi, "\u00d7");
        if (normalized === "1024\u00d71024") return { width: 1024, height: 1024 };
        if (normalized === "1024\u00d71536") return { width: 1024, height: 1536 };
        if (normalized === "1536\u00d71024") return { width: 1536, height: 1024 };
        if (normalized === "1440\u00d72560") return { width: 1440, height: 2560 };
        return { width: 1024, height: 1024 };
      };

      const imageSize = parseSizeToDimensions(size);

      // Convert all pet photos to data URLs
      const imageDataUrls = photoBuffers.map(
        (buf) => `data:image/png;base64,${buf.toString("base64")}`
      );

      const response = await fetch("https://fal.run/fal-ai/bytedance/seedream/v4/edit", {
        method: "POST",
        headers: {
          Authorization: `Key ${process.env.FAL_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          prompt: enhancedPrompt,
          image_urls: imageDataUrls,
          image_size: imageSize,
          num_images: 1,
          enable_safety_checker: false,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`SeeDream API error (${response.status}): ${errorText}`);
      }

      const responseData = await response.json();
      if (!responseData.images?.[0]) throw new Error("No image from SeeDream");

      const imageResponse = await fetch(responseData.images[0].url);
      const imageArrayBuffer = await imageResponse.arrayBuffer();
      b64Image = Buffer.from(imageArrayBuffer).toString("base64");
      mimeType = "image/png";
    } else {
      // OpenAI (default)
      const form = new FormData();

      // Append all pet photos — OpenAI gpt-image-1 supports multiple image[] fields
      for (const buf of photoBuffers) {
        const petFile = new File([buf], "pet.png", { type: "image/png" });
        form.append("image[]", petFile);
      }

      form.append("model", "gpt-image-1");
      form.append("prompt", enhancedPrompt);
      form.append("size", size.replace("\u00d7", "x"));
      form.append("background", background);

      const openaiResponse = await fetch("https://api.openai.com/v1/images/edits", {
        method: "POST",
        headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
        body: form,
      });

      if (!openaiResponse.ok) {
        const errorText = await openaiResponse.text();
        throw new Error(`OpenAI error (${openaiResponse.status}): ${errorText}`);
      }

      const openaiData = await openaiResponse.json();
      b64Image = openaiData.data?.[0]?.b64_json;
      mimeType = "image/png";

      if (!b64Image) throw new Error("No image returned from OpenAI");
    }

    // Upload generated image to Dragon DB
    let dbRecord = null;
    try {
      const db = getSupabase();
      const imageBuffer = Buffer.from(b64Image, "base64");
      const fileName = `generated_${photoId || "noid"}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}.png`;

      const { error: uploadError } = await db.storage
        .from("generated-images")
        .upload(fileName, imageBuffer, { contentType: "image/png", cacheControl: "3600" });

      if (uploadError) {
        console.error("Storage upload error:", uploadError.message);
      } else {
        const insertPayload = {
          photo_id: photoId || null,
          initial_prompt: prompt,
          generated_prompt: enhancedPrompt,
          image_url: fileName,
          size: size === "auto" ? "auto" : size.replace("x", "\u00d7"),
          background,
          model: provider,
        };

        const { data: insertData, error: insertError } = await db
          .from("generated_images")
          .insert(insertPayload)
          .select()
          .single();

        if (insertError) {
          console.error("DB insert error:", insertError.message);
        } else {
          dbRecord = insertData;
        }
      }
    } catch (dbErr) {
      console.error("DB save error (non-fatal):", dbErr.message);
    }

    res.json({
      imageBase64: b64Image,
      mimeType: mimeType || "image/png",
      dbRecord,
    });
  } catch (err) {
    console.error("generate-one error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/pet-photo-generator/remove-background
router.post("/remove-background", async (req, res) => {
  try {
    const { imageBase64, mimeType = "image/png" } = req.body;

    if (!imageBase64) {
      return res.status(400).json({ error: "imageBase64 is required" });
    }

    const imageBuffer = Buffer.from(imageBase64, "base64");
    const imageBlob = new Blob([imageBuffer], { type: mimeType });

    const formData = new FormData();
    formData.append("image_file", imageBlob, "image.png");

    const response = await fetch("https://sdk.photoroom.com/v1/segment", {
      method: "POST",
      headers: { "x-api-key": process.env.PHOTOROOM_API_KEY },
      body: formData,
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`PhotoRoom API error (${response.status}): ${errText}`);
    }

    const resultBuffer = Buffer.from(await response.arrayBuffer());
    const resultBase64 = resultBuffer.toString("base64");

    res.json({ imageBase64: resultBase64 });
  } catch (err) {
    console.error("remove-background error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

export default router;
