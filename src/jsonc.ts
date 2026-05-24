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
    } else if (text[i] === ',') {
      let j = i + 1;
      while (j < text.length) {
        if (text[j] === '/' && text[j + 1] === '/') {
          while (j < text.length && text[j] !== '\n') j++;
        } else if (text[j] === '/' && text[j + 1] === '*') {
          j += 2;
          while (j < text.length && !(text[j] === '*' && text[j + 1] === '/')) j++;
          if (j < text.length) j += 2;
        } else if (/\s/.test(text[j])) {
          j++;
        } else {
          break;
        }
      }
      if (j < text.length && (text[j] === '}' || text[j] === ']')) {
        i++;
      } else {
        result += text[i];
        i++;
      }
    } else {
      result += text[i];
      i++;
    }
  }
  return JSON.parse(result);
}
