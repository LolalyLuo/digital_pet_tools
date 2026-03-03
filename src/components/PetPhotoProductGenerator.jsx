import { useState, useEffect } from "react";
import { supabase } from "../utils/supabaseClient";

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

export default function PetPhotoProductGenerator() {
  // Existing photos from Supabase
  const [existingPhotos, setExistingPhotos] = useState([]); // [{id, url, file_name}]

  // Section 1: pet photos
  const [petPhotos, setPetPhotos] = useState([]); // [{id, file, dataUrl, petName}]

  // Section 2: prompt config
  const [availablePrompts, setAvailablePrompts] = useState([]);
  const [selectedPromptHandle, setSelectedPromptHandle] = useState("");
  const [promptText, setPromptText] = useState("");
  const [provider, setProvider] = useState("openai");
  const [aspectRatio, setAspectRatio] = useState("1024x1024");
  const [background, setBackground] = useState("opaque");
  const [needpetname, setNeedpetname] = useState(false);
  const [imageCount, setImageCount] = useState(3);

  // Section 3: generated images
  const [generatedImages, setGeneratedImages] = useState([]); // [{imageBase64, mimeType, selected}]
  const [isGenerating, setIsGenerating] = useState(false);
  const [generateError, setGenerateError] = useState(null);

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

    supabase
      .from("uploaded_photos")
      .select("*")
      .order("created_at", { ascending: false })
      .then(({ data, error }) => {
        if (error) return console.error("Failed to load photos:", error);
        setExistingPhotos(
          data.map((p) => ({
            ...p,
            url: supabase.storage.from("uploaded-photos").getPublicUrl(p.file_path).data.publicUrl,
          }))
        );
      });
  }, []);

  // When a prompt is selected from the dropdown, populate all fields
  const handlePromptSelect = (handle) => {
    setSelectedPromptHandle(handle);
    const p = availablePrompts.find((ap) => ap.handle === handle);
    if (!p) return;
    setPromptText(p.prompt);
    setProvider(p.provider);
    setAspectRatio(p.aspectratio);
    setBackground(p.background);
    setNeedpetname(p.needpetname);
  };

  // ── Section 1 helpers ──
  const handlePhotoFiles = (files) => {
    const newPhotos = Array.from(files).map((file) => ({
      id: crypto.randomUUID(),
      file,
      dataUrl: URL.createObjectURL(file),
      petName: "",
    }));
    setPetPhotos((prev) => [...prev, ...newPhotos]);
  };

  const removePhoto = (id) => {
    setPetPhotos((prev) => prev.filter((p) => p.id !== id));
  };

  const addExistingPhoto = async (photo) => {
    // Skip if already added
    if (petPhotos.some((p) => p.sourceId === photo.id)) return;
    try {
      const res = await fetch(photo.url);
      const blob = await res.blob();
      const file = new File([blob], photo.file_name, { type: blob.type || "image/jpeg" });
      setPetPhotos((prev) => [
        ...prev,
        { id: crypto.randomUUID(), sourceId: photo.id, file, dataUrl: photo.url, petName: "" },
      ]);
    } catch (err) {
      console.error("Failed to fetch existing photo:", err);
    }
  };

  const updatePetName = (id, name) => {
    setPetPhotos((prev) => prev.map((p) => p.id === id ? { ...p, petName: name } : p));
  };

  // ── Section 3 helpers ──
  const fileToBase64 = (file) =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result.split(",")[1]);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });

  const handleGenerate = async () => {
    if (!petPhotos.length || !promptText) return;
    setIsGenerating(true);
    setGenerateError(null);
    setGeneratedImages([]);

    try {
      const photos = await Promise.all(
        petPhotos.map(async (p) => ({
          base64: await fileToBase64(p.file),
          mimeType: p.file.type || "image/png",
          petName: p.petName,
        }))
      );

      const res = await fetch("http://localhost:3001/api/pet-photo-generator/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          photos,
          prompt: promptText,
          provider,
          size: aspectRatio,
          background,
          needpetname,
          count: imageCount,
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Generation failed");

      const images = data.results.map((r) => ({ ...r, selected: false }));

      // Show images immediately, then remove backgrounds in the background
      setGeneratedImages(images);
      setIsGenerating(false);

      if (background === "transparent") {
        for (let idx = 0; idx < images.length; idx++) {
          try {
            const img = images[idx];
            const bgRes = await fetch("http://localhost:3001/api/pet-photo-generator/remove-background", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ imageBase64: img.imageBase64, mimeType: img.mimeType }),
            });
            const bgData = await bgRes.json();
            if (bgRes.ok && bgData.imageBase64) {
              setGeneratedImages((prev) =>
                prev.map((p, i) => i === idx ? { ...p, imageBase64: bgData.imageBase64, mimeType: "image/png" } : p)
              );
            }
          } catch (e) {
            console.warn("BG removal failed for image", idx, e.message);
          }
        }
      }
    } catch (err) {
      setGenerateError(err.message);
    } finally {
      setIsGenerating(false);
    }
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
    // Match hex IDs in URLs like /product-details/69a729d6... or /editor/69a729d6...
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
    const selectedImages = generatedImages.filter((img) => img.selected);
    if (!selectedImages.length || !printifyTemplate) return;

    setIsCreating(true);
    setCreatedProducts([]);

    const petNames = petPhotos.map((p) => p.petName).filter(Boolean).join(", ");
    const promptName = availablePrompts.find((p) => p.handle === selectedPromptHandle)?.name || "custom";

    const results = [];

    for (let i = 0; i < selectedImages.length; i++) {
      const img = selectedImages[i];
      try {
        // 1. Upload image to Printify
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

        // 2. Create product in Manual shop
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
        console.log("Created Printify product:", productId, "in shop:", createdInShop, shopLabel);

        results.push({
          id: productId,
          title: customTitle,
          shopLabel,
          shopId: createdInShop,
        });
      } catch (err) {
        results.push({ error: err.message, index: i });
      }
    }

    setCreatedProducts(results);
    setIsCreating(false);
  };

  return (
    <div className="w-full overflow-y-auto">
    <div className="max-w-3xl mx-auto p-6 space-y-10">
      <h1 className="text-2xl font-bold">Pet Photo Product Generator</h1>

      {/* ── Section 1: Pet Photos ── */}
      <section>
        <h2 className="text-lg font-semibold mb-3">1. Pet Photos</h2>

        {/* Existing photos from Supabase */}
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
          onDrop={(e) => { e.preventDefault(); handlePhotoFiles(e.dataTransfer.files); }}
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
                >&times;</button>
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
                <option key={p.handle} value={p.handle}>{p.name}</option>
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
            <div>
              <label className="block text-sm font-medium mb-1">Model</label>
              <input
                type="text"
                value={provider}
                onChange={(e) => setProvider(e.target.value)}
                className="w-full border rounded px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Size</label>
              <input
                type="text"
                value={aspectRatio}
                onChange={(e) => setAspectRatio(e.target.value)}
                className="w-full border rounded px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Background</label>
              <input
                type="text"
                value={background}
                onChange={(e) => setBackground(e.target.value)}
                className="w-full border rounded px-3 py-2 text-sm"
              />
            </div>
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
            {isGenerating ? "Generating..." : generatedImages.length > 0 ? "Regenerate" : "Generate"}
          </button>
        </div>

        {generateError && (
          <p className="text-red-600 text-sm mb-4">{generateError}</p>
        )}

        {isGenerating && (
          <p className="text-gray-500 text-sm">Generating {imageCount} image{imageCount !== 1 ? "s" : ""}...</p>
        )}

        {generatedImages.length > 0 && (
          <div className="grid grid-cols-3 gap-4">
            {generatedImages.map((img, i) => (
              <div
                key={i}
                className={`relative rounded border-2 cursor-pointer transition-colors ${
                  img.selected ? "border-blue-500" : "border-transparent"
                }`}
                onClick={() => toggleSelect(i)}
              >
                <img
                  src={`data:${img.mimeType};base64,${img.imageBase64}`}
                  alt={`generated ${i + 1}`}
                  className="w-full rounded"
                />
                <div className="flex gap-1 mt-1">
                  <button
                    onClick={(e) => { e.stopPropagation(); toggleSelect(i); }}
                    className={`flex-1 text-xs py-1 rounded ${img.selected ? "bg-blue-500 text-white" : "bg-gray-100 text-gray-700"}`}
                  >
                    {img.selected ? "Selected" : "Select"}
                  </button>
                  <button
                    onClick={(e) => { e.stopPropagation(); downloadImage(img, i); }}
                    className="px-2 text-xs py-1 rounded bg-gray-100 text-gray-700 hover:bg-gray-200"
                  >
                    DL
                  </button>
                </div>
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
              <option key={s.id} value={s.id}>{s.label} ({s.id})</option>
            ))}
          </select>
        </div>

        <div className="flex gap-2 mb-4">
          <input
            type="text"
            placeholder="Paste Printify product URL or ID"
            value={printifyUrl}
            onChange={(e) => { setPrintifyUrl(e.target.value); setPrintifyTemplate(null); }}
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
            <p><span className="font-medium">Template:</span> {printifyTemplate.title}</p>
            <p><span className="font-medium">Blueprint:</span> {printifyTemplate.blueprint_id}</p>
            <p><span className="font-medium">Variants:</span> {printifyTemplate.variants?.length}</p>
            {printifyTemplate.shopId && (
              <p><span className="font-medium">Found in:</span> {PRINTIFY_SHOPS.find((s) => s.id === printifyTemplate.shopId)?.label || printifyTemplate.shopId}</p>
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
              : `Create Product${generatedImages.filter((i) => i.selected).length > 1 ? "s" : ""} in ${PRINTIFY_SHOPS.find((s) => s.id === targetShopId)?.label || "Shop"}`}
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
                  <span className="text-red-500">Image {p.index + 1}: {p.error}</span>
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
