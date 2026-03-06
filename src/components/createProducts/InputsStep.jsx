import { useState, useRef, useEffect } from "react";
import { supabase } from "../../utils/supabaseClient";

function StatusBadge({ status, label }) {
  if (status === "loading") return <span className="text-xs text-blue-500 ml-2">Checking...</span>;
  if (status === "ok") return <span className="text-xs text-green-600 ml-2">✓ {label}</span>;
  if (status === "error") return <span className="text-xs text-red-500 ml-2">✗ {label}</span>;
  return null;
}

export default function InputsStep({ sessionData, updateSession, onNext, onBack }) {
  // Auto-fill from scrape step if available
  const fromScrape = sessionData?.createdFromScrape;
  const autoShopifyId = sessionData?.shopifyProductNumericId;
  const autoNumberOfPets = sessionData?.numberOfPets;

  const [seedFile, setSeedFile] = useState(null);
  const [seedPreview, setSeedPreview] = useState(null);
  const [numberOfPets, setNumberOfPets] = useState(autoNumberOfPets || 1);
  const [petPhotos, setPetPhotos] = useState([]); // [{file, preview}] — one per pet
  const [petPhotoPreviews, setPetPhotoPreviews] = useState([]); // data URLs for preview
  const [shopifyUrl, setShopifyUrl] = useState(
    fromScrape && autoShopifyId
      ? `https://admin.shopify.com/store/instame-shop/products/${autoShopifyId}`
      : ""
  );
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
  const autoFetched = useRef(false);

  // Auto-fetch Shopify product when coming from scrape step
  useEffect(() => {
    if (fromScrape && autoShopifyId && !autoFetched.current) {
      autoFetched.current = true;
      fetchShopify(`https://admin.shopify.com/store/instame-shop/products/${autoShopifyId}`);
    }
  }, [fromScrape, autoShopifyId]);

  const handleSeedFile = async (file) => {
    if (!file) return;
    setSeedFile(file);
    const reader = new FileReader();
    reader.onload = (e) => setSeedPreview(e.target.result);
    reader.readAsDataURL(file);

    // Also upload to uploaded_photos DB so the photo is available across the app
    try {
      const baseName = file.name.replace(/\.[^/.]+$/, "");
      const fileName = `${Date.now()}-${baseName}.jpg`;

      // Optimize image before uploading (same as LeftPanel)
      const optimized = await new Promise((resolve) => {
        const canvas = document.createElement("canvas");
        const ctx = canvas.getContext("2d");
        const img = new Image();
        img.onload = () => {
          const maxDim = 1200;
          let { width, height } = img;
          if (width > height) { if (width > maxDim) { height = (height * maxDim) / width; width = maxDim; } }
          else { if (height > maxDim) { width = (width * maxDim) / height; height = maxDim; } }
          canvas.width = width;
          canvas.height = height;
          ctx.imageSmoothingEnabled = true;
          ctx.imageSmoothingQuality = "high";
          ctx.drawImage(img, 0, 0, width, height);
          canvas.toBlob((blob) => resolve(new File([blob], file.name, { type: "image/jpeg" })), "image/jpeg", 0.85);
        };
        img.onerror = () => resolve(file);
        img.src = URL.createObjectURL(file);
      });

      await supabase.storage.from("uploaded-photos").upload(fileName, optimized, { contentType: "image/jpeg" });
      await supabase.from("uploaded_photos").insert({ file_path: fileName, file_name: `${baseName}.jpg` });
    } catch (err) {
      console.warn("Could not save seed photo to uploaded_photos:", err.message);
    }
  };

  const handlePetPhoto = async (index, file) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      setPetPhotoPreviews((prev) => {
        const next = [...prev];
        next[index] = e.target.result;
        return next;
      });
    };
    reader.readAsDataURL(file);
    setPetPhotos((prev) => {
      const next = [...prev];
      next[index] = file;
      return next;
    });

    // Also upload to uploaded_photos DB
    try {
      const baseName = file.name.replace(/\.[^/.]+$/, "");
      const fileName = `${Date.now()}-${baseName}.jpg`;
      const optimized = await new Promise((resolve) => {
        const canvas = document.createElement("canvas");
        const ctx = canvas.getContext("2d");
        const img = new Image();
        img.onload = () => {
          const maxDim = 1200;
          let { width, height } = img;
          if (width > height) { if (width > maxDim) { height = (height * maxDim) / width; width = maxDim; } }
          else { if (height > maxDim) { width = (width * maxDim) / height; height = maxDim; } }
          canvas.width = width;
          canvas.height = height;
          ctx.imageSmoothingEnabled = true;
          ctx.imageSmoothingQuality = "high";
          ctx.drawImage(img, 0, 0, width, height);
          canvas.toBlob((blob) => resolve(new File([blob], file.name, { type: "image/jpeg" })), "image/jpeg", 0.85);
        };
        img.onerror = () => resolve(file);
        img.src = URL.createObjectURL(file);
      });
      await supabase.storage.from("uploaded-photos").upload(fileName, optimized, { contentType: "image/jpeg" });
      await supabase.from("uploaded_photos").insert({ file_path: fileName, file_name: `${baseName}.jpg` });
    } catch (err) {
      console.warn("Could not save pet photo to uploaded_photos:", err.message);
    }
  };

  const removePetPhoto = (index) => {
    setPetPhotos((prev) => { const next = [...prev]; next[index] = undefined; return next; });
    setPetPhotoPreviews((prev) => { const next = [...prev]; next[index] = undefined; return next; });
  };

  const extractShopifyId = (url) => {
    const match = url.match(/\/products\/(\d+)/);
    return match?.[1] || null;
  };

  const extractPrintifyId = (url) => {
    const match = url.match(/product-details\/([a-f0-9-]+)/);
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

  // Pet photos are optional for 1 pet, but required for multi-pet
  const petPhotosReady = numberOfPets <= 1 || petPhotoPreviews.filter(Boolean).length === numberOfPets;
  const canNext = seedFile && shopifyStatus === "ok" && printifyStatus === "ok" && petPhotosReady && !saving;

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
        petPhotoDataUrls: petPhotoPreviews.filter(Boolean),
        numberOfPets,
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
      <h2 className="text-xl font-semibold text-gray-800">Step 2 — Inputs</h2>

      {/* Auto-filled notice */}
      {fromScrape && (
        <div className="bg-green-50 border border-green-200 rounded-lg px-4 py-3 text-sm text-green-700">
          Shopify product created from competitor scrape. URL auto-filled below.
          {sessionData.adminUrl && (
            <a
              href={sessionData.adminUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="ml-2 underline text-green-800"
            >
              View in Shopify
            </a>
          )}
        </div>
      )}

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

      {/* Number of Pets */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">Number of Pets</label>
        <div className="flex items-center gap-2">
          {[1, 2, 3, 4, 5].map((n) => (
            <button
              key={n}
              onClick={() => setNumberOfPets(n)}
              className={`w-10 h-10 rounded-lg text-sm font-medium border-2 transition-colors ${
                numberOfPets === n
                  ? "border-blue-600 bg-blue-50 text-blue-700"
                  : "border-gray-200 bg-white text-gray-600 hover:border-gray-300"
              }`}
            >
              {n}
            </button>
          ))}
          <span className="text-xs text-gray-400 ml-2">
            {numberOfPets === 1 ? "1 pet per image" : `${numberOfPets} pets per image`}
          </span>
        </div>
      </div>

      {/* Pet Reference Photos — shown when numberOfPets >= 2, optional for 1 */}
      {numberOfPets >= 1 && (
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Pet Reference Photos
            {numberOfPets >= 2 && <span className="text-red-400 ml-1">*</span>}
            <span className="text-xs text-gray-400 font-normal ml-2">
              {numberOfPets === 1 ? "(optional — helps AI match the real pet)" : `Upload ${numberOfPets} pet photos to combine`}
            </span>
          </label>
          <div className="grid grid-cols-5 gap-3">
            {Array.from({ length: numberOfPets }).map((_, i) => (
              <div key={i} className="relative">
                <div
                  className={`border-2 border-dashed rounded-lg aspect-square flex items-center justify-center cursor-pointer transition-colors overflow-hidden ${
                    petPhotoPreviews[i] ? "border-green-300 bg-green-50" : "border-gray-300 hover:border-blue-400"
                  }`}
                  onClick={() => document.getElementById(`pet-photo-${i}`).click()}
                >
                  {petPhotoPreviews[i] ? (
                    <img src={petPhotoPreviews[i]} alt={`Pet ${i + 1}`} className="w-full h-full object-cover" />
                  ) : (
                    <div className="text-center p-2">
                      <p className="text-gray-400 text-xs">Pet {i + 1}</p>
                    </div>
                  )}
                </div>
                {petPhotoPreviews[i] && (
                  <button
                    onClick={(e) => { e.stopPropagation(); removePetPhoto(i); }}
                    className="absolute -top-1 -right-1 w-5 h-5 bg-red-500 text-white rounded-full text-xs flex items-center justify-center hover:bg-red-600"
                  >
                    x
                  </button>
                )}
                <input
                  id={`pet-photo-${i}`}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => handlePetPhoto(i, e.target.files[0])}
                />
              </div>
            ))}
          </div>
        </div>
      )}

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

      <div className="flex justify-between">
        {onBack ? (
          <button onClick={onBack} className="px-4 py-2 text-sm text-gray-600 hover:text-gray-900">
            ← Back
          </button>
        ) : (
          <div />
        )}
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
