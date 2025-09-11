import { useState, useEffect } from 'react'
import { TrendingUp, TrendingDown, Award, BarChart3, Download, Eye, Star, X } from 'lucide-react'

export default function IterationResults({ activeRun, results, onResultsUpdate }) {
  const [sortBy, setSortBy] = useState('score') // score, iteration, timestamp
  const [sortOrder, setSortOrder] = useState('desc') // asc, desc
  const [viewMode, setViewMode] = useState('grid') // grid, list
  const [selectedResult, setSelectedResult] = useState(null)

  const displayResults = results || []

  const sortedResults = [...displayResults].sort((a, b) => {
    let comparison = 0
    
    switch (sortBy) {
      case 'score':
        comparison = a.evaluation_score - b.evaluation_score
        break
      case 'iteration':
        comparison = a.iteration_number - b.iteration_number
        break
      case 'timestamp':
        comparison = new Date(a.created_at) - new Date(b.created_at)
        break
      default:
        comparison = 0
    }
    
    return sortOrder === 'desc' ? -comparison : comparison
  })

  const getScoreColor = (score) => {
    if (score >= 9) return 'text-green-600 bg-green-50'
    if (score >= 7) return 'text-blue-600 bg-blue-50'
    if (score >= 5) return 'text-yellow-600 bg-yellow-50'
    return 'text-red-600 bg-red-50'
  }

  const getBestResult = () => {
    const validResults = displayResults.filter(r => r.evaluation_score !== null && r.evaluation_score !== undefined)
    if (validResults.length === 0) return null
    return validResults.reduce((best, current) => 
      current.evaluation_score > best.evaluation_score ? current : best
    , validResults[0])
  }

  const getAverageScore = () => {
    if (displayResults.length === 0) return '0.0'
    const validResults = displayResults.filter(r => r.evaluation_score !== null && r.evaluation_score !== undefined)
    if (validResults.length === 0) return '0.0'
    const total = validResults.reduce((sum, result) => sum + result.evaluation_score, 0)
    return (total / validResults.length).toFixed(1)
  }

  const getIterationProgress = () => {
    const iterations = [...new Set(displayResults.map(r => r.iteration_number))].sort()
    return iterations.map(iter => {
      const iterResults = displayResults.filter(r => r.iteration_number === iter)
      const avgScore = iterResults.reduce((sum, r) => sum + r.evaluation_score, 0) / iterResults.length
      return { iteration: iter, averageScore: avgScore.toFixed(1), count: iterResults.length }
    })
  }

  if (!activeRun && displayResults.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center text-gray-500">
        <div className="text-center">
          <BarChart3 className="h-12 w-12 mx-auto mb-4 text-gray-300" />
          <p className="text-lg">No iteration results yet</p>
          <p className="text-sm mt-2">Start an iteration to see results here</p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex-1 overflow-hidden bg-gray-50">
      <div className="h-full flex flex-col">
        {/* Stats Header */}
        <div className="bg-white border-b border-gray-200 p-6">
          <div className="grid grid-cols-4 gap-6">
            <div className="text-center">
              <div className="text-2xl font-bold text-gray-800">{displayResults.length}</div>
              <div className="text-sm text-gray-600">Total Images</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-blue-600">{getAverageScore()}</div>
              <div className="text-sm text-gray-600">Avg Score</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-green-600">
                {getBestResult() ? getBestResult().evaluation_score.toFixed(1) : '0.0'}
              </div>
              <div className="text-sm text-gray-600">Best Score</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-purple-600">
                {activeRun ? activeRun.currentIteration : Math.max(...displayResults.map(r => r.iteration_number), 0)}
              </div>
              <div className="text-sm text-gray-600">Iterations</div>
            </div>
          </div>

          {/* Progress Chart */}
          {getIterationProgress().length > 1 && (
            <div className="mt-6">
              <div className="text-sm font-medium text-gray-700 mb-2">Score Progress</div>
              <div className="flex items-end space-x-2 h-20">
                {getIterationProgress().map(({ iteration, averageScore, count }) => (
                  <div key={iteration} className="flex-1 flex flex-col items-center">
                    <div 
                      className="w-full bg-blue-500 rounded-t flex items-end justify-center text-white text-xs"
                      style={{ height: `${(averageScore / 10) * 100}%`, minHeight: '20px' }}
                    >
                      {averageScore}
                    </div>
                    <div className="text-xs text-gray-600 mt-1">Iter {iteration}</div>
                    <div className="text-xs text-gray-500">{count} imgs</div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Controls */}
        <div className="bg-white border-b border-gray-200 px-6 py-3 flex items-center justify-between">
          <div className="flex items-center space-x-4">
            <div className="flex items-center space-x-2">
              <label className="text-sm text-gray-600">Sort by:</label>
              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value)}
                className="px-2 py-1 text-sm border border-gray-300 rounded"
              >
                <option value="score">Score</option>
                <option value="iteration">Iteration</option>
                <option value="timestamp">Time</option>
              </select>
            </div>
            <button
              onClick={() => setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc')}
              className="px-3 py-1 text-sm border border-gray-300 rounded hover:bg-gray-50 flex items-center gap-1"
            >
              {sortOrder === 'desc' ? <TrendingDown className="h-3 w-3" /> : <TrendingUp className="h-3 w-3" />}
              {sortOrder === 'desc' ? 'High to Low' : 'Low to High'}
            </button>
          </div>

          <div className="flex items-center space-x-2">
            <button
              onClick={() => setViewMode('grid')}
              className={`px-3 py-1 text-sm rounded ${viewMode === 'grid' ? 'bg-blue-100 text-blue-700' : 'text-gray-600 hover:bg-gray-50'}`}
            >
              Grid
            </button>
            <button
              onClick={() => setViewMode('list')}
              className={`px-3 py-1 text-sm rounded ${viewMode === 'list' ? 'bg-blue-100 text-blue-700' : 'text-gray-600 hover:bg-gray-50'}`}
            >
              List
            </button>
          </div>
        </div>

        {/* Results Display */}
        <div className="flex-1 overflow-y-auto p-6">
          {viewMode === 'grid' ? (
            <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
              {sortedResults.map((result) => (
                <div key={result.id} className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden hover:shadow-md transition-shadow">
                  {/* Image */}
                  <div className="aspect-square bg-gray-100">
                    <img
                      src={result.image_url}
                      alt={`Iteration ${result.iteration_number || 'N/A'} result`}
                      className="w-full h-full object-cover"
                    />
                  </div>

                  {/* Content */}
                  <div className="p-3">
                    {/* Score and Iteration */}
                    <div className="flex items-center justify-between mb-2">
                      <div className={`px-2 py-1 rounded text-xs font-medium ${result.evaluation_score ? getScoreColor(result.evaluation_score) : 'text-gray-600 bg-gray-50'}`}>
                        {result.evaluation_score ? result.evaluation_score.toFixed(1) : 'N/A'}
                      </div>
                      <div className="text-xs text-gray-500">
                        Iteration {result.iteration_number || 'N/A'}
                      </div>
                    </div>

                    {/* Prompt */}
                    <p className="text-xs text-gray-600 line-clamp-2 mb-2">
                      {result.prompt}
                    </p>

                    {/* Criteria Breakdown */}
                    {result.evaluation_details?.criteria && (
                      <div className="space-y-1 mb-2">
                        {Object.entries(result.evaluation_details.criteria).map(([criterion, score]) => (
                          <div key={criterion} className="flex justify-between text-xs">
                            <span className="text-gray-500 capitalize">{criterion.replace('_', ' ')}</span>
                            <span className="font-medium">{score}</span>
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Actions */}
                    <div className="flex justify-between">
                      <button
                        onClick={() => setSelectedResult(result)}
                        className="text-xs text-blue-600 hover:text-blue-700 flex items-center gap-1"
                      >
                        <Eye className="h-3 w-3" />
                        View Details
                      </button>
                      <button className="text-xs text-gray-600 hover:text-gray-700 flex items-center gap-1">
                        <Download className="h-3 w-3" />
                        Download
                      </button>
                    </div>
                  </div>

                  {/* Best Result Badge */}
                  {getBestResult() && result === getBestResult() && (
                    <div className="absolute top-2 left-2 bg-yellow-500 text-white px-2 py-1 rounded-full text-xs flex items-center gap-1">
                      <Award className="h-3 w-3" />
                      Best
                    </div>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <div className="space-y-3">
              {sortedResults.map((result) => (
                <div key={result.id} className="bg-white rounded-lg shadow-sm border border-gray-200 p-4 flex items-center space-x-4">
                  <img
                    src={result.image_url}
                    alt={`Iteration ${result.iteration_number || 'N/A'} result`}
                    className="w-16 h-16 object-cover rounded"
                  />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center space-x-2 mb-1">
                      <div className={`px-2 py-1 rounded text-xs font-medium ${result.evaluation_score ? getScoreColor(result.evaluation_score) : 'text-gray-600 bg-gray-50'}`}>
                        {result.evaluation_score ? result.evaluation_score.toFixed(1) : 'N/A'}
                      </div>
                      <span className="text-sm text-gray-500">Iteration {result.iteration_number || 'N/A'}</span>
                      {getBestResult() && result === getBestResult() && (
                        <div className="bg-yellow-500 text-white px-2 py-1 rounded-full text-xs flex items-center gap-1">
                          <Award className="h-3 w-3" />
                          Best
                        </div>
                      )}
                    </div>
                    <p className="text-sm text-gray-800 truncate mb-1">{result.prompt}</p>
                    <p className="text-xs text-gray-500">{result.evaluation_details?.feedback}</p>
                  </div>
                  <div className="flex items-center space-x-2">
                    <button
                      onClick={() => setSelectedResult(result)}
                      className="text-sm text-blue-600 hover:text-blue-700"
                    >
                      <Eye className="h-4 w-4" />
                    </button>
                    <button className="text-sm text-gray-600 hover:text-gray-700">
                      <Download className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Detail Modal */}
      {selectedResult && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50" onClick={() => setSelectedResult(null)}>
          <div className="bg-white rounded-lg max-w-2xl w-full mx-4 max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="p-6">
              <div className="flex justify-between items-start mb-4">
                <h3 className="text-lg font-semibold">Iteration {selectedResult.iteration_number || 'N/A'} Result</h3>
                <button
                  onClick={() => setSelectedResult(null)}
                  className="text-gray-400 hover:text-gray-600"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div>
                  <img
                    src={selectedResult.image_url}
                    alt="Generated result"
                    className="w-full rounded-lg"
                  />
                </div>
                <div className="space-y-4">
                  <div>
                    <h4 className="font-medium text-gray-900 mb-2">Score Breakdown</h4>
                    <div className="space-y-2">
                      {Object.entries(selectedResult.evaluation_details?.criteria || {}).map(([criterion, score]) => (
                        <div key={criterion} className="flex justify-between">
                          <span className="text-gray-600 capitalize">{criterion.replace('_', ' ')}</span>
                          <div className="flex items-center">
                            <span className="font-medium mr-2">{score}</span>
                            <div className="w-16 bg-gray-200 rounded-full h-2">
                              <div 
                                className="bg-blue-500 h-2 rounded-full" 
                                style={{ width: `${(score / 10) * 100}%` }}
                              ></div>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div>
                    <h4 className="font-medium text-gray-900 mb-2">Prompt</h4>
                    <p className="text-gray-700 text-sm">{selectedResult.prompt}</p>
                  </div>

                  <div>
                    <h4 className="font-medium text-gray-900 mb-2">Feedback</h4>
                    <p className="text-gray-700 text-sm">{selectedResult.evaluation_details?.feedback}</p>
                  </div>

                  <div className="flex space-x-2">
                    <button className="flex-1 px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 flex items-center justify-center gap-2">
                      <Download className="h-4 w-4" />
                      Download
                    </button>
                    <button className="flex-1 px-4 py-2 border border-gray-300 rounded hover:bg-gray-50 flex items-center justify-center gap-2">
                      <Star className="h-4 w-4" />
                      Save as Favorite
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}