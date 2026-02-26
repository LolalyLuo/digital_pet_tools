import dotenv from "dotenv";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, ".env") });

const SHOPIFY_SHOP = process.env.SHOPIFY_SHOP;
const SHOPIFY_CLIENT_ID = process.env.SHOPIFY_CLIENT_ID;
const SHOPIFY_CLIENT_SECRET = process.env.SHOPIFY_CLIENT_SECRET;
const SHOPIFY_API_VERSION = "2025-01";

async function getAccessToken() {
  const res = await fetch(`https://${SHOPIFY_SHOP}/admin/oauth/access_token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: SHOPIFY_CLIENT_ID,
      client_secret: SHOPIFY_CLIENT_SECRET,
      grant_type: "client_credentials",
    }),
  });
  if (!res.ok) throw new Error(`Token failed (${res.status}): ${await res.text()}`);
  const data = await res.json();
  return data.access_token;
}

async function shopifyGraphQL(token, query, variables = {}) {
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
  if (!res.ok) throw new Error(`GraphQL failed (${res.status}): ${await res.text()}`);
  return res.json();
}

async function run() {
  console.log("--- Shopify Product Publish Test ---\n");

  console.log("1. Getting access token...");
  const token = await getAccessToken();
  console.log("   ✅ Token obtained\n");

  console.log("2. Creating product...");
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
        userErrors { field message }
      }
    }
  `, {
    input: {
      title: "Test Product — digital_pet_tools",
      descriptionHtml: "Automated test product created via GraphQL Admin API client credentials flow.",
      status: "DRAFT",
    },
  });

  const userErrors = createResult.data?.productCreate?.userErrors;
  if (userErrors?.length > 0) {
    console.error("   ❌ userErrors:", userErrors);
    process.exit(1);
  }

  const created = createResult.data?.productCreate?.product;
  if (!created) {
    console.error("   ❌ No product in response:", JSON.stringify(createResult, null, 2));
    process.exit(1);
  }
  console.log("   ✅ Product created:");
  console.log("      ID:", created.id);
  console.log("      Title:", created.title);
  console.log("      Status:", created.status);
  console.log("      Created:", created.createdAt, "\n");

  console.log("3. Confirming product exists (fetch back from API)...");
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
  if (!confirmed) {
    console.error("   ❌ Could not confirm product:", JSON.stringify(confirmResult, null, 2));
    process.exit(1);
  }

  console.log("   ✅ Product confirmed in Shopify:");
  console.log("      ID:", confirmed.id);
  console.log("      Title:", confirmed.title);
  console.log("      Status:", confirmed.status);
  console.log("\n✅ All steps passed. Product is live in Shopify (as DRAFT).");
}

run().catch((err) => {
  console.error("❌ Fatal error:", err.message);
  process.exit(1);
});
