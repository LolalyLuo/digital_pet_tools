import { useState } from "react";

// Normalize frame color for comparison: lowercase, strip hyphens/spaces
// Handles "Poster-Only" (Shopify) vs "Poster Only" (Printify) etc.
function normFC(fc) {
  return (fc || "").toLowerCase().replace(/[-\s]/g, "");
}

// Maps Printify variant ID → frame color from variant title (e.g. "Black / 8x10" → "Black")
function buildVarFrameMap(variants) {
  const map = {};
  (variants || []).forEach((v) => {
    const fc = v.title?.split("/")[0]?.trim() || null;
    if (fc) map[v.id] = fc;
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
  } = sessionData;

  const [status, setStatus] = useState("idle"); // idle | uploading | done | error
  const [errorMsg, setErrorMsg] = useState(null);
  const [shopifyAdminUrl, setShopifyAdminUrl] = useState(null);

  // Build variant ID → frame color map from the seed template's variants
  const templateVarMap = buildVarFrameMap(printifyTemplate?.variants || []);

  // Seed product mockup images — filter by frame color so each frame variant gets the right image
  const allSeedMockups = (printifyTemplate?.images || []).map((img, i) => ({
    src: img.src,
    position: i,
    color: seedColor,
    printifyProductId: printifyTemplate?.id,
    frameColor: img.variant_ids?.[0] ? (templateVarMap[img.variant_ids[0]] || null) : null,
  }));

  // Build variant → mockup mapping
  const variants = shopifyProduct?.variants || [];
  const mappingRows = variants.map((variant) => {
    const bgOption = variant.selectedOptions?.find((o) => /background.?color/i.test(o.name));
    const bgColor = bgOption?.value;
    const frameOption = variant.selectedOptions?.find((o) => /frame.?color/i.test(o.name));
    const frameColor = frameOption?.value || null;
    const isSeed = bgColor === seedColor;

    const matchingMockups = isSeed
      ? allSeedMockups.filter((m) => normFC(m.frameColor) === normFC(frameColor))
      : (selectedMockups || []).filter(
          (m) => m.color === bgColor && normFC(m.frameColor) === normFC(frameColor)
        );
    return { variant, bgColor, frameColor, matchingMockups };
  });

  const handleConfirm = async () => {
    setStatus("uploading");
    setErrorMsg(null);
    try {
      // Build Shopify assignments: deduplicate by image src
      const srcToVariantIds = {};
      mappingRows.forEach(({ variant, matchingMockups }) => {
        matchingMockups.forEach((mockup) => {
          if (!srcToVariantIds[mockup.src]) srcToVariantIds[mockup.src] = [];
          srcToVariantIds[mockup.src].push(variant.id);
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

      // Save AI images + mockups to Supabase
      const saveRes = await fetch("http://localhost:3001/api/product-images/save-results", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          productId,
          seedImageId,
          aiImages: (approvedImages || []).map((img) => ({
            imageBase64: img.imageBase64,
            mimeType: img.mimeType,
            colorName: img.color,
            hexCode: hexCodes?.[img.color] || "",
            breed: img.breed,
            petName: img.petName,
          })),
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
      <h2 className="text-xl font-semibold text-gray-800">Step 5 — Confirm & Upload</h2>
      <p className="text-sm text-gray-500">
        Review the mapping below, then confirm to upload to Shopify and save to Supabase.
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
            {mappingRows.map(({ variant, matchingMockups }) => (
              <tr key={variant.id} className="border-b border-gray-100 last:border-0">
                <td className="px-4 py-3 text-gray-700">{variant.title}</td>
                <td className="px-4 py-3">
                  {matchingMockups.length === 0 ? (
                    <span className="text-gray-400 text-xs">No image selected</span>
                  ) : (
                    <div className="flex gap-2 flex-wrap">
                      {matchingMockups.map((m, i) => (
                        <div key={i} className="relative">
                          <img
                            src={m.src}
                            alt=""
                            className="w-12 h-12 object-cover rounded border border-gray-200"
                          />
                          <span className="absolute -top-1 -right-1 text-xs bg-blue-100 text-blue-600 rounded px-1 leading-tight">
                            P{m.position + 1}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

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
