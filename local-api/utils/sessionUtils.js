// Generate cloud function name with session ID
export function generateCloudFunctionName(sessionId) {
  if (!sessionId || !sessionId.startsWith('opt-')) {
    // Fallback to timestamp-based name
    return `evaluate-image-prompt-${Date.now()}`;
  }

  try {
    const parts = sessionId.split('-');
    if (parts.length < 3) {
      return `evaluate-image-prompt-${Date.now()}`;
    }

    const timestamp = parts[1];
    const randomPart = parts[2];

    return `evaluate-image-prompt-${timestamp}-${randomPart}`;
  } catch (error) {
    return `evaluate-image-prompt-${Date.now()}`;
  }
}

// Parse session ID for components
export function parseSessionId(sessionId) {
  if (!sessionId || !sessionId.startsWith('opt-')) {
    return null;
  }

  try {
    const parts = sessionId.split('-');
    if (parts.length < 3) return null;

    const timestamp = parseInt(parts[1]);
    const randomPart = parts[2];

    return {
      timestamp,
      randomPart,
      date: new Date(timestamp),
      shortId: `${parts[1].slice(-4)}-${randomPart.slice(0, 4)}`
    };
  } catch (error) {
    return null;
  }
}