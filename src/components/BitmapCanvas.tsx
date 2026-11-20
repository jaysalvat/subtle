/** A decoded picture (ImageBitmap: filmstrip thumbnail, exact frame) drawn at its own size; CSS sizes it. */
import { useEffect, useRef } from 'react';

export function BitmapCanvas({ bitmap }: { bitmap: ImageBitmap | undefined }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    if (!c || !bitmap) return;
    c.width = bitmap.width;
    c.height = bitmap.height;
    c.getContext('2d')!.drawImage(bitmap, 0, 0);
  }, [bitmap]);
  return <canvas ref={ref} />;
}
