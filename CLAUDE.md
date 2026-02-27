# digital_pet_tools — Project Notes

## Stack

- **Frontend:** React 19 + Vite 7 + Tailwind CSS v4
- **Backend:** `local-api/` — Express.js server on port 3001
- **Database/Functions:** Supabase (project: `mpvhnncyxkhlorkntcwm`)

## Shopify Integration

- **Shop:** `instame-shop.myshopify.com`
- **Backend location:** `local-api/routes/shopifyRoutes.js`
- **Credentials:** `local-api/.env` — `SHOPIFY_SHOP`, `SHOPIFY_CLIENT_ID`, `SHOPIFY_CLIENT_SECRET`
- All Shopify API calls go through `local-api/` Express routes, never the React frontend

## Printify Setup

Two parallel shop systems are running:

### InstaMe V2 (established)
Personalization-first model — users see instant live previews. Two linked shops:
- **Mother shop** (`24488950` — "InstaMe V2 (Mother)"): Used to publish products to Shopify. Source of truth for product catalog.
- **Customer shop** (`24489195` — "InstaMe V2 (customer)"): Stores personalized products created for specific customers.

### My Shopify Store (in progress)
Traditional shop model — personalization happens in the background, no instant preview for users.
- **Shop ID:** `26612298` — "My Shopify Store" (Shopify channel)
- This is the shop currently being built in this project.

### All Printify Shops (full list)

| ID | Title | Channel |
|----|-------|---------|
| `24237495` | InstaMe | custom_integration |
| `24261029` | InstaMe (Manual) | custom_integration |
| `24471428` | instame-2-adr | shopify |
| `24488950` | InstaMe V2 (Mother) | shopify |
| `24489195` | InstaMe V2 (customer) | custom_integration |
| `26180670` | Etsy Customer Store | custom_integration |
| `26205430` | My Etsy Store | etsy |
| `26252347` | My TikTok Shop | tiktok |
| `26612298` | My Shopify Store | shopify |

To refresh this list: use the `printify-shops` skill.
