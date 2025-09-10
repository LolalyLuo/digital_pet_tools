import { useState } from 'react'
import { Brain, Plus, Trash2 } from 'lucide-react'

export default function LLMScoringConfig({ config, onChange }) {
  const [currentConfig, setCurrentConfig] = useState({
    model: 'gpt-4',
    prompt: 'Rate this pet image from 1-10 based on cuteness, photo quality, and overall appeal. Provide only a numeric score.',
    criteria: ['cuteness', 'photo_quality', 'overall_appeal'],
    temperature: 0.3,
    max_tokens: 50,
    ...config
  })

  const updateConfig = (key, value) => {
    const newConfig = { ...currentConfig, [key]: value }
    setCurrentConfig(newConfig)
    onChange(newConfig)
  }

  const addCriterion = () => {
    const newCriteria = [...currentConfig.criteria, '']
    updateConfig('criteria', newCriteria)
  }

  const updateCriterion = (index, value) => {
    const newCriteria = [...currentConfig.criteria]
    newCriteria[index] = value
    updateConfig('criteria', newCriteria)
  }

  const removeCriterion = (index) => {
    const newCriteria = currentConfig.criteria.filter((_, i) => i !== index)
    updateConfig('criteria', newCriteria)
  }

  return (
    <div className="bg-gray-50 rounded-lg p-4 space-y-4">
      <div className="flex items-center gap-2 text-sm font-medium text-gray-700">
        <Brain className="h-4 w-4" />
        LLM Scoring Configuration
      </div>

      {/* Model Selection */}
      <div>
        <label className="block text-xs font-medium text-gray-600 mb-1">
          AI Model
        </label>
        <select
          value={currentConfig.model}
          onChange={(e) => updateConfig('model', e.target.value)}
          className="w-full px-3 py-1 text-sm border border-gray-300 rounded focus:ring-1 focus:ring-blue-500"
        >
          <option value="gpt-4">GPT-4</option>
          <option value="gpt-3.5-turbo">GPT-3.5 Turbo</option>
          <option value="claude-3-sonnet">Claude 3 Sonnet</option>
          <option value="gemini-pro">Gemini Pro</option>
        </select>
      </div>

      {/* Scoring Prompt */}
      <div>
        <label className="block text-xs font-medium text-gray-600 mb-1">
          Scoring Prompt
        </label>
        <textarea
          value={currentConfig.prompt}
          onChange={(e) => updateConfig('prompt', e.target.value)}
          placeholder="Enter the prompt that will be used to score images..."
          rows={4}
          className="w-full px-3 py-2 text-sm border border-gray-300 rounded focus:ring-1 focus:ring-blue-500 resize-none"
        />
        <p className="text-xs text-gray-500 mt-1">
          This prompt will be sent to the AI model along with each generated image for scoring.
        </p>
      </div>

      {/* Scoring Criteria */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <label className="text-xs font-medium text-gray-600">
            Scoring Criteria
          </label>
          <button
            onClick={addCriterion}
            className="px-2 py-1 text-xs bg-blue-500 text-white rounded hover:bg-blue-600 flex items-center gap-1"
          >
            <Plus className="h-3 w-3" />
            Add
          </button>
        </div>
        <div className="space-y-2">
          {currentConfig.criteria.map((criterion, index) => (
            <div key={index} className="flex gap-2">
              <input
                type="text"
                value={criterion}
                onChange={(e) => updateCriterion(index, e.target.value)}
                placeholder={`Criterion ${index + 1}`}
                className="flex-1 px-3 py-1 text-sm border border-gray-300 rounded focus:ring-1 focus:ring-blue-500"
              />
              {currentConfig.criteria.length > 1 && (
                <button
                  onClick={() => removeCriterion(index)}
                  className="p-1 text-red-500 hover:text-red-700"
                >
                  <Trash2 className="h-3 w-3" />
                </button>
              )}
            </div>
          ))}
        </div>
        <p className="text-xs text-gray-500 mt-1">
          Define the specific aspects that will be evaluated in each image.
        </p>
      </div>

      {/* Model Parameters */}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">
            Temperature
          </label>
          <input
            type="number"
            min="0"
            max="2"
            step="0.1"
            value={currentConfig.temperature}
            onChange={(e) => updateConfig('temperature', parseFloat(e.target.value))}
            className="w-full px-3 py-1 text-sm border border-gray-300 rounded focus:ring-1 focus:ring-blue-500"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">
            Max Tokens
          </label>
          <input
            type="number"
            min="10"
            max="500"
            value={currentConfig.max_tokens}
            onChange={(e) => updateConfig('max_tokens', parseInt(e.target.value))}
            className="w-full px-3 py-1 text-sm border border-gray-300 rounded focus:ring-1 focus:ring-blue-500"
          />
        </div>
      </div>

      <div className="text-xs text-gray-500 bg-blue-50 p-3 rounded border border-blue-200">
        <strong>How it works:</strong> Each generated image will be sent to the selected AI model with your custom prompt. 
        The model will return a score based on your criteria, which will be used to rank and improve future iterations.
      </div>
    </div>
  )
}