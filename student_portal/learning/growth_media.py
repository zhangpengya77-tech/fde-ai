import warnings
from io import BytesIO
from pathlib import Path

from PIL import Image, ImageOps
from django.core.exceptions import ValidationError


MAX_GROWTH_IMAGE_BYTES = 15 * 1024 * 1024
MAX_GROWTH_IMAGE_PIXELS = 40_000_000
GROWTH_IMAGE_MAX_EDGE = 1600


def process_growth_image(upload):
    if upload.size > MAX_GROWTH_IMAGE_BYTES:
        raise ValidationError("單張圖片不得超過 15 MB，請重新選擇或縮小圖片。")

    original_size = upload.size
    original_filename = Path(upload.name).name
    try:
        upload.seek(0)
        with warnings.catch_warnings():
            warnings.simplefilter("error", Image.DecompressionBombWarning)
            with Image.open(upload) as original:
                if original.format not in {"JPEG", "PNG", "WEBP"}:
                    raise ValidationError("圖片格式無效，請上傳 JPG、PNG 或 WEBP 圖片。")
                if original.width * original.height > MAX_GROWTH_IMAGE_PIXELS:
                    raise ValidationError("圖片解析度過高，請選擇較小的照片。")
                original_format = original.format
                original_width, original_height = original.size
                original.verify()

            upload.seek(0)
            with Image.open(upload) as original:
                image = ImageOps.exif_transpose(original)
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
        raise ValidationError("圖片格式無效，請上傳 JPG、PNG 或 WEBP 圖片。") from exc

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
