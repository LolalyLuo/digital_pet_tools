import { useState, useEffect, useCallback, useRef } from 'react'
import { Download, Trash2, Copy, Check } from 'lucide-react'
import { supabase } from '../utils/supabaseClient'

export default function RightPanel({ results, setResults }) {
  const [generatedImages, setGeneratedImages] = useState([])
  const [loading, setLoading] = useState(false)
  const [hasMore, setHasMore] = useState(true)
  const [page, setPage] = useState(0)
  const [isLoadingMore, setIsLoadingMore] = useState(false)
  const [copiedId, setCopiedId] = useState(null)
  const observer = useRef()
  const lastImageRef = useRef()

  const ITEMS_PER_PAGE = 30

  // Load generated images from database
  const loadGeneratedImages = useCallback(async (pageNum = 0, append = false) => {
    if (loading) return

    setLoading(true)
    try {
      const { data, error } = await supabase
        .from('generated_images')
        .select(`
          id,
          number,
          image_url,
          generated_prompt,
          initial_prompt,
          created_at,
          photo_id
        `)
        .order('created_at', { ascending: false })
        .range(pageNum * ITEMS_PER_PAGE, (pageNum + 1) * ITEMS_PER_PAGE - 1)

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
      setLoading(false)
    }
  }, [])

  // Load more images when scrolling
  const loadMore = useCallback(async () => {
    if (isLoadingMore || !hasMore) return

    setIsLoadingMore(true)
    try {
      const nextPage = page + 1
      await loadGeneratedImages(nextPage, true)
    } finally {
      setIsLoadingMore(false)
    }
  }, [isLoadingMore, hasMore, page, loadGeneratedImages])

  // Intersection observer for infinite scroll
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

  // Initial load
  useEffect(() => {
    loadGeneratedImages(0, false)
  }, [loadGeneratedImages])

  // Auto-reload when new results are added (after image generation)
  useEffect(() => {
    if (results.length > 0) {
      // Reload images from database to show newly generated ones
      loadGeneratedImages(0, false)
    }
  }, [results.length, loadGeneratedImages])

  // Cleanup observer on unmount
  useEffect(() => {
    return () => {
      if (observer.current) {
        observer.current.disconnect()
      }
    }
  }, [])

  const clearAllResults = () => {
    setResults([])
    setGeneratedImages([])
    setPage(0)
    setHasMore(true)
    // Reload images from database
    loadGeneratedImages(0, false)
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
      // Delete from database
      const { error } = await supabase
        .from('generated_images')
        .delete()
        .eq('id', imageId)

      if (error) throw error

      // Remove from local state
      setGeneratedImages(prev => prev.filter(img => img.id !== imageId))
      setResults(prev => prev.filter(result => result.id !== imageId))
    } catch (error) {
      console.error('Delete failed:', error)
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

  if (generatedImages.length === 0 && !loading) {
    return (
      <div className="w-[60%] bg-gray-50 border-l border-gray-200 px-6 py-6">
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
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-lg font-semibold">
          Results ({generatedImages.length} images)
        </h2>
        <button
          onClick={clearAllResults}
          className="px-3 py-1 text-sm bg-red-500 text-white rounded hover:bg-red-600 flex items-center gap-2"
        >
          <Trash2 className="h-4 w-4" />
          Clear All Results
        </button>
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
        {isLoadingMore && (
          <div className="text-center py-4">
            <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-500 mx-auto"></div>
            <p className="text-sm text-gray-500 mt-2">Loading more images...</p>
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
