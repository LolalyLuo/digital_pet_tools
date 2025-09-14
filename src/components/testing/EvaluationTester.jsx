import { useState, useEffect } from "react";
import {
  Loader2,
  AlertCircle,
  Play,
  Save,
  Trophy,
  BarChart3,
  Settings,
  Database,
  Trash2,
} from "lucide-react";
import { supabase } from "../../utils/supabaseClient";

const EvaluationTester = () => {
  const [evaluation, setEvaluation] = useState(null);
  const [batchResults, setBatchResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [customPrompt, setCustomPrompt] = useState("");
  const [savedPrompts, setSavedPrompts] = useState([]);
  const [promptName, setPromptName] = useState("");
  const [weights, setWeights] = useState({
    visualAppeal: 0.4,
    styleSimilarity: 0.3,
    technicalQuality: 0.3,
  });
  const [trainingData, setTrainingData] = useState([]);
  const [dataSets, setDataSets] = useState([]);
  const [currentDataSet, setCurrentDataSet] = useState("");
  const [loadingData, setLoadingData] = useState(false);

  // Default evaluation prompt
  const defaultPrompt = `Evaluate this AI-generated dog image compared to the reference image.

Analyze these specific criteria and give each a score from 0.0 to 10.0:
1. Visual Appeal & Cuteness - How appealing and cute is the generated image?
2. Style Similarity - How well does it match the reference image's style and composition?
3. Technical Quality - Assess sharpness, lighting, and overall technical execution

Return ONLY a JSON object with this exact format:
{
  "visualAppeal": 7.5,
  "styleSimilarity": 6.0,
  "technicalQuality": 8.2,
  "reasoning": "Brief explanation of your scoring rationale"
}`;

  useEffect(() => {
    if (!customPrompt) {
      setCustomPrompt(defaultPrompt);
    }
    loadSavedPrompts();
    loadDataSets();
  }, []);

  useEffect(() => {
    if (currentDataSet) {
      loadTrainingDataForSet(currentDataSet);
    }
  }, [currentDataSet]);

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
    }
  };

  const loadTrainingDataForSet = async (dataSetName) => {
    if (!dataSetName) return;

    try {
      setLoadingData(true);
      const { data, error } = await supabase
        .from("training_samples")
        .select("*")
        .eq("data_set_name", dataSetName)
        .order("created_at", { ascending: true });

      if (error) throw error;

      // Transform data and filter for samples that have both OpenAI and Gemini images
      const transformedData = data
        .map((sample) => ({
          id: sample.id,
          name: sample.name,
          uploadedImage: sample.uploaded_image_url
            ? {
                url: sample.uploaded_image_url,
                preview: sample.uploaded_image_url,
              }
            : null,
          openaiImage: sample.openai_image_url
            ? {
                url: sample.openai_image_url,
                preview: sample.openai_image_url,
              }
            : null,
          geminiImage: sample.gemini_image_url
            ? {
                url: sample.gemini_image_url,
                preview: sample.gemini_image_url,
              }
            : null,
          status: sample.status || "unknown",
          created_at: sample.created_at,
          source: sample.source,
        }))
        .filter((sample) => sample.openaiImage && sample.geminiImage); // Only samples ready for evaluation

      setTrainingData(transformedData);
    } catch (err) {
      setError(`Failed to load training data: ${err.message}`);
      console.error("Error loading training data:", err);
    } finally {
      setLoadingData(false);
    }
  };

  const loadSavedPrompts = async () => {
    try {
      const response = await fetch(
        "http://localhost:3001/api/evaluation-prompts"
      );
      if (response.ok) {
        const data = await response.json();
        setSavedPrompts(data.prompts || []);
      }
    } catch (err) {
      console.log("No saved prompts available");
    }
  };

  const savePrompt = async () => {
    if (!promptName.trim() || !customPrompt.trim()) {
      setError("Please enter both prompt name and prompt content");
      return;
    }

    try {
      const response = await fetch(
        "http://localhost:3001/api/evaluation-prompts",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            name: promptName.trim(),
            prompt: customPrompt.trim(),
            weights: weights,
          }),
        }
      );

      if (response.ok) {
        setPromptName("");
        loadSavedPrompts();
        console.log("✅ Prompt saved successfully");
      } else {
        throw new Error("Failed to save prompt");
      }
    } catch (err) {
      setError(`Failed to save prompt: ${err.message}`);
    }
  };

  const loadPrompt = (prompt) => {
    setCustomPrompt(prompt.prompt);
    if (prompt.weights) {
      setWeights(prompt.weights);
    }
  };

  const deletePrompt = async (promptId) => {
    if (!confirm("Are you sure you want to delete this prompt?")) {
      return;
    }

    try {
      const response = await fetch(
        `http://localhost:3001/api/evaluation-prompts/${promptId}`,
        {
          method: "DELETE",
        }
      );

      if (response.ok) {
        loadSavedPrompts();
        console.log("🗑️ Prompt deleted successfully");
      } else {
        throw new Error("Failed to delete prompt");
      }
    } catch (err) {
      setError(`Failed to delete prompt: ${err.message}`);
    }
  };

  const calculateWeightedScore = (scores, customWeights = weights) => {
    if (!scores || typeof scores !== "object") return 0;

    const visualAppeal = parseFloat(scores.visualAppeal) || 0;
    const styleSimilarity = parseFloat(scores.styleSimilarity) || 0;
    const technicalQuality = parseFloat(scores.technicalQuality) || 0;

    return (
      visualAppeal * customWeights.visualAppeal +
      styleSimilarity * customWeights.styleSimilarity +
      technicalQuality * customWeights.technicalQuality
    ).toFixed(2);
  };

  // Recalculate all scores when weights change
  const recalculatedResults = batchResults
    .map((result) => ({
      ...result,
      weightedScore: parseFloat(calculateWeightedScore(result.evaluation)),
    }))
    .sort((a, b) => b.weightedScore - a.weightedScore);

  const evaluateBatch = async () => {
    if (trainingData.length === 0) {
      setError("No training samples available for evaluation");
      return;
    }

    if (!customPrompt.trim()) {
      setError("Please enter an evaluation prompt");
      return;
    }

    setLoading(true);
    setError("");
    setBatchResults([]);

    try {
      console.log(
        `🔍 Starting batch evaluation of ${trainingData.length} training samples...`
      );

      const evaluateIndividualSample = async (sample, index) => {
        const response = await fetch(
          "http://localhost:3001/api/evaluate-gpt4-vision",
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              generatedImageUrl: sample.geminiImage.url,
              referenceImageUrl: sample.openaiImage.url,
              customPrompt: customPrompt,
            }),
          }
        );

        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }

        const data = await response.json();
        const weightedScore = calculateWeightedScore(data.evaluation);

        return {
          sampleId: sample.id,
          sampleName: sample.name,
          index: index + 1,
          evaluation: data.evaluation,
          weightedScore: parseFloat(weightedScore),
          generatedImageUrl: sample.geminiImage.url,
          referenceImageUrl: sample.openaiImage.url,
        };
      };

      const results = await Promise.allSettled(
        trainingData.map((sample, index) =>
          evaluateIndividualSample(sample, index)
        )
      );

      const successful = results
        .filter((result) => result.status === "fulfilled")
        .map((result) => result.value);

      const failed = results.filter((result) => result.status === "rejected");

      console.log(
        `🎯 Batch evaluation complete: ${successful.length} successful, ${failed.length} failed`
      );

      if (failed.length > 0) {
        console.warn(
          "Failed evaluations:",
          failed.map((f) => f.reason)
        );
      }

      setBatchResults(
        successful.sort((a, b) => b.weightedScore - a.weightedScore)
      );
    } catch (err) {
      setError(`Batch evaluation failed: ${err.message}`);
      console.error("Batch evaluation error:", err);
    } finally {
      setLoading(false);
    }
  };

  const getScoreColor = (score) => {
    if (score >= 8) return "text-green-600";
    if (score >= 6) return "text-yellow-600";
    return "text-red-600";
  };

  const renderWeightControls = () => (
    <div className="bg-gray-50 p-4 rounded-lg">
      <h4 className="text-sm font-medium text-gray-700 mb-3 flex items-center">
        <Settings className="mr-2" size={16} />
        Scoring Weights
      </h4>
      <div className="grid grid-cols-3 gap-4">
        <div>
          <label className="block text-xs text-gray-600 mb-1">
            Visual Appeal
          </label>
          <input
            type="number"
            min="0"
            max="1"
            step="0.1"
            value={weights.visualAppeal}
            onChange={(e) =>
              setWeights((prev) => ({
                ...prev,
                visualAppeal: parseFloat(e.target.value) || 0,
              }))
            }
            className="w-full px-2 py-1 text-sm border rounded"
          />
        </div>
        <div>
          <label className="block text-xs text-gray-600 mb-1">
            Style Similarity
          </label>
          <input
            type="number"
            min="0"
            max="1"
            step="0.1"
            value={weights.styleSimilarity}
            onChange={(e) =>
              setWeights((prev) => ({
                ...prev,
                styleSimilarity: parseFloat(e.target.value) || 0,
              }))
            }
            className="w-full px-2 py-1 text-sm border rounded"
          />
        </div>
        <div>
          <label className="block text-xs text-gray-600 mb-1">
            Technical Quality
          </label>
          <input
            type="number"
            min="0"
            max="1"
            step="0.1"
            value={weights.technicalQuality}
            onChange={(e) =>
              setWeights((prev) => ({
                ...prev,
                technicalQuality: parseFloat(e.target.value) || 0,
              }))
            }
            className="w-full px-2 py-1 text-sm border rounded"
          />
        </div>
      </div>
      <p className="text-xs text-gray-500 mt-2">
        Total weight:{" "}
        {(
          weights.visualAppeal +
          weights.styleSimilarity +
          weights.technicalQuality
        ).toFixed(1)}
      </p>
    </div>
  );

  return (
    <div className="flex flex-col bg-gray-100">
      <div className="flex-1 flex overflow-hidden">
        {/* Left Panel - Configuration */}
        <div className="w-1/2 bg-white shadow-sm p-6 overflow-y-auto">
          <h2 className="text-xl font-bold text-gray-800 mb-6 flex items-center">
            <Trophy className="mr-2" size={24} />
            Evaluation Test
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
            <p className="text-xs text-gray-500 mt-1">
              {loadingData
                ? "Loading..."
                : `${trainingData.length} samples ready for evaluation (OpenAI vs Gemini)`}
            </p>
          </div>

          {/* Evaluation Prompt */}
          <div className="mb-6">
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Evaluation Prompt
            </label>
            <textarea
              value={customPrompt}
              onChange={(e) => setCustomPrompt(e.target.value)}
              className="w-full h-40 px-3 py-2 border border-gray-300 rounded resize-none focus:ring-1 focus:ring-blue-500"
              placeholder="Enter your evaluation criteria..."
            />
          </div>

          {/* Prompt Management */}
          <div className="mb-6">
            <div className="flex gap-2 mb-3">
              <input
                type="text"
                value={promptName}
                onChange={(e) => setPromptName(e.target.value)}
                placeholder="Prompt name..."
                className="flex-1 px-3 py-2 border border-gray-300 rounded focus:ring-1 focus:ring-blue-500"
              />
              <button
                onClick={savePrompt}
                className="px-3 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 flex items-center"
              >
                <Save size={16} />
              </button>
            </div>

            {savedPrompts.length > 0 && (
              <div className="space-y-1">
                <p className="text-xs text-gray-600">Saved Prompts:</p>
                {savedPrompts.map((prompt, index) => (
                  <div
                    key={prompt.id || index}
                    className="flex items-center gap-1"
                  >
                    <button
                      onClick={() => loadPrompt(prompt)}
                      className="flex-1 text-left px-2 py-1 text-xs bg-gray-50 hover:bg-gray-100 rounded"
                    >
                      {prompt.name}
                    </button>
                    <button
                      onClick={() => deletePrompt(prompt.id)}
                      className="px-1 py-1 text-red-500 hover:bg-red-50 rounded"
                      title="Delete prompt"
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Scoring Weights */}
          {renderWeightControls()}

          {/* Evaluate Button */}
          <button
            onClick={evaluateBatch}
            disabled={
              loading || trainingData.length === 0 || !customPrompt.trim()
            }
            className={`w-full mt-6 mb-4 px-4 py-3 rounded font-medium transition-colors flex items-center justify-center ${
              loading || trainingData.length === 0 || !customPrompt.trim()
                ? "bg-gray-300 text-gray-500 cursor-not-allowed"
                : "bg-green-600 text-white hover:bg-green-700"
            }`}
          >
            {loading ? (
              <>
                <Loader2 className="animate-spin mr-2" size={18} />
                Evaluating...
              </>
            ) : (
              <>
                <Play className="mr-2" size={18} />
                Evaluate All Samples
              </>
            )}
          </button>
        </div>

        {/* Right Panel - Results */}
        <div className="flex-1 bg-white shadow-sm overflow-hidden">
          <div className="h-full flex flex-col">
            <div className="p-6 border-b">
              <h3 className="text-lg font-semibold text-gray-800 flex items-center">
                <BarChart3 className="mr-2" size={20} />
                Evaluation Results
                {recalculatedResults.length > 0 && (
                  <span className="ml-2 text-sm text-gray-500">
                    ({recalculatedResults.length} samples)
                  </span>
                )}
              </h3>
            </div>

            <div className="flex-1 overflow-y-auto p-6 pb-24">
              {recalculatedResults.length === 0 ? (
                <div className="text-center text-gray-500 mt-12">
                  <Trophy size={48} className="mx-auto mb-4 text-gray-300" />
                  <p>No evaluations yet</p>
                  <p className="text-sm">
                    Select a training data set and click "Evaluate All Samples"
                    to get started
                  </p>
                </div>
              ) : (
                <div className="space-y-4">
                  {recalculatedResults.map((result, index) => (
                    <div
                      key={result.sampleId}
                      className="border rounded-lg p-4"
                    >
                      <div className="flex items-center justify-between mb-3">
                        <div className="flex items-center">
                          <span className="text-lg font-semibold text-gray-800">
                            #{index + 1} {result.sampleName}
                          </span>
                          <span
                            className={`ml-3 text-2xl font-bold ${getScoreColor(
                              result.weightedScore
                            )}`}
                          >
                            {result.weightedScore}
                          </span>
                        </div>
                      </div>

                      <div className="grid grid-cols-2 gap-4 mb-3">
                        <div>
                          <p className="text-xs text-gray-600 mb-1">
                            Generated (Gemini)
                          </p>
                          <img
                            src={result.generatedImageUrl}
                            alt="Generated"
                            className="w-full h-32 object-cover rounded border"
                          />
                        </div>
                        <div>
                          <p className="text-xs text-gray-600 mb-1">
                            Reference (OpenAI)
                          </p>
                          <img
                            src={result.referenceImageUrl}
                            alt="Reference"
                            className="w-full h-32 object-cover rounded border"
                          />
                        </div>
                      </div>

                      {result.evaluation && (
                        <div className="grid grid-cols-3 gap-4 text-sm">
                          <div>
                            <span className="text-gray-600">
                              Visual Appeal:
                            </span>
                            <span
                              className={`ml-1 font-medium ${getScoreColor(
                                result.evaluation.visualAppeal
                              )}`}
                            >
                              {result.evaluation.visualAppeal}
                            </span>
                          </div>
                          <div>
                            <span className="text-gray-600">
                              Style Similarity:
                            </span>
                            <span
                              className={`ml-1 font-medium ${getScoreColor(
                                result.evaluation.styleSimilarity
                              )}`}
                            >
                              {result.evaluation.styleSimilarity}
                            </span>
                          </div>
                          <div>
                            <span className="text-gray-600">
                              Technical Quality:
                            </span>
                            <span
                              className={`ml-1 font-medium ${getScoreColor(
                                result.evaluation.technicalQuality
                              )}`}
                            >
                              {result.evaluation.technicalQuality}
                            </span>
                          </div>
                        </div>
                      )}

                      {result.evaluation?.reasoning && (
                        <div className="mt-3 p-2 bg-gray-50 rounded">
                          <p className="text-xs text-gray-700">
                            {result.evaluation.reasoning}
                          </p>
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

export default EvaluationTester;
