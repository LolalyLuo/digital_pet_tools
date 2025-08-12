import { useState } from 'react'
import { supabase } from '../utils/supabaseClient'

export const useImageGeneration = () => {
  const [isGeneratingPrompts, setIsGeneratingPrompts] = useState(false)
  const [isGeneratingImages, setIsGeneratingImages] = useState(false)
  const [error, setError] = useState(null)

  const generatePrompts = async (initialPrompt, count) => {
    setIsGeneratingPrompts(true)
    setError(null)
    
    try {
      // Check if Supabase is properly configured
      if (!import.meta.env.VITE_SUPABASE_URL) {
        throw new Error('Supabase not configured. Please set up your environment variables.')
      }
      
      const { data, error } = await supabase.functions.invoke('generate-prompts', {
        body: { initialPrompt, count }
      })
      
      if (error) throw error
      
      // Parse the response from OpenAI
      let prompts = []
      try {
        const content = data.prompts
        
        // If content is already an array, use it directly
        if (Array.isArray(content)) {
          prompts = content
        } else if (typeof content === 'string') {
          // Clean up the content - remove newlines and extra whitespace
          const cleanedContent = content.replace(/\\n/g, '').replace(/\\"/g, '"')
          
          // Try to extract JSON array from the cleaned content
          const jsonMatch = cleanedContent.match(/\[.*\]/s)
          if (jsonMatch) {
            prompts = JSON.parse(jsonMatch[0])
          } else {
            // Fallback: try to parse the entire content as JSON
            prompts = JSON.parse(cleanedContent)
          }
        }
        
        // Ensure we have an array and limit to requested count
        if (Array.isArray(prompts)) {
          prompts = prompts.slice(0, count)
        } else {
          throw new Error('Response is not an array')
        }
        
        console.log('Parsed prompts:', prompts)
        
      } catch (parseError) {
        console.error('Failed to parse prompts:', parseError)
        console.error('Raw content:', data.prompts)
        // Fallback to simple variations
        prompts = Array.from({ length: count }, (_, i) => `${initialPrompt} variation ${i + 1}`)
      }
      
      return prompts
    } catch (err) {
      setError(err.message)
      return []
    } finally {
      setIsGeneratingPrompts(false)
    }
  }

  const generateImages = async (photoIds, prompts) => {
    setIsGeneratingImages(true)
    setError(null)
    
    try {
      // Check if Supabase is properly configured
      if (!import.meta.env.VITE_SUPABASE_URL) {
        throw new Error('Supabase not configured. Please set up your environment variables.')
      }
      
      const { data, error } = await supabase.functions.invoke('generate-images', {
        body: { photoIds, prompts }
      })
      
      if (error) throw error
      
      return data.results || []
    } catch (err) {
      setError(err.message)
      return []
    } finally {
      setIsGeneratingImages(false)
    }
  }

  return {
    generatePrompts,
    generateImages,
    isGeneratingPrompts,
    isGeneratingImages,
    error,
    clearError: () => setError(null)
  }
}
