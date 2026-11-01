from __future__ import annotations

import io
import secrets
from pathlib import Path

from PIL import Image

Image.MAX_IMAGE_PIXELS = 40_000_000

MAX_PDF_PAGES = 30


def sniff(data: bytes) -> str | None:
    if data.startswith(b"%PDF-"):
        return "pdf"
    if data.startswith(b"\x89PNG\r\n\x1a\n"):
        return "png"
    if data.startswith(b"\xff\xd8\xff"):
        return "jpeg"
    if data.startswith((b"GIF87a", b"GIF89a")):
        return "gif"
    if len(data) >= 12 and data.startswith(b"RIFF") and data[8:12] == b"WEBP":
        return "webp"
    return None


def image_size(data: bytes) -> tuple[int, int]:
    with Image.open(io.BytesIO(data)) as image:
        image.load()
        width, height = image.size
    if width < 1 or height < 1:
        raise ValueError("Не удалось прочитать картинку")
    if width * height > 40_000_000:
        raise ValueError("Картинка слишком большая")
    return width, height


def render_pdf(data: bytes, dest_dir: Path) -> list[dict]:
    import pypdfium2 as pdfium

    pdf = pdfium.PdfDocument(data)
    pages: list[dict] = []
    opened = []
    try:
        count = len(pdf)
        if count < 1:
            raise ValueError("В PDF нет страниц")
        if count > MAX_PDF_PAGES:
            raise ValueError("В PDF больше 30 страниц. Разделите файл на части")
        for index in range(count):
            page = pdf[index]
            opened.append(page)
            if hasattr(page, "get_size"):
                width_pt = float(page.get_size()[0])
            else:
                width_pt = float(page.get_width())
            scale = 1400 / max(width_pt, 1.0)
            bitmap = page.render(scale=scale)
            image = bitmap.to_pil()
            file_id = secrets.token_hex(16)
            path = dest_dir / f"{file_id}.png"
            image.save(path, format="PNG")
            pages.append(
                {
                    "id": file_id,
                    "name": f"страница-{index + 1}.png",
                    "mime": "image/png",
                    "path": str(path),
                    "width": image.width,
                    "height": image.height,
                }
            )
            _close(bitmap)
        return pages
    finally:
        for page in opened:
            _close(page)
        _close(pdf)


def _close(obj: object) -> None:
    closer = getattr(obj, "close", None)
    if callable(closer):
        closer()
