# Pose model files

| File | Model | Source | Licence |
|---|---|---|---|
| yolo11n-pose.onnx, yolo11s-pose.onnx | Ultralytics YOLO11-pose | exported from the official Ultralytics weights | AGPL-3.0 |
| movenet-lightning/, movenet-thunder/ | Google MoveNet SinglePose v4 (TF Hub) | TF.js graph models via vladmandic/human-models | Apache-2.0 (model), MIT (repackaging) |
| rtmo-s.onnx | OpenMMLab RTMO-s (body7, 640×640) | `npm run get-rtmo` downloads it from download.openmmlab.com | Apache-2.0 |

MediaPipe Pose models are loaded at run time from Google's model storage.
