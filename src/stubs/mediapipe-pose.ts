// Google's pose-detection library imports @mediapipe/pose for its BlazePose "mediapipe" runtime,
// which FormCheck doesn't use (MediaPipe runs through @mediapipe/tasks-vision, MoveNet through
// TensorFlow.js). That old package isn't an ES module and breaks the build, so it is swapped for this stub.
export class Pose {
    constructor() {
        throw new Error('The @mediapipe/pose runtime is not included in FormCheck')
    }
}
