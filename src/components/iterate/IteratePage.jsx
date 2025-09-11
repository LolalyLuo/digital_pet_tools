import { useState } from 'react'
import { Play, Pause, Square, RotateCcw } from 'lucide-react'
import ConfigPanel from './ConfigPanel'
import IterationResults from './IterationResults'
import IterationHistory from './IterationHistory'
import { useIterationEngine } from '../../hooks/useIterationEngine'

export default function IteratePage() {
  const [currentConfig, setCurrentConfig] = useState(null)
  const [currentTab, setCurrentTab] = useState('config')
  
  const {
    currentRun,
    isRunning,
    currentIteration,
    results,
    error,
    progress,
    startIteration,
    pauseIteration,
    stopIteration,
    resetEngine
  } = useIterationEngine()

  const handleStartIteration = async (config) => {
    setCurrentConfig(config)
    await startIteration(config)
    setCurrentTab('results')
  }

  const handlePauseIteration = () => {
    pauseIteration()
  }

  const handleResumeIteration = () => {
    // Resume would be implemented in the iteration engine
    console.log('Resume iteration not yet implemented')
  }

  const handleStopIteration = () => {
    stopIteration()
  }

  const handleResetIteration = () => {
    resetEngine()
    setCurrentConfig(null)
    setCurrentTab('config')
  }

  return (
    <div className="flex-1 flex overflow-hidden bg-gray-50">
      {/* Left Sidebar - Configuration Panel */}
      <div className="w-1/2 max-w-2xl bg-white shadow-sm border-r border-gray-200 flex flex-col">
        <div className="p-6 border-b border-gray-200">
          <h2 className="text-xl font-semibold text-gray-800">Configuration</h2>
          <p className="text-sm text-gray-600 mt-1">
            Set up your iteration parameters
          </p>
        </div>

        <div className="flex-1 overflow-y-auto">
          <ConfigPanel 
            currentConfig={currentConfig}
            onConfigChange={setCurrentConfig}
            onStartIteration={handleStartIteration}
            isRunning={isRunning}
          />
        </div>

        {/* Control Buttons */}
        {currentConfig && (
          <div className="p-6 border-t border-gray-200 bg-gray-50">
            <div className="flex gap-2">
              {!currentRun && (
                <button
                  onClick={() => handleStartIteration(currentConfig)}
                  className="flex-1 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 flex items-center justify-center gap-2"
                  disabled={isRunning}
                >
                  <Play className="h-4 w-4" />
                  Start
                </button>
              )}

              {currentRun?.status === 'running' && (
                <button
                  onClick={handlePauseIteration}
                  className="flex-1 px-4 py-2 bg-yellow-600 text-white rounded-lg hover:bg-yellow-700 flex items-center justify-center gap-2"
                >
                  <Pause className="h-4 w-4" />
                  Pause
                </button>
              )}

              {currentRun?.status === 'paused' && (
                <button
                  onClick={handleResumeIteration}
                  className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 flex items-center justify-center gap-2"
                >
                  <Play className="h-4 w-4" />
                  Resume
                </button>
              )}

              {currentRun && (
                <button
                  onClick={handleStopIteration}
                  className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 flex items-center justify-center gap-2"
                >
                  <Square className="h-4 w-4" />
                  Stop
                </button>
              )}

              {currentRun && (
                <button
                  onClick={handleResetIteration}
                  className="px-4 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700 flex items-center justify-center gap-2"
                >
                  <RotateCcw className="h-4 w-4" />
                  Reset
                </button>
              )}
            </div>

            {currentRun && (
              <div className="mt-3 text-sm text-gray-600">
                <div className="flex justify-between">
                  <span>Status: <span className="font-medium">{currentRun.status}</span></span>
                  <span>{currentIteration} / {currentRun.total_iterations}</span>
                </div>
                <div className="w-full bg-gray-200 rounded-full h-2 mt-2">
                  <div 
                    className="bg-blue-600 h-2 rounded-full transition-all duration-300" 
                    style={{ width: `${(currentIteration / currentRun.total_iterations) * 100}%` }}
                  ></div>
                </div>
              </div>
            )}

            {error && (
              <div className="mt-3 p-2 bg-red-50 border border-red-200 rounded text-xs text-red-700">
                <strong>Error:</strong> {error}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col">
        {/* Header with Tabs */}
        <div className="bg-white border-b border-gray-200">
          <div className="px-6 py-4">
            <h1 className="text-2xl font-bold text-gray-800 mb-4">Iterate</h1>
            <div className="flex space-x-1">
              <button
                onClick={() => setCurrentTab('config')}
                className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors ${
                  currentTab === 'config'
                    ? 'bg-blue-100 text-blue-700 border border-blue-200'
                    : 'text-gray-600 hover:text-gray-900 hover:bg-gray-50'
                }`}
              >
                Configuration
              </button>
              <button
                onClick={() => setCurrentTab('results')}
                className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors ${
                  currentTab === 'results'
                    ? 'bg-blue-100 text-blue-700 border border-blue-200'
                    : 'text-gray-600 hover:text-gray-900 hover:bg-gray-50'
                }`}
              >
                Current Results
              </button>
              <button
                onClick={() => setCurrentTab('history')}
                className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors ${
                  currentTab === 'history'
                    ? 'bg-blue-100 text-blue-700 border border-blue-200'
                    : 'text-gray-600 hover:text-gray-900 hover:bg-gray-50'
                }`}
              >
                History
              </button>
            </div>
          </div>
        </div>

        {/* Tab Content */}
        <div className="flex-1 overflow-auto p-6">
          {currentTab === 'config' && (
            <div className="max-w-4xl mx-auto">
              <div className="bg-white rounded-lg shadow-sm p-6 mb-6">
                <h3 className="text-lg font-semibold text-gray-800 mb-4">Configuration Overview</h3>
                <div className="prose text-gray-600">
                  <p className="mb-4">Set up your iteration configuration using the panel on the left. Complete these steps to get started:</p>
                  <div className="grid md:grid-cols-2 gap-6">
                    <div>
                      <h4 className="font-medium text-gray-800 mb-2">1. Create or select photo bundles</h4>
                      <p className="text-sm text-gray-600 mb-4">Choose the source photos that will be used for generation</p>
                      
                      <h4 className="font-medium text-gray-800 mb-2">2. Choose evaluation criteria</h4>
                      <p className="text-sm text-gray-600 mb-4">Select how generated images will be scored and ranked</p>
                    </div>
                    <div>
                      <h4 className="font-medium text-gray-800 mb-2">3. Set generation method</h4>
                      <p className="text-sm text-gray-600 mb-4">Configure the AI model and parameters for image generation</p>
                      
                      <h4 className="font-medium text-gray-800 mb-2">4. Configure iteration settings</h4>
                      <p className="text-sm text-gray-600">Set the number of iterations, batch size, and other parameters</p>
                    </div>
                  </div>
                </div>
              </div>
              
              <div className="bg-white rounded-lg shadow-sm p-6">
                <h3 className="text-lg font-semibold text-gray-800 mb-4">How Iteration Works</h3>
                <div className="grid md:grid-cols-3 gap-6">
                  <div className="text-center">
                    <div className="w-12 h-12 bg-blue-100 text-blue-600 rounded-full flex items-center justify-center text-xl font-bold mx-auto mb-3">1</div>
                    <h4 className="font-medium text-gray-800 mb-2">Generate Images</h4>
                    <p className="text-sm text-gray-600">Create images using your source photos and prompts</p>
                  </div>
                  <div className="text-center">
                    <div className="w-12 h-12 bg-green-100 text-green-600 rounded-full flex items-center justify-center text-xl font-bold mx-auto mb-3">2</div>
                    <h4 className="font-medium text-gray-800 mb-2">Evaluate Results</h4>
                    <p className="text-sm text-gray-600">Score images using your chosen evaluation criteria</p>
                  </div>
                  <div className="text-center">
                    <div className="w-12 h-12 bg-purple-100 text-purple-600 rounded-full flex items-center justify-center text-xl font-bold mx-auto mb-3">3</div>
                    <h4 className="font-medium text-gray-800 mb-2">Improve & Repeat</h4>
                    <p className="text-sm text-gray-600">Use best results to generate better prompts for next iteration</p>
                  </div>
                </div>
              </div>
            </div>
          )}

          {currentTab === 'results' && (
            <div className="h-full">
              <IterationResults 
                activeRun={currentRun}
                results={results}
                onResultsUpdate={() => {}} // Results are managed by the iteration engine
              />
            </div>
          )}

          {currentTab === 'history' && (
            <div className="h-full">
              <IterationHistory />
            </div>
          )}
        </div>
      </div>
    </div>
  )
}