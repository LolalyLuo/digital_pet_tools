import { useState, useEffect } from "react";

export default function CompetitorScrapeStep({ updateSession, onNext }) {
  const [url, setUrl] = useState("");
  const [scraping, setScraping] = useState(false);
  const [scrapeError, setScrapeError] = useState(null);
  const [config, setConfig] = useState(null);
  const [rawVariants, setRawVariants] = useState([]);
  const [sourceInfo, setSourceInfo] = useState(null);
  const [metaobjects, setMetaobjects] = useState([]);
  const [selectedMetaobjects, setSelectedMetaobjects] = useState([]);
  const [numberOfPets, setNumberOfPets] = useState(1);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState(null);

  // Fetch available personalization metaobjects on mount
  useEffect(() => {
    fetch("http://localhost:3001/api/product-images/metaobjects")
      .then((r) => r.json())
      .then((data) => setMetaobjects(data.metaobjects || []))
      .catch(() => {});
  }, []);

  const handleScrape = async () => {
    if (!url.trim()) return;
    setScraping(true);
    setScrapeError(null);
    setConfig(null);
    try {
      const res = await fetch("http://localhost:3001/api/product-images/scrape-competitor", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: url.trim() }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Unknown error" }));
        throw new Error(err.error || `HTTP ${res.status}`);
      }
      const data = await res.json();
      setConfig(data.config);
      setRawVariants(data.rawVariants || []);
      setSourceInfo({ title: data.sourceTitle, vendor: data.sourceVendor });

      // Auto-select personalization metaobjects based on number of pets
      autoSelectMetaobjects(1);
    } catch (err) {
      setScrapeError(err.message);
    } finally {
      setScraping(false);
    }
  };

  const autoSelectMetaobjects = (petCount) => {
    // Select Upload Pet Photo + Pet Name fields matching the pet count
    const selected = [];
    for (let i = 1; i <= petCount; i++) {
      const suffix = i === 1 ? "" : ` ${i}`;
      const photoObj = metaobjects.find(
        (m) => m.label.toLowerCase() === `upload pet photo${suffix}`.toLowerCase()
      );
      const nameObj = metaobjects.find(
        (m) => m.label.toLowerCase() === `pet name${suffix}`.toLowerCase()
      );
      if (photoObj) selected.push(photoObj.id);
      if (nameObj) selected.push(nameObj.id);
    }
    setSelectedMetaobjects(selected);
  };

  const handlePetCountChange = (count) => {
    setNumberOfPets(count);
    autoSelectMetaobjects(count);
  };

  const updateConfig = (updates) => setConfig((prev) => ({ ...prev, ...updates }));

  const updateOption = (idx, updates) => {
    setConfig((prev) => ({
      ...prev,
      options: prev.options.map((o, i) => (i === idx ? { ...o, ...updates } : o)),
    }));
  };

  const removeOptionValue = (optIdx, value) => {
    setConfig((prev) => {
      const newOptions = prev.options.map((o, i) => {
        if (i !== optIdx) return o;
        const newValues = o.values.filter((v) => v !== value);
        const newColorMap = o.colorMap
          ? Object.fromEntries(Object.entries(o.colorMap).filter(([k]) => k !== value))
          : undefined;
        return { ...o, values: newValues, ...(newColorMap !== undefined ? { colorMap: newColorMap } : {}) };
      });
      return { ...prev, options: newOptions };
    });
  };

  const updateColorMap = (optIdx, colorName, hex) => {
    setConfig((prev) => {
      const newOptions = prev.options.map((o, i) => {
        if (i !== optIdx) return o;
        return { ...o, colorMap: { ...o.colorMap, [colorName]: hex } };
      });
      return { ...prev, options: newOptions };
    });
  };

  const updatePrice = (key1, key2, field, value) => {
    setConfig((prev) => {
      const newPrices = { ...prev.prices };
      if (key2 !== null) {
        newPrices[key1] = { ...newPrices[key1] };
        const existing = newPrices[key1][key2] || ["0.00", null];
        newPrices[key1][key2] = field === "price" ? [value, existing[1]] : [existing[0], value];
      } else {
        const existing = newPrices[key1] || ["0.00", null];
        newPrices[key1] = field === "price" ? [value, existing[1]] : [existing[0], value];
      }
      return { ...prev, prices: newPrices };
    });
  };

  const toggleMetaobject = (id) => {
    setSelectedMetaobjects((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  };

  const handleCreate = async () => {
    setCreating(true);
    setCreateError(null);
    try {
      const finalConfig = {
        ...config,
        personalizationGIDs: selectedMetaobjects,
      };

      const res = await fetch("http://localhost:3001/api/product-images/create-from-scrape", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ config: finalConfig }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Unknown error" }));
        throw new Error(err.error || `HTTP ${res.status}`);
      }
      const data = await res.json();

      // Pass created product data to session so InputsStep can auto-fill
      updateSession({
        createdFromScrape: true,
        shopifyProductId: data.shopifyProductId,
        shopifyProductNumericId: data.shopifyProductNumericId,
        adminUrl: data.adminUrl,
        supabaseProductId: data.supabaseProductId,
        scrapeConfig: finalConfig,
        numberOfPets,
      });
      onNext();
    } catch (err) {
      setCreateError(err.message);
    } finally {
      setCreating(false);
    }
  };

  // Render price editor
  const renderPriceTable = () => {
    if (!config?.prices) return null;
    const entries = [];

    for (const [key1, val] of Object.entries(config.prices)) {
      if (Array.isArray(val)) {
        entries.push({ key1, key2: null, price: val[0], compareAt: val[1] });
      } else if (typeof val === "object") {
        for (const [key2, priceArr] of Object.entries(val)) {
          entries.push({
            key1,
            key2,
            price: priceArr[0],
            compareAt: priceArr[1],
          });
        }
      }
    }

    if (entries.length === 0) return null;

    return (
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">Prices</label>
        <div className="border border-gray-200 rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-3 py-2 text-left text-gray-600 font-medium">Variant</th>
                <th className="px-3 py-2 text-left text-gray-600 font-medium w-28">Price</th>
                <th className="px-3 py-2 text-left text-gray-600 font-medium w-28">Compare At</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((e, i) => (
                <tr key={i} className="border-t border-gray-100">
                  <td className="px-3 py-1.5 text-gray-700">
                    {e.key2 ? `${e.key1} / ${e.key2}` : e.key1}
                  </td>
                  <td className="px-3 py-1.5">
                    <input
                      type="text"
                      value={e.price || ""}
                      onChange={(ev) => updatePrice(e.key1, e.key2, "price", ev.target.value)}
                      className="w-full border border-gray-300 rounded px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
                    />
                  </td>
                  <td className="px-3 py-1.5">
                    <input
                      type="text"
                      value={e.compareAt || ""}
                      onChange={(ev) => updatePrice(e.key1, e.key2, "compareAt", ev.target.value)}
                      className="w-full border border-gray-300 rounded px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-6">
      <h2 className="text-xl font-semibold text-gray-800">Step 1 — Scrape Competitor Product</h2>

      {/* URL Input */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">
          Competitor Product URL (Shopify store)
        </label>
        <div className="flex gap-2">
          <input
            type="text"
            placeholder="https://competitor-store.com/products/custom-pet-portrait"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleScrape()}
            className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <button
            onClick={handleScrape}
            disabled={scraping || !url.trim()}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium disabled:opacity-40 hover:bg-blue-700"
          >
            {scraping ? "Scraping..." : "Scrape"}
          </button>
        </div>
        {scrapeError && <p className="text-sm text-red-500 mt-1">{scrapeError}</p>}
      </div>

      {/* Scraped Data Editor */}
      {config && (
        <div className="space-y-6 border-t border-gray-200 pt-6">
          {sourceInfo && (
            <p className="text-xs text-gray-400">
              Source: {sourceInfo.title} by {sourceInfo.vendor}
            </p>
          )}

          {/* Title */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Title</label>
            <input
              type="text"
              value={config.title}
              onChange={(e) => updateConfig({ title: e.target.value })}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          {/* Product Type */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Product Type</label>
            <input
              type="text"
              value={config.productType}
              onChange={(e) => updateConfig({ productType: e.target.value })}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          {/* Description */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Description HTML</label>
            <textarea
              value={config.descriptionHtml}
              onChange={(e) => updateConfig({ descriptionHtml: e.target.value })}
              rows={6}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          {/* Options */}
          <div className="space-y-4">
            <label className="block text-sm font-medium text-gray-700">Options</label>
            {config.options.map((opt, optIdx) => (
              <div key={optIdx} className="border border-gray-200 rounded-lg p-4">
                <div className="flex items-center gap-2 mb-3">
                  <input
                    type="text"
                    value={opt.name}
                    onChange={(e) => updateOption(optIdx, { name: e.target.value })}
                    className="font-medium text-sm border border-gray-300 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  />
                </div>
                <div className="flex flex-wrap gap-2">
                  {opt.values.map((val) => (
                    <div key={val} className="flex items-center gap-1 bg-gray-100 rounded-full px-3 py-1">
                      {opt.colorMap !== undefined && (
                        <input
                          type="color"
                          value={opt.colorMap[val] || "#cccccc"}
                          onChange={(e) => updateColorMap(optIdx, val, e.target.value)}
                          className="w-5 h-5 rounded-full border border-gray-300 cursor-pointer p-0"
                        />
                      )}
                      <span className="text-sm text-gray-700">{val}</span>
                      {opt.colorMap?.[val] && (
                        <span className="text-xs text-gray-400 ml-1">{opt.colorMap[val]}</span>
                      )}
                      <button
                        onClick={() => removeOptionValue(optIdx, val)}
                        className="text-gray-400 hover:text-red-500 ml-1 text-xs"
                        title="Remove"
                      >
                        x
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>

          {/* Prices */}
          {renderPriceTable()}

          {/* Number of Pets */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Number of Pets</label>
            <div className="flex items-center gap-2">
              {[1, 2, 3, 4, 5].map((n) => (
                <button
                  key={n}
                  onClick={() => handlePetCountChange(n)}
                  className={`w-10 h-10 rounded-lg text-sm font-medium border-2 transition-colors ${
                    numberOfPets === n
                      ? "border-blue-600 bg-blue-50 text-blue-700"
                      : "border-gray-200 bg-white text-gray-600 hover:border-gray-300"
                  }`}
                >
                  {n}
                </button>
              ))}
            </div>
          </div>

          {/* Personalization Fields */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Personalization Fields
            </label>
            {metaobjects.length === 0 ? (
              <p className="text-xs text-gray-400">Loading metaobjects...</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {metaobjects.map((m) => (
                  <button
                    key={m.id}
                    onClick={() => toggleMetaobject(m.id)}
                    className={`px-3 py-1.5 rounded-full text-sm border transition-colors ${
                      selectedMetaobjects.includes(m.id)
                        ? "border-blue-500 bg-blue-50 text-blue-700"
                        : "border-gray-200 bg-white text-gray-600 hover:border-gray-300"
                    }`}
                  >
                    {m.label}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Create Button */}
          {createError && <p className="text-sm text-red-500">{createError}</p>}
          <div className="flex justify-end">
            <button
              onClick={handleCreate}
              disabled={creating || !config.title}
              className="px-6 py-2 bg-green-600 text-white rounded-lg text-sm font-medium disabled:opacity-40 hover:bg-green-700 transition-colors"
            >
              {creating ? "Creating Shopify Product..." : "Create Product & Continue"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
