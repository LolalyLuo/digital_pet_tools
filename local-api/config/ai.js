import { GoogleGenerativeAI } from "@google/generative-ai";
import OpenAI from "openai";
import {
  JobServiceClient,
  PredictionServiceClient,
} from "@google-cloud/aiplatform";
import { Storage } from "@google-cloud/storage";

let openai = null;
let genAI = null;
let jobServiceClient = null;
let predictionClient = null;
let storageClient = null;

// Initialize AI clients (called after dotenv.config())
export function initializeAIClients() {
  console.log("🔧 Initializing AI clients...");

  // Initialize OpenAI client
  openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
  });

  // Initialize Gemini client
  genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

  // Initialize Vertex AI client
  const projectId = process.env.GOOGLE_CLOUD_PROJECT_ID;
  const location = process.env.VERTEX_AI_LOCATION || "us-central1";

  console.log("📍 Project ID:", projectId);
  console.log("📍 Location:", location);

  // Initialize clients with explicit configuration
  const clientOptions = {
    projectId: projectId,
    apiEndpoint: `${location}-aiplatform.googleapis.com`,
  };

  jobServiceClient = new JobServiceClient(clientOptions);
  predictionClient = new PredictionServiceClient(clientOptions);
  storageClient = new Storage({
    projectId: projectId,
  });

  console.log("✅ AI clients initialized");
}

// Getter functions to access the clients
export function getOpenAI() {
  if (!openai) {
    throw new Error(
      "OpenAI client not initialized. Call initializeAIClients() first."
    );
  }
  return openai;
}

export function getGenAI() {
  if (!genAI) {
    throw new Error(
      "Gemini client not initialized. Call initializeAIClients() first."
    );
  }
  return genAI;
}

export function getJobServiceClient() {
  if (!jobServiceClient) {
    throw new Error(
      "Vertex AI Job Service client not initialized. Call initializeAIClients() first."
    );
  }
  return jobServiceClient;
}

export function getPredictionClient() {
  if (!predictionClient) {
    throw new Error(
      "Vertex AI Prediction client not initialized. Call initializeAIClients() first."
    );
  }
  return predictionClient;
}

export function getStorageClient() {
  if (!storageClient) {
    throw new Error(
      "Google Cloud Storage client not initialized. Call initializeAIClients() first."
    );
  }
  return storageClient;
}

// Constants
export const IMAGE_SIZE = 1024;
export const BATCH_SIZE = 3;

// Default model configurations
export const DEFAULT_MODEL_CONFIGS = {
  gemini: {
    temperature: 1.0,
    topP: 0.99,
    topK: 50,
    candidateCount: 1,
  },
  "gemini-img2img": {
    temperature: 0.9,
    topP: 0.9,
    topK: 50,
    candidateCount: 1,
  },
  openai: {
    // OpenAI doesn't use these parameters, but we can store other config here
    model: "gpt-image-1",
  },
  seedream: {
    model: "seedream-4.0",
    maxRetries: 3,
    timeout: 60000,
  },
};

// Template selection modes
export const TEMPLATE_MODE = {
  BASE: "BASE",
  EXAMPLE_ONE: "EXAMPLE_ONE",
  ALL_EXAMPLES: "ALL_EXAMPLES",
};

// Current template mode - change this to switch between modes
export const CURRENT_TEMPLATE_MODE = TEMPLATE_MODE.BASE;
