import { useState, useCallback, useEffect, useRef } from 'react'
import { useDropzone } from 'react-dropzone'
import { Upload, Trash2, Check, X, Search, RefreshCw } from 'lucide-react'
import { supabase } from '../utils/supabaseClient'
import { createClient } from '@supabase/supabase-js'

// Production Supabase client for pet photos
const PROD_CONFIG = {
  url: import.meta.env.VITE_PAWPRINT_SUPABASE_URL,
  anonKey: import.meta.env.VITE_PAWPRINT_SUPABASE_ANON_KEY,
}
const prodConfigured = PROD_CONFIG.url && PROD_CONFIG.anonKey &&
  !PROD_CONFIG.url.includes('your-prod-url') &&
  !PROD_CONFIG.anonKey.includes('your-anon-key')
const prodSupabase = prodConfigured ? createClient(PROD_CONFIG.url, PROD_CONFIG.anonKey) : null

export default function LeftPanel({ selectedPhotos, setSelectedPhotos, selectedProdPhotoUrls, setSelectedProdPhotoUrls }) {
  const [viewMode, setViewMode] = useState('myPhotos') // 'myPhotos' | 'petPhotos'

  // --- My Photos state ---
  const [photos, setPhotos] = useState([])
  const [isUploading, setIsUploading] = useState(false)
  const [isConfigured, setIsConfigured] = useState(false)

  // --- Pet Photos state ---
  const [petPhotos, setPetPhotos] = useState([])
  const [petLoading, setPetLoading] = useState(false)
  const [petHasMore, setPetHasMore] = useState(true)
  const [petPage, setPetPage] = useState(0)
  const [petIsLoadingMore, setPetIsLoadingMore] = useState(false)
  const [petSearchText, setPetSearchText] = useState('')
  const [petActiveSearch, setPetActiveSearch] = useState('')
  const petObserver = useRef()
  const petSearchTimeout = useRef()
  const petLoadingRef = useRef(false)
  const petInitiated = useRef(false)

  const ITEMS_PER_PAGE = 30

  // Function to optimize and convert images to JPG
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

  useEffect(() => {
    setIsConfigured(!!import.meta.env.VITE_SUPABASE_URL)
  }, [])

  const onDrop = useCallback(async (acceptedFiles) => {
    if (!isConfigured) {
      alert('Please configure Supabase environment variables first.')
      return
    }

    setIsUploading(true)

    try {
      const newPhotos = []

      for (let i = 0; i < acceptedFiles.length; i++) {
        const file = acceptedFiles[i]
        const optimizedFile = await optimizeImage(file)

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
    setSelectedPhotos(prev => {
      return prev.includes(photoId)
        ? prev.filter(id => id !== photoId)
        : [...prev, photoId]
    })
  }

  const selectAllPhotos = () => {
    setSelectedPhotos(photos.map(photo => photo.id))
  }

  const clearSelection = () => {
    setSelectedPhotos([])
  }

  const deletePhoto = async (photoId) => {
    if (!isConfigured) return

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

  useEffect(() => {
    loadExistingPhotos()
  }, [isConfigured])

  // ===== PET PHOTOS LOGIC =====

  const loadPetPhotos = useCallback(async (pageNum = 0, append = false, search = '') => {
    if (!prodSupabase || petLoadingRef.current) return

    petLoadingRef.current = true
    setPetLoading(true)
    try {
      let query = prodSupabase
        .from('pets')
        .select('*')
        .eq('shop', 'vuse04-um.myshopify.com')
        .order('created_at', { ascending: false })

      if (search.trim()) {
        query = query.ilike('pet_name', `%${search.trim()}%`)
      }

      query = query.range(pageNum * ITEMS_PER_PAGE, (pageNum + 1) * ITEMS_PER_PAGE - 1)

      const { data, error } = await query

      if (error) throw error

      if (data) {
        if (append) {
          setPetPhotos(prev => [...prev, ...data])
        } else {
          setPetPhotos(data)
        }
        setPetHasMore(data.length === ITEMS_PER_PAGE)
        setPetPage(pageNum)
      }
    } catch (error) {
      console.error('Failed to load pet photos:', error)
    } finally {
      petLoadingRef.current = false
      setPetLoading(false)
    }
  }, [])

  const loadMorePets = useCallback(async () => {
    if (petIsLoadingMore || !petHasMore) return

    setPetIsLoadingMore(true)
    try {
      await loadPetPhotos(petPage + 1, true, petActiveSearch)
    } finally {
      setPetIsLoadingMore(false)
    }
  }, [petIsLoadingMore, petHasMore, petPage, loadPetPhotos, petActiveSearch])

  const lastPetElementRef = useCallback(node => {
    if (petLoading) return
    if (petObserver.current) petObserver.current.disconnect()

    petObserver.current = new IntersectionObserver(entries => {
      if (entries[0].isIntersecting && petHasMore && !petIsLoadingMore) {
        loadMorePets()
      }
    })

    if (node) petObserver.current.observe(node)
  }, [petLoading, petHasMore, loadMorePets, petIsLoadingMore])

  // Load pet photos on first switch
  useEffect(() => {
    if (viewMode === 'petPhotos' && !petInitiated.current) {
      petInitiated.current = true
      loadPetPhotos(0, false, '')
    }
  }, [viewMode, loadPetPhotos])

  // Debounced pet search
  useEffect(() => {
    if (viewMode !== 'petPhotos') return
    clearTimeout(petSearchTimeout.current)
    petSearchTimeout.current = setTimeout(() => {
      if (petActiveSearch !== petSearchText) {
        setPetActiveSearch(petSearchText)
        loadPetPhotos(0, false, petSearchText)
      }
    }, 400)
    return () => clearTimeout(petSearchTimeout.current)
  }, [petSearchText, viewMode, loadPetPhotos, petActiveSearch])

  useEffect(() => {
    return () => {
      if (petObserver.current) petObserver.current.disconnect()
    }
  }, [])

  const toggleProdPhotoSelection = (imageUrl) => {
    setSelectedProdPhotoUrls(prev => {
      return prev.includes(imageUrl)
        ? prev.filter(u => u !== imageUrl)
        : [...prev, imageUrl]
    })
  }

  const selectAllProdPhotos = () => {
    const urls = petPhotos.filter(p => p.image_url).map(p => p.image_url)
    setSelectedProdPhotoUrls(urls)
  }

  const clearProdSelection = () => {
    setSelectedProdPhotoUrls([])
  }

  // ===== TOGGLE =====

  const Toggle = () => (
    <div className="flex bg-gray-200 rounded-lg p-0.5 mb-3">
      <button
        onClick={() => setViewMode('myPhotos')}
        className={`flex-1 px-2 py-1 text-[10px] font-medium rounded-md transition-colors ${
          viewMode === 'myPhotos'
            ? 'bg-white text-gray-900 shadow-sm'
            : 'text-gray-500 hover:text-gray-700'
        }`}
      >
        My Photos
      </button>
      <button
        onClick={() => setViewMode('petPhotos')}
        className={`flex-1 px-2 py-1 text-[10px] font-medium rounded-md transition-colors ${
          viewMode === 'petPhotos'
            ? 'bg-white text-gray-900 shadow-sm'
            : 'text-gray-500 hover:text-gray-700'
        }`}
      >
        Pet Photos
      </button>
    </div>
  )

  // Total selection count across both modes
  const totalSelected = selectedPhotos.length + selectedProdPhotoUrls.length

  if (!isConfigured && viewMode === 'myPhotos') {
    return (
      <div className="w-[15%] bg-gray-50 border-r border-gray-200 px-6 py-4 flex flex-col">
        <h2 className="text-lg font-semibold mb-4">Photos</h2>
        <Toggle />
        <div className="text-center text-gray-500 mt-8">
          <p className="mb-2">Supabase not configured</p>
          <p className="text-sm">
            Create a .env.local file with your Supabase credentials to enable photo uploads
          </p>
        </div>
      </div>
    )
  }

  // ===== PET PHOTOS VIEW =====

  if (viewMode === 'petPhotos') {
    return (
      <div className="w-[15%] bg-gray-50 border-r border-gray-200 px-6 py-4 flex flex-col">
        <h2 className="text-lg font-semibold mb-2">Photos</h2>
        <Toggle />

        {/* Search */}
        <div className="relative mb-3">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-gray-400" />
          <input
            type="text"
            value={petSearchText}
            onChange={(e) => setPetSearchText(e.target.value)}
            placeholder="Search pet name..."
            className="w-full pl-7 pr-6 py-1.5 text-xs border border-gray-300 rounded-md focus:outline-none focus:ring-1 focus:ring-blue-400"
          />
          {petSearchText && (
            <button
              onClick={() => { setPetSearchText(''); setPetActiveSearch(''); loadPetPhotos(0, false, '') }}
              className="absolute right-1.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
            >
              <X className="h-3 w-3" />
            </button>
          )}
        </div>

        {/* Selection Controls */}
        <div className="flex gap-2 mb-3">
          <button
            onClick={selectAllProdPhotos}
            className="px-2 py-0.5 text-[10px] bg-blue-500 text-white rounded hover:bg-blue-600"
          >
            Select All
          </button>
          <button
            onClick={clearProdSelection}
            className="px-2 py-0.5 text-[10px] bg-gray-500 text-white rounded hover:bg-gray-600"
          >
            Clear
          </button>
          <span className="ml-auto text-[10px] text-gray-500">
            {totalSelected} selected
          </span>
        </div>

        {/* Pet Photos Grid */}
        <div className="flex-1 overflow-y-auto">
          {!prodConfigured && (
            <p className="text-center text-gray-500 text-xs mt-8">
              Production Supabase not configured
            </p>
          )}

          <div className="grid grid-cols-2 gap-2">
            {petPhotos.map((pet, index) => {
              const isLast = index === petPhotos.length - 1
              const isSelected = pet.image_url && selectedProdPhotoUrls.includes(pet.image_url)

              if (!pet.image_url) return null

              return (
                <button
                  key={pet.id || index}
                  ref={isLast ? lastPetElementRef : null}
                  onClick={() => toggleProdPhotoSelection(pet.image_url)}
                  className={`
                    relative block w-full aspect-square rounded-lg overflow-hidden
                    transition-all duration-200 transform
                    ${isSelected
                      ? 'ring-2 ring-black ring-offset-2 scale-70'
                      : 'hover:opacity-90'
                    }
                  `}
                  title={pet.pet_name || 'Pet photo'}
                >
                  <img
                    src={pet.image_url}
                    alt={pet.pet_name || 'Pet'}
                    className="w-full h-full object-cover"
                    onError={(e) => { e.target.parentElement.style.display = 'none' }}
                  />

                  {isSelected && (
                    <>
                      <div className="absolute inset-0 bg-black bg-opacity-20 pointer-events-none" />
                      <div className="absolute top-1 right-1 bg-black text-white rounded-full p-1 shadow-lg pointer-events-none">
                        <Check className="h-3 w-3" />
                      </div>
                    </>
                  )}

                  {pet.pet_name && (
                    <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/60 to-transparent px-1.5 py-1 pointer-events-none">
                      <p className="text-[9px] text-white truncate">{pet.pet_name}</p>
                    </div>
                  )}
                </button>
              )
            })}
          </div>

          {petLoading && (
            <div className="text-center py-4">
              <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-500 mx-auto"></div>
            </div>
          )}

          {petPhotos.length === 0 && !petLoading && (
            <p className="text-center text-gray-500 text-xs mt-8">
              {petActiveSearch ? `No pets match "${petActiveSearch}"` : 'No pet photos found'}
            </p>
          )}
        </div>
      </div>
    )
  }

  // ===== MY PHOTOS VIEW (original) =====

  return (
    <div className="w-[15%] bg-gray-50 border-r border-gray-200 px-6 py-4 flex flex-col">
      <h2 className="text-lg font-semibold mb-2">Photos</h2>
      <Toggle />

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
            {totalSelected} selected
          </span>
        </div>
      )}
      {/* Photo Grid */}
      <div className="mt-4 flex-1 overflow-y-auto">
        <div className="grid grid-cols-2 gap-3">
          {photos.map((photo) => (
            <button
              key={photo.id}
              onClick={() => togglePhotoSelection(photo.id)}
              className={`
          relative block w-full aspect-square rounded-lg overflow-hidden
          transition-all duration-200 transform
          ${selectedPhotos.includes(photo.id)
                  ? 'ring-2 ring-black ring-offset-2 scale-70'
                  : 'hover:opacity-90'
                }
        `}
              aria-label={`${selectedPhotos.includes(photo.id) ? 'Deselect' : 'Select'} ${photo.file_name}`}
            >
              <img
                src={photo.url}
                alt={photo.file_name}
                className="w-full h-full object-cover"
              />

              {selectedPhotos.includes(photo.id) && (
                <>
                  <div className="absolute inset-0 bg-black bg-opacity-20 pointer-events-none" />
                  <div className="absolute top-2 right-2 bg-black text-white rounded-full p-1.5 shadow-lg pointer-events-none">
                    <Check className="h-4 w-4" />
                  </div>
                </>
              )}
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
