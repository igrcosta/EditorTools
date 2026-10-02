# Third-party components

Binaries and models fetched into `vendor/` by `scripts/fetch-vendor.mjs` and shipped with the desktop app.

| Component | Use | License | Source |
|---|---|---|---|
| yt-dlp | Media Downloader | Unlicense | https://github.com/yt-dlp/yt-dlp |
| FFmpeg (ffmpeg-static build) | All processing | GPL/LGPL (see build) | https://github.com/eugeneware/ffmpeg-static |
| ONNX Runtime (`onnxruntime-node`) | Runs the AI models | MIT | https://github.com/microsoft/onnxruntime |
| IS-Net general-use (`isnet-general-use.onnx`, from DIS) | Background removal | Apache-2.0 | https://github.com/xuebinqin/DIS (hosted by https://github.com/danielgatis/rembg) |
| YuNet 2023mar (`face_detection_yunet_2023mar.onnx`) | Face detection for Face Tracking | MIT | https://github.com/opencv/opencv_zoo |
| Real-ESRGAN ncnn-vulkan (`realesrgan-ncnn-vulkan`) | Image upscaling engine | MIT | https://github.com/xinntao/Real-ESRGAN-ncnn-vulkan |
| Real-ESRGAN models (`realesrgan-x4plus`, `realesrgan-x4plus-anime`, `realesr-animevideov3`) | Image upscaling weights | BSD-3-Clause | https://github.com/xinntao/Real-ESRGAN |
| whisper.cpp (`whisper-cli`) | Speech-to-text engine for Automatic Captions | MIT | https://github.com/ggml-org/whisper.cpp |
| Whisper "small" weights (`ggml-small.bin`, GGML conversion of OpenAI's Whisper) | Automatic Captions transcription | MIT | https://huggingface.co/ggerganov/whisper.cpp |
| wav2vec2-base-960h (`aligner-en.onnx`, ONNX conversion by onnx-community of Facebook AI's model) | Forced alignment of English caption word timing | Apache-2.0 | https://huggingface.co/facebook/wav2vec2-base-960h |
| wav2vec2-large-xlsr-53-portuguese (`aligner-pt.onnx`, ONNX conversion by onnx-community of Jonatas Grosman's fine-tune of Facebook AI's XLSR-53) | Forced alignment of Portuguese caption word timing | Apache-2.0 | https://huggingface.co/jonatasgrosman/wav2vec2-large-xlsr-53-portuguese |
| Landing demo photo (`apps/web/public/demo/car-original.jpg`, white sports car) and its cut-out made by Editools' own Remove Background (`car-cutout.webp`) | Remove Background example on the home page | Pexels License (free to use, attribution not required) | https://www.pexels.com/license/ |
| Landing demo video (`apps/web/public/demo/vlog-original.mp4`, a vlogger filming food in a kitchen, trimmed and downscaled) and the vertical video made from it by Editools' own Face Tracking (`vlog-tracked.mp4`, `vlog-track.json`) | Face Tracking example on the home page | Pexels License (free to use, attribution not required) | https://www.pexels.com/license/ |
| Anton | Custom caption template font | OFL-1.1 | https://github.com/google/fonts/tree/main/ofl/anton |
| Bebas Neue | Custom caption template font | OFL-1.1 | https://github.com/google/fonts/tree/main/ofl/bebasneue |
| Poppins | Custom caption template font | OFL-1.1 | https://github.com/google/fonts/tree/main/ofl/poppins |
| Archivo Black | Custom caption template font | OFL-1.1 | https://github.com/google/fonts/tree/main/ofl/archivoblack |
| Luckiest Guy | Custom caption template font | Apache-2.0 | https://github.com/google/fonts/tree/main/apache/luckiestguy |
| Bangers | Custom caption template font | OFL-1.1 | https://github.com/google/fonts/tree/main/ofl/bangers |

Not used on purpose (licensing): BRIA RMBG-1.4/2.0 (non-commercial), `@imgly/background-removal` (AGPL-3.0), `upscayl-ncnn` (AGPL-3.0).

## Web app assets

Self-hosted in `apps/web/public/`.

| Component | Use | License | Source |
|---|---|---|---|
| Flaticon UIcons (regular-rounded style) | Interface icons (nav, home, tool pages) | Free (attribution required — see the footer credit in `Layout.tsx`) | https://www.flaticon.com/uicons |
