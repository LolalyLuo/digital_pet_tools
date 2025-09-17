import express from "express";
import { getOpenAI } from "../config/ai.js";

const router = express.Router();

// Generate Prompt Variations endpoint
router.post("/generate-prompt-variations", async (req, res) => {
  try {
    const { basePrompts, variationStrength = 0.3, count = 10 } = req.body;

    if (!basePrompts || basePrompts.length === 0) {
      return res
        .status(400)
        .json({ error: "Missing required parameter: basePrompts" });
    }

    if (!process.env.OPENAI_API_KEY) {
      return res.status(500).json({ error: "OpenAI API key not configured" });
    }

    const response = await getOpenAI().chat.completions.create({
      model: "gpt-4o",
      messages: [
        {
          role: "user",
          content: `Generate ${count} creative variations of these pet photography prompts:\n\n${basePrompts.join(
            "\n"
          )}\n\nVariation strength: ${variationStrength} (0=minimal changes, 1=major changes)\n\nReturn ONLY a JSON array of strings, no other text.`,
        },
      ],
      max_tokens: 500,
      temperature: 0.8,
    });

    const content = response.choices[0]?.message?.content;
    if (!content) {
      throw new Error("No response from OpenAI");
    }

    try {
      const variations = JSON.parse(content);
      res.json({ variations });
    } catch (parseError) {
      // Fallback to base prompts with simple modifications
      const fallbackVariations = basePrompts
        .flatMap((prompt) => [
          `${prompt} with enhanced lighting`,
          `${prompt} in artistic style`,
          `${prompt} with vibrant colors`,
        ])
        .slice(0, count);
      res.json({ variations: fallbackVariations });
    }
  } catch (error) {
    console.error("Prompt variation generation error:", error);
    res.status(500).json({ error: error.message });
  }
});

// Generate Evolutionary Prompts endpoint
router.post("/generate-evolutionary-prompts", async (req, res) => {
  try {
    const {
      parentPrompts,
      keepTopPercent = 0.2,
      mutationRate = 0.1,
      count = 10,
    } = req.body;

    if (!parentPrompts || parentPrompts.length === 0) {
      return res
        .status(400)
        .json({ error: "Missing required parameter: parentPrompts" });
    }

    if (!process.env.OPENAI_API_KEY) {
      return res.status(500).json({ error: "OpenAI API key not configured" });
    }

    const response = await getOpenAI().chat.completions.create({
      model: "gpt-4o",
      messages: [
        {
          role: "user",
          content: `Using evolutionary algorithm principles, evolve these successful pet photography prompts:\n\n${parentPrompts.join(
            "\n"
          )}\n\nGenerate ${count} evolved prompts that:\n- Keep the best elements from parent prompts\n- Introduce mutations (mutation rate: ${mutationRate})\n- Create diverse offspring\n\nReturn ONLY a JSON array of strings, no other text.`,
        },
      ],
      max_tokens: 600,
      temperature: 0.9,
    });

    const content = response.choices[0]?.message?.content;
    if (!content) {
      throw new Error("No response from OpenAI");
    }

    try {
      const prompts = JSON.parse(content);
      res.json({ prompts });
    } catch (parseError) {
      // Fallback to combining parent prompts
      const fallbackPrompts = [];
      for (let i = 0; i < count; i++) {
        const prompt1 =
          parentPrompts[Math.floor(Math.random() * parentPrompts.length)];
        const prompt2 =
          parentPrompts[Math.floor(Math.random() * parentPrompts.length)];
        fallbackPrompts.push(
          `${prompt1} evolved with elements from ${prompt2}`
        );
      }
      res.json({ prompts: fallbackPrompts });
    }
  } catch (error) {
    console.error("Evolutionary prompt generation error:", error);
    res.status(500).json({ error: error.message });
  }
});

// Generate Random Prompts endpoint
router.post("/generate-random-prompts", async (req, res) => {
  try {
    const { count = 10, category = "pet_photography" } = req.body;

    if (!process.env.OPENAI_API_KEY) {
      return res.status(500).json({ error: "OpenAI API key not configured" });
    }

    const response = await getOpenAI().chat.completions.create({
      model: "gpt-4o",
      messages: [
        {
          role: "user",
          content: `Generate ${count} creative and diverse pet photography prompts for AI image generation. Focus on different styles, moods, settings, and artistic approaches. Make them specific and inspiring.\n\nReturn ONLY a JSON array of strings, no other text.`,
        },
      ],
      max_tokens: 400,
      temperature: 1.0,
    });

    const content = response.choices[0]?.message?.content;
    if (!content) {
      throw new Error("No response from OpenAI");
    }

    try {
      const prompts = JSON.parse(content);
      res.json({ prompts });
    } catch (parseError) {
      // Fallback to predefined prompts
      const fallbackPrompts = [
        "Adorable pet in golden hour lighting with soft bokeh background",
        "Professional studio portrait of pet with dramatic lighting",
        "Playful pet in natural outdoor setting with vibrant colors",
        "Elegant pet portrait in black and white photography style",
        "Cute pet in cozy home environment with warm lighting",
        "Artistic pet photo with creative composition and unique angle",
        "Pet in beautiful garden setting with flowers and natural light",
        "Candid moment of happy pet with joyful expression",
      ];
      res.json({ prompts: fallbackPrompts.slice(0, count) });
    }
  } catch (error) {
    console.error("Random prompt generation error:", error);
    res.status(500).json({ error: error.message });
  }
});

// Generate Chain Prompts endpoint
router.post("/generate-chain-prompts", async (req, res) => {
  try {
    const { basePrompts, iteration, config } = req.body;

    if (!basePrompts || basePrompts.length === 0) {
      return res
        .status(400)
        .json({ error: "Missing required parameter: basePrompts" });
    }

    if (!process.env.OPENAI_API_KEY) {
      return res.status(500).json({ error: "OpenAI API key not configured" });
    }

    const response = await getOpenAI().chat.completions.create({
      model: "gpt-4o",
      messages: [
        {
          role: "user",
          content: `This is iteration ${iteration} of an iterative improvement process. Build upon these successful prompts from previous iterations:\n\n${basePrompts.join(
            "\n"
          )}\n\nGenerate improved prompts that:\n- Enhance the successful elements\n- Add refinements based on iteration progress\n- Maintain the core appeal while improving quality\n\nReturn ONLY a JSON array of strings, no other text.`,
        },
      ],
      max_tokens: 500,
      temperature: 0.7,
    });

    const content = response.choices[0]?.message?.content;
    if (!content) {
      throw new Error("No response from OpenAI");
    }

    try {
      const prompts = JSON.parse(content);
      res.json({ prompts });
    } catch (parseError) {
      // Fallback to enhanced versions of base prompts
      const enhancements = [
        "refined",
        "enhanced",
        "improved",
        "polished",
        "optimized",
      ];
      const enhancedPrompts = basePrompts.map((prompt) => {
        const enhancement =
          enhancements[Math.floor(Math.random() * enhancements.length)];
        return `${prompt} (${enhancement} for iteration ${iteration})`;
      });
      res.json({ prompts: enhancedPrompts });
    }
  } catch (error) {
    console.error("Chain prompt generation error:", error);
    res.status(500).json({ error: error.message });
  }
});

export default router;