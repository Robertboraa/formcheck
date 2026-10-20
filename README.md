# FormCheck

A browser app that watches you exercise through your phone's camera and tells you, rep by rep, what to fix in your form.

It runs Google's MediaPipe pose model directly in the browser, measures joint angles every frame, and judges each rep with transparent rules whose thresholds were set from recorded clips. Nothing is uploaded: the video never leaves the device.

> Capstone project, BSc Software Engineering, Bahçeşehir University: *AI-Powered Gym Movement Form Analyzer*.

<!-- Add a demo GIF here: video with skeleton on the left, live angle chart on the right -->

## Status

Work in progress.

| Exercise | Rep counting | Form rules | Thresholds |
|---|---|---|---|
| Bodyweight squat | Done | Depth, forward lean, looking down, weight on toes | Set from recorded clips, tested on new people and a public dataset |
| Dips | Done | Depth, too deep, leg kicking | Placeholders, calibration in progress |
| Push-ups | Done | Depth, hips sagging, hips piked | Placeholders, calibration in progress |
| Pull-ups | Planned | | |
| Dumbbell shoulder press | Planned | | |

## Features

- **Live camera or uploaded video.** Analyse yourself in real time, or upload a recorded set.
- **Skeleton overlay** on the video, with a **live joint-angle chart** beside it.
- **Hands-free rep counting.** The app waits until you are in position before it starts counting, and pauses when you walk away.
- **Works from either side.** It picks whichever side of the body faces the camera.
- **Spoken cues.** After every rep the app says the rep number and the main cue out loud ("4, almost there"), in a British English voice, so you don't need to look at the screen mid-set.
- **Feedback scaled to the fault.** A rep that's nearly right gets a gentle nudge; a clearly wrong one gets a stronger cue with a tip.
- **Per-rep feedback.** Every rep gets a verdict and its measurements, for example:
  `Go lower next time | depth 96° | thigh -40° | lean 25° | head up -27° | balance 42%`
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

## Squat rules

| Fault | Measured by | Flags when |
|---|---|---|
| Not deep enough | Thigh angle from horizontal (0° = parallel) | Below -22° |
| Forward lean | Torso tilt from vertical | Above 40° |
| Looking down | Tilt of the ear-to-nose line | Below -38° |
| Weight on the toes | Centre-of-mass estimate along the foot (0% heel, 100% toes) | Above 50%, only when not leaning |

## Dips and push-up rules

Both use the elbow angle to count reps (below 120° starts a rep, above 150° finishes it). Their thresholds are first guesses and will be set from recorded clips, the same way as the squat.

| Exercise | Fault | Measured by | Flags when |
|---|---|---|---|
| Dips | Not deep enough | Smallest elbow angle | Above 100° |
| Dips | Too deep | Smallest elbow angle | Below 60° |
| Dips | Kicking the legs | Change in knee angle from the start position | More than 25° |
| Push-ups | Not deep enough | Smallest elbow angle | Above 100° |
| Push-ups | Hips sagging | Hip distance below the shoulder-to-ankle line, as % of body length | Above 6% |
| Push-ups | Hips piked up | The same measurement, hips above the line | Below -3% |

On dips, bent legs are allowed, since many people cross their feet when the bars are low. The rule only checks that the legs stay still, comparing each rep against the leg position at the start.

The app also logs measurements that don't have rules yet, such as shoulder shrug and hip swing on dips, and neck position on push-ups.

## How the squat rules were found

Every squat rule started as a measurement printed in the log, with no rule attached. A threshold was only added once recorded clips showed the measurement separating good reps from faulty ones.

**Weight on the toes.** A participant kept his weight on his toes, with his heels only lifting on some reps. Depth, lean and neck angles couldn't tell his reps apart from good ones, so a new measurement was added: an estimate of the body's centre of mass, placed along the foot.

| | Forward-weighted reps (16) | Good-form reps (11) |
|---|---|---|
| Balance | 64 to 88% | 21 to 33% |
| Heel lift | 0 to 14° | 4 to 7° |

Balance separated the two cleanly. Heel lift alone would have missed half of the faulty reps.

**Depth: knee angle replaced by thigh angle.** Depth was first judged by the knee angle, but the knee angle at which someone reaches parallel depends on how far their shins tip forward: across three participants, "parallel" ranged from about 40° to 77° of knee angle. On dataset clips, reps the app passed were visibly too shallow. Measuring the thigh's angle from horizontal judges depth directly: reps that were deep enough read -12 and -16°, shallow ones -28 to -40°.

**Head position.** The original neck rule (ear–shoulder–hip angle) turned out to be blind to looking up: a head tilted back rotates around a point near the ear, so the angle barely changes. The tilt of the ear-to-nose line separates the cases instead:

| | Head up |
|---|---|
| Looking at the ceiling | 7 to 15° |
| Neutral, looking slightly down | -28 to -9° |
| Looking down at the floor | -64 to -48° |

**Rules that were dropped after testing on new people:**

- **Looking up.** A participant looking straight ahead read 0 to 4°, only a few degrees from a participant looking at the ceiling. The rule misfired on 6 of 8 normal reps, so it was removed.
- **Heel lift.** Its threshold sat within a degree or two of good reps and was unreliable.
- **Neck angle.** It didn't separate any of the cases above.

**Lean and balance are correlated.** The centre-of-mass estimate weights the trunk heavily, so a strong forward lean also pushes the balance number up. When a rep is leaning, the app gives only the lean cue, since fixing the lean usually fixes the balance.

## Testing

- **Calibration:** clips of two participants.
- **Testing on new people:** a third participant, plus bodyweight squats from the public [multi-view fitness dataset](https://data.mendeley.com/datasets/kgbb3yn47p/2) (26 people, side view, good/bad form labels).

Results on the dataset were good for forward lean and looking down. Weight on the toes was sometimes flagged on reps that were really leaning forward, which led to the one-cue rule above.

Formal numbers (precision, recall and rep-count accuracy on the dataset) are in progress.

## Tech stack

- **React + TypeScript**, built with **Vite**
- **MediaPipe Tasks Vision** (Pose Landmarker, full model) running in the browser via WebAssembly
- **Canvas 2D** for the skeleton overlay and the angle chart

## Run it locally

Needs Node 20 or newer.

```bash
npm install
npm run dev
```

Open the `https://localhost:5173` address it prints. The development certificate is self-signed, so accept the browser warning once. The pose model downloads from Google's servers on first load, so an internet connection is needed.

### On a phone

Put the phone on the same Wi-Fi as your computer and open the `Network:` address that `npm run dev` prints. It must be the `https://` one, because browsers only allow the camera on secure pages.

### Filming tips

- Phone fixed in place, roughly 3 metres away, side-on, with the whole body in frame.
- **Squats:** phone at hip height. **Dips:** chest height, with the feet in view. **Push-ups:** low, near floor-to-knee height.
- Hold the start position still for a moment before the first rep: standing for squats, arms straight for dips and push-ups.
- Uploaded videos must be **H.264**. iPhone videos (HEVC) and some dataset videos won't play or will lag. On an iPhone, record with **Formats > Most Compatible**; to convert existing files:

```bash
  for f in *.mp4; do ffmpeg -i "$f" -c:v libx264 -pix_fmt yuv420p -crf 20 -an "converted/$f"; done
```

## Project structure

```
src/
  App.tsx         screens: start (exercise picker), session, summary
  Camera.tsx      video source, pose model, frame loop, rep state machine, drawing
  exercises.ts    one entry per exercise: thresholds, measurements, rules
scripts/
  copy-wasm.mjs   copies MediaPipe's WebAssembly files into public/wasm after npm install
vite.config.ts    HTTPS dev server, reachable on the local network
```

## Known limitations

- **One camera angle.** Rules are built for side-on filming. Diagonal or front views give wrong numbers, and faults only visible from the front (such as knees caving in) aren't detected.
- **2D only.** Angles are measured in the image plane.
- **Landmark noise.** The same clip gives slightly different numbers on each run, so a rep that sits right on a threshold can flip between verdicts.
- **Faces and bodies differ.** Head-position thresholds in particular vary between people.
- **Some faults are invisible to joint angles,** such as a rounded back or bar path.
- **Objects can hide joints.** Barbell plates cover the shoulder, which is why the squat is bodyweight.

## Roadmap

- [ ] Calibrate dips and push-ups from recorded clips
- [ ] Rules for shoulder shrug on dips and head position on push-ups
- [ ] Big rep counter with colour feedback, and a setup check with countdown
- [ ] Pull-ups and dumbbell shoulder press
- [ ] Precision, recall and rep-count accuracy on the full dataset
- [ ] Bundle the pose model so the app works offline
- [ ] Visual design and a deployed live link
- [ ] Optional AI-written session summary (the rules stay the judge; the AI only explains the results)

## Author

Bora Robert Orhan · [github.com/Robertboraa](https://github.com/Robertboraa)