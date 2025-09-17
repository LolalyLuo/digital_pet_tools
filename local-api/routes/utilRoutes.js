import express from "express";
import { Storage } from "@google-cloud/storage";

const router = express.Router();

// Initialize Google Cloud Storage client
const projectId = process.env.GOOGLE_CLOUD_PROJECT_ID;
const storageClient = new Storage({
  projectId: projectId,
});

// Image proxy endpoint to serve GCS images
router.get("/image-proxy", async (req, res) => {
  try {
    const { url } = req.query;
    if (!url) {
      return res.status(400).json({ error: "URL parameter required" });
    }

    // Parse GCS URL to extract bucket and file path
    const gcsMatch = url.match(/gs:\/\/([^\/]+)\/(.+)/);
    if (!gcsMatch) {
      return res.status(400).json({ error: "Invalid GCS URL format" });
    }

    const bucketName = gcsMatch[1];
    const filePath = gcsMatch[2];

    console.log(`🖼️ Proxying image: ${bucketName}/${filePath}`);

    // Download image from GCS
    const bucket = storageClient.bucket(bucketName);
    const file = bucket.file(filePath);

    const [exists] = await file.exists();
    if (!exists) {
      return res.status(404).json({ error: "Image not found" });
    }

    // Get file metadata to set proper content type
    const [metadata] = await file.getMetadata();
    const contentType = metadata.contentType || "image/jpeg";

    // Set appropriate headers
    res.set({
      "Content-Type": contentType,
      "Cache-Control": "public, max-age=86400", // Cache for 1 day
    });

    // Stream the file to the response
    const stream = file.createReadStream();
    stream.pipe(res);

    stream.on("error", (error) => {
      console.error("Error streaming image:", error);
      if (!res.headersSent) {
        res.status(500).json({ error: "Failed to stream image" });
      }
    });
  } catch (error) {
    console.error("Image proxy error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Health check endpoint
router.get("/health", (req, res) => {
  res.json({ status: "OK", timestamp: new Date().toISOString() });
});

export default router;