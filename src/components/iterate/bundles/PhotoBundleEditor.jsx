import { useState, useEffect } from 'react'
import { Save, X, Image as ImageIcon, Check } from 'lucide-react'
import { supabase } from '../../../utils/supabaseClient'

export default function PhotoBundleEditor({ bundle, onClose }) {
  const [name, setName] = useState(bundle?.name || '')
  const [description, setDescription] = useState(bundle?.description || '')
  const [selectedPhotoIds, setSelectedPhotoIds] = useState(bundle?.photo_ids || [])
  const [availablePhotos, setAvailablePhotos] = useState([])
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const isEditing = !!bundle

  useEffect(() => {
    loadAvailablePhotos()
  }, [])

  const loadAvailablePhotos = async () => {
    setLoading(true)
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

      setAvailablePhotos(photosWithUrls)
    } catch (error) {
      console.error('Failed to load photos:', error)
      setError('Failed to load photos')
    } finally {
      setLoading(false)
    }
  }

  const handlePhotoToggle = (photoId) => {
    setSelectedPhotoIds(prev => {
      if (prev.includes(photoId)) {
        return prev.filter(id => id !== photoId)
      } else {
        return [...prev, photoId]
      }
    })
  }

  const handleSave = async () => {
    if (!name.trim()) {
      setError('Bundle name is required')
      return
    }

    if (selectedPhotoIds.length === 0) {
      setError('Please select at least one photo')
      return
    }

    setSaving(true)
    setError('')

    try {
      const bundleData = {
        name: name.trim(),
        description: description.trim() || null,
        photo_ids: selectedPhotoIds
      }

      if (isEditing) {
        const { error } = await supabase
          .from('photo_bundles')
          .update(bundleData)
          .eq('id', bundle.id)

        if (error) throw error
      } else {
        const { error } = await supabase
          .from('photo_bundles')
          .insert(bundleData)

        if (error) throw error
      }

      onClose(bundleData)
    } catch (error) {
      console.error('Failed to save bundle:', error)
      setError(error.message?.includes('duplicate key') 
        ? 'A bundle with this name already exists'
        : 'Failed to save bundle. Please try again.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="bg-white rounded-lg border border-gray-300 p-4 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium text-gray-800">
          {isEditing ? 'Edit Photo Bundle' : 'Create Photo Bundle'}
        </h3>
        <button
          onClick={() => onClose(null)}
          className="p-1 text-gray-400 hover:text-gray-600"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Bundle Details */}
      <div className="space-y-3">
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">
            Bundle Name *
          </label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g., Sample Set 1"
            className="w-full px-3 py-2 text-sm border border-gray-300 rounded focus:ring-1 focus:ring-blue-500"
          />
        </div>

        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">
            Description (optional)
          </label>
          <input
            type="text"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Brief description of this bundle"
            className="w-full px-3 py-2 text-sm border border-gray-300 rounded focus:ring-1 focus:ring-blue-500"
          />
        </div>
      </div>

      {/* Photo Selection */}
      <div>
        <label className="block text-xs font-medium text-gray-600 mb-2">
          Select Photos ({selectedPhotoIds.length} selected)
        </label>

        {loading ? (
          <div className="text-center py-6">
            <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-500 mx-auto"></div>
            <div className="text-xs text-gray-500 mt-2">Loading photos...</div>
          </div>
        ) : availablePhotos.length === 0 ? (
          <div className="text-center py-6 text-gray-500">
            <ImageIcon className="h-8 w-8 mx-auto mb-2 text-gray-300" />
            <p className="text-xs">No photos available</p>
            <p className="text-xs mt-1">Upload some photos first to create bundles</p>
          </div>
        ) : (
          <div className="grid grid-cols-4 gap-2 max-h-60 overflow-y-auto border border-gray-200 rounded p-2">
            {availablePhotos.map((photo) => (
              <button
                key={photo.id}
                onClick={() => handlePhotoToggle(photo.id)}
                className="relative group hover:opacity-75 transition-opacity"
              >
                <img
                  src={photo.url}
                  alt={photo.file_name}
                  className="w-full h-16 object-cover rounded"
                />
                
                {/* Selection Overlay */}
                <div className={`absolute inset-0 transition-opacity ${
                  selectedPhotoIds.includes(photo.id) 
                    ? 'bg-blue-500 bg-opacity-20 border-2 border-blue-500' 
                    : 'bg-transparent hover:bg-black hover:bg-opacity-10'
                } rounded`}>
                  {selectedPhotoIds.includes(photo.id) && (
                    <div className="absolute top-1 right-1 bg-blue-500 text-white rounded-full p-0.5">
                      <Check className="h-2 w-2" />
                    </div>
                  )}
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Error Display */}
      {error && (
        <div className="text-xs text-red-600 bg-red-50 p-2 rounded border border-red-200">
          {error}
        </div>
      )}

      {/* Action Buttons */}
      <div className="flex gap-2 pt-2 border-t border-gray-200">
        <button
          onClick={() => onClose(null)}
          className="flex-1 px-4 py-2 text-sm text-gray-600 border border-gray-300 rounded hover:bg-gray-50"
        >
          Cancel
        </button>
        <button
          onClick={handleSave}
          disabled={saving || !name.trim() || selectedPhotoIds.length === 0}
          className="flex-1 px-4 py-2 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
        >
          {saving ? (
            <>
              <div className="animate-spin rounded-full h-3 w-3 border-b-2 border-white"></div>
              Saving...
            </>
          ) : (
            <>
              <Save className="h-3 w-3" />
              {isEditing ? 'Update Bundle' : 'Create Bundle'}
            </>
          )}
        </button>
      </div>
    </div>
  )
}