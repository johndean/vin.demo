/**
 * Split an answer into speakable sentences so TTS can stream sentence-by-sentence (audio starts as
 * soon as the first sentence is synthesized rather than waiting for the whole reply). Kept simple
 * and robust; an incremental token-level segmenter can replace this when the answer LLM streams.
 */
/** Strip formatting that must never be SPOKEN — markdown emphasis/headers/code, list bullets, and symbols
 *  TTS reads literally or awkwardly ("asterisk asterisk", "arrow"). Leaves words + sentence punctuation
 *  intact. Applied before TTS so the voice never reads "**", "·", or "→". */
export function speakable(text: string): string {
  return (text || '')
    .replace(/```[\s\S]*?```/g, ' ')                       // fenced code blocks
    .replace(/`([^`]+)`/g, '$1')                           // inline code → inner text
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')             // [label](url) / image → label text
    .replace(/https?:\/\/\S+/g, ' ')                       // bare URLs → drop (never spell out char-by-char)
    .replace(/^\s{0,3}#{1,6}\s+/gm, '')                    // ATX headings
    .replace(/^\s*>+\s?/gm, '')                            // blockquotes
    .replace(/^\s*\d+[.)]\s+/gm, '')                       // numbered list markers "1." / "1)"
    .replace(/^\s*[-*+]\s+/gm, '')                         // bullet list markers
    .replace(/^\s*\|?[\s:|-]*-{2,}[\s:|-]*\|?\s*$/gm, '')  // markdown table separator rows
    .replace(/\|/g, ' ')                                   // table cell pipes
    .replace(/\*\*([^*]+)\*\*/g, '$1')                     // **bold**
    .replace(/__([^_]+)__/g, '$1')                         // __bold__
    .replace(/~~([^~]+)~~/g, '$1')                         // ~~strike~~
    .replace(/(^|[\s(>])[*_]([^*_\s][^*_]*?)[*_](?=[\s).,!?;:'"]|$)/g, '$1$2') // *italic*/_italic_ at word boundaries ONLY (keeps snake_case + "5 * 3")
    .replace(/\*\*/g, '')                                  // any leftover stray "**"
    .replace(/&amp;/g, ' and ').replace(/&lt;/g, ' less than ').replace(/&gt;/g, ' greater than ')
    .replace(/&#39;/g, "'").replace(/&apos;/g, "'").replace(/&quot;/g, '"').replace(/&nbsp;/g, ' ')
    .replace(/\s*(?:->|→|⇒)\s*/g, ' to ')                  // arrows → spoken "to"
    .replace(/\s*—\s*/g, ', ')                             // em dash → comma pause
    .replace(/[•·]/g, ' ')                                 // stray bullet dots
    .replace(/[`#>~]/g, '')                                // leftover stray md chars (NOT * or _ — keep code/identifiers intact)
    .replace(/\s{2,}/g, ' ')
    .trim();
}

export function splitSentences(text: string): string[] {
  return speakable(text)
    .split(/(?<=[.!?])\s+(?=[A-Z0-9"'(])/) // break after . ! ? when the next chunk starts a new sentence
    .map((s) => s.trim())
    .filter(Boolean);
}
