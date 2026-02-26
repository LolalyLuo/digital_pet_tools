import { useState, useEffect, useRef } from "react";

function dataUrlToBase64(dataUrl) {
  const [header, data] = dataUrl.split(",");
  const mimeType = header.match(/:(.*?);/)?.[1] || "image/png";
  return { imageBase64: data, mimeType };
}

export default function GenerateImagesStep({ sessionData, updateSession, onNext, onBack }) {
  const { seedFileDataUrl, hexCodes, seedColor, bgColors } = sessionData;
  const nonSeedColors = (bgColors || []).filter((c) => c !== seedColor);

  const [cards, setCards] = useState(() =>
    nonSeedColors.map((color) => ({
      color,
      status: "pending",
      imageDataUrl: null,
      generatedBase64: null,
      generatedMimeType: null,
      breed: null,
      petName: null,
      error: null,
    }))
  );
  const [feedbackText, setFeedbackText] = useState({});
  const [showFeedback, setShowFeedback] = useState({});
  const initiated = useRef(false);

  const updateCard = (color, updates) =>
    setCards((prev) => prev.map((c) => (c.color === color ? { ...c, ...updates } : c)));

  const generateForColor = async (color, breed, petName, extraFeedback = "") => {
    updateCard(color, { status: "generating", error: null, breed, petName });
    try {
      const { imageBase64, mimeType } = dataUrlToBase64(seedFileDataUrl);
      const res = await fetch("http://localhost:3001/api/product-images/generate-variant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          seedImageBase64: imageBase64,
          seedImageMimeType: mimeType,
          backgroundColor: hexCodes[color],
          colorName: color,
          breed,
          petName,
          feedbackText: extraFeedback,
        }),
      });
      if (!res.ok) throw new Error(await res.text());
      const { imageBase64: outBase64, mimeType: outMime } = await res.json();
      updateCard(color, {
        status: "done",
        imageDataUrl: `data:${outMime};base64,${outBase64}`,
        generatedBase64: outBase64,
        generatedMimeType: outMime,
      });
    } catch (err) {
      updateCard(color, { status: "error", error: err.message });
    }
  };

  useEffect(() => {
    if (initiated.current || !seedFileDataUrl || nonSeedColors.length === 0) return;
    initiated.current = true;

    fetch("http://localhost:3001/api/product-images/breed-names", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ count: nonSeedColors.length, animalType: "pet" }),
    })
      .then((r) => r.json())
      .then(({ combos }) => {
        nonSeedColors.forEach((color, i) => {
          const breed = combos[i]?.breed || "Golden Retriever";
          const petName = combos[i]?.name || "Buddy";
          generateForColor(color, breed, petName);
        });
      })
      .catch(() => {
        nonSeedColors.forEach((color) => generateForColor(color, "Golden Retriever", "Buddy"));
      });
  }, []);

  const handleRegenerate = async (color) => {
    const card = cards.find((c) => c.color === color);
    if (!card) return;

    let breed = card.breed || "Golden Retriever";
    let petName = card.petName || "Buddy";

    try {
      const res = await fetch("http://localhost:3001/api/product-images/breed-names", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ count: 1, animalType: "pet" }),
      });
      if (res.ok) {
        const { combos } = await res.json();
        if (combos?.[0]) {
          breed = combos[0].breed;
          petName = combos[0].name;
        }
      }
    } catch {} // fall back to existing breed/name on error

    generateForColor(color, breed, petName, feedbackText[color] || "");
    setShowFeedback((prev) => ({ ...prev, [color]: false }));
    setFeedbackText((prev) => ({ ...prev, [color]: "" }));
  };

  const allDone = cards.length > 0 && cards.every((c) => c.status === "done");

  const handleNext = () => {
    updateSession({
      approvedImages: cards.map((c) => ({
        color: c.color,
        hexCode: hexCodes[c.color],
        breed: c.breed,
        petName: c.petName,
        imageBase64: c.generatedBase64,
        mimeType: c.generatedMimeType,
        imageDataUrl: c.imageDataUrl,
      })),
    });
    onNext();
  };

  return (
    <div className="space-y-6">
      <h2 className="text-xl font-semibold text-gray-800">Step 3 — Generate Images</h2>
      <p className="text-sm text-gray-500">
        Generating {nonSeedColors.length} image{nonSeedColors.length !== 1 ? "s" : ""} in parallel...
      </p>

      <div className="grid grid-cols-2 gap-4">
        {cards.map((card) => (
          <div key={card.color} className="border border-gray-200 rounded-xl overflow-hidden">
            <div className="flex items-center gap-2 px-4 py-2 bg-gray-50 border-b border-gray-200">
              <div
                className="w-4 h-4 rounded-full border border-gray-300 flex-shrink-0"
                style={{ backgroundColor: hexCodes?.[card.color] || "#ccc" }}
              />
              <span className="text-sm font-medium text-gray-700">{card.color}</span>
              {card.breed && (
                <span className="text-xs text-gray-400 ml-auto truncate">
                  {card.breed} · {card.petName}
                </span>
              )}
            </div>

            <div className="aspect-square bg-gray-100 flex items-center justify-center relative">
              {card.status === "generating" && (
                <div className="text-center">
                  <div className="animate-spin w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full mx-auto mb-2" />
                  <p className="text-xs text-gray-400">Generating...</p>
                </div>
              )}
              {card.status === "done" && card.imageDataUrl && (
                <img src={card.imageDataUrl} alt={card.color} className="w-full h-full object-contain" />
              )}
              {card.status === "error" && (
                <div className="text-center px-4">
                  <p className="text-xs text-red-500 mb-1">{card.error}</p>
                </div>
              )}
              {card.status === "pending" && (
                <p className="text-xs text-gray-400">Waiting...</p>
              )}
            </div>

            {(card.status === "done" || card.status === "error") && (
              <div className="px-4 py-2 border-t border-gray-100">
                {showFeedback[card.color] ? (
                  <div className="flex gap-2">
                    <input
                      type="text"
                      placeholder="Describe what to fix..."
                      value={feedbackText[card.color] || ""}
                      onChange={(e) =>
                        setFeedbackText((prev) => ({ ...prev, [card.color]: e.target.value }))
                      }
                      className="flex-1 text-xs border border-gray-300 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-blue-500"
                    />
                    <button
                      onClick={() => handleRegenerate(card.color)}
                      className="text-xs bg-blue-600 text-white px-3 py-1 rounded hover:bg-blue-700"
                    >
                      Go
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => setShowFeedback((prev) => ({ ...prev, [card.color]: true }))}
                    className="text-xs text-gray-500 hover:text-gray-700"
                  >
                    ↺ Regenerate
                  </button>
                )}
              </div>
            )}
          </div>
        ))}
      </div>

      <div className="flex justify-between">
        <button onClick={onBack} className="px-4 py-2 text-sm text-gray-600 hover:text-gray-900">← Back</button>
        <button
          onClick={handleNext}
          disabled={!allDone}
          className="px-6 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium disabled:opacity-40 disabled:cursor-not-allowed hover:bg-blue-700"
        >
          Approve & Continue →
        </button>
      </div>
    </div>
  );
}
