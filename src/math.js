/**
 * Lognormal scenario math for the projection tab.
 *
 * The server fits drift (m) and volatility (s) from history; everything here
 * turns that fit into outcomes. Under geometric Brownian motion,
 *   ln(V_T / V_0) ~ Normal(m·T, s²·T)
 * so every quantity below is a closed form — no simulation, no random jitter
 * between renders.
 */

/** Standard normal CDF (Abramowitz & Stegun 7.1.26, |error| < 1.5e-7). */
export function normalCdf(x) {
  const sign = x < 0 ? -1 : 1;
  const z = Math.abs(x) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * z);
  const erf =
    1 -
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) *
      t *
      Math.exp(-z * z);
  return 0.5 * (1 + sign * erf);
}

/** Inverse standard normal CDF (Acklam's rational approximation). */
export function normalInv(p) {
  if (p <= 0) return -Infinity;
  if (p >= 1) return Infinity;

  const a = [-3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2, 1.38357751867269e2, -3.066479806614716e1, 2.506628277459239];
  const b = [-5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2, 6.680131188771972e1, -1.328068155288572e1];
  const c = [-7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996, 3.754408661907416];

  const plow = 0.02425;
  let q;
  let r;

  if (p < plow) {
    q = Math.sqrt(-2 * Math.log(p));
    return (
      (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
      ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1)
    );
  }
  if (p > 1 - plow) {
    q = Math.sqrt(-2 * Math.log(1 - p));
    return (
      -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
      ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1)
    );
  }
  q = p - 0.5;
  r = q * q;
  return (
    ((((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q) /
    (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1)
  );
}

/** Value at the given cumulative percentile of the outcome distribution. */
export function valueAtPercentile({ amount, drift, vol, years, percentile }) {
  const z = normalInv(percentile);
  return amount * Math.exp(drift * years + z * vol * Math.sqrt(years));
}

/**
 * The headline answer: "there is a `probability` chance of ending at or above X".
 * A 90% chance points at a low bar, so it reads the 10th percentile.
 */
export const valueWithChanceOfExceeding = ({ amount, drift, vol, years, probability }) =>
  valueAtPercentile({ amount, drift, vol, years, percentile: 1 - probability });

/** The reverse question: the chance of finishing at or above a target value. */
export function probabilityOfAtLeast({ amount, drift, vol, years, target }) {
  if (!(amount > 0) || !(target > 0) || !(years > 0) || !(vol > 0)) return null;
  const z = (Math.log(target / amount) - drift * years) / (vol * Math.sqrt(years));
  return 1 - normalCdf(z);
}

/** Percentile bands through time, for the fan chart. */
export function projectionBands({ amount, drift, vol, years, percentiles, steps = 48 }) {
  const points = [];
  const stepCount = Math.max(12, Math.min(steps, 240));

  for (let i = 0; i <= stepCount; i += 1) {
    const t = (years * i) / stepCount;
    const point = { t, year: t };
    for (const p of percentiles) {
      point[`p${Math.round(p * 100)}`] =
        i === 0 ? amount : valueAtPercentile({ amount, drift, vol, years: t, percentile: p });
    }
    points.push(point);
  }
  return points;
}

/** Summary statistics of the terminal distribution. */
export function projectionSummary({ amount, drift, vol, years }) {
  const median = amount * Math.exp(drift * years);
  // Mean of a lognormal sits above its median by exp(s²T/2).
  const mean = amount * Math.exp(drift * years + (vol * vol * years) / 2);
  return {
    median,
    mean,
    probLoss: 1 - probabilityOfAtLeast({ amount, drift, vol, years, target: amount }),
    probDouble: probabilityOfAtLeast({ amount, drift, vol, years, target: amount * 2 }),
  };
}

/**
 * Volatility at a given horizon from an option term structure.
 *
 * Interpolates total variance (σ²·T) linearly between quoted expiries, which is
 * the standard construction — interpolating σ directly would misprice the gaps.
 * Past the last listed expiry the level is held flat: that is extrapolation, and
 * the caller is expected to say so.
 */
export function volAtHorizon(points, years) {
  if (!points?.length || !(years > 0)) return null;
  if (years <= points[0].years) return points[0].impliedVol;

  const last = points[points.length - 1];
  if (years >= last.years) return last.impliedVol;

  for (let i = 1; i < points.length; i += 1) {
    const a = points[i - 1];
    const b = points[i];
    if (years <= b.years) {
      const varA = a.impliedVol ** 2 * a.years;
      const varB = b.impliedVol ** 2 * b.years;
      const w = (years - a.years) / (b.years - a.years);
      const variance = varA + w * (varB - varA);
      return Math.sqrt(Math.max(variance, 1e-12) / years);
    }
  }
  return last.impliedVol;
}

/* ---------------------------------------------------------------------------
   Portfolio maths for the allocation tab.

   A portfolio's return is the weighted sum of its holdings' SIMPLE returns, so
   data/portfolio.js supplies arithmetic means and a covariance matrix. Volatility is
   NOT the weighted average of the parts — cross-correlations are what make a
   mix steadier than its ingredients, and only the covariance term captures it.
   --------------------------------------------------------------------------- */

/** Annualised arithmetic return and volatility of a weighted mix. */
export function mixStats(weights, mu, cov) {
  const ret = weights.reduce((sum, w, i) => sum + w * mu[i], 0);
  let variance = 0;
  for (let i = 0; i < weights.length; i += 1) {
    for (let j = 0; j < weights.length; j += 1) variance += weights[i] * weights[j] * cov[i][j];
  }
  return { ret, vol: Math.sqrt(Math.max(variance, 0)) };
}

/**
 * Convert an arithmetic annual return + volatility into the lognormal log-drift
 * the projection functions expect, so the allocation tab and the single-ticker
 * projection speak the same language.
 */
export const logDriftFrom = (annualReturn, vol) =>
  Math.log(1 + annualReturn) - (vol * vol) / 2;

/** Scale weights to sum to 1; an all-zero set falls back to an equal split. */
export function normalizeWeights(weights) {
  const total = weights.reduce((a, b) => a + Math.max(0, b), 0);
  if (!(total > 0)) return weights.map(() => 1 / weights.length);
  return weights.map((w) => Math.max(0, w) / total);
}


/**
 * Find the allocation that scores highest against one stated objective.
 *
 * "Best" is not a single thing, so the caller must say what it means:
 *   'sharpe' — most past return per unit of volatility
 *   'minvol' — steadiest mix, regardless of return
 *   'return' — highest past return, which always collapses into one holding
 *
 * Hill-climbing rather than reading the best dot out of the random cloud:
 * sampling only gets close, and this lands on the actual optimum.
 *
 * The starting points are deliberately fixed — the equal split plus each
 * single-holding corner — so pressing the button twice cannot produce two
 * different allocations. Random restarts were measurably non-reproducible.
 */
export function optimizeWeights({ mu, cov, objective = 'sharpe' }) {
  const n = mu.length;
  if (!n) return [];

  const starts = [
    new Array(n).fill(1 / n),
    ...Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => (i === j ? 1 : 0))),
  ];

  const score = (w) => {
    const { ret, vol } = mixStats(w, mu, cov);
    if (objective === 'minvol') return -vol;
    if (objective === 'return') return ret;
    return vol > 0 ? ret / vol : -Infinity;
  };

  let best = null;

  for (const start of starts) {
    let weights = normalizeWeights(start);
    let current = score(weights);
    let step = 0.25;

    while (step > 1e-4) {
      let improved = false;
      for (let i = 0; i < n; i += 1) {
        for (const direction of [1, -1]) {
          const candidate = [...weights];
          candidate[i] = Math.max(0, candidate[i] + direction * step);
          const normalized = normalizeWeights(candidate);
          const value = score(normalized);
          if (value > current + 1e-12) {
            weights = normalized;
            current = value;
            improved = true;
          }
        }
      }
      if (!improved) step /= 2;
    }

    if (!best || current > best.score) best = { weights, score: current };
  }

  return best.weights;
}
