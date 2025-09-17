import express from "express";
import { getProdSupabase } from "../config/database.js";

const router = express.Router();

// Get customers with single uploaded images
router.get("/customers", async (req, res) => {
  try {
    console.log("🔍 Scanning production storage for single-image customers...");

    // List all customer folders in product-images bucket
    const { data: customerFolders, error: listError } =
      await getProdSupabase().storage
        .from("product-images")
        .list("", { limit: 1000 });

    if (listError) {
      console.error("❌ Error listing customer folders:", listError);
      return res.status(500).json({ error: "Failed to list customer folders" });
    }

    const singleImageCustomers = [];

    // Check each customer folder for uploaded images
    for (const folder of customerFolders) {
      if (!folder.name || folder.name === ".emptyFolderPlaceholder") continue;

      try {
        // Check if uploaded folder exists and count images
        const { data: uploadedFiles, error: uploadError } =
          await getProdSupabase().storage
            .from("product-images")
            .list(`${folder.name}/uploaded`, { limit: 10 });

        if (!uploadError && uploadedFiles) {
          // Filter out folder placeholders and count actual image files
          const imageFiles = uploadedFiles.filter(
            (file) =>
              file.name &&
              !file.name.includes(".emptyFolderPlaceholder") &&
              /\.(jpg|jpeg|png|webp)$/i.test(file.name)
          );

          if (imageFiles.length === 1) {
            singleImageCustomers.push({
              customerId: folder.name,
              uploadedImage: imageFiles[0].name,
              uploadedAt: imageFiles[0].created_at,
            });
          }
        }
      } catch (error) {
        console.log(`⚠️  Skipping customer ${folder.name}: ${error.message}`);
      }
    }

    console.log(
      `✅ Found ${singleImageCustomers.length} customers with single uploaded images`
    );

    res.json({
      success: true,
      customers: singleImageCustomers,
      totalCount: singleImageCustomers.length,
    });
  } catch (error) {
    console.error("❌ Error scanning customers:", error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

// Get available product types
router.get("/products", async (req, res) => {
  try {
    console.log("🔍 Scanning for available product types...");

    // Get a sample customer to see what product folders exist
    const { data: customerFolders, error: listError } =
      await getProdSupabase().storage.from("product-images").list("", { limit: 10 });

    if (listError) {
      return res.status(500).json({ error: "Failed to list customer folders" });
    }

    const productTypes = new Set();

    // Check first few customers to find available product types
    for (const folder of customerFolders.slice(0, 5)) {
      if (!folder.name || folder.name === ".emptyFolderPlaceholder") continue;

      try {
        const { data: subFolders, error } = await getProdSupabase().storage
          .from("product-images")
          .list(folder.name, { limit: 20 });

        if (!error && subFolders) {
          subFolders.forEach((subFolder) => {
            if (
              subFolder.name &&
              subFolder.name !== "uploaded" &&
              !subFolder.name.includes(".emptyFolderPlaceholder")
            ) {
              productTypes.add(subFolder.name);
            }
          });
        }
      } catch (error) {
        console.log(`⚠️  Error checking ${folder.name}:`, error.message);
      }
    }

    const products = Array.from(productTypes).sort();
    console.log(`✅ Found product types:`, products);

    res.json({
      success: true,
      products: products,
    });
  } catch (error) {
    console.error("❌ Error scanning products:", error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

// Validate customer data for import - check if both uploaded and generated images exist
router.post("/validate-customer", async (req, res) => {
  try {
    const { customerId, uploadedImage, productType } = req.body;

    if (!customerId || !uploadedImage || !productType) {
      return res.status(400).json({
        success: false,
        reason: "Missing required parameters",
      });
    }

    console.log(
      `🔍 Validating customer ${customerId} for product ${productType}`
    );

    // Check uploaded folder - should have exactly 1 image
    const { data: uploadedFiles, error: uploadedError } =
      await getProdSupabase().storage
        .from("product-images")
        .list(`${customerId}/uploaded`);

    if (uploadedError) {
      console.log(
        `❌ Error checking uploaded folder for ${customerId}:`,
        uploadedError
      );
      return res.json({
        success: false,
        reason: `Uploaded folder error: ${uploadedError.message}`,
      });
    }

    // Filter to actual image files
    const uploadedImageFiles =
      uploadedFiles &&
      uploadedFiles.filter(
        (file) =>
          file.name &&
          !file.name.includes(".emptyFolderPlaceholder") &&
          /\.(jpg|jpeg|png|webp)$/i.test(file.name)
      );

    if (!uploadedImageFiles || uploadedImageFiles.length === 0) {
      console.log(`❌ No uploaded images found for customer ${customerId}`);
      return res.json({
        success: false,
        reason: "No uploaded images found",
      });
    }

    if (uploadedImageFiles.length > 1) {
      console.log(
        `❌ Customer ${customerId} has ${uploadedImageFiles.length} uploaded images, should have exactly 1`
      );
      return res.json({
        success: false,
        reason: `Customer has ${uploadedImageFiles.length} uploaded images, expected 1`,
      });
    }

    // Use the single uploaded image
    const actualUploadedImage = uploadedImageFiles[0].name;
    console.log(
      `📋 Customer ${customerId} has uploaded image: ${actualUploadedImage}`
    );

    // Check if generated image exists by listing the product folder
    const { data: generatedFiles, error: generatedError } =
      await getProdSupabase().storage
        .from("product-images")
        .list(`${customerId}/${productType}`);

    if (generatedError) {
      console.log(
        `❌ Error checking generated folder for ${customerId}/${productType}:`,
        generatedError
      );
      return res.json({
        success: false,
        reason: `Generated folder error: ${generatedError.message}`,
      });
    }

    // Check if there's at least one generated image (any filename is fine)
    const imageFiles =
      generatedFiles &&
      generatedFiles.filter(
        (file) =>
          file.name &&
          !file.name.includes(".emptyFolderPlaceholder") &&
          /\.(jpg|jpeg|png|webp)$/i.test(file.name)
      );

    if (!imageFiles || imageFiles.length === 0) {
      console.log(
        `❌ No generated images found in ${customerId}/${productType}`
      );
      console.log(
        `📝 Available files in ${customerId}/${productType}:`,
        generatedFiles?.map((f) => f.name) || []
      );
      return res.json({
        success: false,
        reason: `No generated images found in ${productType} folder`,
      });
    }

    // Use the first available generated image
    const generatedImageName = imageFiles[0].name;
    console.log(
      `✅ Found uploaded image: ${actualUploadedImage} and generated image: ${generatedImageName} for customer ${customerId}`
    );

    // If both exist, generate the public URLs
    const uploadedPath = `${customerId}/uploaded/${actualUploadedImage}`;
    const generatedPath = `${customerId}/${productType}/${generatedImageName}`;

    const { data: uploadedUrl } = getProdSupabase().storage
      .from("product-images")
      .getPublicUrl(uploadedPath);

    const { data: generatedUrl } = getProdSupabase().storage
      .from("product-images")
      .getPublicUrl(generatedPath);

    res.json({
      success: true,
      uploadedImageUrl: uploadedUrl.publicUrl,
      generatedImageUrl: generatedUrl.publicUrl,
      customerId,
      productType,
    });
  } catch (error) {
    console.error("❌ Error validating customer:", error);
    res.status(500).json({
      success: false,
      reason: error.message,
    });
  }
});

export default router;