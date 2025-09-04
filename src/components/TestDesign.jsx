import { useState, useEffect, useCallback } from 'react'
import { useDropzone } from 'react-dropzone'
import { Upload, Trash2, Check, X, Image as ImageIcon, Sparkles } from 'lucide-react'
import { supabase } from '../utils/supabaseClient'
import { useImageGeneration } from '../hooks/useImageGeneration'

export default function TestDesign() {
  const [photos, setPhotos] = useState([])
  const [selectedPhotos, setSelectedPhotos] = useState([])
  const [inputNumbers, setInputNumbers] = useState('')
  const [fetchedPrompts, setFetchedPrompts] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [isConfigured, setIsConfigured] = useState(false)
  const [isGeneratingImages, setIsGeneratingImages] = useState(false)
  const [generatedResults, setGeneratedResults] = useState([])
  const [selectedModel, setSelectedModel] = useState('openai')

  const { generateImages, error: generationError, clearError, resetStates } = useImageGeneration()

  // Reset states when component mounts
  useEffect(() => {
    resetStates()
    setIsConfigured(!!import.meta.env.VITE_SUPABASE_URL)
  }, [resetStates])

  // Function to optimize and convert images to JPG (copied from LeftPanel)
  const optimizeImage = async (file) => {
    return new Promise((resolve) => {
      const canvas = document.createElement('canvas')
      const ctx = canvas.getContext('2d')
      const img = new Image()

      img.onload = () => {
        const maxDimension = 1200
        let { width, height } = img

        if (width > height) {
          if (width > maxDimension) {
            height = (height * maxDimension) / width
            width = maxDimension
          }
        } else {
          if (height > maxDimension) {
            width = (width * maxDimension) / height
            height = maxDimension
          }
        }

        canvas.width = width
        canvas.height = height

        ctx.imageSmoothingEnabled = true
        ctx.imageSmoothingQuality = 'high'
        ctx.drawImage(img, 0, 0, width, height)

        canvas.toBlob((blob) => {
          const optimizedFile = new File([blob], file.name, {
            type: 'image/jpeg',
            lastModified: Date.now()
          })
          resolve(optimizedFile)
        }, 'image/jpeg', 0.85)
      }

      img.onerror = () => {
        console.warn('Failed to optimize image, using original:', file.name)
        resolve(file)
      }

      img.src = URL.createObjectURL(file)
    })
  }

  // Load existing photos on mount
  useEffect(() => {
    if (isConfigured) {
      loadExistingPhotos()
    }
  }, [isConfigured])

  const loadExistingPhotos = async () => {
    try {
      const { data, error } = await supabase
        .from('uploaded_photos')
        .select('*')
        .order('created_at', { ascending: false })

      if (error) throw error

      const photosWithUrls = data.map(photo => ({
        ...photo,
        url: supabase.storage
          .from('uploaded-photos')
          .getPublicUrl(photo.file_path).data.publicUrl
      }))

      setPhotos(photosWithUrls)
    } catch (error) {
      console.error('Failed to load photos:', error)
    }
  }

  const onDrop = useCallback(async (acceptedFiles) => {
    if (!isConfigured) {
      alert('Please configure Supabase environment variables first.')
      return
    }

    console.log(`Starting upload of ${acceptedFiles.length} files`)
    setLoading(true)

    try {
      const newPhotos = []

      for (let i = 0; i < acceptedFiles.length; i++) {
        const file = acceptedFiles[i]
        console.log(`Processing file ${i + 1}/${acceptedFiles.length}:`, file.name, file.size)

        const optimizedFile = await optimizeImage(file)
        console.log(`Optimized file ${i + 1}:`, optimizedFile.size)

        const baseName = file.name.replace(/\.[^/.]+$/, '')
        const fileName = `${Date.now()}-${baseName}.jpg`

        const { data, error } = await supabase.storage
          .from('uploaded-photos')
          .upload(fileName, optimizedFile, {
            contentType: 'image/jpeg'
          })

        if (error) {
          console.error('Upload error:', error)
          continue
        }

        const { data: urlData } = supabase.storage
          .from('uploaded-photos')
          .getPublicUrl(fileName)

        const { data: dbData, error: dbError } = await supabase
          .from('uploaded_photos')
          .insert({
            file_path: fileName,
            file_name: `${baseName}.jpg`
          })
          .select()

        if (dbError) {
          console.error('Database error:', dbError)
          continue
        }

        newPhotos.push({
          id: dbData[0].id,
          file_path: fileName,
          file_name: `${baseName}.jpg`,
          url: urlData.publicUrl,
          created_at: dbData[0].created_at
        })
      }

      setPhotos(prev => [...prev, ...newPhotos])
    } catch (error) {
      console.error('Upload failed:', error)
    } finally {
      setLoading(false)
    }
  }, [isConfigured])

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      'image/*': ['.jpeg', '.jpg', '.png', '.gif', '.webp']
    },
    multiple: true
  })

  const handlePhotoSelection = (photoId) => {
    setSelectedPhotos(prev => {
      if (prev.includes(photoId)) {
        // Remove if already selected
        return prev.filter(id => id !== photoId)
      } else {
        // Add if not selected
        return [...prev, photoId]
      }
    })
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!inputNumbers.trim()) return

    setLoading(true)
    setError('')
    setFetchedPrompts([])

    try {
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

      // Fetch prompts from database based on numbers
      const { data, error: fetchError } = await supabase
        .from('generated_images')
        .select(`
          id,
          number,
          generated_prompt,
          initial_prompt,
          size,
          background
        `)
        .in('number', inputOrder)

      if (fetchError) {
        throw fetchError
      }

      if (data) {
        console.log('Fetched data from database:', data)
        const orderedResults = inputOrder.map(inputNum =>
          data.find(img => img.number === inputNum)
        ).filter(Boolean)

        console.log('Ordered results:', orderedResults)
        setFetchedPrompts(orderedResults)
      }
    } catch (err) {
      console.error('Error fetching prompts:', err)
      setError('Failed to fetch prompts. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  const handleGenerateImages = async () => {
    if (selectedPhotos.length === 0 || fetchedPrompts.length === 0) return

    setIsGeneratingImages(true)
    setError('')

    try {
      const prompts = fetchedPrompts.map(p => "#" + p.number + ': ' + (p.generated_prompt || p.initial_prompt))

      // Extract sizes and backgrounds for each prompt
      const sizes = fetchedPrompts.map(p => p.size || 'auto')
      const backgrounds = fetchedPrompts.map(p => p.background || 'opaque')

      // Convert sizes from '×' to 'x' for API compatibility
      const apiSizes = sizes.map(size => size === 'auto' ? 'auto' : size.replace('×', 'x'))

      console.log('Using size and background from database:', {
        sizes: apiSizes,
        backgrounds: backgrounds,
        model: selectedModel,
        prompts: prompts.length
      })

      // Call local API server
      const response = await fetch('http://localhost:3001/api/generate-images', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          photoIds: selectedPhotos,
          prompts: prompts,
          sizes: apiSizes,
          backgrounds: backgrounds,
          model: selectedModel
        })
      })

      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.error || 'Failed to generate images')
      }

      const data = await response.json()

      if (data.results && data.results.length > 0) {
        setGeneratedResults(prev => [...prev, ...data.results])
      }
    } catch (error) {
      console.error('Image generation failed:', error)
      setError('Failed to generate images. Please try again.')
    } finally {
      setIsGeneratingImages(false)
    }
  }

  const deletePhoto = async (photoId) => {
    if (!isConfigured) {
      alert('Please configure Supabase environment variables first.')
      return
    }

    try {
      const photo = photos.find(p => p.id === photoId)
      if (!photo) return

      await supabase.storage
        .from('uploaded-photos')
        .remove([photo.file_path])

      await supabase
        .from('uploaded_photos')
        .delete()
        .eq('id', photoId)

      setPhotos(prev => prev.filter(p => p.id !== photoId))
      setSelectedPhotos(prev => prev.filter(id => id !== photoId))
    } catch (error) {
      console.error('Delete failed:', error)
    }
  }

  if (!isConfigured) {
    return (
      <div className="flex-1 flex flex-col overflow-hidden bg-gray-50">
        <div className="flex-1 overflow-y-auto">
          <div className="max-w-7xl mx-auto p-6">
            <h1 className="text-3xl font-bold text-gray-800 mb-8">Test Design</h1>
            <div className="text-center text-gray-500 mt-8">
              <p className="mb-2">Supabase not configured</p>
              <p className="text-sm">
                Create a .env.local file with your Supabase credentials to enable photo uploads
              </p>
            </div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden bg-gray-50">
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-7xl mx-auto p-6">
          <h1 className="text-3xl font-bold text-gray-800 mb-8">Test Design</h1>

          <div className="grid grid-cols-2 gap-8">
            {/* Left Column - Photo Selection */}
            <div className="space-y-6">
              <h2 className="text-xl font-semibold text-gray-700">
                Select Photos ({selectedPhotos.length} selected)
              </h2>

              {/* Upload Area */}
              <div
                {...getRootProps()}
                className={`border-2 border-dashed rounded-lg p-6 text-center cursor-pointer transition-colors ${isDragActive ? 'border-blue-400 bg-blue-50' : 'border-gray-300 hover:border-gray-400'
                  }`}
              >
                <input {...getInputProps()} />
                <Upload className="mx-auto h-8 w-8 text-gray-400 mb-2" />
                {loading ? (
                  <p className="text-sm text-gray-600">Uploading...</p>
                ) : isDragActive ? (
                  <p className="text-sm text-blue-600">Drop photos here</p>
                ) : (
                  <p className="text-sm text-gray-600">
                    Drag & drop photos here, or click to select
                  </p>
                )}
              </div>

              {/* Photo Grid */}
              <div className="space-y-3">
                <h3 className="text-lg font-medium text-gray-700">Uploaded Photos</h3>
                <div className="grid grid-cols-2 gap-3 max-h-96 overflow-y-auto">
                  {photos.map((photo) => (
                    <button
                      key={photo.id}
                      onClick={() => handlePhotoSelection(photo.id)}
                      className={`relative group border-2 rounded-lg overflow-hidden transition-all duration-200 w-full text-left ${selectedPhotos.includes(photo.id)
                        ? 'border-blue-500 bg-blue-50 shadow-md'
                        : 'border-gray-200 hover:border-gray-300 shadow-sm'
                        }`}
                    >
                      <div className="w-full h-24 transparency-bg">
                        <img
                          src={photo.url}
                          alt={photo.file_name}
                          className={`w-full h-full object-cover pointer-events-none transition-transform duration-200 ${selectedPhotos.includes(photo.id) ? 'scale-70' : ''
                            }`}
                        />
                      </div>

                      {/* Selection Overlay */}
                      {selectedPhotos.includes(photo.id) && (
                        <div className="absolute inset-0 bg-blue-500 bg-opacity-20 border-2 border-blue-500 pointer-events-none">
                          <div className="absolute top-2 right-2 bg-blue-500 text-white rounded-full p-1">
                            <Check className="h-3 w-3" />
                          </div>
                        </div>
                      )}

                      {/* Delete Button */}
                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          deletePhoto(photo.id)
                        }}
                        className="absolute top-2 left-2 bg-red-500 text-white rounded-full p-1 opacity-0 group-hover:opacity-100 transition-opacity z-30"
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
                    </button>
                  ))}

                  {photos.length === 0 && (
                    <p className="text-center text-gray-500 text-sm col-span-2 py-8">
                      No photos uploaded yet
                    </p>
                  )}
                </div>
              </div>
            </div>

            {/* Right Column - Number Input and Generation */}
            <div className="space-y-6">
              <h2 className="text-xl font-semibold text-gray-700">Enter Image Numbers</h2>

              {/* Input Form */}
              <div className="bg-white rounded-lg p-6 shadow-sm border border-gray-200">
                <p className="text-gray-600 mb-4">
                  Enter the numbers of the generated images you want to test with, separated by commas or spaces
                </p>

                <form onSubmit={handleSubmit} className="space-y-4">
                  <input
                    type="text"
                    value={inputNumbers}
                    onChange={(e) => setInputNumbers(e.target.value)}
                    placeholder="e.g., 1, 5, 12 or 1 5 12"
                    className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  />
                  <button
                    type="submit"
                    disabled={loading}
                    className="w-full px-6 py-3 bg-purple-500 text-white rounded-lg hover:bg-purple-600 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                  >
                    {loading ? (
                      <>
                        <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                        Fetching Prompts...
                      </>
                    ) : (
                      <>
                        <Sparkles className="h-4 w-4" />
                        Fetch Prompts
                      </>
                    )}
                  </button>
                </form>

                {error && (
                  <p className="text-red-600 mt-2">{error}</p>
                )}
              </div>

              {/* Fetched Prompts Display */}
              {fetchedPrompts.length > 0 && (
                <div className="bg-white rounded-lg p-6 shadow-sm border border-gray-200">
                  <h3 className="text-lg font-medium text-gray-700 mb-4">
                    Found {fetchedPrompts.length} prompt{fetchedPrompts.length !== 1 ? 's' : ''}
                    {selectedPhotos.length > 0 && (
                      <span className="text-sm text-gray-500 ml-2">
                        ({selectedPhotos.length} photos × {fetchedPrompts.length} prompts = {selectedPhotos.length * fetchedPrompts.length} images)
                      </span>
                    )}
                  </h3>

                  <div className="space-y-3 max-h-64 overflow-y-auto">
                    {fetchedPrompts.map((prompt, index) => (
                      <div key={prompt.id} className="p-3 border border-gray-200 rounded bg-gray-50">
                        <div className="text-sm text-gray-800">
                          <strong>#{prompt.number}:</strong> {prompt.generated_prompt || prompt.initial_prompt}
                        </div>
                        <div className="text-xs text-gray-500 mt-1">
                          Size: {prompt.size || 'N/A'} | Background: {prompt.background || 'N/A'}
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* Generate Images Button */}
                  <button
                    onClick={handleGenerateImages}
                    disabled={isGeneratingImages || selectedPhotos.length === 0}
                    className="w-full mt-4 px-6 py-3 bg-blue-500 text-white rounded-lg hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                  >
                    {isGeneratingImages ? (
                      <>
                        <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                        Generating Images...
                      </>
                    ) : (
                      <>
                        <ImageIcon className="h-4 w-4" />
                        Generate Images
                      </>
                    )}
                  </button>

                  {/* Model Selection */}
                  <div className="mt-4">
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
                    </select>
                  </div>
                </div>
              )}

              {/* Generated Results */}
              {generatedResults.length > 0 && (
                <div className="bg-white rounded-lg p-6 shadow-sm border border-gray-200">
                  <h3 className="text-lg font-medium text-gray-700 mb-4">
                    Generated Images ({generatedResults.length})
                  </h3>

                  <div className="grid grid-cols-2 gap-3 max-h-64 overflow-y-auto">
                    {generatedResults.map((result, index) => (
                      <div key={result.id || index} className="border border-gray-200 rounded overflow-hidden">
                        <div className="aspect-square overflow-hidden transparency-bg">
                          <img
                            src={result.public_url}
                            alt={`Generated image ${index + 1}`}
                            className="w-full h-full object-contain"
                          />
                        </div>
                        <div className="p-2">
                          <p className="text-xs text-gray-600 truncate">
                            {result.generated_prompt}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Generation Error Display */}
              {generationError && (
                <div className="bg-red-100 border border-red-300 text-red-700 rounded-lg p-4">
                  <div className="flex justify-between items-center">
                    <span>{generationError}</span>
                    <button onClick={clearError} className="text-red-500 hover:text-red-700">
                      ×
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
