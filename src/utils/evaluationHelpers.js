// Evaluation helper functions for different scoring methods

export const evaluateWithLLMScoring = async (results, config) => {
  const { model, prompt, criteria, temperature, max_tokens } = config

  const evaluatedResults = []

  for (const result of results) {
    try {
      // In a real implementation, this would call the actual LLM API
      const evaluation = await mockLLMEvaluation(result, prompt, criteria)
      
      evaluatedResults.push({
        ...result,
        evaluation_score: evaluation.overall_score,
        evaluation_details: {
          criteria: evaluation.criteria_scores,
          feedback: evaluation.feedback,
          model_used: model,
          prompt_used: prompt
        }
      })
    } catch (error) {
      console.error('LLM evaluation failed for result:', result.id, error)
      evaluatedResults.push({
        ...result,
        evaluation_score: 5.0, // Default score on failure
        evaluation_details: {
          error: 'Evaluation failed',
          model_used: model
        }
      })
    }
  }

  return evaluatedResults
}

const mockLLMEvaluation = async (result, prompt, criteria) => {
  // Simulate API call delay
  await new Promise(resolve => setTimeout(resolve, 500))

  // Mock evaluation logic
  const criteria_scores = {}
  let total = 0

  criteria.forEach(criterion => {
    const score = Math.random() * 4 + 6 // Score between 6-10
    criteria_scores[criterion] = parseFloat(score.toFixed(1))
    total += score
  })

  const overall_score = total / criteria.length

  const feedback = generateMockFeedback(overall_score, criteria_scores)

  return {
    overall_score: parseFloat(overall_score.toFixed(1)),
    criteria_scores,
    feedback
  }
}

const generateMockFeedback = (overall_score, criteria_scores) => {
  const feedbacks = []

  if (overall_score >= 9) {
    feedbacks.push("Excellent image with outstanding quality.")
  } else if (overall_score >= 8) {
    feedbacks.push("Very good image with strong appeal.")
  } else if (overall_score >= 7) {
    feedbacks.push("Good image with room for improvement.")
  } else {
    feedbacks.push("Image needs significant improvement.")
  }

  // Add specific feedback based on criteria
  Object.entries(criteria_scores).forEach(([criterion, score]) => {
    if (score >= 9) {
      feedbacks.push(`Exceptional ${criterion.replace('_', ' ')}.`)
    } else if (score < 7) {
      feedbacks.push(`${criterion.replace('_', ' ')} could be enhanced.`)
    }
  })

  return feedbacks.join(' ')
}

export const evaluateWithPhotoMatching = async (results, config) => {
  const { 
    reference_photos, 
    similarity_threshold, 
    weight_composition, 
    weight_style, 
    weight_content 
  } = config

  const evaluatedResults = []

  for (const result of results) {
    try {
      const similarity_scores = await calculateImageSimilarity(
        result.public_url, 
        reference_photos
      )

      const weighted_score = (
        similarity_scores.composition * weight_composition +
        similarity_scores.style * weight_style +
        similarity_scores.content * weight_content
      )

      const final_score = weighted_score * 10 // Scale to 0-10

      evaluatedResults.push({
        ...result,
        evaluation_score: parseFloat(final_score.toFixed(1)),
        evaluation_details: {
          similarity_scores,
          weighted_score: parseFloat(weighted_score.toFixed(3)),
          threshold: similarity_threshold,
          reference_count: reference_photos.length
        }
      })
    } catch (error) {
      console.error('Photo matching evaluation failed:', error)
      evaluatedResults.push({
        ...result,
        evaluation_score: 5.0,
        evaluation_details: {
          error: 'Photo matching failed'
        }
      })
    }
  }

  return evaluatedResults
}

const calculateImageSimilarity = async (imageUrl, referencePhotos) => {
  // Mock image similarity calculation
  // In a real implementation, this would use computer vision APIs
  // like Google Vision AI, AWS Rekognition, or custom ML models
  
  await new Promise(resolve => setTimeout(resolve, 200))

  return {
    composition: Math.random() * 0.4 + 0.6, // 0.6-1.0
    style: Math.random() * 0.4 + 0.6,       // 0.6-1.0
    content: Math.random() * 0.4 + 0.6      // 0.6-1.0
  }
}

export const evaluateWithManualRating = async (results, config) => {
  // For manual rating, we don't evaluate immediately
  // Instead, we mark results as needing manual evaluation
  return results.map(result => ({
    ...result,
    evaluation_score: null,
    evaluation_details: {
      needs_manual_rating: true,
      rating_criteria: config.rating_criteria,
      rating_scale: config.rating_scale,
      require_comments: config.require_comments
    }
  }))
}

export const processManualRatings = async (results, manualRatings) => {
  // Process manual ratings submitted by the user
  return results.map(result => {
    const rating = manualRatings[result.id]
    if (!rating) return result

    // Calculate overall score from individual criteria ratings
    const criteria_values = Object.values(rating.criteria || {})
    const overall_score = criteria_values.length > 0 
      ? criteria_values.reduce((sum, val) => sum + val, 0) / criteria_values.length
      : rating.overall_score || 5.0

    return {
      ...result,
      evaluation_score: overall_score,
      evaluation_details: {
        manual_rating: true,
        criteria_scores: rating.criteria,
        comments: rating.comments,
        rated_at: new Date().toISOString()
      }
    }
  })
}

export const calculateIterationMetrics = (results) => {
  if (!results || results.length === 0) {
    return {
      total_images: 0,
      average_score: 0,
      best_score: 0,
      improvement_rate: 0,
      score_distribution: {}
    }
  }

  const validResults = results.filter(r => r.evaluation_score !== null)
  const scores = validResults.map(r => r.evaluation_score)

  const total_images = results.length
  const average_score = scores.length > 0 
    ? scores.reduce((sum, score) => sum + score, 0) / scores.length 
    : 0
  const best_score = scores.length > 0 ? Math.max(...scores) : 0

  // Calculate improvement rate between first and last iteration
  const iterations = [...new Set(results.map(r => r.iteration_number))].sort()
  let improvement_rate = 0

  if (iterations.length > 1) {
    const firstIterResults = results.filter(r => r.iteration_number === iterations[0])
    const lastIterResults = results.filter(r => r.iteration_number === iterations[iterations.length - 1])
    
    const firstAvg = firstIterResults
      .filter(r => r.evaluation_score !== null)
      .reduce((sum, r) => sum + r.evaluation_score, 0) / Math.max(1, firstIterResults.length)
    
    const lastAvg = lastIterResults
      .filter(r => r.evaluation_score !== null)
      .reduce((sum, r) => sum + r.evaluation_score, 0) / Math.max(1, lastIterResults.length)
    
    improvement_rate = lastAvg - firstAvg
  }

  // Score distribution
  const score_distribution = {}
  const ranges = ['0-2', '2-4', '4-6', '6-8', '8-10']
  ranges.forEach(range => score_distribution[range] = 0)

  scores.forEach(score => {
    if (score < 2) score_distribution['0-2']++
    else if (score < 4) score_distribution['2-4']++
    else if (score < 6) score_distribution['4-6']++
    else if (score < 8) score_distribution['6-8']++
    else score_distribution['8-10']++
  })

  return {
    total_images,
    average_score: parseFloat(average_score.toFixed(2)),
    best_score: parseFloat(best_score.toFixed(2)),
    improvement_rate: parseFloat(improvement_rate.toFixed(2)),
    score_distribution
  }
}

export const generateProgressReport = (results, config) => {
  const metrics = calculateIterationMetrics(results)
  const iterations = [...new Set(results.map(r => r.iteration_number))].sort()
  
  const iteration_progress = iterations.map(iter => {
    const iterResults = results.filter(r => r.iteration_number === iter)
    const validResults = iterResults.filter(r => r.evaluation_score !== null)
    const average = validResults.length > 0
      ? validResults.reduce((sum, r) => sum + r.evaluation_score, 0) / validResults.length
      : 0
    const best = validResults.length > 0
      ? Math.max(...validResults.map(r => r.evaluation_score))
      : 0

    return {
      iteration: iter,
      total_images: iterResults.length,
      average_score: parseFloat(average.toFixed(2)),
      best_score: parseFloat(best.toFixed(2))
    }
  })

  return {
    config_name: config.name,
    evaluation_method: config.evaluation_criteria.type,
    generation_method: config.generation_method.type,
    total_iterations: iterations.length,
    metrics,
    iteration_progress,
    generated_at: new Date().toISOString()
  }
}