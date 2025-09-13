import { useState, useEffect } from "react";
import {
  Loader2,
  AlertCircle,
  Play,
  RefreshCw,
  CheckCircle,
  Clock,
  Database,
  Settings,
  BarChart3,
  Download,
  Eye,
} from "lucide-react";
import { supabase } from "../../utils/supabaseClient";

const VertexAIOptimizer = () => {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [dataSets, setDataSets] = useState([]);
  const [currentDataSet, setCurrentDataSet] = useState("");
  const [basePrompts, setBasePrompts] = useState(["Generate a cute dog photo"]);
  const [newPrompt, setNewPrompt] = useState("");
  const [optimizationMode, setOptimizationMode] = useState("data-driven");
  const [targetModel, setTargetModel] = useState("gemini-2.5-flash");
  const [jobs, setJobs] = useState([]);
  const [selectedJob, setSelectedJob] = useState(null);
  const [formattedData, setFormattedData] = useState(null);

  useEffect(() => {
    loadDataSets();
  }, []);

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
      }
    } catch (err) {
      console.error("Error loading data sets:", err);
      setError(`Failed to load data sets: ${err.message}`);
    }
  };

  const addPrompt = () => {
    if (newPrompt.trim() && !basePrompts.includes(newPrompt.trim())) {
      setBasePrompts([...basePrompts, newPrompt.trim()]);
      setNewPrompt("");
    }
  };

  const removePrompt = (index) => {
    setBasePrompts(basePrompts.filter((_, i) => i !== index));
  };

  const formatData = async () => {
    if (!currentDataSet) {
      setError("Please select a training data set");
      return;
    }

    setLoading(true);
    setError("");

    try {
      console.log("🔄 Formatting training data for Vertex AI...");

      const response = await fetch("http://localhost:3001/api/vertex-ai/format-data", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          trainingDataSet: currentDataSet,
          basePrompts: basePrompts,
        }),
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();
      setFormattedData(data);

      console.log("✅ Data formatted successfully");
      console.log(`📊 ${data.summary.sampleCount} samples formatted`);

    } catch (err) {
      setError(`Data formatting failed: ${err.message}`);
      console.error("Data formatting error:", err);
    } finally {
      setLoading(false);
    }
  };

  const submitOptimizationJob = async () => {
    if (!currentDataSet) {
      setError("Please select a training data set");
      return;
    }

    if (basePrompts.length === 0) {
      setError("Please add at least one base prompt");
      return;
    }

    setLoading(true);
    setError("");

    try {
      console.log("🚀 Submitting Vertex AI optimization job...");

      const response = await fetch("http://localhost:3001/api/vertex-ai/optimize", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          trainingDataSet: currentDataSet,
          basePrompts: basePrompts,
          optimizationMode: optimizationMode,
          targetModel: targetModel,
        }),
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();

      // Add job to local list
      const newJob = {
        ...data,
        submittedAt: new Date().toLocaleString(),
      };

      setJobs(prev => [newJob, ...prev]);

      console.log(`✅ Job submitted: ${data.jobId}`);

    } catch (err) {
      setError(`Job submission failed: ${err.message}`);
      console.error("Job submission error:", err);
    } finally {
      setLoading(false);
    }
  };

  const checkJobStatus = async (jobId) => {
    try {
      const response = await fetch(`http://localhost:3001/api/vertex-ai/jobs/${jobId}`);

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();

      // Update job in local list
      setJobs(prev =>
        prev.map(job =>
          job.jobId === jobId
            ? { ...job, ...data, lastChecked: new Date().toLocaleString() }
            : job
        )
      );

      return data;
    } catch (err) {
      console.error("Status check error:", err);
      return null;
    }
  };

  const viewJobResults = async (jobId) => {
    try {
      setLoading(true);

      const response = await fetch(`http://localhost:3001/api/vertex-ai/results/${jobId}`);

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
    <div className="flex flex-col h-screen bg-gray-100">
      <div className="flex-1 flex overflow-hidden">
        {/* Left Panel - Configuration */}
        <div className="w-1/2 bg-white shadow-sm p-6 overflow-y-auto">
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
              onChange={(e) => setCurrentDataSet(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded focus:ring-1 focus:ring-blue-500"
            >
              <option value="">Select a data set...</option>
              {dataSets.map((setName) => (
                <option key={setName} value={setName}>
                  {setName}
                </option>
              ))}
            </select>
          </div>

          {/* Base Prompts */}
          <div className="mb-6">
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Base Prompts to Optimize
            </label>
            <div className="space-y-2">
              {basePrompts.map((prompt, index) => (
                <div key={index} className="flex items-center gap-2">
                  <span className="flex-1 px-2 py-1 text-sm bg-gray-50 border rounded">
                    {prompt}
                  </span>
                  <button
                    onClick={() => removePrompt(index)}
                    className="px-2 py-1 text-red-600 hover:bg-red-50 rounded"
                  >
                    ×
                  </button>
                </div>
              ))}
              <div className="flex gap-2">
                <input
                  type="text"
                  value={newPrompt}
                  onChange={(e) => setNewPrompt(e.target.value)}
                  placeholder="Add new prompt..."
                  className="flex-1 px-2 py-1 text-sm border rounded"
                  onKeyPress={(e) => e.key === 'Enter' && addPrompt()}
                />
                <button
                  onClick={addPrompt}
                  className="px-3 py-1 bg-blue-600 text-white rounded hover:bg-blue-700"
                >
                  Add
                </button>
              </div>
            </div>
          </div>

          {/* Configuration */}
          <div className="mb-6 grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Optimization Mode
              </label>
              <select
                value={optimizationMode}
                onChange={(e) => setOptimizationMode(e.target.value)}
                className="w-full px-2 py-1 border rounded text-sm"
              >
                <option value="data-driven">Data-Driven</option>
                <option value="zero-shot">Zero-Shot</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Target Model
              </label>
              <select
                value={targetModel}
                onChange={(e) => setTargetModel(e.target.value)}
                className="w-full px-2 py-1 border rounded text-sm"
              >
                <option value="gemini-2.5-flash">Gemini 2.5 Flash</option>
                <option value="gemini-1.5-pro">Gemini 1.5 Pro</option>
              </select>
            </div>
          </div>

          {/* Actions */}
          <div className="space-y-3">
            <button
              onClick={formatData}
              disabled={loading || !currentDataSet}
              className={`w-full px-4 py-2 rounded font-medium transition-colors flex items-center justify-center ${
                loading || !currentDataSet
                  ? "bg-gray-300 text-gray-500 cursor-not-allowed"
                  : "bg-purple-600 text-white hover:bg-purple-700"
              }`}
            >
              {loading ? (
                <>
                  <Loader2 className="animate-spin mr-2" size={18} />
                  Formatting...
                </>
              ) : (
                <>
                  <Database className="mr-2" size={18} />
                  Format Training Data
                </>
              )}
            </button>

            <button
              onClick={submitOptimizationJob}
              disabled={loading || !currentDataSet || basePrompts.length === 0}
              className={`w-full px-4 py-2 rounded font-medium transition-colors flex items-center justify-center ${
                loading || !currentDataSet || basePrompts.length === 0
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

          {/* Formatted Data Preview */}
          {formattedData && (
            <div className="mt-6 p-4 bg-gray-50 rounded-lg">
              <h4 className="font-medium text-gray-700 mb-2">Formatted Data Summary</h4>
              <div className="text-sm space-y-1">
                <p><strong>Data Set:</strong> {formattedData.summary.dataSet}</p>
                <p><strong>Samples:</strong> {formattedData.summary.sampleCount}</p>
                <p><strong>Size:</strong> {formattedData.downloadSize}</p>
                <p><strong>Format:</strong> {formattedData.summary.format}</p>
              </div>
            </div>
          )}
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
                    <h4 className="text-lg font-medium">Job Results: {selectedJob.jobId}</h4>
                    <button
                      onClick={() => setSelectedJob(null)}
                      className="text-gray-500 hover:text-gray-700"
                    >
                      ← Back to Jobs
                    </button>
                  </div>

                  <div className="space-y-6">
                    <div className="bg-green-50 p-4 rounded-lg">
                      <h5 className="font-medium text-green-800 mb-2">Performance Metrics</h5>
                      <div className="grid grid-cols-3 gap-4 text-sm">
                        <div>
                          <span className="text-green-600">Average Improvement</span>
                          <p className="font-medium">{selectedJob.performanceMetrics?.averageImprovement}</p>
                        </div>
                        <div>
                          <span className="text-green-600">BLEU Score</span>
                          <p className="font-medium">{selectedJob.performanceMetrics?.bleuScore}</p>
                        </div>
                        <div>
                          <span className="text-green-600">ROUGE Score</span>
                          <p className="font-medium">{selectedJob.performanceMetrics?.rougeScore}</p>
                        </div>
                      </div>
                    </div>

                    <div>
                      <h5 className="font-medium text-gray-800 mb-3">Optimized Prompts</h5>
                      <div className="space-y-4">
                        {selectedJob.optimizedPrompts?.map((optimized, index) => (
                          <div key={index} className="border rounded-lg p-4">
                            <div className="flex items-center justify-between mb-2">
                              <span className="font-medium text-gray-700">
                                Prompt #{index + 1}
                              </span>
                              <span className="text-sm text-blue-600">
                                Confidence: {Math.round(optimized.confidenceScore * 100)}%
                              </span>
                            </div>
                            <div className="bg-blue-50 p-3 rounded mb-3">
                              <p className="text-sm font-medium text-blue-800">
                                {optimized.prompt}
                              </p>
                            </div>
                            <div>
                              <p className="text-xs text-gray-600 mb-1">Improvements:</p>
                              <ul className="text-xs text-gray-700 space-y-1">
                                {optimized.improvements?.map((improvement, i) => (
                                  <li key={i}>• {improvement}</li>
                                ))}
                              </ul>
                            </div>
                          </div>
                        ))}
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
                    Configure your settings and submit your first job to get started
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
                          <span className={`px-2 py-1 rounded-full text-xs font-medium ${getStatusColor(job.status)}`}>
                            {job.status}
                          </span>
                        </div>
                        <div className="flex gap-2">
                          <button
                            onClick={() => checkJobStatus(job.jobId)}
                            className="p-1 text-gray-500 hover:text-gray-700"
                            title="Refresh status"
                          >
                            <RefreshCw size={16} />
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
                        <p><strong>Data Set:</strong> {job.trainingDataSet}</p>
                        <p><strong>Prompts:</strong> {job.basePrompts} base prompts</p>
                        <p><strong>Mode:</strong> {job.optimizationMode}</p>
                        <p><strong>Target:</strong> {job.targetModel}</p>
                        <p><strong>Submitted:</strong> {job.submittedAt}</p>
                        {job.lastChecked && (
                          <p><strong>Last Checked:</strong> {job.lastChecked}</p>
                        )}
                        {job.progress !== undefined && (
                          <div className="mt-2">
                            <div className="flex justify-between text-xs mb-1">
                              <span>Progress</span>
                              <span>{job.progress}%</span>
                            </div>
                            <div className="w-full bg-gray-200 rounded-full h-2">
                              <div
                                className="bg-blue-600 h-2 rounded-full transition-all"
                                style={{ width: `${job.progress}%` }}
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