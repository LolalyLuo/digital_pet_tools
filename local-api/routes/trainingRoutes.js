import express from "express";
import { getSupabase, getProdSupabase } from "../config/database.js";

const router = express.Router();

// Generate training samples - batch download and process
router.post("/generate", async (req, res) => {
  try {
    const { productType, customers } = req.body;

    if (!productType || !customers || customers.length === 0) {
      return res.status(400).json({
        success: false,
        error: "Missing required parameters: productType and customers",
      });
    }

    console.log(
      `🚀 Starting training sample generation for ${customers.length} customers with product: ${productType}`
    );

    const results = [];
    const errors = [];

    // Process customers in batches
    for (let i = 0; i < customers.length; i++) {
      const customer = customers[i];

      try {
        console.log(
          `📥 Processing customer ${i + 1}/${customers.length}: ${
            customer.customerId
          }`
        );

        // Download uploaded image from production
        const uploadedPath = `${customer.customerId}/uploaded/${customer.uploadedImage}`;
        const { data: uploadedImageData, error: uploadedError } =
          await getProdSupabase().storage
            .from("product-images")
            .download(uploadedPath);

        if (uploadedError) {
          throw new Error(
            `Failed to download uploaded image: ${uploadedError.message}`
          );
        }

        // Find and download product image
        const { data: productFiles, error: productListError } =
          await getProdSupabase().storage
            .from("product-images")
            .list(`${customer.customerId}/${productType}`, { limit: 10 });

        if (productListError || !productFiles || productFiles.length === 0) {
          throw new Error(`No product images found for ${productType}`);
        }

        // Get the first product image (or you could add logic to select specific ones)
        const productImage = productFiles.find(
          (file) => file.name && /\.(jpg|jpeg|png|webp)$/i.test(file.name)
        );

        if (!productImage) {
          throw new Error(`No valid product image found for ${productType}`);
        }

        const productPath = `${customer.customerId}/${productType}/${productImage.name}`;
        const { data: productImageData, error: productError } =
          await getProdSupabase().storage
            .from("product-images")
            .download(productPath);

        if (productError) {
          throw new Error(
            `Failed to download product image: ${productError.message}`
          );
        }

        // Upload images to local Supabase storage
        const timestamp = Date.now();
        const uploadedFileName = `training_samples/uploaded_${
          customer.customerId
        }_${timestamp}.${customer.uploadedImage.split(".").pop()}`;
        const productFileName = `training_samples/generated_${
          customer.customerId
        }_${productType}_${timestamp}.${productImage.name.split(".").pop()}`;

        // Upload uploaded image
        const { data: uploadedUpload, error: uploadedUploadError } =
          await getSupabase().storage
            .from("generated-images")
            .upload(uploadedFileName, uploadedImageData, {
              contentType: `image/${customer.uploadedImage.split(".").pop()}`,
              cacheControl: "3600",
            });

        if (uploadedUploadError) {
          throw new Error(
            `Failed to upload uploaded image: ${uploadedUploadError.message}`
          );
        }

        // Upload product image
        const { data: productUpload, error: productUploadError } =
          await getSupabase().storage
            .from("generated-images")
            .upload(productFileName, productImageData, {
              contentType: `image/${productImage.name.split(".").pop()}`,
              cacheControl: "3600",
            });

        if (productUploadError) {
          throw new Error(
            `Failed to upload product image: ${productUploadError.message}`
          );
        }

        // Create public URLs
        const uploadedUrl = `${process.env.SUPABASE_URL}/storage/v1/object/public/generated-images/${uploadedUpload.path}`;
        const productUrl = `${process.env.SUPABASE_URL}/storage/v1/object/public/generated-images/${productUpload.path}`;

        // Save to training samples database
        const { data: trainingSample, error: dbError } = await getSupabase()
          .from("training_samples")
          .insert({
            customer_id: customer.customerId,
            product_type: productType,
            uploaded_image_url: uploadedUrl,
            generated_image_url: productUrl,
          })
          .select()
          .single();

        if (dbError) {
          throw new Error(`Failed to save training sample: ${dbError.message}`);
        }

        results.push({
          customerId: customer.customerId,
          success: true,
          trainingSampleId: trainingSample.id,
          uploadedUrl,
          productUrl,
        });

        console.log(
          `✅ Successfully processed customer ${customer.customerId}`
        );
      } catch (error) {
        console.error(
          `❌ Error processing customer ${customer.customerId}:`,
          error
        );
        errors.push({
          customerId: customer.customerId,
          error: error.message,
        });

        results.push({
          customerId: customer.customerId,
          success: false,
          error: error.message,
        });
      }

      // Add small delay to avoid overwhelming the API
      await new Promise((resolve) => setTimeout(resolve, 200));
    }

    console.log(
      `🎉 Training sample generation complete: ${
        results.filter((r) => r.success).length
      } successful, ${errors.length} failed`
    );

    res.json({
      success: true,
      results,
      summary: {
        total: customers.length,
        successful: results.filter((r) => r.success).length,
        failed: errors.length,
        productType,
      },
    });
  } catch (error) {
    console.error("❌ Training sample generation error:", error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

// Get training samples
router.get("/samples", async (req, res) => {
  try {
    const { data: samples, error } = await getSupabase()
      .from("training_samples")
      .select("*")
      .order("created_at", { ascending: false });

    if (error) {
      return res.status(500).json({
        success: false,
        error: "Failed to fetch training samples",
      });
    }

    res.json({
      success: true,
      samples: samples || [],
      count: samples?.length || 0,
    });
  } catch (error) {
    console.error("❌ Error fetching training samples:", error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

export default router;