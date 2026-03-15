const DEFAULT_MAX_EDGE_PX = 1280;
const DEFAULT_JPEG_QUALITY = 0.75;

export interface PhotoOptimizationOptions {
  maxEdgePx?: number;
  jpegQuality?: number;
}

export interface OptimizedPhoto {
  blob: Blob;
  mimeType: string;
  fileName: string;
  optimized: boolean;
}

function buildFallbackResult(file: File): OptimizedPhoto {
  return {
    blob: file,
    mimeType: file.type || "image/jpeg",
    fileName: file.name || "photo.jpg",
    optimized: false
  };
}

function withJpgExtension(fileName: string): string {
  if (!fileName || fileName.trim().length === 0) {
    return "photo.jpg";
  }

  const index = fileName.lastIndexOf(".");
  if (index <= 0) {
    return `${fileName}.jpg`;
  }

  return `${fileName.slice(0, index)}.jpg`;
}

function loadImageFromFile(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(file);
    const image = new Image();

    image.onload = () => {
      URL.revokeObjectURL(objectUrl);
      resolve(image);
    };

    image.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error("Unable to decode selected image."));
    };

    image.src = objectUrl;
  });
}

function canvasToJpegBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => {
    canvas.toBlob(
      (blob) => {
        resolve(blob);
      },
      "image/jpeg",
      quality
    );
  });
}

export async function optimizePhotoForStorage(
  file: File,
  options: PhotoOptimizationOptions = {}
): Promise<OptimizedPhoto> {
  if (!file.type.startsWith("image/")) {
    return buildFallbackResult(file);
  }

  const maxEdgePx = options.maxEdgePx ?? DEFAULT_MAX_EDGE_PX;
  const jpegQuality = options.jpegQuality ?? DEFAULT_JPEG_QUALITY;

  let image: HTMLImageElement;
  try {
    image = await loadImageFromFile(file);
  } catch {
    return buildFallbackResult(file);
  }

  const sourceWidth = Math.max(1, image.naturalWidth);
  const sourceHeight = Math.max(1, image.naturalHeight);
  const sourceMaxEdge = Math.max(sourceWidth, sourceHeight);
  const scale = sourceMaxEdge > maxEdgePx ? maxEdgePx / sourceMaxEdge : 1;

  const targetWidth = Math.max(1, Math.round(sourceWidth * scale));
  const targetHeight = Math.max(1, Math.round(sourceHeight * scale));

  const canvas = document.createElement("canvas");
  canvas.width = targetWidth;
  canvas.height = targetHeight;

  const context = canvas.getContext("2d");
  if (!context) {
    return buildFallbackResult(file);
  }

  // JPEG has no alpha channel; fill white so transparent pixels do not turn black.
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, targetWidth, targetHeight);
  context.drawImage(image, 0, 0, targetWidth, targetHeight);

  const jpegBlob = await canvasToJpegBlob(canvas, jpegQuality);
  if (!jpegBlob) {
    return buildFallbackResult(file);
  }

  // If no resize happened and recompression is larger, keep original bytes.
  if (scale === 1 && jpegBlob.size >= file.size) {
    return buildFallbackResult(file);
  }

  return {
    blob: jpegBlob,
    mimeType: "image/jpeg",
    fileName: withJpgExtension(file.name),
    optimized: scale < 1 || jpegBlob.size < file.size || file.type !== "image/jpeg"
  };
}
