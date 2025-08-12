// Follow this setup guide to integrate the Deno language server with your editor:
// https://deno.land/manual/getting_started/setup_your_environment
// This enables autocomplete, go to definition, etc.

// Setup type definitions for built-in Supabase Runtime APIs
import "jsr:@supabase/functions-js/edge-runtime.d.ts"

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-client-info, apikey',
  'Access-Control-Max-Age': '86400',
}

const IMAGE_SIZE = 1024; // You can adjust this as needed

// Fetch image as PNG File (adapted from your working code)
async function fetchImageAsFile(url: string, fileName: string): Promise<File> {
  const resp = await fetch(url);
  const blob = await resp.blob();
  // Force PNG type for OpenAI API
  return new File([blob], fileName, { type: "image/png" });
}

Deno.serve(async (req) => {
  console.log('🚀 Image generation function started')
  
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      status: 200,
      headers: corsHeaders,
    })
  }

  try {
    const { photoIds, prompts } = await req.json()
    console.log(`📸 Processing ${photoIds?.length || 0} photos with ${prompts?.length || 0} prompts`)
    
    if (!photoIds || !prompts || photoIds.length === 0 || prompts.length === 0) {
      console.error('❌ Missing required parameters:', { photoIds, prompts })
      return new Response(
        JSON.stringify({ error: 'Missing required parameters: photoIds and prompts are required' }),
        { 
          status: 400,
          headers: { 
            "Content-Type": "application/json",
            ...corsHeaders,
          }
        }
      )
    }
    
    const supabaseUrl = Deno.env.get('SUPABASE_URL')
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
    const openaiApiKey = Deno.env.get('OPENAI_API_KEY')
    
    if (!supabaseUrl || !supabaseServiceKey || !openaiApiKey) {
      console.error('❌ Missing environment variables:', { 
        hasUrl: !!supabaseUrl, 
        hasServiceKey: !!supabaseServiceKey,
        hasOpenAI: !!openaiApiKey
      })
      return new Response(
        JSON.stringify({ error: 'Missing required environment variables' }),
        { 
          status: 500,
          headers: { 
            "Content-Type": "application/json",
            ...corsHeaders,
          }
        }
      )
    }
    
    const results = []
    
    for (const photoId of photoIds) {
      try {
        // Get photo details from database
        const photoResponse = await fetch(`${supabaseUrl}/rest/v1/uploaded_photos?id=eq.${photoId}`, {
          headers: {
            'apikey': supabaseServiceKey,
            'Authorization': `Bearer ${supabaseServiceKey}`,
            'Content-Type': 'application/json'
          }
        })
        
        if (!photoResponse.ok) {
          console.error(`❌ Failed to fetch photo ${photoId}:`, {
            status: photoResponse.status,
            statusText: photoResponse.statusText
          })
          continue
        }
        
        const photoData = await photoResponse.json()
        if (photoData.length === 0) {
          console.warn(`⚠️ No photo data found for ID: ${photoId}`)
          continue
        }
        
        const photo = photoData[0]
        
        // Get pet image URL with transformation to ensure proper format and size
        const petImageUrl = `${supabaseUrl}/storage/v1/object/public/uploaded-photos/${photo.file_path}?width=400&height=400&quality=80&format=webp`
        
        for (const prompt of prompts) {
          try {
            console.log(`🎨 Processing prompt: "${prompt}" for photo ${photoId}`)
            
            // Fetch pet image as file
            const petFile = await fetchImageAsFile(petImageUrl, "pet.png")
            console.log(`📁 Pet image: ${petFile.size} bytes, type: ${petFile.type}`)
            
            // Use your exact working API call format, but with just the pet image
            const form = new FormData();
            form.append("image", petFile); // Single image instead of image[]
            form.append("model", "gpt-image-1");
            form.append("prompt", prompt);
            form.append("size", `${IMAGE_SIZE}x${IMAGE_SIZE}`);
            
            console.log('🤖 Calling OpenAI API with your working format...')
            const openaiResponse = await fetch("https://api.openai.com/v1/images/edits", {
              method: "POST",
              headers: {
                "Authorization": `Bearer ${openaiApiKey}`
              },
              body: form
            });
            
            if (!openaiResponse.ok) {
              const errorText = await openaiResponse.text();
              console.error(`❌ OpenAI API error for prompt "${prompt}":`, {
                status: openaiResponse.status,
                statusText: openaiResponse.statusText,
                error: errorText
              });
              continue;
            }
            
            const openaiData = await openaiResponse.json();
            
            if (openaiData.usage) {
              console.log('[EdgeFunction] OpenAI API Usage:', openaiData.usage);
            }
            
            // Get the generated image - check for both b64_json and url formats
            let imageUrl = null;
            let b64Image = null;
            
            if (openaiData.data?.[0]?.url) {
              imageUrl = openaiData.data[0].url;
              console.log('✅ Got image URL from OpenAI');
            } else if (openaiData.data?.[0]?.b64_json) {
              b64Image = openaiData.data[0].b64_json;
              console.log('✅ Got base64 image from OpenAI');
            } else {
              console.error('❌ No image returned from OpenAI API');
              continue;
            }
            
            // Process and upload the generated image
            await processGeneratedImage({
              imageUrl,
              b64Image,
              photoId,
              prompt,
              initialPrompt: prompts[0],
              supabaseUrl,
              supabaseServiceKey,
              results,
              originalPhotoUrl: petImageUrl
            });
            
          } catch (promptError) {
            console.error(`💥 Error processing prompt "${prompt}" for photo ${photoId}:`, {
              error: promptError.message,
              stack: promptError.stack,
              prompt,
              photoId
            })
          }
        }
      } catch (photoError) {
        console.error(`💥 Error processing photo ${photoId}:`, {
          error: photoError.message,
          stack: photoError.stack,
          photoId
        })
      }
    }
    
    return new Response(
      JSON.stringify({ 
        success: true,
        results,
        processed: results.length,
        message: `Successfully processed ${results.length} images`
      }),
      { 
        headers: { 
          "Content-Type": "application/json",
          ...corsHeaders,
        } 
      }
    )
    
  } catch (error) {
    console.error('💥 Function error:', {
      message: error.message,
      stack: error.stack,
      name: error.name
    })
    return new Response(
      JSON.stringify({ 
        error: error.message,
        details: 'Check function logs for more information'
      }),
      { 
        status: 500,
        headers: { 
          "Content-Type": "application/json",
          ...corsHeaders,
        }
      }
    )
  }
})

// Helper function to process generated image and save to database
async function processGeneratedImage({
  imageUrl,
  b64Image,
  photoId,
  prompt,
  initialPrompt,
  supabaseUrl,
  supabaseServiceKey,
  results,
  originalPhotoUrl
}: {
  imageUrl?: string;
  b64Image?: string;
  photoId: string;
  prompt: string;
  initialPrompt: string;
  supabaseUrl: string;
  supabaseServiceKey: string;
  results: any[];
  originalPhotoUrl: string;
}) {
  try {
    console.log('📥 Processing generated image...')
    
    let imageBuffer: Uint8Array;
    
    if (imageUrl) {
      // Download from URL
      const imageResponse = await fetch(imageUrl);
      if (!imageResponse.ok) {
        console.error(`❌ Failed to download image from OpenAI:`, {
          status: imageResponse.status,
          statusText: imageResponse.statusText
        });
        return;
      }
      const arrayBuffer = await imageResponse.arrayBuffer();
      imageBuffer = new Uint8Array(arrayBuffer);
    } else if (b64Image) {
      // Convert from base64
      imageBuffer = Uint8Array.from(atob(b64Image), (c) => c.charCodeAt(0));
    } else {
      console.error('❌ No image data provided');
      return;
    }
    
    // Generate unique filename
    const fileName = `generated_${photoId}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}.png`;
    
    console.log('☁️ Uploading to Supabase storage...')
    
    // Upload to Supabase Storage
    const uploadResponse = await fetch(`${supabaseUrl}/storage/v1/object/generated-images/${fileName}`, {
      method: 'POST',
      headers: {
        'apikey': supabaseServiceKey,
        'Authorization': `Bearer ${supabaseServiceKey}`,
        'Content-Type': 'image/png'
      },
      body: imageBuffer
    });
    
    if (!uploadResponse.ok) {
      const errorText = await uploadResponse.text();
      console.error(`❌ Failed to upload image to Supabase storage:`, {
        status: uploadResponse.status,
        statusText: uploadResponse.statusText,
        error: errorText
      });
      return;
    }
    
    const permanentUrl = `${supabaseUrl}/storage/v1/object/public/generated-images/${fileName}`;
    
    console.log('💾 Saving to database...')
    
    // Store result in database
    const insertResponse = await fetch(`${supabaseUrl}/rest/v1/generated_images`, {
      method: 'POST',
      headers: {
        'apikey': supabaseServiceKey,
        'Authorization': `Bearer ${supabaseServiceKey}`,
        'Content-Type': 'application/json',
        'Prefer': 'return=representation'
      },
      body: JSON.stringify({
        photo_id: photoId,
        initial_prompt: initialPrompt,
        generated_prompt: prompt,
        image_url: permanentUrl,
        openai_image_url: imageUrl || null,
        created_at: new Date().toISOString()
      })
    });
    
    if (insertResponse.ok) {
      const insertData = await insertResponse.json();
      results.push({
        id: insertData[0].id,
        photo_id: photoId,
        initial_prompt: initialPrompt,
        generated_prompt: prompt,
        image_url: permanentUrl,
        openai_image_url: imageUrl || null,
        original_photo_url: originalPhotoUrl,
        created_at: insertData[0].created_at,
        status: 'success'
      });
      console.log('✅ Successfully saved generated image');
    } else {
      const errorText = await insertResponse.text();
      console.error(`❌ Failed to store generated image in database:`, {
        status: insertResponse.status,
        statusText: insertResponse.statusText,
        error: errorText
      });
    }
    
  } catch (error) {
    console.error('💥 Error processing generated image:', error);
  }
}