import { useCallback, useEffect, useRef, useState } from 'react';

interface VideoPlayback {
  /** Pass to the <video> element's `ref`. Using a callback ref (not a plain ref object) means the
   *  hook's effect re-attaches the moment the element actually mounts — it stays a live event
   *  target even though the <video> is only rendered once a file is loaded, not from page load. */
  videoRef: (el: HTMLVideoElement | null) => void;
  /** The element itself, for callers (e.g. the timeline) that need to seek or play/pause it. */
  videoEl: HTMLVideoElement | null;
  currentTime: number;
  duration: number;
  playing: boolean;
}

/**
 * Polls the video's currentTime every animation frame instead of relying on the native
 * `timeupdate` event, which only fires a few times a second — too coarse to drive a caption
 * preview that has to look like it's actually playing in sync, not stepping.
 */
export function useVideoPlayback(): VideoPlayback {
  const [video, setVideo] = useState<HTMLVideoElement | null>(null);
  const videoRef = useCallback((el: HTMLVideoElement | null) => setVideo(el), []);

  const [state, setState] = useState({ currentTime: 0, duration: 0, playing: false });
  const stateRef = useRef(state);
  stateRef.current = state;

  useEffect(() => {
    if (!video) return;

    const onPlay = () => setState((s) => ({ ...s, playing: true }));
    const onPause = () => setState((s) => ({ ...s, playing: false }));
    const onMeta = () => setState((s) => ({ ...s, duration: video.duration || 0 }));
    video.addEventListener('play', onPlay);
    video.addEventListener('pause', onPause);
    video.addEventListener('loadedmetadata', onMeta);

    let raf = 0;
    const loop = () => {
      if (stateRef.current.currentTime !== video.currentTime) {
        setState((s) => ({ ...s, currentTime: video.currentTime }));
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(raf);
      video.removeEventListener('play', onPlay);
      video.removeEventListener('pause', onPause);
      video.removeEventListener('loadedmetadata', onMeta);
    };
  }, [video]);

  return { videoRef, videoEl: video, ...state };
}
