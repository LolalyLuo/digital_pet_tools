import { useState, useEffect } from "react";
import {
  Loader2,
  AlertCircle,
  Play,
  RefreshCw,
  CheckCircle,
  Clock,
  Settings,
  BarChart3,
  Download,
  Eye,
} from "lucide-react";
import { supabase } from "../../utils/supabaseClient";
import CostEstimation from "../CostEstimation";
import { generateSessionId, formatSessionId } from "../../utils/sessionUtils";

const VertexAIOptimizer = () => {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [dataSets, setDataSets] = useState([]);
  const [currentDataSet, setCurrentDataSet] = useState("");
  const [basePrompt, setBasePrompt] = useState("Generate a cute dog photo");
  const [artStyle, setArtStyle] = useState("cartoon");
  const [creativeDescription, setCreativeDescription] = useState("pet sitting happily with clean isolated background");
  const [numSteps, setNumSteps] = useState(20);
  const [evaluationCriteria, setEvaluationCriteria] = useState("comprehensive");
  const [evaluationMode, setEvaluationMode] = useState("reference_comparison");
  const [jobs, setJobs] = useState([]);
  const [selectedJob, setSelectedJob] = useState(null);
  const [pollingInterval, setPollingInterval] = useState(null);
  const [trainingDataCount, setTrainingDataCount] = useState(0);
  // Fixed model - matches what's hardcoded in cloud function
  const fixedModel = "gemini-2.5-flash-image-preview";
  const [currentSessionId, setCurrentSessionId] = useState("");

  // Available evaluation criteria options
  const evaluationCriteriaOptions = [
    {
      value: "comprehensive",
      name: "Comprehensive Pet Portrait Evaluation",
      description: "10-category evaluation focusing on gift appeal and marketability"
    },
    {
      value: "simplified",
      name: "Simplified Pet Portrait Evaluation",
      description: "5-category evaluation focusing on core visual qualities"
    },
    {
      value: "artistic",
      name: "Artistic Quality Evaluation",
      description: "6-category evaluation focusing on artistic merit and style"
    }
  ];

  // Available evaluation mode options
  const evaluationModeOptions = [
    {
      value: "reference_comparison",
      name: "Reference Comparison Mode",
      description: "Compare generated image against OpenAI reference image"
    },
    {
      value: "standalone_quality",
      name: "Standalone Quality Mode",
      description: "Evaluate generated image quality independently using ideal criteria"
    }
  ];

  const checkJobStatus = async (jobId) => {
    try {
      const response = await fetch(
        `http://localhost:3001/api/vertex-ai/jobs/${jobId}`
      );

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();

      console.log(`🔄 Status check for ${jobId}:`, data);

      // Reload all jobs to get updated data from server
      await loadJobs();

      return data;
    } catch (err) {
      console.error("Status check error:", err);
      return null;
    }
  };

  useEffect(() => {
    loadDataSets();
    loadJobs();
  }, []);

  // Auto-polling effect for jobs in progress
  useEffect(() => {
    const hasActiveJobs = jobs.some(
      (job) =>
        job.status === "running" ||
        job.status === "pending" ||
        job.status === "queued" ||
        job.status === "submitted"
    );

    console.log(
      `🔄 Jobs changed - active jobs: ${hasActiveJobs}, polling active: ${!!pollingInterval}`
    );

    if (hasActiveJobs && !pollingInterval) {
      console.log("🔄 Starting auto-polling for active jobs");
      const interval = setInterval(() => {
        console.log("🔄 Auto-polling job status...");
        // Get fresh jobs data and check status for all active jobs
        fetch("http://localhost:3001/api/vertex-ai/jobs")
          .then((response) => response.json())
          .then((data) => {
            const currentJobs = data.jobs || [];
            const activeJobs = currentJobs.filter(
              (job) =>
                job.status === "running" ||
                job.status === "pending" ||
                job.status === "queued" ||
                job.status === "submitted"
            );

            console.log(`🔄 Found ${activeJobs.length} active jobs to check`);

            // Check status for each active job
            activeJobs.forEach((job) => {
              console.log(`🔄 Checking status for job: ${job.jobId}`);
              checkJobStatus(job.jobId);
            });
          })
          .catch((error) => {
            console.error("Auto-polling error:", error);
          });
      }, 5000); // Poll every 5 seconds

      setPollingInterval(interval);
    } else if (!hasActiveJobs && pollingInterval) {
      console.log("⏹️ Stopping auto-polling - no active jobs");
      clearInterval(pollingInterval);
      setPollingInterval(null);
    }
  }, [jobs]); // Remove pollingInterval from dependencies to avoid infinite loop

  // Cleanup interval on unmount
  useEffect(() => {
    return () => {
      if (pollingInterval) {
        clearInterval(pollingInterval);
      }
    };
  }, [pollingInterval]);

  const loadDataSets = async () => {
    try {
      const { data, error } = await supabase
        .from("training_data_sets")
        .select("name")
        .order("created_at", { ascending: true });

      if (error) throw error;

      const setNames = data.map((row) => row.name);
      setDataSets(setNames);

      if (setNames.length > 0 && !currentDataSet) {
        setCurrentDataSet(setNames[0]);
        // Load training data count for the first dataset
        loadTrainingDataCount(setNames[0]);
      }
    } catch (err) {
      console.error("Error loading data sets:", err);
      setError(`Failed to load data sets: ${err.message}`);
    }
  };

  const loadTrainingDataCount = async (dataSetName) => {
    if (!dataSetName) {
      setTrainingDataCount(0);
      return;
    }

    try {
      const { count, error } = await supabase
        .from("training_samples")
        .select("*", { count: "exact", head: true })
        .eq("data_set_name", dataSetName);

      if (error) throw error;

      setTrainingDataCount(count || 0);
    } catch (err) {
      console.error("Error loading training data count:", err);
      setTrainingDataCount(0);
    }
  };

  const loadJobs = async () => {
    try {
      const response = await fetch("http://localhost:3001/api/vertex-ai/jobs");

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();
      setJobs(data.jobs || []);

      console.log(`📊 Loaded ${data.jobs?.length || 0} jobs from server`);
    } catch (err) {
      console.error("Error loading jobs:", err);
      setError(`Failed to load jobs: ${err.message}`);
    }
  };

  const submitOptimizationJob = async () => {
    if (!currentDataSet) {
      setError("Please select a training data set");
      return;
    }

    if (!basePrompt.trim()) {
      setError("Please enter a prompt");
      return;
    }

    setLoading(true);
    setError("");

    // Generate session ID for this optimization run
    const sessionId = generateSessionId();
    setCurrentSessionId(sessionId);

    try {
      console.log("🚀 Submitting Vertex AI optimization job...");
      console.log(`📋 Session ID: ${sessionId}`);

      const response = await fetch(
        "http://localhost:3001/api/vertex-ai/optimize",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            trainingDataSet: currentDataSet,
            basePrompts: [basePrompt],
            optimizationMode: "data-driven",
            numSteps: numSteps,
            evaluationCriteria: evaluationCriteria,
            evaluationMode: evaluationMode,
            artStyle: artStyle,
            creativeDescription: creativeDescription,
            sessionId: sessionId, // Include session ID in request
          }),
        }
      );

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();

      console.log(`✅ Job submitted: ${data.jobId}`);

      // Reload jobs from server to get the persisted data
      await loadJobs();
    } catch (err) {
      setError(`Job submission failed: ${err.message}`);
      console.error("Job submission error:", err);
    } finally {
      setLoading(false);
    }
  };

  const viewJobResults = async (jobId) => {
    try {
      setLoading(true);

      const response = await fetch(
        `http://localhost:3001/api/vertex-ai/results/${jobId}`
      );

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();
      setSelectedJob({ ...data, jobId });
    } catch (err) {
      setError(`Failed to load results: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  const getStatusIcon = (status) => {
    switch (status) {
      case "completed":
        return <CheckCircle className="text-green-500" size={16} />;
      case "running":
        return <Loader2 className="animate-spin text-blue-500" size={16} />;
      default:
        return <Clock className="text-yellow-500" size={16} />;
    }
  };

  const getStatusColor = (status) => {
    switch (status) {
      case "completed":
        return "text-green-600 bg-green-50";
      case "running":
        return "text-blue-600 bg-blue-50";
      default:
        return "text-yellow-600 bg-yellow-50";
    }
  };

  return (
    <div className="flex flex-col bg-gray-100">
      <div className="flex-1 flex overflow-hidden">
        {/* Left Panel - Configuration */}
        <div className="bg-white shadow-sm p-6 overflow-y-auto">
          <h2 className="text-xl font-bold text-gray-800 mb-6 flex items-center">
            <Settings className="mr-2" size={24} />
            Vertex AI Prompt Optimizer
          </h2>

          {error && (
            <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded flex items-start">
              <AlertCircle className="mr-2 mt-0.5 text-red-500" size={16} />
              <span className="text-sm text-red-700">{error}</span>
            </div>
          )}

          {/* Data Set Selection */}
          <div className="mb-6">
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Training Data Set
            </label>
            <select
              value={currentDataSet}
              onChange={(e) => {
                setCurrentDataSet(e.target.value);
                loadTrainingDataCount(e.target.value);
              }}
              className="w-full px-3 py-2 border border-gray-300 rounded focus:ring-1 focus:ring-blue-500"
            >
              <option value="">Select a data set...</option>
              {dataSets.map((setName) => (
                <option key={setName} value={setName}>
                  {setName}
                </option>
              ))}
            </select>
            {trainingDataCount > 0 && (
              <p className="text-xs text-gray-500 mt-1">
                {trainingDataCount} training samples available
              </p>
            )}
          </div>

          {/* Base Prompt */}
          <div className="mb-6">
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Prompt to Optimize
            </label>
            <textarea
              value={basePrompt}
              onChange={(e) => setBasePrompt(e.target.value)}
              placeholder="Enter your prompt to optimize..."
              className="w-full px-3 py-2 border border-gray-300 rounded focus:ring-1 focus:ring-blue-500 resize-none"
              rows={4}
            />
          </div>

          {/* Evaluation Criteria */}
          <div className="mb-6">
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Evaluation Criteria
            </label>
            <select
              value={evaluationCriteria}
              onChange={(e) => setEvaluationCriteria(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded focus:ring-1 focus:ring-blue-500"
            >
              {evaluationCriteriaOptions.map((criteria) => (
                <option key={criteria.value} value={criteria.value}>
                  {criteria.name}
                </option>
              ))}
            </select>
            <p className="text-xs text-gray-500 mt-1">
              {evaluationCriteriaOptions.find(c => c.value === evaluationCriteria)?.description}
            </p>
          </div>

          {/* Evaluation Mode */}
          <div className="mb-6">
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Evaluation Mode
            </label>
            <select
              value={evaluationMode}
              onChange={(e) => setEvaluationMode(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded focus:ring-1 focus:ring-blue-500"
            >
              {evaluationModeOptions.map((mode) => (
                <option key={mode.value} value={mode.value}>
                  {mode.name}
                </option>
              ))}
            </select>
            <p className="text-xs text-gray-500 mt-1">
              {evaluationModeOptions.find(m => m.value === evaluationMode)?.description}
            </p>
            {evaluationMode === "standalone_quality" && (
              <p className="text-xs text-blue-600 mt-1 italic">
                ℹ️ This mode doesn't require OpenAI reference images - evaluates quality independently
              </p>
            )}
          </div>

          {/* Art Style Selection */}
          <div className="mb-6">
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Art Style
            </label>
            <select
              value={artStyle}
              onChange={(e) => setArtStyle(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded focus:ring-1 focus:ring-blue-500"
            >
              <option value="anime">Anime Style</option>
              <option value="cartoon">Cartoon Style</option>
              <option value="hand-drawn">Hand Drawn Style</option>
              <option value="realistic">Realistic Style</option>
              <option value="watercolor">Watercolor Style</option>
              <option value="digital-art">Digital Art Style</option>
              <option value="sketch">Sketch Style</option>
            </select>
            <p className="text-xs text-gray-500 mt-1">
              Choose the artistic style for the generated pet portraits
            </p>
          </div>

          {/* Creative Description */}
          <div className="mb-6">
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Creative Description
            </label>
            <textarea
              value={creativeDescription}
              onChange={(e) => setCreativeDescription(e.target.value)}
              placeholder="e.g., pet holding a mug, pet wearing a hat, pet sitting in a garden..."
              className="w-full px-3 py-2 border border-gray-300 rounded focus:ring-1 focus:ring-blue-500 resize-none"
              rows={3}
            />
            <p className="text-xs text-gray-500 mt-1">
              Short creative description of the desired scene or pose. Focus on isolated pets with clean backgrounds.
            </p>
          </div>

          {/* Number of Steps */}
          <div className="mb-6">
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Number of Optimization Steps
            </label>
            <input
              type="number"
              value={numSteps}
              onChange={(e) => setNumSteps(parseInt(e.target.value) || 1)}
              min="1"
              max="100"
              className="w-full px-3 py-2 border border-gray-300 rounded focus:ring-1 focus:ring-blue-500"
              placeholder="20"
            />
            <p className="text-xs text-gray-500 mt-1">
              Number of optimization iterations (1-100, default: 20)
            </p>
          </div>

          {/* Cost Estimation */}
          <CostEstimation
            trainingDataCount={trainingDataCount}
            optimizationSteps={numSteps}
            className="mb-6"
          />

          {/* Actions */}
          <div className="space-y-3">
            <button
              onClick={submitOptimizationJob}
              disabled={loading || !currentDataSet || !basePrompt.trim()}
              className={`w-full px-4 py-2 rounded font-medium transition-colors flex items-center justify-center ${
                loading || !currentDataSet || !basePrompt.trim()
                  ? "bg-gray-300 text-gray-500 cursor-not-allowed"
                  : "bg-green-600 text-white hover:bg-green-700"
              }`}
            >
              {loading ? (
                <>
                  <Loader2 className="animate-spin mr-2" size={18} />
                  Submitting...
                </>
              ) : (
                <>
                  <Play className="mr-2" size={18} />
                  Submit Optimization Job
                </>
              )}
            </button>
          </div>
        </div>

        {/* Right Panel - Jobs & Results */}
        <div className="flex-1 bg-white shadow-sm overflow-hidden">
          <div className="h-full flex flex-col">
            <div className="p-6 border-b">
              <h3 className="text-lg font-semibold text-gray-800 flex items-center">
                <BarChart3 className="mr-2" size={20} />
                Optimization Jobs
                {jobs.length > 0 && (
                  <span className="ml-2 text-sm text-gray-500">
                    ({jobs.length} jobs)
                  </span>
                )}
              </h3>
            </div>

            <div className="flex-1 overflow-y-auto p-6">
              {selectedJob ? (
                // Show detailed results
                <div>
                  <div className="flex items-center justify-between mb-4">
                    <h4 className="text-lg font-medium">
                      Job Results: {selectedJob.jobId}
                    </h4>
                    <button
                      onClick={() => setSelectedJob(null)}
                      className="text-gray-500 hover:text-gray-700"
                    >
                      ← Back to Jobs
                    </button>
                  </div>

                  <div className="space-y-6">
                    <div className="bg-green-50 p-4 rounded-lg">
                      <h5 className="font-medium text-green-800 mb-2">
                        Performance Metrics
                      </h5>
                      <div className="grid grid-cols-2 md:grid-cols-3 gap-4 text-sm">
                        <div>
                          <span className="text-green-600">Score</span>
                          <p className="font-medium">
                            {(
                              selectedJob.performanceMetrics
                                ?.imageSimilarityScore * 100 || 0
                            ).toFixed(1)}
                            %
                          </p>
                        </div>
                        <div>
                          <span className="text-green-600">
                            Evaluation Samples
                          </span>
                          <p className="font-medium">
                            {selectedJob.performanceMetrics?.evaluationSamples}
                          </p>
                        </div>
                        <div>
                          <span className="text-green-600">
                            Images Generated
                          </span>
                          <p className="font-medium">
                            {selectedJob.performanceMetrics
                              ?.totalImagesGenerated || 0}
                          </p>
                        </div>
                      </div>
                    </div>

                    <div>
                      <h5 className="font-medium text-gray-800 mb-3">
                        Optimization Progression
                      </h5>
                      <div className="space-y-4">
                        {selectedJob.optimizedPrompts?.map(
                          (optimized, index) => (
                            <div
                              key={index}
                              className={`border rounded-lg p-4 ${
                                optimized.isOptimized
                                  ? "border-green-500 bg-green-50"
                                  : "border-gray-200"
                              }`}
                            >
                              <div className="flex items-center justify-between mb-2">
                                <div className="flex items-center gap-2">
                                  <span className="font-medium text-gray-700">
                                    {optimized.step === 0
                                      ? "🎯 Original Prompt"
                                      : `📝 Attempt ${optimized.step}`}
                                  </span>
                                </div>
                                <span
                                  className={`text-sm ${
                                    optimized.isOptimized
                                      ? "text-green-600 font-semibold"
                                      : "text-blue-600"
                                  }`}
                                >
                                  Score:{" "}
                                  {((optimized.confidenceScore || 0) * 100).toFixed(1)}%
                                </span>
                              </div>

                              <div
                                className={`p-3 rounded mb-3 ${
                                  optimized.isOptimized
                                    ? "bg-green-100"
                                    : "bg-blue-50"
                                }`}
                              >
                                <p
                                  className={`text-sm font-medium ${
                                    optimized.isOptimized
                                      ? "text-green-800"
                                      : "text-blue-800"
                                  }`}
                                >
                                  {optimized.prompt}
                                </p>
                              </div>

                              {optimized.generatedImages &&
                                optimized.generatedImages.length > 0 && (
                                  <div className="mb-3">
                                    <p className="text-xs text-gray-600 mb-2">
                                      Generated Images (
                                      {optimized.generatedImages.length}):
                                    </p>
                                    <div className="flex gap-2 overflow-x-auto">
                                      {optimized.generatedImages.map(
                                        (img, imgIndex) => (
                                          <div
                                            key={imgIndex}
                                            className="flex-shrink-0"
                                          >
                                            <img
                                              src={img.generatedImageUrl}
                                              alt={`Generated ${imgIndex + 1}`}
                                              className="w-16 h-16 object-cover rounded border cursor-pointer hover:scale-110 transition-transform"
                                              onClick={() =>
                                                window.open(
                                                  img.generatedImageUrl,
                                                  "_blank"
                                                )
                                              }
                                              title={`Sample ${img.trainingSampleId} - Click to view full size`}
                                            />
                                          </div>
                                        )
                                      )}
                                    </div>
                                  </div>
                                )}

                              <div>
                                <p className="text-xs text-gray-600 mb-1">
                                  Details:
                                </p>
                                <ul className="text-xs text-gray-700 space-y-1">
                                  {optimized.improvements?.map(
                                    (improvement, i) => (
                                      <li key={i}>• {improvement}</li>
                                    )
                                  )}
                                  {optimized.samples &&
                                    optimized.samples.length > 0 && (
                                      <li>
                                        • Tested on samples:{" "}
                                        {optimized.samples
                                          .map((s) => s.unique_id)
                                          .join(", ")}
                                      </li>
                                    )}
                                </ul>
                              </div>
                            </div>
                          )
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              ) : jobs.length === 0 ? (
                // No jobs yet
                <div className="text-center text-gray-500 mt-12">
                  <Settings size={48} className="mx-auto mb-4 text-gray-300" />
                  <p>No optimization jobs yet</p>
                  <p className="text-sm">
                    Configure your settings and submit your first job to get
                    started
                  </p>
                </div>
              ) : (
                // Show jobs list
                <div className="space-y-4">
                  {jobs.map((job) => (
                    <div key={job.jobId} className="border rounded-lg p-4">
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-2">
                          {getStatusIcon(job.status)}
                          <span className="font-medium text-gray-800">
                            {job.jobId}
                          </span>
                          <span
                            className={`px-2 py-1 rounded-full text-xs font-medium ${getStatusColor(
                              job.status
                            )}`}
                          >
                            {job.status}
                          </span>
                        </div>
                        <div className="flex gap-2">
                          <button
                            onClick={() => checkJobStatus(job.jobId)}
                            className={`p-1 hover:text-gray-700 ${
                              pollingInterval &&
                              (job.status === "running" ||
                                job.status === "pending" ||
                                job.status === "queued" ||
                                job.status === "submitted")
                                ? "text-blue-500"
                                : "text-gray-500"
                            }`}
                            title={
                              pollingInterval &&
                              (job.status === "running" ||
                                job.status === "pending" ||
                                job.status === "queued" ||
                                job.status === "submitted")
                                ? "Auto-refreshing every 5s (click for manual refresh)"
                                : "Refresh status"
                            }
                          >
                            <RefreshCw
                              size={16}
                              className={
                                pollingInterval &&
                                (job.status === "running" ||
                                  job.status === "pending" ||
                                  job.status === "queued" ||
                                  job.status === "submitted")
                                  ? "animate-spin"
                                  : ""
                              }
                            />
                          </button>
                          {job.status === "completed" && (
                            <button
                              onClick={() => viewJobResults(job.jobId)}
                              className="p-1 text-blue-500 hover:text-blue-700"
                              title="View results"
                            >
                              <Eye size={16} />
                            </button>
                          )}
                        </div>
                      </div>

                      <div className="text-sm text-gray-600 space-y-1">
                        <p>
                          <strong>Data Set:</strong> {job.trainingDataSet}
                        </p>
                        <p>
                          <strong>Prompts:</strong> {job.basePrompts} base
                          prompts
                        </p>
                        <p>
                          <strong>Mode:</strong> {job.optimizationMode}
                        </p>
                        <p>
                          <strong>Submitted:</strong> {job.submittedAt}
                        </p>
                        {job.lastChecked && (
                          <p>
                            <strong>Last Checked:</strong> {job.lastChecked}
                          </p>
                        )}
                        {job.currentStep !== undefined &&
                          job.totalSteps !== undefined &&
                          job.status !== "completed" &&
                          job.status !== "failed" && (
                            <div className="mt-2">
                              <div className="flex justify-between text-xs mb-1">
                                <span>Progress</span>
                                <span>
                                  Step {job.currentStep} of {job.totalSteps}
                                </span>
                              </div>
                              <div className="w-full bg-gray-200 rounded-full h-2">
                                <div
                                  className="bg-blue-600 h-2 rounded-full transition-all"
                                  style={{
                                    width: `${Math.round(
                                      (job.currentStep / job.totalSteps) * 100
                                    )}%`,
                                  }}
                                ></div>
                              </div>
                            </div>
                          )}
                      </div>

                      {job.message && (
                        <div className="mt-2 text-xs text-gray-500 italic">
                          {job.message}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default VertexAIOptimizer;
