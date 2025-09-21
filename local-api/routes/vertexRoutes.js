import express from "express";
import { getSupabase } from "../config/database.js";
import {
  getJobServiceClient,
  getPredictionClient,
  getStorageClient,
} from "../config/ai.js";
import fetch from "node-fetch";
import {
  uploadGCSImageToSupabase,
  generateImageDescription,
  generateQualitySpecification,
} from "../utils/imageUtils.js";
import { generateCloudFunctionName } from "../utils/sessionUtils.js";

const router = express.Router();

// Function to get project ID (will be called when routes are actually used)
function getProjectId() {
  const projectId = process.env.GOOGLE_CLOUD_PROJECT_ID;

  if (!projectId) {
    throw new Error(
      "❌ GOOGLE_CLOUD_PROJECT_ID environment variable is required"
    );
  }

  if (projectId === "undefined" || projectId === "null") {
    throw new Error(
      `❌ GOOGLE_CLOUD_PROJECT_ID is set to string "${projectId}" - check your environment configuration`
    );
  }

  return projectId;
}

// Function to get location (will be called when routes are actually used)
function getLocation() {
  return process.env.VERTEX_AI_LOCATION || "us-central1";
}

// Submit prompt optimization job to Google Cloud Vertex AI
router.post("/optimize", async (req, res) => {
  console.log("🎯 Vertex AI Prompt Optimizer job submission received");

  try {
    const projectId = getProjectId();
    const location = getLocation();

    const {
      trainingDataSet,
      basePrompts,
      optimizationMode = "data-driven",
      targetModel = "gemini-2.5-flash",
      evaluationMetrics = ["bleu", "rouge"],
      evaluationCriteria = "comprehensive",
      evaluationMode = "reference_comparison",
      artStyle = "cartoon",
      creativeDescription = "pet sitting happily with clean isolated background",
      numSteps = 20,
      sessionId,
    } = req.body;

    if (!trainingDataSet || !basePrompts || basePrompts.length === 0) {
      return res.status(400).json({
        error: "Missing required parameters",
        details: "trainingDataSet and basePrompts are required",
      });
    }

    console.log(`📊 Training Data Set: ${trainingDataSet}`);
    console.log(`📝 Base Prompts: ${basePrompts.length} prompts`);
    console.log(`⚙️ Optimization Mode: ${optimizationMode}`);
    console.log(`🎯 Target Model: ${targetModel}`);
    console.log(`📋 Evaluation Criteria: ${evaluationCriteria}`);
    console.log(`🔬 Evaluation Mode: ${evaluationMode}`);
    console.log(`🎨 Art Style: ${artStyle}`);
    console.log(`💡 Creative Description: ${creativeDescription}`);
    console.log(`🔢 Number of Steps: ${numSteps}`);
    console.log(`🆔 Session ID: ${sessionId}`);

    // Step 1: Format training data as JSONL inline
    console.log("📋 Formatting training data...");

    if (!trainingDataSet) {
      throw new Error("Training data set is required");
    }

    console.log(`📊 Fetching samples for data set: ${trainingDataSet}`);

    const { data: trainingSamples, error } = await getSupabase()
      .from("training_samples")
      .select("id, uploaded_image_url, openai_image_url, data_set_name")
      .eq("data_set_name", trainingDataSet)
      .order("created_at", { ascending: true });

    if (error) {
      throw new Error(`Failed to fetch training samples: ${error.message}`);
    }

    if (!trainingSamples || trainingSamples.length === 0) {
      throw new Error(
        `No training samples found for data set: ${trainingDataSet}`
      );
    }

    console.log(`📄 Found ${trainingSamples.length} training samples`);

    // Generate training data based on evaluation mode
    console.log(
      `🔍 Generating training data for ${evaluationMode} mode...`
    );

    const descriptionPromises = trainingSamples.map(async (sample) => {
      try {
        if (evaluationMode === "standalone_quality") {
          // Standalone Quality Mode: Generate pet analysis + quality specification
          console.log(`🔍 Processing sample ${sample.id} for standalone quality mode`);

          // Generate detailed pet analysis from source image
          const petAnalysis = await generateImageDescription(sample.uploaded_image_url, "pet_analysis");

          // Create quality specification target (no reference image needed)
          const qualitySpec = await generateQualitySpecification(sample.uploaded_image_url, petAnalysis, artStyle, creativeDescription);

          console.log(`✅ Processed standalone sample ${sample.id}`);
          return {
            input: `${sample.uploaded_image_url},${petAnalysis}`,
            target: `quality_specification:${qualitySpec}`,
            unique_id: `${Date.now()}_${Math.random()
              .toString(36)
              .substr(2, 9)}_sample_${sample.id}`,
          };
        } else {
          // Reference Comparison Mode: Use existing logic
          console.log(`🔍 Processing sample ${sample.id} for reference comparison mode`);

          const [sourceDescription, referenceDescription] = await Promise.all([
            generateImageDescription(sample.uploaded_image_url, "source"),
            generateImageDescription(sample.openai_image_url, "reference"),
          ]);

          console.log(`✅ Processed reference sample ${sample.id}`);
          return {
            input: `${sample.uploaded_image_url},${sourceDescription}`,
            target: `${sample.openai_image_url},${referenceDescription}`,
            unique_id: `${Date.now()}_${Math.random()
              .toString(36)
              .substr(2, 9)}_sample_${sample.id}`,
          };
        }
      } catch (error) {
        console.error(`❌ Failed to process sample ${sample.id}:`, error);
        return null; // Will be filtered out
      }
    });

    // Wait for all descriptions to complete
    const results = await Promise.all(descriptionPromises);
    const formattedSamples = results.filter((sample) => sample !== null);

    console.log(
      `📋 Successfully formatted ${formattedSamples.length} training samples with descriptions`
    );
    const jsonlData = formattedSamples
      .map((sample) => JSON.stringify(sample))
      .join("\n");

    // Step 2: Upload training data and config to Cloud Storage
    console.log("☁️ Uploading training data and config to Cloud Storage...");
    const bucketName = `vertex-ai-optimizer-${projectId}`;
    const fileName = `training-data-${Date.now()}.jsonl`;
    const configFileName = `config-${Date.now()}.json`;

    try {
      // Create bucket if it doesn't exist
      await getStorageClient()
        .createBucket(bucketName, {
          location: location,
        })
        .catch((error) => {
          if (error.code !== 5) {
            // Ignore "already exists" error
            console.warn("Bucket creation warning:", error.message);
          }
        });

      const bucket = getStorageClient().bucket(bucketName);

      // Upload JSONL training data
      const dataFile = bucket.file(fileName);
      await dataFile.save(jsonlData, {
        metadata: {
          contentType: "application/jsonl",
        },
      });

      const datasetUri = `gs://${bucketName}/${fileName}`;
      console.log(`📄 Training data uploaded: ${datasetUri}`);

      // Step 2.5: Deploy session-specific cloud function
      let cloudFunctionName;

      if (sessionId) {
        console.log("☁️ Deploying session-specific cloud function...");
        cloudFunctionName = generateCloudFunctionName(sessionId);

        // Deploy cloud function with session ID - no fallbacks
        await deploySessionCloudFunction(sessionId, cloudFunctionName, evaluationCriteria, evaluationMode);
        console.log(`✅ Cloud function deployed: ${cloudFunctionName}`);
      } else {
        throw new Error("Session ID is required for cloud function deployment");
      }

      // Create correct Vertex AI Prompt Optimizer config from Google's specification
      const outputPath = `gs://${bucketName}/results-${Date.now()}`;

      const config = {
        project: projectId,
        target_model: targetModel, // "gemini-2.5-flash" or "gemini-2.5-pro"
        target_model_location: location, // "us-central1"
        input_data_path: datasetUri,
        output_path: outputPath,
        system_instruction: basePrompts[0],
        prompt_template:
          "You are an expert at writing image editing prompts. Your task is to create an editing instruction that would transform the input image (described as: {input}) to match the desired outcome (described as: {target}).\n\nCurrent image: {input}\nDesired result: {target}\n\nCreate a clear, direct image editing prompt that tells an AI how to modify the current image to achieve the desired result. Your output should be a specific instruction focusing on what changes to make to colors, lighting, style, composition, and visual elements. Write as if giving instructions to an image editing AI that can see the current image.",
        optimization_mode: "instruction",
        num_steps: numSteps,
        num_template_eval_per_step: 1,
        eval_metric: "custom_metric",
        custom_metric_name: "image_similarity_score",
        custom_metric_cloud_function_name: cloudFunctionName, // Use session-specific function name
        target_model_qps: 10.0,
        eval_qps: 10.0,
        thinking_budget: 0,
      };

      console.log(
        `📋 Correct config created:`,
        JSON.stringify(config, null, 2)
      );

      const configFile = bucket.file(configFileName);
      await configFile.save(JSON.stringify(config, null, 2), {
        metadata: {
          contentType: "application/json",
        },
      });

      const configUri = `gs://${bucketName}/${configFileName}`;
      console.log(`📄 Config uploaded: ${configUri}`);

      // Step 3: Submit Vertex AI Prompt Optimizer job
      console.log("🚀 Submitting to Vertex AI Prompt Optimizer...");
      console.log(`🔧 Using Project: ${projectId}`);
      console.log(`🔧 Using Location: ${location}`);

      // NOTE: Vertex AI Prompt Optimizer currently requires Python SDK
      // The Node.js SDK doesn't have direct support for Prompt Optimizer
      // We'll use the Training Custom Job API as a workaround

      const parent = `projects/${projectId}/locations/${location}`;
      console.log(`🔧 Parent resource: ${parent}`);

      const customJobSpec = {
        displayName: `prompt-optimization-${Date.now()}`,
        jobSpec: {
          workerPoolSpecs: [
            {
              machineSpec: {
                machineType: "n1-standard-4",
              },
              diskSpec: {
                bootDiskType: "pd-ssd",
                bootDiskSizeGb: 100,
              },
              containerSpec: {
                // Use Vertex AI Prompt Optimizer container image
                imageUri:
                  "us-docker.pkg.dev/vertex-ai-restricted/builtin-algorithm/apd:preview_v1_0",
                args: [`--config=${configUri}`],
              },
              replicaCount: 1,
            },
          ],
        },
      };

      const request = {
        parent,
        customJob: customJobSpec,
      };

      console.log("🔄 Creating custom training job for prompt optimization...");

      try {
        const [job] = await getJobServiceClient().createCustomJob(request);
        const jobId = job.name.split("/").pop();

        console.log(`✅ Vertex AI optimization job created: ${jobId}`);

        // Store job in Supabase for persistence
        try {
          const jobRecord = {
            job_id: jobId,
            display_name: customJobSpec.displayName,
            training_data_set: trainingDataSet,
            base_prompts: basePrompts,
            optimization_mode: optimizationMode,
            target_model: targetModel,
            status: "submitted",
            vertex_job_name: job.name,
            vertex_job_state: job.state || "JOB_STATE_PENDING",
            session_id: sessionId,
            cloud_function_name: cloudFunctionName,
          };

          const { data: insertedJob, error: insertError } = await getSupabase()
            .from("vertex_ai_jobs")
            .insert(jobRecord)
            .select()
            .single();

          if (insertError) {
            console.error("❌ Failed to store job in Supabase:", insertError);
          } else {
            console.log(`💾 Job stored in Supabase with ID: ${insertedJob.id}`);
          }
        } catch (supabaseError) {
          console.error("❌ Supabase job storage error:", supabaseError);
        }

        res.json({
          jobId: jobId,
          status: "submitted",
          trainingDataSet,
          basePrompts: basePrompts.length,
          optimizationMode,
          targetModel,
          evaluationMetrics,
          datasetUri,
          estimatedCompletionTime: "10-30 minutes",
          timestamp: new Date().toISOString(),
          message: "Job submitted successfully to Vertex AI",
        });
      } catch (vertexError) {
        console.error("❌ Vertex AI job creation error:", vertexError);
        throw new Error(
          `Vertex AI job creation failed: ${vertexError.message}`
        );
      }
    } catch (storageError) {
      console.error("❌ Cloud Storage error:", storageError);
      throw new Error(`Cloud Storage failed: ${storageError.message}`);
    }
  } catch (error) {
    console.error("❌ Vertex AI optimization job submission error:", error);
    res.status(500).json({
      error: "Optimization job submission failed",
      details: error.message,
      timestamp: new Date().toISOString(),
    });
  }
});

// Get all jobs from Supabase
router.get("/jobs", async (req, res) => {
  try {
    const projectId = getProjectId();
    const location = getLocation();
    const { data: jobs, error } = await getSupabase()
      .from("vertex_ai_jobs")
      .select("*")
      .order("created_at", { ascending: false });

    if (error) {
      console.error("❌ Failed to fetch jobs from Supabase:", error);
      return res
        .status(500)
        .json({ error: "Failed to fetch jobs", details: error.message });
    }

    // Format jobs for UI - fetch totalSteps from GCS config for each job
    const formattedJobs = await Promise.all(
      jobs.map(async (job) => {
        let totalSteps = undefined;

        // Try to get totalSteps and currentStep from GCS config if we have a jobId
        let currentStep = 0;
        if (job.job_id) {
          try {
            const jobName = `projects/${projectId}/locations/${location}/customJobs/${job.job_id}`;
            const [vertexJob] = await getJobServiceClient().getCustomJob({
              name: jobName,
            });

            const args =
              vertexJob.jobSpec?.workerPoolSpecs?.[0]?.containerSpec?.args ||
              [];
            const configArg = args.find((arg) =>
              arg.startsWith("--config=gs://")
            );

            if (configArg) {
              const configPath = configArg.replace("--config=", "");
              const gcsMatch = configPath.match(/^gs:\/\/([^\/]+)\/(.+)$/);
              if (gcsMatch) {
                const [, bucketName, fileName] = gcsMatch;
                const storageClientInstance = getStorageClient();
                const file = storageClientInstance
                  .bucket(bucketName)
                  .file(fileName);
                const [configData] = await file.download();
                const config = JSON.parse(configData.toString());
                totalSteps = config.num_steps;

                // Check output directory for current step from templates.json
                const outputPath = config.output_path;
                if (outputPath) {
                  const outputMatch = outputPath.match(
                    /^gs:\/\/([^\/]+)\/(.+)$/
                  );
                  if (outputMatch) {
                    const [, outputBucket, outputPrefix] = outputMatch;
                    try {
                      const bucket = storageClientInstance.bucket(outputBucket);
                      const [files] = await bucket.getFiles({
                        prefix: outputPrefix,
                      });

                      const templatesFile = files.find((f) =>
                        f.name.endsWith("templates.json")
                      );
                      if (templatesFile) {
                        try {
                          const [templatesData] =
                            await templatesFile.download();
                          const templates = JSON.parse(
                            templatesData.toString()
                          );
                          currentStep =
                            templates.length > 0
                              ? Math.max(...templates.map((t) => t.step))
                              : 0;
                        } catch (e) {
                          // Silent fail for templates.json parsing
                        }
                      }
                    } catch (e) {
                      // Silent fail for output directory check
                    }
                  }
                }
              }
            }
          } catch (e) {
            console.log(
              `⚠️ Could not fetch config for job ${job.job_id}: ${e.message}`
            );
          }
        }

        return {
          jobId: job.job_id,
          status: job.status,
          progress: job.progress,
          message: job.message,
          trainingDataSet: job.training_data_set,
          basePrompts: Array.isArray(job.base_prompts)
            ? job.base_prompts.length
            : 1,
          optimizationMode: job.optimization_mode,
          targetModel: job.target_model,
          submittedAt: new Date(job.created_at).toLocaleString(),
          lastChecked: job.updated_at
            ? new Date(job.updated_at).toLocaleString()
            : null,
          startedAt: job.started_at
            ? new Date(job.started_at).toLocaleString()
            : null,
          completedAt: job.completed_at
            ? new Date(job.completed_at).toLocaleString()
            : null,
          totalSteps: totalSteps,
          currentStep: currentStep,
        };
      })
    );

    res.json({ jobs: formattedJobs });
  } catch (err) {
    console.error("❌ Error fetching jobs:", err);
    res
      .status(500)
      .json({ error: "Internal server error", details: err.message });
  }
});

// Get optimization job status
router.get("/jobs/:jobId", async (req, res) => {
  try {
    const projectId = getProjectId();
    const location = getLocation();
    const { jobId } = req.params;

    // Query Vertex AI for job status
    const jobName = `projects/${projectId}/locations/${location}/customJobs/${jobId}`;

    try {
      const [job] = await getJobServiceClient().getCustomJob({ name: jobName });

      // Extract and log config from GCS
      let totalSteps;
      let currentStep = 0;
      try {
        const args =
          job.jobSpec?.workerPoolSpecs?.[0]?.containerSpec?.args || [];
        const configArg = args.find((arg) => arg.startsWith("--config=gs://"));

        if (configArg) {
          const configPath = configArg.replace("--config=", "");

          // Parse GCS path: gs://bucket/path
          const gcsMatch = configPath.match(/^gs:\/\/([^\/]+)\/(.+)$/);
          if (gcsMatch) {
            const [, bucketName, fileName] = gcsMatch;

            // Fetch config from Google Cloud Storage
            const storageClientInstance = getStorageClient();

            const file = storageClientInstance
              .bucket(bucketName)
              .file(fileName);
            const [configData] = await file.download();
            const config = JSON.parse(configData.toString());

            totalSteps = config.num_steps;

            // Check output directory for step progress files
            const outputPath = config.output_path;
            if (outputPath) {
              const outputMatch = outputPath.match(/^gs:\/\/([^\/]+)\/(.+)$/);
              if (outputMatch) {
                const [, outputBucket, outputPrefix] = outputMatch;

                try {
                  const bucket = storageClientInstance.bucket(outputBucket);
                  const [files] = await bucket.getFiles({
                    prefix: outputPrefix,
                  });

                  // Check templates.json for step information
                  const templatesFile = files.find((f) =>
                    f.name.endsWith("templates.json")
                  );
                  if (templatesFile) {
                    try {
                      const [templatesData] = await templatesFile.download();
                      const templates = JSON.parse(templatesData.toString());

                      // Get the current step count from the highest step number
                      currentStep =
                        templates.length > 0
                          ? Math.max(...templates.map((t) => t.step))
                          : 0;
                    } catch (e) {
                      console.log(
                        `⚠️ Could not read templates.json: ${e.message}`
                      );
                    }
                  }
                } catch (e) {
                  console.log(`⚠️ Could not list output files: ${e.message}`);
                }
              }
            }
          }
        }
      } catch (e) {
        console.log(`⚠️ Could not fetch config from GCS: ${e.message}`);
      }

      let status,
        progress = 0;

      // Map Vertex AI job states to our status
      switch (job.state) {
        case "JOB_STATE_QUEUED":
        case "JOB_STATE_PENDING":
          status = "queued";
          progress = 0;
          break;
        case "JOB_STATE_RUNNING":
          status = "running";
          // Estimate progress based on start time
          if (job.startTime) {
            const startTime = new Date(job.startTime.seconds * 1000);
            const elapsed = Date.now() - startTime.getTime();
            const estimated = 20 * 60 * 1000; // 20 minutes estimated
            progress = Math.min(Math.floor((elapsed / estimated) * 95), 95);
          } else {
            progress = 10;
          }
          break;
        case "JOB_STATE_SUCCEEDED":
          status = "completed";
          progress = 100;
          break;
        case "JOB_STATE_FAILED":
          status = "failed";
          progress = 0;
          break;
        case "JOB_STATE_CANCELLED":
          status = "cancelled";
          progress = 0;
          break;
        default:
          status = "unknown";
          progress = 0;
      }

      const response = {
        jobId,
        status,
        progress,
        currentStep,
        totalSteps,
        state: job.state,
        displayName: job.displayName,
        createTime: job.createTime,
        startTime: job.startTime,
        endTime: job.endTime,
        timestamp: new Date().toISOString(),
      };

      // Add error details if failed
      if (job.state === "JOB_STATE_FAILED") {
        response.error = {
          code: job.error?.code || "UNKNOWN",
          message: job.error?.message || "No error message available",
          details: job.error?.details || [],
        };

        // Add job logs and additional debugging info
        response.debugging = {
          jobSpec: job.jobSpec,
          startTime: job.startTime,
          endTime: job.endTime,
          labels: job.labels,
        };

        console.error(`❌ Job ${jobId} failed:`, {
          error: response.error,
          jobName: job.name,
          displayName: job.displayName,
        });
      }

      // Update job status in Supabase
      try {
        const updateData = {
          status,
          progress,
          vertex_job_state: job.state,
          updated_at: new Date().toISOString(),
        };

        if (job.startTime && !job.endTime) {
          updateData.started_at = new Date(
            job.startTime.seconds * 1000
          ).toISOString();
        }

        if (job.endTime) {
          updateData.completed_at = new Date(
            job.endTime.seconds * 1000
          ).toISOString();
        }

        if (job.state === "JOB_STATE_FAILED" && job.error) {
          updateData.message = `Failed: ${
            job.error.message || "Unknown error"
          }`;
        }

        const { error: updateError } = await getSupabase()
          .from("vertex_ai_jobs")
          .update(updateData)
          .eq("job_id", jobId);

        if (updateError) {
          console.error("❌ Failed to update job in Supabase:", updateError);
        }
      } catch (supabaseError) {
        console.error("❌ Supabase job update error:", supabaseError);
      }

      res.json(response);
    } catch (jobError) {
      if (jobError.code === 5) {
        // NOT_FOUND
        console.log(`❓ Job ${jobId} not found`);
        res.status(404).json({
          error: "Job not found",
          details: `Job ${jobId} does not exist`,
          timestamp: new Date().toISOString(),
        });
      } else {
        throw jobError;
      }
    }
  } catch (error) {
    console.error("❌ Vertex AI job status check error:", error);
    res.status(500).json({
      error: "Job status check failed",
      details: error.message,
      timestamp: new Date().toISOString(),
    });
  }
});

// Get detailed job logs and debugging information
router.get("/jobs/:jobId/logs", async (req, res) => {
  console.log("🔍 Fetching detailed job logs");

  try {
    const projectId = getProjectId();
    const location = getLocation();
    const { jobId } = req.params;
    const jobName = `projects/${projectId}/locations/${location}/customJobs/${jobId}`;

    try {
      const [job] = await getJobServiceClient().getCustomJob({ name: jobName });

      // Return comprehensive job information
      const jobDetails = {
        jobId,
        name: job.name,
        displayName: job.displayName,
        state: job.state,
        createTime: job.createTime,
        startTime: job.startTime,
        endTime: job.endTime,
        updateTime: job.updateTime,
        error: job.error || null,
        jobSpec: job.jobSpec,
        labels: job.labels || {},
        encryptionSpec: job.encryptionSpec || null,
        webAccessUris: job.webAccessUris || {},
      };

      console.log("📋 Full job details:", JSON.stringify(jobDetails, null, 2));

      res.json({
        success: true,
        jobDetails,
        timestamp: new Date().toISOString(),
      });
    } catch (jobError) {
      if (jobError.code === 5) {
        // NOT_FOUND
        res.status(404).json({
          error: "Job not found",
          details: `Job ${jobId} does not exist`,
          timestamp: new Date().toISOString(),
        });
      } else {
        throw jobError;
      }
    }
  } catch (error) {
    console.error("❌ Failed to fetch job logs:", error);
    res.status(500).json({
      error: "Failed to fetch job logs",
      details: error.message,
      timestamp: new Date().toISOString(),
    });
  }
});

// Get optimization results
router.get("/results/:jobId", async (req, res) => {
  console.log("📋 Vertex AI optimization results request received");

  try {
    const projectId = getProjectId();
    const location = getLocation();
    const { jobId } = req.params;

    console.log(`📄 Getting results for job: ${jobId}`);

    // First, check if the job is completed in our database
    const { data: jobData, error: jobError } = await getSupabase()
      .from("vertex_ai_jobs")
      .select("*")
      .eq("job_id", jobId)
      .single();

    if (jobError) {
      console.error("❌ Failed to fetch job from Supabase:", jobError);
      return res
        .status(404)
        .json({ error: "Job not found", details: jobError.message });
    }

    if (jobData.status !== "completed") {
      return res.status(400).json({
        error: "Job not completed",
        status: jobData.status,
        message: "Job must be completed before results can be retrieved",
      });
    }

    // Clear cached results and always re-fetch from Cloud Storage for debugging
    // TODO: Re-enable caching once results parsing is working correctly
    console.log(
      `🔄 Re-fetching results from Cloud Storage for job: ${jobId} (caching disabled for debugging)`
    );

    // Uncomment below to use cached results:
    // if (jobData.optimized_prompts) {
    //   console.log(`📋 Returning cached results for job: ${jobId}`);
    //   return res.json({
    //     jobId,
    //     status: 'completed',
    //     originalPrompts: jobData.base_prompts,
    //     optimizedPrompts: jobData.optimized_prompts,
    //     performanceMetrics: jobData.performance_metrics || {
    //       averageImprovement: "Unknown",
    //       bleuScore: 0,
    //       rougeScore: 0
    //     },
    //     completedAt: jobData.completed_at,
    //   });
    // }

    // Try to fetch results from Vertex AI job output locations
    try {
      const bucketName = `vertex-ai-optimizer-${projectId}`;

      // List all results directories to find the matching one
      const bucket = getStorageClient().bucket(bucketName);
      const [files] = await bucket.getFiles({ prefix: "results-" });

      let foundResults = null;
      let resultTimestamp = null;

      // Get job creation time from database to match with results
      const jobCreatedTime = new Date(jobData.created_at).getTime();
      console.log(
        `🕐 Job ${jobId} created at: ${jobData.created_at} (${jobCreatedTime})`
      );

      // Look for results directories and find one that matches this job by timestamp
      let bestMatch = null;
      let smallestTimeDiff = Infinity;

      for (const file of files) {
        const fileName = file.name;

        // Check if this is an optimized_results.json file
        if (fileName.endsWith("/instruction/optimized_results.json")) {
          // Extract timestamp from path (results-{timestamp}/instruction/...)
          const timestampMatch = fileName.match(/results-(\d+)\//);
          if (timestampMatch) {
            const resultTimestamp = parseInt(timestampMatch[1]);
            const timeDiff = Math.abs(resultTimestamp - jobCreatedTime);

            console.log(
              `📊 Checking result file: ${fileName}`
            );
            console.log(
              `   Result timestamp: ${resultTimestamp} (${new Date(resultTimestamp).toISOString()})`
            );
            console.log(
              `   Job created time: ${jobCreatedTime} (${new Date(jobCreatedTime).toISOString()})`
            );
            console.log(
              `   Time difference: ${timeDiff}ms (${(timeDiff / (1000 * 60)).toFixed(1)} minutes)`
            );

            // Find the closest match within 24 hours
            if (timeDiff < smallestTimeDiff && timeDiff < 24 * 60 * 60 * 1000) {
              console.log(
                `   ✅ New best match! Previous best diff: ${smallestTimeDiff}ms, new diff: ${timeDiff}ms`
              );
              smallestTimeDiff = timeDiff;
              bestMatch = { fileName, resultTimestamp };
            } else {
              console.log(
                `   ❌ Not a better match. Current best: ${smallestTimeDiff}ms`
              );
            }
          }
        }
      }

      if (bestMatch) {
        const { fileName, resultTimestamp: matchedTimestamp } = bestMatch;
        console.log(
          `🎯 Best timestamp match for job ${jobId}: ${fileName} (diff: ${smallestTimeDiff}ms)`
        );

        // Process the matched results file
        try {
          console.log(`🔍 Processing matched file: ${fileName}`);
          const file = bucket.file(fileName);
          const [contents] = await file.download();
          const optimizedData = JSON.parse(contents.toString());

          // Also get the eval results for additional data
          const evalFileName = fileName.replace(
            "optimized_results.json",
            "eval_results.json"
          );
          const evalFile = bucket.file(evalFileName);
          const [evalExists] = await evalFile.exists();

          let evalData = null;
          if (evalExists) {
            const [evalContents] = await evalFile.download();
            evalData = JSON.parse(evalContents.toString());
          }

          resultTimestamp = matchedTimestamp;

          // Parse all optimization attempts and their results
          const allMetrics = {};
          console.log(`🔍 Building prompt evolution timeline directly from evaluation data...`);
          console.log(`📝 Original base prompt: "${jobData.base_prompts}"`);
          console.log(`🎯 Final optimized prompt: "${optimizedData.prompt}"`);

          const optimizedPrompts = [];
          let stepCounter = 0;

          // Parse evaluation data to get all attempted prompts and their scores
          const originalPrompt = Array.isArray(jobData.base_prompts) ? jobData.base_prompts[0] : jobData.base_prompts;
          if (evalData && Array.isArray(evalData)) {
            for (const evalSet of evalData) {
              if (evalSet.summary_results) {
                // Store overall metrics
                const setMetrics = evalSet.summary_results;
                for (const [key, value] of Object.entries(setMetrics)) {
                  if (key !== "row_count") {
                    allMetrics[key] = value;
                  }
                }
              }

              // Parse individual prompt attempts from metrics_table
              if (evalSet.metrics_table) {
                try {
                  const metricsTable = JSON.parse(evalSet.metrics_table);
                  console.log(`🔍 Processing ${metricsTable.length} evaluation entries`);

                  // Group by unique prompts to see evolution
                  const promptAttempts = new Map();

                  for (const entry of metricsTable) {
                    const prompt = entry.prompt;
                    if (prompt) {
                      if (!promptAttempts.has(prompt)) {
                        promptAttempts.set(prompt, {
                          prompt: prompt,
                          scores: [],
                          samples: [],
                          avgScore: 0,
                        });
                      }

                      const attempt = promptAttempts.get(prompt);
                      if (entry["image_similarity_score/score"] !== undefined) {
                        attempt.scores.push(entry["image_similarity_score/score"]);
                        attempt.samples.push({
                          input: entry.input,
                          unique_id: entry.unique_id,
                          response: entry.response,
                          score: entry["image_similarity_score/score"],
                        });
                      }
                    }
                  }

                  // Convert to final format and assign step numbers
                  for (const [prompt, data] of promptAttempts) {
                    if (data.scores.length > 0) {
                      data.avgScore = data.scores.reduce((a, b) => a + b, 0) / data.scores.length;
                      data.confidenceScore = data.avgScore;

                      // Determine if this is the original or final optimized prompt
                      const isOriginal = prompt === originalPrompt;
                      const isFinalOptimized = prompt === optimizedData.prompt;

                      let improvements = [];
                      if (isOriginal) {
                        improvements = [
                          "Original base prompt",
                          "Starting point for optimization",
                          `Tested on ${data.samples.length} samples`,
                          `Average score: ${(data.avgScore * 100).toFixed(1)}%`,
                        ];
                      } else if (isFinalOptimized) {
                        improvements = [
                          "Final optimized version using Vertex AI",
                          "Enhanced based on training data patterns",
                          `Achieved ${(data.avgScore * 100).toFixed(1)}% similarity score`,
                          `Tested on ${data.samples.length} samples`,
                          `Average score: ${(data.avgScore * 100).toFixed(1)}%`,
                        ];
                      } else {
                        improvements = [
                          `Tested on ${data.samples.length} samples`,
                          `Average score: ${(data.avgScore * 100).toFixed(1)}%`,
                          "Intermediate optimization attempt",
                        ];
                      }

                      optimizedPrompts.push({
                        prompt: prompt,
                        step: stepCounter++,
                        confidenceScore: data.avgScore,
                        avgScore: data.avgScore,
                        scores: data.scores,
                        samples: data.samples,
                        isOptimized: isFinalOptimized,
                        isOriginal: isOriginal,
                        isFinal: isFinalOptimized,
                        improvements: improvements,
                      });

                      console.log(`✅ Added ${isOriginal ? 'original' : isFinalOptimized ? 'final' : 'intermediate'} prompt (step ${stepCounter - 1}) with score: ${(data.avgScore * 100).toFixed(1)}%`);
                    }
                  }
                } catch (parseError) {
                  console.warn(
                    `Warning: Could not parse metrics table: ${parseError.message}`
                  );
                }
              }
            }
          }

          console.log(`🔍 Found ${optimizedPrompts.length} total prompts`);

          // Sort prompts by performance score (highest to lowest - best first)
          optimizedPrompts.sort((a, b) => {
            // Primary sort: by average score (highest first)
            const scoreA = a.avgScore || 0;
            const scoreB = b.avgScore || 0;
            if (scoreB !== scoreA) {
              return scoreB - scoreA;
            }
            // Secondary sort: by step number (latest first) if scores are equal
            return (b.step || 0) - (a.step || 0);
          });

          foundResults = {
            jobId,
            originalPrompts: jobData.base_prompts,
            optimizedPrompts,
            performanceMetrics: {
              imageSimilarityScore:
                optimizedData.metrics?.["image_similarity_score/mean"] || 0,
              evaluationSamples:
                evalData?.[0]?.summary_results?.row_count || "Unknown",
              ...allMetrics,
            },
            completedAt: new Date().toISOString(),
            resultTimestamp,
          };

          // Fetch generated images from Supabase optimizer_generations table for this optimization run
          try {
            console.log(
              `🔍 Fetching generated images from Supabase for optimization run...`
            );

            let generatedImages = [];
            let imagesError = null;

            if (jobData.session_id) {
              // Use session ID for precise filtering (preferred method)
              console.log(
                `📋 Using session ID for image retrieval: ${jobData.session_id}`
              );

              const { data, error } = await getSupabase()
                .from("optimizer_generations")
                .select("*")
                .eq("session_id", jobData.session_id)
                .order("created_at", { ascending: true });

              generatedImages = data || [];
              imagesError = error;
            } else {
              // Fallback to time-window approach for legacy jobs without session ID
              console.log(
                `⚠️ No session ID found, using time-window fallback for job ${jobId}`
              );

              // Get the next job's creation time to set upper boundary
              const { data: nextJob, error: nextJobError } = await getSupabase()
                .from("vertex_ai_jobs")
                .select("created_at")
                .gt("created_at", jobData.created_at)
                .order("created_at", { ascending: true })
                .limit(1);

              const windowStart = new Date(jobData.created_at);
              const windowEnd =
                nextJob?.length > 0
                  ? new Date(nextJob[0].created_at)
                  : new Date(); // Present time if this is the latest job

              console.log(
                `📅 Fetching images from ${windowStart.toISOString()} to ${windowEnd.toISOString()}`
              );

              const { data, error } = await getSupabase()
                .from("optimizer_generations")
                .select("*")
                .gte("created_at", windowStart.toISOString())
                .lt("created_at", windowEnd.toISOString())
                .order("created_at", { ascending: true });

              generatedImages = data || [];
              imagesError = error;
            }

            if (!imagesError && generatedImages && generatedImages.length > 0) {
              console.log(
                `📸 Found ${generatedImages.length} generated images for this optimization run`
              );

              // Process all image uploads in parallel
              console.log(
                `🚀 Processing ${generatedImages.length} images in parallel...`
              );
              const imageUploadPromises = generatedImages.map(async (img) => {
                const promptKey = img.prompt_used || "unknown";
                let supabaseImageUrl = img.generated_image_url; // fallback

                try {
                  if (
                    img.generated_image_url &&
                    img.generated_image_url.includes("storage.googleapis.com")
                  ) {
                    supabaseImageUrl = await uploadGCSImageToSupabase(
                      img.generated_image_url,
                      img.id
                    );

                    // Update the database record with the new Supabase URL for caching
                    try {
                      await getSupabase()
                        .from("optimizer_generations")
                        .update({ generated_image_url: supabaseImageUrl })
                        .eq("id", img.id);
                      console.log(
                        `✅ Updated database record ${img.id} with Supabase URL`
                      );
                    } catch (updateError) {
                      console.warn(
                        `Warning: Failed to update database record ${img.id}: ${updateError.message}`
                      );
                    }
                  }
                } catch (uploadError) {
                  console.warn(
                    `Failed to upload image ${img.id} to Supabase: ${uploadError.message}`
                  );
                }

                return {
                  promptKey,
                  imageData: {
                    id: img.id,
                    generatedImageUrl: supabaseImageUrl,
                    uploadedImageUrl: img.uploaded_image_url,
                    referenceImageUrl: img.reference_image_url,
                    trainingSampleId: img.training_sample_id,
                    createdAt: img.created_at,
                  },
                };
              });

              const uploadedImages = await Promise.all(imageUploadPromises);

              // Group images by prompt used
              const imagesByPrompt = new Map();
              for (const { promptKey, imageData } of uploadedImages) {
                if (!imagesByPrompt.has(promptKey)) {
                  imagesByPrompt.set(promptKey, []);
                }
                imagesByPrompt.get(promptKey).push(imageData);
              }

              // Add images to each optimized prompt
              for (const optimizedPrompt of optimizedPrompts) {
                const matchingImages =
                  imagesByPrompt.get(optimizedPrompt.prompt) || [];
                optimizedPrompt.generatedImages = matchingImages;
                optimizedPrompt.imageCount = matchingImages.length;

                if (matchingImages.length > 0) {
                  optimizedPrompt.improvements.push(
                    `Generated ${matchingImages.length} sample images`
                  );
                }
              }

              // Add total image count to performance metrics
              foundResults.performanceMetrics.totalImagesGenerated =
                generatedImages.length;
            } else {
              console.log(
                `⚠️ No generated images found in Supabase for this optimization run`
              );
            }
          } catch (imagesError) {
            console.warn(
              `Warning: Could not fetch generated images: ${imagesError.message}`
            );
          }

          console.log(
            `✅ Found results for job ${jobId} at timestamp ${resultTimestamp} with ${optimizedPrompts.length} prompt attempts`
          );
        } catch (fileError) {
          console.log(`❌ Error processing ${fileName}: ${fileError.message}`);
        }
      } else {
        console.log(
          `❌ No matching results found for job ${jobId} created at ${jobData.created_at}`
        );
      }

      if (foundResults) {
        // Store results in Supabase for caching
        await getSupabase()
          .from("vertex_ai_jobs")
          .update({
            optimized_prompts: foundResults.optimizedPrompts,
            performance_metrics: foundResults.performanceMetrics,
          })
          .eq("job_id", jobId);

        console.log(`✅ Retrieved and cached results for job: ${jobId}`);

        return res.json({
          jobId,
          status: "completed",
          originalPrompts: jobData.base_prompts,
          optimizedPrompts: foundResults.optimizedPrompts,
          performanceMetrics: foundResults.performanceMetrics,
          completedAt: foundResults.completedAt,
        });
      }
    } catch (fetchError) {
      console.error(`❌ Error fetching results: ${fetchError.message}`);
    }

    // No results available
    console.log(`❌ No optimization results found for job: ${jobId}`);

    return res.status(404).json({
      error: "Results not found",
      message: "Optimization results are not available for this job",
      jobId,
      status: jobData.status,
    });
  } catch (error) {
    console.error("❌ Vertex AI results retrieval error:", error);
    res.status(500).json({
      error: "Results retrieval failed",
      details: error.message,
      timestamp: new Date().toISOString(),
    });
  }
});

// Get jobs by session ID
router.get("/sessions/:sessionId", async (req, res) => {
  console.log("📋 Getting jobs by session ID");

  try {
    const { sessionId } = req.params;

    console.log(`🔍 Fetching jobs for session: ${sessionId}`);

    // Get all jobs for this session
    const { data: jobs, error: jobsError } = await getSupabase()
      .from("vertex_ai_jobs")
      .select("*")
      .eq("session_id", sessionId)
      .order("created_at", { ascending: false });

    if (jobsError) {
      console.error("❌ Failed to fetch jobs by session:", jobsError);
      return res.status(500).json({
        error: "Failed to fetch jobs",
        details: jobsError.message,
      });
    }

    // Get all generated images for this session
    const { data: generatedImages, error: imagesError } = await getSupabase()
      .from("optimizer_generations")
      .select("*")
      .eq("session_id", sessionId)
      .order("created_at", { ascending: true });

    if (imagesError) {
      console.warn("⚠️ Failed to fetch images for session:", imagesError);
    }

    console.log(
      `📊 Found ${jobs.length} jobs and ${
        generatedImages?.length || 0
      } images for session ${sessionId}`
    );

    res.json({
      sessionId,
      jobs: jobs || [],
      generatedImages: generatedImages || [],
      totalJobs: jobs?.length || 0,
      totalImages: generatedImages?.length || 0,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    console.error("❌ Error fetching session data:", err);
    res.status(500).json({
      error: "Internal server error",
      details: err.message,
    });
  }
});

// Deploy session-specific cloud function
async function deploySessionCloudFunction(sessionId, functionName, evaluationCriteria = "comprehensive", evaluationMode = "reference_comparison") {
  const { spawn } = await import("child_process");

  return new Promise((resolve, reject) => {
    console.log(
      `🚀 Deploying cloud function: ${functionName} for session: ${sessionId} with criteria: ${evaluationCriteria}, mode: ${evaluationMode}`
    );

    // Prepare environment variables
    const env = {
      ...process.env,
      SESSION_ID: sessionId,
      EVALUATION_CRITERIA: evaluationCriteria,
      EVALUATION_MODE: evaluationMode,
    };

    // Run the deployment script with session-specific function name
    // Use stdio: "pipe" to capture output like Python's capture_output=True
    const deployProcess = spawn("bash", ["./deploy.sh"], {
      env,
      cwd: "../cloud-function", // Change to cloud-function directory
      stdio: "pipe", // This should make it non-interactive like Python
    });

    let stdout = "";
    let stderr = "";

    deployProcess.stdout.on("data", (data) => {
      stdout += data.toString();
      console.log(`☁️ Deploy stdout: ${data.toString().trim()}`);
    });

    deployProcess.stderr.on("data", (data) => {
      stderr += data.toString();
      console.log(`⚠️ Deploy stderr: ${data.toString().trim()}`);
    });

    deployProcess.on("close", (code) => {
      if (code === 0) {
        console.log(`✅ Cloud function ${functionName} deployed successfully`);
        resolve({ functionName, stdout });
      } else {
        console.error(`❌ Cloud function deployment failed with code ${code}`);
        reject(new Error(`Deployment failed with code ${code}: ${stderr}`));
      }
    });

    deployProcess.on("error", (error) => {
      console.error(`❌ Deploy process error: ${error.message}`);
      reject(error);
    });

    // Set timeout for deployment (5 minutes)
    setTimeout(() => {
      deployProcess.kill("SIGTERM");
      reject(new Error("Cloud function deployment timeout (5 minutes)"));
    }, 300000);
  });
}

export default router;
