import { useState } from 'react'
import { supabase } from '../utils/supabaseClient'
import { Download, Copy, Check, Save } from 'lucide-react'

function FinalizeDesigns() {
  const [inputNumbers, setInputNumbers] = useState('')
  const [fetchedData, setFetchedData] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [copiedId, setCopiedId] = useState(null)
  const [imageSelections, setImageSelections] = useState({})
  const [saving, setSaving] = useState(false)
  const [saveMessage, setSaveMessage] = useState('')

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!inputNumbers.trim()) return

    setLoading(true)
    setError('')

    try {
      // Parse numbers from input (comma or space separated) and preserve order
      const inputOrder = inputNumbers
        .split(/[,\s]+/)
        .map(num => num.trim())
        .filter(num => num !== '')
        .map(num => parseInt(num))
        .filter(num => !isNaN(num))

      if (inputOrder.length === 0) {
        setError('Please enter valid numbers')
        setLoading(false)
        return
      }

      // Fetch data from database based on numbers - using the same structure as RightPanel
      const { data, error: fetchError } = await supabase
        .from('generated_images')
        .select(`
          id,
          number,
          image_url,
          generated_prompt,
          initial_prompt,
          size,
          background,
          created_at,
          photo_id
        `)
        .in('number', inputOrder)

      if (fetchError) {
        throw fetchError
      }

      if (data) {
        // Process images with public URLs like RightPanel does
        const imagesWithUrls = data.map(img => ({
          ...img,
          public_url: supabase.storage
            .from('generated-images')
            .getPublicUrl(img.image_url).data.publicUrl
        }))

        // Sort results to match the exact order the user entered
        const orderedResults = inputOrder.map(inputNum =>
          imagesWithUrls.find(img => img.number === inputNum)
        ).filter(Boolean) // Remove any undefined results

        setFetchedData(orderedResults)

        // Initialize selections with current values from database
        const initialSelections = {}
        orderedResults.forEach(img => {
          initialSelections[img.id] = {
            size: img.size || '',
            background: img.background || ''
          }
        })
        setImageSelections(initialSelections)
      }
    } catch (err) {
      console.error('Error fetching data:', err)
      setError('Failed to fetch data. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  const handleKeyPress = (e) => {
    if (e.key === 'Enter') {
      handleSubmit(e)
    }
  }

  const copyToClipboard = async (text, imageId) => {
    try {
      await navigator.clipboard.writeText(text)
      setCopiedId(imageId)
      setTimeout(() => setCopiedId(null), 2000)
    } catch (err) {
      console.error('Failed to copy text: ', err)
    }
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

  const handleSelectionChange = (imageId, field, value) => {
    setImageSelections(prev => ({
      ...prev,
      [imageId]: {
        ...prev[imageId],
        [field]: value
      }
    }))
  }

  const handleSaveAll = async () => {
    setSaving(true)
    setSaveMessage('')

    try {
      // Prepare updates for all images
      const updates = Object.entries(imageSelections).map(([imageId, selections]) => ({
        id: imageId,
        size: selections.size || null,
        background: selections.background || null
      }))

      // Update each image individually
      const updatePromises = updates.map(update =>
        supabase
          .from('generated_images')
          .update({
            size: update.size,
            background: update.background
          })
          .eq('id', update.id)
      )

      const results = await Promise.all(updatePromises)

      // Check for errors
      const errors = results.filter(result => result.error)
      if (errors.length > 0) {
        throw new Error(`Failed to update ${errors.length} images`)
      }

      setSaveMessage('All changes saved successfully!')
      setTimeout(() => setSaveMessage(''), 3000)
    } catch (err) {
      console.error('Error saving changes:', err)
      setSaveMessage('Error saving changes. Please try again.')
      setTimeout(() => setSaveMessage(''), 3000)
    } finally {
      setSaving(false)
    }
  }

  // Helper function to generate the design JSON
  const generateDesignJSON = () => {
    if (!fetchedData || fetchedData.length === 0) return []

    return fetchedData.map(item => ({
      number: item.number,
      prompt: item.generated_prompt || item.initial_prompt,
      size: imageSelections[item.id]?.size || '',
      background: imageSelections[item.id]?.background || ''
    }))
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden bg-gray-50">
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-7xl mx-auto p-6">
          <h1 className="text-3xl font-bold text-gray-800 mb-8">Finalize Designs</h1>

          {/* Input Form */}
          <div className="bg-white rounded-lg p-6 mb-8 shadow-sm border border-gray-200">
            <h2 className="text-xl font-semibold text-gray-700 mb-4">Enter Image Numbers</h2>
            <p className="text-gray-600 mb-4">
              Enter the numbers of the generated images you want to review, separated by commas or spaces
            </p>

            <form onSubmit={handleSubmit} className="flex gap-4">
              <input
                type="text"
                value={inputNumbers}
                onChange={(e) => setInputNumbers(e.target.value)}
                onKeyPress={handleKeyPress}
                placeholder="e.g., 1, 5, 12 or 1 5 12"
                className="flex-1 px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
              <button
                type="submit"
                disabled={loading}
                className="px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {loading ? 'Fetching...' : 'Fetch Images'}
              </button>
            </form>

            {error && (
              <p className="text-red-600 mt-2">{error}</p>
            )}
          </div>

          {/* Results Display */}
          {fetchedData.length > 0 && (
            <div className="space-y-6">
              <h2 className="text-2xl font-semibold text-gray-800">
                Found {fetchedData.length} image{fetchedData.length !== 1 ? 's' : ''}
              </h2>

              {/* 3-column grid like RightPanel */}
              <div className="grid grid-cols-3 gap-4">
                {fetchedData.map((item, index) => (
                  <div key={item.id} className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
                    {/* Generated Image */}
                    <div className="aspect-square overflow-hidden transparency-bg">
                      <img
                        src={item.public_url}
                        alt={`Generated image ${item.number}`}
                        className="w-full h-full object-contain"
                      />
                    </div>

                    {/* Image Info - similar to RightPanel */}
                    <div className="p-3">
                      {/* Prompt */}
                      <div className="mb-3">
                        <div className="flex items-start gap-2">
                          <p className="flex-1 text-sm text-gray-600 whitespace-pre-wrap break-words" title={item.generated_prompt || item.initial_prompt}>
                            <strong>#{item.number}:</strong> {item.generated_prompt || item.initial_prompt}
                          </p>
                          <button
                            onClick={() => copyToClipboard(item.generated_prompt || item.initial_prompt, item.id)}
                            className="p-1 text-gray-400 hover:text-gray-600 flex-shrink-0"
                            title="Copy prompt"
                          >
                            {copiedId === item.id ? (
                              <Check className="h-3 w-3 text-green-500" />
                            ) : (
                              <Copy className="h-3 w-3" />
                            )}
                          </button>
                        </div>
                      </div>

                      {/* Size and Background Dropdowns */}
                      <div className="mb-3 space-y-2">
                        {/* Size Dropdown */}
                        <div>
                          <label className="block text-xs font-medium text-gray-700 mb-1">Size:</label>
                          <select
                            value={imageSelections[item.id]?.size || ''}
                            onChange={(e) => handleSelectionChange(item.id, 'size', e.target.value)}
                            className="w-full px-2 py-1 text-xs border border-gray-300 rounded focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
                          >
                            <option value="">Select size</option>
                            <option value="auto">Auto</option>
                            <option value="1024×1024">1024×1024</option>
                            <option value="1024×1536">1024×1536</option>
                            <option value="1536×1024">1536×1024</option>
                          </select>
                        </div>

                        {/* Background Dropdown */}
                        <div>
                          <label className="block text-xs font-medium text-gray-700 mb-1">Background:</label>
                          <select
                            value={imageSelections[item.id]?.background || ''}
                            onChange={(e) => handleSelectionChange(item.id, 'background', e.target.value)}
                            className="w-full px-2 py-1 text-xs border border-gray-300 rounded focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
                          >
                            <option value="">Select background</option>
                            <option value="opaque">Opaque</option>
                            <option value="transparent">Transparent</option>
                            <option value="auto">Auto</option>
                          </select>
                        </div>
                      </div>

                      {/* Actions */}
                      <div className="flex gap-2">
                        <button
                          onClick={() => downloadImage(
                            item.public_url,
                            `generated-${item.number}.png`
                          )}
                          className="flex-1 px-3 py-2 text-xs bg-green-500 text-white rounded hover:bg-green-600 flex items-center justify-center gap-1"
                        >
                          <Download className="h-3 w-3" />
                          Download
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              {/* Save Button */}
              <div className="flex justify-center pt-6">
                <button
                  onClick={handleSaveAll}
                  disabled={saving}
                  className="px-8 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                >
                  <Save className="h-4 w-4" />
                  {saving ? 'Saving...' : 'Save All Changes'}
                </button>
              </div>

              {/* Save Message */}
              {saveMessage && (
                <div className={`text-center py-2 px-4 rounded-lg ${saveMessage.includes('successfully')
                  ? 'bg-green-100 text-green-700'
                  : 'bg-red-100 text-red-700'
                  }`}>
                  {saveMessage}
                </div>
              )}

              {/* Design JSON Section */}
              <div className="bg-white rounded-lg p-6 shadow-sm border border-gray-200">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-xl font-semibold text-gray-700">Design JSON</h3>
                  <button
                    onClick={() => copyToClipboard(JSON.stringify(generateDesignJSON(), null, 2), 'design-json')}
                    className="px-4 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700 flex items-center gap-2"
                    title="Copy Design JSON"
                  >
                    {copiedId === 'design-json' ? (
                      <Check className="h-4 w-4" />
                    ) : (
                      <Copy className="h-4 w-4" />
                    )}
                    Copy JSON
                  </button>
                </div>

                <div className="bg-gray-50 rounded-lg p-4 overflow-x-auto">
                  <pre className="text-sm text-gray-800 whitespace-pre-wrap">
                    {JSON.stringify(generateDesignJSON(), null, 2)}
                  </pre>
                </div>
              </div>
            </div>
          )}

          {fetchedData.length === 0 && !loading && !error && (
            <div className="text-center text-gray-500 py-12">
              <p>Enter numbers above to fetch generated images</p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export default FinalizeDesigns
