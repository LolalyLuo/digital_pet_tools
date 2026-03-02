# Pet Photo Product Generator — Design Doc
Date: 2026-03-02

## Overview

A single-page internal tool to generate AI pet art, then create a Printify product in the
InstaMe (Manual) shop (ID: 24261029). The operator uploads pet photos, selects a style
prompt, generates images, and clones a Printify product template with the chosen art.

---

## Section 1: Pet Photos

- Drag-and-drop / click-to-upload area supporting multiple images
- Each uploaded photo shows a thumbnail with a text input for the pet name
- X button to remove individual photos

---

## Section 2: Prompt Configuration

- Dropdown listing all `ai_image` metaobjects from `SHOPIFY_INSTAME_V2_SHOP` by name
- Selecting one auto-populates (all editable):
  - **Prompt** — multi-line textarea
  - **Provider/Model** — openai or gemini
  - **Aspect Ratio** — e.g. `1024x1024`
  - **Background** — `transparent` or `opaque`
  - **Need Pet Name** — checkbox
- **Image count** — number input, default 3

---

## Section 3: Generate Images

### Prompt Enhancement (applied before sending)
1. If `needpetname=true` and pet name exists:
   ```
   {prompt} The pet's name is {petName}. Include the pet's name in the image using the
   same style, color scheme, and texture. Keep the name subtle so it complements the image.
   ```
2. If `background === "transparent"`:
   ```
   Requirements:
   - Use the pet only and no other elements from the photo.
   - Background: Must be transparent with a white/gray checkerboard pattern.
   - Elements: All elements must be connected and attached to the pet.
   - Composition: Clean, centered design. Ensure some empty space around the pet, nothing cutoff.
   - Quality: High quality designs that print well on merchandise.
   ```
3. If `background === "opaque"`:
   ```
   Requirements:
   - Use the pet only and no other elements from the photo.
   - Background: Should match the general theme and style.
   - Composition: Clean, centered design that works on different product formats.
   - Quality: High quality designs with beautiful pet and detailed background.
   ```

### Background Removal
- If `background === "transparent"`, each generated image is passed through the
  **PhotoRoom API** (`PHOTOROOM_API_KEY`) to remove background before display.

### UI Behavior
- Generate button calls existing `/api/generate-images`
- Prompt/config fields stay live above results — regenerate always uses current values
- Results displayed as image grid
- Each image: Select toggle + Download button
- Regenerate button replaces current results with fresh generation

---

## Section 4: Printify Product

- Paste Printify product URL or product ID
- Load button: fetches spec via existing `/api/printify/product/:id`
- Shows brief preview: title, blueprint, variant count
- Create Product button:
  - For each selected image:
    1. Upload to Printify via `/api/printify/upload-image`
    2. Create product in shop **24261029** via `/api/printify/create-product`
       (with `shopId` param, cloning template spec with new art)
    3. Title: `{petName(s)} – {promptName}`
  - On success: link to each new Printify product

---

## Code Reuse Plan

### Frontend
- Reuse `useImageGeneration.js` hook for image generation calls
- Prompt enhancement logic extracted to a shared util (also used in existing flow)

### Backend
- `/api/printify/product/:id` — used as-is for template fetch
- `/api/printify/upload-image` — used as-is
- `/api/printify/create-product` — add optional `shopId` param (defaults to existing
  `INSTAME_SHOP_PRINTIFY_SHOP_ID`, override to `24261029` for this tool)

### New Backend Routes
- `GET /api/shopify-v2/ai-prompts` — fetches all `ai_image` metaobjects from
  `SHOPIFY_INSTAME_V2_SHOP` using `SHOPIFY_INSTAME_V2_ACCESS_TOKEN`
- `POST /api/images/remove-background` — calls PhotoRoom API to remove background

---

## File Structure

```
src/
  components/
    PetPhotoProductGenerator.jsx   ← main single-page component
    petPhotoGenerator/
      PetPhotoUpload.jsx           ← Section 1
      PromptConfig.jsx             ← Section 2
      ImageGenerator.jsx           ← Section 3 (wraps useImageGeneration)
      PrintifySection.jsx          ← Section 4

local-api/
  routes/
    shopifyV2Routes.js             ← new: ai-prompts endpoint
    imagesRoutes.js                ← new (or extend existing): remove-background endpoint
    printifyRoutes.js              ← extend: shopId param on create-product
```

---

## Environment Variables Used

| Variable | Purpose |
|---|---|
| `SHOPIFY_INSTAME_V2_SHOP` | V2 shop domain |
| `SHOPIFY_INSTAME_V2_ACCESS_TOKEN` | Direct access token for V2 shop |
| `PHOTOROOM_API_KEY` | Background removal |
| `PRINTIFY_API_KEY` | Printify API |
