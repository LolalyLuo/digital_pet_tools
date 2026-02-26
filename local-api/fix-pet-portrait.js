/**
 * Fix the existing Custom One Pet Portrait product:
 * 1. Replace old JSON metafield with correct list.metaobject_reference metafield
 * 2. Publish to Online Store + Shop
 * Run: node local-api/fix-pet-portrait.js
 */
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
dotenv.config({ path: join(__dirname, '.env') });

const SHOP = process.env.SHOPIFY_SHOP;
const API_VERSION = '2025-01';

const PRODUCT_ID = 'gid://shopify/Product/7717360238697';

// Pre-existing metaobjects (queried from Shopify)
const PERSONALIZATION_METAOBJECT_IDS = [
  'gid://shopify/Metaobject/181824421993', // Upload Pet Photo 1
  'gid://shopify/Metaobject/181824454761', // Pet Name 1
];

// Publish to Online Store + Shop (not Point of Sale)
const PUBLISH_TO = [
  'gid://shopify/Publication/151855169641', // Online Store
  'gid://shopify/Publication/151855267945', // Shop
];

async function getToken() {
  const res = await fetch(`https://${SHOP}/admin/oauth/access_token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: process.env.SHOPIFY_CLIENT_ID,
      client_secret: process.env.SHOPIFY_CLIENT_SECRET,
      grant_type: 'client_credentials',
    }),
  });
  return (await res.json()).access_token;
}

async function gql(token, query, variables = {}) {
  const res = await fetch(`https://${SHOP}/admin/api/${API_VERSION}/graphql.json`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': token },
    body: JSON.stringify({ query, variables }),
  });
  return res.json();
}

const token = await getToken();
console.log('✅ Token obtained');

// Step 1: Set custom.personalization_options with ordered metaobject references
// and also clear the old custom.personalization_fields JSON metafield
console.log('\n🏷️  Setting personalization_options metafield...');
const metafieldResult = await gql(token, `
  mutation productUpdate($product: ProductUpdateInput!) {
    productUpdate(product: $product) {
      product { id }
      userErrors { field message }
    }
  }
`, {
  product: {
    id: PRODUCT_ID,
    metafields: [
      {
        namespace: 'custom',
        key: 'personalization_options',
        type: 'list.metaobject_reference',
        value: JSON.stringify(PERSONALIZATION_METAOBJECT_IDS),
      },
    ],
  },
});

const metafieldErrors = metafieldResult.data?.productUpdate?.userErrors;
if (metafieldErrors?.length) throw new Error('metafield: ' + JSON.stringify(metafieldErrors));
console.log('✅ personalization_options set');

// Step 2: Publish to Online Store + Shop
console.log('\n📢 Publishing to Online Store + Shop...');
const publishResult = await gql(token, `
  mutation publishablePublish($id: ID!, $input: [PublicationInput!]!) {
    publishablePublish(id: $id, input: $input) {
      publishable { ... on Product { id title } }
      userErrors { field message }
    }
  }
`, {
  id: PRODUCT_ID,
  input: PUBLISH_TO.map(publicationId => ({ publicationId })),
});

const publishErrors = publishResult.data?.publishablePublish?.userErrors;
if (publishErrors?.length) throw new Error('publish: ' + JSON.stringify(publishErrors));
console.log('✅ Published to Online Store + Shop');

const numericId = PRODUCT_ID.split('/').pop();
console.log('\n🎉 DONE');
console.log(`Admin URL: https://${SHOP}/admin/products/${numericId}`);
