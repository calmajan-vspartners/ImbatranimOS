import { extensionOf } from '../api/listDir'

/**
 * Human-readable message for a native `HTMLMediaElement` error. Every branch
 * (including a missing `error`) returns a string — the element's `error`
 * event surfaces cleanly as UI copy, never a crash.
 */
export function describeMediaError(error: MediaError | null): string {
  if (!error) return 'This file could not be played.'
  switch (error.code) {
    case MediaError.MEDIA_ERR_ABORTED:
      return 'Playback was aborted.'
    case MediaError.MEDIA_ERR_NETWORK:
      return 'A network error interrupted playback.'
    case MediaError.MEDIA_ERR_DECODE:
      return 'This file is corrupt or uses an encoding this browser can’t decode.'
    case MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED:
      return 'This browser can’t play this file format.'
    default:
      return 'This file could not be played.'
  }
}

/**
 * Why *this* file is a likely one to fail, based on its extension.
 *
 * Deliberately a hint about the container, not a claim about the codec: nothing here
 * parses the file, and stating "this is HEVC" without having looked would be a guess
 * dressed as a diagnosis. The container is genuinely informative though — an `.mkv` is a
 * box that can hold anything, and the browser decodes only some of what fits in it.
 *
 * Returns `''` when there is nothing honest to add, which is most formats.
 */
export function codecHint(path: string): string {
  switch (extensionOf(path)) {
    case 'mkv':
      return 'Matroska can carry any codec; browsers decode only a few of them (VP8/VP9, AV1, and H.264 in some builds).'
    case 'mov':
    case 'm4v':
    case 'mp4':
      return 'The container is supported, so it is the codec inside that this browser lacks — H.265/HEVC is the usual one.'
    case 'flac':
    case 'opus':
    case 'oga':
      return 'Support for this audio format varies between browser builds.'
    default:
      return ''
  }
}

/**
 * The whole error state for a failed file: what happened, which file, and whether there is
 * anything useful to add.
 *
 * Naming the file matters because the queue auto-advances — without the name, "can't play
 * this format" is about an unidentified one of twelve tracks.
 *
 * There is deliberately no "try again": the server does not transcode (ffmpeg in the image
 * is a large dependency and real CPU, rejected in the brief), so if the browser has no
 * decoder, retrying cannot produce one. Downloading the file to play it elsewhere is the
 * honest next step, and that is the button the overlay shows.
 */
export function mediaErrorReport(
  error: MediaError | null,
  path: string,
  name: string
): { message: string; hint: string } {
  // A network failure says nothing about the codec, so the container hint would be a red
  // herring exactly when the user needs to know it is not their file's fault.
  const hint = error && error.code !== MediaError.MEDIA_ERR_NETWORK ? codecHint(path) : ''
  return { message: `${name} — ${describeMediaError(error)}`, hint }
}
