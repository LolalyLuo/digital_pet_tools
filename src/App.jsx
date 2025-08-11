import { useState } from 'react'
import LeftPanel from './components/LeftPanel'
import MiddlePanel from './components/MiddlePanel'
import RightPanel from './components/RightPanel'

function App() {
  const [selectedPhotos, setSelectedPhotos] = useState([])
  const [generatedPrompts, setGeneratedPrompts] = useState([])
  const [results, setResults] = useState([])

  return (
    <div className="flex h-screen bg-gray-100">
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
