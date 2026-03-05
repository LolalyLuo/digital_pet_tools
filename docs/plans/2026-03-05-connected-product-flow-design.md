# Connected Product Flow — Design

## Problem
The competitor-scraping skill (CLI) and the image generation tool (UI) are disconnected. After creating a Shopify product via CLI, you have to manually copy the product URL into the UI tool.

## Solution
Add a new Step 0 ("Competitor Scrape") to the existing UI flow. Paste a Shopify competitor URL → see editable product data → confirm → Shopify product gets created → auto-advances into the existing image pipeline (Steps 1–5).

## Architecture

### New Backend Endpoints

**POST `/api/product-images/scrape-competitor`**
- Input: `{ url: "https://competitor-store.com/products/custom-pet-portrait" }`
- Fetches `{url}.json` (Shopify stores expose product JSON)
- Normalizes into our config shape: title, descriptionHtml, options (with colorMap), prices (with compareAtPrice), vendor="InstaMe"
- Returns the editable config object

**POST `/api/product-images/create-from-scrape`**
- Input: edited config object (same shape as Supabase `products.config`)
- Runs the full creation pipeline: product → options → variants → disable inventory tracking → personalization metafield → publish
- Saves config to Supabase `products` table
- Returns `{ shopifyProductId, shopifyProductNumericId, adminUrl, supabaseProductId }`

### New Frontend Component

**`CompetitorScrapeStep.jsx`** — Step 0 in the flow
- URL input field (paste competitor Shopify store URL)
- After scraping: editable form with:
  - Title (text input)
  - Description (textarea with HTML)
  - Options table: name + values (can remove values)
  - Color map editor (hex picker for background color option)
  - Variant price table: price + compareAtPrice columns
  - Personalization fields selector (checkboxes for existing metaobjects)
  - Number of pets selector
- "Create Product" button → creates Shopify product → auto-fills InputsStep

### Flow Changes

**Before:** InputsStep → ConfigureVariants → GenerateImages → PrintifyMockups → ConfirmUpload
**After:** CompetitorScrape → InputsStep → ConfigureVariants → GenerateImages → PrintifyMockups → ConfirmUpload

The Shopify product URL in InputsStep gets auto-populated from Step 0's output. User still needs to manually provide: seed image and Printify template URL (these can't be scraped from competitors).

### Config Shape (unchanged)
Uses the existing `products.config` JSONB shape — no schema changes needed.

### Key Details
- compareAtPrice: scraped from Shopify's `compare_at_price` field on each variant
- Vendor: always "InstaMe"
- Personalization: reuses existing metaobject GIDs (fetched via inspect-metafields logic built into the endpoint)
- Product created as DRAFT, published with Online Store + Shop channels
- Prices array format: `[price, compareAtPrice]` matching existing convention
