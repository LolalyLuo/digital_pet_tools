import { useState, useEffect } from "react";

const LS_SEED = "cpw_seed_color";
const LS_HEX = "cpw_hex_codes";
const LS_SIZE_SHARED = "cpw_size_shared";

function isBgColorOption(name) {
  return /background.?color/i.test(name);
}
function isSizeOption(name) {
  return /^size$/i.test(name);
}
function isFrameColorOption(name) {
  return /frame.?color/i.test(name);
}

export default function ConfigureVariantsStep({ sessionData, updateSession, onNext, onBack }) {
  const options = sessionData.shopifyProduct?.options || [];
  const bgOption = options.find((o) => isBgColorOption(o.name));
  const sizeOption = options.find((o) => isSizeOption(o.name));
  const frameOption = options.find((o) => isFrameColorOption(o.name));

  const initHexCodes = () => {
    try {
      const stored = JSON.parse(localStorage.getItem(LS_HEX) || "{}");
      if (bgOption) {
        const result = {};
        bgOption.values.forEach((v) => { result[v] = stored[v] || ""; });
        return result;
      }
    } catch {}
    return {};
  };

  const [hexCodes, setHexCodes] = useState(initHexCodes);
  const [seedColor, setSeedColor] = useState(() => localStorage.getItem(LS_SEED) || "");
  const [sizeShared, setSizeShared] = useState(() => {
    const stored = localStorage.getItem(LS_SIZE_SHARED);
    return stored === null ? true : stored === "true";
  });

  useEffect(() => { localStorage.setItem(LS_HEX, JSON.stringify(hexCodes)); }, [hexCodes]);
  useEffect(() => { if (seedColor) localStorage.setItem(LS_SEED, seedColor); }, [seedColor]);
  useEffect(() => { localStorage.setItem(LS_SIZE_SHARED, String(sizeShared)); }, [sizeShared]);

  const bgColors = bgOption?.values || [];
  const nonSeedColors = bgColors.filter((c) => c !== seedColor);
  const allHexesFilled = bgColors.every((c) => hexCodes[c]?.match(/^#[0-9a-fA-F]{6}$/));
  const canNext = !bgOption || (seedColor && allHexesFilled);

  const handleNext = () => {
    updateSession({
      bgColors,
      seedColor,
      hexCodes,
      sizeShared,
      sizeValues: sizeOption?.values || [],
      frameValues: frameOption?.values || [],
    });
    onNext();
  };

  return (
    <div className="space-y-8">
      <h2 className="text-xl font-semibold text-gray-800">Step 2 — Configure Variants</h2>

      {bgOption && (
        <section>
          <h3 className="text-sm font-semibold text-gray-700 mb-3">
            Background Color <span className="text-blue-500 text-xs font-normal">(design-driving)</span>
          </h3>
          <div className="space-y-3">
            {bgColors.map((color) => (
              <div key={color} className="flex items-center gap-3">
                <div
                  className="w-7 h-7 rounded-full border border-gray-200 flex-shrink-0"
                  style={{ backgroundColor: hexCodes[color] || "#cccccc" }}
                />
                <span className="text-sm text-gray-700 w-36 truncate">{color}</span>
                <input
                  type="text"
                  placeholder="#FFFFFF"
                  value={hexCodes[color] || ""}
                  onChange={(e) => setHexCodes((prev) => ({ ...prev, [color]: e.target.value }))}
                  className="w-28 border border-gray-300 rounded px-2 py-1 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
                <button
                  onClick={() => setSeedColor(color)}
                  className={`text-xs px-3 py-1 rounded-full border transition-colors ${
                    seedColor === color
                      ? "bg-blue-600 text-white border-blue-600"
                      : "border-gray-300 text-gray-500 hover:border-blue-400"
                  }`}
                >
                  {seedColor === color ? "✓ Seed" : "Set as Seed"}
                </button>
              </div>
            ))}
          </div>
          {seedColor && (
            <p className="text-xs text-gray-500 mt-3">
              Will generate <strong>{nonSeedColors.length}</strong> image{nonSeedColors.length !== 1 ? "s" : ""} ({bgColors.length} colors minus 1 seed)
            </p>
          )}
        </section>
      )}

      {sizeOption && (
        <section>
          <h3 className="text-sm font-semibold text-gray-700 mb-2">Sizes</h3>
          <div className="flex gap-2 mb-3">
            {sizeOption.values.map((s) => (
              <span key={s} className="text-xs bg-gray-100 text-gray-600 px-2 py-1 rounded">{s}</span>
            ))}
          </div>
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={sizeShared}
              onChange={(e) => setSizeShared(e.target.checked)}
              className="rounded"
            />
            <span className="text-sm text-gray-700">All sizes share the same image</span>
          </label>
          {!sizeShared && (
            <p className="text-xs text-yellow-600 mt-1">Each size will get its own Printify product and image.</p>
          )}
        </section>
      )}

      {frameOption && (
        <section>
          <h3 className="text-sm font-semibold text-gray-700 mb-2">
            Frame Color <span className="text-gray-400 text-xs font-normal">(Shopify/Printify variant only — shares AI image)</span>
          </h3>
          <div className="flex gap-2 flex-wrap">
            {frameOption.values.map((f) => (
              <span key={f} className="text-xs bg-gray-100 text-gray-600 px-2 py-1 rounded">{f}</span>
            ))}
          </div>
        </section>
      )}

      {!bgOption && !sizeOption && !frameOption && (
        <p className="text-sm text-gray-500">No recognized variant options found on this product.</p>
      )}

      <div className="flex justify-between">
        <button onClick={onBack} className="px-4 py-2 text-sm text-gray-600 hover:text-gray-900">← Back</button>
        <button
          onClick={handleNext}
          disabled={!canNext}
          className="px-6 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium disabled:opacity-40 disabled:cursor-not-allowed hover:bg-blue-700"
        >
          Next →
        </button>
      </div>
    </div>
  );
}
