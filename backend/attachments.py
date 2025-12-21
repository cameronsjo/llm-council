"""File attachment handling for LLM Council."""

import base64
import hashlib
import logging
import mimetypes
import os
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

from .config import DATA_BASE_DIR

logger = logging.getLogger(__name__)

# Supported file types
SUPPORTED_TEXT_TYPES = {".txt", ".md", ".json", ".csv", ".xml", ".html", ".py", ".js", ".ts"}
SUPPORTED_PDF_TYPES = {".pdf"}
SUPPORTED_IMAGE_TYPES = {".png", ".jpg", ".jpeg", ".gif", ".webp"}

# Max file sizes (in bytes)
MAX_TEXT_SIZE = 1024 * 1024  # 1MB
MAX_PDF_SIZE = 10 * 1024 * 1024  # 10MB
MAX_IMAGE_SIZE = 5 * 1024 * 1024  # 5MB

# Attachments directory
ATTACHMENTS_DIR = os.path.join(DATA_BASE_DIR, "attachments")


def get_attachments_dir(user_id: Optional[str] = None) -> str:
    """Get the attachments directory for a user.

    Args:
        user_id: Optional username for user-scoped storage

    Returns:
        Path to attachments directory
    """
    if user_id:
        return os.path.join(DATA_BASE_DIR, "users", user_id, "attachments")
    return ATTACHMENTS_DIR


def ensure_attachments_dir(user_id: Optional[str] = None) -> None:
    """Ensure the attachments directory exists."""
    Path(get_attachments_dir(user_id)).mkdir(parents=True, exist_ok=True)


def get_file_extension(filename: str) -> str:
    """Get lowercase file extension."""
    return Path(filename).suffix.lower()


def get_file_type(filename: str) -> Optional[str]:
    """Determine the type of file based on extension.

    Returns:
        'text', 'pdf', 'image', or None if unsupported
    """
    ext = get_file_extension(filename)
    if ext in SUPPORTED_TEXT_TYPES:
        return "text"
    if ext in SUPPORTED_PDF_TYPES:
        return "pdf"
    if ext in SUPPORTED_IMAGE_TYPES:
        return "image"
    return None


def validate_file(
    filename: str, content: bytes
) -> Tuple[bool, Optional[str]]:
    """Validate a file for upload.

    Args:
        filename: Original filename
        content: File content bytes

    Returns:
        Tuple of (is_valid, error_message)
    """
    file_type = get_file_type(filename)
    if not file_type:
        ext = get_file_extension(filename)
        return False, f"Unsupported file type: {ext}"

    size = len(content)
    if file_type == "text" and size > MAX_TEXT_SIZE:
        return False, f"Text file too large (max {MAX_TEXT_SIZE // 1024}KB)"
    if file_type == "pdf" and size > MAX_PDF_SIZE:
        return False, f"PDF too large (max {MAX_PDF_SIZE // (1024 * 1024)}MB)"
    if file_type == "image" and size > MAX_IMAGE_SIZE:
        return False, f"Image too large (max {MAX_IMAGE_SIZE // (1024 * 1024)}MB)"

    return True, None


def save_attachment(
    filename: str,
    content: bytes,
    user_id: Optional[str] = None,
) -> Dict[str, Any]:
    """Save an attachment to disk.

    Args:
        filename: Original filename
        content: File content bytes
        user_id: Optional username for user-scoped storage

    Returns:
        Attachment metadata dict
    """
    ensure_attachments_dir(user_id)

    # Generate unique ID from content hash
    content_hash = hashlib.sha256(content).hexdigest()[:16]
    ext = get_file_extension(filename)
    stored_name = f"{content_hash}{ext}"

    # Save file
    file_path = os.path.join(get_attachments_dir(user_id), stored_name)
    with open(file_path, "wb") as f:
        f.write(content)

    # Get MIME type
    mime_type, _ = mimetypes.guess_type(filename)
    if not mime_type:
        mime_type = "application/octet-stream"

    return {
        "id": content_hash,
        "filename": filename,
        "stored_name": stored_name,
        "file_type": get_file_type(filename),
        "mime_type": mime_type,
        "size": len(content),
    }


def get_attachment_path(
    attachment_id: str,
    ext: str,
    user_id: Optional[str] = None,
) -> Optional[str]:
    """Get the file path for an attachment.

    Args:
        attachment_id: Attachment ID (content hash)
        ext: File extension
        user_id: Optional username for user-scoped storage

    Returns:
        File path or None if not found
    """
    stored_name = f"{attachment_id}{ext}"
    file_path = os.path.join(get_attachments_dir(user_id), stored_name)
    if os.path.exists(file_path):
        return file_path
    return None


def extract_text_from_pdf(content: bytes) -> str:
    """Extract text content from a PDF file.

    Args:
        content: PDF file bytes

    Returns:
        Extracted text as markdown
    """
    try:
        import pymupdf4llm
        import fitz  # PyMuPDF

        # Open PDF from bytes
        doc = fitz.open(stream=content, filetype="pdf")

        # Convert to markdown
        md_text = pymupdf4llm.to_markdown(doc)

        doc.close()
        return md_text
    except ImportError:
        logger.warning("pymupdf4llm not installed, falling back to basic extraction")
        try:
            import fitz
            doc = fitz.open(stream=content, filetype="pdf")
            text_parts = []
            for page in doc:
                text_parts.append(page.get_text())
            doc.close()
            return "\n\n".join(text_parts)
        except Exception as e:
            logger.error("Failed to extract PDF text: %s", e)
            return "[PDF text extraction failed]"
    except Exception as e:
        logger.error("Failed to extract PDF text: %s", e)
        return "[PDF text extraction failed]"


def extract_text_from_file(
    filename: str,
    content: bytes,
) -> Optional[str]:
    """Extract text content from a file.

    Args:
        filename: Original filename
        content: File content bytes

    Returns:
        Extracted text or None for images
    """
    file_type = get_file_type(filename)

    if file_type == "text":
        try:
            return content.decode("utf-8")
        except UnicodeDecodeError:
            try:
                return content.decode("latin-1")
            except Exception:
                return "[Unable to decode text file]"

    if file_type == "pdf":
        return extract_text_from_pdf(content)

    # Images don't have text to extract
    return None


def encode_image_for_vision(
    filename: str,
    content: bytes,
) -> Optional[Dict[str, str]]:
    """Encode an image for vision model input.

    Args:
        filename: Original filename
        content: Image content bytes

    Returns:
        Dict with type and data URI, or None if not an image
    """
    file_type = get_file_type(filename)
    if file_type != "image":
        return None

    mime_type, _ = mimetypes.guess_type(filename)
    if not mime_type:
        ext = get_file_extension(filename)
        mime_map = {
            ".png": "image/png",
            ".jpg": "image/jpeg",
            ".jpeg": "image/jpeg",
            ".gif": "image/gif",
            ".webp": "image/webp",
        }
        mime_type = mime_map.get(ext, "image/png")

    # Base64 encode
    b64_content = base64.b64encode(content).decode("utf-8")

    return {
        "type": "image_url",
        "image_url": {
            "url": f"data:{mime_type};base64,{b64_content}",
        },
    }


def process_attachments(
    attachments: List[Dict[str, Any]],
    user_id: Optional[str] = None,
) -> Tuple[str, List[Dict[str, Any]]]:
    """Process attachments and return context for LLM.

    Args:
        attachments: List of attachment metadata dicts
        user_id: Optional username for user-scoped storage

    Returns:
        Tuple of (text_context, image_parts)
        - text_context: Extracted text from documents
        - image_parts: List of image objects for vision models
    """
    text_parts: List[str] = []
    image_parts: List[Dict[str, Any]] = []

    for attachment in attachments:
        file_path = get_attachment_path(
            attachment["id"],
            get_file_extension(attachment["filename"]),
            user_id,
        )
        if not file_path:
            continue

        with open(file_path, "rb") as f:
            content = f.read()

        file_type = attachment.get("file_type") or get_file_type(attachment["filename"])

        if file_type in ("text", "pdf"):
            text = extract_text_from_file(attachment["filename"], content)
            if text:
                text_parts.append(f"## {attachment['filename']}\n\n{text}")

        elif file_type == "image":
            image_data = encode_image_for_vision(attachment["filename"], content)
            if image_data:
                image_parts.append(image_data)

    text_context = "\n\n---\n\n".join(text_parts) if text_parts else ""
    return text_context, image_parts
