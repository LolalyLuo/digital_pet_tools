/**
 * Inspect metaobject definitions, metaobjects, and product metafield definitions
 * Run: node local-api/inspect-metafields.js
 */
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
dotenv.config({ path: join(__dirname, '.env') });

const SHOP = process.env.SHOPIFY_SHOP;
const CLIENT_ID = process.env.SHOPIFY_CLIENT_ID;
const CLIENT_SECRET = process.env.SHOPIFY_CLIENT_SECRET;
const API_VERSION = '2025-01';

async function getToken() {
  const res = await fetch(`https://${SHOP}/admin/oauth/access_token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_id: CLIENT_ID, client_secret: CLIENT_SECRET, grant_type: 'client_credentials' }),
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
console.log('✅ Token obtained\n');

// 1. All metaobject definitions
const defs = await gql(token, `{
  metaobjectDefinitions(first: 20) {
    nodes {
      id name type
      fieldDefinitions { key name type { name } required }
    }
  }
}`);
console.log('=== METAOBJECT DEFINITIONS ===');
console.log(JSON.stringify(defs.data?.metaobjectDefinitions?.nodes, null, 2));

// 2. All metaobjects of type personalization_fields (exact type from definition)
const objs = await gql(token, `{
  metaobjects(type: "personalization_fields", first: 50) {
    nodes { id handle displayName fields { key value } }
  }
}`);
const nodes = objs.data?.metaobjects?.nodes;
console.log(`\n=== METAOBJECTS type="personalization_fields" (${nodes?.length ?? 0}) ===`);
console.log(JSON.stringify(nodes, null, 2));

// 3. Product metafield definitions
const metafieldDefs = await gql(token, `{
  metafieldDefinitions(first: 30, ownerType: PRODUCT) {
    nodes { id name namespace key type { name } }
  }
}`);
console.log('\n=== PRODUCT METAFIELD DEFINITIONS ===');
console.log(JSON.stringify(metafieldDefs.data?.metafieldDefinitions?.nodes, null, 2));

// 4. Check publications (sales channels) available
const pubs = await gql(token, `{
  publications(first: 10) {
    nodes { id name }
  }
}`);
console.log('\n=== PUBLICATIONS / SALES CHANNELS ===');
console.log(JSON.stringify(pubs.data?.publications?.nodes, null, 2));
