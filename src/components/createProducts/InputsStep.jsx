import { useState, useRef } from "react";

function StatusBadge({ status, label }) {
  if (status === "loading") return <span className="text-xs text-blue-500 ml-2">Checking...</span>;
  if (status === "ok") return <span className="text-xs text-green-600 ml-2">✓ {label}</span>;
  if (status === "error") return <span className="text-xs text-red-500 ml-2">✗ {label}</span>;
  return null;
}

export default function InputsStep({ sessionData, updateSession, onNext }) {
  const [seedFile, setSeedFile] = useState(null);
  const [seedPreview, setSeedPreview] = useState(null);
  const [shopifyUrl, setShopifyUrl] = useState("");
  const [printifyUrl, setPrintifyUrl] = useState("");
  const [shopifyStatus, setShopifyStatus] = useState(null); // null | "loading" | "ok" | "error"
  const [printifyStatus, setPrintifyStatus] = useState(null);
  const [shopifyLabel, setShopifyLabel] = useState("");
  const [printifyLabel, setPrintifyLabel] = useState("");
  const [shopifyData, setShopifyData] = useState(null);
  const [printifyData, setPrintifyData] = useState(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(null);
  const shopifyTimer = useRef(null);
  const printifyTimer = useRef(null);

  const handleSeedFile = (file) => {
    if (!file) return;
    setSeedFile(file);
    const reader = new FileReader();
    reader.onload = (e) => setSeedPreview(e.target.result);
    reader.readAsDataURL(file);
  };

  const extractShopifyId = (url) => {
    const match = url.match(/\/products\/(\d+)/);
    return match?.[1] || null;
  };

  const extractPrintifyId = (url) => {
    const match = url.match(/product-details\/([a-f0-9]+)/);
    return match?.[1] || null;
  };

  const fetchShopify = async (url) => {
    const id = extractShopifyId(url);
    if (!id) { setShopifyStatus("error"); setShopifyLabel("Invalid URL"); return; }
    setShopifyStatus("loading");
    try {
      const res = await fetch(`http://localhost:3001/api/shopify/product/${id}`);
      if (!res.ok) throw new Error("Not found");
      const data = await res.json();
      setShopifyData(data);
      setShopifyStatus("ok");
      setShopifyLabel(data.title);
    } catch {
      setShopifyStatus("error");
      setShopifyLabel("Could not fetch product");
    }
  };

  const fetchPrintify = async (url) => {
    const id = extractPrintifyId(url);
    if (!id) { setPrintifyStatus("error"); setPrintifyLabel("Invalid URL"); return; }
    setPrintifyStatus("loading");
    try {
      const res = await fetch(`http://localhost:3001/api/printify/product/${id}`);
      if (!res.ok) throw new Error("Not found");
      const data = await res.json();
      setPrintifyData(data);
      setPrintifyStatus("ok");
      setPrintifyLabel(data.title);
    } catch {
      setPrintifyStatus("error");
      setPrintifyLabel("Could not fetch product");
    }
  };

  const onShopifyChange = (val) => {
    setShopifyUrl(val);
    setShopifyStatus(null);
    clearTimeout(shopifyTimer.current);
    if (val.includes("admin.shopify.com")) {
      shopifyTimer.current = setTimeout(() => fetchShopify(val), 600);
    }
  };

  const onPrintifyChange = (val) => {
    setPrintifyUrl(val);
    setPrintifyStatus(null);
    clearTimeout(printifyTimer.current);
    if (val.includes("printify.com")) {
      printifyTimer.current = setTimeout(() => fetchPrintify(val), 600);
    }
  };

  const canNext = seedFile && shopifyStatus === "ok" && printifyStatus === "ok" && !saving;

  const handleNext = async () => {
    setSaving(true);
    setSaveError(null);
    try {
      const formData = new FormData();
      formData.append("seedImage", seedFile);
      formData.append("shopifyProductId", shopifyData.id);
      formData.append("shopifyProductTitle", shopifyData.title);

      const res = await fetch("http://localhost:3001/api/product-images/init", {
        method: "POST",
        body: formData,
      });
      if (!res.ok) throw new Error(await res.text());
      const { productId, seedImageId, seedImageUrl } = await res.json();

      updateSession({
        productId,
        seedImageId,
        seedImageUrl,
        seedFileDataUrl: seedPreview,
        shopifyProduct: shopifyData,
        printifyTemplate: printifyData,
        shopifyProductNumericId: extractShopifyId(shopifyUrl),
        printifyProductId: extractPrintifyId(printifyUrl),
      });
      onNext();
    } catch (err) {
      setSaveError(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-8">
      <h2 className="text-xl font-semibold text-gray-800">Step 1 — Inputs</h2>

      {/* Seed Image */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">Seed AI Image</label>
        <div
          className="border-2 border-dashed border-gray-300 rounded-lg p-6 text-center cursor-pointer hover:border-blue-400 transition-colors"
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => { e.preventDefault(); handleSeedFile(e.dataTransfer.files[0]); }}
          onClick={() => document.getElementById("seed-file-input").click()}
        >
          {seedPreview ? (
            <img src={seedPreview} alt="Seed" className="max-h-48 mx-auto rounded-lg object-contain" />
          ) : (
            <p className="text-gray-400 text-sm">Drag & drop seed image or click to select</p>
          )}
        </div>
        <input id="seed-file-input" type="file" accept="image/*" className="hidden"
          onChange={(e) => handleSeedFile(e.target.files[0])} />
      </div>

      {/* Shopify URL */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">
          Shopify Product URL
          <StatusBadge status={shopifyStatus} label={shopifyLabel} />
        </label>
        <input
          type="text"
          placeholder="https://admin.shopify.com/store/instame-shop/products/7717360238697"
          value={shopifyUrl}
          onChange={(e) => onShopifyChange(e.target.value)}
          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      </div>

      {/* Printify URL */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">
          Printify Product URL (seed design)
          <StatusBadge status={printifyStatus} label={printifyLabel} />
        </label>
        <input
          type="text"
          placeholder="https://printify.com/app/product-details/699f91fcf38bdbd36701b743"
          value={printifyUrl}
          onChange={(e) => onPrintifyChange(e.target.value)}
          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      </div>

      {saveError && <p className="text-sm text-red-500">{saveError}</p>}

      <div className="flex justify-end">
        <button
          onClick={handleNext}
          disabled={!canNext}
          className="px-6 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium disabled:opacity-40 disabled:cursor-not-allowed hover:bg-blue-700 transition-colors"
        >
          {saving ? "Saving..." : "Next →"}
        </button>
      </div>
    </div>
  );
}
