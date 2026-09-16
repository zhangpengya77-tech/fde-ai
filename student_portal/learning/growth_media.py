import logging
import warnings
from io import BytesIO
from pathlib import Path

from PIL import Image, ImageOps
from pillow_heif import register_heif_opener
from django.core.exceptions import ValidationError


MAX_GROWTH_IMAGE_BYTES = 15 * 1024 * 1024
MAX_GROWTH_IMAGE_PIXELS = 40_000_000
GROWTH_IMAGE_MAX_EDGE = 1600
SUPPORTED_GROWTH_IMAGE_FORMATS = {"JPEG", "PNG", "WEBP", "HEIF", "HEIC"}

logger = logging.getLogger(__name__)

register_heif_opener()


def _log_image_rejection(upload, reason, detected_format="unknown", exception_type="none"):
    upload.seek(0)
    header = upload.read(16)
    upload.seek(0)
    brand = "unknown"
    if len(header) >= 12 and header[4:8] == b"ftyp":
        brand = header[8:12].decode("ascii", errors="replace")
    content_type = getattr(upload, "content_type", "") or "unknown"
    content_type = content_type.replace("\r", "").replace("\n", "")[:100]
    extension = Path(upload.name).suffix.lower() or "unknown"
    logger.warning(
        "Growth photo rejected extension=%s content_type=%s container_brand=%s "
        "detected_format=%s reason=%s exception_type=%s",
        extension,
        content_type,
        brand,
        detected_format,
        reason,
        exception_type,
    )


def process_growth_image(upload):
    if upload.size > MAX_GROWTH_IMAGE_BYTES:
        raise ValidationError("單張圖片不得超過 15 MB，請重新選擇或縮小圖片。")

    original_size = upload.size
    original_filename = Path(upload.name).name
    detected_format = "unknown"
    try:
        upload.seek(0)
        with warnings.catch_warnings():
            warnings.simplefilter("error", Image.DecompressionBombWarning)
            with Image.open(upload) as original:
                detected_format = original.format or "unknown"
                if detected_format not in SUPPORTED_GROWTH_IMAGE_FORMATS:
                    _log_image_rejection(upload, "unsupported_format", detected_format)
                    raise ValidationError("圖片格式無效，請上傳 JPG、PNG、WEBP 或 HEIC 圖片。")
                if original.width * original.height > MAX_GROWTH_IMAGE_PIXELS:
                    raise ValidationError("圖片解析度過高，請選擇較小的照片。")
                original_format = original.format
                original_width, original_height = original.size
                original.verify()

            upload.seek(0)
            with Image.open(upload) as original:
                image = original.copy()
                heif_orientation = original.info.get("original_orientation")
                if heif_orientation:
                    exif = image.getexif()
                    if exif.get(274, 1) == 1:
                        exif[274] = heif_orientation
                image = ImageOps.exif_transpose(image)
                if image.mode in {"RGBA", "LA"} or "transparency" in image.info:
                    rgba = image.convert("RGBA")
                    background = Image.new("RGB", rgba.size, "white")
                    background.paste(rgba, mask=rgba.getchannel("A"))
                    image = background
                else:
                    image = image.convert("RGB")
                image.thumbnail(
                    (GROWTH_IMAGE_MAX_EDGE, GROWTH_IMAGE_MAX_EDGE),
                    Image.Resampling.LANCZOS,
                )
                output = BytesIO()
                image.save(output, format="JPEG", quality=80, optimize=True)
    except ValidationError:
        raise
    except (Image.DecompressionBombError, Image.DecompressionBombWarning, OSError, ValueError) as exc:
        _log_image_rejection(
            upload,
            "decode_error",
            detected_format=detected_format,
            exception_type=type(exc).__name__,
        )
        raise ValidationError("圖片格式無效，請上傳 JPG、PNG、WEBP 或 HEIC 圖片。") from exc

    stem = Path(upload.name).stem[:72] or "growth-photo"
    image_bytes = output.getvalue()
    return (
        f"{stem}.jpg",
        image_bytes,
        {
            "original": {
                "filename": original_filename,
                "content_type": getattr(upload, "content_type", ""),
                "format": original_format,
                "size_bytes": original_size,
                "width": original_width,
                "height": original_height,
            },
            "processed": {
                "format": "JPEG",
                "content_type": "image/jpeg",
                "size_bytes": len(image_bytes),
                "width": image.size[0],
                "height": image.size[1],
                "quality": 80,
            },
        },
    )
