// "Download everything": one zip with the report, every table and chart, all the raw data, and a
// description of how the study was run, so the paper can be written (and checked) from it.

import { strToU8, zipSync } from 'fflate'
import { toCsv } from '../csv'
import { POSE_MODELS, modelInfo } from '../pose'
import { clip, toRows, type Dataset } from './data'
import { ANGLES, modelName, type Report, type Table } from './metrics'
import { chartToSvg } from './chart'
import { COLOURS, tableCsv, toMarkdown } from './report'
import { summarize } from './summary'
import { finite, median } from './stats'

const FPS = 30

// how every number was worked out, in words, for the paper's method section
const METHODS = {
    frames: `Every frame of every clip was processed at ${FPS} frames per second by stepping the video, so slower models never skipped frames. Time per frame was measured around the model only (preparing the image, running the model, reading the output); the first 10 frames of each clip were left out as warm-up.`,
    keypoints: "All models' outputs were mapped to the 17 COCO body joints (MediaPipe's 33 points include them). The side of the body facing the camera was chosen by the joints' visibility.",
    groundTruth: 'Joints (nose, ear, shoulder, elbow, wrist, hip, knee, ankle on the side facing the camera) were clicked by hand on chosen frames: the top, halfway down and bottom of the first three reps of each clip, picked automatically from the key-angle trace (knee for squats, elbow for push-ups).',
    angles: Object.fromEntries(Object.entries(ANGLES).map(([name, a]) => [name, a.joints.length === 2 ? `tilt of ${a.joints.join('–')} from vertical` : `angle at the ${a.joints[1]} between ${a.joints[0]} and ${a.joints[2]}`])),
    angleError: 'Angle error = |model angle − hand-marked angle| in degrees, on the same frame. Bias = mean signed error. RMSE and the share within 5° and 10° are also reported.',
    jointError: 'Joint error = pixel distance to the hand mark divided by the hand-marked torso length (shoulder–hip). PCK@α = share of joints within α × torso length.',
    situations: {
        camera: 'side (side-on, 2–3 m, good light), diagonal (45°), dim (low light), far (about 4 m); from the file name',
        repPhase: "from the true key angle on each marked frame: the lowest quarter of a clip's range = bottom, the highest quarter = top, the rest = halfway",
        bend: 'true joint angle under 90°, 90–140°, over 140° (knee, elbow and hip angles)',
        personSize: 'height of the marked joints as a share of frame height: under 40%, 40–65%, over 65%',
    },
    statistics: 'Paired Wilcoxon signed-rank tests on the same frames or clips (exact for n ≤ 30 without ties, normal approximation otherwise). In each situation the best model is tested against the runner-up; situations with fewer than 20 marked angles are not used for recommendations. The table of every pair of models uses Holm–Bonferroni-corrected p-values. Significance level 0.05.',
    consistency: 'Steadiness: standard deviation of the key angle in the first second of each clip (the person stands still) and mean joint movement per frame. Bone-length consistency: coefficient of variation of thigh, shin, upper-arm and forearm length on screen (side-on and dim clips). Jitter: mean |θt − 2θt−1 + θt−2| of the key angle. Agreement: Bland–Altman mean difference and 95% limits against the first model.',
    confidence: "Spearman correlation between each joint's confidence score and its error, and AUROC of the confidence score for separating bad joints (error > 0.1 torso length) from good ones.",
    repCounting: "FormCheck's squat and push-up rules (src/engine.ts, src/exercises.ts) were run on each model's saved joints; counted reps were compared with the real number typed in for each clip. The weight-on-toes check needs foot points and was left out for every model. Verdicts were compared for reps both models counted (lowest points within 0.7 s).",
}

function table(t: Table) {
    return tableCsv(t)
}

export function buildBundle(data: Dataset, report: Report) {
    const files: Record<string, Uint8Array> = {}
    const add = (path: string, text: string) => (files[path] = strToU8(text))
    const colours = report.models.map((_, i) => COLOURS[i % COLOURS.length])
    const v = report.verdict

    // the report and the findings
    add('report.md', toMarkdown(report))
    add('summary.md', summarize(report).join('\n\n') + '\n')

    // every table
    for (const s of report.sections) for (const t of s.tables) add(`tables/${s.id}__${t.id}.csv`, table(t))
    if (v) {
        add(
            'tables/overall.csv',
            table({
                id: 'overall',
                title: 'Overall',
                columns: ['measure', ...report.models.map(modelName), 'better', 'higher is better', 'p'],
                rows: v.rows.map((r) => [r.metric, ...report.models.map((m) => r.values[m] ?? null), r.better === 'tie' ? 'tie' : r.better ? modelName(r.better) : '', r.higherIsBetter ? 'yes' : 'no', r.p]),
            }),
        )
        add(
            'tables/which_model_where.csv',
            table({
                id: 'where',
                title: 'Which model where',
                columns: ['dimension', 'situation', 'marked angles', ...report.models.map((m) => `${modelName(m)} error °`), 'best', 'runner-up', 'p (best vs runner-up)'],
                rows: v.situations.map((r) => [r.dimension, r.situation, r.n, ...report.models.map((m) => r.values[m] ?? null), r.better ? modelName(r.better) : '', r.runnerUp ? modelName(r.runnerUp) : '', r.p]),
            }),
        )
    }

    // every chart
    for (const s of report.sections)
        for (const c of s.charts) {
            const svg = chartToSvg(c, colours)
            if (svg) add(`charts/${s.id}__${c.id}.svg`, `<?xml version="1.0" encoding="UTF-8"?>\n${svg}`)
        }

    // the raw data
    const rows = toRows(data)
    add('data/frames.csv', toCsv(rows.frames))
    add('data/runs.csv', toCsv(rows.runs))
    add('data/keypoints.csv', toCsv(rows.keypoints))
    add('data/clips.csv', toCsv(rows.clips.length ? rows.clips : [{ video: '', reps: '' }]))

    // how the study was run
    const videos = [...new Set(data.frames.map((f) => f.video))].sort()
    const study = {
        createdAt: new Date().toISOString(),
        app: 'FormCheck (github.com/Robertboraa/formcheck)',
        browser: navigator.userAgent,
        hardwareThreads: navigator.hardwareConcurrency,
        fps: FPS,
        counts: report.facts,
        models: report.models.map((m) => {
            const info = modelInfo(m)
            const runs = data.runs.filter((r) => r.model === m)
            return {
                id: m,
                name: info.name,
                madeBy: info.by,
                family: info.family,
                joints: info.family === 'mediapipe' ? 33 : 17,
                ranOn: [...new Set(runs.map((r) => r.backend))],
                downloadMB: median(finite(runs.map((r) => r.bytes)).filter((b) => b > 0)) / 1e6 || null,
                startupSeconds: median(finite(runs.map((r) => r.loadMs))) / 1000 || null,
            }
        }),
        allModelsAvailable: POSE_MODELS.map((m) => m.id),
        clips: videos.map((name) => ({
            name,
            ...clip(name),
            realReps: data.clips.find((c) => c.video === name)?.reps ?? null,
            markedFrames: new Set(data.keypoints.filter((k) => k.video === name && Number.isFinite(k.x)).map((k) => k.frame)).size,
            models: [...new Set(data.runs.filter((r) => r.video === name).map((r) => r.model))],
        })),
        methods: METHODS,
    }
    add('study.json', JSON.stringify(study, null, 2))

    add(
        'README.txt',
        `FormCheck pose model comparison: everything for the paper
Created ${study.createdAt}

summary.md          the findings in plain words
report.md           every table, with the verdict and which model to use where
study.json          how the study was run: models, browser, clips, counts, and the method for every number
tables/             every table as CSV (overall.csv and which_model_where.csv are the headline ones)
charts/             every chart as SVG (open in a browser, or insert into Word / LaTeX)
data/frames.csv     where each model put each joint on every frame, and the time it took
data/runs.csv       one row per clip per model: where it ran, download size, start-up time
data/keypoints.csv  the joints marked by hand (the ground truth)
data/clips.csv      the real number of reps in each clip

Load the data/ files into Research → Results → Load CSV files to see everything in the app again.
The worst-frame pictures are downloaded from the Results page (click a picture).
`,
    )

    return zipSync(files, { level: 6 })
}
