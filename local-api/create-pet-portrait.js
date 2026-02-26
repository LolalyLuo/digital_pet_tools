/**
 * One-time script: Create "Custom One Pet Portrait" product in Shopify as DRAFT
 * Run with: node local-api/create-pet-portrait.js
 */
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
dotenv.config({ path: join(__dirname, '.env') });           // local-api/.env
dotenv.config({ path: join(__dirname, '..', '.env.local') }); // root .env.local
dotenv.config({ path: join(__dirname, '..', '.env') });       // root .env

const SHOPIFY_SHOP = process.env.SHOPIFY_SHOP;
const SHOPIFY_CLIENT_ID = process.env.SHOPIFY_CLIENT_ID;
const SHOPIFY_CLIENT_SECRET = process.env.SHOPIFY_CLIENT_SECRET;
const SHOPIFY_API_VERSION = '2025-01';

async function getAccessToken() {
  const res = await fetch(`https://${SHOPIFY_SHOP}/admin/oauth/access_token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: SHOPIFY_CLIENT_ID,
      client_secret: SHOPIFY_CLIENT_SECRET,
      grant_type: 'client_credentials',
    }),
  });
  if (!res.ok) throw new Error(`Token failed (${res.status}): ${await res.text()}`);
  return (await res.json()).access_token;
}

async function shopifyGraphQL(token, query, variables = {}) {
  const res = await fetch(
    `https://${SHOPIFY_SHOP}/admin/api/${SHOPIFY_API_VERSION}/graphql.json`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': token },
      body: JSON.stringify({ query, variables }),
    }
  );
  if (!res.ok) throw new Error(`GraphQL failed (${res.status}): ${await res.text()}`);
  return res.json();
}

// ============================================================
// PRODUCT DATA
// ============================================================

const DESCRIPTION_HTML = `
<p>Give your pet the portrait they deserve. At InstaMe, every piece is crafted by a real artist — someone who takes the time to study your photo and bring out what makes your pet truly one of a kind.</p>

<ul>
  <li>Handcrafted by a real artist</li>
  <li>Artwork preview ready in 1–2 days</li>
  <li>Free revisions, no limits</li>
  <li>Designed to complement any home décor</li>
  <li>Ready to hang — hardware included</li>
</ul>

<p>We don't send anything to print until you're completely in love with the result. Every order includes a free preview and as many rounds of edits as it takes. We don't stop until you get that jaw-drop moment.</p>

<p>Follow your portrait's journey from first sketch to finished print. We keep you updated every step of the way — watching your pet transform into a work of art is half the fun.</p>

<p>We work fast. Most customers receive their artwork preview within 1–2 business days of placing their order. Your pet's portrait is closer than you think.</p>

<p>Printed on museum-grade enhanced matte paper, every portrait delivers crisp detail, rich color, and a gallery-quality finish that looks stunning on any wall.</p>

<p>Our frames are made from sustainably sourced hardwood and arrive with hangers already attached — just pick your spot and hang it up.</p>

<p>At InstaMe, every portrait is a labor of love. Order yours today and give your pet the tribute they deserve.</p>
`.trim();

const BACKGROUNDS = ['Soft White', 'Dusty Pink', 'Charcoal Gray', 'Rainbow', 'Floral'];
const SIZES = ['8"x10"', '12"x16"', '18"x24"'];
const FRAMES = ['Black', 'White', 'Walnut', 'Poster-Only'];

// All framed options same price; Poster-Only is cheaper
const PRICE_MAP = {
  '8"x10"':  { framed: ['77.00',  '105.00'], poster: ['46.00', '66.00']  },
  '12"x16"': { framed: ['99.00',  '132.00'], poster: ['57.00', '77.00']  },
  '18"x24"': { framed: ['154.00', '209.00'], poster: ['68.00', '88.00']  },
};

// Ordered list of metaobject GIDs from the "Personalization Fields" metaobject definition.
// These are pre-created entries in Shopify admin (type: personalization_fields).
// Query existing ones with: node local-api/inspect-metafields.js
// To add new fields (e.g. for a 2-pet product), create new metaobjects in Shopify first,
// then add their GIDs here in the correct display order.
const PERSONALIZATION_METAOBJECT_IDS = [
  'gid://shopify/Metaobject/181824421993', // Upload Pet Photo 1
  'gid://shopify/Metaobject/181824454761', // Pet Name 1
];

// Publish to these sales channels after creation
const PUBLISH_TO = [
  'gid://shopify/Publication/151855169641', // Online Store
  'gid://shopify/Publication/151855267945', // Shop
];

// Build all 60 variants (5 backgrounds × 3 sizes × 4 frames)
const variants = [];
for (const bg of BACKGROUNDS) {
  for (const size of SIZES) {
    for (const frame of FRAMES) {
      const [price, compareAt] = frame === 'Poster-Only'
        ? PRICE_MAP[size].poster
        : PRICE_MAP[size].framed;
      variants.push({
        optionValues: [
          { optionName: 'Background Color', name: bg },
          { optionName: 'Size', name: size },
          { optionName: 'Frame Option', name: frame },
        ],
        price,
        compareAtPrice: compareAt,
        inventoryPolicy: 'CONTINUE',
        inventoryItem: { tracked: false },
      });
    }
  }
}

// ============================================================
// MAIN
// ============================================================

async function main() {
  console.log('🔑 Getting Shopify access token...');
  const token = await getAccessToken();
  console.log('✅ Token obtained');

  // Step 1: Create product with options
  console.log('\n📦 Creating product...');
  const createResult = await shopifyGraphQL(token, `
    mutation productCreate($product: ProductCreateInput!) {
      productCreate(product: $product) {
        product {
          id
          title
          status
        }
        userErrors { field message }
      }
    }
  `, {
    product: {
      title: 'Custom One Pet Portrait',
      descriptionHtml: DESCRIPTION_HTML,
      vendor: 'InstaMe',
      status: 'DRAFT',
      productOptions: [
        { name: 'Background Color', values: BACKGROUNDS.map(n => ({ name: n })) },
        { name: 'Size',             values: SIZES.map(n => ({ name: n })) },
        { name: 'Frame Option',     values: FRAMES.map(n => ({ name: n })) },
      ],
    },
  });

  const createErrors = createResult.data?.productCreate?.userErrors;
  if (createErrors?.length) throw new Error('productCreate: ' + JSON.stringify(createErrors));

  const productId = createResult.data.productCreate.product.id;
  console.log(`✅ Product created: ${productId}`);

  // Step 2: Bulk create all 60 variants
  // REMOVE_STANDALONE_VARIANT removes the default placeholder variant Shopify auto-creates
  console.log(`\n🔢 Creating ${variants.length} variants...`);
  const variantResult = await shopifyGraphQL(token, `
    mutation productVariantsBulkCreate(
      $productId: ID!
      $variants: [ProductVariantsBulkInput!]!
      $strategy: ProductVariantsBulkCreateStrategy
    ) {
      productVariantsBulkCreate(productId: $productId, variants: $variants, strategy: $strategy) {
        productVariants { id title price compareAtPrice }
        userErrors { field message }
      }
    }
  `, {
    productId,
    variants,
    strategy: 'REMOVE_STANDALONE_VARIANT',
  });

  const variantErrors = variantResult.data?.productVariantsBulkCreate?.userErrors;
  if (variantErrors?.length) throw new Error('variantsBulkCreate: ' + JSON.stringify(variantErrors));

  const createdVariants = variantResult.data.productVariantsBulkCreate.productVariants;
  console.log(`✅ ${createdVariants.length} variants created`);

  // Step 3: Set custom.personalization_options — ordered list of metaobject references
  console.log('\n🏷️  Setting personalization_options metafield...');
  const metafieldResult = await shopifyGraphQL(token, `
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
        key: 'personalization_options',
        type: 'list.metaobject_reference',
        value: JSON.stringify(PERSONALIZATION_METAOBJECT_IDS),
      }],
    },
  });

  const metafieldErrors = metafieldResult.data?.productUpdate?.userErrors;
  if (metafieldErrors?.length) throw new Error('metafield: ' + JSON.stringify(metafieldErrors));
  console.log('✅ personalization_options set');

  // Step 4: Publish to Online Store + Shop
  console.log('\n📢 Publishing to Online Store + Shop...');
  const publishResult = await shopifyGraphQL(token, `
    mutation publishablePublish($id: ID!, $input: [PublicationInput!]!) {
      publishablePublish(id: $id, input: $input) {
        publishable { ... on Product { id title } }
        userErrors { field message }
      }
    }
  `, {
    id: productId,
    input: PUBLISH_TO.map(publicationId => ({ publicationId })),
  });

  const publishErrors = publishResult.data?.publishablePublish?.userErrors;
  if (publishErrors?.length) throw new Error('publish: ' + JSON.stringify(publishErrors));
  console.log('✅ Published to Online Store + Shop');

  // Done — report GID and admin URL
  const numericId = productId.split('/').pop();
  console.log('\n🎉 DONE');
  console.log(`Product GID:  ${productId}`);
  console.log(`Admin URL:    https://${SHOPIFY_SHOP}/admin/products/${numericId}`);
}

main().catch(err => {
  console.error('\n❌', err.message);
  process.exit(1);
});
