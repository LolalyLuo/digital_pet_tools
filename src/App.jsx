import { useState, useEffect } from 'react'
import { supabase } from './utils/supabaseClient'
import Auth from './components/Auth'
import LeftPanel from './components/LeftPanel'
import MiddlePanel from './components/MiddlePanel'
import RightPanel from './components/RightPanel'
import FinalizeDesigns from './components/FinalizeDesigns'

function App() {
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(true)
  const [selectedPhotos, setSelectedPhotos] = useState([])
  const [generatedPrompts, setGeneratedPrompts] = useState([])
  const [results, setResults] = useState([])
  const [currentApp, setCurrentApp] = useState('explore-ideas')

  useEffect(() => {
    let isMounted = true
    
    // Check for existing session with timeout and error handling
    const getSession = async () => {
      try {
        // Add timeout safety
        const timeoutPromise = new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Session timeout')), 10000)
        )
        
        const sessionPromise = supabase.auth.getSession()
        const { data: { session } } = await Promise.race([sessionPromise, timeoutPromise])
        
        if (isMounted) {
          setUser(session?.user ?? null)
          setLoading(false)
        }
      } catch (error) {
        console.error('Session error:', error)
        if (isMounted) {
          // Fallback: assume no user and stop loading
          setUser(null)
          setLoading(false)
        }
      }
    }

    getSession()

    // Listen for auth changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, session) => {
        if (isMounted) {
          setUser(session?.user ?? null)
          setLoading(false)
        }
      }
    )

    return () => {
      isMounted = false
      subscription?.unsubscribe()
    }
  }, [])

  const handleSignOut = async () => {
    await supabase.auth.signOut()
    setUser(null)
    setSelectedPhotos([])
    setGeneratedPrompts([])
    setResults([])
  }

  const renderCurrentApp = () => {
    switch (currentApp) {
      case 'explore-ideas':
        return (
          <>
            <LeftPanel 
              selectedPhotos={selectedPhotos}
              setSelectedPhotos={setSelectedPhotos}
            />
            <MiddlePanel 
              selectedPhotos={selectedPhotos}
              generatedPrompts={generatedPrompts}
              setGeneratedPrompts={setGeneratedPrompts}
              results={results}
              setResults={setResults}
            />
            <RightPanel 
              results={results} 
              setResults={setResults}
            />
          </>
        )
      case 'finalize-designs':
        return <FinalizeDesigns />
      default:
        return null
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-100 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500 mx-auto mb-4"></div>
          <p className="text-gray-600">Loading...</p>
          <button
            onClick={() => {
              console.log('Manual reset triggered')
              setLoading(false)
              setUser(null)
            }}
            className="mt-4 px-4 py-2 bg-gray-500 text-white rounded hover:bg-gray-600"
          >
            Reset Loading State
          </button>
        </div>
      </div>
    )
  }

  if (!user) {
    return <Auth onAuthSuccess={setUser} />
  }

  return (
    <div className="flex flex-col h-screen bg-gray-100">
      {/* Top Navigation Bar */}
      <div className="bg-white shadow-sm border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            {/* App Navigation */}
            <div className="flex space-x-1">
              <button
                onClick={() => setCurrentApp('explore-ideas')}
                className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                  currentApp === 'explore-ideas'
                    ? 'bg-blue-100 text-blue-700 border border-blue-200'
                    : 'text-gray-600 hover:text-gray-900 hover:bg-gray-50'
                }`}
              >
                Explore Ideas
              </button>
              <button
                onClick={() => setCurrentApp('finalize-designs')}
                className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                  currentApp === 'finalize-designs'
                    ? 'bg-blue-100 text-blue-700 border border-blue-200'
                    : 'text-gray-600 hover:text-gray-900 hover:bg-gray-50'
                }`}
              >
                Finalize Designs
              </button>
            </div>

            {/* User Info and Sign Out */}
            <div className="flex items-center gap-3">
              <span className="text-sm text-gray-600">
                {user.email}
              </span>
              <button
                onClick={handleSignOut}
                className="px-3 py-1 text-sm bg-red-500 text-white rounded hover:bg-red-600"
              >
                Sign Out
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* App Content */}
      <div className="flex flex-1 overflow-hidden">
        {renderCurrentApp()}
      </div>
    </div>
  )
}

export default App
