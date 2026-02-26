import { useState, useEffect } from "react";
import { supabase } from "./utils/supabaseClient";
import Auth from "./components/Auth";
import LeftPanel from "./components/LeftPanel";
import MiddlePanel from "./components/MiddlePanel";
import RightPanel from "./components/RightPanel";
import FinalizeDesigns from "./components/FinalizeDesigns";
import TestDesign from "./components/TestDesign";
import IteratePage from "./components/iterate/IteratePage";
import EvaluationTester from "./components/testing/EvaluationTester";
import TrainingDataManager from "./components/testing/TrainingDataManager";
import VertexAIOptimizer from "./components/testing/VertexAIOptimizer";
import ProdImages from "./components/ProdImages";
import CustomerEmails from "./components/CustomerEmails";
import CreateProducts from "./components/CreateProducts";

const APP_MENU_ITEMS = [
  { id: "explore-ideas", label: "Explore Ideas" },
  { id: "finalize-designs", label: "Finalize Designs" },
  { id: "test-design", label: "Test Design" },
  { id: "iterate", label: "Iterate" },
  { id: "training-data", label: "Training Data" },
  { id: "evaluation-tester", label: "Evaluation Test" },
  { id: "vertex-ai-optimizer", label: "Vertex AI Optimizer" },
  { type: "divider" },
  { id: "create-products", label: "Create Products" },
  { type: "divider" },
  { id: "prod-images", label: "Production Images" },
  { id: "customer-emails", label: "Customer Emails" },
];

function App() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [selectedPhotos, setSelectedPhotos] = useState([]);
  const [generatedPrompts, setGeneratedPrompts] = useState([]);
  const [results, setResults] = useState([]);
  const [currentApp, setCurrentApp] = useState("explore-ideas");
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    let isMounted = true;

    // Check for existing session with timeout and error handling
    const getSession = async () => {
      try {
        // Add timeout safety
        const timeoutPromise = new Promise((_, reject) =>
          setTimeout(() => reject(new Error("Session timeout")), 10000)
        );

        const sessionPromise = supabase.auth.getSession();
        const {
          data: { session },
        } = await Promise.race([sessionPromise, timeoutPromise]);

        if (isMounted) {
          setUser(session?.user ?? null);
          setLoading(false);
        }
      } catch (error) {
        console.error("Session error:", error);
        if (isMounted) {
          // Fallback: assume no user and stop loading
          setUser(null);
          setLoading(false);
        }
      }
    };

    getSession();

    // Listen for auth changes
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (isMounted) {
        setUser(session?.user ?? null);
        setLoading(false);
      }
    });

    return () => {
      isMounted = false;
      subscription?.unsubscribe();
    };
  }, []);

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    setUser(null);
    setSelectedPhotos([]);
    setGeneratedPrompts([]);
    setResults([]);
  };

  const renderCurrentApp = () => {
    switch (currentApp) {
      case "explore-ideas":
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
            <RightPanel results={results} setResults={setResults} />
          </>
        );
      case "finalize-designs":
        return <FinalizeDesigns />;
      case "test-design":
        return <TestDesign />;
      case "iterate":
        return <IteratePage />;
      case "evaluation-tester":
        return <EvaluationTester />;
      case "training-data":
        return <TrainingDataManager />;
      case "vertex-ai-optimizer":
        return <VertexAIOptimizer />;
      case "create-products":
        return <CreateProducts />;
      case "prod-images":
        return <ProdImages />;
      case "customer-emails":
        return <CustomerEmails />;
      default:
        return null;
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-100 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500 mx-auto mb-4"></div>
          <p className="text-gray-600">Loading...</p>
          <button
            onClick={() => {
              console.log("Manual reset triggered");
              setLoading(false);
              setUser(null);
            }}
            className="mt-4 px-4 py-2 bg-gray-500 text-white rounded hover:bg-gray-600"
          >
            Reset Loading State
          </button>
        </div>
      </div>
    );
  }

  if (!user) {
    return <Auth onAuthSuccess={setUser} />;
  }

  return (
    <div className="flex flex-col h-screen bg-gray-100">
      {/* Top Navigation Bar */}
      <div className="bg-white shadow-sm border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            {/* App Navigation Dropdown */}
            <div className="relative">
              <button
                onClick={() => setMenuOpen(!menuOpen)}
                className="flex items-center gap-2 px-4 py-2 bg-blue-100 text-blue-700 border border-blue-200 rounded-lg text-sm font-medium hover:bg-blue-50 transition-colors"
              >
                <span>{APP_MENU_ITEMS.find(item => item.id === currentApp)?.label || "Select Tool"}</span>
                <svg
                  className={`w-4 h-4 transition-transform ${menuOpen ? "rotate-180" : ""}`}
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </button>
              
              {menuOpen && (
                <>
                  {/* Backdrop to close menu when clicking outside */}
                  <div
                    className="fixed inset-0 z-10"
                    onClick={() => setMenuOpen(false)}
                  />
                  <div className="absolute left-0 top-full mt-1 w-56 bg-white border border-gray-200 rounded-lg shadow-lg z-20 py-1">
                    {APP_MENU_ITEMS.map((item, index) =>
                      item.type === "divider" ? (
                        <div key={`divider-${index}`} className="my-1 border-t border-gray-200" />
                      ) : (
                        <button
                          key={item.id}
                          onClick={() => {
                            setCurrentApp(item.id);
                            setMenuOpen(false);
                          }}
                          className={`w-full text-left px-4 py-2 text-sm transition-colors ${
                            currentApp === item.id
                              ? "bg-blue-50 text-blue-700 font-medium"
                              : "text-gray-700 hover:bg-gray-50"
                          }`}
                        >
                          {item.label}
                        </button>
                      )
                    )}
                  </div>
                </>
              )}
            </div>

            {/* User Info and Sign Out */}
            <div className="flex items-center gap-3">
              <span className="text-sm text-gray-600">
                {user?.email || "testing@vertexai.com"}
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
      <div className="flex flex-1 overflow-hidden">{renderCurrentApp()}</div>
    </div>
  );
}

export default App;
