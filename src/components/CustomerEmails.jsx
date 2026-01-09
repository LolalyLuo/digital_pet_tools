import { useState, useEffect, useCallback, useRef } from 'react'
import { Check, Search, X, Mail, Send } from 'lucide-react'
import { createClient } from '@supabase/supabase-js'

// Production Supabase configuration
const PROD_CONFIG = {
  url: import.meta.env.VITE_PAWPRINT_SUPABASE_URL,
  anonKey: import.meta.env.VITE_PAWPRINT_SUPABASE_ANON_KEY,
  serviceRoleKey: import.meta.env.VITE_PAWPRINT_SUPABASE_SERVICE_ROLE_KEY,
}

// Check if credentials are properly configured
const isConfigured = PROD_CONFIG.url && PROD_CONFIG.anonKey &&
  !PROD_CONFIG.url.includes('your-prod-url') &&
  !PROD_CONFIG.anonKey.includes('your-anon-key')

// Production Supabase client (only create if properly configured)
const prodSupabase = isConfigured ? createClient(PROD_CONFIG.url, PROD_CONFIG.anonKey) : null

// Email templates configuration
const EMAIL_TEMPLATES = {
  call_reward: {
    id: 'call_reward',
    name: 'User Research Email (30min Call + $100 Reward)',
    subject: (petName) => `A gift for ${petName || 'you'} 🎁 + $100 for a 30 min chat?`,
    variables: ['pet_name', 'upload_id', 'user_email']
  }
}

const LOCAL_API_URL = import.meta.env.VITE_LOCAL_API_URL || 'http://localhost:3001'

export default function CustomerEmails() {
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(false)
  const [hasMore, setHasMore] = useState(true)
  const [page, setPage] = useState(0)
  const [isLoadingMore, setIsLoadingMore] = useState(false)
  const [selectedItems, setSelectedItems] = useState(new Set())
  const [selectedTemplate, setSelectedTemplate] = useState('call_reward')
  const [filterUserId, setFilterUserId] = useState('')
  const [filterUploadId, setFilterUploadId] = useState('')
  const [filterPetName, setFilterPetName] = useState('')
  const [filterEmail, setFilterEmail] = useState('')
  const [filterByShop, setFilterByShop] = useState(true)
  const [sending, setSending] = useState(false)
  const [sendStatus, setSendStatus] = useState(null)
  const [previewHTML, setPreviewHTML] = useState('')
  const observer = useRef()

  const ITEMS_PER_PAGE = 30

  // Load items from pets table (only with user_email)
  const loadItems = useCallback(async (pageNum = 0, append = false) => {
    if (!prodSupabase) return

    setLoading(true)
    try {
      // Build query for pets table
      let query = prodSupabase
        .from('pets')
        .select('*')
        .not('user_email', 'is', null)
        .neq('user_email', '')

      // Apply shop filter if enabled
      if (filterByShop) {
        query = query.eq('shop', 'vuse04-um.myshopify.com')
      }

      // Apply user ID filter if provided
      if (filterUserId.trim()) {
        query = query.eq('user_id', filterUserId.trim())
      }

      // Apply upload ID filter if provided
      if (filterUploadId.trim()) {
        const uploadIdValue = String(filterUploadId.trim())
        query = query.eq('upload_id', uploadIdValue)
      }

      // Apply pet name filter if provided
      if (filterPetName.trim()) {
        query = query.ilike('pet_name', `%${filterPetName.trim()}%`)
      }

      // Apply email filter if provided
      if (filterEmail.trim()) {
        query = query.ilike('user_email', `%${filterEmail.trim()}%`)
      }

      // Apply ordering and pagination
      query = query
        .order('created_at', { ascending: false })
        .range(pageNum * ITEMS_PER_PAGE, (pageNum + 1) * ITEMS_PER_PAGE - 1)

      const { data, error } = await query

      if (error) {
        console.error('Supabase query error:', error)
        throw error
      }

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
      console.error('Failed to load pets:', error)
    } finally {
      setLoading(false)
    }
  }, [filterUserId, filterUploadId, filterPetName, filterEmail, filterByShop])

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

  // Reset and reload when filters change
  useEffect(() => {
    setItems([])
    setPage(0)
    setHasMore(true)
    loadItems(0, false)
  }, [filterByShop, loadItems])

  // Cleanup observer on unmount
  useEffect(() => {
    return () => {
      if (observer.current) {
        observer.current.disconnect()
      }
    }
  }, [])

  // Load preview HTML from backend
  useEffect(() => {
    const loadPreview = async () => {
      try {
        const response = await fetch(`${LOCAL_API_URL}/api/email/preview`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            templateId: selectedTemplate,
            sampleData: {
              pet_name: 'Sample Pet',
              upload_id: 'sample-123'
            }
          })
        })

        const result = await response.json()
        if (result.success && result.html) {
          setPreviewHTML(result.html)
        }
      } catch (error) {
        console.error('Failed to load preview:', error)
        setPreviewHTML('')
      }
    }

    if (selectedTemplate) {
      loadPreview()
    }
  }, [selectedTemplate])

  const toggleItemSelection = (itemId) => {
    setSelectedItems(prev => {
      const newSet = new Set(prev)
      if (newSet.has(itemId)) {
        newSet.delete(itemId)
      } else {
        newSet.add(itemId)
      }
      return newSet
    })
  }

  const selectAll = () => {
    setSelectedItems(new Set(items.map(item => item.id)))
  }

  const clearSelection = () => {
    setSelectedItems(new Set())
  }

  const handleSearch = () => {
    setItems([])
    setPage(0)
    setHasMore(true)
    setSelectedItems(new Set())
    loadItems(0, false)
  }

  const clearEmailFilter = () => {
    setFilterEmail('')
    setTimeout(() => handleSearch(), 0)
  }

  const sendEmails = async () => {
    if (selectedItems.size === 0) {
      alert('Please select at least one customer to send emails to.')
      return
    }

    if (!selectedTemplate) {
      alert('Please select an email template.')
      return
    }

    setSending(true)
    setSendStatus(null)

    try {
      const selectedItemsData = items.filter(item => selectedItems.has(item.id))

      const response = await fetch(`${LOCAL_API_URL}/api/email/send`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          recipients: selectedItemsData.map(item => ({
            email: item.user_email,
            pet_name: item.pet_name || 'there',
            upload_id: item.upload_id || '',
            user_id: item.user_id || '',
            subject: typeof EMAIL_TEMPLATES[selectedTemplate].subject === 'function'
              ? EMAIL_TEMPLATES[selectedTemplate].subject(item.pet_name || 'you')
              : EMAIL_TEMPLATES[selectedTemplate].subject
          })),
          templateId: selectedTemplate
        })
      })

      const result = await response.json()

      if (!response.ok) {
        throw new Error(result.error || 'Failed to send emails')
      }

      setSendStatus({
        success: true,
        sent: result.sent || 0,
        failed: result.failed || 0,
        errors: result.errors || []
      })

      // Clear selection after successful send
      setSelectedItems(new Set())
    } catch (error) {
      console.error('Failed to send emails:', error)
      setSendStatus({
        success: false,
        error: error.message
      })
    } finally {
      setSending(false)
    }
  }

  // Show configuration error if credentials are not set up
  if (!isConfigured) {
    return (
      <div className="w-full bg-gray-50 px-6 py-6">
        <h2 className="text-lg font-semibold mb-4">Customer Emails</h2>
        <div className="text-center text-gray-500 mt-8">
          <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-6 max-w-md mx-auto">
            <h3 className="text-lg font-medium text-yellow-800 mb-2">Configuration Required</h3>
            <p className="text-sm text-yellow-700 mb-4">
              Production Supabase credentials are not configured. Please add the following environment variables:
            </p>
            <div className="text-left bg-yellow-100 p-3 rounded text-xs font-mono">
              <div>VITE_PAWPRINT_SUPABASE_URL=your_actual_url</div>
              <div>VITE_PAWPRINT_SUPABASE_ANON_KEY=your_actual_key</div>
            </div>
          </div>
        </div>
      </div>
    )
  }

  const selectedCount = selectedItems.size

  return (
    <div className="flex-1 flex overflow-hidden bg-gray-50">
      {/* Left Panel - Customer List */}
      <div className="w-2/3 border-r border-gray-200 flex flex-col overflow-hidden">
        {/* Sticky Filter Bar */}
        <div className="sticky top-0 z-10 bg-white border-b border-gray-200 px-6 py-4 shadow-sm">
          <div className="flex items-center gap-4 flex-wrap">
            <div className="flex items-center gap-2 flex-1 min-w-[200px]">
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
            <div className="flex items-center gap-2 flex-1 min-w-[200px]">
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
            <div className="flex items-center gap-2 flex-1 min-w-[200px]">
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
            <div className="flex items-center gap-2 flex-1 min-w-[200px]">
              <label className="text-sm font-medium text-gray-700 whitespace-nowrap">Email:</label>
              <input
                type="text"
                value={filterEmail}
                onChange={(e) => setFilterEmail(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    handleSearch()
                  }
                }}
                placeholder="Filter by email"
                className="flex-1 px-3 py-2 text-sm border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
              {filterEmail && (
                <button
                  onClick={clearEmailFilter}
                  className="p-1 text-gray-400 hover:text-gray-600"
                  title="Clear email filter"
                >
                  <X className="h-4 w-4" />
                </button>
              )}
            </div>
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

          {/* Selection Controls */}
          <div className="flex items-center justify-between mt-4">
            <div className="flex items-center gap-2">
              <button
                onClick={selectAll}
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
              <span className="text-sm text-gray-600">
                {selectedCount} selected
              </span>
            </div>
            <h2 className="text-lg font-semibold">
              Customers ({items.length} total)
            </h2>
          </div>
        </div>

        {/* Items Grid */}
        <div className="flex-1 overflow-y-auto px-6 py-4">
          {loading && items.length === 0 ? (
            <div className="text-center py-8">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500 mx-auto"></div>
              <p className="text-sm text-gray-500 mt-2">Loading customers...</p>
            </div>
          ) : items.length === 0 ? (
            <div className="text-center text-gray-500 mt-8">
              <p>No customers found with email addresses</p>
            </div>
          ) : (
            <div className="grid grid-cols-3 gap-4">
              {items.map((item, index) => {
                const isLast = index === items.length - 1
                const isSelected = selectedItems.has(item.id)
                const imageUrl = item.image_url

                return (
                  <div
                    key={item.id}
                    className={`bg-white rounded-lg shadow-sm border-2 overflow-hidden cursor-pointer transition-all ${isSelected
                      ? 'border-blue-500 ring-2 ring-blue-200'
                      : 'border-gray-200 hover:border-gray-300'
                      }`}
                    onClick={() => toggleItemSelection(item.id)}
                    ref={isLast ? lastItemElementRef : null}
                  >
                    {/* Image */}
                    <div className="aspect-square overflow-hidden bg-gray-100 relative">
                      {imageUrl ? (
                        <>
                          <img
                            src={imageUrl}
                            alt={item.pet_name || 'Pet'}
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
                          No image
                        </div>
                      )}
                      {/* Selection Checkmark */}
                      {isSelected && (
                        <div className="absolute top-2 right-2 bg-blue-500 text-white rounded-full p-1.5 shadow-lg">
                          <Check className="h-4 w-4" />
                        </div>
                      )}
                    </div>

                    {/* Item Info */}
                    <div className="p-3 bg-gray-50 space-y-1">
                      <div className="text-xs text-gray-600">
                        <strong>Pet Name:</strong> {item.pet_name || 'N/A'}
                      </div>
                      <div className="text-xs text-gray-600">
                        <strong>Email:</strong> {item.user_email || 'N/A'}
                      </div>
                      <div className="text-xs text-gray-600">
                        <strong>Upload ID:</strong> {item.upload_id || 'N/A'}
                      </div>
                      <div className="text-xs text-gray-600">
                        <strong>User ID:</strong> {item.user_id || 'N/A'}
                      </div>
                      {item.created_at && (
                        <div className="text-xs text-gray-600">
                          <strong>Created:</strong> {(() => {
                            try {
                              const date = new Date(item.created_at)
                              return date.toLocaleString('en-US', {
                                year: 'numeric',
                                month: 'short',
                                day: 'numeric',
                                hour: '2-digit',
                                minute: '2-digit',
                                hour12: true
                              })
                            } catch (e) {
                              return item.created_at
                            }
                          })()}
                        </div>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          )}

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

      {/* Right Panel - Email Template */}
      <div className="w-1/3 bg-white flex flex-col flex-1 overflow-hidden">
        <div className="border-b border-gray-200 px-6 py-4">
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <Mail className="h-5 w-5" />
            Email Template
          </h2>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
          {/* Template Selector */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Select Template
            </label>
            <select
              value={selectedTemplate}
              onChange={(e) => setSelectedTemplate(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              {Object.values(EMAIL_TEMPLATES).map((template) => (
                <option key={template.id} value={template.id}>
                  {template.name}
                </option>
              ))}
            </select>
          </div>

          {/* Template Preview */}
          {selectedTemplate && (
            <div className="border border-gray-200 rounded-lg p-2 md:p-4 bg-gray-50">
              <h3 className="text-sm font-semibold text-gray-700 mb-2">
                Preview: {EMAIL_TEMPLATES[selectedTemplate].name}
              </h3>
              <div className="text-xs text-gray-600 mb-2">
                <strong>Subject:</strong> {typeof EMAIL_TEMPLATES[selectedTemplate].subject === 'function'
                  ? EMAIL_TEMPLATES[selectedTemplate].subject('Sample Pet')
                  : EMAIL_TEMPLATES[selectedTemplate].subject}
              </div>
              <div className="text-xs text-gray-500 mb-3">
                Available variables: {EMAIL_TEMPLATES[selectedTemplate].variables.join(', ')} (Preview shows sample data)
              </div>
              <div className="border border-gray-300 rounded overflow-hidden md:bg-gray-100" style={{ maxHeight: '700px', overflow: 'auto' }}>
                <div className="w-full p-0 md:p-[10px] bg-transparent md:bg-[#f9f9f9] flex justify-center items-start">
                  <div style={{
                    width: '100%',
                    maxWidth: '600px',
                    position: 'relative'
                  }}>
                    <iframe
                      srcDoc={previewHTML}
                      style={{
                        width: '100%',
                        minHeight: '600px',
                        border: 'none',
                        backgroundColor: '#ffffff',
                        display: 'block'
                      }}
                      title="Email Preview"
                      sandbox="allow-same-origin allow-scripts"
                    />
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Send Status */}
          {sendStatus && (
            <div className={`rounded-lg p-4 ${sendStatus.success ? 'bg-green-50 border border-green-200' : 'bg-red-50 border border-red-200'}`}>
              {sendStatus.success ? (
                <>
                  <p className="text-sm font-medium text-green-800 mb-1">
                    Emails sent successfully!
                  </p>
                  <p className="text-xs text-green-700">
                    Sent: {sendStatus.sent} | Failed: {sendStatus.failed}
                  </p>
                  {sendStatus.errors && sendStatus.errors.length > 0 && (
                    <div className="mt-2 text-xs text-red-600">
                      <strong>Errors:</strong>
                      <ul className="list-disc list-inside mt-1">
                        {sendStatus.errors.map((error, idx) => (
                          <li key={idx}>{error}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                </>
              ) : (
                <p className="text-sm text-red-800">
                  Failed to send emails: {sendStatus.error}
                </p>
              )}
            </div>
          )}
        </div>

        {/* Send Button */}
        <div className="border-t border-gray-200 px-6 py-4">
          <button
            onClick={sendEmails}
            disabled={selectedCount === 0 || sending}
            className={`w-full px-4 py-3 rounded-lg font-medium flex items-center justify-center gap-2 ${selectedCount === 0 || sending
              ? 'bg-gray-300 text-gray-500 cursor-not-allowed'
              : 'bg-green-500 text-white hover:bg-green-600'
              }`}
          >
            {sending ? (
              <>
                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                Sending...
              </>
            ) : (
              <>
                <Send className="h-4 w-4" />
                Send to {selectedCount} {selectedCount === 1 ? 'Customer' : 'Customers'}
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  )
}

