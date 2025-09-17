import express from "express";
import { getSupabase } from "../config/database.js";

const router = express.Router();

// Get saved evaluation prompts
router.get("/evaluation-prompts", async (req, res) => {
  try {
    const { data, error } = await getSupabase()
      .from("evaluation_prompts")
      .select("*")
      .order("created_at", { ascending: true });

    if (error) {
      console.error("❌ Error loading evaluation prompts:", error);
      return res.json({
        success: true,
        prompts: [], // Return empty array if table doesn't exist yet
      });
    }

    res.json({
      success: true,
      prompts: data || [],
    });
  } catch (err) {
    console.error("❌ Error fetching evaluation prompts:", err);
    res.json({
      success: true,
      prompts: [], // Fallback to empty array
    });
  }
});

// Save evaluation prompt
router.post("/evaluation-prompts", async (req, res) => {
  try {
    const { name, prompt, weights } = req.body;

    if (!name || !prompt) {
      return res.status(400).json({
        error: "Missing required parameters: name and prompt",
      });
    }

    const { data, error } = await getSupabase()
      .from("evaluation_prompts")
      .insert([
        {
          name: name.trim(),
          prompt: prompt.trim(),
          weights: weights || null,
          created_at: new Date().toISOString(),
        },
      ])
      .select()
      .single();

    if (error) {
      console.error("❌ Error saving evaluation prompt:", error);
      return res.status(500).json({
        success: false,
        error: error.message,
      });
    }

    console.log(`💾 Saved evaluation prompt: "${name}"`);
    res.json({
      success: true,
      prompt: data,
    });
  } catch (error) {
    console.error("❌ Error saving prompt:", error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

// Delete evaluation prompt
router.delete("/evaluation-prompts/:id", async (req, res) => {
  try {
    const { id } = req.params;

    if (!id) {
      return res.status(400).json({
        error: "Missing prompt ID",
      });
    }

    const { error } = await getSupabase()
      .from("evaluation_prompts")
      .delete()
      .eq("id", id);

    if (error) {
      console.error("❌ Error deleting evaluation prompt:", error);
      return res.status(500).json({
        success: false,
        error: error.message,
      });
    }

    console.log(`🗑️ Deleted evaluation prompt ID: ${id}`);
    res.json({
      success: true,
    });
  } catch (error) {
    console.error("❌ Error deleting prompt:", error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

export default router;