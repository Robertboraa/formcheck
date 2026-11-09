# Evaluation: MediaPipe vs YOLO-pose

This folder holds everything for the model comparison in the paper. Both pose models run the
**same videos, frame by frame, through the same rules** (`src/engine.ts` + `src/exercises.ts`).
The only thing that changes is the model that finds the joints, so any difference in the results
comes from the pose model.

```
evaluation/
├── README.md             this file
├── labels_template.csv   copy to data/labels.csv and fill in
├── score.py              turns the data into every table and chart
├── requirements.txt
├── data/                 your CSV files go here (not the videos)
└── results/              made by score.py: results.md, tables/, figures/
```

## The workflow

1. **Film** the clips (plan below).
2. **Label** every rep by hand in `data/labels.csv`. Do this *before* looking at any model output.
3. **Run the batch evaluation** in the app: *Research → Batch evaluation*. Pick all the clips,
   tick *MediaPipe Full* and *YOLO11n-pose*, then press Run. Save `reps.csv`, `frames.csv` and
   `runs.csv` into `data/`.
4. **Mark joints** on a sample of frames: *Research → Mark joints*. Save each video's keypoints
   CSV into `data/`.
5. **Score:**
   ```
   pip3 install -r evaluation/requirements.txt
   python3 evaluation/score.py
   ```
   Open `evaluation/results/results.md`.

Freeze the rules before step 3. Changing a threshold after seeing the results turns the test data
into calibration data, and the results stop counting as a test.

## 1. Filming plan (two participants)

For each person, film **two sessions on different days**, in different clothes and a different
room or time of day.

Each session:

| Exercise | One clip each, about 5 reps |
|---|---|
| Squat | good, shallow, lean, head, toes |
| Push-up | good, shallow, sag, pike, lockout, head |

All of the above in the **main setup**: side-on, phone on a tripod at hip height, 2–3 m away, good
light, whole body in frame.

Then **robustness clips** (good + shallow for each exercise) in: `diagonal` (camera at 45°),
`dim` (low light), `far` (about 4 m).

Settings: **1080p, 30 fps, landscape**. Stand still for a second before the first rep.

### File names

`P01_S1_squat_shallow_side.mp4` = participant, session, exercise, what you did, condition.
The app reads the exercise from the name, and the labels match on the exact file name.

## 2. Labelling (labels.csv)

One row per real rep:

| column | meaning |
|---|---|
| video | exact file name |
| participant, session | P01 / S1 … |
| exercise | `squat` or `pushup` |
| condition | `side`, `diagonal`, `dim`, `far` |
| rep | 1, 2, 3 … |
| start_s | seconds: the moment the body starts going down from the top |
| end_s | seconds: the moment it is back at the top |
| correct | 1 = good form, 0 = has at least one fault |
| faults | codes separated by `;` (empty when correct) |

Fault codes (the same ones the app reports):

- **squat:** `shallow`, `lean`, `head`, `toes`
- **pushup:** `shallow`, `sag`, `pike`, `lockout`, `head`

Label from what actually happened, not from what you meant to do. If a "good" rep was actually
shallow, label it shallow.

To get the times, play the clip in QuickTime or VLC and step frame by frame (← →). You can also use
the frame bar in *Research → Mark joints*, which shows the time of every frame.

**Two raters:** you and your friend each fill in a copy on your own. Save one as `labels.csv` and
the other as `labels_rater2.csv`. score.py then reports Cohen's kappa. Afterwards, settle any
disagreements together and update `labels.csv`.

## 3. Marking joints (keypoints)

In *Research → Mark joints*, open a clip, choose the side facing the camera, then click the joints
in order: nose, ear, shoulder, elbow, wrist, hip, knee, ankle. Press **S** if a joint isn't
visible. Use ← → to move one frame, and Shift + ← → to move ten.

Mark about **3 frames per rep** (top, halfway down, bottom) on a few reps of each clip, aiming for
150–200 frames in total, spread across exercises and conditions. Use the same frame rate as the
batch run (30). Marks are saved in the browser as you go. Download the CSV when you finish a clip.

## What score.py reports

| Section | Metrics |
|---|---|
| Dataset | reps per exercise, fault and condition |
| Label agreement | Cohen's kappa between the two raters |
| Rep counting | count error per set, % of sets counted exactly, rep recall/precision, start/end error (ms), temporal IoU |
| Form classification | precision, recall, F1, accuracy, specificity (positive = faulty rep), with 95% CI; per-fault P/R/F1; macro F1 |
| Significance | exact McNemar test on the same reps, paired bootstrap CI of the F1 difference |
| Robustness | rep recall and F1 for each camera condition |
| Pose estimation | % of frames with a person found, angle jitter |
| Speed | mean / median / p95 ms per frame, FPS, Wilcoxon test |
| Keypoints | PCK@0.1 and PCK@0.2 (by torso length), per-joint error, joint-angle MAE, Wilcoxon test |

Confidence intervals resample **whole videos** rather than single reps, because reps in the same
clip are not independent.

**How reps are matched:** a counted rep is paired with the real rep whose start–end window contains
the counted rep's lowest point. Real reps with no match are *missed*; counted reps with no match
are *extra*. Classification is scored on the matched reps, and missed/extra reps show up in the
counting table.

## Things to write about in the paper

- **Same rules, same frames, same laptop.** Every frame is processed (the video is stepped, not
  played), so a slower model never skips frames. Time is measured around the model only.
- **YOLO has 17 points and no feet.** The squat *toes* check can't run with YOLO, so it scores 0
  there. Report it as a capability difference, not an accuracy one.
- **MediaPipe smooths over time, YOLO doesn't.** MediaPipe's VIDEO mode tracks the person between
  frames; YOLO looks at each frame on its own. The app applies the same smoothing on top of both.
  This shows up in the jitter table.
- **Where they run.** MediaPipe runs on the GPU through WebGL; YOLO runs through ONNX Runtime Web
  on WebGPU, or on the CPU (wasm) if WebGPU isn't available. `runs.csv` records which backend was
  used. Run everything on the same laptop, plugged in, with nothing else open.
- **Diagonal (45°) clips.** The rules pause when the torso looks more than 25% shorter or longer
  than at the start (meant to catch walking towards or away from the camera). At 45°, leaning
  forward makes the torso look shorter, so reps can be paused instead of counted with both models.
  This is a limitation of the side-on rules, and the robustness table will show it.
- **Two participants.** State it as a limitation. The Mendeley good/bad-form dataset can serve as an
  extra set of people you didn't film.
