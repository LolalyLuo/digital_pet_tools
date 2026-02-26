import express from "express";

const router = express.Router();

const SHOPIFY_API_VERSION = "2025-01";

// Get a short-lived access token via client credentials grant
async function getAccessToken() {
  const SHOPIFY_SHOP = process.env.SHOPIFY_SHOP;
  const SHOPIFY_CLIENT_ID = process.env.SHOPIFY_CLIENT_ID;
  const SHOPIFY_CLIENT_SECRET = process.env.SHOPIFY_CLIENT_SECRET;
  const res = await fetch(
    `https://${SHOPIFY_SHOP}/admin/oauth/access_token`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        client_id: SHOPIFY_CLIENT_ID,
        client_secret: SHOPIFY_CLIENT_SECRET,
        grant_type: "client_credentials",
      }),
    }
  );

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Token request failed (${res.status}): ${text}`);
  }

  const data = await res.json();
  return data.access_token;
}

// Run a GraphQL mutation/query against the Admin API
async function shopifyGraphQL(token, query, variables = {}) {
  const SHOPIFY_SHOP = process.env.SHOPIFY_SHOP;
  const res = await fetch(
    `https://${SHOPIFY_SHOP}/admin/api/${SHOPIFY_API_VERSION}/graphql.json`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": token,
      },
      body: JSON.stringify({ query, variables }),
    }
  );

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`GraphQL request failed (${res.status}): ${text}`);
  }

  return res.json();
}

// POST /api/shopify/test-publish
// Creates a test product and confirms it exists
router.post("/test-publish", async (req, res) => {
  try {
    console.log("🛍️  Getting Shopify access token...");
    const token = await getAccessToken();
    console.log("✅ Token obtained");

    const title = "Test Product from digital_pet_tools";
    const description = "This is an automated test product created via the Admin API GraphQL client credentials flow.";

    console.log("📦 Creating product...");
    const createResult = await shopifyGraphQL(token, `
      mutation productCreate($input: ProductInput!) {
        productCreate(input: $input) {
          product {
            id
            title
            descriptionHtml
            status
            createdAt
          }
          userErrors {
            field
            message
          }
        }
      }
    `, {
      input: {
        title,
        descriptionHtml: description,
        status: "DRAFT",
      },
    });

    const userErrors = createResult.data?.productCreate?.userErrors;
    if (userErrors?.length > 0) {
      return res.status(400).json({ error: "Shopify userErrors", details: userErrors });
    }

    const created = createResult.data?.productCreate?.product;
    if (!created) {
      return res.status(500).json({ error: "Product not returned", raw: createResult });
    }

    console.log(`✅ Product created: ${created.id}`);

    // Confirm it exists by fetching it back
    console.log("🔍 Confirming product exists...");
    const confirmResult = await shopifyGraphQL(token, `
      query getProduct($id: ID!) {
        product(id: $id) {
          id
          title
          descriptionHtml
          status
          createdAt
        }
      }
    `, { id: created.id });

    const confirmed = confirmResult.data?.product;

    console.log("✅ Product confirmed in Shopify");
    res.json({
      success: true,
      created,
      confirmed,
    });
  } catch (err) {
    console.error("❌ Shopify test-publish error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/shopify/product/:id
// Fetches product title + variant options from Shopify
router.get("/product/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const gid = `gid://shopify/Product/${id}`;
    const token = await getAccessToken();

    const result = await shopifyGraphQL(token, `
      query getProduct($id: ID!) {
        product(id: $id) {
          id
          title
          options {
            id
            name
            values
          }
          variants(first: 250) {
            edges {
              node {
                id
                title
                price
                selectedOptions {
                  name
                  value
                }
              }
            }
          }
        }
      }
    `, { id: gid });

    const product = result.data?.product;
    if (!product) {
      return res.status(404).json({ error: "Product not found" });
    }

    res.json({
      id: product.id,
      numericId: id,
      title: product.title,
      options: product.options,
      variants: product.variants.edges.map((e) => e.node),
    });
  } catch (err) {
    console.error("❌ Shopify product fetch error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/shopify/variant-images
// Body: { productId: "123", assignments: [{ imageUrl: "https://...", variantIds: ["gid://..."] }] }
// Uploads each unique image once, then assigns mediaIds to variants in one batch call.
router.post("/variant-images", async (req, res) => {
  try {
    const { productId, assignments } = req.body;
    if (!productId || !assignments?.length) {
      return res.status(400).json({ error: "productId and assignments required" });
    }

    const shopifyProductGid = `gid://shopify/Product/${productId}`;
    const token = await getAccessToken();

    // Step 1: Upload each unique imageUrl once → collect mediaId per URL
    const urlToMediaId = {};
    for (const { imageUrl } of assignments) {
      if (urlToMediaId[imageUrl]) continue; // already uploaded

      const uploadResult = await shopifyGraphQL(token, `
        mutation productCreateMedia($productId: ID!, $media: [CreateMediaInput!]!) {
          productCreateMedia(productId: $productId, media: $media) {
            media {
              id
              status
            }
            mediaUserErrors { field message }
          }
        }
      `, {
        productId: shopifyProductGid,
        media: [{ originalSource: imageUrl, mediaContentType: "IMAGE" }],
      });

      const mediaErrors = uploadResult.data?.productCreateMedia?.mediaUserErrors;
      if (mediaErrors?.length) {
        return res.status(400).json({ error: "Media upload error", details: mediaErrors });
      }

      const mediaId = uploadResult.data?.productCreateMedia?.media?.[0]?.id;
      if (!mediaId) {
        return res.status(500).json({ error: "No mediaId returned for " + imageUrl });
      }

      // Step 2: Poll until READY (max 30s)
      let ready = false;
      for (let attempt = 0; attempt < 15; attempt++) {
        await new Promise((r) => setTimeout(r, 2000));
        const statusResult = await shopifyGraphQL(token, `
          query { node(id: "${mediaId}") { ... on MediaImage { id status } } }
        `);
        const status = statusResult.data?.node?.status;
        if (status === "READY") { ready = true; break; }
        if (status === "FAILED") {
          return res.status(500).json({ error: `Media ${mediaId} failed processing` });
        }
      }
      if (!ready) {
        return res.status(500).json({ error: `Media ${mediaId} timed out` });
      }

      urlToMediaId[imageUrl] = mediaId;
    }

    // Step 3: Batch-assign all variant → mediaId pairs in one call
    const variantMedia = assignments.flatMap(({ imageUrl, variantIds }) =>
      variantIds.map((variantId) => ({
        variantId,
        mediaIds: [urlToMediaId[imageUrl]],
      }))
    );

    const assignResult = await shopifyGraphQL(token, `
      mutation productVariantAppendMedia($productId: ID!, $variantMedia: [ProductVariantAppendMediaInput!]!) {
        productVariantAppendMedia(productId: $productId, variantMedia: $variantMedia) {
          product { id }
          userErrors { field message }
        }
      }
    `, { productId: shopifyProductGid, variantMedia });

    const assignErrors = assignResult.data?.productVariantAppendMedia?.userErrors;
    if (assignErrors?.length) {
      return res.status(400).json({ error: "Variant assign error", details: assignErrors });
    }

    res.json({ success: true, uploadedMedia: urlToMediaId });
  } catch (err) {
    console.error("❌ variant-images error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

export default router;

