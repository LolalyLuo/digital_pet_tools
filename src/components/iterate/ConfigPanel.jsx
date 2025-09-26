import { useState, useEffect } from 'react'
import { Settings, Save, FolderOpen } from 'lucide-react'
import PhotoBundleSelector from './bundles/PhotoBundleSelector'
import LLMScoringConfig from './evaluation/LLMScoringConfig'
import PhotoMatchingConfig from './evaluation/PhotoMatchingConfig'
import ManualRatingConfig from './evaluation/ManualRatingConfig'

export default function ConfigPanel({ currentConfig, onConfigChange, onStartIteration, isRunning }) {
  const [config, setConfig] = useState({
    name: '',
    evaluation_criteria: {
      type: 'llm_scoring',
      config: {}
    },
    source_photo_bundles: [],
    generation_method: {
      type: 'gemini',
      config: {
        temperature: 0.8,
        size: '1024x1024',
        background: 'transparent'
      }
    },
    idea_generation_method: {
      type: 'variation',
      config: {
        variation_strength: 0.3,
        keep_top_percent: 0.2,
        mutation_rate: 0.1
      }
    },
    iteration_settings: {
      max_iterations: 10,
      batch_size: 5,
      timeout_minutes: 30
    }
  })

  const [errors, setErrors] = useState({})

  useEffect(() => {
    if (currentConfig) {
      setConfig(currentConfig)
    }
  }, [currentConfig])

  const updateConfig = (path, value) => {
    setConfig(prev => {
      const newConfig = { ...prev }
      const keys = path.split('.')
      let current = newConfig

      for (let i = 0; i < keys.length - 1; i++) {
        if (!current[keys[i]]) current[keys[i]] = {}
        current = current[keys[i]]
      }

      current[keys[keys.length - 1]] = value
      return newConfig
    })
  }

  const validateConfig = () => {
    const newErrors = {}

    if (!config.name.trim()) {
      newErrors.name = 'Configuration name is required'
    }

    if (!config.source_photo_bundles || config.source_photo_bundles.length === 0) {
      newErrors.photo_bundles = 'At least one photo bundle must be selected'
    }

    if (config.iteration_settings.max_iterations < 1) {
      newErrors.max_iterations = 'Max iterations must be at least 1'
    }

    if (config.iteration_settings.batch_size < 1) {
      newErrors.batch_size = 'Batch size must be at least 1'
    }

    setErrors(newErrors)
    return Object.keys(newErrors).length === 0
  }

  const handleSaveConfig = () => {
    if (validateConfig()) {
      onConfigChange(config)
    }
  }

  const handleStartIteration = () => {
    if (validateConfig()) {
      onConfigChange(config)
      onStartIteration(config)
    }
  }

  const renderEvaluationCriteriaConfig = () => {
    switch (config.evaluation_criteria.type) {
      case 'llm_scoring':
        return (
          <LLMScoringConfig
            config={config.evaluation_criteria.config}
            onChange={(newConfig) => updateConfig('evaluation_criteria.config', newConfig)}
          />
        )
      case 'photo_matching':
        return (
          <PhotoMatchingConfig
            config={config.evaluation_criteria.config}
            onChange={(newConfig) => updateConfig('evaluation_criteria.config', newConfig)}
          />
        )
      case 'manual_rating':
        return (
          <ManualRatingConfig
            config={config.evaluation_criteria.config}
            onChange={(newConfig) => updateConfig('evaluation_criteria.config', newConfig)}
          />
        )
      default:
        return null
    }
  }

  return (
    <div className="p-6 space-y-6">
      {/* Configuration Name */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">
          Configuration Name
        </label>
        <input
          type="text"
          value={config.name}
          onChange={(e) => updateConfig('name', e.target.value)}
          placeholder="e.g., Cute pets optimization"
          className={`w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent ${errors.name ? 'border-red-300' : 'border-gray-300'
            }`}
        />
        {errors.name && <p className="text-red-600 text-xs mt-1">{errors.name}</p>}
      </div>

      {/* Evaluation Criteria */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">
          Evaluation Criteria
        </label>
        <select
          value={config.evaluation_criteria.type}
          onChange={(e) => updateConfig('evaluation_criteria.type', e.target.value)}
          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
        >
          <option value="llm_scoring">LLM Scoring</option>
          <option value="photo_matching">Photo Matching</option>
          <option value="manual_rating">Manual Rating</option>
        </select>

        <div className="mt-3">
          {renderEvaluationCriteriaConfig()}
        </div>
      </div>

      {/* Source Photo Bundles */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">
          Source Photo Bundles
        </label>
        <PhotoBundleSelector
          selectedBundles={config.source_photo_bundles}
          onChange={(bundles) => updateConfig('source_photo_bundles', bundles)}
        />
        {errors.photo_bundles && <p className="text-red-600 text-xs mt-1">{errors.photo_bundles}</p>}
      </div>

      {/* Generation Method */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">
          Generation Method
        </label>
        <select
          value={config.generation_method.type}
          onChange={(e) => updateConfig('generation_method.type', e.target.value)}
          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
        >
          <option value="openai">OpenAI</option>
          <option value="gemini">Google Gemini</option>
          <option value="gemini-img2img">Gemini Image-to-Image</option>
          <option value="seedream">SeeDream</option>
        </select>

        <div className="mt-4 space-y-4">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Temperature</label>
            <input
              type="number"
              min="0"
              max="2"
              step="0.1"
              value={config.generation_method.config.temperature}
              onChange={(e) => updateConfig('generation_method.config.temperature', parseFloat(e.target.value))}
              className="w-full px-3 py-1 text-sm border border-gray-300 rounded focus:ring-1 focus:ring-blue-500"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Size</label>
            <select
              value={config.generation_method.config.size}
              onChange={(e) => updateConfig('generation_method.config.size', e.target.value)}
              className="w-full px-3 py-1 text-sm border border-gray-300 rounded focus:ring-1 focus:ring-blue-500"
            >
              <option value="auto">Auto</option>
              <option value="1024x1024">1024×1024</option>
              <option value="1024x1536">1024×1536</option>
              <option value="1536x1024">1536×1024</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Background</label>
            <select
              value={config.generation_method.config.background}
              onChange={(e) => updateConfig('generation_method.config.background', e.target.value)}
              className="w-full px-3 py-1 text-sm border border-gray-300 rounded focus:ring-1 focus:ring-blue-500"
            >
              <option value="opaque">Opaque</option>
              <option value="transparent">Transparent</option>
              <option value="auto">Auto</option>
            </select>
          </div>
        </div>
      </div>

      {/* Idea Generation Method */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">
          Idea Generation Method
        </label>
        <select
          value={config.idea_generation_method.type}
          onChange={(e) => updateConfig('idea_generation_method.type', e.target.value)}
          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
        >
          <option value="variation">Variation</option>
          <option value="evolutionary">Evolutionary</option>
          <option value="random">Random</option>
          <option value="chain">Chain</option>
        </select>

        <div className="mt-4 space-y-4">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Variation Strength</label>
            <input
              type="number"
              min="0"
              max="1"
              step="0.1"
              value={config.idea_generation_method.config.variation_strength}
              onChange={(e) => updateConfig('idea_generation_method.config.variation_strength', parseFloat(e.target.value))}
              className="w-full px-3 py-1 text-sm border border-gray-300 rounded focus:ring-1 focus:ring-blue-500"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Keep Top Percent</label>
            <input
              type="number"
              min="0"
              max="1"
              step="0.05"
              value={config.idea_generation_method.config.keep_top_percent}
              onChange={(e) => updateConfig('idea_generation_method.config.keep_top_percent', parseFloat(e.target.value))}
              className="w-full px-3 py-1 text-sm border border-gray-300 rounded focus:ring-1 focus:ring-blue-500"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Mutation Rate</label>
            <input
              type="number"
              min="0"
              max="1"
              step="0.05"
              value={config.idea_generation_method.config.mutation_rate}
              onChange={(e) => updateConfig('idea_generation_method.config.mutation_rate', parseFloat(e.target.value))}
              className="w-full px-3 py-1 text-sm border border-gray-300 rounded focus:ring-1 focus:ring-blue-500"
            />
          </div>
        </div>
      </div>

      {/* Iteration Settings */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">
          <Settings className="h-4 w-4 inline mr-2" />
          Iteration Settings
        </label>
        <div className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Max Iterations</label>
            <input
              type="number"
              min="1"
              max="100"
              value={config.iteration_settings.max_iterations}
              onChange={(e) => updateConfig('iteration_settings.max_iterations', parseInt(e.target.value))}
              className={`w-full px-3 py-1 text-sm border rounded focus:ring-1 focus:ring-blue-500 ${errors.max_iterations ? 'border-red-300' : 'border-gray-300'
                }`}
            />
            {errors.max_iterations && <p className="text-red-600 text-xs mt-1">{errors.max_iterations}</p>}
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Batch Size</label>
            <input
              type="number"
              min="1"
              max="20"
              value={config.iteration_settings.batch_size}
              onChange={(e) => updateConfig('iteration_settings.batch_size', parseInt(e.target.value))}
              className={`w-full px-3 py-1 text-sm border rounded focus:ring-1 focus:ring-blue-500 ${errors.batch_size ? 'border-red-300' : 'border-gray-300'
                }`}
            />
            {errors.batch_size && <p className="text-red-600 text-xs mt-1">{errors.batch_size}</p>}
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Timeout (minutes)</label>
            <input
              type="number"
              min="5"
              max="120"
              value={config.iteration_settings.timeout_minutes}
              onChange={(e) => updateConfig('iteration_settings.timeout_minutes', parseInt(e.target.value))}
              className="w-full px-3 py-1 text-sm border border-gray-300 rounded focus:ring-1 focus:ring-blue-500"
            />
          </div>
        </div>
      </div>

      {/* Action Buttons */}
      <div className="pt-6 border-t border-gray-200">
        <div className="space-y-3">
          <button
            onClick={handleSaveConfig}
            disabled={isRunning}
            className="w-full px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
          >
            <Save className="h-4 w-4" />
            Save Configuration
          </button>

          <button
            onClick={handleStartIteration}
            disabled={isRunning || !config.name.trim()}
            className="w-full px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
          >
            <Settings className="h-4 w-4" />
            Save & Start Iteration
          </button>
        </div>
      </div>
    </div>
  )
}