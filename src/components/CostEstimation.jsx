import { useState, useEffect } from 'react';
import { DollarSign, Clock, TrendingUp, Info } from 'lucide-react';
import { estimateOptimizationCost, formatCost, getModelDisplayName } from '../utils/costEstimation';

const CostEstimation = ({
  trainingDataCount = 0,
  optimizationSteps = 20,
  model = 'gemini-2.5-flash',
  className = ''
}) => {
  const [estimation, setEstimation] = useState(null);
  const [showBreakdown, setShowBreakdown] = useState(false);

  useEffect(() => {
    if (trainingDataCount > 0) {
      const cost = estimateOptimizationCost({
        trainingDataCount,
        optimizationSteps,
        model
      });
      setEstimation(cost);
    } else {
      setEstimation(null);
    }
  }, [trainingDataCount, optimizationSteps, model]);

  if (!estimation) {
    return (
      <div className={`bg-gray-50 border border-gray-200 rounded-lg p-4 ${className}`}>
        <div className="flex items-center text-gray-500">
          <DollarSign className="mr-2" size={16} />
          <span className="text-sm">Select training data to see cost estimation</span>
        </div>
      </div>
    );
  }

  const { breakdown, totalCost, estimatedDuration, calculations } = estimation;

  return (
    <div className={`bg-blue-50 border border-blue-200 rounded-lg p-4 ${className}`}>
      <div className="flex items-center mb-3">
        <DollarSign className="mr-2 text-blue-600" size={18} />
        <span className="font-medium text-blue-800">Cost Estimation</span>
      </div>

      <div className="space-y-3">
        {/* Total Cost */}
        <div className="flex items-center justify-between">
          <span className="text-blue-700 font-medium">Estimated Total Cost:</span>
          <span className="text-xl font-bold text-blue-800">{formatCost(totalCost)}</span>
        </div>

        {/* Duration */}
        <div className="flex items-center justify-between text-sm">
          <div className="flex items-center text-blue-600">
            <Clock className="mr-1" size={14} />
            <span>Duration:</span>
          </div>
          <span className="text-blue-700">{estimatedDuration}</span>
        </div>

        {/* Key metrics */}
        <div className="grid grid-cols-2 gap-3 text-xs">
          <div className="text-blue-600">
            <span className="block font-medium">{calculations.trainingDataCount}</span>
            <span>Training Samples</span>
          </div>
          <div className="text-blue-600">
            <span className="block font-medium">{calculations.imageGenerationCount}</span>
            <span>Images Generated</span>
          </div>
        </div>


        {totalCost > 10 && (
          <div className="mt-3 p-2 bg-yellow-100 border border-yellow-300 rounded text-xs">
            <div className="flex items-start">
              <Info className="mr-1 text-yellow-600 flex-shrink-0 mt-0.5" size={12} />
              <span className="text-yellow-800">
                <strong>High Cost Warning:</strong> This optimization will be expensive.
                Consider reducing training samples or optimization steps.
              </span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default CostEstimation;