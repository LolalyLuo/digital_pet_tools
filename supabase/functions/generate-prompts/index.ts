// Follow this setup guide to integrate the Deno language server with your editor:
// https://deno.land/manual/getting_started/setup_your_environment
// This enables autocomplete, go to definition, etc.

// Setup type definitions for built-in Supabase Runtime APIs
import "jsr:@supabase/functions-js/edge-runtime.d.ts"

console.log("Hello from Functions!")

Deno.serve(async (req) => {
  try {
    const { initialPrompt, count } = await req.json()
    
    if (!initialPrompt || !count) {
      return new Response(
        JSON.stringify({ error: 'Missing required parameters' }),
        { 
          status: 400,
          headers: { "Content-Type": "application/json" }
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
          content: `Create ${count} variations of this image generation prompt: "${initialPrompt}". Each should be unique but maintain the same style/theme. Return as a JSON array of strings only, no additional text or formatting.`
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
    
    return new Response(
      JSON.stringify({ prompts }),
      { headers: { "Content-Type": "application/json" } }
    )
    
  } catch (error) {
    console.error('Function error:', error)
    return new Response(
      JSON.stringify({ error: error.message }),
      { 
        status: 500,
        headers: { "Content-Type": "application/json" }
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
