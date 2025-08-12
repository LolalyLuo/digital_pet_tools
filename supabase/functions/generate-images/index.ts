// Follow this setup guide to integrate the Deno language server with your editor:
// https://deno.land/manual/getting_started/setup_your_environment
// This enables autocomplete, go to definition, etc.

// Setup type definitions for built-in Supabase Runtime APIs
import "jsr:@supabase/functions-js/edge-runtime.d.ts"

Deno.serve(async (req) => {
  console.log('🚀 Image generation function started')
  
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    console.log('📋 Handling CORS preflight request')
    return new Response(null, {
      status: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-client-info, apikey',
        'Access-Control-Max-Age': '86400',
      },
    })
  }

  try {
    const { photoIds, prompts } = await req.json()
    console.log(`📸 Processing ${photoIds?.length || 0} photos with ${prompts?.length || 0} prompts`)
    console.log('📝 Prompts:', prompts)
    
    if (!photoIds || !prompts || photoIds.length === 0 || prompts.length === 0) {
      console.error('❌ Missing required parameters:', { photoIds, prompts })
      return new Response(
        JSON.stringify({ error: 'Missing required parameters' }),
        { 
          status: 400,
          headers: { 
            "Content-Type": "application/json",
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'POST, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-client-info, apikey',
          }
        }
      )
    }
    
    const supabaseUrl = Deno.env.get('SUPABASE_URL')
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
    
    if (!supabaseUrl || !supabaseServiceKey) {
      console.error('❌ Missing Supabase environment variables:', { 
        hasUrl: !!supabaseUrl, 
        hasServiceKey: !!supabaseServiceKey 
      })
      throw new Error('Missing Supabase environment variables')
    }
    
    console.log('✅ Environment variables loaded successfully')
    const results = []
    
    for (const photoId of photoIds) {
      console.log(`🔄 Processing photo ID: ${photoId}`)
      
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
      console.log(`✅ Successfully fetched photo data for ID: ${photoId}`, {
        filePath: photo.file_path,
        hasFilePath: !!photo.file_path
      })
      
      for (const prompt of prompts) {
        console.log(`🎨 Generating image for prompt: "${prompt}"`)
        try {
          // Generate image using DALL-E
          const dalleResponse = await fetch('https://api.openai.com/v1/images/generations', {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${Deno.env.get('OPENAI_API_KEY')}`,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({
              model: 'dall-e-3',
              prompt: `${prompt}, featuring a dog photo`,
              n: 1,
              size: '1024x1024',
              quality: 'standard'
            })
          })
          
          if (!dalleResponse.ok) {
            const errorText = await dalleResponse.text()
            console.error(`❌ DALL-E API error for prompt "${prompt}":`, {
              status: dalleResponse.status,
              statusText: dalleResponse.statusText,
              error: errorText
            })
            continue
          }
          
          const dalleData = await dalleResponse.json()
          const imageUrl = dalleData.data[0].url
          console.log(`✅ DALL-E image generated successfully for prompt: "${prompt}"`)
          
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
              initial_prompt: prompts[0], // First prompt as initial
              generated_prompt: prompt,
              image_url: imageUrl
            })
          })
          
          if (insertResponse.ok) {
            const insertData = await insertResponse.json()
            console.log(`💾 Successfully stored generated image in database for prompt: "${prompt}"`)
            results.push({
              id: insertData[0].id,
              photo_id: photoId,
              initial_prompt: prompts[0],
              generated_prompt: prompt,
              image_url: imageUrl,
              original_photo_url: `${supabaseUrl}/storage/v1/object/public/uploaded-photos/${photo.file_path}`,
              created_at: insertData[0].created_at
            })
          } else {
            const errorText = await insertResponse.text()
            console.error(`❌ Failed to store generated image in database for prompt "${prompt}":`, {
              status: insertResponse.status,
              statusText: insertResponse.statusText,
              error: errorText
            })
          }
          
        } catch (error) {
          console.error(`💥 Error processing prompt "${prompt}" for photo ${photoId}:`, {
            error: error.message,
            stack: error.stack,
            prompt,
            photoId
          })
        }
      }
    }
    
    console.log(`🎉 Image generation completed. Generated ${results.length} images successfully`)
    return new Response(
      JSON.stringify({ results }),
      { 
        headers: { 
          "Content-Type": "application/json",
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-client-info, apikey',
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
      JSON.stringify({ error: error.message }),
      { 
        status: 500,
        headers: { 
          "Content-Type": "application/json",
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-client-info, apikey',
        }
      }
    )
  }
})
