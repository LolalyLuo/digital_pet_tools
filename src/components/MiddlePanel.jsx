import { useState } from 'react'
import { Edit3, Sparkles, Image as ImageIcon, Plus, Trash2 } from 'lucide-react'
import { useImageGeneration } from '../hooks/useImageGeneration'

export default function MiddlePanel({ 
  selectedPhotos, 
  generatedPrompts, 
  setGeneratedPrompts,
  results,
  setResults 
}) {
  const [initialPrompt, setInitialPrompt] = useState('')
  const [variationCount, setVariationCount] = useState(3)
  const [editingPromptId, setEditingPromptId] = useState(null)
  const [editingText, setEditingText] = useState('')
  const [newPromptText, setNewPromptText] = useState('')
  
  const { 
    generatePrompts, 
    generateImages, 
    isGeneratingPrompts, 
    isGeneratingImages,
    error,
    clearError 
  } = useImageGeneration()

  const handleGeneratePrompts = async () => {
    if (!initialPrompt.trim()) return
    
    const prompts = await generatePrompts(initialPrompt, variationCount)
    if (prompts.length > 0) {
      const maxId = generatedPrompts.length > 0 ? Math.max(...generatedPrompts.map(p => p.id)) : -1
      setGeneratedPrompts(prev => [
        ...prev,
        ...prompts.map((prompt, index) => ({
          id: maxId + index + 1,
          text: prompt,
          original: prompt
        }))
      ])
    }
  }

  const handleAddPrompt = () => {
    if (!newPromptText.trim()) return
    
    const maxId = generatedPrompts.length > 0 ? Math.max(...generatedPrompts.map(p => p.id)) : -1
    const newPrompt = {
      id: maxId + 1,
      text: newPromptText.trim(),
      original: newPromptText.trim()
    }
    
    setGeneratedPrompts(prev => [...prev, newPrompt])
    setNewPromptText('')
  }

  const handleDeletePrompt = (promptId) => {
    setGeneratedPrompts(prev => prev.filter(p => p.id !== promptId))
  }

  const handleGenerateImages = async () => {
    if (selectedPhotos.length === 0 || generatedPrompts.length === 0) return
    
    const prompts = generatedPrompts.map(p => p.text)
    const newResults = await generateImages(selectedPhotos, prompts)
    
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

  const canGenerateImages = selectedPhotos.length > 0 && generatedPrompts.length > 0

  return (
    <div className="w-[25%] bg-white px-6 py-6 flex flex-col">
      <h2 className="text-lg font-semibold mb-6">Prompts</h2>
      
      {/* Error Display */}
      {error && (
        <div className="mb-4 p-3 bg-red-100 border border-red-300 text-red-700 rounded">
          <div className="flex justify-between items-center">
            <span>{error}</span>
            <button onClick={clearError} className="text-red-500 hover:text-red-700">
              ×
            </button>
          </div>
        </div>
      )}
      
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
      
      {/* Variation Count */}
      <div className="mb-6">
        <label className="block text-sm font-medium text-gray-700 mb-2">
          Number of Variations
        </label>
        <input
          type="number"
          min="1"
          max="10"
          value={variationCount}
          onChange={(e) => setVariationCount(parseInt(e.target.value) || 1)}
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
      
      {/* Generated Prompts List */}
      {generatedPrompts.length > 0 && (
        <div className="mb-6">
          <h3 className="text-md font-medium text-gray-700 mb-3">
            Generated Prompts ({generatedPrompts.length})
          </h3>
          <div className="space-y-2">
            {generatedPrompts.map((prompt) => (
              <div key={prompt.id} className="flex items-center gap-2 p-2 border border-gray-200 rounded">
                {editingPromptId === prompt.id ? (
                  <>
                    <input
                      type="text"
                      value={editingText}
                      onChange={(e) => setEditingText(e.target.value)}
                      className="flex-1 px-2 py-1 border border-gray-300 rounded text-sm"
                      autoFocus
                    />
                    <button
                      onClick={saveEdit}
                      className="px-2 py-1 text-xs bg-green-500 text-white rounded hover:bg-green-600"
                    >
                      Save
                    </button>
                    <button
                      onClick={cancelEdit}
                      className="px-2 py-1 text-xs bg-gray-500 text-white rounded hover:bg-gray-600"
                    >
                      Cancel
                    </button>
                  </>
                ) : (
                  <>
                    <span className="flex-1 text-sm">{prompt.text}</span>
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
                  </>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
      
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
          />
          <button
            onClick={handleAddPrompt}
            disabled={!newPromptText.trim() || isGeneratingPrompts}
            className="px-4 py-2 bg-blue-500 text-white rounded-md hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
          >
            {isGeneratingPrompts ? (
              <>
                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                Adding...
              </>
            ) : (
              <>
                <Plus className="h-4 w-4" />
                Add Prompt
              </>
            )}
          </button>
        </div>
      </div>

      {/* Delete Prompts Button */}
      {generatedPrompts.length > 0 && (
        <button
          onClick={() => generatedPrompts.forEach(p => handleDeletePrompt(p.id))}
          disabled={isGeneratingPrompts}
          className="mb-4 px-4 py-2 bg-red-500 text-white rounded-md hover:bg-red-600 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
        >
          {isGeneratingPrompts ? (
            <>
              <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
              Deleting...
            </>
          ) : (
            <>
              <Trash2 className="h-4 w-4" />
              Delete All Prompts
            </>
          )}
        </button>
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
      
      {/* Status Info */}
      <div className="mt-4 text-sm text-gray-500">
        <p>Photos selected: {selectedPhotos.length}</p>
        <p>Prompts ready: {generatedPrompts.length}</p>
        <p>Total results: {results.length}</p>
      </div>
    </div>
  )
}
