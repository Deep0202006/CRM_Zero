export const containsAssertionWeakening = (source) => /--updateSnapshot|--update-snapshot|updateSnapshot\s*\(|(?:expect|assert)[^\n]{0,120}(?:\.skip|\.todo)/.test(source);
