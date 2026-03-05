import { useState } from "react";

// Normalize frame color for comparison: lowercase, strip hyphens/spaces
// Handles "Poster-Only" (Shopify) vs "Poster Only" (Printify) etc.
function normFC(fc) {
  return (fc || "").toLowerCase().replace(/[-\s]/g, "");
}

// Maps Printify variant ID → frame color from variant title.
// Uses known Shopify frame values to find the right segment (handles "18x24 / White" and "White / 8x10").
function buildVarFrameMap(variants, frameValues = []) {
  const knownFrames = frameValues.map((v) => v.toLowerCase().trim());
  const map = {};
  (variants || []).forEach((v) => {
    const parts = (v.title || "").split("/").map((p) => p.trim());
    const match = parts.find((p) => knownFrames.includes(p.toLowerCase()));
    map[v.id] = match || parts[0] || null;
  });
  return map;
}

export default function ConfirmUploadStep({ sessionData, onBack }) {
  const {
    shopifyProduct,
    shopifyProductNumericId,
    selectedMockups,
    approvedImages,
    productId,
    seedImageId,
    hexCodes,
    seedColor,
    printifyTemplate,
    frameValues,
    aiImageRecords,
    frameAliases,
  } = sessionData;

  const [status, setStatus] = useState("idle"); // idle | uploading | done | error
  const [errorMsg, setErrorMsg] = useState(null);
  const [shopifyAdminUrl, setShopifyAdminUrl] = useState(null);
  const [pickerVariantId, setPickerVariantId] = useState(null);
  const [uploadedImages, setUploadedImages] = useState([]);

  // Build variant ID → frame color map from the seed template's variants
  const templateVarMap = buildVarFrameMap(printifyTemplate?.variants || [], frameValues || []);

  // Seed product mockup images — filter by frame color so each frame variant gets the right image
  const allSeedMockups = (printifyTemplate?.images || []).map((img, i) => ({
    src: img.src,
    position: i,
    color: seedColor,
    printifyProductId: printifyTemplate?.id,
    frameColor: img.variant_ids?.[0] ? (templateVarMap[img.variant_ids[0]] || null) : null,
  }));

  const variants = shopifyProduct?.variants || [];

  // Build initial variant → mockup assignments (runs once on mount)
  const [variantAssignments, setVariantAssignments] = useState(() => {
    const map = {};
    variants.forEach((variant) => {
      const bgOption = variant.selectedOptions?.find((o) => /background.?color/i.test(o.name));
      const bgColor = bgOption?.value;
      const frameOption = variant.selectedOptions?.find((o) => /frame/i.test(o.name));
      const frameColor = frameOption?.value || null;
      const isSeed = bgColor === seedColor;
      const resolvedFrameColor = (frameAliases || {})[frameColor] || frameColor;

      const matchingMockups = isSeed
        ? allSeedMockups.filter((m) => normFC(m.frameColor) === normFC(resolvedFrameColor))
        : (selectedMockups || []).filter(
            (m) => m.color === bgColor && normFC(m.frameColor) === normFC(resolvedFrameColor)
          );
      map[variant.id] = matchingMockups;
    });
    return map;
  });

  // All available mockups for picker: selectedMockups + seed mockups + locally uploaded images
  const allAvailableMockups = (() => {
    const seen = new Set();
    const all = [];
    (selectedMockups || []).forEach((m) => {
      if (!seen.has(m.src)) { seen.add(m.src); all.push(m); }
    });
    allSeedMockups.forEach((m) => {
      if (!seen.has(m.src)) { seen.add(m.src); all.push(m); }
    });
    uploadedImages.forEach((m) => {
      if (!seen.has(m.src)) { seen.add(m.src); all.push(m); }
    });
    return all;
  })();

  const removeMockup = (variantId, src) => {
    setVariantAssignments((prev) => ({
      ...prev,
      [variantId]: (prev[variantId] || []).filter((m) => m.src !== src),
    }));
  };

  const addMockup = (variantId, mockup) => {
    setVariantAssignments((prev) => {
      const current = prev[variantId] || [];
      if (current.some((m) => m.src === mockup.src)) return prev;
      return { ...prev, [variantId]: [...current, mockup] };
    });
    setPickerVariantId(null);
  };

  const handlePickerUpload = (file) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      const dataUrl = e.target.result;
      const [header, data] = dataUrl.split(",");
      const mimeType = header.match(/:(.*?);/)?.[1] || "image/png";
      setUploadedImages((prev) => [
        ...prev,
        {
          src: dataUrl,          // temp data URL for preview
          imageBase64: data,
          mimeType,
          position: prev.length,
          color: "Uploaded",
          isLocalUpload: true,
          printifyProductId: null,
          frameColor: null,
        },
      ]);
    };
    reader.readAsDataURL(file);
  };

  const handleConfirm = async () => {
    setStatus("uploading");
    setErrorMsg(null);
    try {
      // Upload any locally-uploaded images to Supabase first to get public URLs
      const urlRemapping = {}; // dataUrl → publicUrl
      for (const mockups of Object.values(variantAssignments)) {
        for (const mockup of mockups) {
          if (mockup.isLocalUpload && !urlRemapping[mockup.src]) {
            const uploadRes = await fetch("http://localhost:3001/api/product-images/upload-image", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ imageBase64: mockup.imageBase64, mimeType: mockup.mimeType }),
            });
            if (!uploadRes.ok) throw new Error(await uploadRes.text());
            const { publicUrl } = await uploadRes.json();
            urlRemapping[mockup.src] = publicUrl;
          }
        }
      }

      // Build Shopify assignments from variantAssignments state (deduplicate by image src)
      const srcToVariantIds = {};
      Object.entries(variantAssignments).forEach(([variantId, mockups]) => {
        mockups.forEach((mockup) => {
          const resolvedSrc = urlRemapping[mockup.src] || mockup.src;
          if (!srcToVariantIds[resolvedSrc]) srcToVariantIds[resolvedSrc] = [];
          srcToVariantIds[resolvedSrc].push(variantId);
        });
      });

      const assignments = Object.entries(srcToVariantIds).map(([imageUrl, variantIds]) => ({
        imageUrl,
        variantIds,
      }));

      if (assignments.length > 0) {
        const shopifyRes = await fetch("http://localhost:3001/api/shopify/variant-images", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ productId: shopifyProductNumericId, assignments }),
        });
        if (!shopifyRes.ok) throw new Error(await shopifyRes.text());
      }

      // Save mockups to Supabase.
      // If aiImageRecords was already saved in step 3, pass it so save-results skips re-uploading.
      const saveRes = await fetch("http://localhost:3001/api/product-images/save-results", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          productId,
          seedImageId,
          aiImages: aiImageRecords
            ? null  // already saved in step 3
            : (approvedImages || []).map((img) => ({
                imageBase64: img.imageBase64,
                mimeType: img.mimeType,
                colorName: img.color,
                hexCode: hexCodes?.[img.color] || "",
                breed: img.breed,
                petName: img.petName,
              })),
          aiImageRecords: aiImageRecords || null,
          mockupImages: [
            ...(selectedMockups || []).map((m) => ({
              aiImageIndex: (approvedImages || []).findIndex((a) => a.color === m.color),
              printifyProductId: m.printifyProductId,
              position: m.position,
              src: m.src,
              variantAttributes: m.variantAttributes,
            })),
            ...allSeedMockups.map((m) => ({
              isSeedMockup: true,
              printifyProductId: printifyTemplate?.id,
              position: m.position,
              src: m.src,
              variantAttributes: null,
            })),
          ],
        }),
      });
      if (!saveRes.ok) throw new Error(await saveRes.text());

      setShopifyAdminUrl(
        `https://admin.shopify.com/store/instame-shop/products/${shopifyProductNumericId}`
      );
      setStatus("done");
    } catch (err) {
      setErrorMsg(err.message);
      setStatus("error");
    }
  };

  if (status === "done") {
    return (
      <div className="text-center py-16 space-y-4">
        <div className="text-5xl">🎉</div>
        <h2 className="text-xl font-semibold text-gray-800">All done!</h2>
        <p className="text-sm text-gray-500">
          Images saved to Supabase and uploaded to Shopify variants.
        </p>
        <a
          href={shopifyAdminUrl}
          target="_blank"
          rel="noreferrer"
          className="inline-block px-6 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700"
        >
          View Product in Shopify →
        </a>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <h2 className="text-xl font-semibold text-gray-800">Step 6 — Confirm & Upload</h2>
      <p className="text-sm text-gray-500">
        Review and adjust the mockup assignments below, then confirm to upload to Shopify and save to Supabase.
      </p>

      {/* Mapping table */}
      <div className="border border-gray-200 rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b border-gray-200">
            <tr>
              <th className="text-left px-4 py-2 text-xs font-semibold text-gray-600">
                Shopify Variant
              </th>
              <th className="text-left px-4 py-2 text-xs font-semibold text-gray-600">Images</th>
            </tr>
          </thead>
          <tbody>
            {variants.map((variant) => {
              const assignedMockups = variantAssignments[variant.id] || [];
              return (
                <tr key={variant.id} className="border-b border-gray-100 last:border-0">
                  <td className="px-4 py-3 text-gray-700 align-top pt-4">{variant.title}</td>
                  <td className="px-4 py-3">
                    <div className="flex gap-2 flex-wrap items-center">
                      {assignedMockups.map((m, i) => (
                        <div key={i} className="relative">
                          <img
                            src={m.src}
                            alt=""
                            className="w-12 h-12 object-cover rounded border border-gray-200"
                          />
                          {!m.isLocalUpload && (
                            <span className="absolute -top-1 -right-1 text-xs bg-blue-100 text-blue-600 rounded px-1 leading-tight">
                              P{m.position + 1}
                            </span>
                          )}
                          <button
                            onClick={() => removeMockup(variant.id, m.src)}
                            disabled={status === "uploading"}
                            title="Remove"
                            className="absolute -top-1.5 -left-1.5 w-4 h-4 bg-red-500 text-white rounded-full text-xs flex items-center justify-center leading-none hover:bg-red-600 disabled:opacity-40"
                          >
                            ×
                          </button>
                        </div>
                      ))}
                      {assignedMockups.length === 0 && (
                        <span className="text-gray-400 text-xs mr-1">No image assigned</span>
                      )}
                      <button
                        onClick={() =>
                          setPickerVariantId(pickerVariantId === variant.id ? null : variant.id)
                        }
                        disabled={status === "uploading"}
                        title="Add mockup"
                        className={`w-12 h-12 border-2 border-dashed rounded text-xl flex items-center justify-center transition-colors disabled:opacity-40 ${
                          pickerVariantId === variant.id
                            ? "border-blue-400 text-blue-500 bg-blue-50"
                            : "border-gray-300 text-gray-400 hover:border-blue-400 hover:text-blue-500"
                        }`}
                      >
                        +
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Mockup picker modal */}
      {pickerVariantId && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          onClick={() => setPickerVariantId(null)}
        >
          {/* Backdrop */}
          <div className="absolute inset-0 bg-black/50" />

          {/* Modal card */}
          <div
            className="relative bg-white rounded-2xl shadow-xl w-full max-w-lg p-5 space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-gray-800">
                Add to:{" "}
                <span className="text-blue-600">
                  {variants.find((v) => v.id === pickerVariantId)?.title}
                </span>
              </h3>
              <button
                onClick={() => setPickerVariantId(null)}
                className="text-gray-400 hover:text-gray-600 text-xl leading-none"
              >
                ×
              </button>
            </div>

            <div className="grid grid-cols-4 gap-3 max-h-96 overflow-y-auto">
              {/* Upload tile — always first */}
              <label className="relative rounded-xl border-2 border-dashed border-gray-300 aspect-square flex flex-col items-center justify-center gap-1 cursor-pointer hover:border-blue-400 hover:bg-blue-50 transition-colors text-gray-400 hover:text-blue-500">
                <span className="text-2xl leading-none">↑</span>
                <span className="text-xs font-medium">Upload</span>
                <input
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => handlePickerUpload(e.target.files[0])}
                />
              </label>

              {/* Existing + uploaded mockups */}
              {allAvailableMockups.map((m, i) => {
                const alreadyAdded = (variantAssignments[pickerVariantId] || []).some(
                  (a) => a.src === m.src
                );
                return (
                  <div
                    key={i}
                    onClick={() => !alreadyAdded && addMockup(pickerVariantId, m)}
                    className={`relative rounded-xl overflow-hidden border-2 transition-colors ${
                      alreadyAdded
                        ? "border-gray-200 opacity-50 cursor-not-allowed"
                        : "border-transparent cursor-pointer hover:border-blue-500"
                    }`}
                  >
                    <img src={m.src} alt="" className="w-full aspect-square object-cover" />
                    <div className="absolute bottom-0 left-0 right-0 bg-black/50 px-1.5 py-1">
                      <span className="text-white text-xs block truncate">
                        {m.isLocalUpload ? `Uploaded ${m.position + 1}` : `${m.color} · P${m.position + 1}`}
                      </span>
                    </div>
                    {alreadyAdded && (
                      <div className="absolute inset-0 flex items-center justify-center bg-black/20">
                        <span className="text-xs bg-green-600 text-white px-1.5 py-0.5 rounded-full">
                          ✓
                        </span>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {errorMsg && <p className="text-sm text-red-500">{errorMsg}</p>}

      <div className="flex justify-between">
        <button
          onClick={onBack}
          disabled={status === "uploading"}
          className="px-4 py-2 text-sm text-gray-600 hover:text-gray-900 disabled:opacity-40"
        >
          ← Back
        </button>
        <button
          onClick={handleConfirm}
          disabled={status === "uploading"}
          className="px-6 py-2 bg-green-600 text-white rounded-lg text-sm font-medium disabled:opacity-40 hover:bg-green-700"
        >
          {status === "uploading" ? "Uploading..." : "Confirm & Upload"}
        </button>
      </div>
    </div>
  );
}
