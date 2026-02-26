# Pet Name Cross-Table Filter Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a Pet Name filter to the `ai_images` and `personalized_images` tabs in `ProdImages.jsx` by doing a two-step query — first fetching matching `upload_id`s from the `pets` table, then filtering the target table.

**Architecture:** The `filterPetName` state already exists and works for the `pets` tab. For `ai_images` and `personalized_images`, we add a pre-query step inside `loadItems` that resolves pet name → upload_ids before the main query runs. The JSX filter bar (duplicated for empty/non-empty state) needs the Pet Name input shown for the two additional tables.

**Tech Stack:** React, Supabase JS client (`@supabase/supabase-js`), Tailwind CSS

---

### Task 1: Show Pet Name filter input on `ai_images` and `personalized_images` tabs

**Files:**
- Modify: `src/components/ProdImages.jsx`

The filter bar JSX is duplicated — once for the empty state (around line 333) and once for the loaded state (around line 560). Both need updating.

**Step 1: Update the empty-state filter bar (first occurrence)**

Find this block (around line 333):
```jsx
{selectedTable === 'pets' && (
  <div className="flex items-center gap-2 flex-1">
    <label className="text-sm font-medium text-gray-700 whitespace-nowrap">Pet Name:</label>
    ...
  </div>
)}
{selectedTable === 'ai_images' && (
```

Change the condition from `selectedTable === 'pets'` to show for all three tables:
```jsx
{(selectedTable === 'pets' || selectedTable === 'ai_images' || selectedTable === 'personalized_images') && (
```

**Step 2: Update the loaded-state filter bar (second occurrence)**

Find the same block around line 560 and apply the identical condition change.

**Step 3: Verify visually**
- Switch to AI Images tab → Pet Name input should appear
- Switch to Personalized Images tab → Pet Name input should appear
- Switch to Pets tab → Pet Name input still appears

**Step 4: Commit**
```bash
git add src/components/ProdImages.jsx
git commit -m "feat: show pet name filter input on ai_images and personalized_images tabs"
```

---

### Task 2: Add cross-table pet name lookup in `loadItems`

**Files:**
- Modify: `src/components/ProdImages.jsx`

**Step 1: Locate the pet name filter logic in `loadItems`**

Find this block (around line 107):
```js
// Apply pet name filter if provided (pets table only)
if (selectedTable === 'pets' && filterPetName.trim()) {
  query = query.ilike('pet_name', `%${filterPetName.trim()}%`)
}
```

**Step 2: Replace with cross-table lookup logic**

```js
// Apply pet name filter
if (filterPetName.trim()) {
  if (selectedTable === 'pets') {
    // Direct filter on pets table
    query = query.ilike('pet_name', `%${filterPetName.trim()}%`)
  } else {
    // Cross-table lookup: find upload_ids from pets where pet_name matches
    const { data: petMatches, error: petError } = await prodSupabase
      .from('pets')
      .select('upload_id')
      .ilike('pet_name', `%${filterPetName.trim()}%`)

    if (petError) {
      console.error('Pet name lookup error:', petError)
      throw petError
    }

    const uploadIds = (petMatches || []).map(p => p.upload_id).filter(Boolean)

    if (uploadIds.length === 0) {
      // No pets matched — return early with empty results
      if (append) {
        setItems(prev => prev)
      } else {
        setItems([])
      }
      setHasMore(false)
      setPage(pageNum)
      setLoading(false)
      return
    }

    query = query.in('upload_id', uploadIds)
  }
}
```

**Step 3: Verify the early-return path doesn't skip `finally`**

The existing `loadItems` has a `try/catch/finally` where `finally` sets `setLoading(false)`. Since we're returning early inside the `try` block, we need to set loading false before returning. The code above does this (`setLoading(false)` before `return`). Double-check the `finally` block still runs for the normal path — it will, since early return exits only the early path.

**Step 4: Manual test — AI Images tab**
1. Switch to AI Images tab
2. Type a known pet name in the Pet Name filter
3. Click Search
4. Verify only images belonging to that pet appear
5. Clear the filter → verify all images load again

**Step 5: Manual test — Personalized Images tab**
1. Switch to Personalized Images tab
2. Type the same pet name
3. Click Search
4. Verify results are filtered correctly

**Step 6: Manual test — no match**
1. Type a pet name that doesn't exist (e.g. "zzznomatch")
2. Click Search
3. Verify empty state is shown

**Step 7: Commit**
```bash
git add src/components/ProdImages.jsx
git commit -m "feat: filter ai_images and personalized_images by pet name via upload_id lookup"
```

---

## Plan complete and saved to `docs/plans/2026-02-22-pet-name-cross-table-filter.md`.

Two execution options:

**1. Subagent-Driven (this session)** — I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Parallel Session (separate)** — Open a new session with executing-plans, batch execution with checkpoints

Which approach?
