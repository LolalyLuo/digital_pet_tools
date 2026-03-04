import { useState, useEffect, useRef } from "react";

function dataUrlToBase64(dataUrl) {
  const [header, data] = dataUrl.split(",");
  const mimeType = header.match(/:(.*?);/)?.[1] || "image/png";
  return { imageBase64: data, mimeType };
}

export default function GenerateImagesStep({ sessionData, updateSession, onNext, onBack }) {
  const { seedFileDataUrl, hexCodes, seedColor, bgColors, numberOfPets = 1 } = sessionData;
  const nonSeedColors = (bgColors || []).filter((c) => c !== seedColor);

  const [cards, setCards] = useState(() =>
    nonSeedColors.map((color) => ({
      color,
      status: "pending",
      imageDataUrl: null,
      generatedBase64: null,
      generatedMimeType: null,
      breeds: [], // array of breeds (length = numberOfPets)
      petNames: [], // array of names (length = numberOfPets)
      error: null,
    }))
  );
  const [feedbackText, setFeedbackText] = useState({});
  const [showFeedback, setShowFeedback] = useState({});
  const initiated = useRef(false);

  const updateCard = (color, updates) =>
    setCards((prev) => prev.map((c) => (c.color === color ? { ...c, ...updates } : c)));

  const generateForColor = async (color, breeds, petNames, extraFeedback = "", sourceBase64 = null, sourceMimeType = null, refineMode = false) => {
    updateCard(color, { status: "generating", error: null, ...(refineMode ? {} : { breeds, petNames }) });
    try {
      const seed = sourceBase64
        ? { imageBase64: sourceBase64, mimeType: sourceMimeType }
        : dataUrlToBase64(seedFileDataUrl);
      const res = await fetch("http://localhost:3001/api/product-images/generate-variant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          seedImageBase64: seed.imageBase64,
          seedImageMimeType: seed.mimeType,
          backgroundColor: hexCodes[color],
          colorName: color,
          breeds,
          petNames,
          numberOfPets,
          feedbackText: extraFeedback,
          refineMode,
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

    const totalPets = nonSeedColors.length * numberOfPets;

    fetch("http://localhost:3001/api/product-images/breed-names", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ count: totalPets, animalType: "pet" }),
    })
      .then((r) => r.json())
      .then(({ combos }) => {
        nonSeedColors.forEach((color, i) => {
          const startIdx = i * numberOfPets;
          const colorCombos = combos.slice(startIdx, startIdx + numberOfPets);
          const breeds = colorCombos.map((c) => c?.breed || "Golden Retriever");
          const petNames = colorCombos.map((c) => c?.name || "Buddy");
          generateForColor(color, breeds, petNames);
        });
      })
      .catch(() => {
        const defaultBreeds = Array(numberOfPets).fill("Golden Retriever");
        const defaultNames = Array(numberOfPets).fill("Buddy");
        nonSeedColors.forEach((color) => generateForColor(color, defaultBreeds, defaultNames));
      });
  }, []);

  const handleUpload = (color, file) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      const { imageBase64, mimeType } = dataUrlToBase64(e.target.result);
      updateCard(color, {
        status: "done",
        imageDataUrl: e.target.result,
        generatedBase64: imageBase64,
        generatedMimeType: mimeType,
        error: null,
      });
    };
    reader.readAsDataURL(file);
  };

  const handleRegenerate = (color) => {
    const card = cards.find((c) => c.color === color);
    if (!card) return;

    const feedback = feedbackText[color] || "";
    const hasFeedback = feedback.trim().length > 0;

    if (hasFeedback && card.generatedBase64) {
      generateForColor(color, card.breeds, card.petNames, feedback, card.generatedBase64, card.generatedMimeType, true);
    } else {
      const fallbackBreeds = card.breeds.length ? card.breeds : Array(numberOfPets).fill("Golden Retriever");
      const fallbackNames = card.petNames.length ? card.petNames : Array(numberOfPets).fill("Buddy");
      generateForColor(color, fallbackBreeds, fallbackNames, feedback);
    }

    setShowFeedback((prev) => ({ ...prev, [color]: false }));
    setFeedbackText((prev) => ({ ...prev, [color]: "" }));
  };

  const allDone = cards.length > 0 && cards.every((c) => c.status === "done");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(null);

  const handleNext = async () => {
    setSaving(true);
    setSaveError(null);
    const approvedImages = cards.map((c) => ({
      color: c.color,
      hexCode: hexCodes[c.color],
      breeds: c.breeds,
      petNames: c.petNames,
      // Keep single-value aliases for downstream compatibility
      breed: c.breeds[0],
      petName: c.petNames[0],
      imageBase64: c.generatedBase64,
      mimeType: c.generatedMimeType,
      imageDataUrl: c.imageDataUrl,
    }));

    let aiImageRecords = null;
    try {
      const res = await fetch("http://localhost:3001/api/product-images/save-ai-images", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          productId: sessionData.productId,
          seedImageId: sessionData.seedImageId,
          aiImages: approvedImages.map((img) => ({
            imageBase64: img.imageBase64,
            mimeType: img.mimeType,
            colorName: img.color,
            hexCode: img.hexCode,
            breeds: img.breeds,
            petNames: img.petNames,
            breed: img.breed,
            petName: img.petName,
          })),
        }),
      });
      if (res.ok) {
        ({ aiImageRecords } = await res.json());
      } else {
        console.warn("save-ai-images failed:", await res.text());
      }
    } catch (err) {
      console.warn("save-ai-images error:", err.message);
    }

    updateSession({ approvedImages, aiImageRecords });
    setSaving(false);
    onNext();
  };

  const formatPetInfo = (breeds, petNames) => {
    if (!breeds?.length) return null;
    return breeds.map((b, i) => `${b} · ${petNames[i] || "?"}`).join("  |  ");
  };

  return (
    <div className="space-y-6">
      <h2 className="text-xl font-semibold text-gray-800">Step 3 — Generate Images</h2>
      <p className="text-sm text-gray-500">
        Generating {nonSeedColors.length} image{nonSeedColors.length !== 1 ? "s" : ""} in parallel
        {numberOfPets > 1 ? ` (${numberOfPets} pets each)` : ""}...
      </p>

      <div className="grid grid-cols-2 gap-4">
        {cards.map((card) => (
          <div key={card.color} className="border border-gray-200 rounded-xl overflow-hidden">
            <div className="px-4 py-2 bg-gray-50 border-b border-gray-200">
              <div className="flex items-center gap-2">
                <div
                  className="w-4 h-4 rounded-full border border-gray-300 flex-shrink-0"
                  style={{ backgroundColor: hexCodes?.[card.color] || "#ccc" }}
                />
                <span className="text-sm font-medium text-gray-700">{card.color}</span>
              </div>
              {card.breeds?.length > 0 && (
                <div className="text-xs text-gray-400 mt-1 truncate">
                  {formatPetInfo(card.breeds, card.petNames)}
                </div>
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

            {card.status !== "generating" && card.status !== "pending" && (
              <div className="px-4 py-2 border-t border-gray-100 space-y-2">
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
                  <div className="flex items-center gap-3">
                    <button
                      onClick={() => setShowFeedback((prev) => ({ ...prev, [card.color]: true }))}
                      className="text-xs text-gray-500 hover:text-gray-700"
                    >
                      ↺ Regenerate
                    </button>
                    <span className="text-gray-200">|</span>
                    <label className="text-xs text-gray-500 hover:text-gray-700 cursor-pointer">
                      ↑ Upload image
                      <input
                        type="file"
                        accept="image/*"
                        className="hidden"
                        onChange={(e) => handleUpload(card.color, e.target.files[0])}
                      />
                    </label>
                  </div>
                )}
              </div>
            )}
            {(card.status === "pending" || card.status === "generating") && (
              <div className="px-4 py-2 border-t border-gray-100">
                <label className="text-xs text-gray-400 hover:text-gray-600 cursor-pointer">
                  ↑ Upload instead
                  <input
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={(e) => handleUpload(card.color, e.target.files[0])}
                  />
                </label>
              </div>
            )}
          </div>
        ))}
      </div>

      <div className="flex justify-between">
        <button onClick={onBack} className="px-4 py-2 text-sm text-gray-600 hover:text-gray-900">← Back</button>
        {saveError && <p className="text-xs text-red-500">{saveError}</p>}
        <button
          onClick={handleNext}
          disabled={!allDone || saving}
          className="px-6 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium disabled:opacity-40 disabled:cursor-not-allowed hover:bg-blue-700"
        >
          {saving ? "Saving..." : "Approve & Continue →"}
        </button>
      </div>
    </div>
  );
}
