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
// Body: { seedImageBase64, seedImageMimeType, backgroundColor, colorName, breeds, petNames, numberOfPets, feedbackText, refineMode? }
// Supports single pet (breed/petName strings) or multiple pets (breeds/petNames arrays)
// refineMode: true — applies only feedbackText to the provided image, keeps everything else identical
// Returns: { imageBase64, mimeType }
router.post("/generate-variant", async (req, res) => {
  try {
    const {
      seedImageBase64,
      seedImageMimeType = "image/png",
      backgroundColor,
      colorName,
      // Support both old single-value and new array formats
      breed: singleBreed,
      petName: singlePetName,
      breeds: breedsArray,
      petNames: petNamesArray,
      numberOfPets = 1,
      feedbackText = "",
      refineMode = false,
    } = req.body;

    // Normalize to arrays
    const breeds = breedsArray || (singleBreed ? [singleBreed] : []);
    const petNames = petNamesArray || (singlePetName ? [singlePetName] : []);
    const petCount = numberOfPets || breeds.length || 1;

    if (!seedImageBase64) {
      return res.status(400).json({ error: "seedImageBase64 required" });
    }
    if (!refineMode && (!backgroundColor || !colorName || breeds.length === 0 || petNames.length === 0)) {
      return res.status(400).json({ error: "backgroundColor, colorName, breeds, petNames required when not in refineMode" });
    }
    if (refineMode && !feedbackText) {
      return res.status(400).json({ error: "feedbackText required in refineMode" });
    }

    let prompt;

    if (refineMode) {
      prompt = `Edit this image. Apply ONLY this adjustment: ${feedbackText}

CRITICAL — preserve EXACTLY:
- The same crop, framing, and composition (if it's a headshot, keep it a headshot)
- The same artistic medium and style (watercolor brushstrokes, pencil texture, etc.)
- The background color, pet breed, and any name text
- All decorative elements, borders, and layout
- The same image dimensions and aspect ratio`;
    } else {
      const hex = backgroundColor.replace("#", "");
      const r = parseInt(hex.substring(0, 2), 16);
      const g = parseInt(hex.substring(2, 4), 16);
      const b = parseInt(hex.substring(4, 6), 16);
      const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
      const nameColor = luminance < 0.5 ? "white" : "black";

      // Pick a random expression variation for each generation
      const expressions = [
        "with a gentle soft smile",
        "with a neutral calm expression",
        "with a relaxed content look",
        "with a subtle warm smile",
      ];
      const expression = expressions[Math.floor(Math.random() * expressions.length)];

      if (petCount === 1) {
        prompt = `Edit this image. Make ONLY these changes:
1. Background: fill the ENTIRE background with a single pure flat color — ${colorName} (${backgroundColor}). No gradients, no textures, no patterns — just solid ${backgroundColor}.
2. Change the pet breed to a ${breeds[0]} ${expression} — but keep the EXACT same pose, crop, and framing as the original (headshot stays headshot, same zoom level, same scale)
3. Change the name text to "${petNames[0]}" in ${nameColor} color

CRITICAL — preserve EXACTLY:
- The same artistic medium and rendering technique (watercolor wash, pencil strokes, paint texture — match it precisely)
- The same crop, zoom level, and composition — do NOT change from headshot to full-body or vice versa
- All decorative elements, borders, text placement, and layout
- The same image dimensions and aspect ratio
${feedbackText ? `\nAdditional adjustment: ${feedbackText}` : ""}`;
      } else {
        const petDescriptions = breeds.map((breed, i) => `  - A ${breed} ${expressions[Math.floor(Math.random() * expressions.length)]} named "${petNames[i]}"`).join("\n");
        const namesList = petNames.map((n) => `"${n}"`).join(", ");

        prompt = `Edit this image. Make ONLY these changes:
1. Background: fill the ENTIRE background with a single pure flat color — ${colorName} (${backgroundColor}). No gradients, no textures, no patterns — just solid ${backgroundColor}.
2. Replace the pet(s) with ${petCount} pets, keeping the same framing and crop style (if original is headshots, keep headshots):
${petDescriptions}
   The pets should sit naturally together (side by side). Each must be clearly its breed. Keep realistic relative sizes.
3. Show the names ${namesList} as text in the image in ${nameColor} color

CRITICAL — preserve EXACTLY:
- The same artistic medium and rendering technique (watercolor wash, pencil strokes, paint texture — match it precisely)
- The same crop style and composition layout — if the original shows heads/shoulders, keep that framing
- All decorative elements, borders, text placement, and layout
- The same image dimensions and aspect ratio
${feedbackText ? `\nAdditional adjustment: ${feedbackText}` : ""}`;
      }
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
            breeds: img.breeds,
            petNames: img.petNames,
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

// POST /api/product-images/scrape-competitor
// Body: { url: "https://competitor-store.com/products/some-product" }
// Fetches the Shopify product JSON and normalizes into our config shape.
// Returns: { config: { title, descriptionHtml, options, prices, vendor, ... }, rawVariants: [...] }
router.post("/scrape-competitor", async (req, res) => {
  try {
    const { url } = req.body;
    if (!url) return res.status(400).json({ error: "url required" });

    // Normalize URL to .json endpoint
    let jsonUrl = url.replace(/\/$/, "");
    if (!jsonUrl.endsWith(".json")) jsonUrl += ".json";

    const response = await fetch(jsonUrl, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; InstaMe/1.0)" },
    });
    if (!response.ok) throw new Error(`Failed to fetch product (${response.status})`);

    const data = await response.json();
    const product = data.product;
    if (!product) throw new Error("No product data found in response");

    // Extract options
    const options = (product.options || []).map((opt) => ({
      name: opt.name,
      values: opt.values || [],
      // Initialize empty colorMap for Background Color option
      ...(opt.name.toLowerCase().includes("color") || opt.name.toLowerCase().includes("background")
        ? { colorMap: {} }
        : {}),
    }));

    // Build prices map from variants
    // Format: prices[sizeValue][frameValue] = [price, compareAtPrice]
    // Detect which option is which by name heuristics
    const sizeOptIdx = options.findIndex((o) =>
      /size|dimension/i.test(o.name)
    );
    const frameOptIdx = options.findIndex((o) =>
      /frame|border|mount/i.test(o.name)
    );
    const bgOptIdx = options.findIndex((o) =>
      /color|background|colour/i.test(o.name)
    );

    const prices = {};
    for (const variant of product.variants || []) {
      const opts = [variant.option1, variant.option2, variant.option3].filter(Boolean);
      const price = variant.price ? parseFloat(variant.price).toFixed(2) : "0.00";
      const compareAt = variant.compare_at_price
        ? parseFloat(variant.compare_at_price).toFixed(2)
        : null;

      // Build price key based on size and frame options
      // Try to use size as first key and frame as second key (matching existing config convention)
      let key1 = null;
      let key2 = null;

      if (sizeOptIdx !== -1 && frameOptIdx !== -1) {
        key1 = opts[sizeOptIdx] || null;
        key2 = opts[frameOptIdx] || null;
      } else if (options.length >= 2) {
        // Fallback: use option2 as key1, option3 as key2 (skip background color)
        const nonBgOpts = [0, 1, 2].filter((i) => i !== bgOptIdx && i < opts.length);
        key1 = nonBgOpts[0] !== undefined ? opts[nonBgOpts[0]] : null;
        key2 = nonBgOpts[1] !== undefined ? opts[nonBgOpts[1]] : null;
      }

      if (key1 && key2) {
        if (!prices[key1]) prices[key1] = {};
        // Only set if not already set (avoid overwrites from different bg colors)
        if (!prices[key1][key2]) {
          prices[key1][key2] = [price, compareAt];
        }
      } else if (key1) {
        if (!prices[key1]) prices[key1] = [price, compareAt];
      }
    }

    // Build config in our standard shape
    const config = {
      title: product.title || "",
      descriptionHtml: product.body_html || "",
      vendor: "InstaMe",
      productType: product.product_type || "Custom Portrait",
      options,
      prices,
      extras: [],
      personalizationGIDs: [],
      publicationIDs: [
        "gid://shopify/Publication/151855169641",
        "gid://shopify/Publication/151855267945",
      ],
    };

    // Also return raw variants for the UI to display the full price table
    const rawVariants = (product.variants || []).map((v) => ({
      title: v.title,
      price: v.price,
      compare_at_price: v.compare_at_price,
      option1: v.option1,
      option2: v.option2,
      option3: v.option3,
    }));

    res.json({ config, rawVariants, sourceTitle: product.title, sourceVendor: product.vendor });
  } catch (err) {
    console.error("❌ scrape-competitor:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/product-images/create-from-scrape
// Body: { config: { title, descriptionHtml, vendor, productType, options, prices, personalizationGIDs, publicationIDs, ... } }
// Creates the full Shopify product and saves config to Supabase.
// Returns: { shopifyProductId, shopifyProductNumericId, adminUrl, supabaseProductId }
router.post("/create-from-scrape", async (req, res) => {
  try {
    const { config } = req.body;
    if (!config?.title || !config?.options?.length) {
      return res.status(400).json({ error: "config with title and options required" });
    }

    const SHOPIFY_SHOP = process.env.SHOPIFY_SHOP;
    const SHOPIFY_API_VERSION = "2026-01";

    // Get Shopify access token
    const tokenRes = await fetch(`https://${SHOPIFY_SHOP}/admin/oauth/access_token`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        client_id: process.env.SHOPIFY_CLIENT_ID,
        client_secret: process.env.SHOPIFY_CLIENT_SECRET,
        grant_type: "client_credentials",
      }),
    });
    const { access_token: token } = await tokenRes.json();
    if (!token) throw new Error("Failed to get Shopify access token");

    async function gql(query, variables = {}) {
      const r = await fetch(
        `https://${SHOPIFY_SHOP}/admin/api/${SHOPIFY_API_VERSION}/graphql.json`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": token },
          body: JSON.stringify({ query, variables }),
        }
      );
      return r.json();
    }

    // 1. Create product as DRAFT
    const createResult = await gql(
      `mutation productCreate($product: ProductCreateInput!) {
        productCreate(product: $product) {
          product { id title status }
          userErrors { field message }
        }
      }`,
      {
        product: {
          title: config.title,
          descriptionHtml: config.descriptionHtml || "",
          vendor: config.vendor || "InstaMe",
          productType: config.productType || "",
          status: "DRAFT",
        },
      }
    );
    const createErrors = createResult.data?.productCreate?.userErrors;
    if (createErrors?.length) throw new Error("productCreate: " + JSON.stringify(createErrors));
    const productId = createResult.data.productCreate.product.id;

    // 2. Create options
    const optionsResult = await gql(
      `mutation productOptionsCreate($productId: ID!, $options: [OptionCreateInput!]!) {
        productOptionsCreate(productId: $productId, options: $options) {
          product { options { id name position optionValues { id name } } }
          userErrors { field message }
        }
      }`,
      {
        productId,
        options: config.options.map((o) => ({
          name: o.name,
          values: o.values.map((v) => ({ name: v })),
        })),
      }
    );
    const optErrors = optionsResult.data?.productOptionsCreate?.userErrors;
    if (optErrors?.length) throw new Error("productOptionsCreate: " + JSON.stringify(optErrors));
    const shopifyOptions = optionsResult.data.productOptionsCreate.product.options;
    const optionMap = Object.fromEntries(shopifyOptions.map((o) => [o.name, o]));

    // 3. Build and create variants
    const [opt1, opt2, opt3] = config.options;
    const allVariants = [];

    for (const v1 of opt1.values) {
      for (const v2 of opt2?.values ?? [null]) {
        for (const v3 of opt3?.values ?? [null]) {
          let priceEntry =
            config.prices?.[v2]?.[v3] ??
            config.prices?.[v1]?.[v2] ??
            config.prices?.[v1] ??
            null;

          const [price, compareAtPrice] = Array.isArray(priceEntry) ? priceEntry : ["0.00", null];

          const optionValues = [
            { optionId: optionMap[opt1.name].id, name: v1 },
            ...(opt2 ? [{ optionId: optionMap[opt2.name].id, name: v2 }] : []),
            ...(opt3 ? [{ optionId: optionMap[opt3.name].id, name: v3 }] : []),
          ];

          allVariants.push({ optionValues, price, compareAtPrice, inventoryPolicy: "CONTINUE" });
        }
      }
    }

    // Check for auto-created variants
    const existingData = await gql(
      `query { product(id: "${productId}") { variants(first: 100) { nodes { id title } } } }`
    );
    const existingTitles = new Set(existingData.data.product.variants.nodes.map((v) => v.title));
    const existingIds = Object.fromEntries(
      existingData.data.product.variants.nodes.map((v) => [v.title, v.id])
    );

    const toCreate = allVariants.filter(
      (v) => !existingTitles.has(v.optionValues.map((o) => o.name).join(" / "))
    );
    const toUpdate = allVariants.filter((v) =>
      existingTitles.has(v.optionValues.map((o) => o.name).join(" / "))
    );

    if (toUpdate.length > 0) {
      const updateInputs = toUpdate.map((v) => ({
        id: existingIds[v.optionValues.map((o) => o.name).join(" / ")],
        price: v.price,
        compareAtPrice: v.compareAtPrice,
        inventoryPolicy: "CONTINUE",
      }));
      const r = await gql(
        `mutation productVariantsBulkUpdate($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
          productVariantsBulkUpdate(productId: $productId, variants: $variants) {
            productVariants { id }
            userErrors { field message }
          }
        }`,
        { productId, variants: updateInputs }
      );
      const ue = r.data?.productVariantsBulkUpdate?.userErrors;
      if (ue?.length) throw new Error("variantsBulkUpdate: " + JSON.stringify(ue));
    }

    const BATCH = 25;
    for (let i = 0; i < toCreate.length; i += BATCH) {
      const batch = toCreate.slice(i, i + BATCH);
      const r = await gql(
        `mutation productVariantsBulkCreate($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
          productVariantsBulkCreate(productId: $productId, variants: $variants) {
            productVariants { id title }
            userErrors { field message }
          }
        }`,
        { productId, variants: batch }
      );
      const ue = r.data?.productVariantsBulkCreate?.userErrors;
      if (ue?.length) throw new Error("variantsBulkCreate: " + JSON.stringify(ue));
    }

    // 4. Disable inventory tracking on all variants
    const invResult = await gql(
      `query { product(id: "${productId}") {
        variants(first: 250) { nodes { inventoryItem { id tracked } } }
      }}`
    );
    const trackedItems = invResult.data.product.variants.nodes
      .map((v) => v.inventoryItem)
      .filter((i) => i.tracked);

    for (const item of trackedItems) {
      const r = await gql(
        `mutation inventoryItemUpdate($id: ID!, $input: InventoryItemInput!) {
          inventoryItemUpdate(id: $id, input: $input) {
            inventoryItem { id }
            userErrors { field message }
          }
        }`,
        { id: item.id, input: { tracked: false } }
      );
      const ue = r.data?.inventoryItemUpdate?.userErrors;
      if (ue?.length) throw new Error("inventoryItemUpdate: " + JSON.stringify(ue));
    }

    // 5. Set personalization metafield if provided
    if (config.personalizationGIDs?.length) {
      const r = await gql(
        `mutation productUpdate($product: ProductUpdateInput!) {
          productUpdate(product: $product) {
            product { id }
            userErrors { field message }
          }
        }`,
        {
          product: {
            id: productId,
            metafields: [
              {
                namespace: "custom",
                key: "personalization_options",
                type: "list.metaobject_reference",
                value: JSON.stringify(config.personalizationGIDs),
              },
            ],
          },
        }
      );
      const ue = r.data?.productUpdate?.userErrors;
      if (ue?.length) throw new Error("metafield: " + JSON.stringify(ue));
    }

    // 6. Publish to Online Store + Shop
    if (config.publicationIDs?.length) {
      const r = await gql(
        `mutation publishablePublish($id: ID!, $input: [PublicationInput!]!) {
          publishablePublish(id: $id, input: $input) {
            publishable { ... on Product { id title } }
            userErrors { field message }
          }
        }`,
        {
          id: productId,
          input: config.publicationIDs.map((publicationId) => ({ publicationId })),
        }
      );
      const ue = r.data?.publishablePublish?.userErrors;
      if (ue?.length) throw new Error("publish: " + JSON.stringify(ue));
    }

    // 7. Save config to Supabase
    const db = getInstameshopSupabase();
    const { data: row, error: dbErr } = await db
      .from("products")
      .insert({
        shopify_product_id: productId,
        name: config.title,
        product_type: config.productType || "portrait",
        config,
      })
      .select()
      .single();
    if (dbErr) throw new Error("Supabase insert failed: " + dbErr.message);

    const numericId = productId.split("/").pop();
    const adminUrl = `https://${SHOPIFY_SHOP}/admin/products/${numericId}`;

    res.json({
      shopifyProductId: productId,
      shopifyProductNumericId: numericId,
      adminUrl,
      supabaseProductId: row.id,
    });
  } catch (err) {
    console.error("❌ create-from-scrape:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/product-images/metaobjects
// Returns existing personalization_fields metaobjects for the UI to display as options.
router.get("/metaobjects", async (req, res) => {
  try {
    const SHOPIFY_SHOP = process.env.SHOPIFY_SHOP;
    const SHOPIFY_API_VERSION = "2026-01";

    const tokenRes = await fetch(`https://${SHOPIFY_SHOP}/admin/oauth/access_token`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        client_id: process.env.SHOPIFY_CLIENT_ID,
        client_secret: process.env.SHOPIFY_CLIENT_SECRET,
        grant_type: "client_credentials",
      }),
    });
    const { access_token: token } = await tokenRes.json();

    const r = await fetch(
      `https://${SHOPIFY_SHOP}/admin/api/${SHOPIFY_API_VERSION}/graphql.json`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": token },
        body: JSON.stringify({
          query: `{
            metaobjects(type: "personalization_fields", first: 50) {
              nodes { id handle displayName fields { key value } }
            }
          }`,
        }),
      }
    );
    const data = await r.json();
    const nodes = data.data?.metaobjects?.nodes || [];

    res.json({
      metaobjects: nodes.map((n) => ({
        id: n.id,
        handle: n.handle,
        label: n.fields?.find((f) => f.key === "name")?.value || n.displayName || n.handle,
      })),
    });
  } catch (err) {
    console.error("❌ metaobjects:", err.message);
    res.status(500).json({ error: err.message });
  }
});

export default router;
