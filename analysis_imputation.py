"""
Imputation model selection analysis.

Simulates the imputation task on clean shots (true club_speed known) by
masking club_speed and measuring how well each (scaler, model, hyperparams)
combo recovers it.  Uses 5-fold cross-validation.

Two-stage analysis:
  1. Model/scaler/hyperparameter grid search using the current feature set
  2. Feature subset evaluation using the best config from each model type

Models evaluated:
  - sklearn.impute.KNNImputer
  - sklearn.impute.IterativeImputer (with several base estimators)

Scalers evaluated:
  - StandardScaler, MinMaxScaler, RobustScaler, (none — IterativeImputer only)
"""

from __future__ import annotations

import copy
import warnings
from itertools import combinations, product

import duckdb
import numpy as np
import pandas as pd
from sklearn.ensemble import ExtraTreesRegressor, GradientBoostingRegressor, RandomForestRegressor
from sklearn.experimental import enable_iterative_imputer  # noqa: F401
from sklearn.impute import IterativeImputer, KNNImputer
from sklearn.linear_model import BayesianRidge
from sklearn.metrics import mean_absolute_error, root_mean_squared_error
from sklearn.model_selection import KFold
from sklearn.preprocessing import MinMaxScaler, RobustScaler, StandardScaler

warnings.filterwarnings("ignore")

CURRENT_FEATURES = ["ball_speed", "spin_rate", "spin_axis"]
CANDIDATE_FEATURES = [
    "ball_speed",
    "spin_rate",
    "spin_axis",
    "launch_angle",
    "attack_angle",
    "launch_direction",
    "carry_distance",
    "club_path",
    "descent_angle",
]
TARGET = "club_speed"
DB_PATH = "db/golf_analytics.duckdb"
N_FOLDS = 5
RANDOM_STATE = 42


# ── Load clean data (all candidate columns) ────────────────────────────────────

conn = duckdb.connect(DB_PATH)
all_cols = CANDIDATE_FEATURES + [TARGET]
df = conn.execute(
    f"""
    SELECT {', '.join(all_cols)}
    FROM shots
    WHERE smash_factor <= 1.5
      AND {' AND '.join(f'{c} IS NOT NULL' for c in all_cols)}
    """
).df()

print(f"Clean shots available for analysis: {len(df)}\n")
print(df[CURRENT_FEATURES + [TARGET]].describe().round(2).to_string())
print()


# ── Helpers ────────────────────────────────────────────────────────────────────

SCALERS = {
    "none":     None,
    "standard": StandardScaler,
    "minmax":   MinMaxScaler,
    "robust":   RobustScaler,
}
# KNN is distance-based — "none" scaler excluded
KNN_SCALERS = {k: v for k, v in SCALERS.items() if k != "none"}

KNN_CONFIGS = [
    {"n_neighbors": k, "weights": w}
    for k, w in product([3, 5, 7, 11, 15], ["uniform", "distance"])
]

ITERATIVE_CONFIGS = [
    {"estimator": est, "max_iter": mi, "initial_strategy": strat}
    for est, mi, strat in product(
        [
            ("BayesianRidge",    BayesianRidge()),
            ("RandomForest",     RandomForestRegressor(n_estimators=50, random_state=RANDOM_STATE)),
            ("ExtraTrees",       ExtraTreesRegressor(n_estimators=50, random_state=RANDOM_STATE)),
            ("GradientBoosting", GradientBoostingRegressor(n_estimators=50, random_state=RANDOM_STATE)),
        ],
        [5, 10],
        ["mean", "median"],
    )
]


def cv_score(imputer_fn, scaler_cls, X_full: np.ndarray) -> tuple[float, float]:
    """
    5-fold CV: mask the TARGET column (index -1), impute, compare to truth.
    Returns (mean_MAE, mean_RMSE).
    """
    kf = KFold(n_splits=N_FOLDS, shuffle=True, random_state=RANDOM_STATE)
    maes, rmses = [], []

    for train_idx, test_idx in kf.split(X_full):
        X_train, X_test = X_full[train_idx].copy(), X_full[test_idx].copy()

        if scaler_cls is not None:
            scaler = scaler_cls()
            X_train = scaler.fit_transform(X_train)
            X_test  = scaler.transform(X_test)

        imp = imputer_fn()
        imp.fit(X_train)

        y_true = X_test[:, -1].copy()
        X_masked = X_test.copy()
        X_masked[:, -1] = np.nan
        y_pred = imp.transform(X_masked)[:, -1]

        if scaler_cls is not None:
            dummy = np.zeros((len(y_true), X_train.shape[1]))
            dummy[:, -1] = y_true
            y_true = scaler.inverse_transform(dummy)[:, -1]
            dummy[:, -1] = y_pred
            y_pred = scaler.inverse_transform(dummy)[:, -1]

        maes.append(mean_absolute_error(y_true, y_pred))
        rmses.append(root_mean_squared_error(y_true, y_pred))

    return float(np.mean(maes)), float(np.mean(rmses))


# ── Stage 1: Model / scaler / hyperparameter grid ─────────────────────────────

X_current = df[CURRENT_FEATURES + [TARGET]].to_numpy(dtype=float)
results = []

print("=" * 90)
print("STAGE 1: MODEL / SCALER / HYPERPARAMETER GRID SEARCH")
print(f"         Features: {CURRENT_FEATURES}")
print("=" * 90)
print(f"  KNN configs:       {len(KNN_CONFIGS)} × {len(KNN_SCALERS)} scalers = {len(KNN_CONFIGS)*len(KNN_SCALERS)} combos")
print(f"  Iterative configs: {len(ITERATIVE_CONFIGS)} × {len(SCALERS)} scalers = {len(ITERATIVE_CONFIGS)*len(SCALERS)} combos")
print()

for cfg in KNN_CONFIGS:
    for scaler_name, scaler_cls in KNN_SCALERS.items():
        def _make_knn(c=cfg):
            return KNNImputer(**c)
        mae, rmse = cv_score(_make_knn, scaler_cls, X_current)
        results.append({
            "model":       "KNNImputer",
            "scaler":      scaler_name,
            "params":      f"k={cfg['n_neighbors']}, w={cfg['weights']}",
            "n_neighbors": cfg["n_neighbors"],
            "weights":     cfg["weights"],
            "mae":         mae,
            "rmse":        rmse,
        })

for cfg in ITERATIVE_CONFIGS:
    est_name, est_obj = cfg["estimator"]
    for scaler_name, scaler_cls in SCALERS.items():
        def _make_iter(e=est_obj, mi=cfg["max_iter"], s=cfg["initial_strategy"]):
            return IterativeImputer(estimator=copy.deepcopy(e), max_iter=mi,
                                    initial_strategy=s, random_state=RANDOM_STATE)
        mae, rmse = cv_score(_make_iter, scaler_cls, X_current)
        results.append({
            "model":            "IterativeImputer",
            "scaler":           scaler_name,
            "params":           f"est={est_name}, iter={cfg['max_iter']}, init={cfg['initial_strategy']}",
            "estimator":        est_name,
            "max_iter":         cfg["max_iter"],
            "initial_strategy": cfg["initial_strategy"],
            "mae":              mae,
            "rmse":             rmse,
        })

results_df = pd.DataFrame(results).sort_values("mae")

print("TOP 20 CONFIGURATIONS (by MAE)")
print("-" * 90)
print(results_df.head(20)[["model", "scaler", "params", "mae", "rmse"]].to_string(index=False, float_format="%.4f"))

print()
print("BEST PER MODEL TYPE")
print("-" * 90)
best_per_model: dict[str, dict] = {}
for model_name in ["KNNImputer", "IterativeImputer"]:
    subset = results_df[results_df["model"] == model_name]
    best = subset.iloc[0]
    best_per_model[model_name] = best.to_dict()
    print(f"\n{model_name}:")
    print(f"  scaler : {best['scaler']}")
    print(f"  params : {best['params']}")
    print(f"  MAE    : {best['mae']:.4f} mph")
    print(f"  RMSE   : {best['rmse']:.4f} mph")

print()
print("SCALER EFFECT (mean MAE per scaler type across all model configs)")
print("-" * 90)
for model_name in ["KNNImputer", "IterativeImputer"]:
    subset = results_df[results_df["model"] == model_name]
    print(f"\n  {model_name}:")
    print(subset.groupby("scaler")["mae"].mean().sort_values().round(4).to_string())


# ── Stage 2: Feature subset evaluation ────────────────────────────────────────

print()
print("=" * 90)
print("STAGE 2: FEATURE SUBSET EVALUATION")
print(f"         Candidate features: {CANDIDATE_FEATURES}")
print(f"         ball_speed is anchored (always included)")
print("=" * 90)

# ball_speed anchored; vary subsets of the remaining candidates
optional = [f for f in CANDIDATE_FEATURES if f != "ball_speed"]
feature_subsets = []
for r in range(0, len(optional) + 1):
    for combo in combinations(optional, r):
        feature_subsets.append(["ball_speed"] + list(combo))

print(f"  Testing {len(feature_subsets)} feature subsets × 2 best model configs\n")

# Build imputer factories for the best config of each model type
def _best_knn_factory():
    best = best_per_model["KNNImputer"]
    return KNNImputer(n_neighbors=int(best["n_neighbors"]), weights=best["weights"])

def _best_iter_factory():
    best = best_per_model["IterativeImputer"]
    return IterativeImputer(
        estimator=GradientBoostingRegressor(n_estimators=50, random_state=RANDOM_STATE),
        max_iter=int(best["max_iter"]),
        initial_strategy=best["initial_strategy"],
        random_state=RANDOM_STATE,
    )

best_knn_scaler = SCALERS[best_per_model["KNNImputer"]["scaler"]]
best_iter_scaler = SCALERS[best_per_model["IterativeImputer"]["scaler"]]

feat_results = []
for feat_set in feature_subsets:
    X_feat = df[feat_set + [TARGET]].to_numpy(dtype=float)

    knn_mae, knn_rmse = cv_score(_best_knn_factory, best_knn_scaler, X_feat)
    iter_mae, iter_rmse = cv_score(_best_iter_factory, best_iter_scaler, X_feat)

    feat_results.append({
        "n_features":  len(feat_set),
        "features":    ", ".join(feat_set),
        "knn_mae":     knn_mae,
        "knn_rmse":    knn_rmse,
        "iter_mae":    iter_mae,
        "iter_rmse":   iter_rmse,
        "best_mae":    min(knn_mae, iter_mae),
        "best_model":  "KNN" if knn_mae < iter_mae else "Iter",
    })

feat_df = pd.DataFrame(feat_results).sort_values("best_mae")

print("TOP 20 FEATURE SUBSETS (by best MAE across both model types)")
print("-" * 90)
display_cols = ["n_features", "features", "knn_mae", "iter_mae", "best_mae", "best_model"]
print(feat_df.head(20)[display_cols].to_string(index=False, float_format="%.4f"))

print()
print("CURRENT FEATURE SET RANK")
print("-" * 90)
current_label = ", ".join(CURRENT_FEATURES)
current_row = feat_df[feat_df["features"] == current_label]
if not current_row.empty:
    rank = feat_df.index.get_loc(current_row.index[0]) + 1
    row = current_row.iloc[0]
    print(f"  rank      : {rank} / {len(feat_df)}")
    print(f"  features  : {row['features']}")
    print(f"  KNN MAE   : {row['knn_mae']:.4f} mph")
    print(f"  Iter MAE  : {row['iter_mae']:.4f} mph")

print()
print("MARGINAL VALUE OF EACH CANDIDATE FEATURE")
print("(mean best_mae with feature present vs absent, across all subsets)")
print("-" * 90)
for feat in CANDIDATE_FEATURES:
    with_feat    = feat_df[feat_df["features"].str.contains(feat)]["best_mae"].mean()
    without_feat = feat_df[~feat_df["features"].str.contains(feat)]["best_mae"].mean()
    delta = without_feat - with_feat
    print(f"  {feat:20s}  with={with_feat:.4f}  without={without_feat:.4f}  delta={delta:+.4f}")

print()
print("OVERALL BEST FEATURE SET")
print("-" * 90)
best_feat = feat_df.iloc[0]
print(f"  features  : {best_feat['features']}")
print(f"  best MAE  : {best_feat['best_mae']:.4f} mph  ({best_feat['best_model']})")
print(f"  KNN MAE   : {best_feat['knn_mae']:.4f} mph")
print(f"  Iter MAE  : {best_feat['iter_mae']:.4f} mph")
