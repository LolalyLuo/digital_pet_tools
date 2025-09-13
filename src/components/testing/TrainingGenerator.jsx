import { useState, useEffect } from 'react'
import { Database, Download, Play, Loader2, AlertCircle, CheckCircle, Users, Package } from 'lucide-react'

const TrainingGenerator = () => {
  const [customers, setCustomers] = useState([])
  const [products, setProducts] = useState([])
  const [selectedProduct, setSelectedProduct] = useState('')
  const [loading, setLoading] = useState(false)
  const [scanLoading, setScanLoading] = useState(false)
  const [error, setError] = useState('')
  const [progress, setProgress] = useState({ current: 0, total: 0 })
  const [generationStatus, setGenerationStatus] = useState('idle') // idle, scanning, generating, complete

  useEffect(() => {
    loadProducts()
  }, [])

  const loadProducts = async () => {
    try {
      const response = await fetch('http://localhost:3001/api/prod/products')
      if (response.ok) {
        const data = await response.json()
        setProducts(data.products || [])
      }
    } catch (err) {
      console.error('Failed to load products:', err)
    }
  }

  const scanCustomers = async () => {
    setScanLoading(true)
    setError('')
    setGenerationStatus('scanning')

    try {
      const response = await fetch('http://localhost:3001/api/prod/customers')

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`)
      }

      const data = await response.json()

      if (data.success) {
        setCustomers(data.customers || [])
        setGenerationStatus('idle')
      } else {
        throw new Error(data.error || 'Failed to scan customers')
      }

    } catch (err) {
      setError(`Failed to scan customers: ${err.message}`)
      setGenerationStatus('idle')
      console.error('Customer scan error:', err)
    } finally {
      setScanLoading(false)
    }
  }

  const generateTrainingSamples = async () => {
    if (!selectedProduct) {
      setError('Please select a product type')
      return
    }

    if (customers.length === 0) {
      setError('No customers found. Please scan for customers first.')
      return
    }

    setLoading(true)
    setError('')
    setGenerationStatus('generating')
    setProgress({ current: 0, total: customers.length })

    try {
      console.log(`Starting batch generation for ${customers.length} customers with product: ${selectedProduct}`)

      const response = await fetch('http://localhost:3001/api/training/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          productType: selectedProduct,
          customers: customers
        })
      })

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`)
      }

      const data = await response.json()

      if (data.success) {
        setGenerationStatus('complete')
        console.log('Generation results:', data.summary)
      } else {
        throw new Error(data.error || 'Generation failed')
      }

    } catch (err) {
      setError(`Generation failed: ${err.message}`)
      setGenerationStatus('idle')
      console.error('Generation error:', err)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="max-w-6xl mx-auto p-6 space-y-6 overflow-y-auto max-h-screen">
      {/* Header */}
      <div className="bg-white rounded-lg shadow-md p-6">
        <div className="flex items-center mb-4">
          <Database className="mr-2" size={24} />
          <h2 className="text-2xl font-bold text-gray-800">Training Sample Generator</h2>
        </div>

        <p className="text-gray-600 mb-6">
          Generate training samples by pairing customer uploaded images with AI-generated product images.
        </p>

        {error && (
          <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-md flex items-center">
            <AlertCircle className="text-red-500 mr-2" size={16} />
            <span className="text-red-700">{error}</span>
          </div>
        )}

        {/* Customer Discovery */}
        <div className="bg-gray-50 rounded-lg p-4 mb-6">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center">
              <Users className="mr-2" size={18} />
              <h4 className="font-medium text-gray-800">Customer Discovery</h4>
            </div>
            <button
              onClick={scanCustomers}
              disabled={scanLoading}
              className={`px-4 py-2 rounded-md font-medium transition-colors flex items-center ${
                scanLoading
                  ? 'bg-gray-300 text-gray-500 cursor-not-allowed'
                  : 'bg-blue-600 text-white hover:bg-blue-700'
              }`}
            >
              {scanLoading ? (
                <>
                  <Loader2 className="animate-spin mr-2" size={16} />
                  Scanning...
                </>
              ) : (
                <>
                  <Database className="mr-2" size={16} />
                  Scan Production DB
                </>
              )}
            </button>
          </div>

          {generationStatus === 'scanning' && (
            <div className="text-sm text-blue-600 mb-2">
              Scanning production database for customers with single uploaded images...
            </div>
          )}

          {customers.length > 0 && (
            <div className="flex items-center text-sm text-green-600">
              <CheckCircle className="mr-1" size={14} />
              Found {customers.length} customers with single uploaded images
            </div>
          )}
        </div>

        {/* Product Selection */}
        <div className="bg-gray-50 rounded-lg p-4 mb-6">
          <div className="flex items-center mb-3">
            <Package className="mr-2" size={18} />
            <h4 className="font-medium text-gray-800">Product Selection</h4>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Select Product Type
              </label>
              <select
                value={selectedProduct}
                onChange={(e) => setSelectedProduct(e.target.value)}
                className="w-full p-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              >
                <option value="">Choose a product type...</option>
                {products.map(product => (
                  <option key={product} value={product}>{product}</option>
                ))}
              </select>
            </div>

            <div className="flex items-end">
              <button
                onClick={generateTrainingSamples}
                disabled={loading || !selectedProduct || customers.length === 0}
                className={`w-full py-2 px-4 rounded-md font-medium transition-colors flex items-center justify-center ${
                  loading || !selectedProduct || customers.length === 0
                    ? 'bg-gray-300 text-gray-500 cursor-not-allowed'
                    : 'bg-green-600 text-white hover:bg-green-700'
                }`}
              >
                {loading ? (
                  <>
                    <Loader2 className="animate-spin mr-2" size={16} />
                    Generating...
                  </>
                ) : (
                  <>
                    <Play className="mr-2" size={16} />
                    Generate Training Samples
                  </>
                )}
              </button>
            </div>
          </div>
        </div>

        {/* Progress */}
        {generationStatus === 'generating' && (
          <div className="bg-blue-50 rounded-lg p-4 mb-6">
            <h4 className="font-medium text-gray-800 mb-2">Generation Progress</h4>
            <div className="mb-2">
              <div className="flex justify-between text-sm text-gray-600 mb-1">
                <span>Processing customers...</span>
                <span>{progress.current}/{progress.total}</span>
              </div>
              <div className="w-full bg-gray-200 rounded-full h-2">
                <div
                  className="bg-blue-600 h-2 rounded-full transition-all duration-300"
                  style={{ width: `${progress.total > 0 ? (progress.current / progress.total) * 100 : 0}%` }}
                />
              </div>
            </div>
          </div>
        )}

        {/* Results */}
        {generationStatus === 'complete' && (
          <div className="bg-green-50 rounded-lg p-4">
            <div className="flex items-center text-green-700">
              <CheckCircle className="mr-2" size={20} />
              <h4 className="font-medium">Generation Complete!</h4>
            </div>
            <p className="text-green-600 mt-1">
              Successfully generated {customers.length} training sample pairs for {selectedProduct}.
            </p>
          </div>
        )}
      </div>
    </div>
  )
}

export default TrainingGenerator