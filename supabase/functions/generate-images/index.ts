// Follow this setup guide to integrate the Deno language server with your editor:
// https://deno.land/manual/getting_started/setup_your_environment
// This enables autocomplete, go to definition, etc.

// Setup type definitions for built-in Supabase Runtime APIs
import "jsr:@supabase/functions-js/edge-runtime.d.ts"

Deno.serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      status: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        'Access-Control-Max-Age': '86400',
      },
    })
  }

  try {
    const { photoIds, prompts } = await req.json()
    
    if (!photoIds || !prompts || photoIds.length === 0 || prompts.length === 0) {
      return new Response(
        JSON.stringify({ error: 'Missing required parameters' }),
        { 
          status: 400,
          headers: { 
            "Content-Type": "application/json",
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'POST, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type, Authorization',
          }
        }
      )
    }
    
    const supabaseUrl = Deno.env.get('SUPABASE_URL')
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
    
    if (!supabaseUrl || !supabaseServiceKey) {
      throw new Error('Missing Supabase environment variables')
    }
    
    const results = []
    
    for (const photoId of photoIds) {
      // Get photo details from database
      const photoResponse = await fetch(`${supabaseUrl}/rest/v1/uploaded_photos?id=eq.${photoId}`, {
        headers: {
          'apikey': supabaseServiceKey,
          'Authorization': `Bearer ${supabaseServiceKey}`,
          'Content-Type': 'application/json'
        }
      })
      
      if (!photoResponse.ok) {
        console.error(`Failed to fetch photo ${photoId}`)
        continue
      }
      
      const photoData = await photoResponse.json()
      if (photoData.length === 0) continue
      
      const photo = photoData[0]
      
      for (const prompt of prompts) {
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
            console.error(`DALL-E API error for prompt: ${prompt}`)
            continue
          }
          
          const dalleData = await dalleResponse.json()
          const imageUrl = dalleData.data[0].url
          
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
            results.push({
              id: insertData[0].id,
              photo_id: photoId,
              initial_prompt: prompts[0],
              generated_prompt: prompt,
              image_url: imageUrl,
              original_photo_url: `${supabaseUrl}/storage/v1/object/public/uploaded-photos/${photo.file_path}`,
              created_at: insertData[0].created_at
            })
          }
          
        } catch (error) {
          console.error(`Error processing prompt "${prompt}" for photo ${photoId}:`, error)
        }
      }
    }
    
    return new Response(
      JSON.stringify({ results }),
      { 
        headers: { 
          "Content-Type": "application/json",
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        } 
      }
    )
    
  } catch (error) {
    console.error('Function error:', error)
    return new Response(
      JSON.stringify({ error: error.message }),
      { 
        status: 500,
        headers: { 
          "Content-Type": "application/json",
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        }
      }
    )
  }
})
