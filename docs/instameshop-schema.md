# InstaMeShop Database Schema

**Supabase project:** `igwekemyevllvmgqdmtl`
**Credentials:** `INSTAME_SHOP_SUPABASE_URL` + `INSTAME_SHOP_SERVICE_ROLE_KEY` in `local-api/.env`
**Express client:** `getInstameshopSupabase()` from `local-api/config/database.js`

---

## Rules

- No RLS on any table
- All storage buckets are public
- Storage paths are flat filenames at bucket root — no subdirectories

---

## Storage Buckets

| Bucket | Public | Used by |
|---|---|---|
| `seed-images` | Yes | `seed_images` table |
| `ai-images` | Yes | `ai_generated_images` table |
| `product-images` | Yes | `product_mockup_images` table |
| `user-uploads` | Yes | `user_uploads` table |

---

## Tables

### `products`
Central registry. All other product pipeline tables reference this.

| Column | Type | Nullable | Notes |
|---|---|---|---|
| `id` | UUID PK | No | `gen_random_uuid()` |
| `shopify_product_id` | TEXT | No | e.g. `gid://shopify/Product/123` |
| `name` | TEXT | No | e.g. `Deluxe Pet Portrait` |
| `product_type` | TEXT | No | `portrait` / `mug` / `blanket` |
| `created_at` | TIMESTAMPTZ | No | `now()` |

---

### `seed_images`
One seed image per product. Starting point for AI generation.

| Column | Type | Nullable | Notes |
|---|---|---|---|
| `id` | UUID PK | No | |
| `product_id` | UUID FK → products | No | |
| `storage_path` | TEXT | No | filename in `seed-images` bucket |
| `created_at` | TIMESTAMPTZ | No | `now()` |

---

### `ai_generated_images`
AI-generated variants from the seed image (different breeds, backgrounds, styles, etc.).

| Column | Type | Nullable | Notes |
|---|---|---|---|
| `id` | UUID PK | No | |
| `seed_image_id` | UUID FK → seed_images | No | |
| `storage_path` | TEXT | No | filename in `ai-images` bucket |
| `generation_params` | JSONB | Yes | breed, style, background color used, etc. |
| `created_at` | TIMESTAMPTZ | No | `now()` |

---

### `product_mockup_images`
Final mockup images downloaded after uploading AI images to Printify (or other future providers). One row per unique variant combination that needs a distinct image.

| Column | Type | Nullable | Notes |
|---|---|---|---|
| `id` | UUID PK | No | |
| `ai_image_id` | UUID FK → ai_generated_images | No | |
| `product_id` | UUID FK → products | No | denormalized for fast lookup |
| `printify_catalog_product_id` | TEXT | Yes | blank base product from Printify's catalog |
| `printify_custom_product_id` | TEXT | Yes | our design applied to the base product |
| `storage_path` | TEXT | No | filename in `product-images` bucket |
| `variant_attributes` | JSONB | No | see notes below |
| `created_at` | TIMESTAMPTZ | No | `now()` |

**`variant_attributes` examples:**
```json
// Portrait — sizes don't affect image, background + frame do
{ "background_color": "white", "frame_color": "gold", "sizes": ["S", "M", "L"] }

// Mug — size affects image
{ "mug_color": "black", "size": "11oz" }

// Blanket — size only
{ "sizes": ["S", "M", "L"] }
```

---

### `user_uploads`
Tracks photos uploaded by customers. History is kept — old uploads are marked `replaced` or `abandoned`, never deleted.

| Column | Type | Nullable | Notes |
|---|---|---|---|
| `id` | UUID PK | No | |
| `session_id` | TEXT | No | unique visitor session identifier |
| `product_id` | UUID FK → products | No | which product they're customizing |
| `photo_storage_path` | TEXT | No | filename in `user-uploads` bucket |
| `pet_name` | TEXT | Yes | name entered by user |
| `status` | TEXT | No | `active` / `replaced` / `abandoned` — default `active` |
| `extra_fields` | JSONB | Yes | custom inputs: dates, text, messages, etc. |
| `created_at` | TIMESTAMPTZ | No | `now()` |
| `updated_at` | TIMESTAMPTZ | No | updated when status changes |

---

## Pipeline

```
products
  └── seed_images           (one seed image per product)
        └── ai_generated_images   (multiple AI variants per seed)
              └── product_mockup_images  (one mockup per variant combo)
```
