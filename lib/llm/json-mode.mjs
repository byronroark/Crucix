// Helpers for provider JSON response modes (OpenAI-compatible + Gemini).

/**
 * Attach OpenAI-style response_format when jsonMode is enabled.
 * @param {object} body
 * @param {{ jsonMode?: boolean }} opts
 */
export function withOpenAiJsonMode(body, opts = {}) {
  if (opts.jsonMode === false) return body;
  return { ...body, response_format: { type: 'json_object' } };
}

/**
 * If a JSON-mode request was rejected, retry without response_format.
 * @param {Response} res
 * @param {boolean} wantJson
 */
export async function shouldRetryWithoutJsonMode(res, wantJson) {
  if (!wantJson || res.ok || res.status !== 400) return false;
  const errText = await res.clone().text().catch(() => '');
  return /response_format|json_object|json mode|responseMimeType/i.test(errText);
}
