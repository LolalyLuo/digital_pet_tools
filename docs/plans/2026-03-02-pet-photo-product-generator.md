# Pet Photo Product Generator — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** A single-page internal tool to upload pet photos, generate AI art using prompts from Shopify metaobjects, and create a Printify product in the InstaMe (Manual) shop.

**Architecture:** Single-page React component with 4 sequential sections (no wizard). New backend routes handle Shopify V2 prompt fetching, direct base64 image generation, PhotoRoom background removal, and Printify product creation with a configurable shop ID.

**Tech Stack:** React 19 + Tailwind CSS v4 (frontend), Express.js (backend), OpenAI/Gemini APIs (image generation), PhotoRoom API (bg removal), Printify API (product creation), Shopify Admin GraphQL (metaobject fetch)

---

## Reference Files

- Backend model calls: `local-api/routes/imageRoutes.js:200-451` (OpenAI, Gemini, SeeDream patterns)
- Shared image utils: `local-api/utils/imageUtils.js` — exports `generateWithGemini(petBuffer, prompt, background, size, geminiApiKey, modelConfig)`
- Printify routes: `local-api/routes/printifyRoutes.js` — `printifyFetch()`, `replacePrintAreaImage()`
- Server mount: `local-api/server.js:51-63`
- App navigation: `src/App.jsx:17-30` (APP_MENU_ITEMS) and `src/App.jsx:97-137` (renderCurrentApp switch)

---

### Task 1: Extend printify create-product to accept shopId

**Files:**
- Modify: `local-api/routes/printifyRoutes.js:83-121`

**Step 1: Update the route to accept an optional shopId**

Change lines 88 and 106/113 in `printifyRoutes.js`:

```js
// Before (line 88):
const { template, uploadedImageId, customTitle } = req.body;

// After:
const { template, uploadedImageId, customTitle, shopId } = req.body;
const targetShopId = shopId || getShopId();
```

Then replace both `getShopId()` calls in the create-product route body (lines 106 and 113) with `targetShopId`:

```js
const created = await printifyFetch(
  `/shops/${targetShopId}/products.json`,
  { method: "POST", body: JSON.stringify(productData) }
);

const full = await printifyFetch(
  `/shops/${targetShopId}/products/${created.id}.json`
);
```

Also update the GET product route to accept shopId via query param for fetching templates from any shop:

```js
// GET /api/printify/product/:id?shopId=26612298
router.get("/product/:id", async (req, res) => {
  const targetShopId = req.query.shopId || getShopId();
  const product = await printifyFetch(
    `/shops/${targetShopId}/products/${req.params.id}.json`
  );
  // ... rest unchanged
```

**Step 2: Manual test**

Start the server: `cd local-api && node server.js`
Confirm no errors on startup.

**Step 3: Commit**

```bash
git add local-api/routes/printifyRoutes.js
git commit -m "feat: add optional shopId param to printify create-product and product routes"
```

---

### Task 2: Create shopifyV2Routes.js — fetch AI prompts from V2 shop

**Files:**
- Create: `local-api/routes/shopifyV2Routes.js`

**Step 1: Create the route file**

```js
import express from "express";
const router = express.Router();

const SHOPIFY_V2_SHOP = () => process.env.SHOPIFY_INSTAME_V2_SHOP?.trim();
const SHOPIFY_V2_TOKEN = () => process.env.SHOPIFY_INSTAME_V2_ACCESS_TOKEN?.trim();
const API_VERSION = "2025-01";

async function shopifyV2GQL(query) {
  const res = await fetch(
    `https://${SHOPIFY_V2_SHOP()}/admin/api/${API_VERSION}/graphql.json`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": SHOPIFY_V2_TOKEN(),
      },
      body: JSON.stringify({ query }),
    }
  );
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Shopify V2 GQL failed (${res.status}): ${text}`);
  }
  return res.json();
}

// GET /api/shopify-v2/ai-prompts
// Returns all ai_image metaobjects from the InstaMe V2 shop
router.get("/ai-prompts", async (req, res) => {
  try {
    const result = await shopifyV2GQL(`{
      metaobjects(type: "ai_image", first: 50) {
        nodes {
          id
          handle
          displayName
          fields { key value }
        }
      }
    }`);

    const nodes = result.data?.metaobjects?.nodes ?? [];
    const prompts = nodes.map((node) => {
      const field = (key) => node.fields.find((f) => f.key === key)?.value ?? "";
      return {
        id: node.id,
        handle: node.handle,
        name: field("name") || node.displayName,
        provider: field("provider"),
        aspectratio: field("aspectratio"),
        background: field("background"),
        prompt: field("prompt"),
        needpetname: field("needpetname") === "true",
        seasonal: field("seasonal"),
      };
    });

    res.json({ prompts });
  } catch (err) {
    console.error("❌ shopify-v2 ai-prompts error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

export default router;
```

**Step 2: Mount in server.js**

In `local-api/server.js`, add after line 36:
```js
import shopifyV2Routes from "./routes/shopifyV2Routes.js";
```

After line 63:
```js
app.use("/api/shopify-v2", shopifyV2Routes);
```

**Step 3: Manual test**

```bash
curl http://localhost:3001/api/shopify-v2/ai-prompts
```
Expected: JSON with 5 prompts (line-art, plush-toy, golden-hour, simple-watercolor-transform, kawaii-anime).

**Step 4: Commit**

```bash
git add local-api/routes/shopifyV2Routes.js local-api/server.js
git commit -m "feat: add shopify-v2 ai-prompts endpoint"
```

---

### Task 3: Create petPhotoGeneratorRoutes.js — generate + remove-background

**Files:**
- Create: `local-api/routes/petPhotoGeneratorRoutes.js`

**Step 1: Create the route file**

This route accepts base64 images directly (no Supabase lookup needed) and reuses `generateWithGemini` from `imageUtils.js`. For OpenAI it replicates the pattern from `imageRoutes.js:388-450`.

```js
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
          form.append("size", size.replace("×", "x"));
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
```

**Step 2: Mount in server.js**

Add import (after the other route imports):
```js
import petPhotoGeneratorRoutes from "./routes/petPhotoGeneratorRoutes.js";
```

Add mount (after line 63):
```js
app.use("/api/pet-photo-generator", petPhotoGeneratorRoutes);
```

**Step 3: Commit**

```bash
git add local-api/routes/petPhotoGeneratorRoutes.js local-api/server.js
git commit -m "feat: add pet-photo-generator generate and remove-background endpoints"
```

---

### Task 4: Build PetPhotoProductGenerator.jsx — main component skeleton

**Files:**
- Create: `src/components/PetPhotoProductGenerator.jsx`

**Step 1: Create the main component with section structure**

This is the single-page component. Build the outer shell first, then fill in each section in Tasks 5–8.

```jsx
import { useState, useEffect } from "react";

export default function PetPhotoProductGenerator() {
  // Section 1: pet photos
  const [petPhotos, setPetPhotos] = useState([]); // [{id, file, dataUrl, petName}]

  // Section 2: prompt config
  const [availablePrompts, setAvailablePrompts] = useState([]);
  const [selectedPromptHandle, setSelectedPromptHandle] = useState("");
  const [promptText, setPromptText] = useState("");
  const [provider, setProvider] = useState("openai");
  const [aspectRatio, setAspectRatio] = useState("1024x1024");
  const [background, setBackground] = useState("opaque");
  const [needpetname, setNeedpetname] = useState(false);
  const [imageCount, setImageCount] = useState(3);

  // Section 3: generated images
  const [generatedImages, setGeneratedImages] = useState([]); // [{imageBase64, mimeType, selected}]
  const [isGenerating, setIsGenerating] = useState(false);
  const [generateError, setGenerateError] = useState(null);

  // Section 4: printify
  const [printifyUrl, setPrintifyUrl] = useState("");
  const [printifyTemplate, setPrintifyTemplate] = useState(null);
  const [isLoadingTemplate, setIsLoadingTemplate] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [createdProducts, setCreatedProducts] = useState([]);

  // Load prompts on mount
  useEffect(() => {
    fetch("http://localhost:3001/api/shopify-v2/ai-prompts")
      .then((r) => r.json())
      .then((data) => setAvailablePrompts(data.prompts || []))
      .catch((err) => console.error("Failed to load prompts:", err));
  }, []);

  // When a prompt is selected from the dropdown, populate all fields
  const handlePromptSelect = (handle) => {
    setSelectedPromptHandle(handle);
    const p = availablePrompts.find((ap) => ap.handle === handle);
    if (!p) return;
    setPromptText(p.prompt);
    setProvider(p.provider);
    setAspectRatio(p.aspectratio);
    setBackground(p.background);
    setNeedpetname(p.needpetname);
  };

  return (
    <div className="max-w-3xl mx-auto p-6 space-y-10">
      <h1 className="text-2xl font-bold">Pet Photo Product Generator</h1>

      {/* Section 1 rendered in Task 5 */}
      {/* Section 2 rendered in Task 6 */}
      {/* Section 3 rendered in Task 7 */}
      {/* Section 4 rendered in Task 8 */}
    </div>
  );
}
```

**Step 2: Wire into App.jsx**

In `src/App.jsx`:

Add import at line 16 (after CreateProducts import):
```js
import PetPhotoProductGenerator from "./components/PetPhotoProductGenerator";
```

Add to `APP_MENU_ITEMS` array (after the create-products divider, around line 28):
```js
{ id: "pet-photo-generator", label: "Pet Photo Generator" },
```

Add case in `renderCurrentApp()` switch:
```js
case "pet-photo-generator":
  return <PetPhotoProductGenerator />;
```

**Step 3: Confirm it loads**

Open the app, select "Pet Photo Generator" from menu. Should show the h1 with no errors.

**Step 4: Commit**

```bash
git add src/components/PetPhotoProductGenerator.jsx src/App.jsx
git commit -m "feat: add PetPhotoProductGenerator skeleton and nav entry"
```

---

### Task 5: Implement Section 1 — Pet Photo Upload

**Files:**
- Modify: `src/components/PetPhotoProductGenerator.jsx`

**Step 1: Add photo helpers**

```js
// Add these handlers inside the component (before return):

const handlePhotoFiles = (files) => {
  const newPhotos = Array.from(files).map((file) => ({
    id: crypto.randomUUID(),
    file,
    dataUrl: URL.createObjectURL(file),
    petName: "",
  }));
  setPetPhotos((prev) => [...prev, ...newPhotos]);
};

const removePhoto = (id) => {
  setPetPhotos((prev) => prev.filter((p) => p.id !== id));
};

const updatePetName = (id, name) => {
  setPetPhotos((prev) => prev.map((p) => p.id === id ? { ...p, petName: name } : p));
};
```

**Step 2: Render Section 1**

Replace the Section 1 comment with:

```jsx
{/* ── Section 1: Pet Photos ── */}
<section>
  <h2 className="text-lg font-semibold mb-3">1. Pet Photos</h2>

  {/* Drop zone */}
  <label
    className="flex flex-col items-center justify-center border-2 border-dashed border-gray-300 rounded-lg p-8 cursor-pointer hover:border-blue-400 transition-colors"
    onDragOver={(e) => e.preventDefault()}
    onDrop={(e) => { e.preventDefault(); handlePhotoFiles(e.dataTransfer.files); }}
  >
    <span className="text-gray-500 text-sm">Drag & drop pet photos here, or click to select</span>
    <input
      type="file"
      accept="image/*"
      multiple
      className="hidden"
      onChange={(e) => handlePhotoFiles(e.target.files)}
    />
  </label>

  {/* Photo thumbnails */}
  {petPhotos.length > 0 && (
    <div className="mt-4 grid grid-cols-3 gap-4">
      {petPhotos.map((photo) => (
        <div key={photo.id} className="relative">
          <button
            onClick={() => removePhoto(photo.id)}
            className="absolute top-1 right-1 bg-red-500 text-white rounded-full w-5 h-5 text-xs flex items-center justify-center z-10"
          >×</button>
          <img src={photo.dataUrl} alt="pet" className="w-full h-32 object-cover rounded" />
          <input
            type="text"
            placeholder="Pet name"
            value={photo.petName}
            onChange={(e) => updatePetName(photo.id, e.target.value)}
            className="mt-1 w-full text-sm border rounded px-2 py-1"
          />
        </div>
      ))}
    </div>
  )}
</section>
```

**Step 3: Commit**

```bash
git add src/components/PetPhotoProductGenerator.jsx
git commit -m "feat: implement pet photo upload section"
```

---

### Task 6: Implement Section 2 — Prompt Configuration

**Files:**
- Modify: `src/components/PetPhotoProductGenerator.jsx`

**Step 1: Replace Section 2 comment with:**

```jsx
{/* ── Section 2: Prompt Configuration ── */}
<section>
  <h2 className="text-lg font-semibold mb-3">2. Prompt Configuration</h2>

  <div className="space-y-4">
    {/* Prompt dropdown */}
    <div>
      <label className="block text-sm font-medium mb-1">Style</label>
      <select
        value={selectedPromptHandle}
        onChange={(e) => handlePromptSelect(e.target.value)}
        className="w-full border rounded px-3 py-2 text-sm"
      >
        <option value="">— select a prompt —</option>
        {availablePrompts.map((p) => (
          <option key={p.handle} value={p.handle}>{p.name}</option>
        ))}
      </select>
    </div>

    {/* Prompt text */}
    <div>
      <label className="block text-sm font-medium mb-1">Prompt</label>
      <textarea
        rows={5}
        value={promptText}
        onChange={(e) => setPromptText(e.target.value)}
        className="w-full border rounded px-3 py-2 text-sm font-mono"
        placeholder="Select a style above or type a prompt..."
      />
    </div>

    {/* Model / size / background / needpetname row */}
    <div className="grid grid-cols-2 gap-4">
      <div>
        <label className="block text-sm font-medium mb-1">Model</label>
        <input
          type="text"
          value={provider}
          onChange={(e) => setProvider(e.target.value)}
          className="w-full border rounded px-3 py-2 text-sm"
        />
      </div>
      <div>
        <label className="block text-sm font-medium mb-1">Size</label>
        <input
          type="text"
          value={aspectRatio}
          onChange={(e) => setAspectRatio(e.target.value)}
          className="w-full border rounded px-3 py-2 text-sm"
        />
      </div>
      <div>
        <label className="block text-sm font-medium mb-1">Background</label>
        <input
          type="text"
          value={background}
          onChange={(e) => setBackground(e.target.value)}
          className="w-full border rounded px-3 py-2 text-sm"
        />
      </div>
      <div>
        <label className="block text-sm font-medium mb-1">Image Count</label>
        <input
          type="number"
          min={1}
          max={10}
          value={imageCount}
          onChange={(e) => setImageCount(Number(e.target.value))}
          className="w-full border rounded px-3 py-2 text-sm"
        />
      </div>
    </div>

    {/* Need pet name checkbox */}
    <label className="flex items-center gap-2 text-sm">
      <input
        type="checkbox"
        checked={needpetname}
        onChange={(e) => setNeedpetname(e.target.checked)}
      />
      Include pet name in image
    </label>
  </div>
</section>
```

**Step 2: Commit**

```bash
git add src/components/PetPhotoProductGenerator.jsx
git commit -m "feat: implement prompt configuration section"
```

---

### Task 7: Implement Section 3 — Generate Images

**Files:**
- Modify: `src/components/PetPhotoProductGenerator.jsx`

**Step 1: Add image generation helpers**

```js
// Helper: convert File to base64
const fileToBase64 = (file) =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result.split(",")[1]); // strip data: prefix
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });

// Generate images — uses current prompt/config values at call time
const handleGenerate = async () => {
  if (!petPhotos.length || !promptText) return;
  setIsGenerating(true);
  setGenerateError(null);
  setGeneratedImages([]);

  try {
    // Convert all photos to base64
    const photos = await Promise.all(
      petPhotos.map(async (p) => ({
        base64: await fileToBase64(p.file),
        mimeType: p.file.type || "image/png",
        petName: p.petName,
      }))
    );

    const res = await fetch("http://localhost:3001/api/pet-photo-generator/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        photos,
        prompt: promptText,
        provider,
        size: aspectRatio,
        background,
        needpetname,
        count: imageCount,
      }),
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Generation failed");

    let images = data.results.map((r) => ({ ...r, selected: false }));

    // If background is transparent, auto-remove background via PhotoRoom
    if (background === "transparent") {
      images = await Promise.all(
        images.map(async (img) => {
          try {
            const bgRes = await fetch("http://localhost:3001/api/pet-photo-generator/remove-background", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ imageBase64: img.imageBase64, mimeType: img.mimeType }),
            });
            const bgData = await bgRes.json();
            if (bgRes.ok && bgData.imageBase64) {
              return { ...img, imageBase64: bgData.imageBase64, mimeType: "image/png" };
            }
          } catch (e) {
            console.warn("BG removal failed for one image:", e.message);
          }
          return img;
        })
      );
    }

    setGeneratedImages(images);
  } catch (err) {
    setGenerateError(err.message);
  } finally {
    setIsGenerating(false);
  }
};

const toggleSelect = (index) => {
  setGeneratedImages((prev) =>
    prev.map((img, i) => (i === index ? { ...img, selected: !img.selected } : img))
  );
};

const downloadImage = (img, index) => {
  const link = document.createElement("a");
  link.href = `data:${img.mimeType};base64,${img.imageBase64}`;
  link.download = `pet-art-${index + 1}.png`;
  link.click();
};
```

**Step 2: Replace Section 3 comment with:**

```jsx
{/* ── Section 3: Generate Images ── */}
<section>
  <h2 className="text-lg font-semibold mb-3">3. Generate Images</h2>

  <div className="flex gap-3 mb-4">
    <button
      onClick={handleGenerate}
      disabled={isGenerating || !petPhotos.length || !promptText}
      className="px-4 py-2 bg-blue-600 text-white rounded font-medium disabled:opacity-50 hover:bg-blue-700"
    >
      {isGenerating ? "Generating…" : generatedImages.length > 0 ? "Regenerate" : "Generate"}
    </button>
  </div>

  {generateError && (
    <p className="text-red-600 text-sm mb-4">{generateError}</p>
  )}

  {isGenerating && (
    <p className="text-gray-500 text-sm">Generating {imageCount} image{imageCount !== 1 ? "s" : ""}…</p>
  )}

  {generatedImages.length > 0 && (
    <div className="grid grid-cols-3 gap-4">
      {generatedImages.map((img, i) => (
        <div
          key={i}
          className={`relative rounded border-2 cursor-pointer transition-colors ${
            img.selected ? "border-blue-500" : "border-transparent"
          }`}
          onClick={() => toggleSelect(i)}
        >
          <img
            src={`data:${img.mimeType};base64,${img.imageBase64}`}
            alt={`generated ${i + 1}`}
            className="w-full rounded"
          />
          <div className="flex gap-1 mt-1">
            <button
              onClick={(e) => { e.stopPropagation(); toggleSelect(i); }}
              className={`flex-1 text-xs py-1 rounded ${img.selected ? "bg-blue-500 text-white" : "bg-gray-100 text-gray-700"}`}
            >
              {img.selected ? "✓ Selected" : "Select"}
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); downloadImage(img, i); }}
              className="px-2 text-xs py-1 rounded bg-gray-100 text-gray-700 hover:bg-gray-200"
            >
              ↓
            </button>
          </div>
        </div>
      ))}
    </div>
  )}
</section>
```

**Step 3: Commit**

```bash
git add src/components/PetPhotoProductGenerator.jsx
git commit -m "feat: implement image generation section with PhotoRoom bg removal"
```

---

### Task 8: Implement Section 4 — Printify Product

**Files:**
- Modify: `src/components/PetPhotoProductGenerator.jsx`

**Step 1: Add Printify helpers**

```js
// Extract product ID from a Printify URL or raw ID string
// Handles URLs like: https://printify.com/app/editor/12345/...
// or https://printify.com/app/products/12345 or just "12345"
const extractPrintifyId = (urlOrId) => {
  const match = urlOrId.match(/\/(\d{6,})/); // 6+ digit number in path
  return match ? match[1] : urlOrId.trim();
};

const handleLoadTemplate = async () => {
  const productId = extractPrintifyId(printifyUrl);
  if (!productId) return;

  setIsLoadingTemplate(true);
  setPrintifyTemplate(null);
  setCreatedProducts([]);

  try {
    // Fetch from the source shop — template could be in any shop, use shopId query param
    // Default fetch without shopId uses INSTAME_SHOP_PRINTIFY_SHOP_ID; user can adjust
    const res = await fetch(`http://localhost:3001/api/printify/product/${productId}`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Failed to load product");
    setPrintifyTemplate(data);
  } catch (err) {
    alert("Failed to load Printify product: " + err.message);
  } finally {
    setIsLoadingTemplate(false);
  }
};

const handleCreateProducts = async () => {
  const selectedImages = generatedImages.filter((img) => img.selected);
  if (!selectedImages.length || !printifyTemplate) return;

  setIsCreating(true);
  setCreatedProducts([]);

  const MANUAL_SHOP_ID = "24261029";
  const petNames = petPhotos.map((p) => p.petName).filter(Boolean).join(", ");
  const promptName = availablePrompts.find((p) => p.handle === selectedPromptHandle)?.name || "custom";

  const results = [];

  for (let i = 0; i < selectedImages.length; i++) {
    const img = selectedImages[i];
    try {
      // 1. Upload image to Printify
      const uploadRes = await fetch("http://localhost:3001/api/printify/upload-image", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fileName: `pet-art-${Date.now()}-${i}.png`,
          imageBase64: img.imageBase64,
        }),
      });
      const uploadData = await uploadRes.json();
      if (!uploadRes.ok) throw new Error(uploadData.error || "Upload failed");

      // 2. Create product in Manual shop
      const customTitle = `${petNames || "Pet"} – ${promptName}${selectedImages.length > 1 ? ` (${i + 1})` : ""}`;
      const createRes = await fetch("http://localhost:3001/api/printify/create-product", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          template: printifyTemplate,
          uploadedImageId: uploadData.id,
          customTitle,
          shopId: MANUAL_SHOP_ID,
        }),
      });
      const createData = await createRes.json();
      if (!createRes.ok) throw new Error(createData.error || "Create failed");

      results.push({
        id: createData.product.id,
        title: customTitle,
        url: `https://printify.com/app/editor/${createData.product.id}`,
      });
    } catch (err) {
      results.push({ error: err.message, index: i });
    }
  }

  setCreatedProducts(results);
  setIsCreating(false);
};
```

**Step 2: Replace Section 4 comment with:**

```jsx
{/* ── Section 4: Printify Product ── */}
<section>
  <h2 className="text-lg font-semibold mb-3">4. Printify Product</h2>

  <div className="flex gap-2 mb-4">
    <input
      type="text"
      placeholder="Paste Printify product URL or ID"
      value={printifyUrl}
      onChange={(e) => { setPrintifyUrl(e.target.value); setPrintifyTemplate(null); }}
      className="flex-1 border rounded px-3 py-2 text-sm"
    />
    <button
      onClick={handleLoadTemplate}
      disabled={isLoadingTemplate || !printifyUrl}
      className="px-4 py-2 bg-gray-700 text-white rounded font-medium disabled:opacity-50 hover:bg-gray-800"
    >
      {isLoadingTemplate ? "Loading…" : "Load"}
    </button>
  </div>

  {printifyTemplate && (
    <div className="bg-gray-50 border rounded p-3 text-sm mb-4 space-y-1">
      <p><span className="font-medium">Template:</span> {printifyTemplate.title}</p>
      <p><span className="font-medium">Blueprint:</span> {printifyTemplate.blueprint_id}</p>
      <p><span className="font-medium">Variants:</span> {printifyTemplate.variants?.length}</p>
    </div>
  )}

  {printifyTemplate && (
    <button
      onClick={handleCreateProducts}
      disabled={isCreating || !generatedImages.some((i) => i.selected)}
      className="px-4 py-2 bg-green-600 text-white rounded font-medium disabled:opacity-50 hover:bg-green-700"
    >
      {isCreating
        ? "Creating…"
        : `Create Product${generatedImages.filter((i) => i.selected).length > 1 ? "s" : ""} in Manual Shop`}
    </button>
  )}

  {!generatedImages.some((i) => i.selected) && printifyTemplate && (
    <p className="text-xs text-gray-500 mt-2">Select at least one generated image above first.</p>
  )}

  {createdProducts.length > 0 && (
    <div className="mt-4 space-y-2">
      <p className="font-medium text-sm">Created Products:</p>
      {createdProducts.map((p, i) => (
        <div key={i} className="text-sm">
          {p.error ? (
            <span className="text-red-500">Image {p.index + 1}: {p.error}</span>
          ) : (
            <a
              href={p.url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-blue-600 hover:underline"
            >
              {p.title} →
            </a>
          )}
        </div>
      ))}
    </div>
  )}
</section>
```

**Step 3: Commit**

```bash
git add src/components/PetPhotoProductGenerator.jsx
git commit -m "feat: implement Printify section — create product in Manual shop"
```

---

### Task 9: End-to-end smoke test

**Step 1: Start the local API**
```bash
cd local-api && node server.js
```
Confirm: `🚀 Server running on port 3001`

**Step 2: Start the frontend**
```bash
cd .. && npm run dev
```

**Step 3: Full workflow test**
1. Open the app → select "Pet Photo Generator" from menu
2. Upload 1 pet photo, enter pet name
3. Select "line-art" from the style dropdown → verify all fields populate
4. Leave image count at 3, click Generate
5. Confirm 3 images appear
6. Select one image, verify selection border appears
7. Download one image, verify file downloads
8. Paste a Printify product URL → Load → verify template preview shows
9. Click Create Product → verify success link appears
10. Open the Printify link → confirm product exists in InstaMe (Manual) shop

**Step 4: Final commit if any fixes were needed**
```bash
git add -p
git commit -m "fix: end-to-end smoke test fixes"
```
