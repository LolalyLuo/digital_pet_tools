import { useState, useEffect, useCallback, useRef } from 'react'
import { Download, Copy, Check, Search, X } from 'lucide-react'
import { createClient } from '@supabase/supabase-js'

// Production Supabase configuration
const PROD_CONFIG = {
  url: import.meta.env.VITE_PAWPRINT_SUPABASE_URL,
  anonKey: import.meta.env.VITE_PAWPRINT_SUPABASE_ANON_KEY,
  serviceRoleKey: import.meta.env.VITE_PAWPRINT_SUPABASE_SERVICE_ROLE_KEY,
}

// Table configurations
const TABLE_CONFIGS = {
  pets: {
    name: 'Pets',
    fields: ['upload_id', 'user_id', 'pet_name', 'pet_gender', 'pet_personality', 'user_email', 'created_at'],
    imageField: 'image_url',
    filter: { shop: 'vuse04-um.myshopify.com' },
    orderBy: 'created_at'
  },
  ai_images: {
    name: 'AI Images',
    fields: ['upload_id', 'user_id', 'ai_image_name', 'created_at'],
    imageField: 'image_url',
    filter: null,
    orderBy: 'created_at'
  },
  personalized_images: {
    name: 'Personalized Images',
    fields: ['upload_id', 'user_id', 'original_filename', 'created_at'],
    imageField: 'printify_image_url',
    filter: { shop: 'vuse04-um.myshopify.com' },
    orderBy: 'created_at'
  }
}

// Check if credentials are properly configured
const isConfigured = PROD_CONFIG.url && PROD_CONFIG.anonKey &&
  !PROD_CONFIG.url.includes('your-prod-url') &&
  !PROD_CONFIG.anonKey.includes('your-anon-key')

// Production Supabase client (only create if properly configured)
const prodSupabase = isConfigured ? createClient(PROD_CONFIG.url, PROD_CONFIG.anonKey) : null

export default function ProdImages() {
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(false)
  const [hasMore, setHasMore] = useState(true)
  const [page, setPage] = useState(0)
  const [isLoadingMore, setIsLoadingMore] = useState(false)
  const [copiedField, setCopiedField] = useState(null)
  const [selectedTable, setSelectedTable] = useState('pets')
  const [filterUserId, setFilterUserId] = useState('')
  const [filterUploadId, setFilterUploadId] = useState('')
  const [filterPetName, setFilterPetName] = useState('')
  const [filterAiImageName, setFilterAiImageName] = useState('')
  const [filterByShop, setFilterByShop] = useState(true)
  const observer = useRef()

  const ITEMS_PER_PAGE = 30

  // Load items from selected table
  const loadItems = useCallback(async (pageNum = 0, append = false) => {
    if (!prodSupabase) return

    setLoading(true)
    try {
      const config = TABLE_CONFIGS[selectedTable]
      if (!config) return

      // Build query
      let query = prodSupabase
        .from(selectedTable)
        .select('*')
        .order(config.orderBy, { ascending: false })
        .range(pageNum * ITEMS_PER_PAGE, (pageNum + 1) * ITEMS_PER_PAGE - 1)

      // Apply table-specific filters if needed (only if filterByShop is enabled)
      if (config.filter && filterByShop) {
        Object.entries(config.filter).forEach(([key, value]) => {
          query = query.eq(key, value)
        })
      }

      // Apply user ID filter if provided
      if (filterUserId.trim()) {
        query = query.eq('user_id', filterUserId.trim())
      }

      // Apply upload ID filter if provided
      if (filterUploadId.trim()) {
        query = query.eq('upload_id', filterUploadId.trim())
      }

      // Apply pet name filter if provided (pets table only)
      if (selectedTable === 'pets' && filterPetName.trim()) {
        query = query.ilike('pet_name', `%${filterPetName.trim()}%`)
      }

      // Apply AI image name filter if provided (ai_images table only)
      if (selectedTable === 'ai_images' && filterAiImageName.trim()) {
        query = query.ilike('ai_image_name', `%${filterAiImageName.trim()}%`)
      }

      const { data, error } = await query

      if (error) throw error

      if (data) {
        if (append) {
          setItems(prev => [...prev, ...data])
        } else {
          setItems(data)
        }

        setHasMore(data.length === ITEMS_PER_PAGE)
        setPage(pageNum)
      }
    } catch (error) {
      console.error(`Failed to load ${selectedTable}:`, error)
    } finally {
      setLoading(false)
    }
  }, [selectedTable, filterUserId, filterUploadId, filterPetName, filterAiImageName, filterByShop])

  // Load more items when scrolling
  const loadMore = useCallback(async () => {
    if (isLoadingMore || !hasMore) return

    setIsLoadingMore(true)
    try {
      const nextPage = page + 1
      await loadItems(nextPage, true)
    } finally {
      setIsLoadingMore(false)
    }
  }, [isLoadingMore, hasMore, page, loadItems])

  // Intersection observer for infinite scroll
  const lastItemElementRef = useCallback(node => {
    if (loading) return
    if (observer.current) observer.current.disconnect()

    observer.current = new IntersectionObserver(entries => {
      if (entries[0].isIntersecting && hasMore && !isLoadingMore) {
        loadMore()
      }
    })

    if (node) observer.current.observe(node)
  }, [loading, hasMore, loadMore, isLoadingMore])

  // Reset and reload when table changes
  useEffect(() => {
    setItems([])
    setPage(0)
    setHasMore(true)
    loadItems(0, false)
  }, [selectedTable, loadItems])

  // Reset filters when table changes
  useEffect(() => {
    setFilterUserId('')
    setFilterUploadId('')
    setFilterPetName('')
    setFilterAiImageName('')
  }, [selectedTable])

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
      a.download = filename || 'image.png'
      document.body.appendChild(a)
      a.click()
      window.URL.revokeObjectURL(url)
      document.body.removeChild(a)
    } catch (error) {
      console.error('Download failed:', error)
    }
  }

  const copyToClipboard = async (text, fieldId) => {
    if (!text) return
    try {
      await navigator.clipboard.writeText(text)
      setCopiedField(fieldId)
      setTimeout(() => setCopiedField(null), 2000)
    } catch (err) {
      console.error('Failed to copy text: ', err)
    }
  }

  const handleSearch = () => {
    setItems([])
    setPage(0)
    setHasMore(true)
    loadItems(0, false)
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

  const config = TABLE_CONFIGS[selectedTable]
  const imageField = config?.imageField || 'image_url'

  if (items.length === 0 && !loading) {
    return (
      <div className="w-full bg-gray-50 px-6 py-6">
        {/* Sticky Filter Bar */}
        <div className="sticky top-0 z-10 bg-white border-b border-gray-200 -mx-6 px-6 py-4 mb-6 shadow-sm">
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2 flex-1">
              <label className="text-sm font-medium text-gray-700 whitespace-nowrap">User ID:</label>
              <input
                type="text"
                value={filterUserId}
                onChange={(e) => setFilterUserId(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    handleSearch()
                  }
                }}
                placeholder="Filter by user ID"
                className="flex-1 px-3 py-2 text-sm border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
              {filterUserId && (
                <button
                  onClick={() => {
                    setFilterUserId('')
                    handleSearch()
                  }}
                  className="p-1 text-gray-400 hover:text-gray-600"
                  title="Clear user ID filter"
                >
                  <X className="h-4 w-4" />
                </button>
              )}
            </div>
            <div className="flex items-center gap-2 flex-1">
              <label className="text-sm font-medium text-gray-700 whitespace-nowrap">Upload ID:</label>
              <input
                type="text"
                value={filterUploadId}
                onChange={(e) => setFilterUploadId(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    handleSearch()
                  }
                }}
                placeholder="Filter by upload ID"
                className="flex-1 px-3 py-2 text-sm border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
              {filterUploadId && (
                <button
                  onClick={() => {
                    setFilterUploadId('')
                    handleSearch()
                  }}
                  className="p-1 text-gray-400 hover:text-gray-600"
                  title="Clear upload ID filter"
                >
                  <X className="h-4 w-4" />
                </button>
              )}
            </div>
            {selectedTable === 'pets' && (
              <div className="flex items-center gap-2 flex-1">
                <label className="text-sm font-medium text-gray-700 whitespace-nowrap">Pet Name:</label>
                <input
                  type="text"
                  value={filterPetName}
                  onChange={(e) => setFilterPetName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      handleSearch()
                    }
                  }}
                  placeholder="Filter by pet name"
                  className="flex-1 px-3 py-2 text-sm border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
                {filterPetName && (
                  <button
                    onClick={() => {
                      setFilterPetName('')
                      handleSearch()
                    }}
                    className="p-1 text-gray-400 hover:text-gray-600"
                    title="Clear pet name filter"
                  >
                    <X className="h-4 w-4" />
                  </button>
                )}
              </div>
            )}
            {selectedTable === 'ai_images' && (
              <div className="flex items-center gap-2 flex-1">
                <label className="text-sm font-medium text-gray-700 whitespace-nowrap">AI Image Name:</label>
                <input
                  type="text"
                  value={filterAiImageName}
                  onChange={(e) => setFilterAiImageName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      handleSearch()
                    }
                  }}
                  placeholder="Filter by AI image name"
                  className="flex-1 px-3 py-2 text-sm border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
                {filterAiImageName && (
                  <button
                    onClick={() => {
                      setFilterAiImageName('')
                      handleSearch()
                    }}
                    className="p-1 text-gray-400 hover:text-gray-600"
                    title="Clear AI image name filter"
                  >
                    <X className="h-4 w-4" />
                  </button>
                )}
              </div>
            )}
            <div className="flex items-center gap-2">
              <label className="text-sm font-medium text-gray-700 whitespace-nowrap">Filter by Shop:</label>
              <button
                onClick={() => {
                  setFilterByShop(!filterByShop)
                  setTimeout(() => handleSearch(), 0)
                }}
                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${filterByShop ? 'bg-blue-500' : 'bg-gray-300'
                  }`}
                role="switch"
                aria-checked={filterByShop}
              >
                <span
                  className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${filterByShop ? 'translate-x-6' : 'translate-x-1'
                    }`}
                />
              </button>
            </div>
            <button
              onClick={handleSearch}
              className="px-4 py-2 text-sm bg-blue-500 text-white rounded hover:bg-blue-600 flex items-center gap-2"
            >
              <Search className="h-4 w-4" />
              Search
            </button>
          </div>
        </div>

        <div className="flex items-center justify-between mb-6">
          <h2 className="text-lg font-semibold">Production Images</h2>
          <div className="flex items-center gap-2">
            <label className="text-sm text-gray-600">Table:</label>
            <select
              value={selectedTable}
              onChange={(e) => setSelectedTable(e.target.value)}
              className="px-2 py-1 text-sm border border-gray-300 rounded"
            >
              {Object.entries(TABLE_CONFIGS).map(([key, tableConfig]) => (
                <option key={key} value={key}>
                  {tableConfig.name}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="text-center text-gray-500 mt-8">
          <p>No items found in {config?.name || selectedTable}</p>
        </div>
      </div>
    )
  }

  return (
    <div className="w-full bg-gray-50 px-6 py-6 flex flex-col">
      {/* Sticky Filter Bar */}
      <div className="sticky top-0 z-10 bg-white border-b border-gray-200 -mx-6 px-6 py-4 mb-6 shadow-sm">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2 flex-1">
            <label className="text-sm font-medium text-gray-700 whitespace-nowrap">User ID:</label>
            <input
              type="text"
              value={filterUserId}
              onChange={(e) => setFilterUserId(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  handleSearch()
                }
              }}
              placeholder="Filter by user ID"
              className="flex-1 px-3 py-2 text-sm border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
            {filterUserId && (
              <button
                onClick={() => {
                  setFilterUserId('')
                  handleSearch()
                }}
                className="p-1 text-gray-400 hover:text-gray-600"
                title="Clear user ID filter"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
          <div className="flex items-center gap-2 flex-1">
            <label className="text-sm font-medium text-gray-700 whitespace-nowrap">Upload ID:</label>
            <input
              type="text"
              value={filterUploadId}
              onChange={(e) => setFilterUploadId(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  handleSearch()
                }
              }}
              placeholder="Filter by upload ID"
              className="flex-1 px-3 py-2 text-sm border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
            {filterUploadId && (
              <button
                onClick={() => {
                  setFilterUploadId('')
                  handleSearch()
                }}
                className="p-1 text-gray-400 hover:text-gray-600"
                title="Clear upload ID filter"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
          {selectedTable === 'pets' && (
            <div className="flex items-center gap-2 flex-1">
              <label className="text-sm font-medium text-gray-700 whitespace-nowrap">Pet Name:</label>
              <input
                type="text"
                value={filterPetName}
                onChange={(e) => setFilterPetName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    handleSearch()
                  }
                }}
                placeholder="Filter by pet name"
                className="flex-1 px-3 py-2 text-sm border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
              {filterPetName && (
                <button
                  onClick={() => {
                    setFilterPetName('')
                    handleSearch()
                  }}
                  className="p-1 text-gray-400 hover:text-gray-600"
                  title="Clear pet name filter"
                >
                  <X className="h-4 w-4" />
                </button>
              )}
            </div>
          )}
          {selectedTable === 'ai_images' && (
            <div className="flex items-center gap-2 flex-1">
              <label className="text-sm font-medium text-gray-700 whitespace-nowrap">AI Image Name:</label>
              <input
                type="text"
                value={filterAiImageName}
                onChange={(e) => setFilterAiImageName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    handleSearch()
                  }
                }}
                placeholder="Filter by AI image name"
                className="flex-1 px-3 py-2 text-sm border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
              {filterAiImageName && (
                <button
                  onClick={() => {
                    setFilterAiImageName('')
                    handleSearch()
                  }}
                  className="p-1 text-gray-400 hover:text-gray-600"
                  title="Clear AI image name filter"
                >
                  <X className="h-4 w-4" />
                </button>
              )}
            </div>
          )}
          <div className="flex items-center gap-2">
            <label className="text-sm font-medium text-gray-700 whitespace-nowrap">Filter by Shop:</label>
            <button
              onClick={() => {
                setFilterByShop(!filterByShop)
                setTimeout(() => handleSearch(), 0)
              }}
              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${filterByShop ? 'bg-blue-500' : 'bg-gray-300'
                }`}
              role="switch"
              aria-checked={filterByShop}
            >
              <span
                className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${filterByShop ? 'translate-x-6' : 'translate-x-1'
                  }`}
              />
            </button>
          </div>
          <button
            onClick={handleSearch}
            className="px-4 py-2 text-sm bg-blue-500 text-white rounded hover:bg-blue-600 flex items-center gap-2"
          >
            <Search className="h-4 w-4" />
            Search
          </button>
        </div>
      </div>

      <div className="flex items-center justify-between mb-6">
        <h2 className="text-lg font-semibold">
          {config?.name || 'Production Images'} ({items.length} items)
        </h2>
        <div className="flex items-center gap-2">
          <label className="text-sm text-gray-600">Table:</label>
          <select
            value={selectedTable}
            onChange={(e) => setSelectedTable(e.target.value)}
            className="px-2 py-1 text-sm border border-gray-300 rounded"
          >
            {Object.entries(TABLE_CONFIGS).map(([key, tableConfig]) => (
              <option key={key} value={key}>
                {tableConfig.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Items Grid */}
      <div className="flex-1 overflow-y-auto">
        <div className="grid grid-cols-3 gap-4">
          {items.map((item, index) => {
            const isLast = index === items.length - 1
            const imageUrl = item[imageField]
            const fieldId = `${selectedTable}-${item.id}`

            return (
              <div
                key={item.id}
                className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden"
                ref={isLast ? lastItemElementRef : null}
              >
                {/* Image */}
                <div className="aspect-square overflow-hidden bg-gray-100">
                  {imageUrl ? (
                    <>
                      <img
                        src={imageUrl}
                        alt={config?.name || 'Image'}
                        className="w-full h-full object-contain"
                        onError={(e) => {
                          e.target.style.display = 'none'
                          e.target.nextSibling.style.display = 'flex'
                        }}
                      />
                      <div className="w-full h-full bg-gray-200 flex items-center justify-center text-gray-500 text-sm" style={{ display: 'none' }}>
                        Image not found
                      </div>
                    </>
                  ) : (
                    <div className="w-full h-full bg-gray-200 flex items-center justify-center text-gray-500 text-sm">
                      No image URL
                    </div>
                  )}
                </div>

                {/* Item Info */}
                <div className="p-3 bg-gray-50 space-y-2">
                  {config?.fields.map((field) => {
                    let value = item[field]
                    const fieldKey = `${fieldId}-${field}`
                    const isCopied = copiedField === fieldKey

                    // Format created_at as readable date and time
                    if (field === 'created_at' && value) {
                      try {
                        const date = new Date(value)
                        value = date.toLocaleString('en-US', {
                          year: 'numeric',
                          month: 'short',
                          day: 'numeric',
                          hour: '2-digit',
                          minute: '2-digit',
                          second: '2-digit',
                          hour12: true
                        })
                      } catch (e) {
                        // If parsing fails, use original value
                      }
                    }

                    return (
                      <div key={field} className="flex items-start gap-2">
                        <p className="flex-1 text-xs text-gray-600">
                          <strong className="capitalize">{field.replace(/_/g, ' ')}:</strong>{' '}
                          <span className="break-words">{value || 'N/A'}</span>
                        </p>
                        {value && (
                          <button
                            onClick={() => copyToClipboard(field === 'created_at' ? item[field] : value, fieldKey)}
                            className="p-1 text-gray-400 hover:text-gray-600 flex-shrink-0"
                            title={`Copy ${field}`}
                          >
                            {isCopied ? (
                              <Check className="h-3 w-3 text-green-500" />
                            ) : (
                              <Copy className="h-3 w-3" />
                            )}
                          </button>
                        )}
                      </div>
                    )
                  })}

                  {/* Download button */}
                  {imageUrl && (
                    <div className="pt-2">
                      <button
                        onClick={() => downloadImage(
                          imageUrl,
                          `${selectedTable}-${item.id}.png`
                        )}
                        className="w-full px-3 py-2 text-xs bg-green-500 text-white rounded hover:bg-green-600 flex items-center justify-center gap-1"
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

        {/* Loading indicator */}
        {isLoadingMore && (
          <div className="text-center py-4">
            <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-500 mx-auto"></div>
            <p className="text-sm text-gray-500 mt-2">Loading more items...</p>
          </div>
        )}

        {/* End of results */}
        {!hasMore && items.length > 0 && (
          <div className="text-center py-4">
            <p className="text-sm text-gray-500">No more items to load</p>
          </div>
        )}
      </div>
    </div>
  )
}

