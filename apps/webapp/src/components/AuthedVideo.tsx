import type { VideoHTMLAttributes } from 'react';
import { useAuthedSrc } from '../lib/authedSrc';

/** A <video> for a members-only media path (fetched with the sign-in header). */
export function AuthedVideo({
  src,
  ...rest
}: VideoHTMLAttributes<HTMLVideoElement> & { src: string }) {
  return <video src={useAuthedSrc(src)} {...rest} />;
}
