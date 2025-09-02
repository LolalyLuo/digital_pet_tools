import { useState } from "react";
import { supabase } from "../utils/supabaseClient";

export const useImageGeneration = () => {
  const [isGeneratingPrompts, setIsGeneratingPrompts] = useState(false);
  const [isGeneratingImages, setIsGeneratingImages] = useState(false);
  const [error, setError] = useState(null);

  // Reset all states
  const resetStates = () => {
    setIsGeneratingPrompts(false);
    setIsGeneratingImages(false);
    setError(null);
  };

  const generatePrompts = async (initialPrompt, count) => {
    setIsGeneratingPrompts(true);
    setError(null);

    try {
      // Check if Supabase is properly configured
      if (!import.meta.env.VITE_SUPABASE_URL) {
        throw new Error(
          "Supabase not configured. Please set up your environment variables."
        );
      }

      // Validate count - allow any positive number, no upper limit
      const validatedCount = Math.max(1, Math.floor(count));
      console.log(
        `Generating ${validatedCount} prompts for: "${initialPrompt}"`
      );

      // Increase timeout for larger requests (more prompts = more time needed)
      const timeoutDuration = Math.max(30000, validatedCount * 500); // 500ms per prompt minimum

      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(
          () =>
            reject(
              new Error(`Request timeout after ${timeoutDuration / 1000}s`)
            ),
          timeoutDuration
        )
      );

      const functionPromise = supabase.functions.invoke("generate-prompts", {
        body: { initialPrompt, count: validatedCount },
      });

      const { data, error } = await Promise.race([
        functionPromise,
        timeoutPromise,
      ]);

      if (error) {
        console.error("Supabase function error:", error);
        throw error;
      }

      if (!data) {
        throw new Error("No data returned from prompt generation");
      }

      console.log("Raw response from backend:", data);

      // Parse the response
      let prompts = [];

      if (data.prompts) {
        if (Array.isArray(data.prompts)) {
          // Already an array, use directly
          prompts = data.prompts.filter(
            (prompt) => typeof prompt === "string" && prompt.length >= 10
          );
        } else if (typeof data.prompts === "string") {
          // Try to parse string response
          try {
            // Clean up the string first
            let cleanedContent = data.prompts
              .replace(/\\"/g, '"')
              .replace(/\\n/g, " ")
              .replace(/\n/g, " ")
              .trim();

            // Remove any surrounding quotes
            if (
              cleanedContent.startsWith('"') &&
              cleanedContent.endsWith('"')
            ) {
              cleanedContent = cleanedContent.slice(1, -1);
            }

            console.log(
              "Attempting to parse cleaned content:",
              cleanedContent.substring(0, 200) + "..."
            );

            // Try to find JSON array in the content
            const jsonMatch = cleanedContent.match(/\[[\s\S]*\]/);
            if (jsonMatch) {
              const parsedPrompts = JSON.parse(jsonMatch[0]);
              if (Array.isArray(parsedPrompts)) {
                prompts = parsedPrompts
                  .map((prompt) =>
                    typeof prompt === "string"
                      ? prompt.trim()
                      : String(prompt).trim()
                  )
                  .filter((prompt) => prompt.length >= 10);
              }
            } else {
              // Fallback: try to parse the entire string as JSON
              const parsedPrompts = JSON.parse(cleanedContent);
              if (Array.isArray(parsedPrompts)) {
                prompts = parsedPrompts
                  .map((prompt) =>
                    typeof prompt === "string"
                      ? prompt.trim()
                      : String(prompt).trim()
                  )
                  .filter((prompt) => prompt.length >= 10);
              }
            }
          } catch (parseError) {
            console.error("Failed to parse prompts string:", parseError);
            console.error("Original content:", data.prompts.substring(0, 500));

            // Final fallback: split by common delimiters and clean
            prompts = data.prompts
              .split(/(?:,\s*")|(?:"\s*,)|[\r\n]+/)
              .map((line) => line.replace(/^["'\s]+|["'\s]+$/g, "").trim())
              .filter((line) => line.length >= 10 && !line.match(/^\[|\]$/))
              .slice(0, validatedCount);
          }
        }
      }

      // Final validation and cleanup
      prompts = prompts
        .slice(0, validatedCount)
        .map((prompt) => prompt.replace(/^["']|["']$/g, "").trim())
        .filter((prompt) => prompt.length >= 10);

      console.log(
        `Successfully parsed ${prompts.length} prompts:`,
        prompts.map((p) => p.substring(0, 50) + "...")
      );

      if (prompts.length === 0) {
        throw new Error(
          "No valid prompts were generated. Please try again with a different initial prompt."
        );
      }

      return prompts;
    } catch (err) {
      console.error("Error in generatePrompts:", err);
      setError(err.message || "Failed to generate prompts");
      return [];
    } finally {
      setIsGeneratingPrompts(false);
    }
  };

  const generateImages = async (
    photoIds,
    prompts,
    size = "auto",
    background = "opaque",
    model = "openai"
  ) => {
    setIsGeneratingImages(true);
    setError(null);

    try {
      // Check if Supabase is properly configured
      if (!import.meta.env.VITE_SUPABASE_URL) {
        throw new Error(
          "Supabase not configured. Please set up your environment variables."
        );
      }

      console.log(
        `Generating images for ${photoIds.length} photos with ${prompts.length} prompts, size: ${size}, background: ${background}, model: ${model}`
      );

      // Calculate timeout based on number of combinations
      const totalCombinations = photoIds.length * prompts.length;
      const timeoutDuration = Math.max(60000, totalCombinations * 10000); // 10s per combination minimum

      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(
          () =>
            reject(
              new Error(
                `Image generation timeout after ${timeoutDuration / 1000}s`
              )
            ),
          timeoutDuration
        )
      );

      const functionPromise = supabase.functions.invoke("generate-images", {
        body: { photoIds, prompts, size, background, model },
      });

      const { data, error } = await Promise.race([
        functionPromise,
        timeoutPromise,
      ]);

      if (error) {
        console.error("Image generation error:", error);
        throw error;
      }

      console.log("Image generation response:", data);

      return data?.results || [];
    } catch (err) {
      console.error("Error in generateImages:", err);
      setError(err.message || "Failed to generate images");
      return [];
    } finally {
      setIsGeneratingImages(false);
    }
  };

  return {
    generatePrompts,
    generateImages,
    isGeneratingPrompts,
    isGeneratingImages,
    error,
    clearError: () => setError(null),
    resetStates,
  };
};
