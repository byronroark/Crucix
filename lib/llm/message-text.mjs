// Normalize LLM message payloads (string vs multipart content arrays).

/**
 * @param {unknown} content
 * @returns {string}
 */
export function extractMessageText(content) {
  if (content == null) return '';
  if (typeof content === 'string') return content.trim();
  if (Array.isArray(content)) {
    return content
      .map(part => {
        if (!part) return '';
        if (typeof part === 'string') return part;
        if (typeof part === 'object') {
          return part.text || part.content || part.value || '';
        }
        return '';
      })
      .filter(Boolean)
      .join('\n')
      .trim();
  }
  if (typeof content === 'object') {
    return String(content.text || content.content || '').trim();
  }
  return String(content).trim();
}

/**
 * @param {object} message OpenAI-style message object
 * @returns {string}
 */
export function extractAssistantText(message = {}) {
  const primary = extractMessageText(message.content);
  if (primary) return primary;
  return extractMessageText(message.reasoning_content)
    || extractMessageText(message.reasoning)
    || '';
}
