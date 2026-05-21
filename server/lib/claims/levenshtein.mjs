/** Normalized similarity in [0, 1] using Levenshtein distance. */
export const normalizedSimilarity = (a, b) => {
  const left = String(a ?? '').trim().toLowerCase();
  const right = String(b ?? '').trim().toLowerCase();
  if (!left && !right) {
    return 1;
  }
  if (!left || !right) {
    return 0;
  }
  const distance = levenshtein(left, right);
  const maxLen = Math.max(left.length, right.length);
  return 1 - distance / maxLen;
};

const levenshtein = (a, b) => {
  const rows = a.length + 1;
  const cols = b.length + 1;
  const matrix = Array.from({ length: rows }, () => Array(cols).fill(0));
  for (let i = 0; i < rows; i += 1) {
    matrix[i][0] = i;
  }
  for (let j = 0; j < cols; j += 1) {
    matrix[0][j] = j;
  }
  for (let i = 1; i < rows; i += 1) {
    for (let j = 1; j < cols; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,
        matrix[i][j - 1] + 1,
        matrix[i - 1][j - 1] + cost,
      );
    }
  }
  return matrix[rows - 1][cols - 1];
};
