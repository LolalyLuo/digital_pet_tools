import { useState, useCallback, useRef, useEffect } from 'react'
import { supabase } from '../utils/supabaseClient'

export function useIterationEngine() {
  const [currentRun, setCurrentRun] = useState(null)
  const [isRunning, setIsRunning] = useState(false)
  const [currentIteration, setCurrentIteration] = useState(0)
  const [results, setResults] = useState([])
  const [error, setError] = useState(null)
  const [progress, setProgress] = useState({ completed: 0, total: 0, currentBatch: [] })
  
  const runRef = useRef(null)
  const abortController = useRef(null)

  useEffect(() => {
    return () => {
      if (abortController.current) {
        abortController.current.abort()
      }
    }
  }, [])

  const startIteration = useCallback(async (config) => {
    if (isRunning) return

    try {
      setError(null)
      setIsRunning(true)
      setCurrentIteration(0)
      setResults([])
      setProgress({ completed: 0, total: 0, currentBatch: [] })

      // Create abort controller for cancellation
      abortController.current = new AbortController()

      // Save iteration run to database
      const { data: runData, error: runError } = await supabase
        .from('iteration_runs')
        .insert({
          config_id: null, // Would be set if config was saved
          status: 'running',
          current_iteration: 0,
          total_iterations: config.iteration_settings.max_iterations,
          started_at: new Date().toISOString()
        })
        .select()
        .single()

      if (runError) throw runError

      const run = {
        ...runData,
        config
      }

      setCurrentRun(run)
      runRef.current = run

      // Start the iteration process
      await runIterationLoop(run)

    } catch (error) {
      console.error('Failed to start iteration:', error)
      setError(error.message)
      setIsRunning(false)
    }
  }, [isRunning])

  const pauseIteration = useCallback(() => {
    if (abortController.current) {
      abortController.current.abort()
    }
    setIsRunning(false)
    
    if (currentRun) {
      supabase
        .from('iteration_runs')
        .update({ status: 'paused' })
        .eq('id', currentRun.id)
        .then(() => {
          setCurrentRun(prev => prev ? { ...prev, status: 'paused' } : null)
        })
    }
  }, [currentRun])

  const stopIteration = useCallback(() => {
    if (abortController.current) {
      abortController.current.abort()
    }
    setIsRunning(false)
    
    if (currentRun) {
      supabase
        .from('iteration_runs')
        .update({ 
          status: 'completed',
          completed_at: new Date().toISOString()
        })
        .eq('id', currentRun.id)
        .then(() => {
          setCurrentRun(prev => prev ? { 
            ...prev, 
            status: 'completed', 
            completed_at: new Date().toISOString() 
          } : null)
        })
    }
  }, [currentRun])

  const runIterationLoop = async (run) => {
    const { config } = run
    const { iteration_settings, source_photo_bundles } = config
    const { max_iterations, batch_size } = iteration_settings

    try {
      // Load source photos from bundles
      const sourcePhotos = await loadSourcePhotos(source_photo_bundles)
      if (sourcePhotos.length === 0) {
        throw new Error('No source photos found in selected bundles')
      }

      let bestPrompts = [
        'A cute pet sitting in natural lighting',
        'An adorable animal with expressive eyes',
        'A playful pet in a beautiful setting'
      ] // Initial seed prompts

      for (let iteration = 1; iteration <= max_iterations; iteration++) {
        if (abortController.current?.signal.aborted) {
          break
        }

        setCurrentIteration(iteration)
        
        // Update database
        await supabase
          .from('iteration_runs')
          .update({ current_iteration: iteration })
          .eq('id', run.id)

        // Generate new prompts based on previous results
        const prompts = await generatePrompts(bestPrompts, config, iteration)
        
        // Generate images in batches
        const batchResults = await generateImageBatch(
          sourcePhotos, 
          prompts.slice(0, batch_size), 
          config
        )

        // Evaluate results
        const evaluatedResults = await evaluateResults(batchResults, config)

        // Save results to database
        await saveIterationResults(run.id, iteration, evaluatedResults)

        // Update local state
        setResults(prev => [...prev, ...evaluatedResults])
        setProgress(prev => ({
          completed: prev.completed + evaluatedResults.length,
          total: max_iterations * batch_size,
          currentBatch: evaluatedResults
        }))

        // Select best prompts for next iteration
        bestPrompts = selectBestPrompts(evaluatedResults, config)

        // Handle manual rating pause
        if (config.evaluation_criteria.type === 'manual_rating' && 
            config.evaluation_criteria.config.auto_pause) {
          setIsRunning(false)
          await supabase
            .from('iteration_runs')
            .update({ status: 'paused' })
            .eq('id', run.id)
          break
        }

        // Small delay between iterations
        await new Promise(resolve => setTimeout(resolve, 1000))
      }

      // Mark as completed if we finished all iterations
      if (iteration >= max_iterations) {
        await supabase
          .from('iteration_runs')
          .update({ 
            status: 'completed',
            completed_at: new Date().toISOString()
          })
          .eq('id', run.id)

        setCurrentRun(prev => prev ? { 
          ...prev, 
          status: 'completed',
          completed_at: new Date().toISOString()
        } : null)
      }

    } catch (error) {
      console.error('Iteration loop error:', error)
      setError(error.message)
      
      await supabase
        .from('iteration_runs')
        .update({ status: 'failed' })
        .eq('id', run.id)
        
      setCurrentRun(prev => prev ? { ...prev, status: 'failed' } : null)
    } finally {
      setIsRunning(false)
    }
  }

  const loadSourcePhotos = async (bundleNames) => {
    try {
      const { data: bundles, error } = await supabase
        .from('photo_bundles')
        .select('photo_ids')
        .in('name', bundleNames)

      if (error) throw error

      const allPhotoIds = bundles.flatMap(bundle => bundle.photo_ids)
      const uniquePhotoIds = [...new Set(allPhotoIds)]

      const { data: photos, error: photosError } = await supabase
        .from('uploaded_photos')
        .select('*')
        .in('id', uniquePhotoIds)

      if (photosError) throw photosError

      return photos.map(photo => ({
        ...photo,
        url: supabase.storage
          .from('uploaded-photos')
          .getPublicUrl(photo.file_path).data.publicUrl
      }))
    } catch (error) {
      console.error('Failed to load source photos:', error)
      return []
    }
  }

  const generatePrompts = async (basePrompts, config, iteration) => {
    const { idea_generation_method } = config
    const { type: method, config: methodConfig } = idea_generation_method

    switch (method) {
      case 'variation':
        return generateVariationPrompts(basePrompts, methodConfig)
      case 'evolutionary':
        return generateEvolutionaryPrompts(basePrompts, methodConfig)
      case 'random':
        return generateRandomPrompts(methodConfig)
      case 'chain':
        return generateChainPrompts(basePrompts, methodConfig, iteration)
      default:
        return basePrompts
    }
  }

  const generateVariationPrompts = (basePrompts, config) => {
    const variations = []
    const { variation_strength = 0.3 } = config

    // Simple variation logic - in a real implementation, this would use AI
    const modifiers = [
      'with soft lighting', 'in golden hour', 'with bokeh background',
      'portrait style', 'candid shot', 'professional photo',
      'with natural colors', 'artistic composition', 'high detail'
    ]

    basePrompts.forEach(prompt => {
      for (let i = 0; i < 3; i++) {
        const modifier = modifiers[Math.floor(Math.random() * modifiers.length)]
        variations.push(`${prompt} ${modifier}`)
      }
    })

    return variations.slice(0, 10) // Limit variations
  }

  const generateEvolutionaryPrompts = (basePrompts, config) => {
    // Placeholder for evolutionary algorithm
    return generateVariationPrompts(basePrompts, config)
  }

  const generateRandomPrompts = (config) => {
    const themes = ['cute', 'playful', 'elegant', 'funny', 'majestic']
    const subjects = ['puppy', 'kitten', 'dog', 'cat', 'pet']
    const settings = ['garden', 'park', 'home', 'studio', 'outdoor']

    const prompts = []
    for (let i = 0; i < 5; i++) {
      const theme = themes[Math.floor(Math.random() * themes.length)]
      const subject = subjects[Math.floor(Math.random() * subjects.length)]
      const setting = settings[Math.floor(Math.random() * settings.length)]
      prompts.push(`${theme} ${subject} in ${setting}`)
    }
    return prompts
  }

  const generateChainPrompts = (basePrompts, config, iteration) => {
    // Build on previous iteration results
    return basePrompts.map(prompt => `${prompt}, iteration ${iteration} enhancement`)
  }

  const generateImageBatch = async (sourcePhotos, prompts, config) => {
    const { generation_method } = config
    const results = []

    try {
      // Use existing image generation logic from TestDesign
      const response = await fetch('http://localhost:3001/api/generate-images', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          photoIds: sourcePhotos.map(p => p.id),
          prompts: prompts,
          sizes: Array(prompts.length).fill(generation_method.config.size || 'auto'),
          backgrounds: Array(prompts.length).fill(generation_method.config.background || 'opaque'),
          model: generation_method.type
        })
      })

      if (!response.ok) {
        throw new Error('Image generation failed')
      }

      const data = await response.json()
      return data.results || []
      
    } catch (error) {
      console.error('Batch generation error:', error)
      throw error
    }
  }

  const evaluateResults = async (results, config) => {
    const { evaluation_criteria } = config
    
    switch (evaluation_criteria.type) {
      case 'llm_scoring':
        return await evaluateWithLLM(results, evaluation_criteria.config)
      case 'photo_matching':
        return await evaluateWithPhotoMatching(results, evaluation_criteria.config)
      case 'manual_rating':
        return await evaluateManually(results, evaluation_criteria.config)
      default:
        return results.map(r => ({ ...r, evaluation_score: 7.0 }))
    }
  }

  const evaluateWithLLM = async (results, config) => {
    // Placeholder for LLM evaluation
    return results.map(result => ({
      ...result,
      evaluation_score: Math.random() * 4 + 6, // Mock score between 6-10
      evaluation_details: {
        criteria: {
          cuteness: Math.random() * 3 + 7,
          photo_quality: Math.random() * 3 + 7,
          overall_appeal: Math.random() * 3 + 7
        },
        feedback: 'AI-generated feedback would go here'
      }
    }))
  }

  const evaluateWithPhotoMatching = async (results, config) => {
    // Placeholder for photo matching evaluation
    return results.map(result => ({
      ...result,
      evaluation_score: Math.random() * 3 + 6,
      evaluation_details: {
        similarity_scores: {
          composition: Math.random(),
          style: Math.random(),
          content: Math.random()
        }
      }
    }))
  }

  const evaluateManually = async (results, config) => {
    // For manual rating, return results without scores
    // The UI will handle the manual rating process
    return results.map(result => ({
      ...result,
      evaluation_score: null,
      needs_manual_rating: true
    }))
  }

  const saveIterationResults = async (runId, iteration, results) => {
    const resultRecords = results.map(result => ({
      run_id: runId,
      iteration_number: iteration,
      generated_image_id: result.id,
      evaluation_score: result.evaluation_score,
      evaluation_details: result.evaluation_details
    }))

    await supabase.from('iteration_results').insert(resultRecords)
  }

  const selectBestPrompts = (results, config) => {
    const { idea_generation_method } = config
    const { keep_top_percent = 0.2 } = idea_generation_method.config

    const validResults = results.filter(r => r.evaluation_score !== null)
    if (validResults.length === 0) return []

    const sorted = validResults.sort((a, b) => b.evaluation_score - a.evaluation_score)
    const keepCount = Math.max(1, Math.floor(sorted.length * keep_top_percent))
    
    return sorted.slice(0, keepCount).map(r => r.generated_prompt || r.initial_prompt)
  }

  const resetEngine = useCallback(() => {
    if (abortController.current) {
      abortController.current.abort()
    }
    setCurrentRun(null)
    setIsRunning(false)
    setCurrentIteration(0)
    setResults([])
    setError(null)
    setProgress({ completed: 0, total: 0, currentBatch: [] })
  }, [])

  return {
    currentRun,
    isRunning,
    currentIteration,
    results,
    error,
    progress,
    startIteration,
    pauseIteration,
    stopIteration,
    resetEngine,
    clearError: () => setError(null)
  }
}