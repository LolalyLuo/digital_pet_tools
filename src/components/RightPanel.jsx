import { useState, useEffect, useCallback, useRef } from 'react'
import { Download, Trash2, Copy, Check, Search, X, RefreshCw } from 'lucide-react'
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

export default function RightPanel({ results, setResults }) {
  const [viewMode, setViewMode] = useState('results') // 'results' | 'petPhotos'

  // --- Results state ---
  const [generatedImages, setGeneratedImages] = useState([])
  const [loading, setLoading] = useState(false)
  const [hasMore, setHasMore] = useState(true)
  const [page, setPage] = useState(0)
  const [isLoadingMore, setIsLoadingMore] = useState(false)
  const [copiedId, setCopiedId] = useState(null)
  const [searchText, setSearchText] = useState('')
  const [activeSearch, setActiveSearch] = useState('')
  const observer = useRef()
  const lastImageRef = useRef()
  const searchTimeout = useRef()
  const loadingRef = useRef(false)
  const initialMount = useRef(true)

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
  const petInitialMount = useRef(true)
  const petInitiated = useRef(false)

  const ITEMS_PER_PAGE = 30

  // ===== RESULTS LOGIC =====

  const loadGeneratedImages = useCallback(async (pageNum = 0, append = false, search = '') => {
    if (loadingRef.current) return

    loadingRef.current = true
    setLoading(true)
    try {
      let query = supabase
        .from('generated_images')
        .select(`
          id,
          number,
          image_url,
          generated_prompt,
          initial_prompt,
          created_at,
          photo_id,
          model,
          size
        `)
        .order('created_at', { ascending: false })

      if (search.trim()) {
        const term = `%${search.trim()}%`
        query = query.or(`generated_prompt.ilike.${term},initial_prompt.ilike.${term}`)
      }

      query = query.range(pageNum * ITEMS_PER_PAGE, (pageNum + 1) * ITEMS_PER_PAGE - 1)

      const { data, error } = await query

      if (error) throw error

      if (data) {
        const imagesWithUrls = data.map(img => ({
          ...img,
          public_url: supabase.storage
            .from('generated-images')
            .getPublicUrl(img.image_url).data.publicUrl
        }))

        if (append) {
          setGeneratedImages(prev => [...prev, ...imagesWithUrls])
        } else {
          setGeneratedImages(imagesWithUrls)
        }

        setHasMore(data.length === ITEMS_PER_PAGE)
        setPage(pageNum)
      }
    } catch (error) {
      console.error('Failed to load generated images:', error)
    } finally {
      loadingRef.current = false
      setLoading(false)
    }
  }, [])

  const loadMore = useCallback(async () => {
    if (isLoadingMore || !hasMore) return

    setIsLoadingMore(true)
    try {
      const nextPage = page + 1
      await loadGeneratedImages(nextPage, true, activeSearch)
    } finally {
      setIsLoadingMore(false)
    }
  }, [isLoadingMore, hasMore, page, loadGeneratedImages, activeSearch])

  const lastImageElementRef = useCallback(node => {
    if (loading) return
    if (observer.current) observer.current.disconnect()

    observer.current = new IntersectionObserver(entries => {
      if (entries[0].isIntersecting && hasMore && !isLoadingMore) {
        loadMore()
      }
    })

    if (node) observer.current.observe(node)
  }, [loading, hasMore, loadMore, isLoadingMore])

  useEffect(() => {
    loadGeneratedImages(0, false, '')
  }, [loadGeneratedImages])

  useEffect(() => {
    if (results.length > 0) {
      loadGeneratedImages(0, false, activeSearch)
    }
  }, [results.length, loadGeneratedImages, activeSearch])

  useEffect(() => {
    if (initialMount.current) {
      initialMount.current = false
      return
    }
    clearTimeout(searchTimeout.current)
    searchTimeout.current = setTimeout(() => {
      setActiveSearch(searchText)
      loadGeneratedImages(0, false, searchText)
    }, 400)
    return () => clearTimeout(searchTimeout.current)
  }, [searchText, loadGeneratedImages])

  useEffect(() => {
    return () => {
      if (observer.current) observer.current.disconnect()
    }
  }, [])

  const clearSearch = () => {
    setSearchText('')
    setActiveSearch('')
    loadGeneratedImages(0, false, '')
  }

  const clearAllResults = () => {
    setResults([])
    setGeneratedImages([])
    setPage(0)
    setHasMore(true)
    loadGeneratedImages(0, false, activeSearch)
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

  const deleteImage = async (imageId) => {
    try {
      const { error } = await supabase
        .from('generated_images')
        .delete()
        .eq('id', imageId)

      if (error) throw error

      setGeneratedImages(prev => prev.filter(img => img.id !== imageId))
      setResults(prev => prev.filter(result => result.id !== imageId))
    } catch (error) {
      console.error('Delete failed:', error)
    }
  }

  const copyToClipboard = async (text, id) => {
    try {
      await navigator.clipboard.writeText(text)
      setCopiedId(id)
      setTimeout(() => setCopiedId(null), 2000)
    } catch (err) {
      console.error('Failed to copy text: ', err)
    }
  }

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

  // Load pet photos on first switch to pet view
  useEffect(() => {
    if (viewMode === 'petPhotos' && !petInitiated.current) {
      petInitiated.current = true
      loadPetPhotos(0, false, '')
    }
  }, [viewMode, loadPetPhotos])

  // Debounced pet search
  useEffect(() => {
    if (petInitialMount.current) {
      petInitialMount.current = false
      return
    }
    clearTimeout(petSearchTimeout.current)
    petSearchTimeout.current = setTimeout(() => {
      setPetActiveSearch(petSearchText)
      loadPetPhotos(0, false, petSearchText)
    }, 400)
    return () => clearTimeout(petSearchTimeout.current)
  }, [petSearchText, loadPetPhotos])

  useEffect(() => {
    return () => {
      if (petObserver.current) petObserver.current.disconnect()
    }
  }, [])

  const clearPetSearch = () => {
    setPetSearchText('')
    setPetActiveSearch('')
    loadPetPhotos(0, false, '')
  }

  // ===== TOGGLE =====

  const Toggle = () => (
    <div className="flex bg-gray-200 rounded-lg p-0.5 mb-4">
      <button
        onClick={() => setViewMode('results')}
        className={`flex-1 px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
          viewMode === 'results'
            ? 'bg-white text-gray-900 shadow-sm'
            : 'text-gray-500 hover:text-gray-700'
        }`}
      >
        Results
      </button>
      <button
        onClick={() => setViewMode('petPhotos')}
        className={`flex-1 px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
          viewMode === 'petPhotos'
            ? 'bg-white text-gray-900 shadow-sm'
            : 'text-gray-500 hover:text-gray-700'
        }`}
      >
        Pet Photos
      </button>
    </div>
  )

  // ===== PET PHOTOS VIEW =====

  if (viewMode === 'petPhotos') {
    if (!prodConfigured) {
      return (
        <div className="w-[60%] bg-gray-50 border-l border-gray-200 px-6 py-6">
          <Toggle />
          <div className="text-center text-gray-500 mt-8">
            <p className="text-sm">Production Supabase not configured.</p>
            <p className="text-xs mt-1 text-gray-400">Add VITE_PAWPRINT_SUPABASE_URL and VITE_PAWPRINT_SUPABASE_ANON_KEY to .env</p>
          </div>
        </div>
      )
    }

    return (
      <div className="w-[60%] bg-gray-50 border-l border-gray-200 px-6 py-6 flex flex-col">
        <Toggle />

        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <h2 className="text-lg font-semibold">
              Pet Photos ({petPhotos.length})
            </h2>
            <button
              onClick={() => loadPetPhotos(0, false, petActiveSearch)}
              disabled={petLoading}
              className="p-1.5 text-gray-400 hover:text-blue-500 rounded hover:bg-gray-200 transition-colors disabled:opacity-50"
              title="Refresh"
            >
              <RefreshCw className={`h-4 w-4 ${petLoading ? 'animate-spin' : ''}`} />
            </button>
          </div>
        </div>

        {/* Search */}
        <div className="mb-4">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-gray-400" />
            <input
              type="text"
              value={petSearchText}
              onChange={(e) => setPetSearchText(e.target.value)}
              placeholder="Search by pet name..."
              className="w-full pl-8 pr-8 py-1.5 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-1 focus:ring-blue-400 focus:border-blue-400"
            />
            {petSearchText && (
              <button
                onClick={clearPetSearch}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        </div>

        {/* Grid */}
        <div className="flex-1 overflow-y-auto">
          {petPhotos.length === 0 && !petLoading && (
            <div className="text-center text-gray-500 mt-8">
              <p className="text-sm">{petActiveSearch ? `No pets match "${petActiveSearch}"` : 'No pet photos found'}</p>
              {petActiveSearch && (
                <button onClick={clearPetSearch} className="text-sm text-blue-500 hover:text-blue-600 mt-2">
                  Clear search
                </button>
              )}
            </div>
          )}

          <div className="grid grid-cols-2 gap-4">
            {petPhotos.map((pet, index) => {
              const isLast = index === petPhotos.length - 1
              const fieldId = `pet-${pet.id || index}`
              const isCopied = copiedId === fieldId

              return (
                <div
                  key={pet.id || index}
                  className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden"
                  ref={isLast ? lastPetElementRef : null}
                >
                  <div className="aspect-square overflow-hidden bg-gray-100">
                    {pet.image_url ? (
                      <>
                        <img
                          src={pet.image_url}
                          alt={pet.pet_name || 'Pet'}
                          className="w-full h-full object-contain"
                          onError={(e) => {
                            e.target.style.display = 'none'
                            e.target.nextSibling.style.display = 'flex'
                          }}
                        />
                        <div className="w-full h-full bg-gray-200 flex items-center justify-center text-gray-500 text-xs" style={{ display: 'none' }}>
                          Image not found
                        </div>
                      </>
                    ) : (
                      <div className="w-full h-full bg-gray-200 flex items-center justify-center text-gray-500 text-xs">
                        No image
                      </div>
                    )}
                  </div>

                  <div className="p-3 bg-gray-50 space-y-1">
                    {pet.pet_name && (
                      <div className="flex items-center gap-2">
                        <p className="flex-1 text-sm font-medium text-gray-800 truncate">{pet.pet_name}</p>
                        <button
                          onClick={() => copyToClipboard(pet.pet_name, fieldId)}
                          className="p-1 text-gray-400 hover:text-gray-600 flex-shrink-0"
                          title="Copy name"
                        >
                          {isCopied ? <Check className="h-3 w-3 text-green-500" /> : <Copy className="h-3 w-3" />}
                        </button>
                      </div>
                    )}
                    {pet.pet_gender && (
                      <p className="text-xs text-gray-500">Gender: {pet.pet_gender}</p>
                    )}
                    {pet.pet_personality && (
                      <p className="text-xs text-gray-500 truncate" title={pet.pet_personality}>Personality: {pet.pet_personality}</p>
                    )}
                    {pet.user_email && (
                      <p className="text-xs text-gray-400 truncate" title={pet.user_email}>{pet.user_email}</p>
                    )}
                    {pet.created_at && (
                      <p className="text-xs text-gray-400">
                        {new Date(pet.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                      </p>
                    )}

                    {pet.image_url && (
                      <div className="pt-1">
                        <button
                          onClick={() => downloadImage(pet.image_url, `pet-${pet.pet_name || pet.id}.png`)}
                          className="w-full px-3 py-1.5 text-xs bg-green-500 text-white rounded hover:bg-green-600 flex items-center justify-center gap-1"
                        >
                          <Download className="h-3 w-3" />
                          Download
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              )
            })}
          </div>

          {(petIsLoadingMore || petLoading) && (
            <div className="text-center py-4">
              <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-500 mx-auto"></div>
              <p className="text-sm text-gray-500 mt-2">Loading pet photos...</p>
            </div>
          )}

          {!petHasMore && petPhotos.length > 0 && (
            <div className="text-center py-4">
              <p className="text-sm text-gray-500">No more photos to load</p>
            </div>
          )}
        </div>
      </div>
    )
  }

  // ===== RESULTS VIEW (original) =====

  if (generatedImages.length === 0 && !loading && !activeSearch) {
    return (
      <div className="w-[60%] bg-gray-50 border-l border-gray-200 px-6 py-6">
        <Toggle />
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
    <div className="w-[60%] bg-gray-50 border-l border-gray-200 px-6 py-6 flex flex-col">
      <Toggle />

      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <h2 className="text-lg font-semibold">
            Results ({generatedImages.length} images)
          </h2>
          <button
            onClick={() => loadGeneratedImages(0, false, activeSearch)}
            disabled={loading}
            className="p-1.5 text-gray-400 hover:text-blue-500 rounded hover:bg-gray-200 transition-colors disabled:opacity-50"
            title="Refresh images"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
        <button
          onClick={clearAllResults}
          className="px-3 py-1 text-sm bg-red-500 text-white rounded hover:bg-red-600 flex items-center gap-2"
        >
          <Trash2 className="h-4 w-4" />
          Clear All Results
        </button>
      </div>

      {/* Search filter */}
      <div className="mb-4">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-gray-400" />
          <input
            type="text"
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
            placeholder="Search prompts..."
            className="w-full pl-8 pr-8 py-1.5 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-1 focus:ring-blue-400 focus:border-blue-400"
          />
          {searchText && (
            <button
              onClick={clearSearch}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
              title="Clear search"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* Images Grid */}
      <div className="flex-1 overflow-y-auto">
        <div className="grid grid-cols-2 gap-4">
          {generatedImages.map((image, index) => {
            const isLast = index === generatedImages.length - 1

            return (
              <div
                key={image.id}
                className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden"
                ref={isLast ? lastImageElementRef : null}
              >
                {/* Generated Image */}
                <div className="aspect-square overflow-hidden transparency-bg">
                  <img
                    src={image.public_url}
                    alt="Generated"
                    className="w-full h-full object-contain"
                  />
                </div>

                {/* Image Info */}
                <div className="p-3">
                  {/* Model & Size */}
                  {(image.model || image.size) && (
                    <div className="flex items-center gap-2 mb-2 text-xs text-gray-400">
                      {image.model && <span className="bg-gray-100 px-1.5 py-0.5 rounded">{image.model}</span>}
                      {image.size && <span className="bg-gray-100 px-1.5 py-0.5 rounded">{image.size}</span>}
                    </div>
                  )}

                  {/* Prompt */}
                  <div className="mb-3">
                    <div className="flex items-start gap-2">
                      <p className="flex-1 text-sm text-gray-600 line-clamp-3 overflow-hidden" title={image.generated_prompt || image.initial_prompt}>
                        <strong>#{image.number}:</strong> {image.generated_prompt || image.initial_prompt}
                      </p>
                      <button
                        onClick={() => copyToClipboard(image.generated_prompt || image.initial_prompt, image.id)}
                        className="p-1 text-gray-400 hover:text-gray-600 flex-shrink-0"
                        title="Copy prompt"
                      >
                        {copiedId === image.id ? (
                          <Check className="h-3 w-3 text-green-500" />
                        ) : (
                          <Copy className="h-3 w-3" />
                        )}
                      </button>
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="flex gap-2">
                    <button
                      onClick={() => downloadImage(
                        image.public_url,
                        `generated-${image.id}.png`
                      )}
                      className="flex-1 px-3 py-2 text-xs bg-green-500 text-white rounded hover:bg-green-600 flex items-center justify-center gap-1"
                    >
                      <Download className="h-3 w-3" />
                      Download
                    </button>
                    <button
                      onClick={() => deleteImage(image.id)}
                      className="px-3 py-2 text-xs bg-red-500 text-white rounded hover:bg-red-600"
                      title="Delete image"
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </div>
                </div>
              </div>
            )
          })}
        </div>

        {/* Loading indicator */}
        {(isLoadingMore || loading) && (
          <div className="text-center py-4">
            <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-500 mx-auto"></div>
            <p className="text-sm text-gray-500 mt-2">Loading images...</p>
          </div>
        )}

        {/* No matching images */}
        {generatedImages.length === 0 && !loading && activeSearch && (
          <div className="text-center py-8">
            <p className="text-sm text-gray-500">No images match "{activeSearch}"</p>
            <button
              onClick={clearSearch}
              className="text-sm text-blue-500 hover:text-blue-600 mt-2"
            >
              Clear search
            </button>
          </div>
        )}

        {/* End of results */}
        {!hasMore && generatedImages.length > 0 && (
          <div className="text-center py-4">
            <p className="text-sm text-gray-500">No more images to load</p>
          </div>
        )}
      </div>
    </div>
  )
}
