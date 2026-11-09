// small helpers for the research tools: CSV files and stepping through a video frame by frame

export function toCsv(rows: Record<string, unknown>[]): string {
    if (rows.length === 0) return ''
    const columns = Object.keys(rows[0])
    const cell = (v: unknown) => {
        if (v === null || v === undefined || (typeof v === 'number' && !Number.isFinite(v))) return ''
        const s = typeof v === 'number' ? String(Math.round(v * 10000) / 10000) : String(v)
        return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
    }
    return [columns.join(','), ...rows.map((r) => columns.map((c) => cell(r[c])).join(','))].join('\n') + '\n'
}

export function download(name: string, text: string) {
    const url = URL.createObjectURL(new Blob([text], { type: 'text/csv' }))
    const a = document.createElement('a')
    a.href = url
    a.download = name
    a.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
}

// frame i covers the time from i/fps to (i+1)/fps; seeking to the middle always lands on it
export function frameTime(i: number, fps: number) {
    return (i + 0.5) / fps
}

export function seek(video: HTMLVideoElement, time: number) {
    return new Promise<void>((resolve) => {
        if (Math.abs(video.currentTime - time) < 1e-6 && video.readyState >= 2) return resolve()
        video.addEventListener('seeked', () => resolve(), { once: true })
        video.currentTime = time
    })
}

export function loadVideo(video: HTMLVideoElement, file: File) {
    return new Promise<void>((resolve, reject) => {
        video.addEventListener('loadeddata', () => resolve(), { once: true })
        video.addEventListener('error', () => reject(new Error(`Could not open ${file.name}`)), { once: true })
        video.src = URL.createObjectURL(file)
        video.load()
    })
}

// the 17 joints both models give, in MediaPipe's numbering, with the names used in the CSV files
export const JOINTS: [string, number][] = [
    ['nose', 0],
    ['l_eye', 2],
    ['r_eye', 5],
    ['l_ear', 7],
    ['r_ear', 8],
    ['l_shoulder', 11],
    ['r_shoulder', 12],
    ['l_elbow', 13],
    ['r_elbow', 14],
    ['l_wrist', 15],
    ['r_wrist', 16],
    ['l_hip', 23],
    ['r_hip', 24],
    ['l_knee', 25],
    ['r_knee', 26],
    ['l_ankle', 27],
    ['r_ankle', 28],
]

// works out the exercise from a file name like P01_S1_squat_shallow_side.mp4
export function exerciseFromName(name: string): string | undefined {
    if (/push[-_ ]?ups?/i.test(name)) return 'pushup'
    if (/squat/i.test(name)) return 'squat'
    return undefined
}
