import express from "express";
import multer from "multer";
import { getSupabase } from "../config/database.js";

const router = express.Router();

// Sample sets - will be moved to database later if needed
let sampleSets = [];
let nextSampleSetId = 1;

// Multer configuration for file uploads
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 50 * 1024 * 1024, // 50MB limit
  },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith("image/")) {
      cb(null, true);
    } else {
      cb(new Error("Only image files are allowed"), false);
    }
  },
});

// Get saved sample sets
router.get("/sample-sets", (req, res) => {
  res.json({
    success: true,
    sampleSets: sampleSets,
  });
});

// Get current working set from database
router.get("/current-samples", async (req, res) => {
  try {
    const { data: samples, error } = await getSupabase()
      .from("current_working_samples")
      .select("*")
      .order("created_at", { ascending: true });

    if (error) {
      console.error("❌ Error fetching current samples:", error);
      return res.status(500).json({
        success: false,
        error: "Failed to fetch current samples",
      });
    }

    // Transform database format to frontend format
    const formattedSamples = samples.map((sample) => ({
      id: sample.id,
      generated: {
        url: sample.generated_image_url,
      },
      reference: {
        url: sample.reference_image_url,
      },
    }));

    res.json({
      success: true,
      samples: formattedSamples,
    });
  } catch (error) {
    console.error("❌ Error in current-samples endpoint:", error);
    res.status(500).json({
      success: false,
      error: "Failed to fetch current samples",
    });
  }
});

// Upload sample images to Supabase and add to current working set
router.post(
  "/current-samples/add",
  upload.fields([
    { name: "generated", maxCount: 1 },
    { name: "reference", maxCount: 1 },
  ]),
  async (req, res) => {
    try {
      console.log("📤 Upload request received");
      console.log("Files:", req.files);
      console.log("Body:", req.body);

      if (!req.files || !req.files.generated || !req.files.reference) {
        console.log("❌ Missing files in request");
        return res.status(400).json({
          error: "Missing required files: generated and reference images",
          received: req.files ? Object.keys(req.files) : "no files",
        });
      }

      const generatedFile = req.files.generated[0];
      const referenceFile = req.files.reference[0];

      // Upload generated image to Supabase
      const generatedFileName = `evaluation_samples/generated_${Date.now()}_${Math.random()
        .toString(36)
        .substr(2, 9)}.${generatedFile.originalname.split(".").pop()}`;
      const { data: generatedUpload, error: generatedError } =
        await getSupabase().storage
          .from("generated-images")
          .upload(generatedFileName, generatedFile.buffer, {
            contentType: generatedFile.mimetype,
            cacheControl: "3600",
          });

      if (generatedError) {
        console.error("❌ Error uploading generated image:", generatedError);
        return res
          .status(500)
          .json({ error: "Failed to upload generated image" });
      }

      // Upload reference image to Supabase
      const referenceFileName = `evaluation_samples/reference_${Date.now()}_${Math.random()
        .toString(36)
        .substr(2, 9)}.${referenceFile.originalname.split(".").pop()}`;
      const { data: referenceUpload, error: referenceError } =
        await getSupabase().storage
          .from("generated-images")
          .upload(referenceFileName, referenceFile.buffer, {
            contentType: referenceFile.mimetype,
            cacheControl: "3600",
          });

      if (referenceError) {
        console.error("❌ Error uploading reference image:", referenceError);
        return res
          .status(500)
          .json({ error: "Failed to upload reference image" });
      }

      // Create public URLs
      const generatedUrl = `${process.env.SUPABASE_URL}/storage/v1/object/public/generated-images/${generatedUpload.path}`;
      const referenceUrl = `${process.env.SUPABASE_URL}/storage/v1/object/public/generated-images/${referenceUpload.path}`;

      // Add sample to database
      const { data: newSample, error: insertError } = await getSupabase()
        .from("current_working_samples")
        .insert({
          generated_image_url: generatedUrl,
          reference_image_url: referenceUrl,
        })
        .select()
        .single();

      if (insertError) {
        console.error("❌ Error saving sample to database:", insertError);
        return res
          .status(500)
          .json({ error: "Failed to save sample to database" });
      }

      // Get current count for response
      const { count } = await getSupabase()
        .from("current_working_samples")
        .select("*", { count: "exact", head: true });

      console.log(`📝 Uploaded and added sample to database (${count} total)`);
      res.json({
        success: true,
        sample: newSample,
        generatedUrl: generatedUrl,
        referenceUrl: referenceUrl,
        totalSamples: count,
      });
    } catch (error) {
      console.error("❌ Error uploading sample images:", error);
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  }
);

// Clear current working set
router.delete("/current-samples", async (req, res) => {
  try {
    const { error } = await getSupabase()
      .from("current_working_samples")
      .delete()
      .neq("id", 0); // Delete all rows

    if (error) {
      console.error("❌ Error clearing current samples:", error);
      return res.status(500).json({
        success: false,
        error: "Failed to clear current samples",
      });
    }

    console.log("🗑️ Cleared current working set from database");
    res.json({
      success: true,
      message: "Working set cleared",
    });
  } catch (error) {
    console.error("❌ Error in clear samples endpoint:", error);
    res.status(500).json({
      success: false,
      error: "Failed to clear current samples",
    });
  }
});

// Save current working set as named sample set
router.post("/sample-sets", async (req, res) => {
  try {
    const { name } = req.body;

    if (!name || !name.trim()) {
      return res.status(400).json({
        error: "Missing required parameter: name",
      });
    }

    // Get current samples from database
    const { data: currentSamples, error: fetchError } = await getSupabase()
      .from("current_working_samples")
      .select("*")
      .order("created_at", { ascending: true });

    if (fetchError) {
      console.error("❌ Error fetching current samples:", fetchError);
      return res.status(500).json({
        success: false,
        error: "Failed to fetch current samples",
      });
    }

    if (!currentSamples || currentSamples.length === 0) {
      return res.status(400).json({
        error: "No samples in current working set to save",
      });
    }

    // Transform samples to the format used by sample sets
    const formattedSamples = currentSamples.map((sample) => ({
      id: sample.id,
      generated: {
        url: sample.generated_image_url,
      },
      reference: {
        url: sample.reference_image_url,
      },
    }));

    const newSampleSet = {
      id: nextSampleSetId++,
      name: name.trim(),
      samples: formattedSamples,
      createdAt: new Date().toISOString(),
    };

    sampleSets.push(newSampleSet);

    console.log(
      `💾 Saved sample set: "${name}" with ${currentSamples.length} samples`
    );
    res.json({
      success: true,
      sampleSet: newSampleSet,
    });
  } catch (error) {
    console.error("❌ Error saving sample set:", error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

// Load saved sample set to current working set
router.post("/sample-sets/:id/load", async (req, res) => {
  try {
    const sampleSetId = parseInt(req.params.id);
    const sampleSet = sampleSets.find((set) => set.id === sampleSetId);

    if (!sampleSet) {
      return res.status(404).json({
        error: "Sample set not found",
      });
    }

    // Clear current working set first
    const { error: clearError } = await getSupabase()
      .from("current_working_samples")
      .delete()
      .neq("id", 0); // Delete all rows

    if (clearError) {
      console.error("❌ Error clearing current samples:", clearError);
      return res.status(500).json({
        success: false,
        error: "Failed to clear current working set",
      });
    }

    // Insert samples from the saved set into current working set
    const samplesToInsert = sampleSet.samples.map((sample) => ({
      generated_image_url: sample.generated.url,
      reference_image_url: sample.reference.url,
    }));

    const { error: insertError } = await getSupabase()
      .from("current_working_samples")
      .insert(samplesToInsert);

    if (insertError) {
      console.error("❌ Error loading samples to working set:", insertError);
      return res.status(500).json({
        success: false,
        error: "Failed to load samples to working set",
      });
    }

    console.log(
      `📂 Loaded sample set "${sampleSet.name}" to working set (${sampleSet.samples.length} samples)`
    );
    res.json({
      success: true,
      message: `Loaded "${sampleSet.name}" to working set`,
      sampleCount: sampleSet.samples.length,
    });
  } catch (error) {
    console.error("❌ Error loading sample set:", error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

// Multer error handling middleware for this router
router.use((error, req, res, next) => {
  if (error instanceof multer.MulterError) {
    console.error("❌ Multer error:", error.message);
    return res.status(400).json({
      error: `File upload error: ${error.message}`,
      code: error.code,
    });
  }
  next(error);
});

export default router;