'use strict';

function tokenize(input) {
  const clean = input.replace(/^\s*\/\/.*$/gm, '');
  const matches = clean.match(/"(?:\\.|[^"\\])*"|[{}]/g) ?? [];
  return matches.map((token) => {
    if (token === '{' || token === '}') return token;
    return token.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, '\\');
  });
}

function parseVdf(input) {
  const tokens = tokenize(input);
  let index = 0;

  function readObject(expectClosingBrace) {
    const result = {};
    while (index < tokens.length) {
      const key = tokens[index++];
      if (key === '}') {
        if (!expectClosingBrace) throw new Error('Unexpected closing brace in VDF');
        return result;
      }
      if (key === '{') throw new Error('Unexpected opening brace in VDF');
      const value = tokens[index++];
      if (value === '{') result[key] = readObject(true);
      else if (value === '}' || value === undefined) throw new Error(`Missing value for VDF key: ${key}`);
      else result[key] = value;
    }
    if (expectClosingBrace) throw new Error('Unclosed VDF object');
    return result;
  }

  return readObject(false);
}

module.exports = { parseVdf, tokenize };
