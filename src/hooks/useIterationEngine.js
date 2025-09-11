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
  const sourcePhotosCache = useRef(new Map())

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
      // Load and cache source photos from bundles once
      const sourcePhotos = await loadSourcePhotos(source_photo_bundles)
      if (sourcePhotos.length === 0) {
        throw new Error('No source photos found in selected bundles')
      }
      console.log(`Loaded and cached ${sourcePhotos.length} source photos for entire iteration run`)

      let bestPrompts = [
        'A cute pet sitting in natural lighting',
        'An adorable animal with expressive eyes',
        'A playful pet in a beautiful setting'
      ] // Initial seed prompts

      let currentIterationNum = 0
      for (let iteration = 1; iteration <= max_iterations; iteration++) {
        if (abortController.current?.signal.aborted) {
          console.log('Iteration aborted by user')
          break
        }

        currentIterationNum = iteration
        setCurrentIteration(iteration)
        
        try {
          // Update database
          await supabase
            .from('iteration_runs')
            .update({ current_iteration: iteration })
            .eq('id', run.id)

          console.log(`Starting iteration ${iteration}/${max_iterations}...`)
          
          // Generate new prompts based on previous results
          const prompts = await generatePrompts(bestPrompts, config, iteration)
          console.log(`Generated ${prompts.length} prompts for iteration ${iteration}`)
          
          // Generate images in batches
          const batchResults = await generateImageBatch(
            sourcePhotos, 
            prompts.slice(0, batch_size), 
            config
          )
          console.log(`Generated ${batchResults.length} images for iteration ${iteration}`)

          // Evaluate results
          const evaluatedResults = await evaluateResults(batchResults, config)
          console.log(`Evaluated ${evaluatedResults.length} results for iteration ${iteration}`)

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
          const newBestPrompts = selectBestPrompts(evaluatedResults, config)
          if (newBestPrompts.length > 0) {
            bestPrompts = newBestPrompts
            console.log(`Selected ${bestPrompts.length} best prompts for next iteration`)
          }

          // Handle manual rating pause
          if (config.evaluation_criteria.type === 'manual_rating' && 
              config.evaluation_criteria.config?.auto_pause) {
            console.log('Pausing for manual rating')
            setIsRunning(false)
            await supabase
              .from('iteration_runs')
              .update({ status: 'paused' })
              .eq('id', run.id)
            setCurrentRun(prev => prev ? { ...prev, status: 'paused' } : null)
            break
          }

          // Progress update and small delay between iterations
          console.log(`Completed iteration ${iteration}/${max_iterations}`)
          if (iteration < max_iterations) {
            await new Promise(resolve => setTimeout(resolve, 2000))
          }
        } catch (iterationError) {
          console.error(`Error in iteration ${iteration}:`, iterationError)
          setError(`Iteration ${iteration} failed: ${iterationError.message}`)
          // Continue to next iteration instead of stopping completely
          continue
        }
      }

      // Mark as completed if we finished all iterations
      if (currentIterationNum >= max_iterations && !abortController.current?.signal.aborted) {
        console.log('All iterations completed successfully')
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
      } else if (abortController.current?.signal.aborted) {
        console.log('Iteration run was aborted')
        await supabase
          .from('iteration_runs')
          .update({ status: 'paused' })
          .eq('id', run.id)
        setCurrentRun(prev => prev ? { ...prev, status: 'paused' } : null)
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
      if (!bundleNames || bundleNames.length === 0) {
        throw new Error('No photo bundles selected')
      }

      // Create cache key from bundle names
      const cacheKey = JSON.stringify(bundleNames.sort())
      
      // Check if already cached
      if (sourcePhotosCache.current.has(cacheKey)) {
        console.log(`Using cached source photos for bundles: ${bundleNames.join(', ')}`)
        return sourcePhotosCache.current.get(cacheKey)
      }

      const { data: bundles, error } = await supabase
        .from('photo_bundles')
        .select('photo_ids')
        .in('name', bundleNames)

      if (error) throw error
      if (!bundles || bundles.length === 0) {
        throw new Error('Selected photo bundles not found')
      }

      const allPhotoIds = bundles.flatMap(bundle => bundle.photo_ids || [])
      const uniquePhotoIds = [...new Set(allPhotoIds)]

      if (uniquePhotoIds.length === 0) {
        throw new Error('No photos found in selected bundles')
      }

      const { data: photos, error: photosError } = await supabase
        .from('uploaded_photos')
        .select('*')
        .in('id', uniquePhotoIds)

      if (photosError) throw photosError
      if (!photos || photos.length === 0) {
        throw new Error('Photo files not found')
      }

      const sourcePhotos = photos.map(photo => ({
        ...photo,
        url: supabase.storage
          .from('uploaded-photos')
          .getPublicUrl(photo.file_path).data.publicUrl
      }))

      // Cache the results
      sourcePhotosCache.current.set(cacheKey, sourcePhotos)
      console.log(`Cached ${sourcePhotos.length} source photos for bundles: ${bundleNames.join(', ')}`)

      return sourcePhotos
    } catch (error) {
      console.error('Failed to load source photos:', error)
      throw error
    }
  }

  const generatePrompts = async (basePrompts, config, iteration) => {
    const { idea_generation_method } = config
    const { type: method, config: methodConfig } = idea_generation_method

    switch (method) {
      case 'variation':
        return await generateVariationPrompts(basePrompts, methodConfig)
      case 'evolutionary':
        return await generateEvolutionaryPrompts(basePrompts, methodConfig)
      case 'random':
        return await generateRandomPrompts(methodConfig)
      case 'chain':
        return await generateChainPrompts(basePrompts, methodConfig, iteration)
      default:
        return basePrompts
    }
  }

  const generateVariationPrompts = async (basePrompts, config) => {
    try {
      const { variation_strength = 0.3 } = config
      
      // Call AI service to generate prompt variations
      const response = await fetch('http://localhost:3001/api/generate-prompt-variations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          basePrompts,
          variationStrength: variation_strength,
          count: 10
        })
      })

      if (!response.ok) {
        throw new Error('Failed to generate prompt variations')
      }

      const data = await response.json()
      return data.variations || basePrompts
    } catch (error) {
      console.error('Failed to generate variations, using fallback:', error)
      
      // Fallback to simple variation logic
      const variations = []
      const modifiers = [
        'with soft lighting', 'in golden hour', 'with bokeh background',
        'portrait style', 'candid shot', 'professional photo',
        'with natural colors', 'artistic composition', 'high detail',
        'vibrant colors', 'shallow depth of field', 'cinematic lighting'
      ]

      basePrompts.forEach(prompt => {
        for (let i = 0; i < 3; i++) {
          const modifier = modifiers[Math.floor(Math.random() * modifiers.length)]
          variations.push(`${prompt} ${modifier}`)
        }
      })

      return variations.slice(0, 10)
    }
  }

  const generateEvolutionaryPrompts = async (basePrompts, config) => {
    try {
      const { keep_top_percent = 0.2, mutation_rate = 0.1 } = config
      
      // Call AI service for evolutionary prompt generation
      const response = await fetch('http://localhost:3001/api/generate-evolutionary-prompts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          parentPrompts: basePrompts,
          keepTopPercent: keep_top_percent,
          mutationRate: mutation_rate,
          count: 10
        })
      })

      if (!response.ok) {
        throw new Error('Failed to generate evolutionary prompts')
      }

      const data = await response.json()
      return data.prompts || basePrompts
    } catch (error) {
      console.error('Failed to generate evolutionary prompts, using variations:', error)
      return await generateVariationPrompts(basePrompts, config)
    }
  }

  const generateRandomPrompts = async (config) => {
    try {
      // Call AI service for creative random prompts
      const response = await fetch('http://localhost:3001/api/generate-random-prompts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          count: 10,
          category: 'pet_photography'
        })
      })

      if (!response.ok) {
        throw new Error('Failed to generate random prompts')
      }

      const data = await response.json()
      return data.prompts || []
    } catch (error) {
      console.error('Failed to generate random prompts, using fallback:', error)
      
      // Fallback to local generation
      const themes = ['cute', 'playful', 'elegant', 'funny', 'majestic', 'adorable', 'charming']
      const subjects = ['puppy', 'kitten', 'dog', 'cat', 'pet', 'furry friend']
      const settings = ['garden', 'park', 'home', 'studio', 'outdoor', 'cozy room', 'sunny field']
      const styles = ['portrait', 'candid', 'artistic', 'professional', 'natural']

      const prompts = []
      for (let i = 0; i < 8; i++) {
        const theme = themes[Math.floor(Math.random() * themes.length)]
        const subject = subjects[Math.floor(Math.random() * subjects.length)]
        const setting = settings[Math.floor(Math.random() * settings.length)]
        const style = styles[Math.floor(Math.random() * styles.length)]
        prompts.push(`${theme} ${subject} in ${setting}, ${style} photography`)
      }
      return prompts
    }
  }

  const generateChainPrompts = async (basePrompts, config, iteration) => {
    try {
      // Call AI service for chained prompt generation
      const response = await fetch('http://localhost:3001/api/generate-chain-prompts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          basePrompts,
          iteration,
          config
        })
      })

      if (!response.ok) {
        throw new Error('Failed to generate chain prompts')
      }

      const data = await response.json()
      return data.prompts || basePrompts
    } catch (error) {
      console.error('Failed to generate chain prompts, using enhancement:', error)
      
      // Fallback logic
      const enhancements = [
        'enhanced detail', 'improved composition', 'better lighting',
        'refined style', 'optimized appeal', 'artistic refinement'
      ]
      
      return basePrompts.map(prompt => {
        const enhancement = enhancements[Math.floor(Math.random() * enhancements.length)]
        return `${prompt}, ${enhancement} (iteration ${iteration})`
      })
    }
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
    try {
      const { model = 'gpt-4', scoring_prompt, criteria = [] } = config
      const evaluatedResults = []

      for (const result of results) {
        try {
          // Call LLM evaluation API
          const response = await fetch('http://localhost:3001/api/evaluate-image', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              imageUrl: result.image_url,
              prompt: scoring_prompt,
              criteria: criteria,
              model: model,
              temperature: config.temperature || 0.3,
              maxTokens: config.max_tokens || 50
            })
          })

          if (!response.ok) {
            throw new Error(`LLM evaluation failed: ${response.statusText}`)
          }

          const evaluation = await response.json()
          
          evaluatedResults.push({
            ...result,
            evaluation_score: evaluation.overall_score,
            evaluation_details: {
              criteria: evaluation.criteria_scores || {},
              feedback: evaluation.feedback || 'No feedback provided',
              model_used: model,
              timestamp: new Date().toISOString()
            }
          })
        } catch (error) {
          console.error(`Failed to evaluate result ${result.id}:`, error)
          // Fallback to a neutral score if evaluation fails
          evaluatedResults.push({
            ...result,
            evaluation_score: 5.0,
            evaluation_details: {
              error: error.message,
              fallback: true,
              timestamp: new Date().toISOString()
            }
          })
        }
      }

      return evaluatedResults
    } catch (error) {
      console.error('LLM evaluation failed:', error)
      // Return results with fallback scores
      return results.map(result => ({
        ...result,
        evaluation_score: 5.0,
        evaluation_details: {
          error: error.message,
          fallback: true
        }
      }))
    }
  }

  const evaluateWithPhotoMatching = async (results, config) => {
    try {
      const { target_images = [], similarity_threshold = 0.7 } = config
      const evaluatedResults = []

      for (const result of results) {
        try {
          // Call photo matching API
          const response = await fetch('http://localhost:3001/api/evaluate-photo-similarity', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              generatedImageUrl: result.image_url,
              targetImages: target_images,
              threshold: similarity_threshold
            })
          })

          if (!response.ok) {
            throw new Error(`Photo matching failed: ${response.statusText}`)
          }

          const evaluation = await response.json()
          
          evaluatedResults.push({
            ...result,
            evaluation_score: evaluation.overall_similarity * 10, // Convert to 1-10 scale
            evaluation_details: {
              similarity_scores: evaluation.similarity_scores || {},
              best_match: evaluation.best_match,
              threshold_met: evaluation.overall_similarity >= similarity_threshold,
              timestamp: new Date().toISOString()
            }
          })
        } catch (error) {
          console.error(`Failed to evaluate photo similarity for ${result.id}:`, error)
          // Fallback score
          evaluatedResults.push({
            ...result,
            evaluation_score: 6.0,
            evaluation_details: {
              error: error.message,
              fallback: true,
              timestamp: new Date().toISOString()
            }
          })
        }
      }

      return evaluatedResults
    } catch (error) {
      console.error('Photo matching evaluation failed:', error)
      // Return results with fallback scores
      return results.map(result => ({
        ...result,
        evaluation_score: 6.0,
        evaluation_details: {
          error: error.message,
          fallback: true
        }
      }))
    }
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
    try {
      if (!results || results.length === 0) {
        console.warn(`No results to save for iteration ${iteration}`)
        return
      }

      const resultRecords = results.map(result => ({
        run_id: runId,
        iteration_number: iteration,
        generated_image_id: result.id,
        evaluation_score: result.evaluation_score,
        evaluation_details: result.evaluation_details || {}
      }))

      const { error } = await supabase.from('iteration_results').insert(resultRecords)
      if (error) {
        throw error
      }
      
      console.log(`Saved ${resultRecords.length} results for iteration ${iteration}`)
    } catch (error) {
      console.error(`Failed to save iteration results for iteration ${iteration}:`, error)
      throw error
    }
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

  const loadIterationResults = useCallback(async (runId) => {
    try {
      const { data: savedResults, error } = await supabase
        .from('iteration_results')
        .select(`
          *,
          generated_images!inner(
            id,
            image_url,
            generated_prompt,
            initial_prompt,
            created_at
          )
        `)
        .eq('run_id', runId)
        .order('iteration_number', { ascending: true })

      if (error) throw error

      const formattedResults = savedResults.map(result => ({
        id: result.generated_image_id,
        iteration_number: result.iteration_number,
        image_url: result.generated_images?.image_url,
        prompt: result.generated_images?.generated_prompt || result.generated_images?.initial_prompt,
        evaluation_score: result.evaluation_score,
        evaluation_details: result.evaluation_details,
        created_at: result.generated_images?.created_at
      }))

      setResults(formattedResults)
      return formattedResults
    } catch (error) {
      console.error('Failed to load iteration results:', error)
      setError(`Failed to load results: ${error.message}`)
      return []
    }
  }, [])

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
    sourcePhotosCache.current.clear()
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
    loadIterationResults,
    clearError: () => setError(null)
  }
}