export function generateParameterCombos(parameterSpace = {}) {
  const keys = Object.keys(parameterSpace);
  if (keys.length === 0) return [{}];

  const values = keys.map((k) => {
    const { min, max, step } = parameterSpace[k];
    const arr = [];
    for (let v = min; v <= max + 1e-9; v += step) arr.push(Number(v.toFixed(10)));
    return arr;
  });

  const out = [];
  const rec = (i, cur) => {
    if (i === keys.length) return out.push({ ...cur });
    for (const v of values[i]) {
      cur[keys[i]] = v;
      rec(i + 1, cur);
    }
  };
  rec(0, {});
  return out;
}
