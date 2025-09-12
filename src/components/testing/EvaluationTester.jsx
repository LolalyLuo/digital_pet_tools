import { useState } from 'react'
import { useDropzone } from 'react-dropzone'
import { Upload, Star, Eye, Zap, Loader2, AlertCircle } from 'lucide-react'

const EvaluationTester = () => {
  const [generatedImage, setGeneratedImage] = useState(null)
  const [referenceImage, setReferenceImage] = useState(null)
  const [evaluation, setEvaluation] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

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

  const handleEvaluate = async () => {
    if (!generatedImage || !referenceImage) {
      setError('Please upload both images')
      return
    }

    setLoading(true)
    setError('')
    setEvaluation(null)

    try {
      // Call the real GPT-4 Vision evaluation API
      const response = await fetch('http://localhost:3001/api/evaluate-gpt4-vision', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          generatedImageUrl: generatedImage.preview,
          referenceImageUrl: referenceImage.preview
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
    <div className="max-w-4xl mx-auto p-6 space-y-6 overflow-y-auto max-h-screen">
      <div className="bg-white rounded-lg shadow-md p-6">
        <h2 className="text-2xl font-bold text-gray-800 mb-4 flex items-center">
          <Eye className="mr-2" size={24} />
          GPT-4 Vision Evaluation Tester
        </h2>
        
        {error && (
          <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-md flex items-center">
            <AlertCircle className="text-red-500 mr-2" size={16} />
            <span className="text-red-700">{error}</span>
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
          {createDropzone(setGeneratedImage, generatedImage, "Generated Image")}
          {createDropzone(setReferenceImage, referenceImage, "Reference Image")}
        </div>

        <button
          onClick={handleEvaluate}
          disabled={loading || !generatedImage || !referenceImage}
          className={`w-full py-3 px-4 rounded-md font-medium transition-colors flex items-center justify-center ${
            loading || !generatedImage || !referenceImage
              ? 'bg-gray-300 text-gray-500 cursor-not-allowed'
              : 'bg-purple-600 text-white hover:bg-purple-700'
          }`}
        >
          {loading ? (
            <>
              <Loader2 className="animate-spin mr-2" size={16} />
              Evaluating with GPT-4 Vision...
            </>
          ) : (
            'Evaluate with GPT-4 Vision'
          )}
        </button>
      </div>

      {/* Results */}
      {evaluation && (
        <div className="bg-white rounded-lg shadow-md p-6">
          <h3 className="text-lg font-semibold text-gray-800 mb-4">Evaluation Results</h3>
          
          {/* Images Side by Side */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
            <div>
              <h4 className="font-medium text-gray-700 mb-2">Generated Image</h4>
              <img
                src={generatedImage.preview}
                alt="Generated"
                style={{ 
                  maxHeight: '200px', 
                  maxWidth: '200px', 
                  objectFit: 'cover' 
                }}
                className="rounded-md border"
              />
            </div>
            <div>
              <h4 className="font-medium text-gray-700 mb-2">Reference Image</h4>
              <img
                src={referenceImage.preview}
                alt="Reference"
                style={{ 
                  maxHeight: '200px', 
                  maxWidth: '200px', 
                  objectFit: 'cover' 
                }}
                className="rounded-md border"
              />
            </div>
          </div>

          {/* Scores */}
          <div className="space-y-4 mb-6">
            <ScoreBar label="Cuteness" score={evaluation.cuteness} icon={Star} color="pink" />
            <ScoreBar label="Similarity" score={evaluation.similarity} icon={Eye} color="blue" />
            <ScoreBar label="Quality" score={evaluation.quality} icon={Zap} color="green" />
          </div>

          {/* Overall Score */}
          <div className="bg-gradient-to-r from-purple-50 to-blue-50 rounded-lg p-4 mb-4">
            <div className="flex items-center justify-between">
              <h4 className="text-lg font-semibold text-gray-800">Overall Score</h4>
              <div className="text-3xl font-bold text-purple-600">
                {evaluation.weightedScore}/10
              </div>
            </div>
            <p className="text-sm text-gray-600 mt-1">
              Weighted average: (Cuteness × 0.5) + (Similarity × 0.3) + (Quality × 0.2)
            </p>
          </div>

          {/* GPT-4 Reasoning */}
          <div className="bg-gray-50 rounded-lg p-4">
            <h4 className="font-semibold text-gray-800 mb-2">GPT-4 Vision Analysis</h4>
            <p className="text-gray-700 leading-relaxed">{evaluation.reasoning}</p>
          </div>
        </div>
      )}
    </div>
  )
}

export default EvaluationTester