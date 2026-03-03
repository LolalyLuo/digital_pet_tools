import express from "express";
import { generateWithGemini } from "../utils/imageUtils.js";

const router = express.Router();

// Build the enhanced prompt based on pet name and background settings
// (matches prompt enhancement logic in imageRoutes.js for consistency)
function buildEnhancedPrompt(prompt, background, petName, needpetname) {
  let finalPrompt = prompt;

  if (needpetname && petName) {
    finalPrompt = `${prompt} The pet's name is ${petName}. Include the pet's name in the image using the same style, color scheme, and texture. Keep the name subtle so it complements the image`;
  }

  if (background === "transparent") {
    finalPrompt += `
Requirements:
- Use the pet only and no other elements from the photo.
- Background: Background must be transparent with a white/gray checkerboard pattern.
- Elements: all elements must be connected and attached to the pet, like the pet name if provided.
- Composition: Clean, centered design that works on different product formats. Ensure some empty space around the pet and nothing is cutoff.
- Quality: High quality designs that print well on merchandise.`;
  } else if (background === "opaque") {
    finalPrompt += `
Requirements:
- Use the pet only and no other elements from the photo.
- Background: background should match the general theme and style.
- Composition: Clean, centered design that works on different product formats.
- Quality: High quality designs with beautiful pet and detailed background.`;
  }

  return finalPrompt;
}

// POST /api/pet-photo-generator/generate
// Body: { photos: [{base64, mimeType, petName}], prompt, provider, size, background, needpetname, count }
// Returns: { results: [{imageBase64, mimeType}] }
router.post("/generate", async (req, res) => {
  try {
    const {
      photos = [],
      prompt,
      provider = "openai",
      size = "1024x1024",
      background = "opaque",
      needpetname = false,
      count = 3,
    } = req.body;

    if (!photos.length || !prompt) {
      return res.status(400).json({ error: "photos and prompt are required" });
    }

    // Use the first photo as the primary reference image
    const primaryPhoto = photos[0];
    const petName = primaryPhoto.petName || "";
    const enhancedPrompt = buildEnhancedPrompt(prompt, background, petName, needpetname);

    // Convert base64 to Buffer for model calls
    const petBuffer = Buffer.from(primaryPhoto.base64, "base64");

    const results = [];

    for (let i = 0; i < count; i++) {
      try {
        let b64Image, mimeType;

        if (provider === "gemini") {
          const geminiResult = await generateWithGemini(
            petBuffer,
            enhancedPrompt,
            background,
            size,
            process.env.GEMINI_API_KEY
          );
          b64Image = geminiResult.imageBase64;
          mimeType = geminiResult.mimeType;
        } else {
          // OpenAI (default) — same pattern as imageRoutes.js:388-450
          const petFile = new File([petBuffer], "pet.png", { type: "image/png" });
          const form = new FormData();
          form.append("image", petFile);
          form.append("model", "gpt-image-1");
          form.append("prompt", enhancedPrompt);
          form.append("size", size.replace("\u00d7", "x"));
          form.append("background", background);

          const openaiResponse = await fetch(
            "https://api.openai.com/v1/images/edits",
            {
              method: "POST",
              headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
              body: form,
            }
          );

          if (!openaiResponse.ok) {
            const errorText = await openaiResponse.text();
            console.error(`❌ OpenAI error [${i}]:`, openaiResponse.status, errorText);
            results.push(null);
            continue;
          }

          const openaiData = await openaiResponse.json();
          b64Image = openaiData.data?.[0]?.b64_json;
          mimeType = "image/png";

          if (!b64Image) {
            results.push(null);
            continue;
          }
        }

        results.push({ imageBase64: b64Image, mimeType: mimeType || "image/png" });
      } catch (err) {
        console.error(`❌ Error generating image [${i}]:`, err.message);
        results.push(null);
      }
    }

    res.json({ results: results.filter(Boolean) });
  } catch (err) {
    console.error("❌ pet-photo-generator generate error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/pet-photo-generator/remove-background
// Body: { imageBase64: string, mimeType?: string }
// Returns: { imageBase64: string }
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
    console.error("❌ remove-background error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

export default router;
