import { useState } from 'react'
import { Star, User } from 'lucide-react'

export default function ManualRatingConfig({ config, onChange }) {
  const [currentConfig, setCurrentConfig] = useState({
    rating_scale: 10,
    require_comments: false,
    rating_criteria: [
      'Overall quality',
      'Adherence to prompt',
      'Visual appeal'
    ],
    batch_review: true,
    auto_pause: true,
    ...config
  })

  const updateConfig = (key, value) => {
    const newConfig = { ...currentConfig, [key]: value }
    setCurrentConfig(newConfig)
    onChange(newConfig)
  }

  const addCriterion = () => {
    const newCriteria = [...currentConfig.rating_criteria, '']
    updateConfig('rating_criteria', newCriteria)
  }

  const updateCriterion = (index, value) => {
    const newCriteria = [...currentConfig.rating_criteria]
    newCriteria[index] = value
    updateConfig('rating_criteria', newCriteria)
  }

  const removeCriterion = (index) => {
    if (currentConfig.rating_criteria.length > 1) {
      const newCriteria = currentConfig.rating_criteria.filter((_, i) => i !== index)
      updateConfig('rating_criteria', newCriteria)
    }
  }

  return (
    <div className="bg-gray-50 rounded-lg p-4 space-y-4">
      <div className="flex items-center gap-2 text-sm font-medium text-gray-700">
        <User className="h-4 w-4" />
        Manual Rating Configuration
      </div>

      {/* Rating Scale */}
      <div>
        <label className="block text-xs font-medium text-gray-600 mb-1">
          Rating Scale
        </label>
        <select
          value={currentConfig.rating_scale}
          onChange={(e) => updateConfig('rating_scale', parseInt(e.target.value))}
          className="w-full px-3 py-1 text-sm border border-gray-300 rounded focus:ring-1 focus:ring-blue-500"
        >
          <option value={5}>1-5 Stars</option>
          <option value={10}>1-10 Points</option>
          <option value={100}>1-100 Percentage</option>
        </select>
        <p className="text-xs text-gray-500 mt-1">
          {currentConfig.rating_scale === 5 && 'Simple 5-star rating system'}
          {currentConfig.rating_scale === 10 && 'Detailed 10-point scoring system'}
          {currentConfig.rating_scale === 100 && 'Percentage-based rating (0-100)'}
        </p>
      </div>

      {/* Rating Criteria */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <label className="text-xs font-medium text-gray-600">
            Rating Criteria
          </label>
          <button
            onClick={addCriterion}
            className="px-2 py-1 text-xs bg-blue-500 text-white rounded hover:bg-blue-600"
          >
            + Add
          </button>
        </div>
        <div className="space-y-2">
          {currentConfig.rating_criteria.map((criterion, index) => (
            <div key={index} className="flex gap-2">
              <input
                type="text"
                value={criterion}
                onChange={(e) => updateCriterion(index, e.target.value)}
                placeholder={`Criterion ${index + 1}`}
                className="flex-1 px-3 py-1 text-sm border border-gray-300 rounded focus:ring-1 focus:ring-blue-500"
              />
              {currentConfig.rating_criteria.length > 1 && (
                <button
                  onClick={() => removeCriterion(index)}
                  className="px-2 py-1 text-xs bg-red-500 text-white rounded hover:bg-red-600"
                >
                  ×
                </button>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Review Settings */}
      <div>
        <label className="block text-xs font-medium text-gray-600 mb-2">
          Review Settings
        </label>
        <div className="space-y-2">
          <div className="flex items-center">
            <input
              type="checkbox"
              id="require_comments"
              checked={currentConfig.require_comments}
              onChange={(e) => updateConfig('require_comments', e.target.checked)}
              className="mr-2"
            />
            <label htmlFor="require_comments" className="text-xs text-gray-600">
              Require comments for low ratings
            </label>
          </div>
          <div className="flex items-center">
            <input
              type="checkbox"
              id="batch_review"
              checked={currentConfig.batch_review}
              onChange={(e) => updateConfig('batch_review', e.target.checked)}
              className="mr-2"
            />
            <label htmlFor="batch_review" className="text-xs text-gray-600">
              Review images in batches
            </label>
          </div>
          <div className="flex items-center">
            <input
              type="checkbox"
              id="auto_pause"
              checked={currentConfig.auto_pause}
              onChange={(e) => updateConfig('auto_pause', e.target.checked)}
              className="mr-2"
            />
            <label htmlFor="auto_pause" className="text-xs text-gray-600">
              Auto-pause for manual review after each iteration
            </label>
          </div>
        </div>
      </div>

      {/* Preview */}
      <div>
        <label className="block text-xs font-medium text-gray-600 mb-2">
          Rating Preview
        </label>
        <div className="bg-white rounded p-3 border border-gray-200">
          <div className="text-xs text-gray-600 mb-2">Sample rating interface:</div>
          <div className="space-y-2">
            {currentConfig.rating_criteria.map((criterion, index) => (
              <div key={index} className="flex items-center justify-between">
                <span className="text-xs text-gray-700">{criterion || `Criterion ${index + 1}`}</span>
                <div className="flex items-center gap-1">
                  {currentConfig.rating_scale === 5 && (
                    <div className="flex">
                      {[1, 2, 3, 4, 5].map((star) => (
                        <Star key={star} className="h-3 w-3 text-gray-300" />
                      ))}
                    </div>
                  )}
                  {currentConfig.rating_scale === 10 && (
                    <div className="text-xs text-gray-400">1-10</div>
                  )}
                  {currentConfig.rating_scale === 100 && (
                    <div className="text-xs text-gray-400">0-100%</div>
                  )}
                </div>
              </div>
            ))}
            {currentConfig.require_comments && (
              <div className="mt-2">
                <div className="text-xs text-gray-600 mb-1">Comments (required for low ratings):</div>
                <div className="w-full h-6 bg-gray-100 rounded border text-xs text-gray-400 px-2 py-1">
                  Comment field...
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="text-xs text-gray-500 bg-blue-50 p-3 rounded border border-blue-200">
        <strong>How it works:</strong> The iteration will pause after each batch for you to manually rate the generated images. 
        Your ratings will guide the next iteration to produce better results based on your preferences.
      </div>
    </div>
  )
}