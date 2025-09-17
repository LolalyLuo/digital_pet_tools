// Generate a unique session ID for optimization runs
export function generateSessionId() {
  const timestamp = Date.now();
  const randomString = Math.random().toString(36).substring(2, 10);
  return `opt-${timestamp}-${randomString}`;
}

// Extract readable info from session ID
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

// Format session ID for display
export function formatSessionId(sessionId) {
  const parsed = parseSessionId(sessionId);
  if (!parsed) return sessionId;

  return `${parsed.shortId} (${parsed.date.toLocaleDateString()})`;
}

// Generate cloud function name with session ID
export function generateCloudFunctionName(sessionId) {
  const parsed = parseSessionId(sessionId);
  if (!parsed) {
    // Fallback to timestamp-based name
    return `evaluate-image-prompt-${Date.now()}`;
  }

  return `evaluate-image-prompt-${parsed.timestamp}-${parsed.randomPart}`;
}