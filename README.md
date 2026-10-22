# FormCheck

A web app that watches you exercise through your camera and tells you, rep by rep, what to fix in your form. Sign in to save your sessions and track your progress over time.

Google's MediaPipe pose model runs directly in the browser. It measures joint angles every frame and judges each rep with transparent rules whose thresholds were set from recorded clips. The video never leaves the device: only the numbers about each rep are saved, and only if you sign in.

> Capstone project, BSc Software Engineering, Bahçeşehir University: *AI-Powered Gym Movement Form Analyzer*.

<!-- Add a demo GIF here: video with skeleton on the left, live panel on the right -->

## Status

| Exercise | Rep counting | Form rules | Thresholds |
|---|---|---|---|
| Bodyweight squat | Done | Depth, forward lean, looking down, weight on the toes | Set from recorded clips, tested on new people and a public dataset |
| Push-ups | Done | Depth, lockout at the top, hips sagging, hips piked, head down | Set from recorded clips of one person |
| Dips | Paused | Depth, kicking legs | The bars hide the arms too often for reliable counting |

## Features

- **Live camera or uploaded video.** Analyse yourself in real time, or upload a recorded set.
- **Skeleton overlay** on the video with a **live joint-angle chart**.
- **Hands-free rep counting.** Waits until you are in position, and pauses when you walk away or step off the equipment.
- **Spoken cues** in a British English voice after every rep ("3, go lower").
- **Shows where the fault is.** After each rep the body part at fault lights up orange on the skeleton (the back, the hips, the arms, the head or the feet), or the body lights up green for a good rep.
- **Session summary**: form score, most common fault, best and worst rep, a depth chart and every rep's measurements.
- **Accounts and history.** Sign in to save sessions, see your form score over time, and compare each session with the previous one ("+12% vs last time, 4° deeper").

## Architecture

```
Browser (React + TypeScript)                         API (Node + Express)          PostgreSQL
┌──────────────────────────────────────────────┐    ┌──────────────────────────┐   ┌────────────┐
│ camera / video → MediaPipe Pose (WASM, GPU)  │    │ /api/auth   register,    │   │ users      │
│   → joint angles → smoothing                 │    │             login, me    │   │ sessions   │
│   → rep state machine → rules → verdict      │───▶│ /api/sessions save, list,│──▶│ reps       │
│ video stays here; only rep numbers are sent  │JSON│             get, delete  │SQL└────────────┘
└──────────────────────────────────────────────┘    └──────────────────────────┘
```

### Form analysis (in the browser)

- **Angles are computed in pixel coordinates**, not MediaPipe's normalised 0–1 values, so a wide frame doesn't distort them.
- **Rep counting follows the movement.** A rep is the main angle (knee or elbow) dropping by a set range from wherever the top is, then rising by that range from wherever the bottom is. People who never fully lock out, or who do half reps, are still counted, and depth and lockout are judged separately.
- **The body must actually move.** A rep only counts if the shoulders rise as the joint straightens, so stepping off the equipment isn't counted.
- **Smoothing** (an exponential moving average) stops a single bad frame from triggering a cue.
- **Visibility checks.** A rule is only applied when MediaPipe can clearly see the joints it depends on. The app says less rather than guess.
- **Exercises are configuration.** Everything specific to an exercise lives in `src/exercises.ts`: the angle that drives counting, the measurements, and the rules, each pointing at the body part it's about.

### Accounts and storage (the API)

- **Passwords** are hashed with bcrypt (cost 12). Sign-in uses a JWT in an **http-only cookie**, so the page's JavaScript can never read it.
- **The same error** is returned for a wrong password and an unknown email, so accounts can't be discovered. Sign-in attempts are **rate-limited**.
- **Every query is scoped to the signed-in user**, so a user can never read or delete someone else's sessions.
- **Input is validated** with Zod, and a session and its reps are saved in **one transaction**.
- **Tested** with Vitest and Supertest against a real PostgreSQL test database (13 tests: registration, sign-in, privacy between users, saving, listing, deleting, bad input).

## How the rules were found

Every rule started as a measurement printed in the log, with no rule attached. A threshold was only added once recorded clips showed the measurement separating good reps from faulty ones.

### Squat

**Weight on the toes.** A participant kept his weight on his toes, with his heels only lifting on some reps. Depth, lean and neck angles couldn't tell his reps apart from good ones, so a new measurement was added: an estimate of the body's centre of mass, placed along the foot.

| | Forward-weighted reps (16) | Good-form reps (11) |
|---|---|---|
| Balance | 64 to 88% | 21 to 33% |
| Heel lift | 0 to 14° | 4 to 7° |

Balance separated the two cleanly. Heel lift alone would have missed half of the faulty reps.

**Depth: knee angle replaced by thigh angle.** The knee angle at which someone reaches parallel depends on how far their shins tip forward: across three participants it ranged from about 40° to 77°. Measuring the thigh's angle from horizontal judges depth directly.

**Rules dropped after testing on new people:** looking up (misfired on 6 of 8 normal reps), heel lift (unreliable) and neck angle (didn't separate any case).

| Fault | Measured by | Flags when |
|---|---|---|
| Not deep enough | Thigh angle from horizontal | Below −22° |
| Forward lean | Torso tilt from vertical | Above 40° |
| Looking down | Tilt of the ear-to-nose line | Below −38° |
| Weight on the toes | Centre of mass along the foot | Above 50%, only when not leaning |

### Push-ups

Clips were recorded with one fault each: good reps, shallow reps, sagging hips, piked hips, no lockout and looking at the stomach.

| Fault | Measured by | Good reps | Faulty reps | Flags when |
|---|---|---|---|---|
| Not deep enough | Lowest elbow angle | 42–55° | 63–87° | Above 62° |
| No lockout | Highest elbow angle before the rep | 156–179° | 116–140° | Below 150° |
| Hips sagging | Hip below the shoulder–ankle line | 2–7% | 8–11% | Above 7.5% |
| Hips piked | Hip above the shoulder–ankle line | 0 to +6% | −8 to −20% | Below −7% |
| Head down | Ear–shoulder–hip angle | 144–178° | 127–128° | Below 135° |

With these thresholds every rep in the clips gets the right verdict. Sag has the smallest gap (about 1%), so it needs confirming on more people.

## Testing

- **Calibration:** clips of the author and two other participants.
- **Testing on new people:** bodyweight squats from the public [multi-view fitness dataset](https://data.mendeley.com/datasets/kgbb3yn47p/2) (26 people, side view, good/bad form labels).
- **API:** `npm test` runs the server tests.
- Formal numbers (precision, recall, rep-count accuracy and latency on participants not used for calibration) are in progress.

## Tech stack

- **Frontend:** React, TypeScript, Vite, MediaPipe Tasks Vision (WebAssembly), Canvas 2D
- **Backend:** Node, Express 5, TypeScript, PostgreSQL (`pg`), bcrypt, JSON Web Tokens, Zod, Helmet
- **Tests:** Vitest, Supertest

## Run it locally

Needs Node 20 or newer and PostgreSQL.

```bash
# 1. PostgreSQL (macOS with Homebrew)
brew install postgresql@17
brew services start postgresql@17
echo 'export PATH="/opt/homebrew/opt/postgresql@17/bin:$PATH"' >> ~/.zshrc && source ~/.zshrc
createdb formcheck
createdb formcheck_test

# 2. API settings
printf 'DATABASE_URL=postgres://localhost:5432/formcheck\nJWT_SECRET=%s\nPORT=3001\n' "$(openssl rand -hex 32)" > server/.env

# 3. Install and run (installs the server too)
npm install
npm run dev
```

`npm run dev` starts the web app and the API together. Open the `https://localhost:5173` address it prints and accept the self-signed certificate warning once. The app works without the API too, just without accounts.

**On a phone:** connect to the same Wi-Fi and open the `https://` `Network:` address. Browsers only allow the camera on secure pages.

### Filming tips

- Phone fixed in place at about hip height, roughly 3 metres away, side-on.
- Whole body in frame, standing still for a moment before the first rep.
- Uploaded videos must be **H.264**. On an iPhone, record with **Formats > Most Compatible**; to convert existing files:

  ```bash
  for f in *.mp4; do ffmpeg -i "$f" -c:v libx264 -pix_fmt yuv420p -crf 20 -an "converted/$f"; done
  ```

## Project structure

```
src/
  App.tsx          screens and navigation
  Camera.tsx       video, pose model, frame loop, rep counting, skeleton drawing
  exercises.ts     one entry per exercise: measurements, thresholds, rules
  Summary.tsx      session summary and comparison with the previous session
  History.tsx      saved sessions and progress chart
  Auth.tsx         sign in and create account
  api.ts           calls to the API
  index.css        design tokens and styles
server/
  src/app.ts       Express app: security headers, JSON, routes, error handling
  src/auth.ts      register, login, logout, current user
  src/sessions.ts  save, list, get and delete sessions
  src/schema.sql   database tables
  test/            API tests
```

## Known limitations

- **One camera angle.** Rules are built for side-on filming, so faults only visible from the front (such as knees caving in) aren't detected.
- **2D only.** Angles are measured in the image plane.
- **Landmark noise.** A rep that sits right on a threshold can flip between verdicts.
- **Some faults are invisible to joint angles,** such as a rounded back or bar path.
- **Objects can hide joints,** which is why the squat is bodyweight and dips are paused.

## Roadmap

- [ ] Evaluation on participants not used for calibration (precision, recall, rep-count accuracy, latency)
- [ ] Deploy the app and API with a live link
- [ ] Bundle the pose model so the analysis works offline
- [ ] Pull-ups and dumbbell shoulder press
- [ ] Optional AI-written session summary (the rules stay the judge; the AI only explains the results)

## Author

Bora Robert Orhan · [github.com/Robertboraa](https://github.com/Robertboraa)
