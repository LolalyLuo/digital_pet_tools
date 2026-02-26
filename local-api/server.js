// Load environment variables FIRST before any other imports
import dotenv from "dotenv";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load environment files in order (later ones override earlier ones):
// 1. Root .env.local (like frontend)
// 2. Root .env
// 3. local-api/.env (can override if needed)
dotenv.config({ path: join(__dirname, "..", ".env.local") });
dotenv.config({ path: join(__dirname, "..", ".env") });
dotenv.config(); // This will load local-api/.env and override if needed

import express from "express";
import cors from "cors";

// Import configuration
import { initializeClients, initializeDatabase } from "./config/database.js";
import { initializeAIClients } from "./config/ai.js";

// Import route modules
import imageRoutes from "./routes/imageRoutes.js";
import evaluationRoutes from "./routes/evaluationRoutes.js";
import sampleRoutes from "./routes/sampleRoutes.js";
import promptRoutes from "./routes/promptRoutes.js";
import prodRoutes from "./routes/prodRoutes.js";
import trainingRoutes from "./routes/trainingRoutes.js";
import vertexRoutes from "./routes/vertexRoutes.js";
import utilRoutes from "./routes/utilRoutes.js";
import emailRoutes from "./routes/emailRoutes.js";
import shopifyRoutes from "./routes/shopifyRoutes.js";
import printifyRoutes from "./routes/printifyRoutes.js";

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors());
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ extended: true, limit: "50mb" }));

// Initialize clients and database
initializeClients();
initializeAIClients();
initializeDatabase();

// Mount route modules
app.use("/api", imageRoutes);
app.use("/api", evaluationRoutes);
app.use("/api", sampleRoutes);
app.use("/api", promptRoutes);
app.use("/api/prod", prodRoutes);
app.use("/api/training", trainingRoutes);
app.use("/api/vertex-ai", vertexRoutes);
app.use("/api", utilRoutes);
app.use("/api/email", emailRoutes);
app.use("/api/shopify", shopifyRoutes);
app.use("/api/printify", printifyRoutes);

// Start server
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`📱 API available at http://localhost:${PORT}/api`);
  console.log(`🏥 Health check: http://localhost:${PORT}/api/health`);
});
