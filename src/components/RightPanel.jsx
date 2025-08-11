import { useState } from 'react'
import { Download, ChevronDown, ChevronRight, Trash2 } from 'lucide-react'

export default function RightPanel({ results, setResults }) {
  const [expandedSections, setExpandedSections] = useState(new Set())
  const [originalPhotos, setOriginalPhotos] = useState({})

  // Group results by prompt
  const groupedResults = results.reduce((acc, result) => {
    const prompt = result.generated_prompt || result.initial_prompt || 'Unknown Prompt'
    if (!acc[prompt]) {
      acc[prompt] = []
    }
    acc[prompt].push(result)
    return acc
  }, {})

  const toggleSection = (prompt) => {
    const newExpanded = new Set(expandedSections)
    if (newExpanded.has(prompt)) {
      newExpanded.delete(prompt)
    } else {
      newExpanded.add(prompt)
    }
    setExpandedSections(newExpanded)
  }

  const expandAll = () => {
    setExpandedSections(new Set(Object.keys(groupedResults)))
  }

  const collapseAll = () => {
    setExpandedSections(new Set())
  }

  const clearAllResults = () => {
    setResults([])
  }

  const downloadImage = async (imageUrl, filename) => {
    try {
      const response = await fetch(imageUrl)
      const blob = await response.blob()
      const url = window.URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = filename || 'generated-image.png'
      document.body.appendChild(a)
      a.click()
      window.URL.revokeObjectURL(url)
      document.body.removeChild(a)
    } catch (error) {
      console.error('Download failed:', error)
    }
  }

  const getOriginalPhotoUrl = async (photoId) => {
    if (originalPhotos[photoId]) {
      return originalPhotos[photoId]
    }
    
    // This would need to be implemented based on your photo storage structure
    // For now, returning a placeholder
    return null
  }

  if (results.length === 0) {
    return (
      <div className="w-96 bg-gray-50 border-l border-gray-200 px-3 py-6">
        <h2 className="text-lg font-semibold mb-4">Results</h2>
        <div className="text-center text-gray-500 mt-8">
          <p>No images generated yet</p>
          <p className="text-sm mt-2">
            Upload photos, generate prompts, and create images to see results here
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="w-96 bg-gray-50 border-l border-gray-200 px-3 py-6 flex flex-col">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold">
          Results ({results.length} images)
        </h2>
        <div className="flex gap-2">
          <button
            onClick={expandAll}
            className="px-2 py-1 text-xs bg-blue-500 text-white rounded hover:bg-blue-600"
          >
            Expand All
          </button>
          <button
            onClick={collapseAll}
            className="px-2 py-1 text-xs bg-gray-500 text-white rounded hover:bg-gray-600"
          >
            Collapse All
          </button>
        </div>
      </div>
      
      <button
        onClick={clearAllResults}
        className="mb-4 px-3 py-1 text-sm bg-red-500 text-white rounded hover:bg-red-600 flex items-center gap-2"
      >
        <Trash2 className="h-4 w-4" />
        Clear All Results
      </button>

      <div className="flex-1 overflow-y-auto">
        {Object.entries(groupedResults).map(([prompt, promptResults]) => {
          const isExpanded = expandedSections.has(prompt)
          
          return (
            <div key={prompt} className="mb-4 border border-gray-200 rounded-lg overflow-hidden">
              {/* Section Header */}
              <button
                onClick={() => toggleSection(prompt)}
                className="w-full p-3 bg-white hover:bg-gray-50 flex items-center justify-between text-left"
              >
                <div className="flex-1">
                  <div className="font-medium text-gray-900 truncate" title={prompt}>
                    {prompt}
                  </div>
                  <div className="text-sm text-gray-500">
                    {promptResults.length} image{promptResults.length !== 1 ? 's' : ''}
                  </div>
                </div>
                {isExpanded ? (
                  <ChevronDown className="h-4 w-4 text-gray-400" />
                ) : (
                  <ChevronRight className="h-4 w-4 text-gray-400" />
                )}
              </button>
              
              {/* Section Content */}
              {isExpanded && (
                <div className="bg-gray-50 p-3">
                  <div className="grid grid-cols-1 gap-3">
                    {promptResults.map((result, index) => (
                      <div key={result.id || index} className="bg-white p-3 rounded border">
                        <div className="flex gap-3">
                          {/* Original Photo Thumbnail */}
                          <div className="w-16 h-16 bg-gray-200 rounded flex-shrink-0 flex items-center justify-center">
                            {result.original_photo_url ? (
                              <img
                                src={result.original_photo_url}
                                alt="Original"
                                className="w-full h-full object-cover rounded"
                              />
                            ) : (
                              <span className="text-xs text-gray-500">Original</span>
                            )}
                          </div>
                          
                          {/* Generated Image */}
                          <div className="flex-1">
                            <img
                              src={result.image_url}
                              alt="Generated"
                              className="w-full h-24 object-cover rounded mb-2"
                            />
                            
                            {/* Download Button */}
                            <button
                              onClick={() => downloadImage(
                                result.image_url, 
                                `generated-${result.id || index}.png`
                              )}
                              className="w-full px-2 py-1 text-xs bg-green-500 text-white rounded hover:bg-green-600 flex items-center justify-center gap-1"
                            >
                              <Download className="h-3 w-3" />
                              Download
                            </button>
                          </div>
                        </div>
                        
                        {/* Prompt Used */}
                        <div className="mt-2 text-xs text-gray-600">
                          <strong>Prompt:</strong> {result.generated_prompt || result.initial_prompt}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
