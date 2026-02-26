import express from "express";
import multer from "multer";
import { getInstameshopSupabase } from "../config/database.js";
import { getGenAI, getOpenAI } from "../config/ai.js";

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage() });

// POST /api/product-images/init
// Multipart: seedImage file + fields: shopifyProductId, shopifyProductTitle
// Creates products + seed_images rows in InstaMeShop DB
// Returns: { productId, seedImageId, seedImageUrl }
router.post("/init", upload.single("seedImage"), async (req, res) => {
  try {
    const { shopifyProductId, shopifyProductTitle } = req.body;
    const file = req.file;

    if (!shopifyProductId || !shopifyProductTitle || !file) {
      return res.status(400).json({ error: "shopifyProductId, shopifyProductTitle, and seedImage required" });
    }

    const db = getInstameshopSupabase();

    // Upload seed image to seed-images bucket
    const fileName = `seed_${Date.now()}_${file.originalname.replace(/\s/g, "_")}`;
    const { error: storageError } = await db.storage
      .from("seed-images")
      .upload(fileName, file.buffer, { contentType: file.mimetype, upsert: false });

    if (storageError) throw new Error(`Storage upload failed: ${storageError.message}`);

    const { data: { publicUrl } } = db.storage.from("seed-images").getPublicUrl(fileName);

    // Create products row
    const { data: product, error: productError } = await db
      .from("products")
      .insert({
        shopify_product_id: shopifyProductId,
        name: shopifyProductTitle,
        product_type: "portrait",
      })
      .select()
      .single();

    if (productError) throw new Error(`Products insert failed: ${productError.message}`);

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
// Body: { count: 4, animalType: "dog" | "cat" | "pet" }
// Returns: { combos: [{ breed: "Maine Coon", name: "Oliver" }, ...] }
router.post("/breed-names", async (req, res) => {
  try {
    const { count = 4, animalType = "pet" } = req.body;

    let combos;

    try {
      // Use OpenAI if the client is initialized
      const client = getOpenAI();
      const completion = await client.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
          {
            role: "user",
            content: `Generate ${count} unique and diverse ${animalType} breed + name combinations for a product image. Each should be a different breed (no repeats). Names should be cute pet names. Respond with ONLY valid JSON array: [{"breed":"...", "name":"..."}, ...] No markdown, no explanation.`,
          },
        ],
        max_tokens: 300,
      });
      const raw = completion.choices[0].message.content.trim();
      combos = JSON.parse(raw);
    } catch (openaiErr) {
      // Fallback: use Gemini text generation
      console.warn("⚠️ OpenAI unavailable, falling back to Gemini:", openaiErr.message);
      const genAI = getGenAI();
      const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
      const result = await model.generateContent(
        `Generate ${count} unique and diverse ${animalType} breed + name combinations for a product image. Each should be a different breed (no repeats). Names should be cute pet names. Respond with ONLY valid JSON array: [{"breed":"...", "name":"..."}, ...] No markdown, no explanation.`
      );
      const raw = result.response.text().trim();
      combos = JSON.parse(raw);
    }

    res.json({ combos });
  } catch (err) {
    console.error("❌ breed-names:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/product-images/generate-variant
// Body: { seedImageBase64, seedImageMimeType, backgroundColor, colorName, breed, petName, feedbackText }
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
    } = req.body;

    if (!seedImageBase64 || !backgroundColor || !colorName || !breed || !petName) {
      return res.status(400).json({ error: "seedImageBase64, backgroundColor, colorName, breed, petName required" });
    }

    // Determine name text color based on background luminance
    const hex = backgroundColor.replace("#", "");
    const r = parseInt(hex.substring(0, 2), 16);
    const g = parseInt(hex.substring(2, 4), 16);
    const b = parseInt(hex.substring(4, 6), 16);
    const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    const nameColor = luminance < 0.5 ? "white" : "black";

    const prompt = `You are editing this existing artwork. Make ONLY these specific changes:
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

    const genAI = getGenAI();
    const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash-exp" });

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

// POST /api/product-images/save-results
// Body: { productId, seedImageId, aiImages: [...], mockupImages: [...] }
// Saves ai_generated_images + product_mockup_images rows to InstaMeShop DB
// Returns: { aiImageIds: [...], mockupImageIds: [...] }
router.post("/save-results", async (req, res) => {
  try {
    const { productId, seedImageId, aiImages, mockupImages } = req.body;
    if (!productId || !seedImageId || !aiImages?.length) {
      return res.status(400).json({ error: "productId, seedImageId, aiImages required" });
    }

    const db = getInstameshopSupabase();
    const aiImageRecords = [];

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

      aiImageRecords.push({ id: row.id, publicUrl });
    }

    // Download and save mockup images
    const mockupImageIds = [];
    for (const mockup of (mockupImages || [])) {
      const aiImageId = aiImageRecords[mockup.aiImageIndex]?.id;
      if (!aiImageId) {
        console.warn(`⚠️ Skipping mockup at position ${mockup.position}: no AI image at index ${mockup.aiImageIndex}`);
        continue;
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
          product_id: productId,
          printify_custom_product_id: mockup.printifyProductId,
          storage_path: fileName,
          variant_attributes: mockup.variantAttributes,
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
