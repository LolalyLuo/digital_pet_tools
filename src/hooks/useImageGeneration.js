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
        // Try to extract JSON from the response
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
        console.error('Failed to parse prompts:', parseError)
        // Fallback to simple array
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
