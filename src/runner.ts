// Runs one video through one pose model, every frame, and returns where the model put each joint.
// Used by the Clip by clip tab and the Batch evaluation tab.
//
// The video is stepped frame by frame (not played), so a slower model never skips frames.
// The time per frame is measured around the model only, not the stepping.

import { JOINTS, frameTime, seek, exerciseFromName } from './csv'
import type { Landmark, PoseModel } from './pose'

export type Row = Record<string, string | number | null>

// which side of the body faces the camera: the side whose joints the model sees more clearly
export function sideOf(l: Landmark[] | undefined): 'l' | 'r' {
    if (!l) return 'l'
    const score = (ids: number[]) => ids.reduce((s, i) => s + (l[i]?.visibility ?? 0), 0)
    return score([11, 13, 15, 23, 25, 27]) >= score([12, 14, 16, 24, 26, 28]) ? 'l' : 'r'
}

// frame: also paint the video frame underneath (when the video itself isn't shown)
export function drawSkeleton(ctx: CanvasRenderingContext2D, model: PoseModel, l: Landmark[] | undefined, w: number, h: number, frame?: HTMLVideoElement) {
    ctx.clearRect(0, 0, w, h)
    if (frame) ctx.drawImage(frame, 0, 0, w, h)
    if (!l) return
    ctx.strokeStyle = 'rgba(255,255,255,0.85)'
    ctx.lineWidth = Math.max(3, w / 250)
    for (const [a, b] of model.connections) {
        ctx.beginPath()
        ctx.moveTo(l[a].x * w, l[a].y * h)
        ctx.lineTo(l[b].x * w, l[b].y * h)
        ctx.stroke()
    }
    ctx.fillStyle = '#f5c518'
    for (const p of model.points) {
        ctx.beginPath()
        ctx.arc(l[p].x * w, l[p].y * h, Math.max(4, w / 200), 0, Math.PI * 2)
        ctx.fill()
    }
}

type Options = {
    video: HTMLVideoElement // already loaded with the clip
    name: string // the clip's file name
    model: PoseModel
    fps: number
    exercise?: string
    canvas?: HTMLCanvasElement | null // optional preview of the skeleton
    drawFrame?: boolean // paint the video frame on the preview too
    shouldStop?: () => boolean
    onProgress?: (frame: number, frames: number) => void
    loadMs?: number // how long the model took to start up
}

export async function runClip({ video, name, model, fps, exercise, canvas, drawFrame, shouldStop, onProgress, loadMs }: Options) {
    const w = video.videoWidth
    const h = video.videoHeight
    const ctx = canvas?.getContext('2d')
    if (canvas) {
        canvas.width = w
        canvas.height = h
    }
    const count = Math.floor(video.duration * fps)
    const frames: Row[] = []
    let detected = 0
    let totalMs = 0
    for (let i = 0; i < count; i++) {
        if (shouldStop?.()) break
        await seek(video, frameTime(i, fps))
        const time = i / fps
        const result = await model.detect(video, time * 1000)
        totalMs += result.ms
        if (result.landmarks) detected++
        const row: Row = {
            video: name,
            exercise: exercise ?? exerciseFromName(name) ?? '',
            model: model.info.id,
            frame: i,
            time,
            width: w,
            height: h,
            ms: result.ms,
            detected: result.landmarks ? 1 : 0,
            side: sideOf(result.landmarks),
        }
        for (const [joint, index] of JOINTS) {
            const l = result.landmarks?.[index]
            row[`${joint}_x`] = l ? l.x * w : null
            row[`${joint}_y`] = l ? l.y * h : null
            row[`${joint}_v`] = l ? l.visibility : null
        }
        frames.push(row)
        if (i % 5 === 0) {
            if (ctx) drawSkeleton(ctx, model, result.landmarks, w, h, drawFrame ? video : undefined)
            onProgress?.(i, count)
        }
    }
    const run: Row = {
        video: name,
        exercise: exercise ?? exerciseFromName(name) ?? '',
        model: model.info.id,
        model_name: model.info.name,
        backend: model.backend,
        load_ms: loadMs ?? null,
        model_bytes: model.bytes || null,
        fps,
        frames: frames.length,
        detected_frames: detected,
        mean_ms: frames.length ? totalMs / frames.length : null,
        width: w,
        height: h,
        browser: navigator.userAgent,
        date: new Date().toISOString(),
    }
    return { frames, run, complete: frames.length === count }
}
