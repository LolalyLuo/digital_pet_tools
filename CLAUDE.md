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
