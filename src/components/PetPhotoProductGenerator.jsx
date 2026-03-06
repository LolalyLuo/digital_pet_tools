import { useState, useEffect, useRef } from "react";

const PRINTIFY_SHOPS = [
  { id: "24261029", label: "InstaMe (Manual)" },
  { id: "24488950", label: "InstaMe V2 (Mother)" },
  { id: "24489195", label: "InstaMe V2 (Customer)" },
  { id: "26612298", label: "My Shopify Store" },
  { id: "24237495", label: "InstaMe" },
  { id: "24471428", label: "instame-2-adr" },
  { id: "26180670", label: "Etsy Customer Store" },
  { id: "26205430", label: "My Etsy Store" },
  { id: "26252347", label: "My TikTok Shop" },
];

const MODEL_OPTIONS = [
  { value: "openai", label: "OpenAI" },
  { value: "gemini", label: "Google Gemini" },
  { value: "seedream", label: "SeeDream" },
];

const SIZE_OPTIONS = [
  { value: "auto", label: "Auto" },
  { value: "1024x1024", label: "1024\u00d71024" },
  { value: "1024x1536", label: "1024\u00d71536" },
  { value: "1536x1024", label: "1536\u00d71024" },
  { value: "1440x2560", label: "1440\u00d72560" },
];

const BACKGROUND_OPTIONS = [
  { value: "opaque", label: "Opaque" },
  { value: "transparent", label: "Transparent" },
  { value: "auto", label: "Auto" },
];

export default function PetPhotoProductGenerator() {
  // Existing photos from Dragon DB
  const [existingPhotos, setExistingPhotos] = useState([]);

  // Section 1: pet photos
  const [petPhotos, setPetPhotos] = useState([]); // [{id, file, dataUrl, petName, dbId?}]

  // Section 2: prompt config
  const [availablePrompts, setAvailablePrompts] = useState([]);
  const [selectedPromptHandle, setSelectedPromptHandle] = useState("");
  const [promptText, setPromptText] = useState("");
  const [provider, setProvider] = useState("openai");
  const [customProvider, setCustomProvider] = useState("");
  const [aspectRatio, setAspectRatio] = useState("1024x1024");
  const [customSize, setCustomSize] = useState("");
  const [background, setBackground] = useState("opaque");
  const [customBackground, setCustomBackground] = useState("");
  const [needpetname, setNeedpetname] = useState(false);
  const [imageCount, setImageCount] = useState(3);

  // Section 3: generated images
  const [generatedImages, setGeneratedImages] = useState([]); // [{imageBase64, mimeType, selected, loading}]
  const [isGenerating, setIsGenerating] = useState(false);
  const [generateError, setGenerateError] = useState(null);
  const generatingRef = useRef(false);

  // Section 4: printify
  const [printifyUrl, setPrintifyUrl] = useState("");
  const [printifyTemplate, setPrintifyTemplate] = useState(null);
  const [isLoadingTemplate, setIsLoadingTemplate] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [createdProducts, setCreatedProducts] = useState([]);
  const [targetShopId, setTargetShopId] = useState("24261029");

  // Load prompts and existing photos on mount
  useEffect(() => {
    fetch("http://localhost:3001/api/shopify-v2/ai-prompts")
      .then((r) => r.json())
      .then((data) => setAvailablePrompts(data.prompts || []))
      .catch((err) => console.error("Failed to load prompts:", err));

    fetch("http://localhost:3001/api/pet-photo-generator/photos")
      .then((r) => r.json())
      .then((data) => setExistingPhotos(data.photos || []))
      .catch((err) => console.error("Failed to load photos:", err));
  }, []);

  // Resolved values (dropdown or custom)
  const resolvedProvider = provider === "__custom__" ? customProvider : provider;
  const resolvedSize = aspectRatio === "__custom__" ? customSize : aspectRatio;
  const resolvedBackground = background === "__custom__" ? customBackground : background;

  // When a prompt is selected from the dropdown, populate all fields
  const handlePromptSelect = (handle) => {
    setSelectedPromptHandle(handle);
    const p = availablePrompts.find((ap) => ap.handle === handle);
    if (!p) return;
    setPromptText(p.prompt);

    // Set provider — match to dropdown or use custom
    const matchingModel = MODEL_OPTIONS.find((o) => o.value === p.provider);
    if (matchingModel) {
      setProvider(p.provider);
    } else {
      setProvider("__custom__");
      setCustomProvider(p.provider);
    }

    // Set aspect ratio
    const matchingSize = SIZE_OPTIONS.find((o) => o.value === p.aspectratio);
    if (matchingSize) {
      setAspectRatio(p.aspectratio);
    } else {
      setAspectRatio("__custom__");
      setCustomSize(p.aspectratio);
    }

    // Set background
    const matchingBg = BACKGROUND_OPTIONS.find((o) => o.value === p.background);
    if (matchingBg) {
      setBackground(p.background);
    } else {
      setBackground("__custom__");
      setCustomBackground(p.background);
    }

    setNeedpetname(p.needpetname);
  };

  // ── Section 1 helpers ──
  const fileToBase64 = (file) =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result.split(",")[1]);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });

  const handlePhotoFiles = async (files) => {
    const newPhotos = [];
    for (const file of Array.from(files)) {
      const id = crypto.randomUUID();
      const dataUrl = URL.createObjectURL(file);
      newPhotos.push({ id, file, dataUrl, petName: "" });

      // Upload to Dragon DB in background
      try {
        const base64 = await fileToBase64(file);
        const res = await fetch("http://localhost:3001/api/pet-photo-generator/upload-photo", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ imageBase64: base64, fileName: file.name }),
        });
        const data = await res.json();
        if (res.ok) {
          setPetPhotos((prev) =>
            prev.map((p) => (p.id === id ? { ...p, dbId: data.id } : p))
          );
          // Refresh library
          setExistingPhotos((prev) => [
            { id: data.id, file_path: data.file_path, file_name: data.file_name, url: data.url },
            ...prev,
          ]);
        }
      } catch (err) {
        console.error("Failed to upload photo to DB:", err);
      }
    }
    setPetPhotos((prev) => [...prev, ...newPhotos]);
  };

  const removePhoto = (id) => {
    setPetPhotos((prev) => prev.filter((p) => p.id !== id));
  };

  const addExistingPhoto = async (photo) => {
    if (petPhotos.some((p) => p.sourceId === photo.id)) return;
    try {
      const res = await fetch(photo.url);
      const blob = await res.blob();
      const file = new File([blob], photo.file_name, { type: blob.type || "image/jpeg" });
      setPetPhotos((prev) => [
        ...prev,
        { id: crypto.randomUUID(), sourceId: photo.id, dbId: photo.id, file, dataUrl: photo.url, petName: "" },
      ]);
    } catch (err) {
      console.error("Failed to fetch existing photo:", err);
    }
  };

  const updatePetName = (id, name) => {
    setPetPhotos((prev) => prev.map((p) => (p.id === id ? { ...p, petName: name } : p)));
  };

  // ── Section 3: Parallel generation ──
  const handleGenerate = async () => {
    if (!petPhotos.length || !promptText) return;
    setIsGenerating(true);
    generatingRef.current = true;
    setGenerateError(null);

    // Initialize slots with loading placeholders
    const slots = Array.from({ length: imageCount }, () => ({
      imageBase64: null,
      mimeType: "image/png",
      selected: false,
      loading: true,
      error: null,
    }));
    setGeneratedImages(slots);

    // Prepare all photo data once
    let photos;
    try {
      photos = await Promise.all(
        petPhotos.map(async (p) => ({
          base64: await fileToBase64(p.file),
          mimeType: p.file.type || "image/png",
          petName: p.petName,
        }))
      );
    } catch (err) {
      setGenerateError("Failed to read photo files");
      setIsGenerating(false);
      generatingRef.current = false;
      return;
    }

    // Use the first photo's dbId for linking
    const photoId = petPhotos[0]?.dbId || null;

    // Fire all generation requests in parallel
    const promises = Array.from({ length: imageCount }, (_, idx) =>
      fetch("http://localhost:3001/api/pet-photo-generator/generate-one", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          photos,
          prompt: promptText,
          provider: resolvedProvider,
          size: resolvedSize,
          background: resolvedBackground,
          needpetname,
          photoId,
        }),
      })
        .then(async (res) => {
          const data = await res.json();
          if (!res.ok) throw new Error(data.error || "Generation failed");

          // Update this slot immediately
          setGeneratedImages((prev) =>
            prev.map((img, i) =>
              i === idx
                ? { imageBase64: data.imageBase64, mimeType: data.mimeType, selected: false, loading: false, error: null }
                : img
            )
          );

          // If transparent, remove background
          if (resolvedBackground === "transparent" && data.imageBase64) {
            try {
              const bgRes = await fetch("http://localhost:3001/api/pet-photo-generator/remove-background", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ imageBase64: data.imageBase64, mimeType: data.mimeType }),
              });
              const bgData = await bgRes.json();
              if (bgRes.ok && bgData.imageBase64) {
                setGeneratedImages((prev) =>
                  prev.map((img, i) =>
                    i === idx ? { ...img, imageBase64: bgData.imageBase64, mimeType: "image/png" } : img
                  )
                );
              }
            } catch (e) {
              console.warn("BG removal failed for image", idx, e.message);
            }
          }
        })
        .catch((err) => {
          setGeneratedImages((prev) =>
            prev.map((img, i) =>
              i === idx ? { ...img, loading: false, error: err.message } : img
            )
          );
        })
    );

    await Promise.allSettled(promises);
    setIsGenerating(false);
    generatingRef.current = false;
  };

  const toggleSelect = (index) => {
    setGeneratedImages((prev) =>
      prev.map((img, i) => (i === index ? { ...img, selected: !img.selected } : img))
    );
  };

  const downloadImage = (img, index) => {
    const link = document.createElement("a");
    link.href = `data:${img.mimeType};base64,${img.imageBase64}`;
    link.download = `pet-art-${index + 1}.png`;
    link.click();
  };

  // ── Section 4 helpers ──
  const extractPrintifyId = (urlOrId) => {
    const match = urlOrId.match(/\/([a-f0-9]{20,})/);
    return match ? match[1] : urlOrId.trim();
  };

  const handleLoadTemplate = async () => {
    const productId = extractPrintifyId(printifyUrl);
    if (!productId) return;

    setIsLoadingTemplate(true);
    setPrintifyTemplate(null);
    setCreatedProducts([]);

    try {
      const res = await fetch(`http://localhost:3001/api/printify/product/${productId}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to load product");
      setPrintifyTemplate(data);
    } catch (err) {
      alert("Failed to load Printify product: " + err.message);
    } finally {
      setIsLoadingTemplate(false);
    }
  };

  const handleCreateProducts = async () => {
    const selectedImages = generatedImages.filter((img) => img.selected && img.imageBase64);
    if (!selectedImages.length || !printifyTemplate) return;

    setIsCreating(true);
    setCreatedProducts([]);

    const petNames = petPhotos.map((p) => p.petName).filter(Boolean).join(", ");
    const promptName = availablePrompts.find((p) => p.handle === selectedPromptHandle)?.name || "custom";

    const results = [];

    for (let i = 0; i < selectedImages.length; i++) {
      const img = selectedImages[i];
      try {
        const uploadRes = await fetch("http://localhost:3001/api/printify/upload-image", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            fileName: `pet-art-${Date.now()}-${i}.png`,
            imageBase64: img.imageBase64,
          }),
        });
        const uploadData = await uploadRes.json();
        if (!uploadRes.ok) throw new Error(uploadData.error || "Upload failed");

        const customTitle = `${petNames || "Pet"} – ${promptName}${selectedImages.length > 1 ? ` (${i + 1})` : ""}`;
        const createRes = await fetch("http://localhost:3001/api/printify/create-product", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            template: printifyTemplate,
            uploadedImageId: uploadData.id,
            customTitle,
            shopId: targetShopId,
          }),
        });
        const createData = await createRes.json();
        if (!createRes.ok) throw new Error(createData.error || "Create failed");

        const productId = createData.product.id;
        const createdInShop = createData.shopId || targetShopId;
        const shopLabel = PRINTIFY_SHOPS.find((s) => s.id === createdInShop)?.label || createdInShop;

        results.push({ id: productId, title: customTitle, shopLabel, shopId: createdInShop });
      } catch (err) {
        results.push({ error: err.message, index: i });
      }
    }

    setCreatedProducts(results);
    setIsCreating(false);
  };

  // Dropdown with custom option component
  const SelectWithCustom = ({ label, value, onChange, customValue, onCustomChange, options }) => (
    <div>
      <label className="block text-sm font-medium mb-1">{label}</label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full border rounded px-3 py-2 text-sm"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
        <option value="__custom__">Custom...</option>
      </select>
      {value === "__custom__" && (
        <input
          type="text"
          value={customValue}
          onChange={(e) => onCustomChange(e.target.value)}
          placeholder="Enter custom value"
          className="w-full border rounded px-3 py-2 text-sm mt-1"
        />
      )}
    </div>
  );

  return (
    <div className="w-full overflow-y-auto">
      <div className="max-w-3xl mx-auto p-6 space-y-10">
        <h1 className="text-2xl font-bold">Printify Product Generator</h1>

        {/* ── Section 1: Pet Photos ── */}
        <section>
          <h2 className="text-lg font-semibold mb-3">1. Pet Photos</h2>
          <p className="text-xs text-gray-500 mb-2">
            Add multiple pets to merge them into one AI image.
          </p>

          {/* Existing photos from Dragon DB */}
          {existingPhotos.length > 0 && (
            <div className="mb-4">
              <p className="text-sm text-gray-500 mb-2">Click to add from your library:</p>
              <div className="flex gap-2 overflow-x-auto pb-2">
                {existingPhotos.map((photo) => {
                  const alreadyAdded = petPhotos.some((p) => p.sourceId === photo.id);
                  return (
                    <button
                      key={photo.id}
                      onClick={() => addExistingPhoto(photo)}
                      disabled={alreadyAdded}
                      className={`flex-shrink-0 w-20 h-20 rounded overflow-hidden border-2 transition-all ${
                        alreadyAdded
                          ? "border-blue-500 opacity-60"
                          : "border-transparent hover:border-blue-300"
                      }`}
                    >
                      <img src={photo.url} alt={photo.file_name} className="w-full h-full object-cover" />
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          <label
            className="flex flex-col items-center justify-center border-2 border-dashed border-gray-300 rounded-lg p-8 cursor-pointer hover:border-blue-400 transition-colors"
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              handlePhotoFiles(e.dataTransfer.files);
            }}
          >
            <span className="text-gray-500 text-sm">Drag & drop pet photos here, or click to select</span>
            <input
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              onChange={(e) => handlePhotoFiles(e.target.files)}
            />
          </label>

          {petPhotos.length > 0 && (
            <div className="mt-4 grid grid-cols-3 gap-4">
              {petPhotos.map((photo) => (
                <div key={photo.id} className="relative">
                  <button
                    onClick={() => removePhoto(photo.id)}
                    className="absolute top-1 right-1 bg-red-500 text-white rounded-full w-5 h-5 text-xs flex items-center justify-center z-10"
                  >
                    &times;
                  </button>
                  <img src={photo.dataUrl} alt="pet" className="w-full h-32 object-cover rounded" />
                  <input
                    type="text"
                    placeholder="Pet name"
                    value={photo.petName}
                    onChange={(e) => updatePetName(photo.id, e.target.value)}
                    className="mt-1 w-full text-sm border rounded px-2 py-1"
                  />
                </div>
              ))}
            </div>
          )}

          {petPhotos.length > 1 && (
            <p className="text-xs text-blue-600 mt-2">
              {petPhotos.length} pets selected — they will be merged into each generated image.
            </p>
          )}
        </section>

        {/* ── Section 2: Prompt Configuration ── */}
        <section>
          <h2 className="text-lg font-semibold mb-3">2. Prompt Configuration</h2>

          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium mb-1">Style</label>
              <select
                value={selectedPromptHandle}
                onChange={(e) => handlePromptSelect(e.target.value)}
                className="w-full border rounded px-3 py-2 text-sm"
              >
                <option value="">— select a prompt —</option>
                {availablePrompts.map((p) => (
                  <option key={p.handle} value={p.handle}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium mb-1">Prompt</label>
              <textarea
                rows={5}
                value={promptText}
                onChange={(e) => setPromptText(e.target.value)}
                className="w-full border rounded px-3 py-2 text-sm font-mono"
                placeholder="Select a style above or type a prompt..."
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <SelectWithCustom
                label="Model"
                value={provider}
                onChange={setProvider}
                customValue={customProvider}
                onCustomChange={setCustomProvider}
                options={MODEL_OPTIONS}
              />
              <SelectWithCustom
                label="Size"
                value={aspectRatio}
                onChange={setAspectRatio}
                customValue={customSize}
                onCustomChange={setCustomSize}
                options={SIZE_OPTIONS}
              />
              <SelectWithCustom
                label="Background"
                value={background}
                onChange={setBackground}
                customValue={customBackground}
                onCustomChange={setCustomBackground}
                options={BACKGROUND_OPTIONS}
              />
              <div>
                <label className="block text-sm font-medium mb-1">Image Count</label>
                <input
                  type="number"
                  min={1}
                  max={10}
                  value={imageCount}
                  onChange={(e) => setImageCount(Number(e.target.value))}
                  className="w-full border rounded px-3 py-2 text-sm"
                />
              </div>
            </div>

            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={needpetname}
                onChange={(e) => setNeedpetname(e.target.checked)}
              />
              Include pet name in image
            </label>
          </div>
        </section>

        {/* ── Section 3: Generate Images ── */}
        <section>
          <h2 className="text-lg font-semibold mb-3">3. Generate Images</h2>

          <div className="flex gap-3 mb-4">
            <button
              onClick={handleGenerate}
              disabled={isGenerating || !petPhotos.length || !promptText}
              className="px-4 py-2 bg-blue-600 text-white rounded font-medium disabled:opacity-50 hover:bg-blue-700"
            >
              {isGenerating
                ? `Generating (${generatedImages.filter((i) => !i.loading).length}/${imageCount})...`
                : generatedImages.length > 0
                ? "Regenerate"
                : "Generate"}
            </button>
          </div>

          {generateError && <p className="text-red-600 text-sm mb-4">{generateError}</p>}

          {generatedImages.length > 0 && (
            <div className="grid grid-cols-3 gap-4">
              {generatedImages.map((img, i) => (
                <div
                  key={i}
                  className={`relative rounded border-2 transition-colors ${
                    img.selected ? "border-blue-500" : "border-transparent"
                  } ${img.loading ? "" : "cursor-pointer"}`}
                  onClick={() => !img.loading && !img.error && toggleSelect(i)}
                >
                  {img.loading ? (
                    <div className="w-full aspect-square bg-gray-100 rounded flex items-center justify-center">
                      <div className="flex flex-col items-center gap-2">
                        <div className="w-8 h-8 border-3 border-blue-500 border-t-transparent rounded-full animate-spin" />
                        <span className="text-xs text-gray-400">Generating...</span>
                      </div>
                    </div>
                  ) : img.error ? (
                    <div className="w-full aspect-square bg-red-50 rounded flex items-center justify-center p-3">
                      <span className="text-xs text-red-500 text-center">{img.error}</span>
                    </div>
                  ) : (
                    <>
                      <img
                        src={`data:${img.mimeType};base64,${img.imageBase64}`}
                        alt={`generated ${i + 1}`}
                        className="w-full rounded"
                      />
                      <div className="flex gap-1 mt-1">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            toggleSelect(i);
                          }}
                          className={`flex-1 text-xs py-1 rounded ${
                            img.selected ? "bg-blue-500 text-white" : "bg-gray-100 text-gray-700"
                          }`}
                        >
                          {img.selected ? "Selected" : "Select"}
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            downloadImage(img, i);
                          }}
                          className="px-2 text-xs py-1 rounded bg-gray-100 text-gray-700 hover:bg-gray-200"
                        >
                          DL
                        </button>
                      </div>
                    </>
                  )}
                </div>
              ))}
            </div>
          )}
        </section>

        {/* ── Section 4: Printify Product ── */}
        <section>
          <h2 className="text-lg font-semibold mb-3">4. Printify Product</h2>

          <div className="mb-4">
            <label className="block text-sm font-medium mb-1">Target Shop</label>
            <select
              value={targetShopId}
              onChange={(e) => setTargetShopId(e.target.value)}
              className="w-full border rounded px-3 py-2 text-sm"
            >
              {PRINTIFY_SHOPS.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label} ({s.id})
                </option>
              ))}
            </select>
          </div>

          <div className="flex gap-2 mb-4">
            <input
              type="text"
              placeholder="Paste Printify product URL or ID"
              value={printifyUrl}
              onChange={(e) => {
                setPrintifyUrl(e.target.value);
                setPrintifyTemplate(null);
              }}
              className="flex-1 border rounded px-3 py-2 text-sm"
            />
            <button
              onClick={handleLoadTemplate}
              disabled={isLoadingTemplate || !printifyUrl}
              className="px-4 py-2 bg-gray-700 text-white rounded font-medium disabled:opacity-50 hover:bg-gray-800"
            >
              {isLoadingTemplate ? "Loading..." : "Load"}
            </button>
          </div>

          {printifyTemplate && (
            <div className="bg-gray-50 border rounded p-3 text-sm mb-4 space-y-1">
              <p>
                <span className="font-medium">Template:</span> {printifyTemplate.title}
              </p>
              <p>
                <span className="font-medium">Blueprint:</span> {printifyTemplate.blueprint_id}
              </p>
              <p>
                <span className="font-medium">Variants:</span> {printifyTemplate.variants?.length}
              </p>
              {printifyTemplate.shopId && (
                <p>
                  <span className="font-medium">Found in:</span>{" "}
                  {PRINTIFY_SHOPS.find((s) => s.id === printifyTemplate.shopId)?.label || printifyTemplate.shopId}
                </p>
              )}
            </div>
          )}

          {printifyTemplate && (
            <button
              onClick={handleCreateProducts}
              disabled={isCreating || !generatedImages.some((i) => i.selected)}
              className="px-4 py-2 bg-green-600 text-white rounded font-medium disabled:opacity-50 hover:bg-green-700"
            >
              {isCreating
                ? "Creating..."
                : `Create Product${generatedImages.filter((i) => i.selected).length > 1 ? "s" : ""} in ${
                    PRINTIFY_SHOPS.find((s) => s.id === targetShopId)?.label || "Shop"
                  }`}
            </button>
          )}

          {!generatedImages.some((i) => i.selected) && printifyTemplate && (
            <p className="text-xs text-gray-500 mt-2">Select at least one generated image above first.</p>
          )}

          {createdProducts.length > 0 && (
            <div className="mt-4 space-y-2">
              <p className="font-medium text-sm">Created Products:</p>
              {createdProducts.map((p, i) => (
                <div key={i} className="text-sm">
                  {p.error ? (
                    <span className="text-red-500">
                      Image {p.index + 1}: {p.error}
                    </span>
                  ) : (
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-green-600 font-medium">{p.title}</span>
                        <span className="text-gray-400">in {p.shopLabel}</span>
                      </div>
                      <a
                        href={`https://printify.com/app/product-details/${p.id}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-blue-600 hover:underline text-xs"
                      >
                        printify.com/app/product-details/{p.id} &rarr;
                      </a>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
