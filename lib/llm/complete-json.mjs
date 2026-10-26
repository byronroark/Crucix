// Shared LLM JSON completion: force jsonMode, one repair/regenerate retry on parse/empty.

/**
 * Classify thrown provider errors into stable reason codes for the dashboard.
 * @param {unknown} err
 * @returns {{ reason: 'timeout'|'api', message: string }}
 */
export function classifyLlmError(err) {
  const message = String(err?.message || err || 'unknown error').substring(0, 240);
  if (/timeout|aborted|AbortError|timed out/i.test(message)) {
    return { reason: 'timeout', message };
  }
  return { reason: 'api', message };
}

/**
 * Complete a JSON-shaped LLM task with one automatic retry on empty/parse failure.
 *
 * @param {import('./provider.mjs').LLMProvider} provider
 * @param {object} opts
 * @param {string} opts.systemPrompt
 * @param {string} opts.userMessage
 * @param {(text: string) => Array|null} opts.parse
 * @param {string} opts.schemaHint short description of expected JSON shape (for repair prompt)
 * @param {number} [opts.maxTokens]
 * @param {number} [opts.timeout]
 * @param {string} [opts.logLabel]
 * @returns {Promise<{ items: Array|null, error: { reason: string, message: string }|null, retried: boolean }>}
 */
export async function completeJsonWithRetry(provider, opts) {
  const {
    systemPrompt,
    userMessage,
    parse,
    schemaHint,
    maxTokens = 4096,
    timeout = 60000,
    logLabel = 'LLM',
  } = opts;

  const callOpts = { maxTokens, timeout, jsonMode: true };

  let firstText = '';
  let firstResult;
  try {
    firstResult = await provider.complete(systemPrompt, userMessage, callOpts);
    firstText = firstResult?.text || '';
  } catch (err) {
    return { items: null, error: classifyLlmError(err), retried: false };
  }

  const firstParsed = parse(firstText);
  if (firstParsed?.length) {
    return { items: firstParsed, error: null, retried: false };
  }

  const firstReason = !(firstText || '').trim() ? 'empty' : 'parse';
  const preview = (firstText || '').replace(/\s+/g, ' ').substring(0, 240);
  const finish = firstResult?.finishReason || 'unknown';
  const outTok = firstResult?.usage?.outputTokens ?? '?';
  console.warn(`[${logLabel}] First pass ${firstReason}`
    + ` (finish=${finish}, outTokens=${outTok})`
    + (preview ? ` — preview: ${preview}...` : ' — empty response text')
    + '; retrying once');

  try {
    let retrySystem;
    let retryUser;
    if (firstReason === 'empty') {
      retrySystem = `${systemPrompt}\n\nCRITICAL: Your previous response was empty. Respond with ONLY the JSON object described above. No markdown fences, no prose.`;
      retryUser = userMessage;
    } else {
      retrySystem = `You repair malformed JSON from another model. Output ONLY valid JSON matching this schema: ${schemaHint}. No markdown fences, no commentary. If the input is truncated, complete the array with as many valid items as you can recover (at least one if possible).`;
      retryUser = `Repair into valid JSON only:\n\n${String(firstText).substring(0, 14000)}`;
    }

    const retryResult = await provider.complete(retrySystem, retryUser, {
      ...callOpts,
      // Give truncated repairs a little more room when the first pass was large
      maxTokens: Math.max(maxTokens, Math.min(8192, maxTokens + 1024)),
    });
    const retryText = retryResult?.text || '';
    const retryParsed = parse(retryText);
    if (retryParsed?.length) {
      console.log(`[${logLabel}] Retry recovered ${retryParsed.length} item(s)`);
      return { items: retryParsed, error: null, retried: true };
    }

    const retryReason = !(retryText || '').trim() ? 'empty' : 'parse';
    return {
      items: null,
      error: {
        reason: retryReason === 'empty' ? firstReason : retryReason,
        message: retryReason === 'empty'
          ? 'LLM returned an empty response after retry'
          : 'LLM responded but output could not be parsed after retry',
      },
      retried: true,
    };
  } catch (err) {
    const classified = classifyLlmError(err);
    return {
      items: null,
      error: {
        reason: firstReason,
        message: `${firstReason} failure; retry also failed: ${classified.message}`,
      },
      retried: true,
    };
  }
}
