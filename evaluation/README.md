# Evaluation: comparing pose models

The question: **which pose model measures joint angles more accurately, and which one is better to
use in which situation?**

The models run on the same videos, frame by frame. On a sample of frames the joints are marked by
hand; the angles from those marks are the ground truth. Each model's angles are compared with
them, overall and split by situation. Everything runs in the app: *Research*.

## The workflow: clip by clip

Open *Research → Clip by clip* and, for each video:

1. **Pick the clip.** The ticked models run on every frame (a minute or two each).
2. **Mark the suggested frames.** The app picks the top, halfway down and bottom of the first three
   reps. Click the 8 joints on each; when a frame is done the next one opens.
3. **Type the real number of reps** in the clip (it lets Results check each model's rep counting).
4. **See that clip's result:** which model was closer to your marks, per angle.
5. **Done · next clip.**

Everything is saved in the browser as you go (refreshing or closing is fine). *Results* adds up
every clip: the verdict, which model to use where, all the tables, charts (SVG) and a Markdown
report. Use *Download backup* there now and then: the data lives only in this browser.

*Batch run* and *Mark joints* do the same steps separately, for many clips at once or extra frames.

## The models

| Model | Made by | Joints | Runs on |
|---|---|---|---|
| MediaPipe Pose (Lite / Full / Heavy) | Google | 33 | MediaPipe Tasks, GPU (WebGL) |
| YOLO11n / YOLO11s-pose | Ultralytics | 17 | ONNX Runtime Web (WebGPU, or CPU) |
| MoveNet Lightning / Thunder | Google | 17 | TensorFlow.js (WebGL), with its own crop-around-the-person tracking |
| RTMO-s | OpenMMLab (RTMPose family) | 17 | ONNX Runtime Web (WebGPU, or CPU) |

The default comparison is **MediaPipe Full, YOLO11n-pose, MoveNet Thunder and RTMO-s**: one model
from each family. Tick others in Clip by clip to add them; your hand marks are shared by all.

**RTMO needs a one-time download** (OpenMMLab hosts it as a zip):

```
npm run get-rtmo
```

This saves `public/models/rtmo-s.onnx`. Commit it, so anyone who clones the repo has it too.

With more than two models, every "is it really better?" test compares the best model with the
runner-up, and the table of every pair uses Holm-corrected p-values.

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
| Which model where | angle error split by camera setup, exercise, rep phase (top / halfway / bottom), how bent the joint is, person size in the frame, angle, person and whose clips, with the best model and p (vs the runner-up) for each |
| Joint placement | PCK@0.1 / @0.2 and error per joint as % of torso length |
| Consistency (no marking needed, every frame) | person found %, steadiness in the first second, bone-length consistency (bones don't change length), angle jitter, agreement between the models (Bland–Altman) |
| Speed | ms per frame, 95th percentile, FPS, Wilcoxon test; download size and start-up time |
| What the data says | the findings written out in plain words at the top: accuracy, where each model is better, bottom of the rep, confidence, consistency, rep counting, speed, a recommendation |
| Worst frames | for each model, the marked frames where it was furthest from your marks, drawn over the video (choose the clips again to see them; click to download) |
| Confidence | whether each model's own confidence score predicts its error (Spearman ρ, AUROC, error by score band) |
| Rep counting | FormCheck's squat/push-up rules run on each model's joints; counted reps vs the real number you type in for each clip, and how often the models agree on good/bad |

p-values come from paired Wilcoxon signed-rank tests on the same frames or clips: p < 0.05 means
one model really is closer, not just by chance.

## Things to write about in the paper

- **Same frames, same laptop.** Every frame is processed (the video is stepped, not played), so a
  slower model never skips frames. Time is measured around the model only.
- **Only MediaPipe has feet.** YOLO, MoveNet and RTMO use the 17 COCO points (no heel or toes).
- **Different ways of finding the person.** MediaPipe and MoveNet track the person from frame to
  frame; YOLO and RTMO look at each frame on its own (smoothing is switched off for MoveNet so all
  results are the models' own output).
- **Where they run.** MediaPipe and MoveNet on the GPU through WebGL; YOLO and RTMO through ONNX
  Runtime Web on WebGPU, or on the CPU (wasm) if WebGPU isn't available. `runs.csv` records which.
- **Hand marks have error too.** One person clicking joints is the reference, not perfect truth. If
  you can, mark 20–30 frames twice, a week apart, and report how far apart your own clicks are.
- **Two-dimensional angles.** Angles are measured in the image, so camera angle changes them. That
  is exactly what the diagonal clips test.
