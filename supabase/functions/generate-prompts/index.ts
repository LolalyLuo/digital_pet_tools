// Follow this setup guide to integrate the Deno language server with your editor:
// https://deno.land/manual/getting_started/setup_your_environment
// This enables autocomplete, go to definition, etc.

// Setup type definitions for built-in Supabase Runtime APIs
import "jsr:@supabase/functions-js/edge-runtime.d.ts"

console.log("Generating prompts")

Deno.serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
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
    const { initialPrompt, count } = await req.json()
    
    if (!initialPrompt || !count) {
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
    
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${Deno.env.get('OPENAI_API_KEY')}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'gpt-4',
        messages: [{
          role: 'user',
          content: `
          Create ${count} image generation prompts for pet-themed artwork that can be printed on physical products. Each prompt should feature the user's pet photo as the main subject, transformed into different artistic styles suitable for print-on-demand merchandise.
          The generated prompts should respect the general theme or purpose the user has decided on: "${initialPrompt}". The purpose is to test different prompts and ideas. Therefore each prompt should be unique and different from the others.
          Requirements:
          - Each prompt should describe the pet in a different artistic style or creative scenario
          - Style variations: cute, artistic, marketable for pet owners
          - Background: Transparent or solid color for easy printing on various products
          - Composition: Clean, centered design that works on different product formats
          - Quality: High-contrast, bold designs that print well on merchandise
          Format: Return as a JSON array of ${count} detailed prompts, each can have various length describing the artistic transformation, style, and technical requirements. No additional text or explanations.
          
          For example:
          ---
          Count: 3,
          Theme: "Designs for different art styles"

          Result:
          [
          "Turn the provided dog photo into a high-detail vector-style digital illustration. Preserve the dog's realistic proportions and facial features, but use bold, clean shapes with sharp, well-defined edges for fur and details. Render the fur in layered strokes with visible separation between strands, using a rich, warm color palette and subtle gradients for depth. Eyes should be glossy, expressive, and outlined for emphasis. Background should be transparent to highlight the dog, with a polished, commercial-quality finish suitable for printing on products. ",
          "Turn the provided dog photo into a minimalist continuous-line drawing in the style of the reference image. Use clean, smooth, unbroken black lines to outline the dog's head and facial features. Keep details minimal but expressive, with slight line variations to show wrinkles, ear shapes, and eyes. No shading, not areas of black, no color, and no background — just simple, elegant line art that preserves the dog's unique facial proportions and key features. ",
          "Turn the provided dog photo into a soft, dreamy watercolor painting. Use loose, painterly brushstrokes with delicate blending to capture the fur's texture, while keeping the dog's proportions and facial features accurate. Apply warm, natural lighting with sunlit highlights, as if in a gentle meadow scene. Use a soft, pastel color palette with light yellows, creams, and muted greens. Surround the dog with blurred, painterly wildflowers and foliage to give an impressionistic, serene atmosphere. Maintain a hand-painted look with visible brush textures and natural color bleeding. Background should be transparent to highlight the dog, with a polished, commercial-quality finish suitable for printing on products."
          ]

          Now it is your turn to create ${count} prompts for the theme: "${initialPrompt}".
          ---
          Count: ${count},
          Theme: "${initialPrompt}"

          Result:
          `
        }],
        temperature: 0.8,
        max_tokens: 500
      })
    })
    
    if (!response.ok) {
      throw new Error(`OpenAI API error: ${response.status}`)
    }
    
    const data = await response.json()
    const content = data.choices[0].message.content

    console.log(content)
    
    // Try to parse JSON response
    let prompts = []
    try {
      // Clean up the response and extract JSON
      const jsonMatch = content.match(/\[.*\]/s)
      if (jsonMatch) {
        prompts = JSON.parse(jsonMatch[0])
      } else {
        // Fallback: split by newlines and clean up
        prompts = content.split('\n')
          .filter(line => line.trim() && !line.includes('```'))
          .map(line => line.replace(/^\d+\.\s*/, '').trim())
          .slice(0, count)
      }
    } catch (parseError) {
      console.error('Failed to parse OpenAI response:', parseError)
      // Fallback to simple variations
      prompts = Array.from({ length: count }, (_, i) => `${initialPrompt} variation ${i + 1}`)
    }
    
    // Ensure we have an array and return clean format
    if (Array.isArray(prompts)) {
      prompts = prompts.slice(0, count)
    } else {
      prompts = Array.from({ length: count }, (_, i) => `${initialPrompt} variation ${i + 1}`)
    }
    
    console.log('Final prompts to return:', prompts)
    
    return new Response(
      JSON.stringify({ prompts }),
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
    console.error('Function error:', error)
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

/* To invoke locally:

  1. Run `supabase start` (see: https://supabase.com/docs/reference/cli/supabase-start)
  2. Make an HTTP request:

  curl -i --location --request POST 'http://127.0.0.1:54321/functions/v1/generate-prompts' \
    --header 'Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0' \
    --header 'Content-Type: application/json' \
    --data '{"name":"Functions"}'

*/
