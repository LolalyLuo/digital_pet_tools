# Pet Name Cross-Table Filter — Design

**Date:** 2026-02-22
**Status:** Approved

## Problem

In `ProdImages.jsx`, the Pet Name filter only works on the `pets` tab. When viewing `ai_images` or `personalized_images`, there is no way to filter by pet name — even though all three tables share an `upload_id` key that links to the `pets` table.

## Solution

Option A: Two-step query. When pet name filter is set on `ai_images` or `personalized_images`, first fetch matching `upload_id`s from `pets`, then filter the target table using `.in('upload_id', uploadIds)`.

## Schema (instame-2.0 Supabase project)

- `pets`: `upload_id` (unique), `pet_name`
- `ai_images`: `upload_id` (FK to pets), no `pet_name`
- `personalized_images`: `upload_id` (FK to pets), no `pet_name`

## Data Flow

1. User types pet name → visible on all 3 tabs
2. User triggers search
3. `loadItems` checks: `filterPetName` set AND table is `ai_images` or `personalized_images`
4. Pre-query `pets`: `select('upload_id').ilike('pet_name', '%value%')`
5. If no matches → return early, show empty state
6. If matches → apply `.in('upload_id', uploadIds)` to main query
7. Normal pagination continues

## Edge Cases

- No matching pets → empty results, no second query fired
- Pet name on `pets` tab → unchanged direct filter
- Clearing filter → no lookup, normal behavior

## Files Changed

- `src/components/ProdImages.jsx` only
