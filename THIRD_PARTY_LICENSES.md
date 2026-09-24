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
| Silero VAD (`ggml-silero-v6.2.0.bin`, GGML conversion by the whisper.cpp project) | Voice activity detection ahead of Automatic Captions transcription | MIT | https://github.com/snakers4/silero-vad (hosted by https://huggingface.co/ggml-org/whisper-vad) |
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
