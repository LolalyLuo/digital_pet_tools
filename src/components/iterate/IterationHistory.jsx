import { useState, useEffect } from 'react'
import { Play, Pause, Square, RotateCcw, Trash2, Eye, Download, Clock, TrendingUp, Award } from 'lucide-react'
import { supabase } from '../../utils/supabaseClient'

export default function IterationHistory() {
  const [runs, setRuns] = useState([])
  const [loading, setLoading] = useState(false)
  const [selectedRun, setSelectedRun] = useState(null)
  const [viewingResults, setViewingResults] = useState(false)

  // Mock data for demonstration
  const mockRuns = [
    {
      id: '1',
      config_name: 'Cute pets optimization',
      status: 'completed',
      current_iteration: 10,
      total_iterations: 10,
      started_at: '2024-01-15T10:30:00Z',
      completed_at: '2024-01-15T12:45:00Z',
      best_score: 9.2,
      avg_score: 7.8,
      total_images: 50,
      config: {
        evaluation_criteria: { type: 'llm_scoring' },
        generation_method: { type: 'gemini' },
        source_photo_bundles: ['Sample Set 1', 'Test Photos']
      }
    },
    {
      id: '2',
      config_name: 'High quality portraits',
      status: 'failed',
      current_iteration: 3,
      total_iterations: 15,
      started_at: '2024-01-14T14:20:00Z',
      completed_at: '2024-01-14T14:35:00Z',
      best_score: 6.5,
      avg_score: 5.2,
      total_images: 15,
      error: 'API rate limit exceeded',
      config: {
        evaluation_criteria: { type: 'photo_matching' },
        generation_method: { type: 'openai' },
        source_photo_bundles: ['Portrait Bundle']
      }
    },
    {
      id: '3',
      config_name: 'Action shots experiment',
      status: 'paused',
      current_iteration: 5,
      total_iterations: 20,
      started_at: '2024-01-13T09:15:00Z',
      completed_at: null,
      best_score: 8.1,
      avg_score: 7.3,
      total_images: 25,
      config: {
        evaluation_criteria: { type: 'manual_rating' },
        generation_method: { type: 'gemini-img2img' },
        source_photo_bundles: ['Action Photos']
      }
    }
  ]

  useEffect(() => {
    loadRunHistory()
  }, [])

  const loadRunHistory = async () => {
    setLoading(true)
    try {
      const { data: runs, error } = await supabase
        .from('iteration_runs')
        .select(`
          *,
          iteration_results(
            evaluation_score,
            iteration_number
          )
        `)
        .order('started_at', { ascending: false })

      if (error) throw error

      // Calculate stats for each run
      const runsWithStats = runs.map(run => {
        const results = run.iteration_results || []
        const scores = results.filter(r => r.evaluation_score !== null).map(r => r.evaluation_score)
        const bestScore = scores.length > 0 ? Math.max(...scores) : null
        const avgScore = scores.length > 0 ? scores.reduce((sum, score) => sum + score, 0) / scores.length : null
        
        return {
          ...run,
          config_name: `Iteration Run ${run.id}`,
          best_score: bestScore,
          avg_score: avgScore,
          total_images: results.length,
          config: {
            evaluation_criteria: { type: 'unknown' },
            generation_method: { type: 'unknown' },
            source_photo_bundles: []
          }
        }
      })

      setRuns(runsWithStats)
    } catch (error) {
      console.error('Failed to load run history:', error)
      // Fallback to mock data on error
      setRuns(mockRuns)
    } finally {
      setLoading(false)
    }
  }

  const handleDeleteRun = async (runId) => {
    if (!confirm('Are you sure you want to delete this iteration run? This action cannot be undone.')) {
      return
    }

    try {
      // In real implementation:
      // await supabase.from('iteration_runs').delete().eq('id', runId)
      setRuns(runs.filter(run => run.id !== runId))
    } catch (error) {
      console.error('Failed to delete run:', error)
      alert('Failed to delete run. Please try again.')
    }
  }

  const handleResumeRun = (run) => {
    // In real implementation, this would resume the iteration
    console.log('Resuming run:', run.id)
    alert('Resume functionality would be implemented with the iteration engine')
  }

  const formatDuration = (startTime, endTime) => {
    if (!endTime) return 'In progress'
    
    const start = new Date(startTime)
    const end = new Date(endTime)
    const diffMs = end - start
    const diffMins = Math.floor(diffMs / 60000)
    const diffHours = Math.floor(diffMins / 60)
    
    if (diffHours > 0) {
      return `${diffHours}h ${diffMins % 60}m`
    }
    return `${diffMins}m`
  }

  const getStatusColor = (status) => {
    switch (status) {
      case 'completed':
        return 'bg-green-100 text-green-700 border-green-200'
      case 'running':
        return 'bg-blue-100 text-blue-700 border-blue-200'
      case 'paused':
        return 'bg-yellow-100 text-yellow-700 border-yellow-200'
      case 'failed':
        return 'bg-red-100 text-red-700 border-red-200'
      default:
        return 'bg-gray-100 text-gray-700 border-gray-200'
    }
  }

  const getStatusIcon = (status) => {
    switch (status) {
      case 'completed':
        return <Award className="h-3 w-3" />
      case 'running':
        return <Play className="h-3 w-3" />
      case 'paused':
        return <Pause className="h-3 w-3" />
      case 'failed':
        return <Square className="h-3 w-3" />
      default:
        return <Clock className="h-3 w-3" />
    }
  }

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500 mx-auto mb-4"></div>
          <p className="text-gray-600">Loading iteration history...</p>
        </div>
      </div>
    )
  }

  if (viewingResults && selectedRun) {
    return (
      <div className="flex-1 overflow-hidden">
        <div className="bg-white border-b border-gray-200 p-4">
          <div className="flex items-center gap-4">
            <button
              onClick={() => setViewingResults(false)}
              className="text-blue-600 hover:text-blue-700 flex items-center gap-2"
            >
              ← Back to History
            </button>
            <h2 className="text-lg font-semibold">{selectedRun.config_name} - Results</h2>
          </div>
        </div>
        <div className="flex-1 p-6 overflow-y-auto">
          <div className="text-center text-gray-500 py-12">
            <p>Results viewer would be implemented here</p>
            <p className="text-sm mt-2">This would show the IterationResults component with historical data</p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="flex-1 overflow-hidden">
      <div className="bg-white border-b border-gray-200 p-6">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-xl font-semibold text-gray-800">Iteration History</h2>
            <p className="text-sm text-gray-600 mt-1">
              View and manage your previous iteration runs
            </p>
          </div>
          <div className="text-sm text-gray-500">
            {runs.length} total runs
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        {runs.length === 0 ? (
          <div className="text-center py-12 text-gray-500">
            <Clock className="h-12 w-12 mx-auto mb-4 text-gray-300" />
            <p className="text-lg">No iteration runs yet</p>
            <p className="text-sm mt-2">Start your first iteration to see results here</p>
          </div>
        ) : (
          <div className="space-y-4">
            {runs.map((run) => (
              <div key={run.id} className="bg-white rounded-lg border border-gray-200 shadow-sm hover:shadow-md transition-shadow">
                <div className="p-6">
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      {/* Header */}
                      <div className="flex items-center gap-3 mb-3">
                        <h3 className="text-lg font-medium text-gray-800">{run.config_name}</h3>
                        <div className={`px-2 py-1 rounded-full text-xs font-medium border flex items-center gap-1 ${getStatusColor(run.status)}`}>
                          {getStatusIcon(run.status)}
                          {run.status.charAt(0).toUpperCase() + run.status.slice(1)}
                        </div>
                      </div>

                      {/* Stats Grid */}
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
                        <div className="text-center">
                          <div className="text-lg font-semibold text-gray-800">{run.current_iteration}</div>
                          <div className="text-xs text-gray-500">of {run.total_iterations} iterations</div>
                        </div>
                        <div className="text-center">
                          <div className="text-lg font-semibold text-blue-600">{run.total_images}</div>
                          <div className="text-xs text-gray-500">images generated</div>
                        </div>
                        <div className="text-center">
                          <div className="text-lg font-semibold text-green-600">{run.best_score?.toFixed(1) || 'N/A'}</div>
                          <div className="text-xs text-gray-500">best score</div>
                        </div>
                        <div className="text-center">
                          <div className="text-lg font-semibold text-purple-600">{run.avg_score?.toFixed(1) || 'N/A'}</div>
                          <div className="text-xs text-gray-500">average score</div>
                        </div>
                      </div>

                      {/* Progress Bar */}
                      <div className="mb-4">
                        <div className="flex justify-between text-xs text-gray-500 mb-1">
                          <span>Progress</span>
                          <span>{Math.round((run.current_iteration / run.total_iterations) * 100)}%</span>
                        </div>
                        <div className="w-full bg-gray-200 rounded-full h-2">
                          <div 
                            className={`h-2 rounded-full transition-all ${
                              run.status === 'completed' ? 'bg-green-500' : 
                              run.status === 'failed' ? 'bg-red-500' : 'bg-blue-500'
                            }`}
                            style={{ width: `${(run.current_iteration / run.total_iterations) * 100}%` }}
                          ></div>
                        </div>
                      </div>

                      {/* Configuration Summary */}
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4 text-xs">
                        <div>
                          <span className="text-gray-500">Evaluation:</span>
                          <span className="ml-2 font-medium">{run.config?.evaluation_criteria?.type?.replace('_', ' ') || 'Unknown'}</span>
                        </div>
                        <div>
                          <span className="text-gray-500">Method:</span>
                          <span className="ml-2 font-medium">{run.config?.generation_method?.type || 'Unknown'}</span>
                        </div>
                        <div>
                          <span className="text-gray-500">Bundles:</span>
                          <span className="ml-2 font-medium">{run.config?.source_photo_bundles?.length || 0} bundle(s)</span>
                        </div>
                      </div>

                      {/* Timestamps */}
                      <div className="flex items-center gap-4 text-xs text-gray-500">
                        <div className="flex items-center gap-1">
                          <Clock className="h-3 w-3" />
                          Started: {new Date(run.started_at).toLocaleString()}
                        </div>
                        <div>
                          Duration: {formatDuration(run.started_at, run.completed_at)}
                        </div>
                      </div>

                      {/* Error Message */}
                      {run.error && (
                        <div className="mt-3 p-2 bg-red-50 border border-red-200 rounded text-xs text-red-700">
                          <strong>Error:</strong> {run.error}
                        </div>
                      )}
                    </div>

                    {/* Actions */}
                    <div className="flex flex-col gap-2 ml-4">
                      <button
                        onClick={() => {
                          setSelectedRun(run)
                          setViewingResults(true)
                        }}
                        className="px-3 py-1 text-xs bg-blue-100 text-blue-700 rounded hover:bg-blue-200 flex items-center gap-1"
                      >
                        <Eye className="h-3 w-3" />
                        View Results
                      </button>

                      {run.status === 'paused' && (
                        <button
                          onClick={() => handleResumeRun(run)}
                          className="px-3 py-1 text-xs bg-green-100 text-green-700 rounded hover:bg-green-200 flex items-center gap-1"
                        >
                          <Play className="h-3 w-3" />
                          Resume
                        </button>
                      )}

                      <button className="px-3 py-1 text-xs bg-gray-100 text-gray-700 rounded hover:bg-gray-200 flex items-center gap-1">
                        <Download className="h-3 w-3" />
                        Export
                      </button>

                      <button
                        onClick={() => handleDeleteRun(run.id)}
                        className="px-3 py-1 text-xs bg-red-100 text-red-700 rounded hover:bg-red-200 flex items-center gap-1"
                      >
                        <Trash2 className="h-3 w-3" />
                        Delete
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}