import { useState, useEffect } from 'react'
import { useDropzone } from 'react-dropzone'
import { Upload, ArrowRight, Star, Eye, Zap, Loader2, AlertCircle, RefreshCw, Database } from 'lucide-react'

const PipelineTester = () => {
  const [uploadedImage, setUploadedImage] = useState(null)
  const [referenceImage, setReferenceImage] = useState(null)
  const [prompt, setPrompt] = useState('')
  const [generatedImage, setGeneratedImage] = useState(null)
  const [evaluation, setEvaluation] = useState(null)
  const [loading, setLoading] = useState({
    generate: false,
    evaluate: false
  })
  const [error, setError] = useState('')
  const [step, setStep] = useState(1) // 1: upload, 2: generated, 3: evaluated
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

  const loadTrainingSampleImages = async (sampleId) => {
    const sample = trainingSamples.find(s => s.id === parseInt(sampleId))
    if (!sample) return

    try {
      // Fetch both images from the training sample
      const [uploadedResponse, generatedResponse] = await Promise.all([
        fetch(sample.uploaded_image_url),
        fetch(sample.generated_image_url)
      ])

      const uploadedBlob = await uploadedResponse.blob()
      const generatedBlob = await generatedResponse.blob()

      // Create File objects
      const uploadedFile = new File([uploadedBlob], `customer_${sample.customer_id}.jpg`, { type: 'image/jpeg' })
      const generatedFile = new File([generatedBlob], `generated_${sample.customer_id}.jpg`, { type: 'image/jpeg' })

      // Set uploaded image (original customer image)
      const uploadedReader = new FileReader()
      uploadedReader.onload = () => {
        setUploadedImage({
          file: uploadedFile,
          preview: uploadedReader.result,
          name: `Customer ${sample.customer_id} Original`
        })
      }
      uploadedReader.readAsDataURL(uploadedFile)

      // Set reference image (AI generated image)
      const generatedReader = new FileReader()
      generatedReader.onload = () => {
        setReferenceImage({
          file: generatedFile,
          preview: generatedReader.result,
          name: `Customer ${sample.customer_id} Generated (${sample.product_type})`
        })
      }
      generatedReader.readAsDataURL(generatedFile)

      setError('')
      setStep(1)
      setGeneratedImage(null)
      setEvaluation(null)

    } catch (err) {
      setError('Failed to load training sample images')
    }
  }

  const createDropzone = (onDrop, acceptedImage, label) => {
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
            onDrop({
              file,
              preview: reader.result,
              name: file.name
            })
          }
          reader.readAsDataURL(file)
          setError('')
          setStep(1)
          setGeneratedImage(null)
          setEvaluation(null)
        }
      }
    })

    return { getRootProps, getInputProps, isDragActive }
  }

  const handleGenerate = async () => {
    if (!uploadedImage || !prompt.trim()) {
      setError('Please upload an original image and enter a prompt')
      return
    }

    setLoading(prev => ({ ...prev, generate: true }))
    setError('')
    setGeneratedImage(null)
    setEvaluation(null)

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
        setStep(2)
      } else {
        throw new Error(data.error || 'Generation failed')
      }
    } catch (err) {
      setError(`Generation failed: ${err.message}`)
      console.error('Generation error:', err)
    } finally {
      setLoading(prev => ({ ...prev, generate: false }))
    }
  }

  const handleEvaluate = async () => {
    if (!generatedImage || !uploadedImage) {
      setError('Missing images for evaluation')
      return
    }

    setLoading(prev => ({ ...prev, evaluate: true }))
    setError('')

    try {
      // Call the real GPT-4 Vision evaluation API
      const response = await fetch('http://localhost:3001/api/evaluate-gpt4-vision', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          generatedImageUrl: generatedImage.imageUrl,
          referenceImageUrl: uploadedImage.preview
        })
      })

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`)
      }

      const data = await response.json()
      
      if (data.success && data.evaluation) {
        setEvaluation(data.evaluation)
      } else {
        throw new Error(data.error || 'Evaluation failed')
      }
      setStep(3)

    } catch (err) {
      setError(`Evaluation failed: ${err.message}`)
      console.error('Evaluation error:', err)
    } finally {
      setLoading(prev => ({ ...prev, evaluate: false }))
    }
  }

  const runFullPipeline = async () => {
    if (!uploadedImage || !prompt.trim() || !referenceImage) {
      setError('Please upload both images and enter a prompt')
      return
    }
    
    setLoading(prev => ({ ...prev, generate: true }))
    setError('')
    setGeneratedImage(null)
    setEvaluation(null)

    try {
      // Step 1: Generate image
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
        const generatedResult = data.results[0]
        setGeneratedImage(generatedResult)
        setStep(2)
        setLoading(prev => ({ ...prev, generate: false, evaluate: true }))

        // Step 2: Evaluate immediately after generation
        try {
          const evalResponse = await fetch('http://localhost:3001/api/evaluate-gpt4-vision', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              generatedImageUrl: generatedResult.imageUrl,
              referenceImageUrl: referenceImage.preview
            })
          })

          if (!evalResponse.ok) {
            throw new Error(`HTTP error! status: ${evalResponse.status}`)
          }

          const evalData = await evalResponse.json()
          
          if (evalData.success && evalData.evaluation) {
            setEvaluation(evalData.evaluation)
            setStep(3)
          } else {
            throw new Error(evalData.error || 'Evaluation failed')
          }
        } catch (evalErr) {
          setError(`Evaluation failed: ${evalErr.message}`)
          console.error('Evaluation error:', evalErr)
        }
      } else {
        throw new Error(data.error || 'Generation failed')
      }
    } catch (err) {
      setError(`Pipeline failed: ${err.message}`)
      console.error('Pipeline error:', err)
    } finally {
      setLoading({ generate: false, evaluate: false })
    }
  }

  const reset = () => {
    setUploadedImage(null)
    setPrompt('')
    setGeneratedImage(null)
    setEvaluation(null)
    setError('')
    setStep(1)
    setLoading({ generate: false, evaluate: false })
  }

  const StepIndicator = ({ stepNumber, title, active, completed }) => (
    <div className={`flex items-center space-x-2 ${active ? 'text-blue-600' : completed ? 'text-green-600' : 'text-gray-400'}`}>
      <div className={`w-8 h-8 rounded-full flex items-center justify-center border-2 ${
        active ? 'border-blue-600 bg-blue-50' : 
        completed ? 'border-green-600 bg-green-50' : 
        'border-gray-300'
      }`}>
        <span className="text-sm font-semibold">{stepNumber}</span>
      </div>
      <span className="text-sm font-medium">{title}</span>
    </div>
  )

  const ScoreBar = ({ label, score, icon: Icon, color }) => (
    <div className="flex items-center space-x-3">
      <Icon size={16} className={`text-${color}-600`} />
      <span className="text-sm font-medium text-gray-700 w-20">{label}</span>
      <div className="flex-1 bg-gray-200 rounded-full h-2">
        <div 
          className={`bg-${color}-600 h-2 rounded-full transition-all duration-1000`}
          style={{ width: `${score * 10}%` }}
        />
      </div>
      <span className="text-sm font-semibold text-gray-800 w-8">{score}/10</span>
    </div>
  )

  return (
    <div className="max-w-6xl mx-auto p-6 space-y-6 overflow-y-auto max-h-screen">
      {/* Header */}
      <div className="bg-white rounded-lg shadow-md p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-2xl font-bold text-gray-800 flex items-center">
            <RefreshCw className="mr-2" size={24} />
            End-to-End Pipeline Tester
          </h2>
          <button
            onClick={reset}
            className="px-4 py-2 text-sm bg-gray-500 text-white rounded-md hover:bg-gray-600 transition-colors"
          >
            Reset
          </button>
        </div>

        {/* Step Indicators */}
        <div className="flex items-center justify-center space-x-8 mb-6">
          <StepIndicator stepNumber="1" title="Upload & Prompt" active={step === 1} completed={step > 1} />
          <ArrowRight className="text-gray-400" size={16} />
          <StepIndicator stepNumber="2" title="Generate" active={step === 2} completed={step > 2} />
          <ArrowRight className="text-gray-400" size={16} />
          <StepIndicator stepNumber="3" title="Evaluate" active={step === 3} completed={false} />
        </div>

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
              <h4 className="font-medium text-blue-800">Use Training Sample Pair</h4>
            </div>
            <div className="flex items-center gap-2">
              <select
                value={selectedTrainingSample}
                onChange={(e) => {
                  setSelectedTrainingSample(e.target.value)
                  if (e.target.value) {
                    loadTrainingSampleImages(e.target.value)
                  }
                }}
                className="flex-1 p-2 border border-blue-300 rounded-md text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              >
                <option value="">Select a customer's image pair...</option>
                {trainingSamples.map(sample => (
                  <option key={sample.id} value={sample.id}>
                    Customer {sample.customer_id} - {sample.product_type}
                  </option>
                ))}
              </select>
            </div>
            <p className="text-xs text-blue-600 mt-2">
              Load real customer data: original photo + AI generated reference for comparison
            </p>
          </div>
        )}

        {/* Input Section */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {/* Original Dog Photo Upload */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Original Dog Photo
            </label>
            {(() => {
              const { getRootProps, getInputProps, isDragActive } = createDropzone(setUploadedImage, uploadedImage, 'Original')
              return (
                <div
                  {...getRootProps()}
                  className={`border-2 border-dashed rounded-lg p-3 text-center cursor-pointer transition-colors h-32 ${
                    isDragActive
                      ? 'border-blue-400 bg-blue-50'
                      : uploadedImage
                      ? 'border-green-400 bg-green-50'
                      : 'border-gray-300 hover:border-gray-400'
                  }`}
                >
                  <input {...getInputProps()} />
                  {uploadedImage ? (
                    <div className="space-y-1 flex flex-col items-center">
                      <img
                        src={uploadedImage.preview}
                        alt="Original"
                        style={{ 
                          maxHeight: '70px', 
                          maxWidth: '100px', 
                          objectFit: 'cover' 
                        }}
                        className="rounded border"
                      />
                      <p className="text-xs text-gray-600 max-w-24 truncate">{uploadedImage.name}</p>
                    </div>
                  ) : (
                    <div className="space-y-1">
                      <Upload className="mx-auto text-gray-400" size={32} />
                      <p className="text-xs text-gray-600">Real dog photo</p>
                    </div>
                  )}
                </div>
              )
            })()}
          </div>

          {/* Reference AI Image Upload */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Reference AI Image
            </label>
            {(() => {
              const { getRootProps, getInputProps, isDragActive } = createDropzone(setReferenceImage, referenceImage, 'Reference')
              return (
                <div
                  {...getRootProps()}
                  className={`border-2 border-dashed rounded-lg p-3 text-center cursor-pointer transition-colors h-32 ${
                    isDragActive
                      ? 'border-purple-400 bg-purple-50'
                      : referenceImage
                      ? 'border-green-400 bg-green-50'
                      : 'border-gray-300 hover:border-gray-400'
                  }`}
                >
                  <input {...getInputProps()} />
                  {referenceImage ? (
                    <div className="space-y-1 flex flex-col items-center">
                      <img
                        src={referenceImage.preview}
                        alt="Reference"
                        style={{ 
                          maxHeight: '70px', 
                          maxWidth: '100px', 
                          objectFit: 'cover' 
                        }}
                        className="rounded border"
                      />
                      <p className="text-xs text-gray-600 max-w-24 truncate">{referenceImage.name}</p>
                    </div>
                  ) : (
                    <div className="space-y-1">
                      <Upload className="mx-auto text-gray-400" size={32} />
                      <p className="text-xs text-gray-600">OpenAI example</p>
                    </div>
                  )}
                </div>
              )
            })()}
          </div>

          {/* Prompt Input */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Generation Prompt
            </label>
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="Enter your prompt..."
              className="w-full p-3 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-transparent h-32 text-sm"
            />
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex space-x-4 mt-6">
          <button
            onClick={handleGenerate}
            disabled={loading.generate || !uploadedImage || !prompt.trim()}
            className={`flex-1 py-3 px-4 rounded-md font-medium transition-colors flex items-center justify-center ${
              loading.generate || !uploadedImage || !prompt.trim()
                ? 'bg-gray-300 text-gray-500 cursor-not-allowed'
                : 'bg-blue-600 text-white hover:bg-blue-700'
            }`}
          >
            {loading.generate ? (
              <>
                <Loader2 className="animate-spin mr-2" size={16} />
                Generating...
              </>
            ) : (
              'Generate Only'
            )}
          </button>

          <button
            onClick={runFullPipeline}
            disabled={loading.generate || loading.evaluate || !uploadedImage || !prompt.trim()}
            className={`flex-1 py-3 px-4 rounded-md font-medium transition-colors flex items-center justify-center ${
              loading.generate || loading.evaluate || !uploadedImage || !prompt.trim()
                ? 'bg-gray-300 text-gray-500 cursor-not-allowed'
                : 'bg-green-600 text-white hover:bg-green-700'
            }`}
          >
            {loading.generate || loading.evaluate ? (
              <>
                <Loader2 className="animate-spin mr-2" size={16} />
                Running Pipeline...
              </>
            ) : (
              'Run Full Pipeline'
            )}
          </button>

          {generatedImage && !loading.generate && (
            <button
              onClick={handleEvaluate}
              disabled={loading.evaluate}
              className={`flex-1 py-3 px-4 rounded-md font-medium transition-colors flex items-center justify-center ${
                loading.evaluate
                  ? 'bg-gray-300 text-gray-500 cursor-not-allowed'
                  : 'bg-purple-600 text-white hover:bg-purple-700'
              }`}
            >
              {loading.evaluate ? (
                <>
                  <Loader2 className="animate-spin mr-2" size={16} />
                  Evaluating...
                </>
              ) : (
                'Evaluate Only'
              )}
            </button>
          )}
        </div>
      </div>

      {/* Results Section */}
      {(generatedImage || evaluation) && (
        <div className="bg-white rounded-lg shadow-md p-6">
          <h3 className="text-lg font-semibold text-gray-800 mb-6">Pipeline Results</h3>
          
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Original Image */}
            <div>
              <h4 className="font-medium text-gray-700 mb-2">Original Image</h4>
              <img
                src={uploadedImage?.preview}
                alt="Original"
                style={{ 
                  maxHeight: '200px', 
                  maxWidth: '200px', 
                  objectFit: 'cover' 
                }}
                className="rounded-md border"
              />
            </div>

            {/* Generated Image */}
            {generatedImage && (
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
                  <div className="mt-2 p-2 bg-gray-50 rounded text-xs text-gray-600">
                    <strong>Prompt:</strong> {generatedImage.prompt}
                  </div>
                )}
              </div>
            )}

            {/* Evaluation Results */}
            {evaluation && (
              <div>
                <h4 className="font-medium text-gray-700 mb-4">Evaluation Scores</h4>
                <div className="space-y-3">
                  <ScoreBar label="Cuteness" score={evaluation.cuteness} icon={Star} color="pink" />
                  <ScoreBar label="Similarity" score={evaluation.similarity} icon={Eye} color="blue" />
                  <ScoreBar label="Quality" score={evaluation.quality} icon={Zap} color="green" />
                </div>
                
                <div className="mt-4 bg-gradient-to-r from-purple-50 to-blue-50 rounded-lg p-3">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-semibold text-gray-800">Overall Score</span>
                    <span className="text-xl font-bold text-purple-600">
                      {evaluation.weightedScore}/10
                    </span>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* GPT-4 Analysis */}
          {evaluation && (
            <div className="mt-6 bg-gray-50 rounded-lg p-4">
              <h4 className="font-semibold text-gray-800 mb-2">GPT-4 Vision Analysis</h4>
              <p className="text-gray-700 text-sm leading-relaxed">{evaluation.reasoning}</p>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export default PipelineTester