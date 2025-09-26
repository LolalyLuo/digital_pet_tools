import { useState, useEffect, useCallback, useRef } from 'react'
import { Download, Copy, Check } from 'lucide-react'
import { createClient } from '@supabase/supabase-js'

// Production Supabase configuration
const PROD_CONFIG = {
  url: import.meta.env.VITE_PAWPRINT_SUPABASE_URL,
  anonKey: import.meta.env.VITE_PAWPRINT_SUPABASE_ANON_KEY,
  serviceRoleKey: import.meta.env.VITE_PAWPRINT_SUPABASE_SERVICE_ROLE_KEY,
  // Try different bucket names - update this to match your actual bucket
  possibleBucketNames: ['product-images', 'ai-generated-images', 'ai_generated_images', 'generated-images', 'images']
}

// Check if credentials are properly configured
const isConfigured = PROD_CONFIG.url && PROD_CONFIG.anonKey &&
  !PROD_CONFIG.url.includes('your-prod-url') &&
  !PROD_CONFIG.anonKey.includes('your-anon-key')

// Debug logging
console.log('ProdImages Debug:', {
  url: PROD_CONFIG.url,
  anonKey: PROD_CONFIG.anonKey ? 'Present' : 'Missing',
  isConfigured
})

// Production Supabase client (only create if properly configured)
const prodSupabase = isConfigured ? createClient(PROD_CONFIG.url, PROD_CONFIG.anonKey) : null

export default function ProdImages() {
  const [generatedImages, setGeneratedImages] = useState([])
  const [loading, setLoading] = useState(false)
  const [hasMore, setHasMore] = useState(true)
  const [page, setPage] = useState(0)
  const [isLoadingMore, setIsLoadingMore] = useState(false)
  const [copiedId, setCopiedId] = useState(null)
  const [currentBucketIndex, setCurrentBucketIndex] = useState(0)
  const observer = useRef()
  const lastImageRef = useRef()

  const ITEMS_PER_PAGE = 30

  // Load generated images from production database
  const loadGeneratedImages = useCallback(async (pageNum = 0, append = false) => {
    if (loading || !prodSupabase) return

    setLoading(true)
    try {
      const { data, error } = await prodSupabase
        .from('ai_generated_images')
        .select(`
          id,
          ai_generated_path,
          created_at
        `)
        .order('created_at', { ascending: false })
        .range(pageNum * ITEMS_PER_PAGE, (pageNum + 1) * ITEMS_PER_PAGE - 1)

      if (error) throw error

      if (data) {
        const imagesWithUrls = data.map(img => {
          // Use the currently selected bucket
          const bucketName = PROD_CONFIG.possibleBucketNames[currentBucketIndex]

          // Clean the path - remove leading slash and bucket name if it's already included
          let cleanPath = img.ai_generated_path
          if (cleanPath.startsWith('/')) {
            cleanPath = cleanPath.substring(1) // Remove leading slash
          }
          if (cleanPath.startsWith(`${bucketName}/`)) {
            cleanPath = cleanPath.substring(bucketName.length + 1) // Remove bucket name prefix
          }

          const publicUrl = prodSupabase.storage
            .from(bucketName)
            .getPublicUrl(cleanPath).data.publicUrl

          // Debug logging for each image
          console.log('Image URL Debug:', {
            id: img.id,
            originalPath: img.ai_generated_path,
            cleanPath: cleanPath,
            bucketName: bucketName,
            publicUrl: publicUrl,
            allPossibleBuckets: PROD_CONFIG.possibleBucketNames
          })

          return {
            ...img,
            public_url: publicUrl,
            bucket_name: bucketName
          }
        })

        if (append) {
          setGeneratedImages(prev => [...prev, ...imagesWithUrls])
        } else {
          setGeneratedImages(imagesWithUrls)
        }

        setHasMore(data.length === ITEMS_PER_PAGE)
        setPage(pageNum)
      }
    } catch (error) {
      console.error('Failed to load production images:', error)
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
  }, [loadGeneratedImages, currentBucketIndex])

  // Cleanup observer on unmount
  useEffect(() => {
    return () => {
      if (observer.current) {
        observer.current.disconnect()
      }
    }
  }, [])

  const downloadImage = async (imageUrl, filename) => {
    try {
      const response = await fetch(imageUrl)
      const blob = await response.blob()
      const url = window.URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = filename || 'prod-image.png'
      document.body.appendChild(a)
      a.click()
      window.URL.revokeObjectURL(url)
      document.body.removeChild(a)
    } catch (error) {
      console.error('Download failed:', error)
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

  // Show configuration error if credentials are not set up
  if (!isConfigured) {
    return (
      <div className="w-full bg-gray-50 px-6 py-6">
        <h2 className="text-lg font-semibold mb-4">Production Images</h2>
        <div className="text-center text-gray-500 mt-8">
          <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-6 max-w-md mx-auto">
            <h3 className="text-lg font-medium text-yellow-800 mb-2">Configuration Required</h3>
            <p className="text-sm text-yellow-700 mb-4">
              Production Supabase credentials are not configured. Please add the following environment variables:
            </p>
            <div className="text-left bg-yellow-100 p-3 rounded text-xs font-mono">
              <div>VITE_PAWPRINT_SUPABASE_URL=your_actual_url</div>
              <div>VITE_PAWPRINT_SUPABASE_ANON_KEY=your_actual_key</div>
              <div>VITE_PAWPRINT_SUPABASE_SERVICE_ROLE_KEY=your_service_role_key</div>
            </div>
            <p className="text-xs text-yellow-600 mt-3">
              Add these to your .env file and restart the development server.
            </p>
          </div>
        </div>
      </div>
    )
  }

  if (generatedImages.length === 0 && !loading) {
    return (
      <div className="w-full bg-gray-50 px-6 py-6">
        <h2 className="text-lg font-semibold mb-4">Production Images</h2>
        <div className="text-center text-gray-500 mt-8">
          <p>No production images found</p>
          <p className="text-sm mt-2">
            Images from the production database will appear here
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="w-full bg-gray-50 px-6 py-6 flex flex-col">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-lg font-semibold">
          Production Images ({generatedImages.length} images)
        </h2>
        <div className="flex items-center gap-2">
          <label className="text-sm text-gray-600">Bucket:</label>
          <select
            value={currentBucketIndex}
            onChange={(e) => setCurrentBucketIndex(parseInt(e.target.value))}
            className="px-2 py-1 text-sm border border-gray-300 rounded"
          >
            {PROD_CONFIG.possibleBucketNames.map((bucket, index) => (
              <option key={bucket} value={index}>
                {bucket}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Images Grid */}
      <div className="flex-1 overflow-y-auto">
        <div className="grid grid-cols-3 gap-4">
          {generatedImages.map((image, index) => {
            const isLast = index === generatedImages.length - 1

            return (
              <div
                key={image.id}
                className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden"
                ref={isLast ? lastImageElementRef : null}
              >
                {/* Generated Image */}
                <div className="aspect-square overflow-hidden bg-gray-100">
                  <img
                    src={image.public_url}
                    alt="Production Image"
                    className="w-full h-full object-contain"
                    onError={(e) => {
                      e.target.style.display = 'none'
                      e.target.nextSibling.style.display = 'flex'
                    }}
                  />
                  <div className="w-full h-full bg-gray-200 flex items-center justify-center text-gray-500 text-sm" style={{ display: 'none' }}>
                    Image not found
                  </div>
                </div>

                {/* Image Info */}
                <div className="p-3 bg-gray-50">
                  {/* Path */}
                  <div className="mb-3">
                    <div className="flex items-start gap-2">
                      <p className="flex-1 text-sm text-gray-600 line-clamp-3 overflow-hidden" title={image.ai_generated_path}>
                        <strong>Path:</strong> {image.ai_generated_path}
                      </p>
                      <button
                        onClick={() => copyToClipboard(image.ai_generated_path, image.id)}
                        className="p-1 text-gray-400 hover:text-gray-600 flex-shrink-0"
                        title="Copy path"
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
                        `prod-image-${image.id}.png`
                      )}
                      className="flex-1 px-3 py-2 text-xs bg-green-500 text-white rounded hover:bg-green-600 flex items-center justify-center gap-1"
                    >
                      <Download className="h-3 w-3" />
                      Download
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
