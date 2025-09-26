import { useState, useEffect } from 'react'
import { Edit3, Sparkles, Image as ImageIcon, Plus, Trash2, Copy, Check } from 'lucide-react'
import { useImageGeneration } from '../hooks/useImageGeneration'

export default function MiddlePanel({
  selectedPhotos,
  generatedPrompts,
  setGeneratedPrompts,
  results,
  setResults
}) {
  const [initialPrompt, setInitialPrompt] = useState('')
  const [variationCount, setVariationCount] = useState('') // Allow empty string
  const [editingPromptId, setEditingPromptId] = useState(null)
  const [editingText, setEditingText] = useState('')
  const [newPromptText, setNewPromptText] = useState('')
  const [copiedId, setCopiedId] = useState(null)
  const [selectedSize, setSelectedSize] = useState('auto')
  const [selectedBackground, setSelectedBackground] = useState('opaque')
  const [selectedModel, setSelectedModel] = useState('gemini-img2img')
  const [templateNumbers, setTemplateNumbers] = useState('113, 202, 193, 303, 139, 205, 17, 280, 169, 543, 449, 266, 64, 307, 293, 157, 286, 61, 290, 294')

  const {
    generatePrompts,
    generateImages,
    isGeneratingPrompts,
    isGeneratingImages,
    error,
    clearError,
    resetStates
  } = useImageGeneration()

  // Reset states when component mounts to handle refresh issues
  useEffect(() => {
    resetStates()
  }, [])

  const handleGeneratePrompts = async () => {
    if (!initialPrompt.trim()) return

    // Clear existing prompts immediately when starting generation
    setGeneratedPrompts([])

    // Use 3 as default if variationCount is empty or invalid
    const count = variationCount === '' || isNaN(parseInt(variationCount)) ? 3 : parseInt(variationCount)

    const prompts = await generatePrompts(initialPrompt, count)
    if (prompts.length > 0) {
      // Replace all prompts with new ones from backend
      setGeneratedPrompts(
        prompts.map((prompt, index) => ({
          id: index + 1,
          text: prompt,
          original: prompt
        }))
      )
    }
  }

  const handleAddPrompt = () => {
    if (!newPromptText.trim()) return

    const maxId = generatedPrompts.length > 0 ? Math.max(...generatedPrompts.map(p => p.id)) : 0
    const newPrompt = {
      id: maxId + 1,
      text: newPromptText.trim(),
      original: newPromptText.trim()
    }

    setGeneratedPrompts(prev => [newPrompt, ...prev])
    setNewPromptText('')
  }

  const handleDeletePrompt = (promptId) => {
    setGeneratedPrompts(prev => prev.filter(p => p.id !== promptId))
  }

  const handleDeleteAllPrompts = () => {
    setGeneratedPrompts([])
  }

  const handleGenerateImages = async () => {
    // For img2img, we don't need prompts, just photos and template numbers
    if (selectedModel === 'gemini-img2img') {
      if (selectedPhotos.length === 0) {
        alert('Please select at least one pet photo for image-to-image generation')
        return
      }

      if (!templateNumbers.trim()) {
        alert('Please enter template image numbers for Gemini Image-to-Image mode')
        return
      }

      const numbers = templateNumbers.split(/[,\s]+/).map(n => n.trim()).filter(n => n !== '')
      if (numbers.length === 0 || numbers.some(n => isNaN(parseInt(n)))) {
        alert('Please enter valid template image numbers (e.g., 212, 185, 12)')
        return
      }
    } else {
      // For regular generation, we need both photos and prompts
      if (selectedPhotos.length === 0 || generatedPrompts.length === 0) return
    }

    // For img2img, we use a default prompt since the task is predefined
    const prompts = selectedModel === 'gemini-img2img'
      ? ['Replace the pet in the template with the user\'s pet while preserving the template\'s style']
      : generatedPrompts.map(p => p.text)

    // Convert size from '×' to 'x' for API compatibility
    const apiSize = selectedSize === 'auto' ? 'auto' : selectedSize.replace('×', 'x')

    // Create arrays for sizes and backgrounds (same value for all prompts)
    const sizes = prompts.map(() => apiSize)
    const backgrounds = prompts.map(() => selectedBackground)

    // Prepare additional parameters for img2img
    const additionalParams = selectedModel === 'gemini-img2img' ? {
      templateNumbers: templateNumbers.split(/[,\s]+/).map(n => n.trim()).filter(n => n !== '').map(n => parseInt(n))
    } : {}

    const newResults = await generateImages(selectedPhotos, prompts, apiSize, selectedBackground, selectedModel, additionalParams, sizes, backgrounds)

    if (newResults.length > 0) {
      setResults(prev => [...prev, ...newResults])
    }
  }

  const startEditing = (prompt) => {
    setEditingPromptId(prompt.id)
    setEditingText(prompt.text)
  }

  const saveEdit = () => {
    setGeneratedPrompts(prev =>
      prev.map(p =>
        p.id === editingPromptId
          ? { ...p, text: editingText }
          : p
      )
    )
    setEditingPromptId(null)
    setEditingText('')
  }

  const cancelEdit = () => {
    setEditingPromptId(null)
    setEditingText('')
  }

  const resetToOriginal = (promptId) => {
    setGeneratedPrompts(prev =>
      prev.map(p =>
        p.id === promptId
          ? { ...p, text: p.original }
          : p
      )
    )
  }

  const copyToClipboard = async (text, promptId) => {
    try {
      await navigator.clipboard.writeText(text)
      setCopiedId(promptId)
      setTimeout(() => setCopiedId(null), 2000)
    } catch (err) {
      console.error('Failed to copy text: ', err)
    }
  }

  const canGenerateImages = selectedModel === 'gemini-img2img'
    ? selectedPhotos.length > 0 && templateNumbers.trim() !== ''
    : selectedPhotos.length > 0 && generatedPrompts.length > 0

  return (
    <div className="w-[25%] bg-white px-6 py-6 flex flex-col overflow-y-auto max-h-screen">
      <h2 className="text-lg font-semibold mb-6">Prompts</h2>

      {/* Error Display */}
      {error && (
        <div className="mb-4 p-3 bg-red-100 border border-red-300 text-red-700 rounded">
          <div className="flex justify-between items-center">
            <span>{error}</span>
            <div className="flex gap-2">
              <button onClick={clearError} className="text-red-500 hover:text-red-700">
                ×
              </button>
              <button onClick={resetStates} className="text-red-500 hover:text-red-700 text-sm">
                Reset
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Prompt Generation Section - Only show for non-img2img models */}
      {selectedModel !== 'gemini-img2img' && (
        <>
          {/* Initial Prompt Input */}
          <div className="mb-6">
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Initial Art Style Prompt
            </label>
            <input
              type="text"
              value={initialPrompt}
              onChange={(e) => setInitialPrompt(e.target.value)}
              placeholder="e.g., watercolor painting style, vintage poster art, minimalist line art"
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          {/* Variation Count - Allow empty and any positive number */}
          <div className="mb-6">
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Number of Variations (default: 3)
            </label>
            <input
              type="number"
              min="1"
              value={variationCount}
              onChange={(e) => setVariationCount(e.target.value)}
              placeholder="3"
              className="w-32 px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          {/* Generate Prompts Button */}
          <button
            onClick={handleGeneratePrompts}
            disabled={!initialPrompt.trim() || isGeneratingPrompts}
            className="mb-6 px-4 py-2 bg-purple-500 text-white rounded-md hover:bg-purple-600 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
          >
            {isGeneratingPrompts ? (
              <>
                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                Generating...
              </>
            ) : (
              <>
                <Sparkles className="h-4 w-4" />
                Generate Prompts
              </>
            )}
          </button>

          {/* Add New Prompt Input */}
          <div className="mb-6">
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Add New Prompt
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                value={newPromptText}
                onChange={(e) => setNewPromptText(e.target.value)}
                placeholder="e.g., surrealism, hyper-realism, abstract"
                className="flex-1 px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                onKeyPress={(e) => {
                  if (e.key === 'Enter' && newPromptText.trim()) {
                    handleAddPrompt()
                  }
                }}
              />
              <button
                onClick={handleAddPrompt}
                disabled={!newPromptText.trim()}
                className="px-4 py-2 bg-blue-500 text-white rounded-md hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              >
                <Plus className="h-4 w-4" />
                Add
              </button>
            </div>
          </div>

          {/* Generated Prompts List - Scrollable Area */}
          {generatedPrompts.length > 0 && (
            <div className="mb-6 flex-1 flex flex-col min-h-0">
              <div className="flex justify-between items-center mb-3">
                <h3 className="text-md font-medium text-gray-700">
                  Generated Prompts ({generatedPrompts.length})
                </h3>
                <button
                  onClick={handleDeleteAllPrompts}
                  disabled={isGeneratingPrompts}
                  className="px-2 py-1 text-xs bg-red-500 text-white rounded hover:bg-red-600 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1"
                >
                  <Trash2 className="h-3 w-3" />
                  Clear All
                </button>
              </div>

              {/* Scrollable container for prompts */}
              <div className="flex-1 overflow-y-auto space-y-2 pr-2 min-h-0">
                {generatedPrompts.map((prompt) => (
                  <div key={prompt.id} className="flex items-start gap-2 p-3 border border-gray-200 rounded bg-gray-50">
                    {editingPromptId === prompt.id ? (
                      <div className="w-full">
                        <textarea
                          value={editingText}
                          onChange={(e) => setEditingText(e.target.value)}
                          className="w-full px-2 py-2 border border-gray-300 rounded text-sm bg-white resize-none mb-2"
                          rows={Math.max(3, Math.ceil(editingText.length / 50))}
                          autoFocus
                        />
                        <div className="flex gap-2">
                          <button
                            onClick={saveEdit}
                            className="px-3 py-1 text-xs bg-green-500 text-white rounded hover:bg-green-600"
                          >
                            Save
                          </button>
                          <button
                            onClick={cancelEdit}
                            className="px-3 py-1 text-xs bg-gray-500 text-white rounded hover:bg-gray-600"
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    ) : (
                      <>
                        <div className="flex-1 text-sm text-gray-800 leading-relaxed break-words whitespace-pre-wrap">
                          {prompt.text}
                        </div>
                        <div className="flex flex-col gap-1 flex-shrink-0">
                          <button
                            onClick={() => copyToClipboard(prompt.text, prompt.id)}
                            className="p-1 text-gray-400 hover:text-gray-600"
                            title="Copy prompt"
                          >
                            {copiedId === prompt.id ? (
                              <Check className="h-3 w-3 text-green-500" />
                            ) : (
                              <Copy className="h-3 w-3" />
                            )}
                          </button>
                          <button
                            onClick={() => startEditing(prompt)}
                            className="p-1 text-gray-400 hover:text-gray-600"
                            title="Edit prompt"
                          >
                            <Edit3 className="h-3 w-3" />
                          </button>
                          {prompt.text !== prompt.original && (
                            <button
                              onClick={() => resetToOriginal(prompt.id)}
                              className="px-2 py-1 text-xs bg-gray-300 text-gray-700 rounded hover:bg-gray-400"
                              title="Reset to original"
                            >
                              Reset
                            </button>
                          )}
                          <button
                            onClick={() => handleDeletePrompt(prompt.id)}
                            className="p-1 text-red-400 hover:text-red-600"
                            title="Delete prompt"
                          >
                            <Trash2 className="h-3 w-3" />
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}

      {/* Info message for img2img mode */}
      {selectedModel === 'gemini-img2img' && (
        <div className="mb-6 p-4 bg-blue-50 border border-blue-200 rounded-md">
          <div className="flex items-start gap-2">
            <div className="text-blue-500 mt-0.5">
              <ImageIcon className="h-4 w-4" />
            </div>
            <div>
              <h4 className="text-sm font-medium text-blue-800">Image-to-Image Mode</h4>
              <p className="text-sm text-blue-700 mt-1">
                This mode will replace the pet in your selected template images with your pet photo while preserving the template's style, pose, and setting. No custom prompts needed!
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Generate Images Button */}
      <button
        onClick={handleGenerateImages}
        disabled={!canGenerateImages || isGeneratingImages}
        className="mt-auto px-6 py-3 bg-blue-500 text-white rounded-md hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 text-lg"
      >
        {isGeneratingImages ? (
          <>
            <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white"></div>
            Generating Images...
          </>
        ) : (
          <>
            <ImageIcon className="h-5 w-5" />
            Generate Images
          </>
        )}
      </button>

      {/* Size, Background, and Model Selection */}
      <div className="mt-4 space-y-3">
        {/* Model Dropdown */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            AI Model
          </label>
          <select
            value={selectedModel}
            onChange={(e) => setSelectedModel(e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
          >
            <option value="openai">OpenAI</option>
            <option value="gemini">Google Gemini</option>
            <option value="gemini-img2img">Gemini Image-to-Image</option>
            <option value="seedream">SeeDream</option>
          </select>
        </div>

        {/* Size Dropdown */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Image Size
          </label>
          <select
            value={selectedSize}
            onChange={(e) => setSelectedSize(e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
          >
            <option value="auto">Auto</option>
            <option value="1024×1024">1024×1024</option>
            <option value="1024×1536">1024×1536</option>
            <option value="1536×1024">1536×1024</option>
          </select>
        </div>

        {/* Background Dropdown */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Background
          </label>
          <select
            value={selectedBackground}
            onChange={(e) => setSelectedBackground(e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
          >
            <option value="opaque">Opaque</option>
            <option value="transparent">Transparent</option>
            <option value="auto">Auto</option>
          </select>
        </div>

        {/* Template Numbers Input - Only show for Gemini Image-to-Image */}
        {selectedModel === 'gemini-img2img' && (
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Template Image Numbers
            </label>
            <input
              type="text"
              value={templateNumbers}
              onChange={(e) => setTemplateNumbers(e.target.value)}
              placeholder="e.g., 212, 185, 12"
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
            />
            <p className="text-xs text-gray-500 mt-1">
              Enter comma-separated numbers corresponding to template images from your generated images
            </p>
          </div>
        )}
      </div>

      {/* Status Info */}
      <div className="mt-4 text-sm text-gray-500">
        <p>Photos selected: {selectedPhotos.length}</p>
        <p>Prompts ready: {generatedPrompts.length}</p>
        <p>Total results: {results.length}</p>
      </div>
    </div>
  )
}