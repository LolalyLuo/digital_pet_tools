import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { fileURLToPath } from "url";
import { dirname } from "path";

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

// Load environment variables
dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

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

// Start server
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`📱 API available at http://localhost:${PORT}/api`);
  console.log(`🏥 Health check: http://localhost:${PORT}/api/health`);
});