/**
 * Split an answer into speakable sentences so TTS can stream sentence-by-sentence (audio starts as
 * soon as the first sentence is synthesized rather than waiting for the whole reply). Kept simple
 * and robust; an incremental token-level segmenter can replace this when the answer LLM streams.
 */
export function splitSentences(text: string): string[] {
  return (text || '')
    .replace(/\s+/g, ' ')
    .split(/(?<=[.!?])\s+(?=[A-Z0-9"'(])/) // break after . ! ? when the next chunk starts a new sentence
    .map((s) => s.trim())
    .filter(Boolean);
}
