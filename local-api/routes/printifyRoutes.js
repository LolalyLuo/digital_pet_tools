import express from "express";

const router = express.Router();

const PRINTIFY_API = "https://api.printify.com/v1";
const getShopId = () => process.env.INSTAME_SHOP_PRINTIFY_SHOP_ID;
const getApiKey = () => process.env.PRINTIFY_API_KEY;

async function printifyFetch(path, options = {}) {
  const res = await fetch(`${PRINTIFY_API}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${getApiKey()}`,
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Printify ${options.method || "GET"} ${path} failed (${res.status}): ${text}`);
  }
  return res.json();
}

// Replace the image ID inside Printify print_areas, keeping all other structure intact
function replacePrintAreaImage(printAreas, newImageId) {
  return printAreas.map((area) => ({
    ...area,
    placeholders: area.placeholders.map((ph) => ({
      ...ph,
      images: ph.images.map((img) => ({
        ...img,
        id: newImageId,
      })),
    })),
  }));
}

// GET /api/printify/product/:id
// Returns the template fields needed to create a new product: blueprint_id, print_provider_id, variants, print_areas, title
router.get("/product/:id", async (req, res) => {
  try {
    const product = await printifyFetch(
      `/shops/${getShopId()}/products/${req.params.id}.json`
    );
    res.json({
      id: product.id,
      title: product.title,
      blueprint_id: product.blueprint_id,
      print_provider_id: product.print_provider_id,
      variants: product.variants
        .filter((v) => v.is_enabled)
        .map((v) => ({ id: v.id, price: v.price, title: v.title })),
      print_areas: product.print_areas,
      images: product.images, // mockup images of the seed product
    });
  } catch (err) {
    console.error("❌ Printify product fetch:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/printify/upload-image
// Body: { fileName: "image.png", imageBase64: "<base64 string>" }
// Returns: { id: "<printify image id>" }
router.post("/upload-image", async (req, res) => {
  try {
    const { fileName, imageBase64 } = req.body;
    if (!fileName || !imageBase64) {
      return res.status(400).json({ error: "fileName and imageBase64 required" });
    }
    const data = await printifyFetch("/uploads/images.json", {
      method: "POST",
      body: JSON.stringify({ file_name: fileName, contents: imageBase64 }),
    });
    res.json({ id: data.id });
  } catch (err) {
    console.error("❌ Printify upload-image:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/printify/create-product
// Body: { template: { blueprint_id, print_provider_id, variants, print_areas, title }, uploadedImageId, customTitle }
// Returns: { product } — full product object including images array with mockup URLs
router.post("/create-product", async (req, res) => {
  try {
    const { template, uploadedImageId, customTitle } = req.body;
    if (!template || !uploadedImageId || !customTitle) {
      return res.status(400).json({ error: "template, uploadedImageId, customTitle required" });
    }

    const productData = {
      title: customTitle,
      description: template.description || customTitle,
      blueprint_id: template.blueprint_id,
      print_provider_id: template.print_provider_id,
      variants: template.variants.map((v) => ({
        id: v.id,
        price: v.price,
        is_enabled: true,
      })),
      print_areas: replacePrintAreaImage(template.print_areas, uploadedImageId),
    };

    const created = await printifyFetch(
      `/shops/${getShopId()}/products.json`,
      { method: "POST", body: JSON.stringify(productData) }
    );

    // Fetch full product details (includes mockup images)
    const full = await printifyFetch(
      `/shops/${getShopId()}/products/${created.id}.json`
    );

    res.json({ product: full });
  } catch (err) {
    console.error("❌ Printify create-product:", err.message);
    res.status(500).json({ error: err.message });
  }
});

export default router;
