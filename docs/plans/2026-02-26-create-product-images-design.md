# Create Product Images — Design Doc
**Date:** 2026-02-26
**Page:** "Create Product Images" (replaces "Create Products" stub in nav)

---

## Overview

A 5-step wizard that takes a seed AI image + an existing Shopify product + an existing Printify product (seed design) and produces variant images for every background color. Each background color gets a unique Gemini image-to-image generation, the results are turned into Printify mockup products, and the approved mockup images are uploaded to the correct Shopify variants — with no duplicate uploads.

---

## Architecture

### Frontend
- `src/components/CreateProducts.jsx` — replace stub with full stepper wizard
- One sub-component per step: `InputsStep`, `ConfigureVariantsStep`, `GenerateImagesStep`, `PrintifyMockupsStep`, `ConfirmUploadStep`
- State: React component state for session, `localStorage` for seed color pick + hex codes + size-shares-image toggle
- Nav label renamed from "Create Products" → "Create Product Images"

### Backend — new routes in `local-api/routes/`
| Route | Purpose |
|---|---|
| `GET /api/shopify/product/:id` | Fetch product title + variant options |
| `POST /api/shopify/variant-images` | Upload media + assign to variants |
| `GET /api/printify/product/:id` | Fetch seed product template |
| `POST /api/printify/upload-image` | Upload image buffer to Printify |
| `POST /api/printify/create-product` | createProductDirect (ported from InstaMe) |
| Reuse existing `POST /api/generate-images` | Gemini image-to-image |

### Supabase — InstaMeShop DB (`igwekemyevllvmgqdmtl`)
Uses existing tables:
- `products` — one row per Shopify product processed
- `seed_images` — one row per seed image upload
- `ai_generated_images` — one row per Gemini-generated variant
- `product_mockup_images` — one row per selected Printify mockup image

---

## Step 1 — Inputs

**UI:**
- Drag & drop / file picker for seed image (shows thumbnail preview)
- Shopify product URL input (e.g. `https://admin.shopify.com/store/instame-shop/products/7717360238697`) — extracts numeric ID, calls `GET /api/shopify/product/:id`, shows product title as green confirmation on success
- Printify product URL input (e.g. `https://printify.com/app/product-details/699f91fcf38bdbd36701b743`) — extracts product ID, calls `GET /api/printify/product/:id`, shows product title as confirmation
- Shopify + Printify fetches are debounced on URL paste (eager, not on Next click)
- "Next" enabled when all three inputs are valid

**On Next:**
1. Upload seed image to Supabase `seed-images` bucket
2. Insert `products` row → get `product_id`
3. Insert `seed_images` row linked to `product_id` → get `seed_image_id`
4. Both IDs carried through the rest of the session

---

## Step 2 — Configure Variants

Variant options are read dynamically from the Shopify product. Only options the product actually has are rendered. Supported types:

**Background Color** (design-driving, if present):
- List of color rows: swatch (rendered from hex) + name + hex code text input
- One row marked as **Seed** — this color is skipped during generation. User picks the seed color; stored in `localStorage`
- Summary: "Will generate N images (M colors minus 1 seed)"
- Hex codes stored in `localStorage`

**Size** (if present):
- List of sizes read from Shopify
- Checkbox: "All sizes share the same image" — if checked, one Printify product covers all size variants; if unchecked, separate Printify products per size
- Default: checked. Stored in `localStorage`

**Frame Color** (if present):
- Informational list only — no image generation needed, shares the AI image for its background color
- No user input

"Next" enabled when: at least one background color has a seed selected (if bg color option exists) and all hex codes are filled in.

---

## Step 3 — Generate Images

Fires automatically on step load — all non-seed background colors generate in parallel.

**Layout:** Grid of cards, one per non-seed background color.

**Card states:**
- Generating: spinner
- Success: generated image (full preview on click), breed + name metadata shown, Regenerate button
- Error: error message + Regenerate button

**Pre-generation LLM call:**
Before Gemini fires, call an LLM (Gemini text or OpenAI) to produce N distinct breed + name combos (N = number of images). Ensures no two cards get the same breed.

**Gemini image-to-image prompt:**
> Keep the exact artistic style (watercolor / pencil / cartoon / etc.), composition, textures, and overall aesthetic of the seed image. Change only: (1) background to `[hex]` (`[color name]`), (2) pet breed to `[LLM-chosen breed]`, (3) pet name text to `[LLM-chosen name]` in `[white if dark bg / black if light bg]` (chosen by luminance of hex). All other visual elements stay identical.

**On Regenerate:** Opens inline text input ("Describe what to fix — optional"). Re-rolls a fresh breed+name for that card only and appends "Also: [feedback]" to the prompt.

"Approve & Continue" enabled when all cards are in success state.

---

## Step 4 — Printify Mockups

**On step load:** Create one Printify product per approved AI image in parallel using `createProductDirect` pattern (blueprint_id, print_provider_id, variants, print_areas all read from the seed Printify product template).

**Creation progress:** Status row per color — "Creating [Pink]..." → "✅ Pink"

**Mockup grid — grouped by position index across all products:**

| Position 1 (Front) | Position 2 (Tilted) | Position 3 (Lifestyle) | … |
|---|---|---|---|
| white_p1 | white_p2 | white_p3 | |
| grey_p1 | grey_p2 | grey_p3 | |
| pink_p1 | … | … | |

- Each position group has a "Select all in this row" toggle
- Individual images also selectable
- Selected images get a checkmark overlay
- Each background color can have multiple positions selected (e.g. front + lifestyle = 2 Shopify variant images)

"Next" enabled when at least one image is selected.

---

## Step 5 — Confirm & Upload

**Mapping table:** Shows each Shopify variant → its assigned image(s). Where multiple variants share the same image, the same thumbnail appears on multiple rows with a "shared" label.

**On Confirm & Upload:**
1. Deduplicate selected mockup images (same image may cover many variants)
2. Upload each unique image to Shopify via `productCreateMedia` → collect `mediaId`s
3. Batch-assign all variant→mediaId pairs via `productVariantAppendMedia` in one call (no duplicate uploads)
4. Download selected Printify mockup images → upload to Supabase `product-images` bucket
5. Insert `ai_generated_images` rows (linked to `seed_image_id`, `generation_params` JSONB: breed, name, hex, color name)
6. Insert `product_mockup_images` rows (linked to `ai_image_id` + `product_id`, `variant_attributes` JSONB)

Progress bar shown during upload. Success screen with link to Shopify admin product page.

---

## Key Shopify API Notes
- Upload image once: `productCreateMedia` → returns `mediaId`
- Assign same `mediaId` to N variants: `productVariantAppendMedia` (batch, one call)
- API version: `2025-01`
- Credentials: `SHOPIFY_SHOP` + `SHOPIFY_CLIENT_ID` + `SHOPIFY_CLIENT_SECRET` from `local-api/.env`

## Key Printify Notes
- Shop ID: `INSTAME_SHOP_PRINTIFY_SHOP_ID=26612298`
- Template read from seed product: `blueprint_id`, `print_provider_id`, enabled `variants`, `print_areas`
- Image upload: `POST /v1/uploads/images.json`
- Product create: `POST /v1/shops/{shopId}/products.json`

## localStorage Keys
- `cpw_seed_color` — which background color is the seed
- `cpw_hex_codes` — map of color name → hex string
- `cpw_size_shared` — boolean, whether all sizes share one image
