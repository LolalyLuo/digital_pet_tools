/**
 * create-from-config.js
 *
 * Creates (or recreates) a Shopify product from a config stored in the
 * Supabase `products` table.
 *
 * Usage:
 *   node local-api/create-from-config.js <supabase-product-id>
 *   node local-api/create-from-config.js <supabase-product-id> --recreate
 *
 * --recreate  Deletes the existing Shopify product first, then creates fresh.
 *             Use when you've edited the config and want a clean slate.
 */

import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
const require = createRequire(import.meta.url);
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
require('dotenv').config({ path: __dirname + '/.env' });

import { createClient } from '@supabase/supabase-js';

const SHOPIFY_API_VERSION = '2026-01';

// ─── Args ─────────────────────────────────────────────────────────────────────
const supabaseId = process.argv[2];
const recreate   = process.argv.includes('--recreate');

if (!supabaseId) {
  console.error('Usage: node create-from-config.js <supabase-product-id> [--recreate]');
  process.exit(1);
}

// ─── Clients ──────────────────────────────────────────────────────────────────
const supabase = createClient(
  process.env.INSTAME_SHOP_SUPABASE_URL,
  process.env.INSTAME_SHOP_SERVICE_ROLE_KEY
);

async function getAccessToken() {
  const res = await fetch(`https://${process.env.SHOPIFY_SHOP}/admin/oauth/access_token`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_id: process.env.SHOPIFY_CLIENT_ID, client_secret: process.env.SHOPIFY_CLIENT_SECRET, grant_type: 'client_credentials' })
  });
  const data = await res.json();
  if (!data.access_token) throw new Error('Token error: ' + JSON.stringify(data));
  return data.access_token;
}

async function shopifyGraphQL(token, query, variables = {}) {
  const res = await fetch(`https://${process.env.SHOPIFY_SHOP}/admin/api/${SHOPIFY_API_VERSION}/graphql.json`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': token },
    body: JSON.stringify({ query, variables })
  });
  return res.json();
}

// ─── Load config from Supabase ────────────────────────────────────────────────
async function loadConfig() {
  const { data, error } = await supabase
    .from('products')
    .select('*')
    .eq('id', supabaseId)
    .single();
  if (error) throw new Error('Supabase load failed: ' + error.message);
  if (!data.config) throw new Error(`Row ${supabaseId} has no config — populate it first.`);
  return data;
}

// ─── Optionally delete existing Shopify product ───────────────────────────────
async function deleteExistingProduct(token, shopifyProductId) {
  console.log(`\n🗑️  Deleting existing Shopify product: ${shopifyProductId}`);
  const result = await shopifyGraphQL(token, `
    mutation productDelete($input: ProductDeleteInput!) {
      productDelete(input: $input) {
        deletedProductId
        userErrors { field message }
      }
    }
  `, { input: { id: shopifyProductId } });
  const { userErrors, deletedProductId } = result.data.productDelete;
  if (userErrors?.length) throw new Error('productDelete: ' + JSON.stringify(userErrors));
  console.log(`✅ Deleted: ${deletedProductId}`);
}

// ─── Create product ───────────────────────────────────────────────────────────
async function createProduct(token, config) {
  console.log('\n📦 Creating product as DRAFT...');
  const result = await shopifyGraphQL(token, `
    mutation productCreate($product: ProductCreateInput!) {
      productCreate(product: $product) {
        product { id title status }
        userErrors { field message }
      }
    }
  `, {
    product: {
      title:           config.title,
      descriptionHtml: config.descriptionHtml,
      vendor:          config.vendor,
      productType:     config.productType,
      status:          'DRAFT',
    }
  });
  const { userErrors, product } = result.data.productCreate;
  if (userErrors?.length) throw new Error('productCreate: ' + JSON.stringify(userErrors));
  console.log(`✅ Product created: ${product.id}`);
  return product.id;
}

// ─── Create options ───────────────────────────────────────────────────────────
async function createOptions(token, productId, config) {
  console.log('\n🎨 Creating options...');
  const result = await shopifyGraphQL(token, `
    mutation productOptionsCreate($productId: ID!, $options: [OptionCreateInput!]!) {
      productOptionsCreate(productId: $productId, options: $options) {
        product { options { id name position optionValues { id name } } }
        userErrors { field message }
      }
    }
  `, {
    productId,
    options: config.options.map(o => ({
      name:   o.name,
      values: o.values.map(v => ({ name: v })),
    }))
  });
  const { userErrors, product } = result.data.productOptionsCreate;
  if (userErrors?.length) throw new Error('productOptionsCreate: ' + JSON.stringify(userErrors));
  product.options.forEach(o =>
    console.log(`   ${o.position}. ${o.name}: ${o.optionValues.map(v => v.name).join(', ')}`)
  );
  console.log('✅ Options created');
  return product.options;
}

// ─── Create variants ──────────────────────────────────────────────────────────
async function createVariants(token, productId, options, config) {
  const optionMap = Object.fromEntries(options.map(o => [o.name, o]));

  // Build all variant combinations from the options list
  const [opt1, opt2, opt3] = config.options;
  const allVariants = [];

  for (const v1 of opt1.values) {
    for (const v2 of (opt2?.values ?? [null])) {
      for (const v3 of (opt3?.values ?? [null])) {
        // Resolve price: try prices[v2][v3], prices[v1][v2], prices[v1] as fallbacks
        let priceEntry =
          config.prices?.[v2]?.[v3] ??
          config.prices?.[v1]?.[v2] ??
          config.prices?.[v1] ??
          null;

        const [price, compareAtPrice] = Array.isArray(priceEntry)
          ? priceEntry
          : ['0.00', null];

        const optionValues = [
          { optionId: optionMap[opt1.name].id, name: v1 },
          ...(opt2 ? [{ optionId: optionMap[opt2.name].id, name: v2 }] : []),
          ...(opt3 ? [{ optionId: optionMap[opt3.name].id, name: v3 }] : []),
        ];

        allVariants.push({ optionValues, price, compareAtPrice, inventoryPolicy: 'CONTINUE' });
      }
    }
  }

  // Check for Shopify auto-created variants
  const existingData = await shopifyGraphQL(token, `
    query { product(id: "${productId}") { variants(first: 100) { nodes { id title } } } }
  `);
  const existingTitles = new Set(existingData.data.product.variants.nodes.map(v => v.title));
  const existingIds    = Object.fromEntries(existingData.data.product.variants.nodes.map(v => [v.title, v.id]));

  const toCreate = allVariants.filter(v => {
    const title = v.optionValues.map(o => o.name).join(' / ');
    return !existingTitles.has(title);
  });
  const toUpdate = allVariants.filter(v => {
    const title = v.optionValues.map(o => o.name).join(' / ');
    return existingTitles.has(title);
  });

  console.log(`\n🔢 Creating ${allVariants.length} variants (${existingTitles.size} already exist)...`);

  if (toUpdate.length > 0) {
    const updateInputs = toUpdate.map(v => ({
      id:              existingIds[v.optionValues.map(o => o.name).join(' / ')],
      price:           v.price,
      compareAtPrice:  v.compareAtPrice,
      inventoryPolicy: 'CONTINUE',
    }));
    const result = await shopifyGraphQL(token, `
      mutation productVariantsBulkUpdate($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
        productVariantsBulkUpdate(productId: $productId, variants: $variants) {
          productVariants { id }
          userErrors { field message }
        }
      }
    `, { productId, variants: updateInputs });
    const { userErrors } = result.data.productVariantsBulkUpdate;
    if (userErrors?.length) throw new Error('variantsBulkUpdate: ' + JSON.stringify(userErrors));
    console.log(`   ✅ Updated ${toUpdate.length} existing variants`);
  }

  const BATCH = 25;
  let created = 0;
  for (let i = 0; i < toCreate.length; i += BATCH) {
    const batch = toCreate.slice(i, i + BATCH);
    const result = await shopifyGraphQL(token, `
      mutation productVariantsBulkCreate($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
        productVariantsBulkCreate(productId: $productId, variants: $variants) {
          productVariants { id title }
          userErrors { field message }
        }
      }
    `, { productId, variants: batch });
    const { userErrors, productVariants } = result.data.productVariantsBulkCreate;
    if (userErrors?.length) throw new Error('variantsBulkCreate: ' + JSON.stringify(userErrors));
    created += productVariants.length;
    console.log(`   ✅ Batch ${Math.floor(i / BATCH) + 1}: ${productVariants.length} created (total: ${created})`);
  }

  console.log(`✅ ${toUpdate.length + created} variants ready`);
}

// ─── Disable inventory tracking on all variants ───────────────────────────────
async function disableInventoryTracking(token, productId) {
  console.log('\n📦 Disabling inventory tracking...');
  const result = await shopifyGraphQL(token, `
    query { product(id: "${productId}") {
      variants(first: 100) { nodes { inventoryItem { id tracked } } }
    }}
  `);
  const items = result.data.product.variants.nodes
    .map(v => v.inventoryItem)
    .filter(i => i.tracked);

  if (items.length === 0) {
    console.log('   ✅ Already untracked');
    return;
  }

  let fixed = 0;
  for (const item of items) {
    const r = await shopifyGraphQL(token, `
      mutation inventoryItemUpdate($id: ID!, $input: InventoryItemInput!) {
        inventoryItemUpdate(id: $id, input: $input) {
          inventoryItem { id }
          userErrors { field message }
        }
      }
    `, { id: item.id, input: { tracked: false } });
    const { userErrors } = r.data.inventoryItemUpdate;
    if (userErrors?.length) throw new Error('inventoryItemUpdate: ' + JSON.stringify(userErrors));
    fixed++;
  }
  console.log(`✅ Disabled tracking on ${fixed} inventory items`);
}

// ─── Set personalization metafield ───────────────────────────────────────────
async function setPersonalizationMetafield(token, productId, config) {
  if (!config.personalizationGIDs?.length) return;
  console.log('\n🏷️  Setting personalization metafield...');
  const result = await shopifyGraphQL(token, `
    mutation productUpdate($product: ProductUpdateInput!) {
      productUpdate(product: $product) {
        product { id }
        userErrors { field message }
      }
    }
  `, {
    product: {
      id: productId,
      metafields: [{
        namespace: 'custom',
        key:       'personalization_options',
        type:      'list.metaobject_reference',
        value:     JSON.stringify(config.personalizationGIDs),
      }]
    }
  });
  const { userErrors } = result.data.productUpdate;
  if (userErrors?.length) throw new Error('metafield: ' + JSON.stringify(userErrors));
  console.log(`✅ Metafield set (${config.personalizationGIDs.length} fields)`);
}

// ─── Publish ──────────────────────────────────────────────────────────────────
async function publishProduct(token, productId, config) {
  console.log('\n🚀 Publishing...');
  const result = await shopifyGraphQL(token, `
    mutation publishablePublish($id: ID!, $input: [PublicationInput!]!) {
      publishablePublish(id: $id, input: $input) {
        publishable { ... on Product { id title } }
        userErrors { field message }
      }
    }
  `, {
    id:    productId,
    input: config.publicationIDs.map(publicationId => ({ publicationId })),
  });
  const { userErrors, publishable } = result.data.publishablePublish;
  if (userErrors?.length) throw new Error('publish: ' + JSON.stringify(userErrors));
  console.log(`✅ Published: "${publishable.title}"`);
}

// ─── Update Supabase row with new Shopify product ID ─────────────────────────
async function updateSupabaseProductId(shopifyProductId) {
  const { error } = await supabase
    .from('products')
    .update({ shopify_product_id: shopifyProductId })
    .eq('id', supabaseId);
  if (error) throw new Error('Supabase update failed: ' + error.message);
  console.log(`✅ Supabase row updated with new shopify_product_id`);
}

// ─── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  console.log(`\n🔍 Loading config for Supabase product: ${supabaseId}`);
  const row   = await loadConfig();
  const config = row.config;

  console.log(`   Name:    ${row.name}`);
  console.log(`   Shopify: ${row.shopify_product_id || '(none)'}`);
  console.log(`   Recreate: ${recreate}`);

  const token = await getAccessToken();
  console.log('✅ Shopify token obtained');

  if (recreate && row.shopify_product_id) {
    await deleteExistingProduct(token, row.shopify_product_id);
  }

  const productId = await createProduct(token, config);
  const options   = await createOptions(token, productId, config);
  await createVariants(token, productId, options, config);
  await disableInventoryTracking(token, productId);
  await setPersonalizationMetafield(token, productId, config);
  await publishProduct(token, productId, config);
  await updateSupabaseProductId(productId);

  const numericId = productId.split('/').pop();
  console.log('\n🎉 Done!');
  console.log(`   Supabase ID : ${supabaseId}`);
  console.log(`   Product GID : ${productId}`);
  console.log(`   Admin URL   : https://${process.env.SHOPIFY_SHOP}/admin/products/${numericId}`);
}

main().catch(err => {
  console.error('\n❌', err.message);
  process.exit(1);
});
