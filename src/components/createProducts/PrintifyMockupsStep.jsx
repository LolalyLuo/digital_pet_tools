import { useState, useEffect, useRef } from "react";

export default function PrintifyMockupsStep({ sessionData, updateSession, onNext, onBack }) {
  const { approvedImages, printifyTemplate, hexCodes } = sessionData;

  const [progress, setProgress] = useState(() =>
    (approvedImages || []).map((img) => ({
      color: img.color,
      status: "uploading",
      productId: null,
      images: [],
      error: null,
    }))
  );
  const [selectedMockups, setSelectedMockups] = useState(new Set());
  const initiated = useRef(false);

  const updateProgress = (color, updates) =>
    setProgress((prev) => prev.map((p) => (p.color === color ? { ...p, ...updates } : p)));

  useEffect(() => {
    if (initiated.current || !approvedImages?.length) return;
    initiated.current = true;

    approvedImages.forEach(async (img) => {
      try {
        // 1. Upload image to Printify
        const uploadRes = await fetch("http://localhost:3001/api/printify/upload-image", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            fileName: `design_${img.color.replace(/\s/g, "_")}_${Date.now()}.png`,
            imageBase64: img.imageBase64,
          }),
        });
        if (!uploadRes.ok) throw new Error(await uploadRes.text());
        const { id: uploadedImageId } = await uploadRes.json();

        updateProgress(img.color, { status: "creating" });

        // 2. Create Printify product using seed template
        const createRes = await fetch("http://localhost:3001/api/printify/create-product", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            template: printifyTemplate,
            uploadedImageId,
            customTitle: `${printifyTemplate.title} — ${img.color}`,
          }),
        });
        if (!createRes.ok) throw new Error(await createRes.text());
        const { product } = await createRes.json();

        updateProgress(img.color, {
          status: "done",
          productId: product.id,
          images: product.images || [],
        });
      } catch (err) {
        updateProgress(img.color, { status: "error", error: err.message });
      }
    });
  }, []);

  // Group mockup images by position index across all done products
  const positionGroups = (() => {
    const done = progress.filter((p) => p.status === "done");
    if (!done.length) return [];
    const maxLen = Math.max(...done.map((p) => p.images.length));
    const POSITION_LABELS = ["Front View", "Side/Tilted View", "Lifestyle View"];
    return Array.from({ length: maxLen }, (_, posIdx) => ({
      posIdx,
      label: POSITION_LABELS[posIdx] || `View ${posIdx + 1}`,
      entries: done
        .map((p) => ({ color: p.color, productId: p.productId, image: p.images[posIdx] || null }))
        .filter((e) => e.image),
    })).filter((g) => g.entries.length > 0);
  })();

  const allDone =
    progress.length > 0 && progress.every((p) => p.status === "done" || p.status === "error");

  const toggleMockup = (key) =>
    setSelectedMockups((prev) => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });

  const toggleRow = (group) => {
    const keys = group.entries.map((e) => `${e.productId}:${group.posIdx}`);
    const allSelected = keys.every((k) => selectedMockups.has(k));
    setSelectedMockups((prev) => {
      const next = new Set(prev);
      keys.forEach((k) => (allSelected ? next.delete(k) : next.add(k)));
      return next;
    });
  };

  const handleNext = () => {
    const selected = [];
    progress
      .filter((p) => p.status === "done")
      .forEach((p, colorIdx) => {
        p.images.forEach((img, posIdx) => {
          const key = `${p.productId}:${posIdx}`;
          if (selectedMockups.has(key)) {
            selected.push({
              aiImageIndex: colorIdx,
              printifyProductId: p.productId,
              position: posIdx,
              src: img.src,
              color: p.color,
              variantAttributes: { background_color: p.color },
            });
          }
        });
      });

    updateSession({
      printifyProducts: progress.filter((p) => p.status === "done"),
      selectedMockups: selected,
    });
    onNext();
  };

  return (
    <div className="space-y-6">
      <h2 className="text-xl font-semibold text-gray-800">Step 4 — Printify Mockups</h2>

      {/* Creation progress */}
      <div className="space-y-1">
        {progress.map((p) => (
          <div key={p.color} className="flex items-center gap-3 text-sm">
            <div
              className="w-4 h-4 rounded-full border border-gray-200 flex-shrink-0"
              style={{ backgroundColor: hexCodes?.[p.color] || "#ccc" }}
            />
            <span className="text-gray-700 w-36 truncate">{p.color}</span>
            {p.status === "uploading" && <span className="text-blue-500 text-xs">Uploading image...</span>}
            {p.status === "creating" && <span className="text-blue-500 text-xs">Creating Printify product...</span>}
            {p.status === "done" && (
              <span className="text-green-600 text-xs">✓ Done — {p.images.length} mockups</span>
            )}
            {p.status === "error" && <span className="text-red-500 text-xs">✗ {p.error}</span>}
          </div>
        ))}
      </div>

      {/* Mockup grid grouped by position */}
      {allDone &&
        positionGroups.map((group) => (
          <div key={group.posIdx} className="border border-gray-200 rounded-xl overflow-hidden">
            <div className="flex items-center justify-between px-4 py-2 bg-gray-50 border-b border-gray-200">
              <h3 className="text-sm font-semibold text-gray-700">{group.label}</h3>
              <button
                onClick={() => toggleRow(group)}
                className="text-xs text-blue-600 hover:underline"
              >
                {group.entries.every((e) => selectedMockups.has(`${e.productId}:${group.posIdx}`))
                  ? "Deselect all"
                  : "Select all"}
              </button>
            </div>
            <div className="grid grid-cols-4 gap-3 p-4">
              {group.entries.map((entry) => {
                const key = `${entry.productId}:${group.posIdx}`;
                const selected = selectedMockups.has(key);
                return (
                  <div
                    key={key}
                    onClick={() => toggleMockup(key)}
                    className={`relative cursor-pointer rounded-lg overflow-hidden border-2 transition-colors ${
                      selected ? "border-blue-500" : "border-transparent hover:border-gray-300"
                    }`}
                  >
                    <img
                      src={entry.image.src}
                      alt={entry.color}
                      className="w-full aspect-square object-cover"
                    />
                    {selected && (
                      <div className="absolute top-2 right-2 w-6 h-6 bg-blue-600 rounded-full flex items-center justify-center">
                        <span className="text-white text-xs font-bold">✓</span>
                      </div>
                    )}
                    <div className="absolute bottom-0 left-0 right-0 bg-black/40 px-2 py-1">
                      <span className="text-white text-xs truncate block">{entry.color}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ))}

      <div className="flex justify-between">
        <button onClick={onBack} className="px-4 py-2 text-sm text-gray-600 hover:text-gray-900">
          ← Back
        </button>
        <button
          onClick={handleNext}
          disabled={!allDone || selectedMockups.size === 0}
          className="px-6 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium disabled:opacity-40 disabled:cursor-not-allowed hover:bg-blue-700"
        >
          Next →
        </button>
      </div>
    </div>
  );
}
