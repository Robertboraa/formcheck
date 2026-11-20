// The pose models FormCheck can use. Each one turns a video frame into body landmarks.
// All models return landmarks in MediaPipe's numbering (33 points), so the rest of the app
// (exercises.ts, engine.ts) works the same whichever model is running.

import { FilesetResolver, PoseLandmarker } from '@mediapipe/tasks-vision'

// one body point: x and y from 0 to 1 across the frame, visibility from 0 (not seen) to 1
export type Landmark = { x: number; y: number; visibility: number }

// what a model returns for one frame
export type PoseResult = {
    landmarks?: Landmark[] // undefined = no person found
    ms: number // time spent on this frame: preparing the image, running the model, reading the output
}

export type PoseModelInfo = {
    id: string
    name: string
    family: 'mediapipe' | 'yolo' | 'movenet' | 'rtmo'
    note: string
    by: string // who made it
}

export const POSE_MODELS: PoseModelInfo[] = [
    { id: 'mediapipe-full', name: 'MediaPipe Full', family: 'mediapipe', by: 'Google', note: '33 points, the default' },
    { id: 'mediapipe-lite', name: 'MediaPipe Lite', family: 'mediapipe', by: 'Google', note: '33 points, fastest MediaPipe' },
    { id: 'mediapipe-heavy', name: 'MediaPipe Heavy', family: 'mediapipe', by: 'Google', note: '33 points, most accurate MediaPipe' },
    { id: 'yolo11n', name: 'YOLO11n-pose', family: 'yolo', by: 'Ultralytics', note: '17 points, no feet' },
    { id: 'yolo11s', name: 'YOLO11s-pose', family: 'yolo', by: 'Ultralytics', note: '17 points, no feet, larger' },
    { id: 'movenet-lightning', name: 'MoveNet Lightning', family: 'movenet', by: 'Google', note: '17 points, built for fast fitness apps' },
    { id: 'movenet-thunder', name: 'MoveNet Thunder', family: 'movenet', by: 'Google', note: '17 points, the more accurate MoveNet' },
    { id: 'rtmo-s', name: 'RTMO-s', family: 'rtmo', by: 'OpenMMLab (RTMPose family)', note: '17 points, needs a one-time download (npm run get-rtmo)' },
]

export const DEFAULT_MODEL = 'mediapipe-full'

export function modelInfo(id: string) {
    return POSE_MODELS.find((m) => m.id === id) ?? POSE_MODELS[0]
}

export interface PoseModel {
    info: PoseModelInfo
    backend: string // where it runs: 'GPU', 'webgpu' or 'wasm'
    points: number[] // which of the 33 landmark numbers this model fills in
    connections: [number, number][] // bones to draw
    detect: (video: HTMLVideoElement, timeMs: number) => Promise<PoseResult>
    close: () => void
    bytes: number // download size of the model files (0 = unknown)
}

type Loaded = Omit<PoseModel, 'bytes'>

const mediapipeUrl = (variant: string) =>
    `https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_${variant}/float16/1/pose_landmarker_${variant}.task`

// the files each model downloads, to report its size
function modelFiles(info: PoseModelInfo): string[] {
    if (info.family === 'mediapipe') return [mediapipeUrl(info.id.replace('mediapipe-', ''))]
    if (info.family === 'yolo') return [`/models/${info.id}-pose.onnx`]
    if (info.family === 'movenet') return [`/models/${info.id}/model.json`, `/models/${info.id}/${info.id}.bin`]
    return [`/models/${info.id}.onnx`]
}

async function sizeOf(urls: string[]) {
    let total = 0
    for (const url of urls) {
        try {
            const res = await fetch(url, { method: 'HEAD' })
            total += Number(res.headers.get('content-length') ?? 0) || 0
        } catch {
            // size unknown
        }
    }
    return total
}

export async function loadPoseModel(id: string): Promise<PoseModel> {
    const info = modelInfo(id)
    const loaded =
        info.family === 'yolo' ? await loadYolo(info) : info.family === 'movenet' ? await loadMoveNet(info) : info.family === 'rtmo' ? await loadRtmo(info) : await loadMediaPipe(info)
    return { ...loaded, bytes: await sizeOf(modelFiles(info)) }
}

// ---------- MediaPipe ----------

async function loadMediaPipe(info: PoseModelInfo): Promise<Loaded> {
    const variant = info.id.replace('mediapipe-', '') // lite | full | heavy
    const vision = await FilesetResolver.forVisionTasks('/wasm')
    const landmarker = await PoseLandmarker.createFromOptions(vision, {
        baseOptions: {
            modelAssetPath: mediapipeUrl(variant),
            delegate: 'GPU',
        },
        runningMode: 'VIDEO',
    })
    let lastTime = -1
    return {
        info,
        backend: 'GPU',
        points: Array.from({ length: 33 }, (_, i) => i),
        connections: PoseLandmarker.POSE_CONNECTIONS.map(({ start, end }) => [start, end]),
        async detect(video, timeMs) {
            // MediaPipe needs timestamps that always go up
            const t = Math.max(timeMs, lastTime + 1)
            lastTime = t
            const started = performance.now()
            const result = landmarker.detectForVideo(video, t)
            const ms = performance.now() - started
            const first = result.landmarks[0]
            return {
                ms,
                landmarks: first?.map((l) => ({ x: l.x, y: l.y, visibility: l.visibility ?? 0 })),
            }
        },
        close: () => landmarker.close(),
    }
}

// ---------- YOLO (Ultralytics YOLO11-pose, exported to ONNX, run with ONNX Runtime Web) ----------

// YOLO uses the 17 COCO keypoints; this is where each one goes in MediaPipe's numbering
// nose, eyes, ears, shoulders, elbows, wrists, hips, knees, ankles (left before right)
const COCO_TO_MEDIAPIPE = [0, 2, 5, 7, 8, 11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28]

const COCO_BONES: [number, number][] = [
    [0, 2], [0, 5], [2, 7], [5, 8], // face
    [11, 12], [11, 13], [13, 15], [12, 14], [14, 16], // arms
    [11, 23], [12, 24], [23, 24], // torso
    [23, 25], [25, 27], [24, 26], [26, 28], // legs
]

const SIZE = 640 // the model's input size
const MIN_PERSON_SCORE = 0.25

// ONNX Runtime Web: on the GPU through WebGPU when the browser has it, otherwise on the CPU (wasm)
async function onnxSession(url: string) {
    const ort = await import('onnxruntime-web/webgpu')
    ort.env.wasm.wasmPaths = `${location.origin}/ort/`
    try {
        if (!('gpu' in navigator)) throw new Error('no WebGPU')
        return { ort, backend: 'webgpu', session: await ort.InferenceSession.create(url, { executionProviders: ['webgpu'] }) }
    } catch {
        return { ort, backend: 'wasm', session: await ort.InferenceSession.create(url, { executionProviders: ['wasm'] }) }
    }
}

async function loadYolo(info: PoseModelInfo): Promise<Loaded> {
    const { ort, backend, session } = await onnxSession(`/models/${info.id}-pose.onnx`)

    // reused every frame
    const canvas = document.createElement('canvas')
    canvas.width = SIZE
    canvas.height = SIZE
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!
    const input = new Float32Array(3 * SIZE * SIZE)

    return {
        info,
        backend,
        points: COCO_TO_MEDIAPIPE,
        connections: COCO_BONES,
        async detect(video) {
            const started = performance.now()
            const w = video.videoWidth
            const h = video.videoHeight

            // 1. letterbox: scale the frame to fit 640×640 and pad the rest with grey, like Ultralytics does
            const scale = Math.min(SIZE / w, SIZE / h)
            const nw = Math.round(w * scale)
            const nh = Math.round(h * scale)
            const padX = Math.round((SIZE - nw) / 2 - 0.1)
            const padY = Math.round((SIZE - nh) / 2 - 0.1)
            ctx.fillStyle = 'rgb(114,114,114)'
            ctx.fillRect(0, 0, SIZE, SIZE)
            ctx.drawImage(video, padX, padY, nw, nh)

            // 2. pixels → numbers from 0 to 1, one plane per colour (red, green, blue)
            const pixels = ctx.getImageData(0, 0, SIZE, SIZE).data
            const plane = SIZE * SIZE
            for (let i = 0; i < plane; i++) {
                input[i] = pixels[i * 4] / 255
                input[i + plane] = pixels[i * 4 + 1] / 255
                input[i + plane * 2] = pixels[i * 4 + 2] / 255
            }

            // 3. run the model; output is 56 rows × 8400 candidates:
            //    box (4), person score (1), then 17 keypoints × (x, y, confidence)
            const tensor = new ort.Tensor('float32', input, [1, 3, SIZE, SIZE])
            const output = await session.run({ [session.inputNames[0]]: tensor })
            const data = output[session.outputNames[0]].data as Float32Array
            const n = data.length / 56

            // 4. keep the candidate with the highest person score (one person per clip)
            let best = -1
            let bestScore = MIN_PERSON_SCORE
            for (let i = 0; i < n; i++) {
                if (data[4 * n + i] > bestScore) {
                    bestScore = data[4 * n + i]
                    best = i
                }
            }
            if (best < 0) return { ms: performance.now() - started }

            // 5. undo the letterbox and put each keypoint in its MediaPipe slot
            const landmarks: Landmark[] = Array.from({ length: 33 }, () => ({ x: 0, y: 0, visibility: 0 }))
            for (let k = 0; k < 17; k++) {
                const x = (data[(5 + k * 3) * n + best] - padX) / scale / w
                const y = (data[(6 + k * 3) * n + best] - padY) / scale / h
                const visibility = data[(7 + k * 3) * n + best]
                landmarks[COCO_TO_MEDIAPIPE[k]] = { x, y, visibility }
            }
            return { ms: performance.now() - started, landmarks }
        },
        close: () => {
            session.release()
        },
    }
}

// ---------- MoveNet (Google, TensorFlow.js) ----------
// Single-person model made for fitness apps. Run through Google's pose-detection library, which also
// crops around the person using the previous frame, as MoveNet is meant to be used.

async function loadMoveNet(info: PoseModelInfo): Promise<Loaded> {
    const tf = await import('@tensorflow/tfjs-core')
    await import('@tensorflow/tfjs-backend-webgl')
    const poseDetection = await import('@tensorflow-models/pose-detection')
    await tf.setBackend('webgl')
    await tf.ready()
    const thunder = info.id === 'movenet-thunder'
    const detector = await poseDetection.createDetector(poseDetection.SupportedModels.MoveNet, {
        modelType: thunder ? poseDetection.movenet.modelType.SINGLEPOSE_THUNDER : poseDetection.movenet.modelType.SINGLEPOSE_LIGHTNING,
        modelUrl: `/models/${info.id}/model.json`,
        enableSmoothing: false, // raw model output, like YOLO; MediaPipe's tracking is part of its model
    })
    return {
        info,
        backend: tf.getBackend(),
        points: COCO_TO_MEDIAPIPE,
        connections: COCO_BONES,
        async detect(video, timeMs) {
            const started = performance.now()
            const poses = await detector.estimatePoses(video, { maxPoses: 1, flipHorizontal: false }, timeMs)
            const ms = performance.now() - started
            const kps = poses[0]?.keypoints
            if (!kps || !(poses[0].score === undefined || poses[0].score > 0.1)) return { ms }
            const w = video.videoWidth
            const h = video.videoHeight
            const landmarks: Landmark[] = Array.from({ length: 33 }, () => ({ x: 0, y: 0, visibility: 0 }))
            kps.slice(0, 17).forEach((k, i) => {
                landmarks[COCO_TO_MEDIAPIPE[i]] = { x: k.x / w, y: k.y / h, visibility: k.score ?? 0 }
            })
            return { ms, landmarks }
        },
        close: () => detector.dispose(),
    }
}

// ---------- RTMO (OpenMMLab, RTMPose family, ONNX) ----------
// One-stage model: finds people and their joints in one pass. Pre- and post-processing follow
// OpenMMLab's rtmlib: the frame is scaled to fit 640×640, padded grey at the bottom/right, in BGR
// order with no normalisation; outputs are boxes (x1, y1, x2, y2, score) and 17 keypoints (x, y, score).

async function loadRtmo(info: PoseModelInfo): Promise<Loaded> {
    const url = `/models/${info.id}.onnx`
    const check = await fetch(url, { method: 'HEAD' })
    if (!check.ok || (check.headers.get('content-type') ?? '').includes('text/html'))
        throw new Error(`${info.name} isn't downloaded yet. In the terminal, in the formcheck folder, run: npm run get-rtmo`)
    const { ort, backend, session } = await onnxSession(url)

    const canvas = document.createElement('canvas')
    canvas.width = SIZE
    canvas.height = SIZE
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!
    const input = new Float32Array(3 * SIZE * SIZE)

    return {
        info,
        backend,
        points: COCO_TO_MEDIAPIPE,
        connections: COCO_BONES,
        async detect(video) {
            const started = performance.now()
            const w = video.videoWidth
            const h = video.videoHeight
            const ratio = Math.min(SIZE / w, SIZE / h)
            ctx.fillStyle = 'rgb(114,114,114)'
            ctx.fillRect(0, 0, SIZE, SIZE)
            ctx.drawImage(video, 0, 0, Math.floor(w * ratio), Math.floor(h * ratio))
            const pixels = ctx.getImageData(0, 0, SIZE, SIZE).data
            const plane = SIZE * SIZE
            for (let i = 0; i < plane; i++) {
                input[i] = pixels[i * 4 + 2] // blue
                input[i + plane] = pixels[i * 4 + 1] // green
                input[i + plane * 2] = pixels[i * 4] // red
            }
            const output = await session.run({ [session.inputNames[0]]: new ort.Tensor('float32', input, [1, 3, SIZE, SIZE]) })
            const tensors = session.outputNames.map((n) => output[n])
            const dets = tensors.find((t) => t.dims.length === 3)
            const kpts = tensors.find((t) => t.dims.length === 4)
            if (!dets || !kpts) return { ms: performance.now() - started }
            const d = dets.data as Float32Array
            const k = kpts.data as Float32Array
            const people = dets.dims[1]
            let best = -1
            let bestScore = 0.3
            for (let p = 0; p < people; p++) {
                if (d[p * 5 + 4] > bestScore) {
                    bestScore = d[p * 5 + 4]
                    best = p
                }
            }
            if (best < 0) return { ms: performance.now() - started }
            const landmarks: Landmark[] = Array.from({ length: 33 }, () => ({ x: 0, y: 0, visibility: 0 }))
            for (let j = 0; j < 17; j++) {
                const o = (best * 17 + j) * 3
                landmarks[COCO_TO_MEDIAPIPE[j]] = { x: k[o] / ratio / w, y: k[o + 1] / ratio / h, visibility: k[o + 2] }
            }
            return { ms: performance.now() - started, landmarks }
        },
        close: () => {
            session.release()
        },
    }
}
