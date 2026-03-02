import express from "express";
import multer from "multer";
import { getInstameshopSupabase, getProdSupabase } from "../config/database.js";
import { getGenAI, getOpenAI } from "../config/ai.js";

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage() });

// POST /api/product-images/init
// Multipart: seedImage file + fields: shopifyProductId
// Fetches existing products row by shopifyProductId, uploads seed image, creates seed_images row
// Returns: { productId, seedImageId, seedImageUrl }
router.post("/init", upload.single("seedImage"), async (req, res) => {
  try {
    const { shopifyProductId } = req.body;
    const file = req.file;

    if (!shopifyProductId || !file) {
      return res.status(400).json({ error: "shopifyProductId and seedImage required" });
    }

    const db = getInstameshopSupabase();

    // Upload seed image to seed-images bucket
    const fileName = `seed_${Date.now()}_${file.originalname.replace(/\s/g, "_")}`;
    const { error: storageError } = await db.storage
      .from("seed-images")
      .upload(fileName, file.buffer, { contentType: file.mimetype, upsert: false });

    if (storageError) throw new Error(`Storage upload failed: ${storageError.message}`);

    const { data: { publicUrl } } = db.storage.from("seed-images").getPublicUrl(fileName);

    // Fetch existing products row (created during config step)
    const { data: product, error: productError } = await db
      .from("products")
      .select()
      .eq("shopify_product_id", shopifyProductId)
      .single();

    if (productError) throw new Error(`Products fetch failed: ${productError.message}`);

    // Create seed_images row
    const { data: seedImage, error: seedError } = await db
      .from("seed_images")
      .insert({ product_id: product.id, storage_path: fileName })
      .select()
      .single();

    if (seedError) throw new Error(`Seed images insert failed: ${seedError.message}`);

    res.json({
      productId: product.id,
      seedImageId: seedImage.id,
      seedImageUrl: publicUrl,
    });
  } catch (err) {
    console.error("❌ product-images/init:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/product-images/breed-names
// Body: { count: 4, animalType: "dog" | "cat" | "pet", excludeBreeds: [] }
// Returns: { combos: [{ breed: "Maine Coon", name: "Oliver" }, ...] }
// LLM generates breeds + picks normal-sounding names from DB candidates
router.post("/breed-names", async (req, res) => {
  try {
    const { count = 4, animalType = "pet", excludeBreeds = [] } = req.body;

    // Step 1: Fetch a pool of candidate names from prod DB
    let nameCandidates = [];
    try {
      const db = getProdSupabase();
      const { data } = await db
        .from("pets")
        .select("pet_name")
        .not("pet_name", "is", null)
        .limit(200);
      if (data?.length) {
        const names = [...new Set(data.map((r) => r.pet_name).filter(Boolean))];
        for (let i = names.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          [names[i], names[j]] = [names[j], names[i]];
        }
        // Pass a larger pool so LLM has plenty of normal names to pick from
        nameCandidates = names.slice(0, Math.min(50, names.length));
      }
    } catch (dbErr) {
      console.warn("⚠️ Could not fetch pet names from prod DB:", dbErr.message);
    }

    // Step 2: Single LLM call — generate breeds AND pick normal names from candidates
    const excludeClause = excludeBreeds.length
      ? ` Do NOT use these breeds: ${excludeBreeds.join(", ")}.`
      : "";
    const nameClause = nameCandidates.length
      ? `\n\nFor names, pick ${count} from this list of real pet names — choose only normal, cute-sounding ones (skip anything weird, misspelled, or nonsensical): ${nameCandidates.join(", ")}.`
      : `\n\nFor names, use common cute pet names like Bella, Max, Luna, Charlie, Daisy, Milo.`;

    // Allocate slots: at most 1 non-dog/cat, rest are dogs and cats (alternating or random mix)
    const dogSlots = Math.ceil((count - 1) / 2);
    const catSlots = Math.floor((count - 1) / 2);
    const wildcardSlot = count > 1 ? 1 : 0;
    const slotDescription = wildcardSlot
      ? `${dogSlots} dog breed${dogSlots !== 1 ? "s" : ""}, ${catSlots} cat breed${catSlots !== 1 ? "s" : ""}, and exactly 1 other pet (rabbit, hamster, bird, etc.)`
      : `${count} dog or cat breed${count !== 1 ? "s" : ""}`;

    const prompt = `Generate ${count} unique pet breed + name combinations for a product image. Use exactly: ${slotDescription}. All breeds must be completely different (no repeats).${excludeClause}${nameClause}

Respond with ONLY a valid JSON array of objects: [{"breed":"breed1","name":"name1"}, ...] No markdown, no explanation.`;

    let combos = [];
    try {
      const client = getOpenAI();
      const completion = await client.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [{ role: "user", content: prompt }],
        max_tokens: 300,
      });
      combos = JSON.parse(completion.choices[0].message.content.trim());
    } catch {
      const genAI = getGenAI();
      const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
      const result = await model.generateContent(prompt);
      combos = JSON.parse(result.response.text().trim());
    }

    res.json({ combos: combos.slice(0, count) });
  } catch (err) {
    console.error("❌ breed-names:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/product-images/generate-variant
// Body: { seedImageBase64, seedImageMimeType, backgroundColor, colorName, breed, petName, feedbackText, refineMode? }
// refineMode: true — applies only feedbackText to the provided image, keeps everything else identical
// Returns: { imageBase64, mimeType }
router.post("/generate-variant", async (req, res) => {
  try {
    const {
      seedImageBase64,
      seedImageMimeType = "image/png",
      backgroundColor,
      colorName,
      breed,
      petName,
      feedbackText = "",
      refineMode = false,
    } = req.body;

    if (!seedImageBase64) {
      return res.status(400).json({ error: "seedImageBase64 required" });
    }
    if (!refineMode && (!backgroundColor || !colorName || !breed || !petName)) {
      return res.status(400).json({ error: "backgroundColor, colorName, breed, petName required when not in refineMode" });
    }
    if (refineMode && !feedbackText) {
      return res.status(400).json({ error: "feedbackText required in refineMode" });
    }

    let prompt;

    if (refineMode) {
      // Tweak mode: apply only the user's adjustment to the current image
      prompt = `You are editing this existing artwork. Apply ONLY this adjustment: ${feedbackText}

Keep EVERYTHING else completely unchanged:
- The background color, breed, and name text must stay exactly as they are
- The exact same artistic style (brushstrokes, texture, medium — watercolor/pencil/cartoon/etc.)
- The same overall composition, layout, and decorative elements
- The same image dimensions and aspect ratio

Output only the modified image.`;
    } else {
      // Initial generation: apply full color + breed + name transformation
      const hex = backgroundColor.replace("#", "");
      const r = parseInt(hex.substring(0, 2), 16);
      const g = parseInt(hex.substring(2, 4), 16);
      const b = parseInt(hex.substring(4, 6), 16);
      const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
      const nameColor = luminance < 0.5 ? "white" : "black";

      prompt = `You are editing this existing artwork. Make ONLY these specific changes:
1. Change the background color to ${colorName} (${backgroundColor})
2. Change the pet in the image to a ${breed}
3. Change the pet's name text to "${petName}" in ${nameColor} color

Keep EVERYTHING else identical:
- The exact same artistic style (brushstrokes, texture, medium — watercolor/pencil/cartoon/etc.)
- The same overall composition and layout
- The same decorative elements, borders, and framing
- The same level of detail and rendering quality
- The same image dimensions and aspect ratio
${feedbackText ? `\nAdditional adjustment: ${feedbackText}` : ""}

Output only the modified image.`;
    }

    const genAI = getGenAI();
    const model = genAI.getGenerativeModel({ model: "gemini-3-pro-image-preview" });

    const result = await model.generateContent([
      prompt,
      { inlineData: { data: seedImageBase64, mimeType: seedImageMimeType } },
    ]);

    const parts = result.response.candidates?.[0]?.content?.parts || [];
    const imagePart = parts.find((p) => p.inlineData?.mimeType?.startsWith("image/"));

    if (!imagePart) {
      return res.status(500).json({ error: "Gemini returned no image" });
    }

    res.json({
      imageBase64: imagePart.inlineData.data,
      mimeType: imagePart.inlineData.mimeType,
    });
  } catch (err) {
    console.error("❌ generate-variant:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/product-images/upload-image
// Body: { imageBase64, mimeType? }
// Uploads a single image to the ai-images storage bucket and returns its public URL.
// Used by step 5 when a locally-uploaded image needs a real URL before being sent to Shopify.
router.post("/upload-image", async (req, res) => {
  try {
    const { imageBase64, mimeType = "image/png" } = req.body;
    if (!imageBase64) return res.status(400).json({ error: "imageBase64 required" });

    const db = getInstameshopSupabase();
    const ext = mimeType === "image/jpeg" ? "jpg" : "png";
    const fileName = `upload_${Date.now()}.${ext}`;
    const buffer = Buffer.from(imageBase64, "base64");

    const { error: storageErr } = await db.storage
      .from("product-images")
      .upload(fileName, buffer, { contentType: mimeType, upsert: false });
    if (storageErr) throw new Error(`Storage upload failed: ${storageErr.message}`);

    const { data: { publicUrl } } = db.storage.from("product-images").getPublicUrl(fileName);
    res.json({ publicUrl });
  } catch (err) {
    console.error("❌ upload-image:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/product-images/save-ai-images
// Body: { productId, seedImageId, aiImages: [{imageBase64, mimeType, colorName, hexCode, breed, petName}] }
// Uploads images to storage and inserts ai_generated_images rows.
// Returns: { aiImageRecords: [{id, color, publicUrl}] }
router.post("/save-ai-images", async (req, res) => {
  try {
    const { productId, seedImageId, aiImages } = req.body;
    if (!productId || !seedImageId || !aiImages?.length) {
      return res.status(400).json({ error: "productId, seedImageId, aiImages required" });
    }

    const db = getInstameshopSupabase();
    const aiImageRecords = [];

    for (const img of aiImages) {
      const buffer = Buffer.from(img.imageBase64, "base64");
      const ext = img.mimeType === "image/jpeg" ? "jpg" : "png";
      const safeName = (img.colorName || "unnamed").replace(/\s/g, "_");
      const fileName = `ai_${Date.now()}_${safeName}.${ext}`;

      const { error: storageErr } = await db.storage
        .from("ai-images")
        .upload(fileName, buffer, { contentType: img.mimeType, upsert: false });
      if (storageErr) throw new Error(`AI image storage upload failed: ${storageErr.message}`);

      const { data: { publicUrl } } = db.storage.from("ai-images").getPublicUrl(fileName);

      const { data: row, error: dbErr } = await db
        .from("ai_generated_images")
        .insert({
          seed_image_id: seedImageId,
          storage_path: fileName,
          generation_params: {
            colorName: img.colorName,
            hexCode: img.hexCode,
            breed: img.breed,
            petName: img.petName,
          },
        })
        .select()
        .single();
      if (dbErr) throw new Error(`ai_generated_images insert failed: ${dbErr.message}`);

      aiImageRecords.push({ id: row.id, color: img.colorName, publicUrl });
    }

    res.json({ aiImageRecords });
  } catch (err) {
    console.error("❌ save-ai-images:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/product-images/save-results
// Body: { productId, seedImageId, aiImages?: [...], aiImageRecords?: [...], mockupImages: [...] }
// If aiImageRecords is provided (pre-saved in step 3), skips re-uploading aiImages.
// Returns: { aiImageIds: [...], mockupImageIds: [...] }
router.post("/save-results", async (req, res) => {
  try {
    const { productId, seedImageId, aiImages, aiImageRecords: presavedRecords, mockupImages } = req.body;
    if (!productId || !seedImageId) {
      return res.status(400).json({ error: "productId and seedImageId required" });
    }
    if (!presavedRecords?.length && !aiImages?.length) {
      return res.status(400).json({ error: "aiImages or aiImageRecords required" });
    }

    const db = getInstameshopSupabase();
    let aiImageRecords = [];

    if (presavedRecords?.length) {
      // AI images already saved in step 3 — reuse without re-uploading
      aiImageRecords = presavedRecords;
    } else {
      // Upload each AI image to storage + insert row
      for (const img of aiImages) {
        const buffer = Buffer.from(img.imageBase64, "base64");
        const ext = img.mimeType === "image/jpeg" ? "jpg" : "png";
        const safeName = (img.colorName || "unnamed").replace(/\s/g, "_");
        const fileName = `ai_${Date.now()}_${safeName}.${ext}`;

        const { error: storageErr } = await db.storage
          .from("ai-images")
          .upload(fileName, buffer, { contentType: img.mimeType, upsert: false });
        if (storageErr) throw new Error(`AI image storage upload failed: ${storageErr.message}`);

        const { data: { publicUrl } } = db.storage.from("ai-images").getPublicUrl(fileName);

        const { data: row, error: dbErr } = await db
          .from("ai_generated_images")
          .insert({
            seed_image_id: seedImageId,
            storage_path: fileName,
            generation_params: {
              colorName: img.colorName,
              hexCode: img.hexCode,
              breed: img.breed,
              petName: img.petName,
            },
          })
          .select()
          .single();
        if (dbErr) throw new Error(`ai_generated_images insert failed: ${dbErr.message}`);

        aiImageRecords.push({ id: row.id, color: img.colorName, publicUrl });
      }
    }

    // Download and save mockup images
    const mockupImageIds = [];
    for (const mockup of (mockupImages || [])) {
      // Seed mockups use seed_image_id (null ai_image_id); non-seed use ai_image_id
      let aiImageId = null;
      if (!mockup.isSeedMockup) {
        aiImageId = aiImageRecords[mockup.aiImageIndex]?.id;
        if (!aiImageId) {
          console.warn(`⚠️ Skipping mockup at position ${mockup.position}: no AI image at index ${mockup.aiImageIndex}`);
          continue;
        }
      }

      // Download mockup image from Printify CDN
      const imgRes = await fetch(mockup.src);
      if (!imgRes.ok) throw new Error(`Failed to download mockup: ${mockup.src}`);
      const buffer = Buffer.from(await imgRes.arrayBuffer());
      const fileName = `mockup_${Date.now()}_${mockup.position}.jpg`;

      const { error: storageErr } = await db.storage
        .from("product-images")
        .upload(fileName, buffer, { contentType: "image/jpeg", upsert: false });
      if (storageErr) throw new Error(`Mockup storage upload failed: ${storageErr.message}`);

      const { data: row, error: dbErr } = await db
        .from("product_mockup_images")
        .insert({
          ai_image_id: aiImageId,
          seed_image_id: mockup.isSeedMockup ? seedImageId : null,
          product_id: productId,
          printify_custom_product_id: mockup.printifyProductId,
          storage_path: fileName,
          variant_attributes: mockup.variantAttributes ?? null,
        })
        .select()
        .single();
      if (dbErr) throw new Error(`product_mockup_images insert failed: ${dbErr.message}`);

      mockupImageIds.push(row.id);
    }

    res.json({ aiImageIds: aiImageRecords.map((r) => r.id), mockupImageIds });
  } catch (err) {
    console.error("❌ save-results:", err.message);
    res.status(500).json({ error: err.message });
  }
});

export default router;
