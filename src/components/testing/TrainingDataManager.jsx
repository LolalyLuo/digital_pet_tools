import { useState, useEffect } from 'react'
import { useDropzone } from 'react-dropzone'
import { Upload, Eye, Loader2, AlertCircle, Plus, X, Play, Save, Database, Settings, Trash2, Edit3, Image, CheckCircle, XCircle } from 'lucide-react'
import { supabase } from '../../utils/supabaseClient'

const TrainingDataManager = () => {
  const [currentDataSet, setCurrentDataSet] = useState('Default Set')
  const [dataSets, setDataSets] = useState(['Default Set'])
  const [trainingData, setTrainingData] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  // Data set management UI
  const [showNewSetDialog, setShowNewSetDialog] = useState(false)
  const [showRenameDialog, setShowRenameDialog] = useState(false)
  const [newSetName, setNewSetName] = useState('')
  const [renameValue, setRenameValue] = useState('')

  // Manual sample addition
  const [newSampleName, setNewSampleName] = useState('')
  const [uploadedImage, setUploadedImage] = useState(null)
  const [openaiImage, setOpenaiImage] = useState(null)

  // Generation
  const [generationPrompt, setGenerationPrompt] = useState('Transform this dog into a cute, adorable style')
  const [generatingIndividual, setGeneratingIndividual] = useState({})
  const [bulkGenerating, setBulkGenerating] = useState(false)
  const [individualPrompts, setIndividualPrompts] = useState({}) // Store prompts per sample ID

  // Production data for import
  const [productionData, setProductionData] = useState([])
  const [loadingProduction, setLoadingProduction] = useState(false)
  const [selectedProduct, setSelectedProduct] = useState('')
  const [availableProducts, setAvailableProducts] = useState([])

  useEffect(() => {
    loadDataSets()
    loadAvailableProducts()
  }, [])

  useEffect(() => {
    if (selectedProduct) {
      loadProductionData()
    }
  }, [selectedProduct])

  useEffect(() => {
    if (currentDataSet) {
      loadTrainingDataForSet(currentDataSet)
    }
  }, [currentDataSet])

  const loadAvailableProducts = async () => {
    try {
      console.log('🔍 Loading available products from production...')
      const response = await fetch('http://localhost:3001/api/prod/products')
      console.log('📡 Response status:', response.status)

      if (response.ok) {
        const data = await response.json()
        console.log('📦 Products data:', data)
        // Backend returns array of strings, convert to objects for consistency
        const products = (data.products || []).map(productName => ({
          name: productName,
          count: 0 // We'll get the actual count when we select the product
        }))
        setAvailableProducts(products)
        if (products.length > 0 && !selectedProduct) {
          setSelectedProduct(products[0].name)
        }
      } else {
        console.error('❌ Failed to load products:', response.status, response.statusText)
      }
    } catch (err) {
      console.error('❌ Error loading production products:', err)
    }
  }

  const loadProductionData = async () => {
    if (!selectedProduct) {
      setProductionData([])
      return
    }

    try {
      setLoadingProduction(true)
      console.log(`🔍 Loading production data for product: ${selectedProduct}`)
      const response = await fetch(`http://localhost:3001/api/prod/customers?product=${encodeURIComponent(selectedProduct)}`)
      console.log('📡 Customer data response status:', response.status)

      if (response.ok) {
        const data = await response.json()
        console.log('📦 Customer data:', data)
        setProductionData(data.customers || [])
      } else {
        console.error('❌ Failed to load customer data:', response.status, response.statusText)
        setProductionData([])
      }
    } catch (err) {
      console.error('❌ Error loading production data:', err)
      setProductionData([])
    } finally {
      setLoadingProduction(false)
    }
  }

  // Supabase Data Operations
  const loadDataSets = async () => {
    try {
      // Create training_data_sets table if it doesn't exist
      const { data, error } = await supabase
        .from('training_data_sets')
        .select('name')
        .order('created_at', { ascending: true })

      if (error) {
        console.log('Creating default data set (table may not exist yet)')
        // If table doesn't exist, keep default state
        return
      }

      if (data && data.length > 0) {
        const setNames = data.map(set => set.name)
        setDataSets(setNames)
        if (!setNames.includes(currentDataSet)) {
          setCurrentDataSet(setNames[0])
        }
      } else {
        // Create default data set if none exist
        await createDataSetInDB('Default Set')
      }
    } catch (err) {
      console.log('Error loading data sets:', err)
    }
  }

  const createDataSetInDB = async (name) => {
    try {
      const { data, error } = await supabase
        .from('training_data_sets')
        .insert([{ name: name }])
        .select()

      if (error) throw error

      console.log(`📁 Created data set in DB: ${name}`)
      return data[0]
    } catch (err) {
      console.error('Error creating data set:', err)
      setError(`Failed to create data set: ${err.message}`)
    }
  }

  const loadTrainingDataForSet = async (dataSetName) => {
    try {
      setLoading(true)

      const { data, error } = await supabase
        .from('training_samples')
        .select('*')
        .eq('data_set_name', dataSetName)
        .order('created_at', { ascending: false })

      if (error && error.code !== 'PGRST116') { // PGRST116 = table doesn't exist
        throw error
      }

      if (data) {
        const transformedData = data.map(sample => ({
          id: sample.id,
          name: sample.name,
          uploadedImage: sample.uploaded_image_url ? {
            url: sample.uploaded_image_url,
            preview: sample.uploaded_image_url
          } : null,
          openaiImage: sample.openai_image_url ? {
            url: sample.openai_image_url,
            preview: sample.openai_image_url
          } : null,
          geminiImage: sample.gemini_image_url ? {
            url: sample.gemini_image_url,
            preview: sample.gemini_image_url
          } : null,
          status: sample.gemini_image_url ? 'complete' : 'missing_gemini',
          created_at: sample.created_at,
          source: sample.source,
          generation_prompt: sample.generation_prompt
        }))

        setTrainingData(transformedData)

        // Load individual prompts
        const prompts = {}
        transformedData.forEach(sample => {
          if (sample.generation_prompt) {
            prompts[sample.id] = sample.generation_prompt
          }
        })
        setIndividualPrompts(prompts)
      } else {
        setTrainingData([])
        setIndividualPrompts({})
      }
    } catch (err) {
      console.error('Error loading training data:', err)
      setError(`Failed to load training data: ${err.message}`)
    } finally {
      setLoading(false)
    }
  }

  const saveTrainingSampleToDB = async (sample) => {
    try {
      // Upload images to Supabase storage if they're files
      let uploadedImageUrl = null
      let openaiImageUrl = null
      let geminiImageUrl = null

      if (sample.uploadedImage?.file) {
        const uploadedPath = `training-samples/${Date.now()}-uploaded-${sample.name}`
        const { data: uploadData, error: uploadError } = await supabase.storage
          .from('training-images')
          .upload(uploadedPath, sample.uploadedImage.file)

        if (uploadError) throw uploadError
        uploadedImageUrl = supabase.storage.from('training-images').getPublicUrl(uploadedPath).data.publicUrl
      } else if (sample.uploadedImage?.url) {
        uploadedImageUrl = sample.uploadedImage.url
      }

      if (sample.openaiImage?.file) {
        const openaiPath = `training-samples/${Date.now()}-openai-${sample.name}`
        const { data: openaiData, error: openaiError } = await supabase.storage
          .from('training-images')
          .upload(openaiPath, sample.openaiImage.file)

        if (openaiError) throw openaiError
        openaiImageUrl = supabase.storage.from('training-images').getPublicUrl(openaiPath).data.publicUrl
      } else if (sample.openaiImage?.url) {
        openaiImageUrl = sample.openaiImage.url
      }

      if (sample.geminiImage?.file) {
        const geminiPath = `training-samples/${Date.now()}-gemini-${sample.name}`
        const { data: geminiData, error: geminiError } = await supabase.storage
          .from('training-images')
          .upload(geminiPath, sample.geminiImage.file)

        if (geminiError) throw geminiError
        geminiImageUrl = supabase.storage.from('training-images').getPublicUrl(geminiPath).data.publicUrl
      } else if (sample.geminiImage?.url) {
        geminiImageUrl = sample.geminiImage.url
      }

      // Save to database
      const dbSample = {
        name: sample.name,
        data_set_name: currentDataSet,
        uploaded_image_url: uploadedImageUrl,
        openai_image_url: openaiImageUrl,
        gemini_image_url: geminiImageUrl,
        source: sample.source || 'manual',
        generation_prompt: individualPrompts[sample.id] || generationPrompt
      }

      if (sample.id && Number.isInteger(sample.id) && sample.id < 1000000000) {
        // Update existing (if it has a real DB ID from previous load)
        const { data, error } = await supabase
          .from('training_samples')
          .update(dbSample)
          .eq('id', sample.id)
          .select()

        if (error) throw error
        return data[0]
      } else {
        // Insert new - let PostgreSQL generate the ID
        const { data, error } = await supabase
          .from('training_samples')
          .insert([dbSample])
          .select()

        if (error) throw error
        return data[0]
      }
    } catch (err) {
      console.error('Error saving training sample:', err)
      throw err
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
                className="w-16 h-16 object-cover rounded border"
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

  const addManualSample = async () => {
    if (!newSampleName.trim() || !uploadedImage || !openaiImage) {
      setError('Please provide sample name, uploaded image, and OpenAI image')
      return
    }

    try {
      setLoading(true)

      const newSample = {
        id: null, // Let PostgreSQL generate the ID
        name: newSampleName.trim(),
        uploadedImage,
        openaiImage,
        geminiImage: null,
        status: 'missing_gemini',
        created_at: new Date().toISOString(),
        source: 'manual'
      }

      // Save to Supabase
      const savedSample = await saveTrainingSampleToDB(newSample)

      // Add to local state with real DB ID
      const transformedSample = {
        id: savedSample.id,
        name: savedSample.name,
        uploadedImage: savedSample.uploaded_image_url ? {
          url: savedSample.uploaded_image_url,
          preview: savedSample.uploaded_image_url
        } : null,
        openaiImage: savedSample.openai_image_url ? {
          url: savedSample.openai_image_url,
          preview: savedSample.openai_image_url
        } : null,
        geminiImage: null,
        status: 'missing_gemini',
        created_at: savedSample.created_at,
        source: savedSample.source
      }

      setTrainingData(prev => [...prev, transformedSample])

      // Reset form
      setNewSampleName('')
      setUploadedImage(null)
      setOpenaiImage(null)
      setError('')

      console.log(`✅ Added manual sample to DB: ${savedSample.name}`)
    } catch (err) {
      setError(`Failed to add sample: ${err.message}`)
      console.error('Add sample error:', err)
    } finally {
      setLoading(false)
    }
  }

  const generateGeminiForSample = async (sampleId) => {
    const sample = trainingData.find(s => s.id === sampleId)
    const prompt = individualPrompts[sampleId] || generationPrompt

    if (!sample || !sample.uploadedImage) {
      setError('Sample not found or missing uploaded image')
      return
    }

    if (!prompt.trim()) {
      setError('Please enter a generation prompt')
      return
    }

    setGeneratingIndividual(prev => ({ ...prev, [sampleId]: true }))
    setError('')

    try {
      // Convert URL to file if needed
      let uploadedFile = sample.uploadedImage.file
      if (!uploadedFile && sample.uploadedImage.url) {
        const response = await fetch(sample.uploadedImage.url)
        const blob = await response.blob()
        uploadedFile = new File([blob], `uploaded_${sampleId}.jpg`, { type: 'image/jpeg' })
      }

      const generateFormData = new FormData()
      generateFormData.append('images', uploadedFile)
      generateFormData.append('prompts', JSON.stringify([prompt.trim()]))
      generateFormData.append('selectedModel', 'gemini-img2img')

      const generateResponse = await fetch('http://localhost:3001/api/test/generate-images', {
        method: 'POST',
        body: generateFormData
      })

      if (!generateResponse.ok) {
        throw new Error(`Failed to generate image for sample ${sampleId}`)
      }

      const generateData = await generateResponse.json()

      if (!generateData.success || !generateData.results || generateData.results.length === 0) {
        throw new Error(`No generated image returned for sample ${sampleId}`)
      }

      const generatedImageUrl = generateData.results[0].imageUrl

      // Download the generated image
      const imageResponse = await fetch(generatedImageUrl)
      const imageBlob = await imageResponse.blob()
      const imageFile = new File([imageBlob], `gemini_${sampleId}.jpg`, { type: 'image/jpeg' })

      // Update the sample with Gemini image and save to Supabase
      const updatedSample = {
        ...sample,
        geminiImage: {
          file: imageFile,
          url: generatedImageUrl,
          preview: URL.createObjectURL(imageBlob)
        },
        status: 'complete'
      }

      // Save updated sample to Supabase
      await saveTrainingSampleToDB(updatedSample)

      // Update local state
      setTrainingData(prev => prev.map(s =>
        s.id === sampleId ? updatedSample : s
      ))

      console.log(`✅ Generated and saved Gemini image for sample: ${sample.name} with prompt: "${prompt}"`)

    } catch (err) {
      setError(`Failed to generate Gemini image: ${err.message}`)
      console.error('Gemini generation error:', err)
    } finally {
      setGeneratingIndividual(prev => ({ ...prev, [sampleId]: false }))
    }
  }

  const updateIndividualPrompt = async (sampleId, prompt) => {
    // Update local state immediately
    setIndividualPrompts(prev => ({
      ...prev,
      [sampleId]: prompt
    }))

    // Save to database (debounce this in real app)
    try {
      const { error } = await supabase
        .from('training_samples')
        .update({ generation_prompt: prompt })
        .eq('id', sampleId)

      if (error) throw error
    } catch (err) {
      console.error('Error saving individual prompt:', err)
    }
  }

  const getIndividualPrompt = (sampleId) => {
    return individualPrompts[sampleId] || generationPrompt
  }

  const bulkGenerateGemini = async (regenerate = false) => {
    let samplesToProcess

    if (regenerate) {
      // Regenerate all samples that have uploaded images (overwrite existing Gemini)
      samplesToProcess = trainingData.filter(s => s.uploadedImage)
    } else {
      // Generate only missing Gemini images
      samplesToProcess = trainingData.filter(s => !s.geminiImage && s.uploadedImage)
    }

    if (samplesToProcess.length === 0) {
      setError(regenerate ? 'No samples available for regeneration' : 'No samples need Gemini generation')
      return
    }

    setBulkGenerating(true)
    setError('')

    try {
      const action = regenerate ? 'regenerating' : 'generating'
      console.log(`🎨 Bulk ${action} ${samplesToProcess.length} Gemini images...`)

      const generatePromises = samplesToProcess.map(async (sample) => {
        try {
          await generateGeminiForSample(sample.id)
          return { success: true, sampleId: sample.id }
        } catch (err) {
          console.error(`Failed to ${action} for sample ${sample.id}:`, err)
          return { success: false, sampleId: sample.id, error: err.message }
        }
      })

      const results = await Promise.allSettled(generatePromises)
      const successful = results.filter(r => r.status === 'fulfilled' && r.value.success).length
      const failed = results.length - successful

      console.log(`🎨 Bulk ${action} complete: ${successful} successful, ${failed} failed`)

    } catch (err) {
      setError(`Bulk ${regenerate ? 'regeneration' : 'generation'} failed: ${err.message}`)
    } finally {
      setBulkGenerating(false)
    }
  }

  const importFromProduction = async () => {
    if (productionData.length === 0) {
      setError('No production data available to import')
      return
    }

    setLoading(true)
    setError('')

    try {
      console.log(`📥 Starting import of ${productionData.length} production samples`)
      console.log('📦 Sample production data:', productionData[0])

      const importedSamples = []
      const skippedSamples = []

      for (let i = 0; i < productionData.length; i++) {
        const customer = productionData[i]
        console.log(`📝 Processing customer ${i + 1}/${productionData.length}:`, customer)

        // Validate customer has required data
        if (!customer.customerId || !customer.uploadedImage || !selectedProduct) {
          console.log(`⚠️ Skipping customer - missing required data:`, {
            customerId: !!customer.customerId,
            uploadedImage: !!customer.uploadedImage,
            selectedProduct: !!selectedProduct
          })
          skippedSamples.push({
            customer: customer.customerId || 'unknown',
            reason: 'Missing required data'
          })
          continue
        }

        // Request the backend to validate and prepare the import data
        // This will check if both uploaded and generated images exist and return proper URLs
        try {
          const validateResponse = await fetch('http://localhost:3001/api/prod/validate-customer', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({
              customerId: customer.customerId,
              uploadedImage: customer.uploadedImage,
              productType: selectedProduct
            })
          })

          if (!validateResponse.ok) {
            console.log(`⚠️ Validation failed for customer ${customer.customerId}`)
            skippedSamples.push({
              customer: customer.customerId,
              reason: 'Validation failed'
            })
            continue
          }

          const validationData = await validateResponse.json()
          if (!validationData.success || !validationData.uploadedImageUrl || !validationData.generatedImageUrl) {
            console.log(`⚠️ Customer ${customer.customerId} missing required images:`, validationData)
            skippedSamples.push({
              customer: customer.customerId,
              reason: validationData.reason || 'Missing images'
            })
            continue
          }

          const uploadedImageUrl = validationData.uploadedImageUrl
          const openaiImageUrl = validationData.generatedImageUrl

          const newSample = {
            id: null, // Let PostgreSQL generate the ID
            name: `Customer ${customer.customerId}`,
            uploadedImage: {
              url: uploadedImageUrl,
              preview: uploadedImageUrl
            },
            openaiImage: {
              url: openaiImageUrl,
              preview: openaiImageUrl
            },
            geminiImage: null,
            status: 'missing_gemini',
            created_at: new Date().toISOString(),
            source: 'production'
          }

          // Save each sample to Supabase
          const savedSample = await saveTrainingSampleToDB(newSample)

          // Transform for local state
          const transformedSample = {
            id: savedSample.id,
            name: savedSample.name,
            uploadedImage: savedSample.uploaded_image_url ? {
              url: savedSample.uploaded_image_url,
              preview: savedSample.uploaded_image_url
            } : null,
            openaiImage: savedSample.openai_image_url ? {
              url: savedSample.openai_image_url,
              preview: savedSample.openai_image_url
            } : null,
            geminiImage: null,
            status: 'missing_gemini',
            created_at: savedSample.created_at,
            source: savedSample.source
          }

          importedSamples.push(transformedSample)
          console.log(`✅ Successfully imported customer ${customer.customerId}`)

        } catch (validationError) {
          console.log(`⚠️ Failed validation for customer ${customer.customerId}:`, validationError)
          skippedSamples.push({
            customer: customer.customerId,
            reason: validationError.message || 'Validation error'
          })
        }
      }

      // Update local state with imported samples
      setTrainingData(prev => [...prev, ...importedSamples])

      // Log results
      console.log(`📥 Import complete: ${importedSamples.length} imported, ${skippedSamples.length} skipped`)
      if (skippedSamples.length > 0) {
        console.log('⚠️ Skipped samples:', skippedSamples)
      }

    } catch (err) {
      setError(`Import failed: ${err.message}`)
      console.error('Import error:', err)
    } finally {
      setLoading(false)
    }
  }

  // Data Set Management Functions
  const createNewDataSet = async () => {
    if (!newSetName.trim()) {
      setError('Please enter a data set name')
      return
    }

    if (dataSets.includes(newSetName.trim())) {
      setError('Data set name already exists')
      return
    }

    try {
      const newSet = newSetName.trim()
      await createDataSetInDB(newSet)

      setDataSets(prev => [...prev, newSet])
      setCurrentDataSet(newSet)
      setNewSetName('')
      setShowNewSetDialog(false)
      setError('')

      console.log(`📁 Created new data set: ${newSet}`)
    } catch (err) {
      setError(`Failed to create data set: ${err.message}`)
    }
  }

  const renameDataSet = async () => {
    if (!renameValue.trim()) {
      setError('Please enter a new data set name')
      return
    }

    if (dataSets.includes(renameValue.trim())) {
      setError('Data set name already exists')
      return
    }

    try {
      const oldName = currentDataSet
      const newName = renameValue.trim()

      // Update in database
      const { error: updateError } = await supabase
        .from('training_data_sets')
        .update({ name: newName })
        .eq('name', oldName)

      if (updateError) throw updateError

      // Update all training samples to use new data set name
      const { error: samplesError } = await supabase
        .from('training_samples')
        .update({ data_set_name: newName })
        .eq('data_set_name', oldName)

      if (samplesError) throw samplesError

      setDataSets(prev => prev.map(name => name === oldName ? newName : name))
      setCurrentDataSet(newName)
      setRenameValue('')
      setShowRenameDialog(false)
      setError('')

      console.log(`📝 Renamed data set: ${oldName} → ${newName}`)
    } catch (err) {
      setError(`Failed to rename data set: ${err.message}`)
    }
  }

  const deleteDataSet = async () => {
    if (dataSets.length <= 1) {
      setError('Cannot delete the last data set')
      return
    }

    if (!confirm(`Are you sure you want to delete the data set "${currentDataSet}"? This action cannot be undone.`)) {
      return
    }

    try {
      const setToDelete = currentDataSet

      console.log(`🗑️ Starting delete of data set: ${setToDelete}`)

      // Delete all training samples for this data set
      const { error: samplesError } = await supabase
        .from('training_samples')
        .delete()
        .eq('data_set_name', setToDelete)

      if (samplesError) {
        console.error('Error deleting samples:', samplesError)
        throw samplesError
      }

      // Delete the data set - renamed variable to avoid conflict
      const { error: dbError } = await supabase
        .from('training_data_sets')
        .delete()
        .eq('name', setToDelete)

      if (dbError) {
        console.error('Error deleting data set:', dbError)
        throw dbError
      }

      const remainingSets = dataSets.filter(name => name !== setToDelete)
      const newCurrentSet = remainingSets[0]

      setDataSets(remainingSets)
      setCurrentDataSet(newCurrentSet)
      setError('')

      console.log(`🗑️ Successfully deleted data set: ${setToDelete}`)
    } catch (err) {
      console.error('Delete data set error:', err)
      setError(`Failed to delete data set: ${err.message}`)
    }
  }

  const switchDataSet = (newSetName) => {
    if (newSetName !== currentDataSet) {
      setCurrentDataSet(newSetName)
      console.log(`🔄 Switched to data set: ${newSetName}`)
      // loadTrainingDataForSet will be called by useEffect when currentDataSet changes
    }
  }

  const deleteSample = async (sampleId) => {
    try {
      // Delete from Supabase
      const { error } = await supabase
        .from('training_samples')
        .delete()
        .eq('id', sampleId)

      if (error) throw error

      // Remove from local state
      setTrainingData(prev => prev.filter(s => s.id !== sampleId))
      setIndividualPrompts(prev => {
        const newPrompts = { ...prev }
        delete newPrompts[sampleId]
        return newPrompts
      })

      console.log(`🗑️ Deleted sample from DB: ${sampleId}`)
    } catch (err) {
      setError(`Failed to delete sample: ${err.message}`)
      console.error('Delete sample error:', err)
    }
  }

  const getSampleStatusIcon = (sample) => {
    if (sample.uploadedImage && sample.openaiImage && sample.geminiImage) {
      return <CheckCircle className="text-green-500" size={16} />
    }
    return <XCircle className="text-red-500" size={16} />
  }

  const getSampleStatusText = (sample) => {
    const parts = []
    if (sample.uploadedImage) parts.push('Uploaded')
    if (sample.openaiImage) parts.push('OpenAI')
    if (sample.geminiImage) parts.push('Gemini')

    const missing = []
    if (!sample.uploadedImage) missing.push('Uploaded')
    if (!sample.openaiImage) missing.push('OpenAI')
    if (!sample.geminiImage) missing.push('Gemini')

    return missing.length === 0 ? 'Complete' : `Missing: ${missing.join(', ')}`
  }

  return (
    <div className="max-w-6xl mx-auto p-6 space-y-6 overflow-y-auto max-h-screen">
      {/* Header */}
      <div className="bg-white rounded-lg shadow-md p-6">
        <h2 className="text-2xl font-bold text-gray-800 flex items-center mb-4">
          <Database className="mr-2" size={24} />
          Training Data Management
        </h2>

        {error && (
          <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-md flex items-center">
            <AlertCircle className="text-red-500 mr-2" size={16} />
            <span className="text-red-700">{error}</span>
          </div>
        )}

        {/* Data Set Management */}
        <div className="mb-6 p-4 bg-gray-50 border border-gray-200 rounded-lg">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-3">
              <label className="text-sm font-medium text-gray-700">Data Set:</label>
              <select
                value={currentDataSet}
                onChange={(e) => switchDataSet(e.target.value)}
                className="px-3 py-1 text-sm border border-gray-300 rounded focus:ring-1 focus:ring-blue-500"
              >
                {dataSets.map(setName => (
                  <option key={setName} value={setName}>{setName}</option>
                ))}
              </select>
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => setShowNewSetDialog(true)}
                className="px-3 py-1 text-xs bg-green-600 text-white rounded hover:bg-green-700 flex items-center"
              >
                <Plus size={12} className="mr-1" />
                New Set
              </button>
              <button
                onClick={() => {
                  setRenameValue(currentDataSet)
                  setShowRenameDialog(true)
                }}
                className="px-3 py-1 text-xs bg-gray-600 text-white rounded hover:bg-gray-700 flex items-center"
              >
                <Edit3 size={12} className="mr-1" />
                Rename
              </button>
              <button
                onClick={deleteDataSet}
                disabled={dataSets.length <= 1}
                className="px-3 py-1 text-xs bg-red-600 text-white rounded hover:bg-red-700 flex items-center disabled:bg-gray-400"
              >
                <Trash2 size={12} className="mr-1" />
                Delete
              </button>
            </div>
          </div>
          <p className="text-sm text-gray-600">
            <strong>{currentDataSet}</strong>: {trainingData.length} samples
            ({trainingData.filter(s => s.status === 'complete').length} complete,
            {trainingData.filter(s => s.status === 'missing_gemini').length} missing Gemini)
          </p>
        </div>

        {/* Data Set Management Dialogs */}
        {showNewSetDialog && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
            <div className="bg-white rounded-lg p-6 w-96">
              <h3 className="text-lg font-semibold mb-4">Create New Data Set</h3>
              <input
                type="text"
                value={newSetName}
                onChange={(e) => setNewSetName(e.target.value)}
                placeholder="Enter data set name..."
                className="w-full px-3 py-2 border border-gray-300 rounded focus:ring-1 focus:ring-blue-500 mb-4"
                autoFocus
                onKeyPress={(e) => e.key === 'Enter' && createNewDataSet()}
              />
              <div className="flex gap-2 justify-end">
                <button
                  onClick={() => {
                    setShowNewSetDialog(false)
                    setNewSetName('')
                    setError('')
                  }}
                  className="px-4 py-2 text-sm bg-gray-300 text-gray-700 rounded hover:bg-gray-400"
                >
                  Cancel
                </button>
                <button
                  onClick={createNewDataSet}
                  disabled={!newSetName.trim()}
                  className="px-4 py-2 text-sm bg-green-600 text-white rounded hover:bg-green-700 disabled:bg-gray-400"
                >
                  Create
                </button>
              </div>
            </div>
          </div>
        )}

        {showRenameDialog && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
            <div className="bg-white rounded-lg p-6 w-96">
              <h3 className="text-lg font-semibold mb-4">Rename Data Set</h3>
              <p className="text-sm text-gray-600 mb-3">Current name: <strong>{currentDataSet}</strong></p>
              <input
                type="text"
                value={renameValue}
                onChange={(e) => setRenameValue(e.target.value)}
                placeholder="Enter new data set name..."
                className="w-full px-3 py-2 border border-gray-300 rounded focus:ring-1 focus:ring-blue-500 mb-4"
                autoFocus
                onKeyPress={(e) => e.key === 'Enter' && renameDataSet()}
              />
              <div className="flex gap-2 justify-end">
                <button
                  onClick={() => {
                    setShowRenameDialog(false)
                    setRenameValue('')
                    setError('')
                  }}
                  className="px-4 py-2 text-sm bg-gray-300 text-gray-700 rounded hover:bg-gray-400"
                >
                  Cancel
                </button>
                <button
                  onClick={renameDataSet}
                  disabled={!renameValue.trim()}
                  className="px-4 py-2 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 disabled:bg-gray-400"
                >
                  Rename
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Manual Sample Addition */}
      <div className="bg-white rounded-lg shadow-md p-6">
        <h3 className="text-lg font-semibold text-gray-800 mb-4 flex items-center">
          <Plus className="mr-2" size={20} />
          Add Additional Samples
        </h3>
        <p className="text-sm text-gray-600 mb-4">
          Supplement the production customer data with additional training samples
        </p>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Sample Name *
            </label>
            <input
              type="text"
              value={newSampleName}
              onChange={(e) => setNewSampleName(e.target.value)}
              placeholder="Enter sample name..."
              className="w-full px-3 py-2 border border-gray-300 rounded focus:ring-1 focus:ring-blue-500"
            />
          </div>
          <div className="md:col-span-2">
            <div className="grid grid-cols-2 gap-4">
              {createDropzone(setUploadedImage, uploadedImage, "Uploaded Image *")}
              {createDropzone(setOpenaiImage, openaiImage, "OpenAI Reference *")}
            </div>
          </div>
        </div>

        <div className="flex justify-end">
          <button
            onClick={addManualSample}
            disabled={!newSampleName.trim() || !uploadedImage || !openaiImage}
            className={`px-4 py-2 rounded font-medium transition-colors flex items-center ${
              !newSampleName.trim() || !uploadedImage || !openaiImage
                ? 'bg-gray-300 text-gray-500 cursor-not-allowed'
                : 'bg-blue-600 text-white hover:bg-blue-700'
            }`}
          >
            <Plus className="mr-2" size={16} />
            Add Sample
          </button>
        </div>
      </div>

      {/* Import from Production */}
      <div className="bg-white rounded-lg shadow-md p-6">
        <h3 className="text-lg font-semibold text-gray-800 mb-4 flex items-center">
          <Database className="mr-2" size={20} />
          Import from Production
        </h3>
        <p className="text-sm text-gray-600 mb-4">
          Import real customer data (uploaded photos + OpenAI generated images) into the current data set
        </p>

        <div className="mb-4">
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Product Type
          </label>
          <select
            value={selectedProduct}
            onChange={(e) => setSelectedProduct(e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded focus:ring-1 focus:ring-blue-500"
          >
            <option value="">Select a product...</option>
            {availableProducts.map(product => (
              <option key={product.name} value={product.name}>
                {product.name}
              </option>
            ))}
          </select>
        </div>

        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm text-gray-700">
              {selectedProduct ? (
                loadingProduction ? 'Loading...' : `${productionData.length} customer samples available for ${selectedProduct}`
              ) : 'Select a product to view customer data'}
            </p>
            {loadingProduction && (
              <p className="text-xs text-gray-500 mt-1">Querying production database...</p>
            )}
          </div>
          <div className="flex gap-2">
            <button
              onClick={loadProductionData}
              disabled={loadingProduction || !selectedProduct}
              className={`px-3 py-2 rounded text-sm transition-colors flex items-center ${
                loadingProduction || !selectedProduct
                  ? 'bg-gray-300 text-gray-500 cursor-not-allowed'
                  : 'bg-blue-600 text-white hover:bg-blue-700'
              }`}
            >
              {loadingProduction ? (
                <>
                  <Loader2 className="animate-spin mr-2" size={14} />
                  Loading...
                </>
              ) : (
                <>
                  <Database className="mr-2" size={14} />
                  Refresh
                </>
              )}
            </button>
            <button
              onClick={importFromProduction}
              disabled={loading || productionData.length === 0 || !selectedProduct}
              className={`px-4 py-2 rounded font-medium transition-colors flex items-center ${
                loading || productionData.length === 0 || !selectedProduct
                  ? 'bg-gray-300 text-gray-500 cursor-not-allowed'
                  : 'bg-green-600 text-white hover:bg-green-700'
              }`}
            >
              {loading ? (
                <>
                  <Loader2 className="animate-spin mr-2" size={16} />
                  Importing...
                </>
              ) : (
                <>
                  <Database className="mr-2" size={16} />
                  Import All
                </>
              )}
            </button>
          </div>
        </div>
      </div>

      {/* Bulk Gemini Generation */}
      {trainingData.length > 0 && (
        <div className="bg-white rounded-lg shadow-md p-6">
          <h3 className="text-lg font-semibold text-gray-800 mb-4 flex items-center">
            <Image className="mr-2" size={20} />
            Bulk Gemini Generation
          </h3>

          <div className="mb-4">
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Generation Prompt
            </label>
            <input
              type="text"
              value={generationPrompt}
              onChange={(e) => setGenerationPrompt(e.target.value)}
              placeholder="Enter prompt for generating Gemini images..."
              className="w-full px-3 py-2 border border-gray-300 rounded focus:ring-1 focus:ring-green-500"
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="flex flex-col">
              <p className="text-sm text-gray-600 mb-2">
                {trainingData.filter(s => !s.geminiImage && s.uploadedImage).length} samples missing Gemini images
              </p>
              <button
                onClick={() => bulkGenerateGemini(false)}
                disabled={bulkGenerating || trainingData.filter(s => !s.geminiImage && s.uploadedImage).length === 0}
                className={`px-4 py-2 rounded font-medium transition-colors flex items-center justify-center ${
                  bulkGenerating || trainingData.filter(s => !s.geminiImage && s.uploadedImage).length === 0
                    ? 'bg-gray-300 text-gray-500 cursor-not-allowed'
                    : 'bg-green-600 text-white hover:bg-green-700'
                }`}
              >
                {bulkGenerating ? (
                  <>
                    <Loader2 className="animate-spin mr-2" size={16} />
                    Generating...
                  </>
                ) : (
                  <>
                    <Plus className="mr-2" size={16} />
                    Generate Missing
                  </>
                )}
              </button>
            </div>

            <div className="flex flex-col">
              <p className="text-sm text-gray-600 mb-2">
                {trainingData.filter(s => s.geminiImage && s.uploadedImage).length} samples with Gemini images
              </p>
              <button
                onClick={() => bulkGenerateGemini(true)}
                disabled={bulkGenerating || trainingData.filter(s => s.uploadedImage).length === 0}
                className={`px-4 py-2 rounded font-medium transition-colors flex items-center justify-center ${
                  bulkGenerating || trainingData.filter(s => s.uploadedImage).length === 0
                    ? 'bg-gray-300 text-gray-500 cursor-not-allowed'
                    : 'bg-blue-600 text-white hover:bg-blue-700'
                }`}
              >
                {bulkGenerating ? (
                  <>
                    <Loader2 className="animate-spin mr-2" size={16} />
                    Regenerating...
                  </>
                ) : (
                  <>
                    <Image className="mr-2" size={16} />
                    Regenerate All
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Training Data List */}
      {trainingData.length > 0 && (
        <div className="bg-white rounded-lg shadow-md p-6">
          <h3 className="text-lg font-semibold text-gray-800 mb-4">
            Training Data Samples ({trainingData.length})
          </h3>

          <div className="space-y-4">
            {trainingData.map((sample) => (
              <div key={sample.id} className="border border-gray-200 rounded-lg p-4">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-3">
                    {getSampleStatusIcon(sample)}
                    <div>
                      <h4 className="font-medium text-gray-800">{sample.name}</h4>
                      <p className="text-xs text-gray-500">{getSampleStatusText(sample)}</p>
                    </div>
                  </div>
                  <button
                    onClick={() => deleteSample(sample.id)}
                    className="px-2 py-1 text-xs bg-red-600 text-white rounded hover:bg-red-700 flex items-center"
                  >
                    <Trash2 size={12} className="mr-1" />
                    Delete
                  </button>
                </div>

                <div className="grid grid-cols-3 gap-4 mb-4">
                  <div>
                    <h5 className="text-sm font-medium text-gray-700 mb-1">Uploaded Image</h5>
                    {sample.uploadedImage ? (
                      <img
                        src={sample.uploadedImage.preview || sample.uploadedImage.url}
                        alt="Uploaded"
                        className="w-full h-24 object-cover rounded border"
                      />
                    ) : (
                      <div className="w-full h-24 bg-gray-100 rounded border flex items-center justify-center">
                        <XCircle className="text-gray-400" size={20} />
                      </div>
                    )}
                  </div>
                  <div>
                    <h5 className="text-sm font-medium text-gray-700 mb-1">OpenAI Reference</h5>
                    {sample.openaiImage ? (
                      <img
                        src={sample.openaiImage.preview || sample.openaiImage.url}
                        alt="OpenAI"
                        className="w-full h-24 object-cover rounded border"
                      />
                    ) : (
                      <div className="w-full h-24 bg-gray-100 rounded border flex items-center justify-center">
                        <XCircle className="text-gray-400" size={20} />
                      </div>
                    )}
                  </div>
                  <div>
                    <h5 className="text-sm font-medium text-gray-700 mb-1">Gemini Generated</h5>
                    {sample.geminiImage ? (
                      <img
                        src={sample.geminiImage.preview || sample.geminiImage.url}
                        alt="Gemini"
                        className="w-full h-24 object-cover rounded border"
                      />
                    ) : (
                      <div className="w-full h-24 bg-gray-100 rounded border flex items-center justify-center">
                        <XCircle className="text-gray-400" size={20} />
                      </div>
                    )}
                  </div>
                </div>

                {/* Individual Gemini Generation */}
                {!sample.geminiImage && sample.uploadedImage && (
                  <div className="bg-gray-50 rounded p-3">
                    <h6 className="text-sm font-medium text-gray-700 mb-2">Generate Gemini Image</h6>
                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={getIndividualPrompt(sample.id)}
                        onChange={(e) => updateIndividualPrompt(sample.id, e.target.value)}
                        placeholder="Enter generation prompt for this sample..."
                        className="flex-1 px-3 py-2 text-sm border border-gray-300 rounded focus:ring-1 focus:ring-green-500"
                      />
                      <button
                        onClick={() => generateGeminiForSample(sample.id)}
                        disabled={generatingIndividual[sample.id]}
                        className={`px-3 py-2 text-sm rounded transition-colors flex items-center ${
                          generatingIndividual[sample.id]
                            ? 'bg-gray-300 text-gray-500 cursor-not-allowed'
                            : 'bg-green-600 text-white hover:bg-green-700'
                        }`}
                      >
                        {generatingIndividual[sample.id] ? (
                          <>
                            <Loader2 className="animate-spin mr-1" size={14} />
                            Generating
                          </>
                        ) : (
                          <>
                            <Image className="mr-1" size={14} />
                            Generate
                          </>
                        )}
                      </button>
                    </div>
                  </div>
                )}

                {/* Regenerate option for existing Gemini images */}
                {sample.geminiImage && (
                  <div className="bg-blue-50 rounded p-3">
                    <h6 className="text-sm font-medium text-gray-700 mb-2">Regenerate Gemini Image</h6>
                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={getIndividualPrompt(sample.id)}
                        onChange={(e) => updateIndividualPrompt(sample.id, e.target.value)}
                        placeholder="Enter new generation prompt..."
                        className="flex-1 px-3 py-2 text-sm border border-gray-300 rounded focus:ring-1 focus:ring-blue-500"
                      />
                      <button
                        onClick={() => generateGeminiForSample(sample.id)}
                        disabled={generatingIndividual[sample.id]}
                        className={`px-3 py-2 text-sm rounded transition-colors flex items-center ${
                          generatingIndividual[sample.id]
                            ? 'bg-gray-300 text-gray-500 cursor-not-allowed'
                            : 'bg-blue-600 text-white hover:bg-blue-700'
                        }`}
                      >
                        {generatingIndividual[sample.id] ? (
                          <>
                            <Loader2 className="animate-spin mr-1" size={14} />
                            Regenerating
                          </>
                        ) : (
                          <>
                            <Image className="mr-1" size={14} />
                            Regenerate
                          </>
                        )}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

export default TrainingDataManager