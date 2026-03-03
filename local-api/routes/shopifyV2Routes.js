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
