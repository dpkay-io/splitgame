export function parseJsonc(text: string): any {
  let result = '';
  let i = 0;
  while (i < text.length) {
    if (text[i] === '"') {
      const start = i;
      i++;
      while (i < text.length && text[i] !== '"') {
        if (text[i] === '\\') i++;
        i++;
      }
      i++;
      result += text.slice(start, i);
    } else if (text[i] === '/' && text[i + 1] === '/') {
      while (i < text.length && text[i] !== '\n') i++;
    } else if (text[i] === '/' && text[i + 1] === '*') {
      i += 2;
      while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) i++;
      if (i < text.length) i += 2;
    } else {
      result += text[i];
      i++;
    }
  }
  const cleaned = result.replace(/,\s*([}\]])/g, '$1');
  return JSON.parse(cleaned);
}
