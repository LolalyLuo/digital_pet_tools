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
    
    // Calculate appropriate token limit based on count
    // Each prompt averages ~150-200 tokens, so we need buffer
    const maxTokens = Math.max(500, count * 250)
    
    console.log(`Generating ${count} prompts with max tokens: ${maxTokens}`)
    
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
          Create exactly ${count} image generation prompts for pet-themed artwork that can be printed on physical products. Each prompt should feature the user's pet photo as the main subject, transformed into different artistic styles suitable for print-on-demand merchandise.
          
          The generated prompts should respect the general theme: "${initialPrompt}". Each prompt should be unique and different from the others.
          
          Requirements:
          - Each prompt should describe the pet in a different artistic style or creative scenario
          - Style variations: cute, artistic, marketable for pet owners
          - Background: The pet is isolated on empty background, no background elements, no setting, transparent background, with pet only
          - Composition: Clean, centered design that works on different product formats
          - Quality: High-contrast, bold designs that print well on merchandise
          
          IMPORTANT: Return ONLY a valid JSON array of exactly ${count} strings. No additional text, explanations, or formatting. Each string should be a complete, detailed prompt.
          
          Example format:
          ["prompt 1 text here", "prompt 2 text here", "prompt 3 text here"]

          For example:
          ---
          Count: 3,
          Theme: "Designs for different art styles"

          Result:
          [
          "Turn the provided dog photo into a high-detail vector-style digital illustration. Preserve the dog's realistic proportions and facial features, but use bold, clean shapes with sharp, well-defined edges for fur and details. Render the fur in layered strokes with visible separation between strands, using a rich, warm color palette and subtle gradients for depth. Eyes should be glossy, expressive, and outlined for emphasis. It should highlight the dog, with a polished, commercial-quality finish suitable for printing on products. The pet is isolated on empty background, no background elements, no setting, transparent background, with pet only. ",
          "Turn the provided dog photo into a minimalist continuous-line drawing in the style of the reference image. Use clean, smooth, unbroken black lines to outline the dog's head and facial features. Keep details minimal but expressive, with slight line variations to show wrinkles, ear shapes, and eyes. No shading, not areas of black, no color, and no background — just simple, elegant line art that preserves the dog's unique facial proportions and key features. The pet is isolated on empty background, no background elements, no setting, transparent background, with pet only.",
          "Turn the provided dog photo into a soft, dreamy watercolor painting. Use loose, painterly brushstrokes with delicate blending to capture the fur's texture, while keeping the dog's proportions and facial features accurate. Apply warm, natural lighting with sunlit highlights, as if in a gentle meadow scene. Use a soft, pastel color palette with light yellows, creams, and muted greens. Surround the dog with blurred, painterly wildflowers and foliage to give an impressionistic, serene atmosphere. Maintain a hand-painted look with visible brush textures and natural color bleeding. The pet is isolated on empty background, no background elements, no setting, transparent background, with pet only."
          ]

          Now it is your turn to create ${count} prompts for the theme: "${initialPrompt}".
          ---
          Count: ${count},
          Theme: "${initialPrompt}"

          Result:
          `
        }],
        temperature: 0.8,
        max_tokens: maxTokens
      })
    })
    
    if (!response.ok) {
      const errorText = await response.text()
      console.error('OpenAI API error:', response.status, errorText)
      throw new Error(`OpenAI API error: ${response.status}`)
    }
    
    const data = await response.json()
    const content = data.choices[0].message.content.trim()

    console.log('Raw OpenAI response:', content)
    
    // Enhanced JSON parsing logic
    let prompts: string[] = []
    
    try {
      // First, try to clean and parse the content
      let cleanedContent = content
      
      // Remove any markdown code blocks
      cleanedContent = cleanedContent.replace(/```json\s*/g, '').replace(/```\s*/g, '')
      
      // Handle escaped quotes and newlines from the raw response
      cleanedContent = cleanedContent.replace(/\\"/g, '"').replace(/\\n/g, ' ')
      
      // Try to find and extract the JSON array
      const jsonMatch = cleanedContent.match(/\[[\s\S]*\]/);
      
      if (jsonMatch) {
        const jsonString = jsonMatch[0]
        console.log('Extracted JSON string:', jsonString.substring(0, 500) + '...')
        
        // Parse the JSON
        const parsedPrompts = JSON.parse(jsonString)
        
        if (Array.isArray(parsedPrompts)) {
          // Clean each prompt - remove extra quotes and trim
          prompts = parsedPrompts.map(prompt => {
            if (typeof prompt === 'string') {
              // Remove leading/trailing quotes if they exist
              return prompt.replace(/^["']|["']$/g, '').trim()
            }
            return String(prompt).trim()
          }).filter(prompt => prompt.length >= 10) // Filter out empty or too short prompts
          
          console.log(`Successfully parsed ${prompts.length} prompts`)
        }
      }
      
      // If we still don't have prompts, try alternative parsing
      if (prompts.length === 0) {
        console.log('JSON parsing failed, trying line-by-line parsing...')
        
        // Split by lines and try to extract prompts
        const lines = content.split('\n')
        const extractedPrompts = []
        
        for (const line of lines) {
          const trimmed = line.trim()
          if (trimmed && 
              !trimmed.startsWith('[') && 
              !trimmed.startsWith(']') && 
              !trimmed.includes('```') &&
              trimmed.length > 20) {
            // Clean the line
            let cleaned = trimmed.replace(/^["'],?\s*/, '').replace(/["'],?\s*$/, '')
            if (cleaned.length >= 10) {
              extractedPrompts.push(cleaned)
            }
          }
        }
        
        prompts = extractedPrompts.slice(0, count)
        console.log(`Fallback parsing extracted ${prompts.length} prompts`)
      }
      
    } catch (parseError) {
      console.error('All parsing attempts failed:', parseError)
      console.error('Content that failed to parse:', content.substring(0, 1000))
    }
    
    // Final fallback - generate simple variations if parsing completely failed
    if (prompts.length === 0) {
      console.log('Using fallback prompt generation')
      prompts = Array.from({ length: Math.min(count, 10) }, (_, i) => 
        `${initialPrompt} - artistic style variation ${i + 1}. Transform the pet photo with unique creative elements, bold colors, and professional design suitable for print merchandise. The pet is isolated on empty background, no background elements, transparent background.`
      )
    }
    
    // Ensure we don't exceed the requested count
    prompts = prompts.slice(0, count)
    
    console.log('Final prompts to return:', prompts.length, 'prompts')
    console.log('Sample prompt:', prompts[0]?.substring(0, 100) + '...')
    
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