#!/usr/bin/env python3
"""
FormCheck evaluation: compares pose models (MediaPipe vs YOLO) running the same form rules.

Reads (from evaluation/data/ by default):
  labels.csv            ground truth, one row per real rep (see labels_template.csv)
  labels_rater2.csv     optional: the second person's labels, for inter-rater agreement
  reps*.csv             from the app's Research > Batch evaluation (one row per counted rep)
  frames*.csv           from the same run (one row per frame per model)
  runs*.csv             from the same run (one row per video per model)
  keypoints*.csv        optional: hand-marked joints from Research > Mark joints

Writes evaluation/results/:
  results.md            every table, ready for the paper
  tables/*.csv          the same tables as CSV
  figures/*.png         charts

Run:  python3 evaluation/score.py            (or --data / --out to change folders)
"""

import argparse
import glob
import math
import os
import sys

import numpy as np
import pandas as pd
from scipy import stats

# fault codes the app can report, per exercise (same as FaultCode in src/exercises.ts)
FAULTS = {
    "squat": ["shallow", "lean", "head", "toes"],
    "pushup": ["shallow", "sag", "pike", "lockout", "head"],
}

# faults a model cannot detect because it has no foot keypoints
UNSUPPORTED = {"yolo11n": {"toes"}, "yolo11s": {"toes"}}

MODEL_NAMES = {
    "mediapipe-full": "MediaPipe Full",
    "mediapipe-lite": "MediaPipe Lite",
    "mediapipe-heavy": "MediaPipe Heavy",
    "yolo11n": "YOLO11n-pose",
    "yolo11s": "YOLO11s-pose",
}

# colours from the app (plate colours) so the charts match the slides
PALETTE = ["#1e4fa8", "#e9b308", "#c42a1f", "#586170", "#17202e"]

WARMUP_FRAMES = 10  # first frames of each video left out of the timing (model warm-up)
BOOTSTRAP = 2000
SEED = 7


# ---------------------------------------------------------------- reading


def read_many(folder, pattern):
    files = sorted(glob.glob(os.path.join(folder, pattern)))
    if not files:
        return None
    return pd.concat([pd.read_csv(f) for f in files], ignore_index=True)


def fault_set(value):
    if value is None or (isinstance(value, float) and math.isnan(value)):
        return set()
    return {x.strip() for x in str(value).replace(",", ";").split(";") if x.strip()}


def name(model):
    return MODEL_NAMES.get(model, model)


# ---------------------------------------------------------------- metrics


def binary_metrics(y_true, y_pred):
    """Positive class = a faulty rep (the thing the system must catch)."""
    y_true = np.asarray(y_true, dtype=bool)
    y_pred = np.asarray(y_pred, dtype=bool)
    tp = int(np.sum(y_true & y_pred))
    fp = int(np.sum(~y_true & y_pred))
    fn = int(np.sum(y_true & ~y_pred))
    tn = int(np.sum(~y_true & ~y_pred))
    precision = tp / (tp + fp) if tp + fp else float("nan")
    recall = tp / (tp + fn) if tp + fn else float("nan")
    f1 = 2 * precision * recall / (precision + recall) if precision + recall > 0 else float("nan")
    if tp + fp == 0 and tp + fn > 0:
        f1 = 0.0
    n = tp + fp + fn + tn
    return {
        "n": n,
        "TP": tp,
        "FP": fp,
        "FN": fn,
        "TN": tn,
        "precision": precision,
        "recall": recall,
        "F1": f1,
        "accuracy": (tp + tn) / n if n else float("nan"),
        "specificity": tn / (tn + fp) if tn + fp else float("nan"),
    }


def f1_of(df, true_col="y_true", pred_col="y_pred"):
    return binary_metrics(df[true_col], df[pred_col])["F1"]


def cohen_kappa(a, b):
    a = np.asarray(a)
    b = np.asarray(b)
    if len(a) == 0:
        return float("nan")
    labels = np.unique(np.concatenate([a, b]))
    po = np.mean(a == b)
    pe = sum(np.mean(a == lab) * np.mean(b == lab) for lab in labels)
    return (po - pe) / (1 - pe) if pe < 1 else 1.0


def bootstrap_ci(df, fn, cluster="video", n=BOOTSTRAP, seed=SEED):
    """95% confidence interval, resampling whole videos (reps in one video are not independent)."""
    groups = {k: g for k, g in df.groupby(cluster)}
    keys = list(groups)
    if len(keys) < 2:
        return (float("nan"), float("nan"))
    rng = np.random.default_rng(seed)
    values = []
    for _ in range(n):
        sample = rng.choice(len(keys), len(keys), replace=True)
        d = pd.concat([groups[keys[i]] for i in sample], ignore_index=True)
        values.append(fn(d))
    values = np.array(values, dtype=float)
    values = values[~np.isnan(values)]
    if len(values) == 0:
        return (float("nan"), float("nan"))
    return tuple(np.percentile(values, [2.5, 97.5]))


def mcnemar(a_right, b_right):
    """Exact McNemar test on paired right/wrong decisions."""
    a_right = np.asarray(a_right, dtype=bool)
    b_right = np.asarray(b_right, dtype=bool)
    b = int(np.sum(a_right & ~b_right))
    c = int(np.sum(~a_right & b_right))
    p = stats.binomtest(min(b, c), b + c, 0.5).pvalue if b + c else 1.0
    return b, c, p


def wilcoxon(x, y):
    d = np.asarray(x) - np.asarray(y)
    d = d[~np.isnan(d)]
    if len(d) < 6 or np.allclose(d, 0):
        return float("nan"), len(d)
    return stats.wilcoxon(d).pvalue, len(d)


def angle(a, b, c):
    r = math.atan2(c[1] - b[1], c[0] - b[0]) - math.atan2(a[1] - b[1], a[0] - b[0])
    d = abs(math.degrees(r))
    return 360 - d if d > 180 else d


def tilt(a, b):
    return math.degrees(math.atan2(abs(a[0] - b[0]), abs(a[1] - b[1])))


# the angles the rules use, from points of one side of the body
ANGLES = {
    "knee": (("hip", "knee", "ankle"), angle),
    "elbow": (("shoulder", "elbow", "wrist"), angle),
    "hip": (("shoulder", "hip", "knee"), angle),
    "body line": (("shoulder", "hip", "ankle"), angle),
    "neck": (("ear", "shoulder", "hip"), angle),
    "torso lean": (("shoulder", "hip"), tilt),
}


# ---------------------------------------------------------------- output helpers


def fmt(v, digits=3):
    if v is None:
        return "–"
    if isinstance(v, (float, np.floating)):
        if math.isnan(v):
            return "–"
        return f"{v:.{digits}f}"
    return str(v)


def md_table(df, digits=3):
    if df is None or len(df) == 0:
        return "_No data._\n"
    cols = list(df.columns)
    lines = ["| " + " | ".join(str(c) for c in cols) + " |", "|" + "|".join("---" for _ in cols) + "|"]
    for _, row in df.iterrows():
        lines.append("| " + " | ".join(fmt(row[c], digits) for c in cols) + " |")
    return "\n".join(lines) + "\n"


class Report:
    def __init__(self, out):
        self.out = out
        self.parts = []
        os.makedirs(os.path.join(out, "tables"), exist_ok=True)
        os.makedirs(os.path.join(out, "figures"), exist_ok=True)

    def h(self, text, level=2):
        self.parts.append(f"\n{'#' * level} {text}\n")

    def p(self, text):
        self.parts.append(text + "\n")

    def table(self, slug, df, caption, digits=3):
        self.parts.append(f"**{caption}**\n\n" + md_table(df, digits))
        if df is not None and len(df):
            df.to_csv(os.path.join(self.out, "tables", f"{slug}.csv"), index=False)

    def figure(self, slug, caption):
        self.parts.append(f"![{caption}](figures/{slug}.png)\n\n*{caption}*\n")

    def save(self):
        path = os.path.join(self.out, "results.md")
        with open(path, "w") as f:
            f.write("# FormCheck: pose model comparison\n")
            f.write("\n".join(self.parts))
        return path


# ---------------------------------------------------------------- rep matching


def match_reps(pred, labels):
    """
    Pairs each counted rep with a real rep: the counted rep's lowest point must fall inside the
    real rep's start-end window; each real rep is used once. Returns one row per (model, real rep)
    with the counted rep's columns filled in (or empty if the system missed it), plus a list of
    counted reps with no real rep (extra counts).
    """
    rows = []
    extras = []
    for model in sorted(pred["model"].unique()):
        pm = pred[pred["model"] == model]
        for video, lab_v in labels.groupby("video"):
            pv = pm[pm["video"] == video].sort_values("bottom_s")
            used = set()
            pairs = {}
            for pi, p in pv.iterrows():
                inside = lab_v[(lab_v["start_s"] <= p["bottom_s"]) & (lab_v["end_s"] >= p["bottom_s"])]
                inside = inside[~inside.index.isin(used)]
                if len(inside) == 0:
                    extras.append({"model": model, "video": video, "rep": p["rep"], "bottom_s": p["bottom_s"]})
                    continue
                mid = (inside["start_s"] + inside["end_s"]) / 2
                li = (mid - p["bottom_s"]).abs().idxmin()
                used.add(li)
                pairs[li] = p
            for li, lab in lab_v.iterrows():
                p = pairs.get(li)
                rows.append(
                    {
                        "model": model,
                        "video": video,
                        "exercise": lab["exercise"],
                        "participant": lab.get("participant", ""),
                        "condition": lab.get("condition", ""),
                        "label_rep": lab["rep"],
                        "label_start": lab["start_s"],
                        "label_end": lab["end_s"],
                        "label_correct": int(lab["correct"]),
                        "label_faults": ";".join(sorted(fault_set(lab.get("faults")))),
                        "matched": p is not None,
                        "pred_rep": p["rep"] if p is not None else np.nan,
                        "pred_start": p["start_s"] if p is not None else np.nan,
                        "pred_end": p["end_s"] if p is not None else np.nan,
                        "pred_correct": int(p["correct"]) if p is not None else np.nan,
                        "pred_faults": ";".join(sorted(fault_set(p["faults"]))) if p is not None else "",
                    }
                )
        # counted reps in videos that have no labels at all are ignored (not part of the test set)
    return pd.DataFrame(rows), pd.DataFrame(extras, columns=["model", "video", "rep", "bottom_s"])


# ---------------------------------------------------------------- sections


def section_dataset(r, labels, runs):
    r.h("1. Dataset")
    by = labels.groupby(["exercise"]).agg(
        videos=("video", "nunique"),
        reps=("rep", "count"),
        correct=("correct", "sum"),
    )
    by["faulty"] = by["reps"] - by["correct"]
    by = by.reset_index()
    r.table("dataset", by, "Table 1. Labelled reps per exercise", 0)

    fault_rows = []
    for ex, codes in FAULTS.items():
        lx = labels[labels["exercise"] == ex]
        for code in codes:
            fault_rows.append({"exercise": ex, "fault": code, "reps": int(sum(code in fault_set(v) for v in lx["faults"]))})
    r.table("dataset_faults", pd.DataFrame(fault_rows), "Table 2. Labelled reps per fault", 0)

    if "participant" in labels and "condition" in labels:
        pc = labels.groupby(["participant", "condition"]).size().reset_index(name="reps")
        r.table("dataset_conditions", pc, "Table 3. Reps per participant and camera condition", 0)

    if runs is not None:
        info = runs.groupby("model").agg(backend=("backend", "first"), videos=("video", "nunique"), frames=("frames", "sum"))
        info = info.reset_index()
        info["model"] = info["model"].map(name)
        r.table("runs", info, "Table 4. Runs", 0)


def section_agreement(r, labels, rater2):
    r.h("2. Label agreement (two raters)")
    if rater2 is None:
        r.p("_No labels_rater2.csv found: add the second person's labels to report Cohen's kappa._")
        return
    m = labels.merge(rater2, on=["video", "rep"], suffixes=("_a", "_b"))
    rows = [{"label": "correct / incorrect", "reps": len(m), "agreement": np.mean(m["correct_a"] == m["correct_b"]), "kappa": cohen_kappa(m["correct_a"], m["correct_b"])}]
    for ex, codes in FAULTS.items():
        mx = m[m["exercise_a"] == ex]
        for code in codes:
            a = [code in fault_set(v) for v in mx["faults_a"]]
            b = [code in fault_set(v) for v in mx["faults_b"]]
            if len(mx):
                rows.append({"label": f"{ex}: {code}", "reps": len(mx), "agreement": np.mean(np.array(a) == np.array(b)), "kappa": cohen_kappa(a, b)})
    r.table("agreement", pd.DataFrame(rows), "Table 5. Inter-rater agreement (Cohen's kappa; >0.8 = almost perfect, 0.6–0.8 = substantial)")


def section_counting(r, matched, extras, pred, labels):
    r.h("3. Rep counting and segmentation")
    rows = []
    per_video = []
    for model, g in matched.groupby("model"):
        for video, gv in g.groupby("video"):
            true_n = len(gv)
            found = int(gv["matched"].sum())
            counted = int(((pred["model"] == model) & (pred["video"] == video)).sum())
            per_video.append({"model": model, "video": video, "true": true_n, "counted": counted, "found": found})
        pv = pd.DataFrame([x for x in per_video if x["model"] == model])
        m = g[g["matched"]]
        start_err = (m["pred_start"] - m["label_start"]).abs()
        end_err = (m["pred_end"] - m["label_end"]).abs()
        inter = (np.minimum(m["pred_end"], m["label_end"]) - np.maximum(m["pred_start"], m["label_start"])).clip(lower=0)
        union = np.maximum(m["pred_end"], m["label_end"]) - np.minimum(m["pred_start"], m["label_start"])
        tiou = inter / union
        total_true = pv["true"].sum()
        total_counted = pv["counted"].sum()
        found = pv["found"].sum()
        rows.append(
            {
                "model": name(model),
                "real reps": total_true,
                "counted": total_counted,
                "count MAE / set": np.mean(np.abs(pv["counted"] - pv["true"])),
                "sets exact %": 100 * np.mean(pv["counted"] == pv["true"]),
                "rep recall": found / total_true if total_true else np.nan,
                "rep precision": found / total_counted if total_counted else np.nan,
                "start error ms": 1000 * start_err.mean(),
                "end error ms": 1000 * end_err.mean(),
                "median start ms": 1000 * start_err.median(),
                "temporal IoU": tiou.mean(),
            }
        )
    r.table("counting", pd.DataFrame(rows), "Table 6. Rep counting and boundaries (rep recall = real reps found; precision = counted reps that were real)")
    pd.DataFrame(per_video).assign(model=lambda d: d["model"].map(name)).to_csv(os.path.join(r.out, "tables", "counting_per_video.csv"), index=False)
    r.p("Counted reps for every video are in tables/counting_per_video.csv.")


def section_classification(r, matched):
    r.h("4. Form classification")
    r.p(
        "Scored on the real reps each model found (missed reps are in Section 3). "
        "Positive class = a faulty rep, so recall = share of faulty reps caught, "
        "precision = share of flagged reps that really were faulty."
    )
    m = matched[matched["matched"]].copy()
    m["y_true"] = m["label_correct"] == 0
    m["y_pred"] = m["pred_correct"] == 0
    rows = []
    for ex in ["all"] + sorted(m["exercise"].unique()):
        mx = m if ex == "all" else m[m["exercise"] == ex]
        for model, g in mx.groupby("model"):
            res = binary_metrics(g["y_true"], g["y_pred"])
            lo, hi = bootstrap_ci(g, f1_of)
            rows.append({"exercise": ex, "model": name(model), **res, "F1 95% CI": f"{fmt(lo)}–{fmt(hi)}"})
    r.table("classification", pd.DataFrame(rows), "Table 7. Correct vs faulty rep detection (95% CI by resampling videos)")

    # per fault
    rows = []
    for ex, codes in FAULTS.items():
        mx = m[m["exercise"] == ex]
        for code in codes:
            for model, g in mx.groupby("model"):
                yt = [code in fault_set(v) for v in g["label_faults"]]
                yp = [code in fault_set(v) for v in g["pred_faults"]]
                res = binary_metrics(yt, yp)
                note = "no foot points" if code in UNSUPPORTED.get(model, set()) else ""
                rows.append({"exercise": ex, "fault": code, "model": name(model), "support": sum(yt), "precision": res["precision"], "recall": res["recall"], "F1": res["F1"], "note": note})
    faults = pd.DataFrame(rows)
    r.table("per_fault", faults, "Table 8. Detection of each fault")

    if len(faults):
        macro = faults[faults["support"] > 0].groupby("model")["F1"].mean().reset_index(name="macro F1")
        r.table("macro_f1", macro, "Table 9. Macro F1 over faults that appear in the labels")
    return m, faults


def section_classification_tests(r, m):
    r.h("4.1 Significance tests", 3)
    models = sorted(m["model"].unique())
    if len(models) < 2:
        r.p("_Only one model: nothing to compare._")
        return
    rows = []
    m = m.copy()
    m["right"] = m["y_true"] == m["y_pred"]
    key = ["video", "label_rep"]
    for i, a in enumerate(models):
        for b in models[i + 1 :]:
            pa = m[m["model"] == a][key + ["right", "y_true", "y_pred"]]
            pb = m[m["model"] == b][key + ["right", "y_true", "y_pred"]]
            both = pa.merge(pb, on=key, suffixes=("_a", "_b"))
            if len(both) == 0:
                continue
            nb, nc, p = mcnemar(both["right_a"], both["right_b"])

            def diff(d):
                return f1_of(d, "y_true_a", "y_pred_a") - f1_of(d, "y_true_b", "y_pred_b")

            lo, hi = bootstrap_ci(both, diff)
            rows.append(
                {
                    "A": name(a),
                    "B": name(b),
                    "paired reps": len(both),
                    "A right, B wrong": nb,
                    "A wrong, B right": nc,
                    "McNemar p": p,
                    "F1 A − B": diff(both),
                    "95% CI": f"{fmt(lo)} to {fmt(hi)}",
                }
            )
    r.table("mcnemar", pd.DataFrame(rows), "Table 10. Paired comparison on the same reps (exact McNemar test; CI by resampling videos). p < 0.05 = a real difference")


def section_robustness(r, matched):
    r.h("5. Robustness by camera condition")
    if "condition" not in matched or matched["condition"].fillna("").eq("").all():
        r.p("_Add a condition column to labels.csv (side, diagonal, dim, far…) to see this table._")
        return None
    rows = []
    for (cond, model), g in matched.groupby(["condition", "model"]):
        found = g[g["matched"]]
        res = binary_metrics(found["label_correct"] == 0, found["pred_correct"] == 0)
        rows.append({"condition": cond, "model": name(model), "reps": len(g), "rep recall": g["matched"].mean(), "F1": res["F1"], "accuracy": res["accuracy"]})
    df = pd.DataFrame(rows)
    r.table("robustness", df, "Table 11. Results per camera condition")
    return df


def section_pose(r, frames, runs, labels):
    r.h("6. Pose estimation")
    cond = labels.drop_duplicates("video").set_index("video")["condition"] if labels is not None and "condition" in labels else None

    # detection rate
    rows = []
    for model, g in frames.groupby("model"):
        row = {"model": name(model), "frames": len(g), "person found %": 100 * g["detected"].mean()}
        if cond is not None:
            for c in sorted(cond.dropna().unique()):
                vids = cond[cond == c].index
                gc = g[g["video"].isin(vids)]
                if len(gc):
                    row[f"{c} %"] = 100 * gc["detected"].mean()
        rows.append(row)
    r.table("detection", pd.DataFrame(rows), "Table 12. Frames where a person was found", 1)

    # jitter: how much the main angle shakes from frame to frame (second difference)
    rows = []
    for model, g in frames.groupby("model"):
        values = []
        for _, gv in g.sort_values("frame").groupby("video"):
            a = gv["main_raw"].to_numpy(dtype=float)
            d = np.abs(a[2:] - 2 * a[1:-1] + a[:-2])
            values.extend(d[~np.isnan(d)])
        values = np.array(values)
        rows.append({"model": name(model), "jitter ° (mean)": values.mean() if len(values) else np.nan, "jitter ° (median)": np.median(values) if len(values) else np.nan})
    r.table("jitter", pd.DataFrame(rows), "Table 13. Main-angle jitter before smoothing (mean |θt − 2θt−1 + θt−2|; lower = steadier)", 2)


def section_speed(r, frames, runs):
    r.h("7. Speed")
    f = frames[frames["frame"] >= WARMUP_FRAMES]
    rows = []
    for model, g in f.groupby("model"):
        ms = g["ms"].to_numpy(dtype=float)
        backend = runs[runs["model"] == model]["backend"].iloc[0] if runs is not None and (runs["model"] == model).any() else ""
        rows.append(
            {
                "model": name(model),
                "backend": backend,
                "frames": len(ms),
                "mean ms": ms.mean(),
                "median ms": np.median(ms),
                "p95 ms": np.percentile(ms, 95),
                "FPS (1000 / mean)": 1000 / ms.mean(),
            }
        )
    r.table("speed", pd.DataFrame(rows), f"Table 14. Processing time per frame (model only; first {WARMUP_FRAMES} frames of each video left out)", 1)
    models = sorted(f["model"].unique())
    tests = []
    for i, a in enumerate(models):
        for b in models[i + 1 :]:
            fa = f[f["model"] == a][["video", "frame", "ms"]]
            fb = f[f["model"] == b][["video", "frame", "ms"]]
            both = fa.merge(fb, on=["video", "frame"], suffixes=("_a", "_b"))
            p, n = wilcoxon(both["ms_a"], both["ms_b"])
            tests.append({"A": name(a), "B": name(b), "paired frames": n, "median A − B ms": float(np.median(both["ms_a"] - both["ms_b"])) if n else np.nan, "Wilcoxon p": p})
    if tests:
        r.table("speed_tests", pd.DataFrame(tests), "Table 15. Paired speed comparison (Wilcoxon signed-rank)")


def section_keypoints(r, frames, keypoints):
    r.h("8. Keypoint and joint-angle accuracy (against hand-marked frames)")
    if keypoints is None:
        r.p("_No keypoints*.csv found: mark joints in Research > Mark joints to fill this section._")
        return None, None
    kp = keypoints.copy()
    kp["base"] = kp["joint"].str.replace(r"^[lr]_", "", regex=True)
    frames = frames.set_index(["video", "frame", "model"]).sort_index()
    models = sorted(frames.index.get_level_values("model").unique())

    # torso length on each marked frame (to make errors comparable across distances)
    torso = {}
    for (video, frame), g in kp.groupby(["video", "frame"]):
        pts = {row["base"]: (row["x"], row["y"]) for _, row in g.iterrows()}
        if "shoulder" in pts and "hip" in pts:
            torso[(video, frame)] = math.dist(pts["shoulder"], pts["hip"])

    # point errors
    rows = []
    for _, k in kp.iterrows():
        t = torso.get((k["video"], k["frame"]))
        for model in models:
            key = (k["video"], int(k["frame"]), model)
            if key not in frames.index:
                continue
            fr = frames.loc[key]
            if isinstance(fr, pd.DataFrame):
                fr = fr.iloc[0]
            x = fr.get(f"{k['joint']}_x")
            y = fr.get(f"{k['joint']}_y")
            found = bool(fr["detected"]) and pd.notna(x)
            err = math.dist((x, y), (k["x"], k["y"])) if found else np.nan
            rows.append({"model": model, "video": k["video"], "frame": k["frame"], "joint": k["base"], "found": found, "error px": err, "error / torso": err / t if t and found else np.nan})
    pe = pd.DataFrame(rows)
    if len(pe) == 0:
        r.p("_The marked frames don't match any frames in frames.csv (check the video names and frame rate)._")
        return None, None

    summary = []
    for model, g in pe.groupby("model"):
        norm = g["error / torso"].fillna(np.inf)  # not found = a miss
        summary.append(
            {
                "model": name(model),
                "points": len(g),
                "mean error px": g["error px"].mean(),
                "mean error / torso": g["error / torso"].mean(),
                "PCK@0.1": np.mean(norm <= 0.1),
                "PCK@0.2": np.mean(norm <= 0.2),
            }
        )
    r.table("pck", pd.DataFrame(summary), "Table 16. Keypoint accuracy (PCK@α = share of points within α × torso length of the hand mark)")
    per_joint = pe.assign(norm=pe["error / torso"].fillna(np.inf)).groupby(["joint", "model"]).agg(points=("found", "size"), pck_02=("norm", lambda s: np.mean(s <= 0.2)), mean_err=("error / torso", "mean")).reset_index()
    per_joint["model"] = per_joint["model"].map(name)
    per_joint = per_joint.rename(columns={"pck_02": "PCK@0.2", "mean_err": "mean error / torso"})
    r.table("pck_per_joint", per_joint, "Table 17. Keypoint accuracy per joint")

    # angle errors
    rows = []
    for (video, frame, side), g in kp.groupby(["video", "frame", "side"]):
        pts = {row["base"]: (row["x"], row["y"]) for _, row in g.iterrows()}
        for ang, (names, fn) in ANGLES.items():
            if not all(n in pts for n in names):
                continue
            truth = fn(*[pts[n] for n in names])
            for model in models:
                key = (video, int(frame), model)
                if key not in frames.index:
                    continue
                fr = frames.loc[key]
                if isinstance(fr, pd.DataFrame):
                    fr = fr.iloc[0]
                cols = [(f"{side}_{n}_x", f"{side}_{n}_y") for n in names]
                if not fr["detected"] or any(pd.isna(fr.get(cx)) for cx, _ in cols):
                    continue
                pred = fn(*[(fr[cx], fr[cy]) for cx, cy in cols])
                rows.append({"model": model, "video": video, "frame": frame, "angle": ang, "truth": truth, "pred": pred, "abs error": abs(pred - truth)})
    ae = pd.DataFrame(rows)
    if len(ae):
        t = ae.groupby(["angle", "model"]).agg(frames=("abs error", "size"), MAE=("abs error", "mean"), median=("abs error", "median"), max=("abs error", "max")).reset_index()
        overall = ae.groupby("model").agg(frames=("abs error", "size"), MAE=("abs error", "mean"), median=("abs error", "median"), max=("abs error", "max")).reset_index().assign(angle="all")
        t = pd.concat([t, overall], ignore_index=True)
        t["model"] = t["model"].map(name)
        r.table("angle_mae", t, "Table 18. Joint-angle mean absolute error in degrees", 2)

        tests = []
        for i, a in enumerate(models):
            for b in models[i + 1 :]:
                for ang in list(ANGLES) + ["all"]:
                    sel = ae if ang == "all" else ae[ae["angle"] == ang]
                    pa = sel[sel["model"] == a][["video", "frame", "angle", "abs error"]]
                    pb = sel[sel["model"] == b][["video", "frame", "angle", "abs error"]]
                    both = pa.merge(pb, on=["video", "frame", "angle"], suffixes=("_a", "_b"))
                    if len(both) == 0:
                        continue
                    p, n = wilcoxon(both["abs error_a"], both["abs error_b"])
                    tests.append({"angle": ang, "A": name(a), "B": name(b), "pairs": n, "MAE A": both["abs error_a"].mean(), "MAE B": both["abs error_b"].mean(), "Wilcoxon p": p})
        if tests:
            r.table("angle_tests", pd.DataFrame(tests), "Table 19. Paired angle-error comparison (Wilcoxon signed-rank)")
    return pe, ae


# ---------------------------------------------------------------- figures


def figures(r, faults, frames, ae, robust):
    try:
        import matplotlib

        matplotlib.use("Agg")
        import matplotlib.pyplot as plt
    except ImportError:
        r.p("_matplotlib is not installed, so no figures were drawn._")
        return

    plt.rcParams.update({"font.size": 10, "axes.spines.top": False, "axes.spines.right": False})

    def bars(df, group_col, value_col, slug, ylabel, caption, ylim=None):
        groups = list(dict.fromkeys(df[group_col]))
        models = list(dict.fromkeys(df["model"]))
        width = 0.8 / max(len(models), 1)
        fig, ax = plt.subplots(figsize=(max(6, len(groups) * 0.9), 3.6))
        for i, model in enumerate(models):
            vals = [df[(df[group_col] == g) & (df["model"] == model)][value_col].mean() for g in groups]
            ax.bar(np.arange(len(groups)) + i * width, np.nan_to_num(vals), width, label=model, color=PALETTE[i % len(PALETTE)])
        ax.set_xticks(np.arange(len(groups)) + width * (len(models) - 1) / 2)
        ax.set_xticklabels(groups, rotation=30, ha="right")
        ax.set_ylabel(ylabel)
        if ylim:
            ax.set_ylim(*ylim)
        ax.legend(frameon=False, loc="lower center", bbox_to_anchor=(0.5, 1.0), ncol=len(models))
        fig.tight_layout()
        fig.savefig(os.path.join(r.out, "figures", f"{slug}.png"), dpi=200)
        plt.close(fig)
        r.figure(slug, caption)

    r.h("Figures")
    if faults is not None and len(faults):
        f = faults[faults["support"] > 0].copy()
        f["group"] = f["exercise"] + ": " + f["fault"]
        bars(f, "group", "F1", "fault_f1", "F1", "Figure 1. F1 for each fault", (0, 1))

    if frames is not None:
        f = frames[frames["frame"] >= WARMUP_FRAMES]
        models = sorted(f["model"].unique())
        fig, ax = plt.subplots(figsize=(5, 3.4))
        bp = ax.boxplot([f[f["model"] == m]["ms"] for m in models], showfliers=False, patch_artist=True)
        for i, box in enumerate(bp["boxes"]):
            box.set_facecolor(PALETTE[i % len(PALETTE)])
        ax.set_xticks(range(1, len(models) + 1))
        ax.set_xticklabels([name(m) for m in models])
        ax.set_ylabel("ms per frame")
        fig.tight_layout()
        fig.savefig(os.path.join(r.out, "figures", "speed.png"), dpi=200)
        plt.close(fig)
        r.figure("speed", "Figure 2. Processing time per frame")

    if ae is not None and len(ae):
        a = ae.assign(model=ae["model"].map(name))
        bars(a.groupby(["angle", "model"])["abs error"].mean().reset_index(name="MAE"), "angle", "MAE", "angle_mae", "MAE (degrees)", "Figure 3. Joint-angle error against hand-marked frames")

    if robust is not None and len(robust):
        bars(robust, "condition", "F1", "robustness", "F1", "Figure 4. Fault-detection F1 per camera condition", (0, 1))


# ---------------------------------------------------------------- main


def main():
    here = os.path.dirname(os.path.abspath(__file__))
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--data", default=os.path.join(here, "data"))
    ap.add_argument("--out", default=os.path.join(here, "results"))
    args = ap.parse_args()

    labels = read_many(args.data, "labels.csv")
    rater2 = read_many(args.data, "labels_rater2.csv")
    pred = read_many(args.data, "reps*.csv")
    frames = read_many(args.data, "frames*.csv")
    runs = read_many(args.data, "runs*.csv")
    keypoints = read_many(args.data, "keypoints*.csv")

    if pred is None and frames is None:
        sys.exit(f"No reps*.csv or frames*.csv in {args.data}. Run Research > Batch evaluation in the app first.")

    # the same video and model run twice: keep the last run
    if pred is not None:
        pred = pred.drop_duplicates(["video", "model", "rep"], keep="last")
    if frames is not None:
        frames = frames.drop_duplicates(["video", "model", "frame"], keep="last")
    if runs is not None:
        runs = runs.drop_duplicates(["video", "model"], keep="last")
    if keypoints is not None:
        keypoints = keypoints.drop_duplicates(["video", "frame", "joint"], keep="last")

    r = Report(args.out)
    r.p(
        "Every model ran the same videos, frame by frame, through the same rules (src/engine.ts and "
        "src/exercises.ts); only the pose model changed."
    )

    faults = robust = ae = None
    if labels is not None:
        labels["correct"] = labels["correct"].astype(int)
        section_dataset(r, labels, runs)
        section_agreement(r, labels, rater2)
        if pred is not None:
            matched, extras = match_reps(pred, labels)
            matched.to_csv(os.path.join(args.out, "tables", "matched_reps.csv"), index=False)
            section_counting(r, matched, extras, pred, labels)
            m, faults = section_classification(r, matched)
            section_classification_tests(r, m)
            robust = section_robustness(r, matched)
    else:
        r.p("_No labels.csv found: rep counting and classification need it (copy labels_template.csv)._")

    if frames is not None:
        section_pose(r, frames, runs, labels)
        section_speed(r, frames, runs)
        _, ae = section_keypoints(r, frames, keypoints)

    figures(r, faults, frames, ae, robust)
    path = r.save()
    print(f"Wrote {path}")


if __name__ == "__main__":
    main()
