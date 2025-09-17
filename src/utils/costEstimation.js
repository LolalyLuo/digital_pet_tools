// Gemini 2.5 Flash Image Preview pricing (as of 2025)
// This is the only model used in our cloud function
const GEMINI_PRICING = {
  input: 0.075,    // $0.075 per 1M input tokens
  output: 0.30,    // $0.30 per 1M output tokens
  imageGeneration: 0.0025  // $0.0025 per image generated
};

// Vertex AI Prompt Optimizer additional costs
const VERTEX_AI_COSTS = {
  jobExecution: 0.05,  // Estimated $0.05 per optimization step
  cloudFunctionCalls: 0.0000004,  // $0.0000004 per invocation
  cloudStorage: 0.02   // $0.02 per GB-month (minimal for temporary storage)
};

// Token estimation constants
const TOKEN_ESTIMATES = {
  averagePromptTokens: 50,        // Average tokens in a prompt
  averageImageDescriptionTokens: 200,  // Tokens for image description
  evaluationPromptTokens: 1500,   // Tokens in evaluation prompt template
  responseTokens: 800             // Average response tokens from evaluation
};

export function estimateOptimizationCost({
  trainingDataCount = 0,
  optimizationSteps = 20,
  model // model parameter ignored - we only use one model
}) {
  const pricing = GEMINI_PRICING;

  // Cost breakdown
  const costs = {};

  // 1. Training data processing costs
  // Each training sample needs description generation (2 images per sample)
  const descriptionGenerationCosts = trainingDataCount * 2 * pricing.imageGeneration;
  costs.trainingDataProcessing = descriptionGenerationCosts;

  // 2. Image generation costs during optimization
  // Each step generates images for each training sample
  const imageGenerationCount = optimizationSteps * trainingDataCount;
  costs.imageGeneration = imageGenerationCount * pricing.imageGeneration;

  // 3. Evaluation costs
  // Each generated image is evaluated using Gemini vision
  const evaluationTokensPerCall = TOKEN_ESTIMATES.evaluationPromptTokens + TOKEN_ESTIMATES.responseTokens;
  const totalEvaluationTokens = imageGenerationCount * evaluationTokensPerCall;
  costs.evaluation = (totalEvaluationTokens / 1000000) * (pricing.input + pricing.output);

  // 4. Vertex AI infrastructure costs
  costs.vertexAIJobExecution = optimizationSteps * VERTEX_AI_COSTS.jobExecution;

  // 5. Cloud Function execution costs (evaluation calls)
  costs.cloudFunctionCalls = imageGenerationCount * VERTEX_AI_COSTS.cloudFunctionCalls;

  // 6. Cloud Storage costs (minimal for temporary files)
  costs.cloudStorage = VERTEX_AI_COSTS.cloudStorage * 0.1; // Estimate 0.1 GB for a day

  // Calculate totals
  const totalCost = Object.values(costs).reduce((sum, cost) => sum + cost, 0);

  return {
    breakdown: {
      trainingDataProcessing: costs.trainingDataProcessing,
      imageGeneration: costs.imageGeneration,
      evaluation: costs.evaluation,
      vertexAIJobExecution: costs.vertexAIJobExecution,
      cloudFunctionCalls: costs.cloudFunctionCalls,
      cloudStorage: costs.cloudStorage
    },
    totalCost,
    estimatedDuration: calculateEstimatedDuration(optimizationSteps, trainingDataCount),
    currency: 'USD',
    calculations: {
      trainingDataCount,
      optimizationSteps,
      imageGenerationCount,
      totalEvaluationCalls: imageGenerationCount,
      estimatedTokenUsage: totalEvaluationTokens
    }
  };
}

export function formatCost(cost) {
  if (cost < 0.01) {
    return `$${(cost * 100).toFixed(2)}¢`;
  }
  return `$${cost.toFixed(2)}`;
}

export function getModelDisplayName(model) {
  // We only use one model, so always return the same display name
  return 'Gemini 2.5 Flash Image Preview';
}

function calculateEstimatedDuration(optimizationSteps, trainingDataCount) {
  // Based on real data:
  // - 6 images, 1 step = 15 minutes
  // - 40 steps = 90 minutes (1.5 hours)
  // - Time per step: ~2.25 minutes (independent of image count due to parallel processing)

  const setupTime = 12; // Initial setup overhead (15 min total - 2.25 min step = ~12 min setup)
  const timePerStep = 2.25; // minutes per optimization step

  const totalMinutes = setupTime + (optimizationSteps * timePerStep);
  const bufferMinutes = Math.ceil(totalMinutes * 1.2); // Add 20% buffer

  // Format the duration string
  if (totalMinutes < 60) {
    return `${Math.round(totalMinutes)}-${bufferMinutes} minutes`;
  } else {
    const hours = Math.floor(totalMinutes / 60);
    const mins = Math.round(totalMinutes % 60);
    const bufferHours = Math.floor(bufferMinutes / 60);
    const bufferMins = Math.round(bufferMinutes % 60);

    if (hours === 0) {
      return `${mins}-${bufferMins} minutes`;
    } else if (hours === bufferHours) {
      return `${hours}h ${mins}m - ${hours}h ${bufferMins}m`;
    } else {
      return `${hours}h ${mins}m - ${bufferHours}h ${bufferMins}m`;
    }
  }
}