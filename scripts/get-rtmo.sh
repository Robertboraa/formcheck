#!/bin/sh
# Downloads the RTMO-s pose model (OpenMMLab, RTMPose family, ONNX) into public/models.
# Run once from the formcheck folder:  npm run get-rtmo
# Tries OpenMMLab's own server first, then the same model on Hugging Face.
set -e
OUT=public/models/rtmo-s.onnx
OPENMMLAB="https://download.openmmlab.com/mmpose/v1/projects/rtmo/onnx_sdk/rtmo-s_8xb32-600e_body7-640x640-dac2bf74_20231211.zip"
HUGGINGFACE="https://huggingface.co/Xenova/RTMO-s/resolve/main/onnx/model.onnx"
TMP=$(mktemp -d)
mkdir -p public/models

echo "Downloading RTMO-s from OpenMMLab..."
if curl -L --fail --silent --show-error -o "$TMP/rtmo.zip" "$OPENMMLAB" && unzip -o -j -q "$TMP/rtmo.zip" '*end2end.onnx' -d "$TMP"; then
    mv "$TMP/end2end.onnx" "$OUT"
else
    echo "OpenMMLab didn't work, trying Hugging Face..."
    curl -L --fail -o "$OUT" "$HUGGINGFACE"
fi
rm -rf "$TMP"

SIZE=$(wc -c < "$OUT" | tr -d ' ')
if [ "$SIZE" -lt 5000000 ]; then
    echo "The download looks wrong (only $SIZE bytes). Delete $OUT and try again."
    exit 1
fi
echo "Done: $OUT ($((SIZE / 1000000)) MB)"
