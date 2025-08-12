import { useState, useEffect } from 'react'
import { supabase } from './utils/supabaseClient'
import Auth from './components/Auth'
import LeftPanel from './components/LeftPanel'
import MiddlePanel from './components/MiddlePanel'
import RightPanel from './components/RightPanel'

function App() {
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(true)
  const [selectedPhotos, setSelectedPhotos] = useState([])
  const [generatedPrompts, setGeneratedPrompts] = useState([])
  const [results, setResults] = useState([])

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
    <div className="flex h-screen bg-gray-100">
      {/* Header with user info and sign out */}
      <div className="absolute top-4 right-4 z-10">
        <div className="flex items-center gap-3 bg-white rounded-lg shadow-md px-4 py-2">
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
    </div>
  )
}

export default App
