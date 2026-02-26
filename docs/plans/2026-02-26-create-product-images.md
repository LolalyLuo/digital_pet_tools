# Create Product Images — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a 5-step wizard in the "Create Product Images" page that takes a seed AI image + Shopify product + Printify product, generates background-color variants via Gemini, creates Printify mockup products, and uploads selected mockup images to the correct Shopify variants.

**Architecture:** New route files (`printifyRoutes.js`, `productImagesRoutes.js`) handle all external API calls server-side; `shopifyRoutes.js` gets two new endpoints. The frontend is a stepper in `CreateProducts.jsx` with 5 sub-components under `src/components/createProducts/`. All Supabase writes use the InstaMeShop DB via `getInstameshopSupabase()`.

**Tech Stack:** React 19, Tailwind CSS v4, Express.js (port 3001), Shopify Admin GraphQL API 2025-01, Printify REST API v1, Gemini `gemini-3-pro-image-preview`, OpenAI (breed/name generation), Supabase InstaMeShop DB (`igwekemyevllvmgqdmtl`)

---

## Task 1: Rename nav label + scaffold stepper shell

**Files:**
- Modify: `src/App.jsx` line 26
- Modify: `src/components/CreateProducts.jsx`
- Create: `src/components/createProducts/` (directory — just create placeholder)

**Step 1: Rename the nav label**

In `src/App.jsx`, change line 26:
```js
// FROM:
{ id: "create-products", label: "Create Products" },
// TO:
{ id: "create-products", label: "Create Product Images" },
```

**Step 2: Replace the stub with a stepper shell**

Replace all of `src/components/CreateProducts.jsx` with:
```jsx
import { useState } from "react";
import InputsStep from "./createProducts/InputsStep";
import ConfigureVariantsStep from "./createProducts/ConfigureVariantsStep";
import GenerateImagesStep from "./createProducts/GenerateImagesStep";
import PrintifyMockupsStep from "./createProducts/PrintifyMockupsStep";
import ConfirmUploadStep from "./createProducts/ConfirmUploadStep";

const STEPS = [
  { id: "inputs", label: "Inputs" },
  { id: "configure", label: "Configure Variants" },
  { id: "generate", label: "Generate Images" },
  { id: "mockups", label: "Printify Mockups" },
  { id: "confirm", label: "Confirm & Upload" },
];

function CreateProducts() {
  const [currentStep, setCurrentStep] = useState(0);
  const [sessionData, setSessionData] = useState({});

  const updateSession = (updates) =>
    setSessionData((prev) => ({ ...prev, ...updates }));

  const next = () => setCurrentStep((s) => Math.min(s + 1, STEPS.length - 1));
  const back = () => setCurrentStep((s) => Math.max(s - 1, 0));

  return (
    <div className="flex-1 p-8 overflow-auto">
      <div className="max-w-5xl mx-auto">
        {/* Progress bar */}
        <div className="flex items-center mb-10">
          {STEPS.map((step, i) => (
            <div key={step.id} className="flex items-center flex-1 last:flex-none">
              <div className="flex flex-col items-center">
                <div
                  className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-semibold border-2 ${
                    i < currentStep
                      ? "bg-blue-600 border-blue-600 text-white"
                      : i === currentStep
                      ? "border-blue-600 text-blue-600 bg-white"
                      : "border-gray-300 text-gray-400 bg-white"
                  }`}
                >
                  {i < currentStep ? "✓" : i + 1}
                </div>
                <span
                  className={`text-xs mt-1 whitespace-nowrap ${
                    i === currentStep ? "text-blue-600 font-medium" : "text-gray-400"
                  }`}
                >
                  {step.label}
                </span>
              </div>
              {i < STEPS.length - 1 && (
                <div
                  className={`flex-1 h-0.5 mx-2 mb-5 ${
                    i < currentStep ? "bg-blue-600" : "bg-gray-200"
                  }`}
                />
              )}
            </div>
          ))}
        </div>

        {/* Step content */}
        {currentStep === 0 && (
          <InputsStep sessionData={sessionData} updateSession={updateSession} onNext={next} />
        )}
        {currentStep === 1 && (
          <ConfigureVariantsStep sessionData={sessionData} updateSession={updateSession} onNext={next} onBack={back} />
        )}
        {currentStep === 2 && (
          <GenerateImagesStep sessionData={sessionData} updateSession={updateSession} onNext={next} onBack={back} />
        )}
        {currentStep === 3 && (
          <PrintifyMockupsStep sessionData={sessionData} updateSession={updateSession} onNext={next} onBack={back} />
        )}
        {currentStep === 4 && (
          <ConfirmUploadStep sessionData={sessionData} updateSession={updateSession} onBack={back} />
        )}
      </div>
    </div>
  );
}

export default CreateProducts;
```

**Step 3: Create stub files for each step** (so imports don't break)

Create `src/components/createProducts/InputsStep.jsx`:
```jsx
export default function InputsStep({ sessionData, updateSession, onNext }) {
  return <div className="p-4 text-gray-500">InputsStep — coming soon</div>;
}
```
Repeat for `ConfigureVariantsStep.jsx`, `GenerateImagesStep.jsx`, `PrintifyMockupsStep.jsx`, `ConfirmUploadStep.jsx` with matching function names.

**Step 4: Verify in browser**

Open http://localhost:5173 → dropdown → confirm "Create Product Images" label and the 5-step progress bar renders without errors.

**Step 5: Commit**
```bash
git add src/App.jsx src/components/CreateProducts.jsx src/components/createProducts/
git commit -m "feat: scaffold Create Product Images stepper with 5-step progress bar"
```

---

## Task 2: Backend — Shopify product fetch endpoint

**Files:**
- Modify: `local-api/routes/shopifyRoutes.js`

**Context:** The file already has `getAccessToken()` and `shopifyGraphQL()` helpers. Add a new route below the existing `test-publish` endpoint.

**Step 1: Add `GET /api/shopify/product/:id`**

Append to `local-api/routes/shopifyRoutes.js` before `export default router`:

```js
// GET /api/shopify/product/:id
// Fetches product title + variant options from Shopify
router.get("/product/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const gid = `gid://shopify/Product/${id}`;
    const token = await getAccessToken();

    const result = await shopifyGraphQL(token, `
      query getProduct($id: ID!) {
        product(id: $id) {
          id
          title
          options {
            id
            name
            values
          }
          variants(first: 250) {
            edges {
              node {
                id
                title
                price
                selectedOptions {
                  name
                  value
                }
              }
            }
          }
        }
      }
    `, { id: gid });

    const product = result.data?.product;
    if (!product) {
      return res.status(404).json({ error: "Product not found" });
    }

    res.json({
      id: product.id,
      numericId: id,
      title: product.title,
      options: product.options,
      variants: product.variants.edges.map((e) => e.node),
    });
  } catch (err) {
    console.error("❌ Shopify product fetch error:", err.message);
    res.status(500).json({ error: err.message });
  }
});
```

**Step 2: Verify with curl**

Restart the local-api server (`cd local-api && node server.js`), then:
```bash
curl "http://localhost:3001/api/shopify/product/7717360238697"
```
Expected: JSON with `title`, `options` array (each with `name` + `values`), `variants` array.

**Step 3: Commit**
```bash
git add local-api/routes/shopifyRoutes.js
git commit -m "feat: add Shopify product fetch endpoint GET /api/shopify/product/:id"
```

---

## Task 3: Backend — Shopify variant images endpoint

**Files:**
- Modify: `local-api/routes/shopifyRoutes.js`

**Context:** We need to (1) upload an image from a URL to Shopify as a media object, (2) poll until READY, (3) assign the `mediaId` to variants. Multiple variants can share the same `mediaId`.

**Step 1: Add `POST /api/shopify/variant-images`**

Append to `local-api/routes/shopifyRoutes.js` before `export default router`:

```js
// POST /api/shopify/variant-images
// Body: { productId: "123", assignments: [{ imageUrl: "https://...", variantIds: ["gid://..."] }] }
// Uploads each unique image once, then assigns mediaIds to variants in one batch call.
router.post("/variant-images", async (req, res) => {
  try {
    const { productId, assignments } = req.body;
    if (!productId || !assignments?.length) {
      return res.status(400).json({ error: "productId and assignments required" });
    }

    const shopifyProductGid = `gid://shopify/Product/${productId}`;
    const token = await getAccessToken();

    // Step 1: Upload each unique imageUrl once → collect mediaId per URL
    const urlToMediaId = {};
    for (const { imageUrl } of assignments) {
      if (urlToMediaId[imageUrl]) continue; // already uploaded

      const uploadResult = await shopifyGraphQL(token, `
        mutation productCreateMedia($productId: ID!, $media: [CreateMediaInput!]!) {
          productCreateMedia(productId: $productId, media: $media) {
            media {
              id
              status
            }
            mediaUserErrors { field message }
          }
        }
      `, {
        productId: shopifyProductGid,
        media: [{ originalSource: imageUrl, mediaContentType: "IMAGE" }],
      });

      const mediaErrors = uploadResult.data?.productCreateMedia?.mediaUserErrors;
      if (mediaErrors?.length) {
        return res.status(400).json({ error: "Media upload error", details: mediaErrors });
      }

      const mediaId = uploadResult.data?.productCreateMedia?.media?.[0]?.id;
      if (!mediaId) {
        return res.status(500).json({ error: "No mediaId returned for " + imageUrl });
      }

      // Step 2: Poll until READY (max 30s)
      let ready = false;
      for (let attempt = 0; attempt < 15; attempt++) {
        await new Promise((r) => setTimeout(r, 2000));
        const statusResult = await shopifyGraphQL(token, `
          query { node(id: "${mediaId}") { ... on MediaImage { id status } } }
        `);
        const status = statusResult.data?.node?.status;
        if (status === "READY") { ready = true; break; }
        if (status === "FAILED") {
          return res.status(500).json({ error: `Media ${mediaId} failed processing` });
        }
      }
      if (!ready) {
        return res.status(500).json({ error: `Media ${mediaId} timed out` });
      }

      urlToMediaId[imageUrl] = mediaId;
    }

    // Step 3: Batch-assign all variant → mediaId pairs in one call
    const variantMedia = assignments.flatMap(({ imageUrl, variantIds }) =>
      variantIds.map((variantId) => ({
        variantId,
        mediaIds: [urlToMediaId[imageUrl]],
      }))
    );

    const assignResult = await shopifyGraphQL(token, `
      mutation productVariantAppendMedia($productId: ID!, $variantMedia: [ProductVariantAppendMediaInput!]!) {
        productVariantAppendMedia(productId: $productId, variantMedia: $variantMedia) {
          product { id }
          userErrors { field message }
        }
      }
    `, { productId: shopifyProductGid, variantMedia });

    const assignErrors = assignResult.data?.productVariantAppendMedia?.userErrors;
    if (assignErrors?.length) {
      return res.status(400).json({ error: "Variant assign error", details: assignErrors });
    }

    res.json({ success: true, uploadedMedia: urlToMediaId });
  } catch (err) {
    console.error("❌ variant-images error:", err.message);
    res.status(500).json({ error: err.message });
  }
});
```

**Step 2: Verify manually later** (requires real image URLs and variant IDs — tested as part of Step 5 E2E flow)

**Step 3: Commit**
```bash
git add local-api/routes/shopifyRoutes.js
git commit -m "feat: add Shopify variant images endpoint POST /api/shopify/variant-images"
```

---

## Task 4: Backend — Printify routes

**Files:**
- Create: `local-api/routes/printifyRoutes.js`
- Modify: `local-api/server.js`

**Context:** Printify API base URL is `https://api.printify.com/v1`. API key = `process.env.PRINTIFY_API_KEY`. InstaMe Shop ID = `process.env.INSTAME_SHOP_PRINTIFY_SHOP_ID`. The `createProductDirect` pattern: fetch template from seed product → upload image → create new product with same blueprint/variants/print_areas but new image ID.

**Step 1: Create `local-api/routes/printifyRoutes.js`**

```js
import express from "express";

const router = express.Router();

const PRINTIFY_API = "https://api.printify.com/v1";
const getShopId = () => process.env.INSTAME_SHOP_PRINTIFY_SHOP_ID;
const getApiKey = () => process.env.PRINTIFY_API_KEY;

async function printifyFetch(path, options = {}) {
  const res = await fetch(`${PRINTIFY_API}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${getApiKey()}`,
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Printify ${options.method || "GET"} ${path} failed (${res.status}): ${text}`);
  }
  return res.json();
}

// Replace the image ID inside Printify print_areas, keeping all other structure intact
function replacePrintAreaImage(printAreas, newImageId) {
  return printAreas.map((area) => ({
    ...area,
    placeholders: area.placeholders.map((ph) => ({
      ...ph,
      images: ph.images.map((img) => ({
        ...img,
        id: newImageId,
      })),
    })),
  }));
}

// GET /api/printify/product/:id
// Returns the template fields needed to create a new product: blueprint_id, print_provider_id, variants, print_areas, title
router.get("/product/:id", async (req, res) => {
  try {
    const product = await printifyFetch(
      `/shops/${getShopId()}/products/${req.params.id}.json`
    );
    res.json({
      id: product.id,
      title: product.title,
      blueprint_id: product.blueprint_id,
      print_provider_id: product.print_provider_id,
      variants: product.variants
        .filter((v) => v.is_enabled)
        .map((v) => ({ id: v.id, price: v.price })),
      print_areas: product.print_areas,
      images: product.images, // mockup images of the seed product
    });
  } catch (err) {
    console.error("❌ Printify product fetch:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/printify/upload-image
// Body: { fileName: "image.png", imageBase64: "<base64 string>" }
// Returns: { id: "<printify image id>" }
router.post("/upload-image", async (req, res) => {
  try {
    const { fileName, imageBase64 } = req.body;
    if (!fileName || !imageBase64) {
      return res.status(400).json({ error: "fileName and imageBase64 required" });
    }
    const data = await printifyFetch("/uploads/images.json", {
      method: "POST",
      body: JSON.stringify({ file_name: fileName, contents: imageBase64 }),
    });
    res.json({ id: data.id });
  } catch (err) {
    console.error("❌ Printify upload-image:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/printify/create-product
// Body: { template: { blueprint_id, print_provider_id, variants, print_areas, title }, uploadedImageId, customTitle }
// Returns: { product } — full product object including images array with mockup URLs
router.post("/create-product", async (req, res) => {
  try {
    const { template, uploadedImageId, customTitle } = req.body;
    if (!template || !uploadedImageId || !customTitle) {
      return res.status(400).json({ error: "template, uploadedImageId, customTitle required" });
    }

    const productData = {
      title: customTitle,
      description: template.description || customTitle,
      blueprint_id: template.blueprint_id,
      print_provider_id: template.print_provider_id,
      variants: template.variants.map((v) => ({
        id: v.id,
        price: v.price,
        is_enabled: true,
      })),
      print_areas: replacePrintAreaImage(template.print_areas, uploadedImageId),
    };

    const created = await printifyFetch(
      `/shops/${getShopId()}/products.json`,
      { method: "POST", body: JSON.stringify(productData) }
    );

    // Fetch full product details (includes mockup images)
    const full = await printifyFetch(
      `/shops/${getShopId()}/products/${created.id}.json`
    );

    res.json({ product: full });
  } catch (err) {
    console.error("❌ Printify create-product:", err.message);
    res.status(500).json({ error: err.message });
  }
});

export default router;
```

**Step 2: Mount in `local-api/server.js`**

Add import after the existing `shopifyRoutes` import:
```js
import printifyRoutes from "./routes/printifyRoutes.js";
```

Add mount after `app.use("/api/shopify", shopifyRoutes)`:
```js
app.use("/api/printify", printifyRoutes);
```

**Step 3: Verify with curl**
```bash
curl "http://localhost:3001/api/printify/product/699f91fcf38bdbd36701b743"
```
Expected: JSON with `blueprint_id`, `print_provider_id`, `variants` array, `print_areas` array, `images` array.

**Step 4: Commit**
```bash
git add local-api/routes/printifyRoutes.js local-api/server.js
git commit -m "feat: add Printify routes (fetch product, upload image, create product)"
```

---

## Task 5: Backend — Product Images business logic routes

**Files:**
- Create: `local-api/routes/productImagesRoutes.js`
- Modify: `local-api/server.js`
- Modify: `local-api/middleware/upload.js` (check if multipart middleware exists, use it or add multer)

**Context:** These routes handle the business logic that doesn't belong in Shopify/Printify wrappers: initializing Supabase records, generating breed/name combos with OpenAI, generating variant images with Gemini, saving final results. All Supabase operations use `getInstameshopSupabase()`. The Gemini model to use is `gemini-3-pro-image-preview` via `getGenAI()` from imageUtils.js.

Check `local-api/middleware/upload.js` first to see if multer is already configured.

**Step 1: Check existing upload middleware**
```bash
cat local-api/middleware/upload.js
```
If multer is there, note the export name. If not, `npm install multer` in `local-api/` and use it.

**Step 2: Create `local-api/routes/productImagesRoutes.js`**

```js
import express from "express";
import multer from "multer";
import { getInstameshopSupabase } from "../config/database.js";
import { getGenAI } from "../utils/imageUtils.js";

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage() });

// POST /api/product-images/init
// Multipart: seedImage file + JSON fields: shopifyProductId, shopifyProductTitle
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
    const openai = (await import("openai")).default;
    const client = new openai({ apiKey: process.env.OPENAI_API_KEY });

    const completion = await client.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "user",
          content: `Generate ${count} unique and diverse ${animalType} breed + name combinations for a product image.
Each should be a different breed (no repeats). Names should be cute pet names.
Respond with ONLY valid JSON array: [{"breed":"...", "name":"..."}, ...]
No markdown, no explanation.`,
        },
      ],
      max_tokens: 300,
    });

    const raw = completion.choices[0].message.content.trim();
    const combos = JSON.parse(raw);
    res.json({ combos });
  } catch (err) {
    console.error("❌ breed-names:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/product-images/generate-variant
// Body: { seedImageBase64: "<base64>", seedImageMimeType: "image/png",
//         backgroundColor: "#F5F5F5", colorName: "Light Grey", breed: "Maine Coon",
//         petName: "Oliver", feedbackText: "" }
// Returns: { imageBase64, mimeType }
router.post("/generate-variant", async (req, res) => {
  try {
    const { seedImageBase64, seedImageMimeType = "image/png",
            backgroundColor, colorName, breed, petName, feedbackText = "" } = req.body;

    if (!seedImageBase64 || !backgroundColor || !breed || !petName) {
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

// POST /api/product-images/save-results
// Body: { productId, seedImageId, aiImages: [{ imageBase64, mimeType, colorName, hexCode, breed, petName }],
//         mockupImages: [{ aiImageIndex, printifyProductId, position, src, variantAttributes }] }
// Saves ai_generated_images + product_mockup_images rows to InstaMeShop DB
// Returns: { aiImageIds: [...], mockupImageIds: [...] }
router.post("/save-results", async (req, res) => {
  try {
    const { productId, seedImageId, aiImages, mockupImages } = req.body;
    if (!productId || !seedImageId || !aiImages?.length) {
      return res.status(400).json({ error: "productId, seedImageId, aiImages required" });
    }

    const db = getInstameshopSupabase();
    const aiImageIds = [];

    // Upload each AI image to storage + insert row
    for (const img of aiImages) {
      const buffer = Buffer.from(img.imageBase64, "base64");
      const ext = img.mimeType === "image/jpeg" ? "jpg" : "png";
      const fileName = `ai_${Date.now()}_${img.colorName.replace(/\s/g, "_")}.${ext}`;

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
          generation_params: { colorName: img.colorName, hexCode: img.hexCode, breed: img.breed, petName: img.petName },
        })
        .select()
        .single();
      if (dbErr) throw new Error(`ai_generated_images insert failed: ${dbErr.message}`);

      aiImageIds.push({ id: row.id, publicUrl });
    }

    // Download and save mockup images
    const mockupImageIds = [];
    for (const mockup of (mockupImages || [])) {
      const aiImageId = aiImageIds[mockup.aiImageIndex]?.id;
      if (!aiImageId) continue;

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

    res.json({ aiImageIds: aiImageIds.map((r) => r.id), mockupImageIds });
  } catch (err) {
    console.error("❌ save-results:", err.message);
    res.status(500).json({ error: err.message });
  }
});

export default router;
```

**Step 3: Check if `getGenAI` is exported from imageUtils.js**
```bash
grep -n "export.*getGenAI\|module.exports.*getGenAI" local-api/utils/imageUtils.js
```
If it is not exported, find where it's defined and add `export` to it, or replicate the Gemini client init inline in the route.

**Step 4: Mount in `local-api/server.js`**

Add import:
```js
import productImagesRoutes from "./routes/productImagesRoutes.js";
```
Add mount:
```js
app.use("/api/product-images", productImagesRoutes);
```

**Step 5: Verify breed-names endpoint**
```bash
curl -X POST http://localhost:3001/api/product-images/breed-names \
  -H "Content-Type: application/json" \
  -d '{"count": 3, "animalType": "dog"}'
```
Expected: `{"combos":[{"breed":"...","name":"..."},...]}`

**Step 6: Commit**
```bash
git add local-api/routes/productImagesRoutes.js local-api/server.js
git commit -m "feat: add product-images routes (init, breed-names, generate-variant, save-results)"
```

---

## Task 6: Frontend — Step 1 (Inputs)

**Files:**
- Modify: `src/components/createProducts/InputsStep.jsx`

**Context:** All API calls go to `http://localhost:3001`. Use `fetch`. The step collects: seed image file, Shopify product URL, Printify product URL. On "Next": call `POST /api/product-images/init` (multipart), store `productId`, `seedImageId`, `seedImageUrl`, `shopifyProduct`, `printifyTemplate` in `sessionData`.

**Step 1: Implement InputsStep.jsx**

```jsx
import { useState, useCallback, useRef } from "react";

function StatusBadge({ status, label }) {
  if (status === "loading") return <span className="text-xs text-blue-500 ml-2">Checking...</span>;
  if (status === "ok") return <span className="text-xs text-green-600 ml-2">✓ {label}</span>;
  if (status === "error") return <span className="text-xs text-red-500 ml-2">✗ {label}</span>;
  return null;
}

export default function InputsStep({ sessionData, updateSession, onNext }) {
  const [seedFile, setSeedFile] = useState(null);
  const [seedPreview, setSeedPreview] = useState(null);
  const [shopifyUrl, setShopifyUrl] = useState("");
  const [printifyUrl, setPrintifyUrl] = useState("");
  const [shopifyStatus, setShopifyStatus] = useState(null); // null | "loading" | "ok" | "error"
  const [printifyStatus, setPrintifyStatus] = useState(null);
  const [shopifyLabel, setShopifyLabel] = useState("");
  const [printifyLabel, setPrintifyLabel] = useState("");
  const [shopifyData, setShopifyData] = useState(null);
  const [printifyData, setPrintifyData] = useState(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(null);
  const shopifyTimer = useRef(null);
  const printifyTimer = useRef(null);

  const handleSeedFile = (file) => {
    if (!file) return;
    setSeedFile(file);
    const reader = new FileReader();
    reader.onload = (e) => setSeedPreview(e.target.result);
    reader.readAsDataURL(file);
  };

  const extractShopifyId = (url) => {
    const match = url.match(/\/products\/(\d+)/);
    return match?.[1] || null;
  };

  const extractPrintifyId = (url) => {
    const match = url.match(/product-details\/([a-f0-9]+)/);
    return match?.[1] || null;
  };

  const fetchShopify = async (url) => {
    const id = extractShopifyId(url);
    if (!id) { setShopifyStatus("error"); setShopifyLabel("Invalid URL"); return; }
    setShopifyStatus("loading");
    try {
      const res = await fetch(`http://localhost:3001/api/shopify/product/${id}`);
      if (!res.ok) throw new Error("Not found");
      const data = await res.json();
      setShopifyData(data);
      setShopifyStatus("ok");
      setShopifyLabel(data.title);
    } catch {
      setShopifyStatus("error");
      setShopifyLabel("Could not fetch product");
    }
  };

  const fetchPrintify = async (url) => {
    const id = extractPrintifyId(url);
    if (!id) { setPrintifyStatus("error"); setPrintifyLabel("Invalid URL"); return; }
    setPrintifyStatus("loading");
    try {
      const res = await fetch(`http://localhost:3001/api/printify/product/${id}`);
      if (!res.ok) throw new Error("Not found");
      const data = await res.json();
      setPrintifyData(data);
      setPrintifyStatus("ok");
      setPrintifyLabel(data.title);
    } catch {
      setPrintifyStatus("error");
      setPrintifyLabel("Could not fetch product");
    }
  };

  const onShopifyChange = (val) => {
    setShopifyUrl(val);
    setShopifyStatus(null);
    clearTimeout(shopifyTimer.current);
    if (val.includes("admin.shopify.com")) {
      shopifyTimer.current = setTimeout(() => fetchShopify(val), 600);
    }
  };

  const onPrintifyChange = (val) => {
    setPrintifyUrl(val);
    setPrintifyStatus(null);
    clearTimeout(printifyTimer.current);
    if (val.includes("printify.com")) {
      printifyTimer.current = setTimeout(() => fetchPrintify(val), 600);
    }
  };

  const canNext = seedFile && shopifyStatus === "ok" && printifyStatus === "ok" && !saving;

  const handleNext = async () => {
    setSaving(true);
    setSaveError(null);
    try {
      const formData = new FormData();
      formData.append("seedImage", seedFile);
      formData.append("shopifyProductId", shopifyData.id);
      formData.append("shopifyProductTitle", shopifyData.title);

      const res = await fetch("http://localhost:3001/api/product-images/init", {
        method: "POST",
        body: formData,
      });
      if (!res.ok) throw new Error(await res.text());
      const { productId, seedImageId, seedImageUrl } = await res.json();

      updateSession({
        productId,
        seedImageId,
        seedImageUrl,
        seedFileDataUrl: seedPreview,
        shopifyProduct: shopifyData,
        printifyTemplate: printifyData,
        shopifyProductNumericId: extractShopifyId(shopifyUrl),
        printifyProductId: extractPrintifyId(printifyUrl),
      });
      onNext();
    } catch (err) {
      setSaveError(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-8">
      <h2 className="text-xl font-semibold text-gray-800">Step 1 — Inputs</h2>

      {/* Seed Image */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">Seed AI Image</label>
        <div
          className="border-2 border-dashed border-gray-300 rounded-lg p-6 text-center cursor-pointer hover:border-blue-400 transition-colors"
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => { e.preventDefault(); handleSeedFile(e.dataTransfer.files[0]); }}
          onClick={() => document.getElementById("seed-file-input").click()}
        >
          {seedPreview ? (
            <img src={seedPreview} alt="Seed" className="max-h-48 mx-auto rounded-lg object-contain" />
          ) : (
            <p className="text-gray-400 text-sm">Drag & drop seed image or click to select</p>
          )}
        </div>
        <input id="seed-file-input" type="file" accept="image/*" className="hidden"
          onChange={(e) => handleSeedFile(e.target.files[0])} />
      </div>

      {/* Shopify URL */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">
          Shopify Product URL
          <StatusBadge status={shopifyStatus} label={shopifyLabel} />
        </label>
        <input
          type="text"
          placeholder="https://admin.shopify.com/store/instame-shop/products/7717360238697"
          value={shopifyUrl}
          onChange={(e) => onShopifyChange(e.target.value)}
          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      </div>

      {/* Printify URL */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">
          Printify Product URL (seed design)
          <StatusBadge status={printifyStatus} label={printifyLabel} />
        </label>
        <input
          type="text"
          placeholder="https://printify.com/app/product-details/699f91fcf38bdbd36701b743"
          value={printifyUrl}
          onChange={(e) => onPrintifyChange(e.target.value)}
          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      </div>

      {saveError && <p className="text-sm text-red-500">{saveError}</p>}

      <div className="flex justify-end">
        <button
          onClick={handleNext}
          disabled={!canNext}
          className="px-6 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium disabled:opacity-40 disabled:cursor-not-allowed hover:bg-blue-700 transition-colors"
        >
          {saving ? "Saving..." : "Next →"}
        </button>
      </div>
    </div>
  );
}
```

**Step 2: Verify in browser**

Go to Create Product Images → Step 1. Paste the real Shopify URL and Printify URL. Should show green confirmations with product titles. Click Next — should advance to Step 2.

**Step 3: Commit**
```bash
git add src/components/createProducts/InputsStep.jsx
git commit -m "feat: implement Step 1 Inputs with live URL validation and Supabase init"
```

---

## Task 7: Frontend — Step 2 (Configure Variants)

**Files:**
- Modify: `src/components/createProducts/ConfigureVariantsStep.jsx`

**Context:** `sessionData.shopifyProduct.options` is an array of `{ id, name, values }`. Recognize these option names (case-insensitive): `background color` / `background_color` → design-driving. `size` → show size toggle. `frame color` / `frame_color` → info-only. Any unrecognized option → skip. localStorage keys: `cpw_seed_color`, `cpw_hex_codes`, `cpw_size_shared`.

**Step 1: Implement ConfigureVariantsStep.jsx**

```jsx
import { useState, useEffect } from "react";

const LS_SEED = "cpw_seed_color";
const LS_HEX = "cpw_hex_codes";
const LS_SIZE_SHARED = "cpw_size_shared";

function hexToLuminance(hex) {
  const h = hex.replace("#", "");
  const r = parseInt(h.substring(0, 2), 16) / 255;
  const g = parseInt(h.substring(2, 4), 16) / 255;
  const b = parseInt(h.substring(4, 6), 16) / 255;
  return 0.299 * r + 0.587 * g + 0.114 * b;
}

function isBgColorOption(name) {
  return /background.?color/i.test(name);
}
function isSizeOption(name) {
  return /^size$/i.test(name);
}
function isFrameColorOption(name) {
  return /frame.?color/i.test(name);
}

export default function ConfigureVariantsStep({ sessionData, updateSession, onNext, onBack }) {
  const options = sessionData.shopifyProduct?.options || [];
  const bgOption = options.find((o) => isBgColorOption(o.name));
  const sizeOption = options.find((o) => isSizeOption(o.name));
  const frameOption = options.find((o) => isFrameColorOption(o.name));

  // Initialize hex codes: load from localStorage or default to empty string per color
  const initHexCodes = () => {
    try {
      const stored = JSON.parse(localStorage.getItem(LS_HEX) || "{}");
      if (bgOption) {
        const result = {};
        bgOption.values.forEach((v) => { result[v] = stored[v] || ""; });
        return result;
      }
    } catch {}
    return {};
  };

  const [hexCodes, setHexCodes] = useState(initHexCodes);
  const [seedColor, setSeedColor] = useState(() => localStorage.getItem(LS_SEED) || "");
  const [sizeShared, setSizeShared] = useState(() => {
    const stored = localStorage.getItem(LS_SIZE_SHARED);
    return stored === null ? true : stored === "true";
  });

  // Persist to localStorage on change
  useEffect(() => { localStorage.setItem(LS_HEX, JSON.stringify(hexCodes)); }, [hexCodes]);
  useEffect(() => { if (seedColor) localStorage.setItem(LS_SEED, seedColor); }, [seedColor]);
  useEffect(() => { localStorage.setItem(LS_SIZE_SHARED, String(sizeShared)); }, [sizeShared]);

  const bgColors = bgOption?.values || [];
  const nonSeedColors = bgColors.filter((c) => c !== seedColor);
  const allHexesFilled = bgColors.every((c) => hexCodes[c]?.match(/^#[0-9a-fA-F]{6}$/));
  const canNext = (!bgOption || (seedColor && allHexesFilled));

  const handleNext = () => {
    updateSession({ bgColors, seedColor, hexCodes, sizeShared, sizeValues: sizeOption?.values || [], frameValues: frameOption?.values || [] });
    onNext();
  };

  return (
    <div className="space-y-8">
      <h2 className="text-xl font-semibold text-gray-800">Step 2 — Configure Variants</h2>

      {/* Background Color */}
      {bgOption && (
        <section>
          <h3 className="text-sm font-semibold text-gray-700 mb-3">Background Color <span className="text-blue-500 text-xs">(design-driving)</span></h3>
          <div className="space-y-3">
            {bgColors.map((color) => (
              <div key={color} className="flex items-center gap-3">
                {/* Color preview swatch */}
                <div
                  className="w-7 h-7 rounded-full border border-gray-200 flex-shrink-0"
                  style={{ backgroundColor: hexCodes[color] || "#cccccc" }}
                />
                <span className="text-sm text-gray-700 w-32">{color}</span>
                <input
                  type="text"
                  placeholder="#FFFFFF"
                  value={hexCodes[color] || ""}
                  onChange={(e) => setHexCodes((prev) => ({ ...prev, [color]: e.target.value }))}
                  className="w-28 border border-gray-300 rounded px-2 py-1 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
                <button
                  onClick={() => setSeedColor(color)}
                  className={`text-xs px-3 py-1 rounded-full border transition-colors ${
                    seedColor === color
                      ? "bg-blue-600 text-white border-blue-600"
                      : "border-gray-300 text-gray-500 hover:border-blue-400"
                  }`}
                >
                  {seedColor === color ? "✓ Seed" : "Set as Seed"}
                </button>
              </div>
            ))}
          </div>
          {seedColor && (
            <p className="text-xs text-gray-500 mt-3">
              Will generate <strong>{nonSeedColors.length}</strong> images ({bgColors.length} colors minus 1 seed)
            </p>
          )}
        </section>
      )}

      {/* Size */}
      {sizeOption && (
        <section>
          <h3 className="text-sm font-semibold text-gray-700 mb-2">Sizes</h3>
          <div className="flex gap-2 mb-3">
            {sizeOption.values.map((s) => (
              <span key={s} className="text-xs bg-gray-100 text-gray-600 px-2 py-1 rounded">{s}</span>
            ))}
          </div>
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={sizeShared}
              onChange={(e) => setSizeShared(e.target.checked)}
              className="rounded"
            />
            <span className="text-sm text-gray-700">All sizes share the same image</span>
          </label>
          {!sizeShared && (
            <p className="text-xs text-yellow-600 mt-1">Each size will get its own Printify product and image.</p>
          )}
        </section>
      )}

      {/* Frame Color — info only */}
      {frameOption && (
        <section>
          <h3 className="text-sm font-semibold text-gray-700 mb-2">Frame Color <span className="text-gray-400 text-xs">(Shopify/Printify variant only — shares AI image)</span></h3>
          <div className="flex gap-2">
            {frameOption.values.map((f) => (
              <span key={f} className="text-xs bg-gray-100 text-gray-600 px-2 py-1 rounded">{f}</span>
            ))}
          </div>
        </section>
      )}

      <div className="flex justify-between">
        <button onClick={onBack} className="px-4 py-2 text-sm text-gray-600 hover:text-gray-900">← Back</button>
        <button
          onClick={handleNext}
          disabled={!canNext}
          className="px-6 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium disabled:opacity-40 disabled:cursor-not-allowed hover:bg-blue-700"
        >
          Next →
        </button>
      </div>
    </div>
  );
}
```

**Step 2: Verify in browser**

After completing Step 1 with a real Shopify product, Step 2 should show the product's actual variant options. Set hex codes and pick a seed color. Check that the "Will generate N images" count updates correctly. Verify localStorage persistence on page refresh.

**Step 3: Commit**
```bash
git add src/components/createProducts/ConfigureVariantsStep.jsx
git commit -m "feat: implement Step 2 Configure Variants with localStorage persistence"
```

---

## Task 8: Frontend — Step 3 (Generate Images)

**Files:**
- Modify: `src/components/createProducts/GenerateImagesStep.jsx`

**Context:** On mount: (1) call `POST /api/product-images/breed-names` with `count = nonSeedColors.length`, (2) fire `POST /api/product-images/generate-variant` for each color in parallel. `sessionData.seedFileDataUrl` is the base64 data URL of the seed image. Convert to `{imageBase64, mimeType}` before sending. On "Approve & Continue": store `approvedImages` in `sessionData`.

**Step 1: Implement GenerateImagesStep.jsx**

```jsx
import { useState, useEffect, useRef } from "react";

function dataUrlToBase64(dataUrl) {
  const [header, data] = dataUrl.split(",");
  const mimeType = header.match(/:(.*?);/)?.[1] || "image/png";
  return { imageBase64: data, mimeType };
}

export default function GenerateImagesStep({ sessionData, updateSession, onNext, onBack }) {
  const { seedFileDataUrl, hexCodes, seedColor, bgColors } = sessionData;
  const nonSeedColors = (bgColors || []).filter((c) => c !== seedColor);

  const [cards, setCards] = useState(() =>
    nonSeedColors.map((color) => ({
      color,
      status: "pending", // pending | generating | done | error
      imageDataUrl: null,
      breed: null,
      petName: null,
      error: null,
    }))
  );
  const [feedbackText, setFeedbackText] = useState({});
  const [showFeedback, setShowFeedback] = useState({});
  const initiated = useRef(false);

  const updateCard = (color, updates) =>
    setCards((prev) => prev.map((c) => (c.color === color ? { ...c, ...updates } : c)));

  const generateForColor = async (color, breed, petName, extraFeedback = "") => {
    updateCard(color, { status: "generating", error: null });
    try {
      const { imageBase64, mimeType } = dataUrlToBase64(seedFileDataUrl);
      const res = await fetch("http://localhost:3001/api/product-images/generate-variant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          seedImageBase64: imageBase64,
          seedImageMimeType: mimeType,
          backgroundColor: hexCodes[color],
          colorName: color,
          breed,
          petName,
          feedbackText: extraFeedback,
        }),
      });
      if (!res.ok) throw new Error(await res.text());
      const { imageBase64: outBase64, mimeType: outMime } = await res.json();
      updateCard(color, {
        status: "done",
        imageDataUrl: `data:${outMime};base64,${outBase64}`,
        generatedBase64: outBase64,
        generatedMimeType: outMime,
      });
    } catch (err) {
      updateCard(color, { status: "error", error: err.message });
    }
  };

  useEffect(() => {
    if (initiated.current || !seedFileDataUrl || nonSeedColors.length === 0) return;
    initiated.current = true;

    // Step 1: Get breed+name combos, then fire all generations in parallel
    const animalType = "pet"; // could be detected from product title in future
    fetch("http://localhost:3001/api/product-images/breed-names", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ count: nonSeedColors.length, animalType }),
    })
      .then((r) => r.json())
      .then(({ combos }) => {
        // Assign combos to cards
        setCards((prev) =>
          prev.map((card, i) => ({ ...card, breed: combos[i]?.breed || "Golden Retriever", petName: combos[i]?.name || "Buddy" }))
        );
        // Fire all in parallel
        nonSeedColors.forEach((color, i) => {
          generateForColor(color, combos[i]?.breed || "Golden Retriever", combos[i]?.name || "Buddy");
        });
      })
      .catch(() => {
        // Fallback: generate with placeholder breed/name
        nonSeedColors.forEach((color) => generateForColor(color, "Golden Retriever", "Buddy"));
      });
  }, []);

  const handleRegenerate = (color) => {
    const card = cards.find((c) => c.color === color);
    if (!card) return;
    generateForColor(color, card.breed || "Golden Retriever", card.petName || "Buddy", feedbackText[color] || "");
    setShowFeedback((prev) => ({ ...prev, [color]: false }));
  };

  const allDone = cards.length > 0 && cards.every((c) => c.status === "done");

  const handleNext = () => {
    updateSession({
      approvedImages: cards.map((c) => ({
        color: c.color,
        hexCode: hexCodes[c.color],
        breed: c.breed,
        petName: c.petName,
        imageBase64: c.generatedBase64,
        mimeType: c.generatedMimeType,
        imageDataUrl: c.imageDataUrl,
      })),
    });
    onNext();
  };

  return (
    <div className="space-y-6">
      <h2 className="text-xl font-semibold text-gray-800">Step 3 — Generate Images</h2>
      <p className="text-sm text-gray-500">Generating {nonSeedColors.length} image{nonSeedColors.length !== 1 ? "s" : ""} in parallel...</p>

      <div className="grid grid-cols-2 gap-4">
        {cards.map((card) => (
          <div key={card.color} className="border border-gray-200 rounded-xl overflow-hidden">
            {/* Header */}
            <div className="flex items-center gap-2 px-4 py-2 bg-gray-50 border-b border-gray-200">
              <div className="w-4 h-4 rounded-full border border-gray-300" style={{ backgroundColor: hexCodes[card.color] }} />
              <span className="text-sm font-medium text-gray-700">{card.color}</span>
              {card.breed && <span className="text-xs text-gray-400 ml-auto">{card.breed} · {card.petName}</span>}
            </div>

            {/* Image area */}
            <div className="aspect-square bg-gray-100 flex items-center justify-center relative">
              {card.status === "generating" && (
                <div className="text-center">
                  <div className="animate-spin w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full mx-auto mb-2" />
                  <p className="text-xs text-gray-400">Generating...</p>
                </div>
              )}
              {card.status === "done" && card.imageDataUrl && (
                <img src={card.imageDataUrl} alt={card.color} className="w-full h-full object-contain" />
              )}
              {card.status === "error" && (
                <div className="text-center px-4">
                  <p className="text-xs text-red-500 mb-2">{card.error}</p>
                </div>
              )}
              {card.status === "pending" && (
                <p className="text-xs text-gray-400">Waiting...</p>
              )}
            </div>

            {/* Regenerate */}
            {(card.status === "done" || card.status === "error") && (
              <div className="px-4 py-2 border-t border-gray-100">
                {showFeedback[card.color] ? (
                  <div className="flex gap-2">
                    <input
                      type="text"
                      placeholder="Describe what to fix..."
                      value={feedbackText[card.color] || ""}
                      onChange={(e) => setFeedbackText((prev) => ({ ...prev, [card.color]: e.target.value }))}
                      className="flex-1 text-xs border border-gray-300 rounded px-2 py-1 focus:outline-none"
                    />
                    <button onClick={() => handleRegenerate(card.color)}
                      className="text-xs bg-blue-600 text-white px-3 py-1 rounded hover:bg-blue-700">
                      Go
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => setShowFeedback((prev) => ({ ...prev, [card.color]: true }))}
                    className="text-xs text-gray-500 hover:text-gray-700"
                  >
                    ↺ Regenerate
                  </button>
                )}
              </div>
            )}
          </div>
        ))}
      </div>

      <div className="flex justify-between">
        <button onClick={onBack} className="px-4 py-2 text-sm text-gray-600 hover:text-gray-900">← Back</button>
        <button
          onClick={handleNext}
          disabled={!allDone}
          className="px-6 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium disabled:opacity-40 disabled:cursor-not-allowed hover:bg-blue-700"
        >
          Approve & Continue →
        </button>
      </div>
    </div>
  );
}
```

**Step 2: Verify in browser**

Complete Steps 1–2, then observe Step 3: cards appear for each non-seed color, spinner shows, images populate. Try Regenerate with feedback text.

**Step 3: Commit**
```bash
git add src/components/createProducts/GenerateImagesStep.jsx
git commit -m "feat: implement Step 3 Generate Images with Gemini img2img and regenerate"
```

---

## Task 9: Frontend — Step 4 (Printify Mockups)

**Files:**
- Modify: `src/components/createProducts/PrintifyMockupsStep.jsx`

**Context:** For each approved image in `sessionData.approvedImages`: (1) call `POST /api/printify/upload-image` with the image base64, (2) call `POST /api/printify/create-product` with the template from `sessionData.printifyTemplate`. Show progress per color. Once all created, group all product images by position index across all products and render a selection grid. Store `selectedMockups` and `printifyProducts` in sessionData on Next.

**Step 1: Implement PrintifyMockupsStep.jsx**

```jsx
import { useState, useEffect, useRef } from "react";

export default function PrintifyMockupsStep({ sessionData, updateSession, onNext, onBack }) {
  const { approvedImages, printifyTemplate } = sessionData;

  const [progress, setProgress] = useState([]); // [{ color, status, productId, images }]
  const [selectedMockups, setSelectedMockups] = useState(new Set()); // Set of "productId:imageIndex"
  const initiated = useRef(false);

  const updateProgress = (color, updates) =>
    setProgress((prev) => prev.map((p) => (p.color === color ? { ...p, ...updates } : p)));

  useEffect(() => {
    if (initiated.current || !approvedImages?.length) return;
    initiated.current = true;

    setProgress(approvedImages.map((img) => ({ color: img.color, status: "uploading", productId: null, images: [] })));

    // Create all Printify products in parallel
    Promise.allSettled(
      approvedImages.map(async (img) => {
        // 1. Upload image to Printify
        const uploadRes = await fetch("http://localhost:3001/api/printify/upload-image", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            fileName: `design_${img.color.replace(/\s/g, "_")}_${Date.now()}.png`,
            imageBase64: img.imageBase64,
          }),
        });
        if (!uploadRes.ok) throw new Error(await uploadRes.text());
        const { id: uploadedImageId } = await uploadRes.json();

        updateProgress(img.color, { status: "creating" });

        // 2. Create Printify product
        const createRes = await fetch("http://localhost:3001/api/printify/create-product", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            template: printifyTemplate,
            uploadedImageId,
            customTitle: `${printifyTemplate.title} — ${img.color}`,
          }),
        });
        if (!createRes.ok) throw new Error(await createRes.text());
        const { product } = await createRes.json();

        updateProgress(img.color, { status: "done", productId: product.id, images: product.images || [] });
      })
    );
  }, []);

  // Group images by position index
  const positionGroups = (() => {
    const done = progress.filter((p) => p.status === "done");
    if (!done.length) return [];
    const maxLen = Math.max(...done.map((p) => p.images.length));
    return Array.from({ length: maxLen }, (_, posIdx) => ({
      posIdx,
      label: posIdx === 0 ? "Front View" : posIdx === 1 ? "Side/Tilted View" : posIdx === 2 ? "Lifestyle View" : `View ${posIdx + 1}`,
      entries: done.map((p) => ({ color: p.color, productId: p.productId, image: p.images[posIdx] || null })).filter((e) => e.image),
    })).filter((g) => g.entries.length > 0);
  })();

  const allDone = progress.length > 0 && progress.every((p) => p.status === "done" || p.status === "error");

  const toggleMockup = (key) =>
    setSelectedMockups((prev) => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });

  const toggleRow = (group) => {
    const keys = group.entries.map((e) => `${e.productId}:${group.posIdx}`);
    const allSelected = keys.every((k) => selectedMockups.has(k));
    setSelectedMockups((prev) => {
      const next = new Set(prev);
      keys.forEach((k) => allSelected ? next.delete(k) : next.add(k));
      return next;
    });
  };

  const handleNext = () => {
    // Build selected mockup list
    const selected = [];
    progress.filter((p) => p.status === "done").forEach((p, colorIdx) => {
      p.images.forEach((img, posIdx) => {
        const key = `${p.productId}:${posIdx}`;
        if (selectedMockups.has(key)) {
          selected.push({
            aiImageIndex: colorIdx,
            printifyProductId: p.productId,
            position: posIdx,
            src: img.src,
            color: p.color,
            variantAttributes: { background_color: p.color },
          });
        }
      });
    });

    updateSession({
      printifyProducts: progress.filter((p) => p.status === "done"),
      selectedMockups: selected,
    });
    onNext();
  };

  return (
    <div className="space-y-6">
      <h2 className="text-xl font-semibold text-gray-800">Step 4 — Printify Mockups</h2>

      {/* Progress */}
      <div className="space-y-1">
        {progress.map((p) => (
          <div key={p.color} className="flex items-center gap-3 text-sm">
            <div className="w-4 h-4 rounded-full border" style={{ backgroundColor: sessionData.hexCodes?.[p.color] }} />
            <span className="text-gray-700 w-32">{p.color}</span>
            {p.status === "uploading" && <span className="text-blue-500 text-xs">Uploading image...</span>}
            {p.status === "creating" && <span className="text-blue-500 text-xs">Creating Printify product...</span>}
            {p.status === "done" && <span className="text-green-600 text-xs">✓ Done — {p.images.length} mockups</span>}
            {p.status === "error" && <span className="text-red-500 text-xs">✗ Error</span>}
          </div>
        ))}
      </div>

      {/* Mockup grid grouped by position */}
      {allDone && positionGroups.map((group) => (
        <div key={group.posIdx} className="border border-gray-200 rounded-xl overflow-hidden">
          <div className="flex items-center justify-between px-4 py-2 bg-gray-50 border-b border-gray-200">
            <h3 className="text-sm font-semibold text-gray-700">{group.label}</h3>
            <button onClick={() => toggleRow(group)} className="text-xs text-blue-600 hover:underline">
              {group.entries.every((e) => selectedMockups.has(`${e.productId}:${group.posIdx}`))
                ? "Deselect all"
                : "Select all"}
            </button>
          </div>
          <div className="grid grid-cols-4 gap-3 p-4">
            {group.entries.map((entry) => {
              const key = `${entry.productId}:${group.posIdx}`;
              const selected = selectedMockups.has(key);
              return (
                <div key={key} onClick={() => toggleMockup(key)} className={`relative cursor-pointer rounded-lg overflow-hidden border-2 transition-colors ${selected ? "border-blue-500" : "border-transparent"}`}>
                  <img src={entry.image.src} alt={entry.color} className="w-full aspect-square object-cover" />
                  {selected && (
                    <div className="absolute top-2 right-2 w-6 h-6 bg-blue-600 rounded-full flex items-center justify-center">
                      <span className="text-white text-xs">✓</span>
                    </div>
                  )}
                  <div className="absolute bottom-0 left-0 right-0 bg-black/40 px-2 py-1">
                    <span className="text-white text-xs">{entry.color}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ))}

      <div className="flex justify-between">
        <button onClick={onBack} className="px-4 py-2 text-sm text-gray-600 hover:text-gray-900">← Back</button>
        <button
          onClick={handleNext}
          disabled={!allDone || selectedMockups.size === 0}
          className="px-6 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium disabled:opacity-40 disabled:cursor-not-allowed hover:bg-blue-700"
        >
          Next →
        </button>
      </div>
    </div>
  );
}
```

**Step 2: Verify in browser**

Complete Steps 1–3. Step 4 should show progress for each color, then a grid grouped by view position with selectable images.

**Step 3: Commit**
```bash
git add src/components/createProducts/PrintifyMockupsStep.jsx
git commit -m "feat: implement Step 4 Printify Mockups with position-grouped selection"
```

---

## Task 10: Frontend — Step 5 (Confirm & Upload)

**Files:**
- Modify: `src/components/createProducts/ConfirmUploadStep.jsx`

**Context:** `sessionData.shopifyProduct.variants` is the flat list of variant objects with `id`, `selectedOptions`, and `title`. For each variant, find its background color from `selectedOptions` and look up which selected mockups match that color. Upload to Shopify, then save to Supabase.

**Step 1: Implement ConfirmUploadStep.jsx**

```jsx
import { useState } from "react";

export default function ConfirmUploadStep({ sessionData, onBack }) {
  const {
    shopifyProduct, shopifyProductNumericId, selectedMockups, approvedImages,
    productId, seedImageId, hexCodes,
  } = sessionData;

  const [status, setStatus] = useState("idle"); // idle | uploading | done | error
  const [errorMsg, setErrorMsg] = useState(null);
  const [shopifyAdminUrl, setShopifyAdminUrl] = useState(null);

  // Build variant → mockup mapping
  const variants = shopifyProduct?.variants || [];
  const mappingRows = variants.map((variant) => {
    const bgOption = variant.selectedOptions?.find((o) => /background.?color/i.test(o.name));
    const bgColor = bgOption?.value;
    const matchingMockups = (selectedMockups || []).filter((m) => m.color === bgColor);
    return { variant, bgColor, matchingMockups };
  });

  const handleConfirm = async () => {
    setStatus("uploading");
    setErrorMsg(null);
    try {
      // 1. Build Shopify assignments: deduplicate by image src
      const srcToVariantIds = {};
      mappingRows.forEach(({ variant, matchingMockups }) => {
        matchingMockups.forEach((mockup) => {
          if (!srcToVariantIds[mockup.src]) srcToVariantIds[mockup.src] = [];
          srcToVariantIds[mockup.src].push(variant.id);
        });
      });

      const assignments = Object.entries(srcToVariantIds).map(([imageUrl, variantIds]) => ({
        imageUrl, variantIds,
      }));

      if (assignments.length > 0) {
        const shopifyRes = await fetch("http://localhost:3001/api/shopify/variant-images", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ productId: shopifyProductNumericId, assignments }),
        });
        if (!shopifyRes.ok) throw new Error(await shopifyRes.text());
      }

      // 2. Save AI images + mockups to Supabase
      const saveRes = await fetch("http://localhost:3001/api/product-images/save-results", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          productId,
          seedImageId,
          aiImages: (approvedImages || []).map((img) => ({
            imageBase64: img.imageBase64,
            mimeType: img.mimeType,
            colorName: img.color,
            hexCode: hexCodes?.[img.color] || "",
            breed: img.breed,
            petName: img.petName,
          })),
          mockupImages: (selectedMockups || []).map((m) => ({
            aiImageIndex: (approvedImages || []).findIndex((a) => a.color === m.color),
            printifyProductId: m.printifyProductId,
            position: m.position,
            src: m.src,
            variantAttributes: m.variantAttributes,
          })),
        }),
      });
      if (!saveRes.ok) throw new Error(await saveRes.text());

      setShopifyAdminUrl(
        `https://admin.shopify.com/store/instame-shop/products/${shopifyProductNumericId}`
      );
      setStatus("done");
    } catch (err) {
      setErrorMsg(err.message);
      setStatus("error");
    }
  };

  if (status === "done") {
    return (
      <div className="text-center py-16 space-y-4">
        <div className="text-4xl">🎉</div>
        <h2 className="text-xl font-semibold text-gray-800">All done!</h2>
        <p className="text-sm text-gray-500">Images saved to Supabase and uploaded to Shopify variants.</p>
        <a href={shopifyAdminUrl} target="_blank" rel="noreferrer"
          className="inline-block px-6 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700">
          View Product in Shopify →
        </a>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <h2 className="text-xl font-semibold text-gray-800">Step 5 — Confirm & Upload</h2>
      <p className="text-sm text-gray-500">Review the mapping below, then confirm to upload to Shopify and save to Supabase.</p>

      {/* Mapping table */}
      <div className="border border-gray-200 rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b border-gray-200">
            <tr>
              <th className="text-left px-4 py-2 text-xs font-semibold text-gray-600">Shopify Variant</th>
              <th className="text-left px-4 py-2 text-xs font-semibold text-gray-600">Images</th>
            </tr>
          </thead>
          <tbody>
            {mappingRows.map(({ variant, matchingMockups }) => (
              <tr key={variant.id} className="border-b border-gray-100 last:border-0">
                <td className="px-4 py-3 text-gray-700">{variant.title}</td>
                <td className="px-4 py-3">
                  {matchingMockups.length === 0 ? (
                    <span className="text-gray-400 text-xs">No image selected</span>
                  ) : (
                    <div className="flex gap-2">
                      {matchingMockups.map((m, i) => (
                        <div key={i} className="relative group">
                          <img src={m.src} alt="" className="w-12 h-12 object-cover rounded border border-gray-200" />
                          <span className="absolute -top-1 -right-1 text-xs bg-blue-100 text-blue-600 rounded px-1">P{m.position + 1}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {errorMsg && <p className="text-sm text-red-500">{errorMsg}</p>}

      <div className="flex justify-between">
        <button onClick={onBack} disabled={status === "uploading"} className="px-4 py-2 text-sm text-gray-600 hover:text-gray-900">← Back</button>
        <button
          onClick={handleConfirm}
          disabled={status === "uploading"}
          className="px-6 py-2 bg-green-600 text-white rounded-lg text-sm font-medium disabled:opacity-40 hover:bg-green-700"
        >
          {status === "uploading" ? "Uploading..." : "Confirm & Upload"}
        </button>
      </div>
    </div>
  );
}
```

**Step 2: Verify end-to-end in browser**

Complete all 5 steps. The confirmation table should show variants with thumbnails. On confirm: progress indicator, then success screen with Shopify admin link. Check Supabase `ai_generated_images` and `product_mockup_images` tables for new rows. Check Shopify admin for variant images.

**Step 3: Commit**
```bash
git add src/components/createProducts/ConfirmUploadStep.jsx
git commit -m "feat: implement Step 5 Confirm & Upload with Shopify and Supabase write"
```

---

## Done

The full Create Product Images wizard is complete. Key things to verify end-to-end:
1. Nav label shows "Create Product Images"
2. Step 1: Shopify + Printify URLs validate live, Next persists to Supabase
3. Step 2: Variant options pulled from real Shopify product, localStorage persists across refresh
4. Step 3: Gemini generates N variants in parallel, regenerate with feedback works
5. Step 4: Printify products created per color, mockups grouped by position, multi-select works
6. Step 5: Mapping table correct, Shopify upload deduplicates, Supabase rows created

If `getGenAI` is not exported from `imageUtils.js`, check what the export is named and adjust the import in `productImagesRoutes.js` accordingly.
