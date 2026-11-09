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
    family: 'mediapipe' | 'yolo'
    note: string
}

export const POSE_MODELS: PoseModelInfo[] = [
    { id: 'mediapipe-full', name: 'MediaPipe Full', family: 'mediapipe', note: '33 points, the default' },
    { id: 'mediapipe-lite', name: 'MediaPipe Lite', family: 'mediapipe', note: '33 points, fastest MediaPipe' },
    { id: 'mediapipe-heavy', name: 'MediaPipe Heavy', family: 'mediapipe', note: '33 points, most accurate MediaPipe' },
    { id: 'yolo11n', name: 'YOLO11n-pose', family: 'yolo', note: '17 points, no feet' },
    { id: 'yolo11s', name: 'YOLO11s-pose', family: 'yolo', note: '17 points, no feet, larger' },
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
}

export async function loadPoseModel(id: string): Promise<PoseModel> {
    const info = modelInfo(id)
    return info.family === 'yolo' ? loadYolo(info) : loadMediaPipe(info)
}

// ---------- MediaPipe ----------

async function loadMediaPipe(info: PoseModelInfo): Promise<PoseModel> {
    const variant = info.id.replace('mediapipe-', '') // lite | full | heavy
    const vision = await FilesetResolver.forVisionTasks('/wasm')
    const landmarker = await PoseLandmarker.createFromOptions(vision, {
        baseOptions: {
            modelAssetPath: `https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_${variant}/float16/1/pose_landmarker_${variant}.task`,
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

async function loadYolo(info: PoseModelInfo): Promise<PoseModel> {
    const ort = await import('onnxruntime-web/webgpu')
    ort.env.wasm.wasmPaths = `${location.origin}/ort/`

    const url = `/models/${info.id}-pose.onnx`
    let session: Awaited<ReturnType<typeof ort.InferenceSession.create>>
    let backend = 'webgpu'
    try {
        if (!('gpu' in navigator)) throw new Error('no WebGPU')
        session = await ort.InferenceSession.create(url, { executionProviders: ['webgpu'] })
    } catch {
        backend = 'wasm'
        session = await ort.InferenceSession.create(url, { executionProviders: ['wasm'] })
    }

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
