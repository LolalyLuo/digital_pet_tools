import { useState, useEffect } from 'react'
import { useDropzone } from 'react-dropzone'
import { Upload, Image, Loader2, AlertCircle, Database } from 'lucide-react'

const GenerationTester = () => {
  const [uploadedImage, setUploadedImage] = useState(null)
  const [prompt, setPrompt] = useState('')
  const [generatedImage, setGeneratedImage] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [trainingSamples, setTrainingSamples] = useState([])
  const [selectedTrainingSample, setSelectedTrainingSample] = useState('')

  useEffect(() => {
    loadTrainingSamples()
  }, [])

  const loadTrainingSamples = async () => {
    try {
      const response = await fetch('http://localhost:3001/api/training/samples')
      if (response.ok) {
        const data = await response.json()
        setTrainingSamples(data.samples || [])
      }
    } catch (err) {
      console.log('No training samples available')
    }
  }

  const loadTrainingSampleImage = async (sampleId) => {
    const sample = trainingSamples.find(s => s.id === parseInt(sampleId))
    if (!sample) return

    try {
      // Fetch the uploaded image from the training sample
      const response = await fetch(sample.uploaded_image_url)
      const blob = await response.blob()
      const file = new File([blob], `training_${sample.customer_id}.jpg`, { type: 'image/jpeg' })

      const reader = new FileReader()
      reader.onload = () => {
        setUploadedImage({
          file,
          preview: reader.result,
          name: `Customer ${sample.customer_id} (${sample.product_type})`
        })
      }
      reader.readAsDataURL(file)
      setError('')
    } catch (err) {
      setError('Failed to load training sample image')
    }
  }

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    accept: {
      'image/*': ['.png', '.jpg', '.jpeg', '.webp']
    },
    multiple: false,
    onDrop: (acceptedFiles) => {
      if (acceptedFiles.length > 0) {
        const file = acceptedFiles[0]
        const reader = new FileReader()
        reader.onload = () => {
          setUploadedImage({
            file,
            preview: reader.result,
            name: file.name
          })
        }
        reader.readAsDataURL(file)
        setError('')
      }
    }
  })

  const handleGenerate = async () => {
    if (!uploadedImage || !prompt.trim()) {
      setError('Please upload an image and enter a prompt')
      return
    }

    setLoading(true)
    setError('')
    setGeneratedImage(null)

    try {
      const formData = new FormData()
      formData.append('images', uploadedImage.file)
      formData.append('prompts', JSON.stringify([prompt]))
      formData.append('selectedModel', 'gemini-img2img')

      const response = await fetch('http://localhost:3001/api/test/generate-images', {
        method: 'POST',
        body: formData
      })

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`)
      }

      const data = await response.json()
      
      if (data.success && data.results && data.results.length > 0) {
        setGeneratedImage(data.results[0])
      } else {
        throw new Error(data.error || 'Generation failed')
      }
    } catch (err) {
      setError(`Generation failed: ${err.message}`)
      console.error('Generation error:', err)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="max-w-4xl mx-auto p-6 space-y-6 overflow-y-auto max-h-screen">
      <div className="bg-white rounded-lg shadow-md p-6">
        <h2 className="text-2xl font-bold text-gray-800 mb-4 flex items-center">
          <Image className="mr-2" size={24} />
          Gemini 2.5 Flash Generation Tester
        </h2>
        
        {error && (
          <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-md flex items-center">
            <AlertCircle className="text-red-500 mr-2" size={16} />
            <span className="text-red-700">{error}</span>
          </div>
        )}

        {/* Training Samples */}
        {trainingSamples.length > 0 && (
          <div className="mb-6 p-4 bg-blue-50 border border-blue-200 rounded-lg">
            <div className="flex items-center mb-3">
              <Database className="mr-2 text-blue-600" size={16} />
              <h4 className="font-medium text-blue-800">Use Training Sample</h4>
            </div>
            <div className="flex items-center gap-2">
              <select
                value={selectedTrainingSample}
                onChange={(e) => {
                  setSelectedTrainingSample(e.target.value)
                  if (e.target.value) {
                    loadTrainingSampleImage(e.target.value)
                  }
                }}
                className="flex-1 p-2 border border-blue-300 rounded-md text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              >
                <option value="">Select a customer image...</option>
                {trainingSamples.map(sample => (
                  <option key={sample.id} value={sample.id}>
                    Customer {sample.customer_id} - {sample.product_type}
                  </option>
                ))}
              </select>
            </div>
            <p className="text-xs text-blue-600 mt-2">
              Use real customer uploaded images from production data
            </p>
          </div>
        )}

        {/* Image Upload */}
        <div className="mb-6">
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Upload Dog Photo
          </label>
          <div
            {...getRootProps()}
            className={`border-2 border-dashed rounded-lg p-6 text-center cursor-pointer transition-colors ${
              isDragActive
                ? 'border-blue-400 bg-blue-50'
                : uploadedImage
                ? 'border-green-400 bg-green-50'
                : 'border-gray-300 hover:border-gray-400'
            }`}
          >
            <input {...getInputProps()} />
            {uploadedImage ? (
              <div className="space-y-2 flex flex-col items-center">
                <img
                  src={uploadedImage.preview}
                  alt="Uploaded"
                  style={{
                    maxHeight: '80px',
                    maxWidth: '120px',
                    objectFit: 'cover'
                  }}
                  className="rounded border"
                />
                <p className="text-xs text-gray-600 max-w-32 truncate">{uploadedImage.name}</p>
              </div>
            ) : (
              <div className="space-y-2">
                <Upload className="mx-auto text-gray-400" size={48} />
                <p className="text-gray-600">
                  {isDragActive ? 'Drop your image here' : 'Drag & drop or click to upload'}
                </p>
              </div>
            )}
          </div>
        </div>

        {/* Prompt Input */}
        <div className="mb-6">
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Generation Prompt
          </label>
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="Enter your prompt for generating a cute dog image..."
            className="w-full p-3 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            rows={3}
          />
        </div>

        {/* Generate Button */}
        <button
          onClick={handleGenerate}
          disabled={loading || !uploadedImage || !prompt.trim()}
          className={`w-full py-3 px-4 rounded-md font-medium transition-colors flex items-center justify-center ${
            loading || !uploadedImage || !prompt.trim()
              ? 'bg-gray-300 text-gray-500 cursor-not-allowed'
              : 'bg-blue-600 text-white hover:bg-blue-700'
          }`}
        >
          {loading ? (
            <>
              <Loader2 className="animate-spin mr-2" size={16} />
              Generating...
            </>
          ) : (
            'Generate with Gemini 2.5 Flash'
          )}
        </button>
      </div>

      {/* Results */}
      {generatedImage && (
        <div className="bg-white rounded-lg shadow-md p-6">
          <h3 className="text-lg font-semibold text-gray-800 mb-4">Generated Result</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Original */}
            <div>
              <h4 className="font-medium text-gray-700 mb-2">Original Image</h4>
              <img
                src={uploadedImage.preview}
                alt="Original"
                style={{ 
                  maxHeight: '200px', 
                  maxWidth: '200px', 
                  objectFit: 'cover' 
                }}
                className="rounded-md border"
              />
            </div>
            
            {/* Generated */}
            <div>
              <h4 className="font-medium text-gray-700 mb-2">Generated Image</h4>
              <img
                src={generatedImage.imageUrl}
                alt="Generated"
                style={{ 
                  maxHeight: '200px', 
                  maxWidth: '200px', 
                  objectFit: 'cover' 
                }}
                className="rounded-md border"
              />
              {generatedImage.prompt && (
                <div className="mt-2 p-2 bg-gray-50 rounded text-sm text-gray-600">
                  <strong>Prompt used:</strong> {generatedImage.prompt}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default GenerationTester