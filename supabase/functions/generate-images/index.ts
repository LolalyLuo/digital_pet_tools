// Follow this setup guide to integrate the Deno language server with your editor:
// https://deno.land/manual/getting_started/setup_your_environment
// This enables autocomplete, go to definition, etc.

// Setup type definitions for built-in Supabase Runtime APIs
import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers":
    "Content-Type, Authorization, x-client-info, apikey",
  "Access-Control-Max-Age": "86400",
};

const IMAGE_SIZE = 1024; // You can adjust this as needed
const BATCH_SIZE = 3; // Process 3 images in parallel at a time

// Fetch image as PNG File (adapted from your working code)
async function fetchImageAsFile(url: string, fileName: string): Promise<File> {
  const resp = await fetch(url);
  const blob = await resp.blob();
  // Force PNG type for OpenAI API
  return new File([blob], fileName, { type: "image/png" });
}

Deno.serve(async (req) => {
  console.log("🚀 Image generation function started");

  // Handle CORS preflight requests
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 200,
      headers: corsHeaders,
    });
  }

  try {
    const {
      photoIds,
      prompts,
      size = "auto",
      background = "opaque",
    } = await req.json();
    console.log(
      `📸 Processing ${photoIds?.length || 0} photos with ${
        prompts?.length || 0
      } prompts, size: ${size}, background: ${background}`
    );

    if (
      !photoIds ||
      !prompts ||
      photoIds.length === 0 ||
      prompts.length === 0
    ) {
      console.error("❌ Missing required parameters:", { photoIds, prompts });
      return new Response(
        JSON.stringify({
          error:
            "Missing required parameters: photoIds and prompts are required",
        }),
        {
          status: 400,
          headers: {
            "Content-Type": "application/json",
            ...corsHeaders,
          },
        }
      );
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const openaiApiKey = Deno.env.get("OPENAI_API_KEY");

    if (!supabaseUrl || !supabaseServiceKey || !openaiApiKey) {
      console.error("❌ Missing environment variables:", {
        hasUrl: !!supabaseUrl,
        hasServiceKey: !!supabaseServiceKey,
        hasOpenAI: !!openaiApiKey,
      });
      return new Response(
        JSON.stringify({ error: "Missing required environment variables" }),
        {
          status: 500,
          headers: {
            "Content-Type": "application/json",
            ...corsHeaders,
          },
        }
      );
    }

    const results: Array<{
      id: string;
      photo_id: string;
      initial_prompt: string;
      generated_prompt: string;
      image_url: string;
      public_url: string;
      original_photo_url: string;
      created_at: string;
      status: string;
    }> = [];

    // Create all photo-prompt combinations for parallel processing
    const combinations: Array<{
      photoId: string;
      prompt: string;
      size: string;
      background: string;
    }> = [];
    for (const photoId of photoIds) {
      for (const prompt of prompts) {
        combinations.push({ photoId, prompt, size, background });
      }
    }

    // Process combinations in batches to avoid overwhelming CPU and hitting rate limits
    const resultsArray: Array<any> = [];

    for (let i = 0; i < combinations.length; i += BATCH_SIZE) {
      const batch = combinations.slice(i, i + BATCH_SIZE);
      console.log(
        `🔄 Processing batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(
          combinations.length / BATCH_SIZE
        )} (${batch.length} items)`
      );

      const batchPromises = batch.map(
        async ({ photoId, prompt, size, background }) => {
          try {
            // Get photo details from database
            const photoResponse = await fetch(
              `${supabaseUrl}/rest/v1/uploaded_photos?id=eq.${photoId}`,
              {
                headers: {
                  apikey: supabaseServiceKey,
                  Authorization: `Bearer ${supabaseServiceKey}`,
                  "Content-Type": "application/json",
                },
              }
            );

            if (!photoResponse.ok) {
              console.error(`❌ Failed to fetch photo ${photoId}:`, {
                status: photoResponse.status,
                statusText: photoResponse.statusText,
              });
              return null;
            }

            const photoData = await photoResponse.json();
            if (photoData.length === 0) {
              console.warn(`⚠️ No photo data found for ID: ${photoId}`);
              return null;
            }

            const photo = photoData[0];

            // Get pet image URL with transformation to ensure proper format and size
            const petImageUrl = `${supabaseUrl}/storage/v1/object/public/uploaded-photos/${photo.file_path}?width=400&height=400&quality=80&format=webp`;

            console.log(
              `🎨 Processing prompt: "${prompt}" for photo ${photoId}`
            );

            const additionalPromptOpaque = `
          Requirements:
          - Use the pet only and no other elements from the photo.
          - Background: background should match the general theme and style..
          - Composition: Clean, centered design that works on different product formats. 
          - Quality: High quality designs with beautiful pet and detailed background. `;

            const additionalPromptTransparent = `
          Requirements:
          - Use the pet only and no other elements from the photo.
          - Background: The pet is isolated on empty background, no background elements, no setting, transparent background, with pet only.
          - Composition: Clean, centered design that works on different product formats. Ensure some empty space around the pet and nothing is cutoff.
          - Quality: High quality designs that print well on merchandise. `;

            // Fetch pet image as file
            const petFile = await fetchImageAsFile(petImageUrl, "pet.png");
            console.log(
              `📁 Pet image: ${petFile.size} bytes, type: ${petFile.type}`
            );

            // Use your exact working API call format, but with just the pet image
            const form = new FormData();
            form.append("image", petFile); // Single image instead of image[]
            form.append("model", "gpt-image-1");
            form.append(
              "prompt",
              prompt +
                (background === "opaque"
                  ? additionalPromptOpaque
                  : additionalPromptTransparent)
            );
            form.append("size", size);
            form.append("background", background);

            console.log("🤖 Calling OpenAI API with your working format...");
            const openaiResponse = await fetch(
              "https://api.openai.com/v1/images/edits",
              {
                method: "POST",
                headers: {
                  Authorization: `Bearer ${openaiApiKey}`,
                },
                body: form,
              }
            );

            if (!openaiResponse.ok) {
              const errorText = await openaiResponse.text();
              console.error(`❌ OpenAI API error for prompt "${prompt}":`, {
                status: openaiResponse.status,
                statusText: openaiResponse.statusText,
                error: errorText,
              });
              return null;
            }

            const openaiData = await openaiResponse.json();

            if (openaiData.usage) {
              console.log("[EdgeFunction] OpenAI API Usage:", openaiData.usage);
            }

            // Get the generated image - check for both b64_json and url formats
            let openaiImageUrl = null;
            let b64Image = undefined;

            if (openaiData.data?.[0]?.url) {
              openaiImageUrl = openaiData.data[0].url;
              console.log("✅ Got image URL from OpenAI");
            } else if (openaiData.data?.[0]?.b64_json) {
              b64Image = openaiData.data[0].b64_json;
              console.log("✅ Got base64 image from OpenAI");
            } else {
              console.error("❌ No image returned from OpenAI API");
              return null;
            }

            // Process and upload the generated image
            const result = await processGeneratedImage({
              b64Image,
              photoId,
              prompt,
              initialPrompt: prompts[0],
              // Convert size from API format (1024x1024) to database format (1024×1024)
              size: size === "auto" ? "auto" : size.replace("x", "×"),
              background,
              supabaseUrl,
              supabaseServiceKey,
              originalPhotoUrl: petImageUrl,
            });

            console.log(
              `🔧 Size conversion: API received "${size}" -> Database will store "${
                size === "auto" ? "auto" : size.replace("x", "×")
              }"`
            );

            return result;
          } catch (error) {
            console.error(
              `💥 Error processing photo ${photoId} with prompt "${prompt}":`,
              {
                error: error.message,
                stack: error.stack,
                photoId,
                prompt,
              }
            );
            return null;
          }
        }
      );

      // Wait for current batch to complete before moving to next batch
      const batchResults = await Promise.all(batchPromises);
      resultsArray.push(...batchResults.filter((result) => result !== null));

      // Add a small delay between batches to be respectful to OpenAI API
      if (i + BATCH_SIZE < combinations.length) {
        console.log(`⏳ Batch complete. Waiting 1 second before next batch...`);
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    }

    // Filter out null results and add to results array
    results.push(...resultsArray.filter((result) => result !== null));

    return new Response(
      JSON.stringify({
        success: true,
        results,
        processed: results.length,
        message: `Successfully processed ${results.length} images`,
      }),
      {
        headers: {
          "Content-Type": "application/json",
          ...corsHeaders,
        },
      }
    );
  } catch (error) {
    console.error("💥 Function error:", {
      message: error.message,
      stack: error.stack,
      name: error.name,
    });
    return new Response(
      JSON.stringify({
        error: error.message,
        details: "Check function logs for more information",
      }),
      {
        status: 500,
        headers: {
          "Content-Type": "application/json",
          ...corsHeaders,
        },
      }
    );
  }
});

// Helper function to process generated image and save to database
async function processGeneratedImage({
  b64Image,
  photoId,
  prompt,
  initialPrompt,
  size,
  background,
  supabaseUrl,
  supabaseServiceKey,
  originalPhotoUrl,
}: {
  b64Image?: string;
  photoId: string;
  prompt: string;
  initialPrompt: string;
  size: string;
  background: string;
  supabaseUrl: string;
  supabaseServiceKey: string;
  originalPhotoUrl: string;
}): Promise<{
  id: string;
  photo_id: string;
  initial_prompt: string;
  generated_prompt: string;
  image_url: string;
  public_url: string;
  original_photo_url: string;
  created_at: string;
  status: string;
} | null> {
  try {
    console.log("📥 Processing generated image...");

    let imageBuffer: Uint8Array;

    if (b64Image) {
      // Convert from base64
      imageBuffer = Uint8Array.from(atob(b64Image), (c) => c.charCodeAt(0));
    } else {
      console.error("❌ No image data provided");
      return null; // Return null to indicate failure
    }

    // Generate unique filename
    const fileName = `generated_${photoId}_${Date.now()}_${Math.random()
      .toString(36)
      .substr(2, 9)}.png`;

    console.log("☁️ Uploading to Supabase storage...");

    // Upload to Supabase Storage bucket 'generated-images'
    const uploadResponse = await fetch(
      `${supabaseUrl}/storage/v1/object/generated-images/${fileName}`,
      {
        method: "POST",
        headers: {
          apikey: supabaseServiceKey,
          Authorization: `Bearer ${supabaseServiceKey}`,
          "Content-Type": "image/png",
          "Cache-Control": "3600",
        },
        body: imageBuffer,
      }
    );

    if (!uploadResponse.ok) {
      const errorText = await uploadResponse.text();
      console.error(`❌ Failed to upload image to Supabase storage:`, {
        status: uploadResponse.status,
        statusText: uploadResponse.statusText,
        error: errorText,
        fileName: fileName,
      });
      return null; // Return null to indicate failure
    }

    console.log(
      `✅ Successfully uploaded ${fileName} to generated-images bucket`
    );

    // The image_url should just be the fileName since it references the generated-images bucket
    const imageUrl = fileName;

    console.log("💾 Saving to database...");
    console.log(
      `📊 Database insertion payload - size: "${size}", background: "${background}"`
    );

    // Store result in database - matching exact schema
    const insertResponse = await fetch(
      `${supabaseUrl}/rest/v1/generated_images`,
      {
        method: "POST",
        headers: {
          apikey: supabaseServiceKey,
          Authorization: `Bearer ${supabaseServiceKey}`,
          "Content-Type": "application/json",
          Prefer: "return=representation",
        },
        body: JSON.stringify({
          photo_id: photoId,
          initial_prompt: initialPrompt,
          generated_prompt: prompt,
          image_url: imageUrl, // Just the filename, not full URL
          size: size,
          background: background,
        }),
      }
    );

    if (insertResponse.ok) {
      const insertData = await insertResponse.json();

      // Build full public URL for response
      const publicUrl = `${supabaseUrl}/storage/v1/object/public/generated-images/${imageUrl}`;

      return {
        id: insertData[0].id,
        photo_id: photoId,
        initial_prompt: initialPrompt,
        generated_prompt: prompt,
        image_url: imageUrl, // Storage path as stored in DB
        public_url: publicUrl, // Full URL for client usage
        original_photo_url: originalPhotoUrl,
        created_at: insertData[0].created_at,
        status: "success",
      };
    } else {
      const errorText = await insertResponse.text();
      console.error(`❌ Failed to store generated image in database:`, {
        status: insertResponse.status,
        statusText: insertResponse.statusText,
        error: errorText,
        payload: {
          photo_id: photoId,
          initial_prompt: initialPrompt,
          generated_prompt: prompt,
          image_url: imageUrl,
        },
      });
      return null; // Return null to indicate failure
    }
  } catch (error) {
    console.error("💥 Error processing generated image:", error);
    return null; // Return null to indicate failure
  }
}
