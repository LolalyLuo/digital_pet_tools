import { useState, useEffect } from 'react'
import { Image as ImageIcon, Upload, X } from 'lucide-react'
import { supabase } from '../../../utils/supabaseClient'

export default function PhotoMatchingConfig({ config, onChange }) {
  const [currentConfig, setCurrentConfig] = useState({
    reference_photos: [],
    similarity_threshold: 0.8,
    weight_composition: 0.4,
    weight_style: 0.3,
    weight_content: 0.3,
    ...config
  })

  const [availablePhotos, setAvailablePhotos] = useState([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    loadAvailablePhotos()
  }, [])

  const updateConfig = (key, value) => {
    const newConfig = { ...currentConfig, [key]: value }
    setCurrentConfig(newConfig)
    onChange(newConfig)
  }

  const loadAvailablePhotos = async () => {
    setLoading(true)
    try {
      const { data, error } = await supabase
        .from('uploaded_photos')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(20)

      if (error) throw error

      const photosWithUrls = data.map(photo => ({
        ...photo,
        url: supabase.storage
          .from('uploaded-photos')
          .getPublicUrl(photo.file_path).data.publicUrl
      }))

      setAvailablePhotos(photosWithUrls)
    } catch (error) {
      console.error('Failed to load photos:', error)
    } finally {
      setLoading(false)
    }
  }

  const addReferencePhoto = (photo) => {
    if (!currentConfig.reference_photos.some(p => p.id === photo.id)) {
      const newPhotos = [...currentConfig.reference_photos, photo]
      updateConfig('reference_photos', newPhotos)
    }
  }

  const removeReferencePhoto = (photoId) => {
    const newPhotos = currentConfig.reference_photos.filter(p => p.id !== photoId)
    updateConfig('reference_photos', newPhotos)
  }

  return (
    <div className="bg-gray-50 rounded-lg p-4 space-y-4">
      <div className="flex items-center gap-2 text-sm font-medium text-gray-700">
        <ImageIcon className="h-4 w-4" />
        Photo Matching Configuration
      </div>

      {/* Reference Photos Selection */}
      <div>
        <label className="block text-xs font-medium text-gray-600 mb-2">
          Reference Photos ({currentConfig.reference_photos.length} selected)
        </label>
        
        {/* Selected Reference Photos */}
        {currentConfig.reference_photos.length > 0 && (
          <div className="mb-3">
            <div className="text-xs text-gray-500 mb-2">Selected for comparison:</div>
            <div className="grid grid-cols-3 gap-2">
              {currentConfig.reference_photos.map((photo) => (
                <div key={photo.id} className="relative group">
                  <img
                    src={photo.url}
                    alt={photo.file_name}
                    className="w-full h-20 object-cover rounded border border-green-300"
                  />
                  <button
                    onClick={() => removeReferencePhoto(photo.id)}
                    className="absolute -top-1 -right-1 bg-red-500 text-white rounded-full p-1 opacity-0 group-hover:opacity-100 transition-opacity"
                  >
                    <X className="h-3 w-3" />
                  </button>
                  <div className="absolute inset-0 bg-green-500 bg-opacity-20 border border-green-300 rounded"></div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Available Photos */}
        <div className="text-xs text-gray-500 mb-2">Available photos (click to select):</div>
        {loading ? (
          <div className="text-center py-4">
            <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-500 mx-auto"></div>
          </div>
        ) : (
          <div className="grid grid-cols-4 gap-2 max-h-40 overflow-y-auto border border-gray-200 rounded p-2">
            {availablePhotos.map((photo) => (
              <button
                key={photo.id}
                onClick={() => addReferencePhoto(photo)}
                className={`relative hover:opacity-75 transition-opacity ${
                  currentConfig.reference_photos.some(p => p.id === photo.id) ? 'opacity-50' : ''
                }`}
                disabled={currentConfig.reference_photos.some(p => p.id === photo.id)}
              >
                <img
                  src={photo.url}
                  alt={photo.file_name}
                  className="w-full h-16 object-cover rounded"
                />
                {currentConfig.reference_photos.some(p => p.id === photo.id) && (
                  <div className="absolute inset-0 bg-green-500 bg-opacity-20 border border-green-300 rounded"></div>
                )}
              </button>
            ))}
          </div>
        )}
        <p className="text-xs text-gray-500 mt-1">
          Generated images will be compared against these reference photos for similarity scoring.
        </p>
      </div>

      {/* Similarity Threshold */}
      <div>
        <label className="block text-xs font-medium text-gray-600 mb-1">
          Similarity Threshold: {currentConfig.similarity_threshold}
        </label>
        <input
          type="range"
          min="0.1"
          max="1"
          step="0.05"
          value={currentConfig.similarity_threshold}
          onChange={(e) => updateConfig('similarity_threshold', parseFloat(e.target.value))}
          className="w-full"
        />
        <div className="flex justify-between text-xs text-gray-400">
          <span>Less strict (0.1)</span>
          <span>More strict (1.0)</span>
        </div>
      </div>

      {/* Comparison Weights */}
      <div>
        <label className="block text-xs font-medium text-gray-600 mb-2">
          Comparison Weights
        </label>
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs text-gray-600">Composition</span>
            <div className="flex items-center gap-2">
              <input
                type="range"
                min="0"
                max="1"
                step="0.1"
                value={currentConfig.weight_composition}
                onChange={(e) => updateConfig('weight_composition', parseFloat(e.target.value))}
                className="w-20"
              />
              <span className="text-xs w-8 text-gray-500">{currentConfig.weight_composition}</span>
            </div>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-xs text-gray-600">Style</span>
            <div className="flex items-center gap-2">
              <input
                type="range"
                min="0"
                max="1"
                step="0.1"
                value={currentConfig.weight_style}
                onChange={(e) => updateConfig('weight_style', parseFloat(e.target.value))}
                className="w-20"
              />
              <span className="text-xs w-8 text-gray-500">{currentConfig.weight_style}</span>
            </div>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-xs text-gray-600">Content</span>
            <div className="flex items-center gap-2">
              <input
                type="range"
                min="0"
                max="1"
                step="0.1"
                value={currentConfig.weight_content}
                onChange={(e) => updateConfig('weight_content', parseFloat(e.target.value))}
                className="w-20"
              />
              <span className="text-xs w-8 text-gray-500">{currentConfig.weight_content}</span>
            </div>
          </div>
        </div>
        <p className="text-xs text-gray-500 mt-1">
          Total: {(currentConfig.weight_composition + currentConfig.weight_style + currentConfig.weight_content).toFixed(1)}
        </p>
      </div>

      <div className="text-xs text-gray-500 bg-blue-50 p-3 rounded border border-blue-200">
        <strong>How it works:</strong> Generated images will be compared to your reference photos using computer vision. 
        Images that are more similar to your references will receive higher scores and influence future iterations.
      </div>
    </div>
  )
}