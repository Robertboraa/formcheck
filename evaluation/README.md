# Evaluation: MediaPipe vs YOLO-pose

The question: **which pose model measures joint angles more accurately, and which one is better to
use in which situation?**

Both models run on the same videos, frame by frame. On a sample of frames the joints are marked by
hand; the angles from those marks are the ground truth. Each model's angles are compared with
them, overall and split by situation. Everything runs in the app: *Research*.

## The workflow

1. **Film** the clips (plan below).
2. **Batch evaluation** (*Research → Batch evaluation*): pick all the clips, tick *MediaPipe Full*
   and *YOLO11n-pose*, Run. Download `frames.csv` and `runs.csv` and keep them in `data/`.
3. **Mark joints** (*Research → Mark joints*): click the joints on a sample of frames. Download each
   clip's keypoints CSV into `data/`.
4. **Compare** (*Research → Compare*): anything from this session is already there; otherwise add
   the CSVs. You get the verdict, which model to use where, every table, charts (download as SVG)
   and a Markdown report.

## 1. Filming plan

Squats and push-ups, about 5 reps per clip, phone on a tripod, **1080p, 30 fps**, whole body in
frame. **Stand still for 1–2 seconds before the first rep** (the steadiness check uses the first
second).

| Camera setup | What | Why |
|---|---|---|
| `side` | side-on, hip height, 2–3 m, good light | the normal setup |
| `diagonal` | camera at 45° | joints overlap and look shorter |
| `dim` | low light | harder to see joints |
| `far` | about 4 m away | the body is small in the frame |

Film each exercise in each setup, with a mix of good and sloppy reps (deep, shallow, leaning,
sagging…), so the joints go through their whole range. Different days, clothes and people make
the results stronger.

**File names:** `P01_S1_squat_shallow_side.mp4` = person, session, exercise, what you did, camera
setup. The app reads the exercise and camera setup from the name. `P01` = you, `P02`… = friends,
`D01`… = clips from a public dataset.

## 2. Marking joints (the ground truth)

Open a clip, choose the side facing the camera, then click the joints in order: nose, ear,
shoulder, elbow, wrist, hip, knee, ankle. Press **S** if a joint isn't visible. ← → moves one
frame, Shift + ← → ten.

Mark about **3 frames per rep** (top, halfway down, bottom) on 2–3 reps of each clip, aiming for
**150–200 frames** spread across both exercises and all four camera setups. Click the centre of
each joint. Mark a clip before looking at the models' skeletons on it, so they don't pull your
clicks. Keep the frame rate at 30, the same as the batch run.

## What Compare reports

| Section | What it shows |
|---|---|
| Verdict | which model's angles are closer to the truth overall, whether that's significant, and which model to use in each situation |
| Angle accuracy | per angle (knee, elbow, hip, body line, neck, torso lean): mean and median error, RMSE, bias (reads too big or too small), % within 5° and 10°, % missed, Wilcoxon test |
| Which model where | angle error split by camera setup, exercise, how bent the joint is (under 90°, 90–140°, over 140°), angle, and whose clips, with the better model and p for each |
| Joint placement | PCK@0.1 / @0.2 and error per joint as % of torso length |
| Consistency (no marking needed, every frame) | person found %, steadiness in the first second, bone-length consistency (bones don't change length), angle jitter, agreement between the models (Bland–Altman) |
| Speed | ms per frame, 95th percentile, FPS, Wilcoxon test |

p-values come from paired Wilcoxon signed-rank tests on the same frames or clips: p < 0.05 means
one model really is closer, not just by chance.

## Things to write about in the paper

- **Same frames, same laptop.** Every frame is processed (the video is stepped, not played), so a
  slower model never skips frames. Time is measured around the model only.
- **YOLO has 17 points and no feet.** It can't measure anything that needs the heel or toes.
- **MediaPipe smooths over time, YOLO doesn't.** MediaPipe's VIDEO mode tracks the person between
  frames; YOLO looks at each frame on its own. This shows up in steadiness and jitter.
- **Where they run.** MediaPipe on the GPU through WebGL; YOLO through ONNX Runtime Web on WebGPU,
  or on the CPU (wasm) if WebGPU isn't available. `runs.csv` records which.
- **Hand marks have error too.** One person clicking joints is the reference, not perfect truth. If
  you can, mark 20–30 frames twice, a week apart, and report how far apart your own clicks are.
- **Two-dimensional angles.** Angles are measured in the image, so camera angle changes them. That
  is exactly what the diagonal clips test.
