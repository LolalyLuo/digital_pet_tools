import { useState, useEffect } from 'react'
import { FolderOpen, Plus, Edit3, Trash2, Package } from 'lucide-react'
import { supabase } from '../../../utils/supabaseClient'
import PhotoBundleEditor from './PhotoBundleEditor'

export default function PhotoBundleSelector({ selectedBundles, onChange }) {
  const [bundles, setBundles] = useState([])
  const [loading, setLoading] = useState(false)
  const [showEditor, setShowEditor] = useState(false)
  const [editingBundle, setEditingBundle] = useState(null)

  useEffect(() => {
    loadBundles()
  }, [])

  const loadBundles = async () => {
    setLoading(true)
    try {
      const { data, error } = await supabase
        .from('photo_bundles')
        .select('*')
        .order('created_at', { ascending: false })

      if (error) throw error
      setBundles(data || [])
    } catch (error) {
      console.error('Failed to load photo bundles:', error)
      setBundles([])
    } finally {
      setLoading(false)
    }
  }

  const handleBundleToggle = (bundleName) => {
    const newSelection = selectedBundles.includes(bundleName)
      ? selectedBundles.filter(name => name !== bundleName)
      : [...selectedBundles, bundleName]
    
    onChange(newSelection)
  }

  const handleCreateBundle = () => {
    setEditingBundle(null)
    setShowEditor(true)
  }

  const handleEditBundle = (bundle) => {
    setEditingBundle(bundle)
    setShowEditor(true)
  }

  const handleDeleteBundle = async (bundleId) => {
    if (!confirm('Are you sure you want to delete this photo bundle?')) {
      return
    }

    try {
      const { error } = await supabase
        .from('photo_bundles')
        .delete()
        .eq('id', bundleId)

      if (error) throw error
      
      await loadBundles()
      
      // Remove from selection if it was selected
      const deletedBundle = bundles.find(b => b.id === bundleId)
      if (deletedBundle && selectedBundles.includes(deletedBundle.name)) {
        onChange(selectedBundles.filter(name => name !== deletedBundle.name))
      }
    } catch (error) {
      console.error('Failed to delete bundle:', error)
      alert('Failed to delete bundle. Please try again.')
    }
  }

  const handleEditorClose = (savedBundle) => {
    setShowEditor(false)
    setEditingBundle(null)
    if (savedBundle) {
      loadBundles()
    }
  }

  if (showEditor) {
    return (
      <PhotoBundleEditor
        bundle={editingBundle}
        onClose={handleEditorClose}
      />
    )
  }

  return (
    <div className="space-y-3">
      {/* Header with Create Button */}
      <div className="flex items-center justify-between">
        <div className="text-xs text-gray-600">
          {selectedBundles.length > 0 
            ? `${selectedBundles.length} bundle${selectedBundles.length !== 1 ? 's' : ''} selected`
            : 'No bundles selected'
          }
        </div>
        <button
          onClick={handleCreateBundle}
          className="px-3 py-1 text-xs bg-green-500 text-white rounded hover:bg-green-600 flex items-center gap-1"
        >
          <Plus className="h-3 w-3" />
          Create Bundle
        </button>
      </div>

      {/* Loading State */}
      {loading && (
        <div className="text-center py-4">
          <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-500 mx-auto"></div>
          <div className="text-xs text-gray-500 mt-2">Loading bundles...</div>
        </div>
      )}

      {/* Bundles List */}
      {!loading && (
        <div className="space-y-2 max-h-60 overflow-y-auto border border-gray-200 rounded p-2">
          {bundles.length === 0 ? (
            <div className="text-center py-6 text-gray-500">
              <Package className="h-8 w-8 mx-auto mb-2 text-gray-300" />
              <p className="text-xs">No photo bundles created yet</p>
              <p className="text-xs mt-1">Create a bundle to organize your photos for iteration testing</p>
            </div>
          ) : (
            bundles.map((bundle) => (
              <div
                key={bundle.id}
                className={`flex items-center justify-between p-2 rounded border transition-colors cursor-pointer hover:bg-gray-50 ${
                  selectedBundles.includes(bundle.name)
                    ? 'border-blue-300 bg-blue-50'
                    : 'border-gray-200'
                }`}
                onClick={() => handleBundleToggle(bundle.name)}
              >
                <div className="flex items-center gap-2 flex-1">
                  <input
                    type="checkbox"
                    checked={selectedBundles.includes(bundle.name)}
                    onChange={() => handleBundleToggle(bundle.name)}
                    className="text-blue-600"
                    onClick={(e) => e.stopPropagation()}
                  />
                  <FolderOpen className="h-4 w-4 text-gray-500" />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-gray-800 truncate">
                      {bundle.name}
                    </div>
                    <div className="text-xs text-gray-500 truncate">
                      {bundle.photo_ids?.length || 0} photos
                      {bundle.description && ` • ${bundle.description}`}
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-1 ml-2">
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      handleEditBundle(bundle)
                    }}
                    className="p-1 text-gray-400 hover:text-blue-600 transition-colors"
                    title="Edit bundle"
                  >
                    <Edit3 className="h-3 w-3" />
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      handleDeleteBundle(bundle.id)
                    }}
                    className="p-1 text-gray-400 hover:text-red-600 transition-colors"
                    title="Delete bundle"
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {/* Selected Bundles Summary */}
      {selectedBundles.length > 0 && (
        <div className="text-xs text-gray-500 bg-blue-50 p-2 rounded border border-blue-200">
          <strong>Selected bundles:</strong> {selectedBundles.join(', ')}
        </div>
      )}
    </div>
  )
}