import { useState, useEffect } from 'react'
import { useDropzone } from 'react-dropzone'
import { Upload, Eye, Loader2, AlertCircle, Plus, X, Play, Save, Trophy, BarChart3, Settings, Database } from 'lucide-react'

const EvaluationTester = () => {
  const [generatedImage, setGeneratedImage] = useState(null)
  const [referenceImage, setReferenceImage] = useState(null)
  const [samplePairs, setSamplePairs] = useState([])
  const [evaluation, setEvaluation] = useState(null)
  const [batchResults, setBatchResults] = useState([])
  const [loading, setLoading] = useState(false)
  const [batchLoading, setBatchLoading] = useState(false)
  const [error, setError] = useState('')
  const [customPrompt, setCustomPrompt] = useState('')
  const [savedPrompts, setSavedPrompts] = useState([])
  const [promptName, setPromptName] = useState('')
  const [mode, setMode] = useState('single') // 'single' or 'batch'
  const [weights, setWeights] = useState({
    visualAppeal: 0.4,
    styleSimilarity: 0.3,
    technicalQuality: 0.3
  })
  const [trainingSamples, setTrainingSamples] = useState([])
  const [loadingTraining, setLoadingTraining] = useState(false)
  const [generationPrompt, setGenerationPrompt] = useState('Transform this dog into a cute, adorable style')

  // Default evaluation prompt
  const defaultPrompt = `Evaluate this AI-generated dog image compared to the reference image.

Analyze these specific criteria and give each a score from 0.0 to 10.0:
1. Visual Appeal & Cuteness - How appealing and cute is the generated image?
2. Style Similarity - How well does it match the reference image's style and composition?
3. Technical Quality - Assess sharpness, lighting, and overall technical execution

Return ONLY a JSON object with this exact format:
{
  "visualAppeal": 7.5,
  "styleSimilarity": 6.0,
  "technicalQuality": 8.2,
  "reasoning": "Brief explanation of your scoring rationale"
}`

  useEffect(() => {
    if (!customPrompt) {
      setCustomPrompt(defaultPrompt)
    }
    loadSavedPrompts()
    loadCurrentSamples()
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

  const loadSavedPrompts = async () => {
    try {
      const response = await fetch('http://localhost:3001/api/evaluation-prompts')
      if (response.ok) {
        const data = await response.json()
        setSavedPrompts(data.prompts || [])
      }
    } catch (err) {
      console.log('No saved prompts available')
    }
  }

  const savePrompt = async () => {
    if (!promptName.trim() || !customPrompt.trim()) {
      setError('Please enter a prompt name and content')
      return
    }

    try {
      const response = await fetch('http://localhost:3001/api/evaluation-prompts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: promptName,
          content: customPrompt
        })
      })

      if (response.ok) {
        setPromptName('')
        loadSavedPrompts()
        setError('')
      }
    } catch (err) {
      setError('Failed to save prompt')
    }
  }

  const loadPrompt = (prompt) => {
    setCustomPrompt(prompt.content)
    setError('')
  }


  const loadCurrentSamples = async () => {
    try {
      const response = await fetch('http://localhost:3001/api/current-samples')
      if (response.ok) {
        const data = await response.json()
        setSamplePairs(data.samples || [])
      }
    } catch (err) {
      console.log('No current samples available')
    }
  }



  const resetSampleSet = async () => {
    try {
      const response = await fetch('http://localhost:3001/api/current-samples', {
        method: 'DELETE'
      })

      if (response.ok) {
        setSamplePairs([])
        setError('')
      }
    } catch (err) {
      setError('Failed to reset sample set')
    }
  }

  const loadTrainingSamplesAsEvaluation = async () => {
    if (trainingSamples.length === 0) {
      setError('No training samples available')
      return
    }

    if (!customPrompt.trim()) {
      setError('Please enter an evaluation prompt first')
      return
    }

    setLoadingTraining(true)
    setError('')

    try {
      // Clear current samples first
      await fetch('http://localhost:3001/api/current-samples', { method: 'DELETE' })

      console.log(`🎯 Processing ${trainingSamples.length} training samples with fully parallel pipeline...`)

      // Phase 1: Download all training sample images in parallel
      console.log(`📥 Phase 1: Downloading all ${trainingSamples.length} training sample images...`)
      const downloadPromises = trainingSamples.map(async (sample, index) => {
        try {
          console.log(`📸 Downloading images for sample ${index + 1}/${trainingSamples.length}: Customer ${sample.customer_id}`)

          const [uploadedResponse, referenceResponse] = await Promise.all([
            fetch(sample.uploaded_image_url),
            fetch(sample.generated_image_url)
          ])

          const [uploadedBlob, referenceBlob] = await Promise.all([
            uploadedResponse.blob(),
            referenceResponse.blob()
          ])

          const uploadedFile = new File([uploadedBlob], `uploaded_${sample.customer_id}.jpg`, { type: 'image/jpeg' })
          const referenceFile = new File([referenceBlob], `reference_${sample.customer_id}.jpg`, { type: 'image/jpeg' })

          return {
            sample,
            uploadedFile,
            referenceFile,
            success: true
          }
        } catch (error) {
          console.error(`Error downloading images for sample ${sample.id}:`, error.message)
          return {
            sample,
            error: error.message,
            success: false
          }
        }
      })

      const downloadResults = await Promise.allSettled(downloadPromises)
      const downloadedSamples = downloadResults
        .map(result => result.status === 'fulfilled' ? result.value : null)
        .filter(sample => sample?.success)

      console.log(`📥 Phase 1 complete: ${downloadedSamples.length}/${trainingSamples.length} samples downloaded successfully`)

      if (downloadedSamples.length === 0) {
        throw new Error('No samples could be downloaded')
      }

      // Phase 2: Generate all new images with Gemini in parallel
      console.log(`🎨 Phase 2: Generating ${downloadedSamples.length} new images with Gemini in parallel...`)
      const generationPromises = downloadedSamples.map(async (sampleData, index) => {
        try {
          console.log(`🎨 Generating image ${index + 1}/${downloadedSamples.length}: Customer ${sampleData.sample.customer_id}`)

          const generateFormData = new FormData()
          generateFormData.append('images', sampleData.uploadedFile)
          generateFormData.append('prompts', JSON.stringify([generationPrompt]))
          generateFormData.append('selectedModel', 'gemini-img2img')

          const generateResponse = await fetch('http://localhost:3001/api/test/generate-images', {
            method: 'POST',
            body: generateFormData
          })

          if (!generateResponse.ok) {
            throw new Error(`Failed to generate image for sample ${sampleData.sample.id}`)
          }

          const generateData = await generateResponse.json()

          if (!generateData.success || !generateData.results || generateData.results.length === 0) {
            throw new Error(`No generated image returned for sample ${sampleData.sample.id}`)
          }

          const generatedImageUrl = generateData.results[0].imageUrl

          // Download the newly generated image
          const newGeneratedResponse = await fetch(generatedImageUrl)
          const newGeneratedBlob = await newGeneratedResponse.blob()
          const newGeneratedFile = new File([newGeneratedBlob], `generated_${sampleData.sample.customer_id}.jpg`, { type: 'image/jpeg' })

          return {
            ...sampleData,
            newGeneratedFile,
            success: true
          }
        } catch (error) {
          console.error(`Error generating image for sample ${sampleData.sample.id}:`, error.message)
          return {
            ...sampleData,
            error: error.message,
            success: false
          }
        }
      })

      const generationResults = await Promise.allSettled(generationPromises)
      const generatedSamples = generationResults
        .map(result => result.status === 'fulfilled' ? result.value : null)
        .filter(sample => sample?.success)

      console.log(`🎨 Phase 2 complete: ${generatedSamples.length}/${downloadedSamples.length} images generated successfully`)

      if (generatedSamples.length === 0) {
        throw new Error('No images could be generated')
      }

      // Phase 3: Upload all sample pairs in parallel
      console.log(`📤 Phase 3: Uploading ${generatedSamples.length} evaluation pairs in parallel...`)
      const uploadPromises = generatedSamples.map(async (sampleData, index) => {
        try {
          console.log(`📤 Uploading pair ${index + 1}/${generatedSamples.length}: Customer ${sampleData.sample.customer_id}`)

          const uploadFormData = new FormData()
          uploadFormData.append('generated', sampleData.newGeneratedFile)  // Newly generated image
          uploadFormData.append('reference', sampleData.referenceFile)     // OpenAI generated image (reference)

          const uploadResponse = await fetch('http://localhost:3001/api/upload-sample-images', {
            method: 'POST',
            body: uploadFormData
          })

          if (!uploadResponse.ok) {
            throw new Error(`Failed to upload evaluation pair for sample ${sampleData.sample.id}`)
          }

          console.log(`✅ Successfully uploaded evaluation pair for customer ${sampleData.sample.customer_id}`)
          return true
        } catch (error) {
          console.error(`Error uploading sample ${sampleData.sample.id}:`, error.message)
          return false
        }
      })

      const uploadResults = await Promise.allSettled(uploadPromises)
      const successful = uploadResults.filter(result => result.status === 'fulfilled' && result.value === true).length
      const failed = uploadResults.length - successful

      console.log(`🎯 Fully parallel pipeline complete: ${successful} successful, ${failed} failed`)

      // Reload the current samples
      loadCurrentSamples()
      setError('')

    } catch (err) {
      setError(`Failed to load training samples: ${err.message}`)
      console.error('Training samples load error:', err)
    } finally {
      setLoadingTraining(false)
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
        }
      }
    })

    return (
      <div className="mb-4">
        <label className="block text-sm font-medium text-gray-700 mb-2">
          {label}
        </label>
        <div
          {...getRootProps()}
          className={`border-2 border-dashed rounded-lg p-4 text-center cursor-pointer transition-colors ${
            isDragActive
              ? 'border-blue-400 bg-blue-50'
              : acceptedImage
              ? 'border-green-400 bg-green-50'
              : 'border-gray-300 hover:border-gray-400'
          }`}
        >
          <input {...getInputProps()} />
          {acceptedImage ? (
            <div className="space-y-2 flex flex-col items-center">
              <img
                src={acceptedImage.preview}
                alt="Uploaded"
                style={{
                  maxHeight: '60px',
                  maxWidth: '80px',
                  objectFit: 'cover'
                }}
                className="rounded border"
              />
              <p className="text-xs text-gray-600 max-w-20 truncate">{acceptedImage.name}</p>
            </div>
          ) : (
            <div className="space-y-1">
              <Upload className="mx-auto text-gray-400" size={32} />
              <p className="text-sm text-gray-600">
                {isDragActive ? 'Drop image here' : 'Upload image'}
              </p>
            </div>
          )}
        </div>
      </div>
    )
  }

  const addToSampleSet = async () => {
    if (!generatedImage || !referenceImage) {
      setError('Please upload both images before adding to sample set')
      return
    }

    try {
      // Upload images using FormData
      const formData = new FormData()
      formData.append('generated', generatedImage.file)
      formData.append('reference', referenceImage.file)

      const response = await fetch('http://localhost:3001/api/upload-sample-images', {
        method: 'POST',
        body: formData
      })

      if (response.ok) {
        const data = await response.json()

        // Add to local state for immediate UI update
        const newPair = {
          id: Date.now(),
          generated: {
            ...generatedImage,
            preview: generatedImage.preview,
            url: data.generatedUrl
          },
          reference: {
            ...referenceImage,
            preview: referenceImage.preview,
            url: data.referenceUrl
          }
        }
        setSamplePairs(prev => [...prev, newPair])
        setGeneratedImage(null)
        setReferenceImage(null)
        setError('')
      } else {
        setError('Failed to upload and save sample images')
      }
    } catch (err) {
      setError('Failed to upload and save sample images')
    }
  }

  const removeSamplePair = (id) => {
    setSamplePairs(prev => prev.filter(pair => pair.id !== id))
  }

  const handleSingleEvaluation = async () => {
    if (!generatedImage || !referenceImage) {
      setError('Please upload both images')
      return
    }

    setLoading(true)
    setError('')
    setEvaluation(null)

    try {
      const response = await fetch('http://localhost:3001/api/evaluate-gpt4-vision', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          generatedImageUrl: generatedImage.url,
          referenceImageUrl: referenceImage.url,
          customPrompt: customPrompt
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

    } catch (err) {
      setError(`Evaluation failed: ${err.message}`)
      console.error('Evaluation error:', err)
    } finally {
      setLoading(false)
    }
  }

  const calculateWeightedScore = (result) => {
    if (result.score !== undefined) {
      return result.score
    } else {
      return (
        (result.visualAppeal * weights.visualAppeal) +
        (result.styleSimilarity * weights.styleSimilarity) +
        (result.technicalQuality * weights.technicalQuality)
      )
    }
  }

  const handleBatchEvaluation = async () => {
    if (samplePairs.length === 0) {
      setError('Please add sample pairs to evaluate')
      return
    }

    setBatchLoading(true)
    setError('')
    setBatchResults([])

    try {
      console.log(`🎯 Processing ${samplePairs.length} evaluation samples in parallel...`)

      // Process all evaluations in parallel
      const evaluateIndividualSample = async (pair, index) => {
        console.log(`🔍 Evaluating sample ${index + 1}/${samplePairs.length}: ID ${pair.id}`)

        try {
          const response = await fetch('http://localhost:3001/api/evaluate-gpt4-vision', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              generatedImageUrl: pair.generated.url,
              referenceImageUrl: pair.reference.url,
              customPrompt: customPrompt
            })
          })

          if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`)
          }

          const data = await response.json()

          if (data.success && data.evaluation) {
            return {
              sampleId: pair.id,
              samplePair: pair,
              ...data.evaluation
            }
          } else {
            throw new Error(data.error || 'Evaluation failed')
          }

        } catch (sampleError) {
          console.error(`Error evaluating sample ${pair.id}:`, sampleError.message)
          return {
            sampleId: pair.id,
            samplePair: pair,
            error: sampleError.message,
            visualAppeal: 0,
            styleSimilarity: 0,
            technicalQuality: 0,
            reasoning: `Evaluation failed: ${sampleError.message}`
          }
        }
      }

      // Process all samples in parallel
      const results = await Promise.allSettled(
        samplePairs.map((pair, index) => evaluateIndividualSample(pair, index))
      )

      // Extract successful results and handle failures
      const processedResults = results.map((result, index) => {
        if (result.status === 'fulfilled') {
          return result.value
        } else {
          console.error(`Failed to evaluate sample ${samplePairs[index].id}:`, result.reason)
          return {
            sampleId: samplePairs[index].id,
            samplePair: samplePairs[index],
            error: result.reason?.message || 'Unknown error',
            visualAppeal: 0,
            styleSimilarity: 0,
            technicalQuality: 0,
            reasoning: `Evaluation failed: ${result.reason?.message || 'Unknown error'}`
          }
        }
      })

      const successful = processedResults.filter(result => !result.error).length
      const failed = processedResults.length - successful

      console.log(`🎯 Parallel evaluation complete: ${successful} successful, ${failed} failed`)

      // Calculate weighted scores and sort results (highest first)
      const sortedResults = processedResults
        .map(result => ({
          ...result,
          calculatedScore: parseFloat(calculateWeightedScore(result).toFixed(2))
        }))
        .sort((a, b) => b.calculatedScore - a.calculatedScore)

      console.log('Batch results:', sortedResults)
      setBatchResults(sortedResults)

    } catch (err) {
      setError(`Batch evaluation failed: ${err.message}`)
      console.error('Batch evaluation error:', err)
    } finally {
      setBatchLoading(false)
    }
  }

  // Update results when weights change
  useEffect(() => {
    if (batchResults.length > 0) {
      const updatedResults = batchResults
        .map(result => ({
          ...result,
          calculatedScore: parseFloat(calculateWeightedScore(result).toFixed(2))
        }))
        .sort((a, b) => b.calculatedScore - a.calculatedScore)

      setBatchResults(updatedResults)
    }
  }, [weights])

  return (
    <div className="max-w-6xl mx-auto p-6 space-y-6 overflow-y-auto max-h-screen">
      {/* Header */}
      <div className="bg-white rounded-lg shadow-md p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-2xl font-bold text-gray-800 flex items-center">
            <Eye className="mr-2" size={24} />
            Enhanced Evaluation Tester
          </h2>

          {/* Mode Toggle */}
          <div className="flex rounded-lg border border-gray-300">
            <button
              onClick={() => setMode('single')}
              className={`px-4 py-2 text-sm font-medium rounded-l-lg transition-colors ${
                mode === 'single'
                  ? 'bg-blue-600 text-white'
                  : 'bg-white text-gray-700 hover:bg-gray-50'
              }`}
            >
              Single Test
            </button>
            <button
              onClick={() => setMode('batch')}
              className={`px-4 py-2 text-sm font-medium rounded-r-lg transition-colors ${
                mode === 'batch'
                  ? 'bg-blue-600 text-white'
                  : 'bg-white text-gray-700 hover:bg-gray-50'
              }`}
            >
              Batch Test ({samplePairs.length} samples)
            </button>
          </div>
        </div>

        {error && (
          <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-md flex items-center">
            <AlertCircle className="text-red-500 mr-2" size={16} />
            <span className="text-red-700">{error}</span>
          </div>
        )}

        {/* Scoring Formula */}
        <div className="mb-6 bg-gray-50 rounded-lg p-4">
          <div className="flex items-center mb-3">
            <Settings className="mr-2" size={18} />
            <h4 className="font-medium text-gray-800">Scoring Formula</h4>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Visual Appeal & Cuteness ({weights.visualAppeal.toFixed(2)})
              </label>
              <input
                type="range"
                min="0"
                max="2"
                step="0.01"
                value={weights.visualAppeal}
                onChange={(e) => {
                  setWeights({
                    ...weights,
                    visualAppeal: parseFloat(e.target.value)
                  })
                }}
                className="w-full"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Style Similarity ({weights.styleSimilarity.toFixed(2)})
              </label>
              <input
                type="range"
                min="0"
                max="2"
                step="0.01"
                value={weights.styleSimilarity}
                onChange={(e) => {
                  setWeights({
                    ...weights,
                    styleSimilarity: parseFloat(e.target.value)
                  })
                }}
                className="w-full"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Technical Quality ({weights.technicalQuality.toFixed(2)})
              </label>
              <input
                type="range"
                min="0"
                max="2"
                step="0.01"
                value={weights.technicalQuality}
                onChange={(e) => {
                  setWeights({
                    ...weights,
                    technicalQuality: parseFloat(e.target.value)
                  })
                }}
                className="w-full"
              />
            </div>
          </div>
        </div>

        {/* Custom Prompt Section */}
        <div className="mb-6">
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Evaluation Prompt
          </label>
          <textarea
            value={customPrompt}
            onChange={(e) => setCustomPrompt(e.target.value)}
            className="w-full p-3 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm"
            rows={6}
            placeholder="Enter custom evaluation prompt..."
          />

          {/* Prompt Controls */}
          <div className="flex items-center gap-2 mt-2">
            <input
              type="text"
              value={promptName}
              onChange={(e) => setPromptName(e.target.value)}
              placeholder="Prompt name..."
              className="px-3 py-1 border border-gray-300 rounded text-sm"
            />
            <button
              onClick={savePrompt}
              className="px-3 py-1 bg-green-600 text-white rounded text-sm hover:bg-green-700 flex items-center"
            >
              <Save size={14} className="mr-1" />
              Save
            </button>

            {savedPrompts.length > 0 && (
              <select
                onChange={(e) => {
                  const prompt = savedPrompts.find(p => p.id === e.target.value)
                  if (prompt) loadPrompt(prompt)
                }}
                className="px-3 py-1 border border-gray-300 rounded text-sm"
              >
                <option value="">Load saved prompt...</option>
                {savedPrompts.map(prompt => (
                  <option key={prompt.id} value={prompt.id}>{prompt.name}</option>
                ))}
              </select>
            )}
          </div>
        </div>

        {mode === 'single' ? (
          // Single Evaluation Mode
          <>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
              {createDropzone(setGeneratedImage, generatedImage, "Generated Image")}
              {createDropzone(setReferenceImage, referenceImage, "Reference Image")}
            </div>

            <div className="flex gap-4">
              <button
                onClick={handleSingleEvaluation}
                disabled={loading || !generatedImage || !referenceImage}
                className={`flex-1 py-3 px-4 rounded-md font-medium transition-colors flex items-center justify-center ${
                  loading || !generatedImage || !referenceImage
                    ? 'bg-gray-300 text-gray-500 cursor-not-allowed'
                    : 'bg-purple-600 text-white hover:bg-purple-700'
                }`}
              >
                {loading ? (
                  <>
                    <Loader2 className="animate-spin mr-2" size={16} />
                    Evaluating...
                  </>
                ) : (
                  <>
                    <Play className="mr-2" size={16} />
                    Evaluate Single Pair
                  </>
                )}
              </button>

              <button
                onClick={addToSampleSet}
                disabled={!generatedImage || !referenceImage}
                className={`px-4 py-3 rounded-md font-medium transition-colors flex items-center ${
                  !generatedImage || !referenceImage
                    ? 'bg-gray-300 text-gray-500 cursor-not-allowed'
                    : 'bg-blue-600 text-white hover:bg-blue-700'
                }`}
              >
                <Plus className="mr-2" size={16} />
                Add to Sample Set
              </button>
            </div>
          </>
        ) : (
          // Batch Evaluation Mode
          <>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
              {createDropzone(setGeneratedImage, generatedImage, "Generated Image")}
              {createDropzone(setReferenceImage, referenceImage, "Reference Image")}
            </div>

            <div className="flex gap-4 mb-6">
              <button
                onClick={addToSampleSet}
                disabled={!generatedImage || !referenceImage}
                className={`px-4 py-3 rounded-md font-medium transition-colors flex items-center ${
                  !generatedImage || !referenceImage
                    ? 'bg-gray-300 text-gray-500 cursor-not-allowed'
                    : 'bg-blue-600 text-white hover:bg-blue-700'
                }`}
              >
                <Plus className="mr-2" size={16} />
                Add to Sample Set
              </button>

              <button
                onClick={handleBatchEvaluation}
                disabled={batchLoading || samplePairs.length === 0}
                className={`flex-1 py-3 px-4 rounded-md font-medium transition-colors flex items-center justify-center ${
                  batchLoading || samplePairs.length === 0
                    ? 'bg-gray-300 text-gray-500 cursor-not-allowed'
                    : 'bg-green-600 text-white hover:bg-green-700'
                }`}
              >
                {batchLoading ? (
                  <>
                    <Loader2 className="animate-spin mr-2" size={16} />
                    Evaluating {samplePairs.length} samples...
                  </>
                ) : (
                  <>
                    <BarChart3 className="mr-2" size={16} />
                    Evaluate All Samples ({samplePairs.length})
                  </>
                )}
              </button>
            </div>

            {/* Sample Set Management */}
            <div className="border border-gray-200 rounded-lg p-4 mb-4">
              <h4 className="font-medium text-gray-800 mb-3">Sample Set Management</h4>
              {trainingSamples.length > 0 && (
                <div className="mb-3 p-3 bg-blue-50 border border-blue-200 rounded-md">
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center">
                      <Database size={16} className="mr-2 text-blue-600" />
                      <span className="text-sm text-blue-800">
                        {trainingSamples.length} training samples available
                      </span>
                    </div>
                    <button
                      onClick={loadTrainingSamplesAsEvaluation}
                      disabled={loadingTraining}
                      className={`px-3 py-1 rounded text-sm font-medium transition-colors flex items-center ${
                        loadingTraining
                          ? 'bg-gray-300 text-gray-500 cursor-not-allowed'
                          : 'bg-blue-600 text-white hover:bg-blue-700'
                      }`}
                    >
                      {loadingTraining ? (
                        <>
                          <Loader2 className="animate-spin mr-1" size={12} />
                          Generating...
                        </>
                      ) : (
                        <>
                          <Database size={12} className="mr-1" />
                          Generate & Evaluate
                        </>
                      )}
                    </button>
                  </div>

                  <div className="mb-2">
                    <label className="block text-xs font-medium text-blue-700 mb-1">
                      Generation Prompt
                    </label>
                    <input
                      type="text"
                      value={generationPrompt}
                      onChange={(e) => setGenerationPrompt(e.target.value)}
                      placeholder="Enter prompt for generating images..."
                      className="w-full px-2 py-1 text-xs border border-blue-300 rounded focus:ring-1 focus:ring-blue-500 focus:border-transparent"
                    />
                  </div>

                  <p className="text-xs text-blue-600">
                    Generate new images from customer photos using this prompt, then evaluate vs OpenAI references
                  </p>
                </div>
              )}

              <div className="flex flex-wrap gap-2 mb-3">
                <button
                  onClick={resetSampleSet}
                  disabled={samplePairs.length === 0}
                  className="px-3 py-1 bg-red-600 text-white rounded text-sm hover:bg-red-700 flex items-center disabled:bg-gray-400"
                >
                  <X size={14} className="mr-1" />
                  Clear All Samples
                </button>
              </div>
            </div>

            {/* Sample Set Display */}
            {samplePairs.length > 0 && (
              <div className="border border-gray-200 rounded-lg p-4">
                <h4 className="font-medium text-gray-800 mb-3">Sample Set ({samplePairs.length} pairs)</h4>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  {samplePairs.map((pair) => (
                    <div key={pair.id} className="relative">
                      <div className="grid grid-cols-2 gap-1">
                        <img
                          src={pair.generated.preview || pair.generated.url}
                          alt="Generated"
                          className="w-full h-20 object-cover rounded border"
                        />
                        <img
                          src={pair.reference.preview || pair.reference.url}
                          alt="Reference"
                          className="w-full h-20 object-cover rounded border"
                        />
                      </div>
                      <button
                        onClick={() => removeSamplePair(pair.id)}
                        className="absolute -top-2 -right-2 bg-red-500 text-white rounded-full w-6 h-6 flex items-center justify-center hover:bg-red-600"
                      >
                        <X size={12} />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* Single Evaluation Results */}
      {evaluation && mode === 'single' && (
        <div className="bg-white rounded-lg shadow-md p-6">
          <h3 className="text-lg font-semibold text-gray-800 mb-4">Evaluation Results</h3>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
            <div>
              <h4 className="font-medium text-gray-700 mb-2">Generated Image</h4>
              <img
                src={generatedImage.preview}
                alt="Generated"
                style={{ maxHeight: '150px', maxWidth: '150px', objectFit: 'cover' }}
                className="rounded-md border"
              />
            </div>
            <div>
              <h4 className="font-medium text-gray-700 mb-2">Reference Image</h4>
              <img
                src={referenceImage.preview}
                alt="Reference"
                style={{ maxHeight: '150px', maxWidth: '150px', objectFit: 'cover' }}
                className="rounded-md border"
              />
            </div>
          </div>

          <div className="bg-gradient-to-r from-purple-50 to-blue-50 rounded-lg p-4 mb-4">
            <div className="flex items-center justify-between mb-4">
              <h4 className="text-lg font-semibold text-gray-800">Individual Scores</h4>
              <div className="text-2xl font-bold text-purple-600">
                {evaluation.score ? evaluation.score :
                 ((evaluation.visualAppeal * weights.visualAppeal) +
                  (evaluation.styleSimilarity * weights.styleSimilarity) +
                  (evaluation.technicalQuality * weights.technicalQuality)).toFixed(1)}
              </div>
            </div>

            {!evaluation.score && (
              <div className="grid grid-cols-3 gap-4 mb-4">
                <div className="text-center">
                  <div className="text-lg font-semibold text-blue-600">{evaluation.visualAppeal}</div>
                  <div className="text-sm text-gray-600">Visual Appeal ({weights.visualAppeal.toFixed(2)})</div>
                </div>
                <div className="text-center">
                  <div className="text-lg font-semibold text-green-600">{evaluation.styleSimilarity}</div>
                  <div className="text-sm text-gray-600">Style Similarity ({weights.styleSimilarity.toFixed(2)})</div>
                </div>
                <div className="text-center">
                  <div className="text-lg font-semibold text-orange-600">{evaluation.technicalQuality}</div>
                  <div className="text-sm text-gray-600">Technical Quality ({weights.technicalQuality.toFixed(2)})</div>
                </div>
              </div>
            )}
          </div>

          <div className="bg-gray-50 rounded-lg p-4">
            <h4 className="font-semibold text-gray-800 mb-2">Analysis</h4>
            <p className="text-gray-700 leading-relaxed">{evaluation.reasoning}</p>
          </div>
        </div>
      )}

      {/* Batch Results */}
      {batchResults.length > 0 && mode === 'batch' && (
        <div className="bg-white rounded-lg shadow-md p-6">
          <h3 className="text-lg font-semibold text-gray-800 mb-4 flex items-center">
            <Trophy className="mr-2" size={20} />
            Ranked Results ({batchResults.length} samples)
          </h3>

          <div className="space-y-4">
            {batchResults.map((result, index) => (
              <div key={result.sampleId} className="border border-gray-200 rounded-lg p-4">
                <div className="flex items-center justify-between mb-3">
                  <div style={{ display: 'flex', alignItems: 'center' }}>
                    <div style={{
                      width: '32px',
                      height: '32px',
                      borderRadius: '50%',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontWeight: 'bold',
                      color: 'white',
                      marginRight: '24px',
                      backgroundColor: index === 0 ? '#eab308' :
                                    index === 1 ? '#9ca3af' :
                                    index === 2 ? '#f97316' : '#3b82f6'
                    }}>
                      {index + 1}
                    </div>
                    <div>
                      <span style={{
                        fontSize: '18px',
                        fontWeight: '600',
                        color: '#9333ea'
                      }}>
                        {result.calculatedScore}
                      </span>
                      {result.visualAppeal !== undefined && (
                        <div className="text-xs text-gray-500 mt-1">
                          Visual: {result.visualAppeal} | Style: {result.styleSimilarity} | Technical: {result.technicalQuality}
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div>
                    <h5 className="text-sm font-medium text-gray-700 mb-1">Generated</h5>
                    <img
                      src={result.samplePair?.generated.url}
                      alt="Generated"
                      style={{ maxHeight: '120px', maxWidth: '120px', objectFit: 'cover' }}
                      className="rounded border"
                    />
                  </div>
                  <div>
                    <h5 className="text-sm font-medium text-gray-700 mb-1">Reference</h5>
                    <img
                      src={result.samplePair?.reference.url}
                      alt="Reference"
                      style={{ maxHeight: '120px', maxWidth: '120px', objectFit: 'cover' }}
                      className="rounded border"
                    />
                  </div>
                  <div>
                    <h5 className="text-sm font-medium text-gray-700 mb-1">Analysis</h5>
                    <div className="bg-gray-50 rounded p-2 h-24 overflow-y-auto">
                      <p className="text-xs text-gray-600">{result.reasoning}</p>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

export default EvaluationTester