import { useState, useCallback, useEffect } from 'react'
import { useDropzone } from 'react-dropzone'
import { Upload, Trash2, Check, X } from 'lucide-react'
import { supabase } from '../utils/supabaseClient'

export default function LeftPanel({ selectedPhotos, setSelectedPhotos }) {
  const [photos, setPhotos] = useState([])
  const [isUploading, setIsUploading] = useState(false)
  const [isConfigured, setIsConfigured] = useState(false)

  // Function to optimize and convert images to JPG
  const optimizeImage = async (file) => {
    return new Promise((resolve) => {
      const canvas = document.createElement('canvas')
      const ctx = canvas.getContext('2d')
      const img = new Image()

      img.onload = () => {
        // Calculate optimal dimensions (max 1200px width/height while maintaining aspect ratio)
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

        // Set canvas dimensions
        canvas.width = width
        canvas.height = height

        // Draw and optimize image
        ctx.imageSmoothingEnabled = true
        ctx.imageSmoothingQuality = 'high'
        ctx.drawImage(img, 0, 0, width, height)

        // Convert to JPG with quality optimization
        canvas.toBlob((blob) => {
          // Create a new File object with the optimized image
          const optimizedFile = new File([blob], file.name, {
            type: 'image/jpeg',
            lastModified: Date.now()
          })
          resolve(optimizedFile)
        }, 'image/jpeg', 0.85) // 85% quality for good balance of size and quality
      }

      // Handle errors
      img.onerror = () => {
        console.warn('Failed to optimize image, using original:', file.name)
        resolve(file) // Fallback to original file
      }

      // Load image from file
      img.src = URL.createObjectURL(file)
    })
  }

  useEffect(() => {
    setIsConfigured(!!import.meta.env.VITE_SUPABASE_URL)
  }, [])

  const onDrop = useCallback(async (acceptedFiles) => {
    if (!isConfigured) {
      alert('Please configure Supabase environment variables first.')
      return
    }

    console.log(`Starting upload of ${acceptedFiles.length} files`)
    setIsUploading(true)

    try {
      const newPhotos = []

      for (let i = 0; i < acceptedFiles.length; i++) {
        const file = acceptedFiles[i]
        console.log(`Processing file ${i + 1}/${acceptedFiles.length}:`, file.name, file.size)

        // Optimize and convert image to JPG
        const optimizedFile = await optimizeImage(file)
        console.log(`Optimized file ${i + 1}:`, optimizedFile.size)

        // Generate filename with timestamp and .jpg extension
        const baseName = file.name.replace(/\.[^/.]+$/, '') // Remove original extension
        const fileName = `${Date.now()}-${baseName}.jpg`

        // Upload optimized image to Supabase Storage
        const { data, error } = await supabase.storage
          .from('uploaded-photos')
          .upload(fileName, optimizedFile, {
            contentType: 'image/jpeg'
          })

        if (error) {
          console.error('Upload error:', error)
          continue
        }

        // Get public URL
        const { data: urlData } = supabase.storage
          .from('uploaded-photos')
          .getPublicUrl(fileName)

        // Insert into database
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
      setIsUploading(false)
    }
  }, [isConfigured])

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      'image/*': ['.jpeg', '.jpg', '.png', '.gif', '.webp']
    },
    multiple: true
  })

  const togglePhotoSelection = (photoId) => {
    console.log('togglePhotoSelection called with:', photoId)
    console.log('Current selectedPhotos:', selectedPhotos)
    setSelectedPhotos(prev => {
      const newSelection = prev.includes(photoId)
        ? prev.filter(id => id !== photoId)
        : [...prev, photoId]
      console.log('New selection will be:', newSelection)
      return newSelection
    })
  }

  const selectAllPhotos = () => {
    setSelectedPhotos(photos.map(photo => photo.id))
  }

  const clearSelection = () => {
    setSelectedPhotos([])
  }

  const deletePhoto = async (photoId) => {
    if (!isConfigured) {
      alert('Please configure Supabase environment variables first.')
      return
    }

    try {
      const photo = photos.find(p => p.id === photoId)
      if (!photo) return

      // Remove from storage
      await supabase.storage
        .from('uploaded-photos')
        .remove([photo.file_path])

      // Remove from database
      await supabase
        .from('uploaded_photos')
        .delete()
        .eq('id', photoId)

      // Remove from local state
      setPhotos(prev => prev.filter(p => p.id !== photoId))
      setSelectedPhotos(prev => prev.filter(id => id !== photoId))
    } catch (error) {
      console.error('Delete failed:', error)
    }
  }

  const loadExistingPhotos = async () => {
    if (!isConfigured) return

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

  // Load photos on mount
  useEffect(() => {
    loadExistingPhotos()
  }, [isConfigured])

  if (!isConfigured) {
    return (
      <div className="w-[15%] bg-gray-50 border-r border-gray-200 px-6 py-4 flex flex-col">
        <h2 className="text-lg font-semibold mb-4">Photos</h2>
        <div className="text-center text-gray-500 mt-8">
          <p className="mb-2">Supabase not configured</p>
          <p className="text-sm">
            Create a .env.local file with your Supabase credentials to enable photo uploads
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="w-[15%] bg-gray-50 border-r border-gray-200 px-6 py-4 flex flex-col">
      <h2 className="text-lg font-semibold mb-4">Photos</h2>

      {/* Upload Area */}
      <div
        {...getRootProps()}
        className={`border-2 border-dashed rounded-lg p-6 text-center cursor-pointer transition-colors ${isDragActive ? 'border-blue-400 bg-blue-50' : 'border-gray-300 hover:border-gray-400'
          }`}
      >
        <input {...getInputProps()} />
        <Upload className="mx-auto h-8 w-8 text-gray-400 mb-2" />
        {isUploading ? (
          <p className="text-sm text-gray-600">Uploading...</p>
        ) : isDragActive ? (
          <p className="text-sm text-blue-600">Drop photos here</p>
        ) : (
          <p className="text-sm text-gray-600">
            Drag & drop photos here, or click to select
          </p>
        )}
      </div>

      {/* Selection Controls */}
      {photos.length > 0 && (
        <div className="mt-4 flex gap-2">
          <button
            onClick={selectAllPhotos}
            className="px-3 py-1 text-xs bg-blue-500 text-white rounded hover:bg-blue-600"
          >
            Select All
          </button>
          <button
            onClick={clearSelection}
            className="px-3 py-1 text-xs bg-gray-500 text-white rounded hover:bg-gray-600"
          >
            Clear
          </button>
          <span className="ml-auto text-xs text-gray-500">
            {selectedPhotos.length} selected
          </span>
        </div>
      )}

      {/* Photo Grid */}
      <div className="mt-4 flex-1 overflow-y-auto">
        <div className="grid grid-cols-2 gap-3">
          {photos.map((photo) => (
            <button
              key={photo.id}
              onClick={() => {
                console.log('Image clicked:', photo.id, photo.file_name)
                togglePhotoSelection(photo.id)
              }}
              className={`relative group border-2 rounded-lg overflow-hidden transition-all duration-200 w-full text-left ${selectedPhotos.includes(photo.id)
                  ? 'border-blue-500 bg-blue-50 shadow-md'
                  : 'border-gray-200 hover:border-gray-300 shadow-sm'
                }`}
              aria-label={`${selectedPhotos.includes(photo.id) ? 'Deselect' : 'Select'} ${photo.file_name}`}
            >
              <div className="w-full h-24 transparency-bg">
                <img
                  src={photo.url}
                  alt={photo.file_name}
                  className="w-full h-full object-cover pointer-events-none"
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
        </div>

        {photos.length === 0 && (
          <p className="text-center text-gray-500 text-sm mt-8">
            No photos uploaded yet
          </p>
        )}
      </div>
    </div>
  )
}
