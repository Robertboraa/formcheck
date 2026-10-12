# FormCheck

A browser app that watches you exercise through your phone's camera and tells you, rep by rep, what to fix in your form.

It runs Google's MediaPipe pose model directly in the browser, measures joint angles every frame, and judges each rep with transparent, data-calibrated rules. Nothing is uploaded: the video never leaves the device.

> Capstone project, BSc Software Engineering, Bahçeşehir University: *AI-Powered Gym Movement Form Analyzer*.

<!-- Add a demo GIF here: video with skeleton on the left, live angle chart on the right -->

## Status

Work in progress.

| Exercise | Rep counting | Form rules | Thresholds |
|---|---|---|---|
| Bodyweight squat | Done | Depth, forward lean, neck alignment, weight on toes, heel lift | Partly calibrated from recorded clips |
| Dips | Done | Depth, too deep, bent legs | Placeholders, calibration in progress |
| Pull-ups | Planned | | |
| Dumbbell shoulder press | Planned | | |
| Dumbbell incline press | Stretch goal | | |

## Features

- **Live camera or uploaded video.** Analyse yourself in real time, or upload a recorded set.
- **Skeleton overlay** on the video, with a **live joint-angle chart** beside it.
- **Hands-free rep counting.** The app waits until you are in position before it starts counting, and pauses when you walk away.
- **Works from either side.** It picks whichever side of the body faces the camera.
- **Per-rep feedback.** Every rep gets a verdict and its measurements, for example:
  `Sit back, your weight is on your toes | depth 47° | lean 31° | neck 168° | heels 6° | balance 84% | knee 189% | shin 49°`
- **Session summary** with totals, the full rep log, and a button to copy the results.
- **On-device.** No server, no uploads.

## How it works

```
camera / video file
      │
      ▼
MediaPipe Pose Landmarker (WebAssembly, GPU)   →  33 body landmarks per frame
      │
      ▼
joint angles and positions  →  smoothing (exponential moving average)
      │
      ▼
rep state machine:  waiting → up → down → up (rep counted)
      │
      ▼
worst value of each measurement during the rep  →  rules  →  verdict and cues
```

- **Angles are computed in pixel coordinates**, not MediaPipe's normalised 0–1 values, so a wide frame doesn't distort them.
- **Two thresholds per rep** (for the squat, knee below 130° to start a rep and above 160° to finish it), so jitter around a single value can't count extra reps.
- **Smoothing** blends 70% of the previous value with 30% of the new one, so a single bad frame can't trigger a cue.
- **Visibility checks.** A rule is only applied when MediaPipe can clearly see the joints it depends on. The app says less rather than guess.
- **Exercises are configuration.** Everything specific to an exercise (the angle that drives rep counting, the thresholds, the measurements and the rules) lives in `src/exercises.ts`. Adding an exercise means adding one entry there.

## Rules are calibrated from data, not textbooks

Textbook angle values don't account for pose-estimation noise or natural variation between people, so thresholds are set from recorded clips.

**Example: detecting weight on the toes.** A test participant kept his weight on his toes during squats, with his heels only lifting in some reps. Depth, lean and neck angles could not tell his reps apart from good ones. So a new measurement was added: an estimate of the body's centre of mass, as a position along the foot (0% above the heel, 100% above the toes). Comparing his clip with a good-form clip:

| Measurement | Forward-weighted reps (16) | Good-form reps (11) |
|---|---|---|
| Balance | 64 to 88% | 21 to 33% |
| Heel lift | 0 to 14° | 4 to 7° |

Balance separated the two cleanly, while heel lift alone would have missed half of the faulty reps. A threshold of 50% now flags all 16 forward-weighted reps and none of the good ones.

This is two people and one clip each, so the threshold still needs confirming on more participants.

## Tech stack

- **React + TypeScript**, built with **Vite**
- **MediaPipe Tasks Vision** (Pose Landmarker, full model) running in the browser via WebAssembly
- **Canvas 2D** for the skeleton overlay and the angle chart

## Run it locally

Needs Node 20 or newer.

```bash
npm install
cp -r node_modules/@mediapipe/tasks-vision/wasm public/wasm
npm run dev
```

Open the `https://localhost:5173` address it prints. The development certificate is self-signed, so accept the browser warning once.

### On a phone

Put the phone on the same Wi-Fi as your computer and open the `Network:` address that `npm run dev` prints. It must be the `https://` one, because browsers only allow the camera on secure pages.

### Filming tips

- Phone fixed in place at about hip height, roughly 3 metres away, side-on.
- Whole body in frame, and hold the start position still for a second before the first rep.
- For uploaded iPhone videos, record with **Formats > Most Compatible** at **1080p, 30 fps**. HEVC/HDR `.mov` files play back slowly in the browser.

## Project structure

```
src/
  App.tsx         screens: start (exercise picker), session, summary
  Camera.tsx      video source, pose model, frame loop, rep state machine, drawing
  exercises.ts    one entry per exercise: thresholds, measurements, rules
vite.config.ts    HTTPS dev server, reachable on the local network
```

## Known limitations

- **One camera angle.** All current exercises are measured side-on, so faults only visible from the front (such as knees caving in) are not detected.
- **2D only.** Angles are measured in the image plane, so a camera that isn't side-on changes the numbers.
- **Some faults are invisible to joint angles**, such as a rounded back, bar path or elbow flare.
- **Objects can hide joints.** Barbell plates cover the shoulder, which is why the squat is bodyweight and the other exercises use dumbbells.
- **Thresholds come from a small number of people** so far.

## Roadmap

- [ ] Calibrate dips from recorded clips
- [ ] Pull-ups and dumbbell shoulder press
- [ ] Evaluation on a labelled test set from participants not used for calibration (precision, recall, rep-count accuracy, latency)
- [ ] Frame-by-frame analysis for uploaded videos, so heavy files never skip frames
- [ ] Visual design and a deployed live link
- [ ] Optional AI-written session summary (the rules stay the judge; the AI only explains the results)

## Author

Bora Robert Orhan · [github.com/Robertboraa](https://github.com/Robertboraa)
