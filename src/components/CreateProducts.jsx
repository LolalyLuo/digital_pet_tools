import { useState } from "react";
import InputsStep from "./createProducts/InputsStep";
import ConfigureVariantsStep from "./createProducts/ConfigureVariantsStep";
import GenerateImagesStep from "./createProducts/GenerateImagesStep";
import PrintifyMockupsStep from "./createProducts/PrintifyMockupsStep";
import ConfirmUploadStep from "./createProducts/ConfirmUploadStep";

const STEPS = [
  { id: "inputs", label: "Inputs" },
  { id: "configure", label: "Configure Variants" },
  { id: "generate", label: "Generate Images" },
  { id: "mockups", label: "Printify Mockups" },
  { id: "confirm", label: "Confirm & Upload" },
];

function CreateProducts() {
  const [currentStep, setCurrentStep] = useState(0);
  const [sessionData, setSessionData] = useState({});

  const updateSession = (updates) =>
    setSessionData((prev) => ({ ...prev, ...updates }));

  const next = () => setCurrentStep((s) => Math.min(s + 1, STEPS.length - 1));
  const back = () => setCurrentStep((s) => Math.max(s - 1, 0));

  return (
    <div className="flex-1 p-8 overflow-auto">
      <div className="max-w-5xl mx-auto">
        {/* Progress bar */}
        <div className="flex items-center mb-10">
          {STEPS.map((step, i) => (
            <div key={step.id} className="flex items-center flex-1 last:flex-none">
              <div className="flex flex-col items-center">
                <div
                  className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-semibold border-2 ${
                    i < currentStep
                      ? "bg-blue-600 border-blue-600 text-white"
                      : i === currentStep
                      ? "border-blue-600 text-blue-600 bg-white"
                      : "border-gray-300 text-gray-400 bg-white"
                  }`}
                >
                  {i < currentStep ? "✓" : i + 1}
                </div>
                <span
                  className={`text-xs mt-1 whitespace-nowrap ${
                    i === currentStep ? "text-blue-600 font-medium" : "text-gray-400"
                  }`}
                >
                  {step.label}
                </span>
              </div>
              {i < STEPS.length - 1 && (
                <div
                  className={`flex-1 h-0.5 mx-2 mb-5 ${
                    i < currentStep ? "bg-blue-600" : "bg-gray-200"
                  }`}
                />
              )}
            </div>
          ))}
        </div>

        {/* Step content */}
        {currentStep === 0 && (
          <InputsStep sessionData={sessionData} updateSession={updateSession} onNext={next} />
        )}
        {currentStep === 1 && (
          <ConfigureVariantsStep sessionData={sessionData} updateSession={updateSession} onNext={next} onBack={back} />
        )}
        {currentStep === 2 && (
          <GenerateImagesStep sessionData={sessionData} updateSession={updateSession} onNext={next} onBack={back} />
        )}
        {currentStep === 3 && (
          <PrintifyMockupsStep sessionData={sessionData} updateSession={updateSession} onNext={next} onBack={back} />
        )}
        {currentStep === 4 && (
          <ConfirmUploadStep sessionData={sessionData} updateSession={updateSession} onBack={back} />
        )}
      </div>
    </div>
  );
}

export default CreateProducts;
