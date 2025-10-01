"""
Comparison methods for grid-based geochemical data.
Each function follows the same interface:

    compare_fn(dl_gdf_idx, orig_gdf_idx, nx, ny, **kwargs) -> (arr_orig, arr_dl, arr_cmp)

- dl_gdf_idx:   GeoDataFrame with DL samples; must contain columns: grid_ix, grid_iy, Te_ppm
- orig_gdf_idx: GeoDataFrame with Original samples; same required columns
- nx, ny:       grid dimensions (number of cells in X and Y)

Outputs (all 2D float arrays shaped [ny, nx]):
- arr_orig:  summary/statistic for Original per cell
- arr_dl:    summary/statistic for DL per cell
- arr_cmp:   comparison result (e.g., DL − Original, or a distance)

Available methods: max, mean, median, chi2, p90, tail_ratio, emd
"""

import numpy as np
from scipy.stats import chisquare, wasserstein_distance


# ─────────────────────────────────────────────────────────────────────────────
# MAX: Grid-wise maximum (DL – Original)
# ─────────────────────────────────────────────────────────────────────────────

def max_diff(dl_gdf_idx, orig_gdf_idx, nx, ny):
    """Grid-wise maximum (DL – Original)."""
    arr_orig = np.zeros((ny, nx), dtype=float)
    arr_dl   = np.zeros((ny, nx), dtype=float)

    if len(orig_gdf_idx) > 0:
        gid = orig_gdf_idx["grid_iy"].values * nx + orig_gdf_idx["grid_ix"].values
        stat = (
            orig_gdf_idx.assign(grid_id=gid)
                        .groupby("grid_id")["Te_ppm"]
                        .agg("max")
        )
        iy = (stat.index.values // nx).astype(int)
        ix = (stat.index.values % nx).astype(int)
        arr_orig[iy, ix] = stat.values

    if len(dl_gdf_idx) > 0:
        gid = dl_gdf_idx["grid_iy"].values * nx + dl_gdf_idx["grid_ix"].values
        stat = (
            dl_gdf_idx.assign(grid_id=gid)
                      .groupby("grid_id")["Te_ppm"]
                      .agg("max")
        )
        iy = (stat.index.values // nx).astype(int)
        ix = (stat.index.values % nx).astype(int)
        arr_dl[iy, ix] = stat.values

    arr_cmp = arr_dl - arr_orig
    return arr_orig, arr_dl, arr_cmp


# ─────────────────────────────────────────────────────────────────────────────
# MEAN: Grid-wise mean (DL – Original)
# ─────────────────────────────────────────────────────────────────────────────

def mean_diff(dl_gdf_idx, orig_gdf_idx, nx, ny):
    """Grid-wise mean (DL – Original)."""
    arr_orig = np.zeros((ny, nx), dtype=float)
    arr_dl   = np.zeros((ny, nx), dtype=float)

    if len(orig_gdf_idx) > 0:
        gid = orig_gdf_idx["grid_iy"].values * nx + orig_gdf_idx["grid_ix"].values
        stat = (
            orig_gdf_idx.assign(grid_id=gid)
                        .groupby("grid_id")["Te_ppm"]
                        .agg("mean")
        )
        iy = (stat.index.values // nx).astype(int)
        ix = (stat.index.values % nx).astype(int)
        arr_orig[iy, ix] = stat.values

    if len(dl_gdf_idx) > 0:
        gid = dl_gdf_idx["grid_iy"].values * nx + dl_gdf_idx["grid_ix"].values
        stat = (
            dl_gdf_idx.assign(grid_id=gid)
                      .groupby("grid_id")["Te_ppm"]
                      .agg("mean")
        )
        iy = (stat.index.values // nx).astype(int)
        ix = (stat.index.values % nx).astype(int)
        arr_dl[iy, ix] = stat.values

    arr_cmp = arr_dl - arr_orig
    return arr_orig, arr_dl, arr_cmp


# ─────────────────────────────────────────────────────────────────────────────
# MEDIAN: Grid-wise median (DL – Original)
# ─────────────────────────────────────────────────────────────────────────────

def median_diff(dl_gdf_idx, orig_gdf_idx, nx, ny):
    """Grid-wise median (DL – Original)."""
    arr_orig = np.zeros((ny, nx), dtype=float)
    arr_dl   = np.zeros((ny, nx), dtype=float)

    if len(orig_gdf_idx) > 0:
        gid = orig_gdf_idx["grid_iy"].values * nx + orig_gdf_idx["grid_ix"].values
        stat = (
            orig_gdf_idx.assign(grid_id=gid)
                        .groupby("grid_id")["Te_ppm"]
                        .agg("median")
        )
        iy = (stat.index.values // nx).astype(int)
        ix = (stat.index.values % nx).astype(int)
        arr_orig[iy, ix] = stat.values

    if len(dl_gdf_idx) > 0:
        gid = dl_gdf_idx["grid_iy"].values * nx + dl_gdf_idx["grid_ix"].values
        stat = (
            dl_gdf_idx.assign(grid_id=gid)
                      .groupby("grid_id")["Te_ppm"]
                      .agg("median")
        )
        iy = (stat.index.values // nx).astype(int)
        ix = (stat.index.values % nx).astype(int)
        arr_dl[iy, ix] = stat.values

    arr_cmp = arr_dl - arr_orig
    return arr_orig, arr_dl, arr_cmp


# ─────────────────────────────────────────────────────────────────────────────
# CHI2: Reduced chi-square per cell (no p-values kept)
# ─────────────────────────────────────────────────────────────────────────────

def chi_squared_test(dl_gdf_idx, orig_gdf_idx, nx, ny,
                     bins_rule: str = "fd",
                     max_bins: int = 20,
                     min_expected: float = 5.0):
    """
    Per-cell chi-square comparison of Te_ppm distributions (DL vs Original) with
    adaptive binning.

    Returns:
      arr_orig : float[ny, nx]  -> count of Original samples per cell
      arr_dl   : float[ny, nx]  -> count of DL samples per cell
      arr_cmp  : float[ny, nx]  -> reduced chi-square per cell (χ² / dof), dof = (#bins - 1)

    Parameters:
      bins_rule   : str, histogram binning rule for numpy (e.g., "fd", "sturges", "scott")
      max_bins    : int, hard cap on number of bins per cell (to avoid over-fragmentation)
      min_expected: float, desired minimum expected count per bin; if too many bins have
                    very low expected counts, the function will retry with fewer bins.

    Notes:
      - Uses shared bin edges per cell from the combined (orig + dl) values.
      - Rescales expected frequencies to match observed totals (SciPy requirement).
      - Adds a small epsilon to avoid zeroes.
      - Cells with insufficient data or degenerate ranges return 0.
    """
    import numpy as np
    from scipy.stats import chisquare

    arr_orig = np.zeros((ny, nx), dtype=float)
    arr_dl   = np.zeros((ny, nx), dtype=float)
    arr_cmp  = np.zeros((ny, nx), dtype=float)

    eps = 1e-6

    for iy in range(ny):
        for ix in range(nx):
            # Extract values for this cell
            orig_vals = orig_gdf_idx.query("grid_ix == @ix and grid_iy == @iy")["Te_ppm"].values
            dl_vals   = dl_gdf_idx.query("grid_ix == @ix and grid_iy == @iy")["Te_ppm"].values

            # Record counts
            if len(orig_vals) > 0:
                arr_orig[iy, ix] = len(orig_vals)
            if len(dl_vals) > 0:
                arr_dl[iy, ix] = len(dl_vals)

            # Need both sides and at least two points total to form a histogram
            if len(orig_vals) == 0 or len(dl_vals) == 0:
                continue
            if (len(orig_vals) + len(dl_vals)) < 2:
                continue

            # Establish a common positive range
            data_max = float(max(np.max(orig_vals), np.max(dl_vals)))
            if not np.isfinite(data_max) or data_max <= 0:
                continue

            # Build adaptive bins from the combined distribution
            combined = np.concatenate([orig_vals, dl_vals]).astype(float)
            try:
                bin_edges = np.histogram_bin_edges(combined, bins=bins_rule, range=(0.0, data_max))
            except Exception:
                # Fallback if numpy rejects the rule (rare)
                bin_edges = np.histogram_bin_edges(combined, bins="sturges", range=(0.0, data_max))

            # Enforce caps and minimum number of bins (at least 2 bins -> 3 edges)
            if len(bin_edges) > (max_bins + 1):
                bin_edges = np.linspace(0.0, data_max, max_bins + 1)
            if len(bin_edges) < 3:
                # Fallback to a minimal 2-bin histogram
                bin_edges = np.linspace(0.0, data_max, 3)

            # Optionally, if many bins have very low expected counts, retry with fewer bins
            for _ in range(2):  # at most two retries to simplify
                hist_o, _ = np.histogram(orig_vals, bins=bin_edges)
                hist_d, _ = np.histogram(dl_vals,   bins=bin_edges)

                f_exp = hist_o.astype(float) + eps
                f_obs = hist_d.astype(float) + eps

                # Scale expected to observed totals
                f_exp *= (f_obs.sum() / max(f_exp.sum(), eps))

                # Check expected counts; if too many bins are tiny, coarsen the bins
                too_small = (f_exp < min_expected).sum()
                if too_small > (len(f_exp) // 2) and (len(bin_edges) > 3):
                    # Halve the number of bins and retry
                    new_bins = max(2, (len(bin_edges) - 1) // 2)
                    bin_edges = np.linspace(0.0, data_max, new_bins + 1)
                    continue
                else:
                    break  # bins acceptable

            # Degrees of freedom: k - 1
            dof = max(1, (len(bin_edges) - 1) - 1)

            # Pearson χ² test (discard p-value)
            chi2_stat, _ = chisquare(f_obs=f_obs, f_exp=f_exp)

            # Reduced χ²
            arr_cmp[iy, ix] = float(chi2_stat) / dof

    return arr_orig, arr_dl, arr_cmp



# ─────────────────────────────────────────────────────────────────────────────
# P90: 90th percentile difference (DL – Original)
# ─────────────────────────────────────────────────────────────────────────────

def p90_diff(dl_gdf_idx, orig_gdf_idx, nx, ny, q=0.9):
    """
    Per-cell high-quantile comparison (default 90th percentile).

    Returns:
      arr_orig : per-cell q-quantile of Original
      arr_dl   : per-cell q-quantile of DL
      arr_cmp  : DL − Original (quantile difference)

    Rationale:
      Highlights whether DL predicts more high-grade values than observed assays.
    """
    arr_orig = np.zeros((ny, nx), dtype=float)
    arr_dl   = np.zeros((ny, nx), dtype=float)

    if len(orig_gdf_idx) > 0:
        gid = orig_gdf_idx["grid_iy"].values * nx + orig_gdf_idx["grid_ix"].values
        # Use numpy quantile via .agg with a lambda to avoid helper functions
        stat = (
            orig_gdf_idx.assign(grid_id=gid)
                        .groupby("grid_id")["Te_ppm"]
                        .agg(lambda x: float(np.quantile(x.values, q)))
        )
        iy = (stat.index.values // nx).astype(int)
        ix = (stat.index.values % nx).astype(int)
        arr_orig[iy, ix] = stat.values

    if len(dl_gdf_idx) > 0:
        gid = dl_gdf_idx["grid_iy"].values * nx + dl_gdf_idx["grid_ix"].values
        stat = (
            dl_gdf_idx.assign(grid_id=gid)
                      .groupby("grid_id")["Te_ppm"]
                      .agg(lambda x: float(np.quantile(x.values, q)))
        )
        iy = (stat.index.values // nx).astype(int)
        ix = (stat.index.values % nx).astype(int)
        arr_dl[iy, ix] = stat.values

    arr_cmp = arr_dl - arr_orig
    return arr_orig, arr_dl, arr_cmp


# ─────────────────────────────────────────────────────────────────────────────
# TAIL_RATIO: Difference in proportion above a threshold (DL – Original)
# ─────────────────────────────────────────────────────────────────────────────

def tail_ratio(dl_gdf_idx, orig_gdf_idx, nx, ny, threshold=1.0):
    """
    Per-cell comparison of the *proportion* of samples above a threshold.

    Returns:
      arr_orig : per-cell proportion of Original with Te_ppm > threshold
      arr_dl   : per-cell proportion of DL with Te_ppm > threshold
      arr_cmp  : DL − Original (proportion difference)

    Notes:
      - Robust to differing sample counts; proportions are in [0, 1].
      - Use a geologically meaningful threshold for Te (e.g., anomaly cut-off).
    """
    arr_orig = np.zeros((ny, nx), dtype=float)
    arr_dl   = np.zeros((ny, nx), dtype=float)

    # Original
    if len(orig_gdf_idx) > 0:
        gid = orig_gdf_idx["grid_iy"].values * nx + orig_gdf_idx["grid_ix"].values
        grp = orig_gdf_idx.assign(grid_id=gid).groupby("grid_id")["Te_ppm"]
        count = grp.count().astype(float)
        above = (grp.apply(lambda s: float((s.values > threshold).sum())))
        prop  = (above / np.maximum(count, 1.0)).fillna(0.0)
        iy = (prop.index.values // nx).astype(int)
        ix = (prop.index.values % nx).astype(int)
        arr_orig[iy, ix] = prop.values

    # DL
    if len(dl_gdf_idx) > 0:
        gid = dl_gdf_idx["grid_iy"].values * nx + dl_gdf_idx["grid_ix"].values
        grp = dl_gdf_idx.assign(grid_id=gid).groupby("grid_id")["Te_ppm"]
        count = grp.count().astype(float)
        above = (grp.apply(lambda s: float((s.values > threshold).sum())))
        prop  = (above / np.maximum(count, 1.0)).fillna(0.0)
        iy = (prop.index.values // nx).astype(int)
        ix = (prop.index.values % nx).astype(int)
        arr_dl[iy, ix] = prop.values

    arr_cmp = arr_dl - arr_orig
    return arr_orig, arr_dl, arr_cmp


# ─────────────────────────────────────────────────────────────────────────────
# EMD: Earth Mover's Distance (Wasserstein) between per-cell distributions
# ─────────────────────────────────────────────────────────────────────────────

def emd_distance(dl_gdf_idx, orig_gdf_idx, nx, ny):
    """
    Per-cell 1D Earth Mover's Distance (Wasserstein) between DL and Original Te_ppm.

    Returns:
      arr_orig : count of Original samples per cell
      arr_dl   : count of DL samples per cell
      arr_cmp  : EMD distance per cell (>= 0; larger = more different)

    Notes:
      - Uses scipy.stats.wasserstein_distance on raw values (no binning).
      - Cells with insufficient data (either side empty) return 0.
    """
    arr_orig = np.zeros((ny, nx), dtype=float)
    arr_dl   = np.zeros((ny, nx), dtype=float)
    arr_cmp  = np.zeros((ny, nx), dtype=float)

    for iy in range(ny):
        for ix in range(nx):
            orig_vals = orig_gdf_idx.query("grid_ix == @ix and grid_iy == @iy")["Te_ppm"].values
            dl_vals   = dl_gdf_idx.query("grid_ix == @ix and grid_iy == @iy")["Te_ppm"].values

            if len(orig_vals) > 0:
                arr_orig[iy, ix] = len(orig_vals)
            if len(dl_vals) > 0:
                arr_dl[iy, ix] = len(dl_vals)

            if len(orig_vals) == 0 or len(dl_vals) == 0:
                continue

            # EMD on raw 1D samples; robust, bin-free comparison of distributions
            d = wasserstein_distance(orig_vals.astype(float), dl_vals.astype(float))
            if np.isfinite(d):
                arr_cmp[iy, ix] = d

    return arr_orig, arr_dl, arr_cmp


# ─────────────────────────────────────────────────────────────────────────────
# Registry
# ─────────────────────────────────────────────────────────────────────────────

COMPARISON_METHODS = {
    "max":        max_diff,
    "mean":       mean_diff,
    "median":     median_diff,
    "chi2":       chi_squared_test,
    "p90":        p90_diff,
    "tail_ratio": tail_ratio,
    "emd":        emd_distance,
}


# ─────────────────────────────────────────────────────────────────────────────
# Template: add your own comparison method
# ─────────────────────────────────────────────────────────────────────────────
"""
Example template for adding a new comparison:

def my_custom_diff(dl_gdf_idx, orig_gdf_idx, nx, ny, **kwargs):
    \"\"\"Describe what this comparison does and what it outputs.\"\"\"
    # 1) Prepare outputs
    arr_orig = np.zeros((ny, nx), dtype=float)
    arr_dl   = np.zeros((ny, nx), dtype=float)
    arr_cmp  = np.zeros((ny, nx), dtype=float)

    # 2) Compute per-cell statistics for 'orig' and 'dl'
    #    Fill arr_orig[iy, ix] and arr_dl[iy, ix].

    # 3) Compute comparison result (often arr_dl - arr_orig).
    #    Fill arr_cmp[iy, ix].

    return arr_orig, arr_dl, arr_cmp

# Add to register so it's discoverable:
# COMPARISON_METHODS = {
#   "custom": my_custom_diff,
# }
"""
